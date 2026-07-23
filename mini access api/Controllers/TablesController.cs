using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using System.Collections.Generic;
using System.Data;
namespace mini_access_api.Controllers
{
    public class FileUploadRequest
    {
        public IFormFile File { get; set; }
        public string TableName { get; set; }
        public string DatabaseName { get; set; }
    }
    public class CellUpdateRequest
    {
        public string DatabaseName { get; set; }
        public string TableName { get; set; }
        public string ColumnName { get; set; }
        public string PrimaryKeyName { get; set; }
        public string PrimaryKeyValue { get; set; }
        public string NewValue { get; set; }
    }
    public class DeleteRequest
    {
        public string DatabaseName { get; set; }
        public string PrimaryKeyName { get; set; }
        public string PrimaryKeyValue { get; set; }
    }


    [Route("api/[controller]")]
    [ApiController]
    public class TablesController : ControllerBase
    {
        private bool IsValidIdentifier(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            return System.Text.RegularExpressions.Regex.IsMatch(name, @"^[a-zA-Z0-9_]+$");
        }
        private string GetConnectionString(string databaseName = "master")
        {
            // Safety check to prevent malicious database names
            if (!IsValidIdentifier(databaseName))
            {
                throw new ArgumentException("Invalid database name.");
            }
            return $"Server=.\\SQLEXPRESS;Database={databaseName};Trusted_Connection=True;TrustServerCertificate=True;";
        }
        [HttpPost("create-database")]
        public async Task<IActionResult> CreateDatabase([FromQuery] string dbName)
        {
            if(!IsValidIdentifier(dbName))
            {
                return BadRequest(new { error = "Invalid database name. Use only alphanumeric characters and underscores." });
            }
            try
            {
                using( var connection = new SqlConnection(GetConnectionString("master")))
                {
                    await connection.OpenAsync();
                    string checkQuery = "SELECT COUNT(1) FROM sys.databases WHERE name = @dbName";
                    using (var checkCmd = new SqlCommand(checkQuery, connection))
                    {
                        checkCmd.Parameters.AddWithValue("@dbName", dbName);
                        int exists = (int)await checkCmd.ExecuteScalarAsync();
                        if (exists > 0)
                            return BadRequest(new { error = "A database with this name already exists." });
                    }
                    string query = $"CREATE DATABASE [{dbName}]";
                    using (var command = new SqlCommand(query, connection))
                    {
                        await command.ExecuteNonQueryAsync();
                    }
                }
                return Ok(new { message = $"Database '{dbName}' created succesfully!" });
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }
        [HttpPost("create-table")]
        public async Task<IActionResult> CreateEmptyTable([FromQuery] string dbName, [FromQuery] string tableName)
        {
            if (!IsValidIdentifier(dbName) || !IsValidIdentifier(tableName))
            {
                return BadRequest(new { error = "Invalid database or table name." });
            }
            try
            {
                // Creates the table with your brilliant default architecture
                string query = $"CREATE TABLE [{tableName}] (Id INT IDENTITY(1,1) PRIMARY KEY)";

                using (var connection = new SqlConnection(GetConnectionString(dbName)))
                {
                    await connection.OpenAsync();
                    using (var command = new SqlCommand(query, connection))
                    {
                        await command.ExecuteNonQueryAsync();
                    }
                }
                return Ok(new { message = $"Table '{tableName}' created successfully!" });
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("update-cell")]
        public IActionResult UpdateCell([FromBody] CellUpdateRequest request)
        {
            if (!IsValidIdentifier(request.TableName) || !IsValidIdentifier(request.ColumnName))
            {
                return BadRequest(new { error = "Invalid table or column name." });
            }
            // Enforce Rule: Never allow updating the primary key column via inline editing
            if (request.ColumnName.Equals("Id", StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest("Cannot edit primary key values");
            }

            // Dynamically construct the query safely using parameterized values for the data
            string query = $@"
                UPDATE [{request.TableName}] 
                SET [{request.ColumnName}] = @Value 
                WHERE [{request.PrimaryKeyName}] = @Id";

            using (SqlConnection conn = new SqlConnection(GetConnectionString(request.DatabaseName)))
            {
                using (SqlCommand cmd = new SqlCommand(query, conn))
                {
                    cmd.Parameters.AddWithValue("@Value", (object)request.NewValue ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@Id", request.PrimaryKeyValue);

                    try
                    {
                        conn.Open();
                        int rowsAffected = cmd.ExecuteNonQuery();

                        if (rowsAffected == 0)
                        {
                            return NotFound(new { error = "Record not found or no changes made." });
                        }

                        return Ok(new { message = "Cell updated successfully." });
                    }
                    catch (SqlException ex)
                    {
                        // Handle standard database restrictions and map them to human-readable errors
                        switch (ex.Number)
                        {
                            case 2627: // Unique constraint / Primary Key violation
                            case 2601:
                                return BadRequest(new { error = "Duplicate entry. This value must be unique." });
                            case 547:  // Foreign Key constraint violation
                                return BadRequest(new { error = "Database restriction error: The referenced relationship does not exist." });
                            case 245:  // Data type conversion error (e.g., sending text to an INT column)
                            case 8114:
                                return BadRequest(new { error = "Data type mismatch. Please enter a valid value for this column." });
                            default:
                                return BadRequest(new { error = $"Database error: {ex.Message}" });
                        }
                    }
                }
            }
        }
        [HttpPost("upload")]
        public async Task<IActionResult> UploadDatabase([FromForm] FileUploadRequest request)
        {
            var file = request.File;
            var dbName = request.DatabaseName;
            var tableName = request.TableName;

            if (file == null || file.Length == 0) return BadRequest("No file uploaded");
            if (!IsValidIdentifier(dbName) || !IsValidIdentifier(tableName)) return BadRequest("Invalid database or table name.");

            using var stream = new StreamReader(file.OpenReadStream());
            var headerLine = await stream.ReadLineAsync();

            if (string.IsNullOrWhiteSpace(headerLine)) return BadRequest("CSV file is empty.");

            var headers = headerLine.Split(",")
                                    .Select(h => new string(h.Where(char.IsLetterOrDigit).ToArray()))
                                    .Select((h, i) => string.IsNullOrEmpty(h) ? $"Column{i}" : h)
                                    .ToArray();

            // 1. Check if the incoming CSV already has an Id column
            bool hasIdColumn = headers.Any(h => h.Equals("Id", StringComparison.OrdinalIgnoreCase));

            using var connection = new SqlConnection(GetConnectionString(dbName));
            await connection.OpenAsync();

            // 2. Build the CREATE TABLE schema dynamically
            var columnDefs = new List<string>();

            // If there is NO id column in the CSV, we inject our own to ensure the frontend works
            if (!hasIdColumn)
            {
                columnDefs.Add("[Id] INT IDENTITY(1,1) PRIMARY KEY");
            }

            foreach (var header in headers)
            {
                if (header.Equals("Id", StringComparison.OrdinalIgnoreCase))
                    columnDefs.Add($"[{header}] INT IDENTITY(1,1) PRIMARY KEY"); // Make the imported ID the true Primary Key
                else
                    columnDefs.Add($"[{header}] NVARCHAR(MAX)");
            }

            var createTableSql = $"CREATE TABLE [{tableName}] ({string.Join(", ", columnDefs)})";

            using (var createCmd = new SqlCommand(createTableSql, connection))
            {
                try { await createCmd.ExecuteNonQueryAsync(); }
                catch (SqlException ex) { return BadRequest($"Database error creating table: {ex.Message}"); }
            }

            // 3. Temporarily unlock the identity column if we are importing our own explicit IDs
            if (hasIdColumn)
            {
                using var idOnCmd = new SqlCommand($"SET IDENTITY_INSERT [{tableName}] ON", connection);
                await idOnCmd.ExecuteNonQueryAsync();
            }

            // 4. Blast the data into the database
            while (!stream.EndOfStream)
            {
                var line = await stream.ReadLineAsync();
                if (string.IsNullOrWhiteSpace(line)) continue;

                // NEW: A robust regex that splits by commas EXCEPT when they are inside quotes
                var values = System.Text.RegularExpressions.Regex.Split(line, ",(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)");

                var insertSql = $"INSERT INTO [{tableName}] ({string.Join(", ", headers.Select(h => $"[{h}]"))}) " +
                                $"VALUES ({string.Join(", ", headers.Select((h, i) => $"@p{i}"))})";

                using var insertCmd = new SqlCommand(insertSql, connection);

                for (int i = 0; i < headers.Length; i++)
                {
                    string val = i < values.Length ? values[i] : "";

                    // NEW: Clean up the double quotes generated by the JS export!
                    if (val.StartsWith("\"") && val.EndsWith("\""))
                    {
                        // Remove the start/end quotes and un-escape any internal quotes
                        val = val.Substring(1, val.Length - 2).Replace("\"\"", "\"");
                    }

                    // Handle empty strings for INT/Number columns by passing DBNull
                    if (string.IsNullOrWhiteSpace(val) && headers[i].Equals("Id", StringComparison.OrdinalIgnoreCase))
                    {
                        insertCmd.Parameters.AddWithValue($"@p{i}", DBNull.Value);
                    }
                    else
                    {
                        insertCmd.Parameters.AddWithValue($"@p{i}", val);
                    }
                }

                await insertCmd.ExecuteNonQueryAsync();
            }

            // 5. Lock the table back down so it stays safe!
            if (hasIdColumn)
            {
                using var idOffCmd = new SqlCommand($"SET IDENTITY_INSERT [{tableName}] OFF", connection);
                await idOffCmd.ExecuteNonQueryAsync();
            }

            return Ok(new { message = $"Table '{tableName}' successfully generated and populated!" });
        }
        [HttpGet("databases")]
        public async Task<IActionResult> GetDatabases()
        {
            var databases = new List<string>();
            try
            {
                string query = @"
                    SELECT name 
                    FROM sys.databases 
                    WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb') 
                    ORDER BY name";
                // Connect to 'master' to read the global database list
                using (var connection = new SqlConnection(GetConnectionString("master")))
                {
                    await connection.OpenAsync();
                    using (var command = new SqlCommand(query, connection))
                    {
                        using (var reader = await command.ExecuteReaderAsync())
                        {
                            while (await reader.ReadAsync())
                            {
                                databases.Add(reader.GetString(0));
                            }
                        }
                    }
                }
                return Ok(databases);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpGet("list")]
        public IActionResult GetTables([FromQuery] string dbName)
        {
            if (string.IsNullOrEmpty(dbName))
                return BadRequest("Database name is required.");

            List<string> tables = new List<string>();

            // Just grab EVERY standard table inside whatever database we are currently connected to
            string query = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'";

            using (SqlConnection connection = new SqlConnection(GetConnectionString(dbName)))
            {
                connection.Open();
                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    using (SqlDataReader reader = command.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            tables.Add(reader.GetString(0));
                        }
                    }
                }
            }
            return Ok(tables);
        }
        [HttpDelete("{tableName}/row")]
        public async Task<IActionResult> DeleteRow(string tableName, [FromBody] DeleteRequest request)
        {
            try
            {
                string query = $"DELETE FROM [{tableName}] WHERE [{request.PrimaryKeyName}] = @pkValue";

                using (var connection = new Microsoft.Data.SqlClient.SqlConnection(GetConnectionString(request.DatabaseName)))
                {
                    await connection.OpenAsync();
                    using (var command = new Microsoft.Data.SqlClient.SqlCommand(query, connection))
                    {
                        command.Parameters.AddWithValue("@pkValue", request.PrimaryKeyValue);
                        int rowsAffected = await command.ExecuteNonQueryAsync();
                        if (rowsAffected > 0)
                        {
                            return Ok(new { message = "Row deleted succesfully" });
                        }
                        return NotFound(new { message = "Row not found" });
                    }
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPost("{tableName}/add-new-row")]
        public async Task<IActionResult> AddNewRow([FromQuery] string dbName, string tableName, [FromQuery] string pkName, [FromBody] Dictionary<string, System.Text.Json.JsonElement> rowData)
        {
            try
            {
                var columns = new List<string>();
                var parameters = new List<string>();
                var commandParameters = new List<Microsoft.Data.SqlClient.SqlParameter>();

                int paramIndex = 0;
                foreach (var kvp in rowData)
                {
                    // If the value is completely null, skip it
                    if (kvp.Value.ValueKind == System.Text.Json.JsonValueKind.Null) continue;

                    string stringValue = kvp.Value.ToString();

                    // If the user sent an empty string, skip it! 
                    // We do not even include this column in the SQL query.
                    if (string.IsNullOrWhiteSpace(stringValue)) continue;

                    // 3. If we get here, there is actual data to insert
                    columns.Add($"[{kvp.Key}]");
                    string paramName = $"@param{paramIndex}";
                    parameters.Add(paramName);

                    commandParameters.Add(new Microsoft.Data.SqlClient.SqlParameter(paramName, stringValue));
                    paramIndex++;
                }

                string query = "";

                // If every single column was blank (which happens when you just click + Add Row), 
                // we use a special SQL command to generate a perfectly empty row using native defaults.
                if (columns.Count == 0)
                {
                    query = $"INSERT INTO [{tableName}] OUTPUT INSERTED.[{pkName}] DEFAULT VALUES";
                }
                else
                {
                    query = $"INSERT INTO [{tableName}] ({string.Join(", ", columns)}) OUTPUT INSERTED.[{pkName}] VALUES ({string.Join(", ", parameters)})";
                }

                using (var connection = new Microsoft.Data.SqlClient.SqlConnection(GetConnectionString(dbName)))
                {
                    await connection.OpenAsync();
                    using (var command = new Microsoft.Data.SqlClient.SqlCommand(query, connection))
                    {
                        // Only add parameters if we actually have some
                        if (commandParameters.Count > 0)
                        {
                            command.Parameters.AddRange(commandParameters.ToArray());
                        }

                        var newId = await command.ExecuteScalarAsync();
                        return Ok(new { newId = newId.ToString() });
                    }
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPost("{tableName}/row")]
        public async Task<IActionResult> InsertRow([FromQuery] string dbName, string tableName, [FromBody] Dictionary<string, System.Text.Json.JsonElement> rowData)
        {
            try
            {
                if (rowData == null || rowData.Count == 0)
                    return BadRequest("No column data provided.");

                var columns = new List<string>();
                var parameters = new List<string>();
                var commandParameters = new List<Microsoft.Data.SqlClient.SqlParameter>();

                int paramIndex = 0;
                foreach (var kvp in rowData) {
                    columns.Add($"[{kvp.Key}]");
                    string paramName = $"@param{paramIndex}";
                    parameters.Add(paramName);

                    // Handle DBNull for null values
                    object val = DBNull.Value;
                    if (kvp.Value.ValueKind != System.Text.Json.JsonValueKind.Null)
                    {
                        val = kvp.Value.ToString();
                    }

                    commandParameters.Add(new Microsoft.Data.SqlClient.SqlParameter(paramName, val));
                    paramIndex++;
                }
                string query = $@"
                            DECLARE @HasIdentity BIT = 0;
            
                            -- Check if this specific table has an auto-incrementing identity column
                            IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('[{tableName}]') AND is_identity = 1)
                            BEGIN
                                SET @HasIdentity = 1;
                                -- Temporarily unlock the identity column
                                SET IDENTITY_INSERT [{tableName}] ON; 
                            END

                            -- Perform the insert with our forced ID
                            INSERT INTO [{tableName}] ({string.Join(", ", columns)}) VALUES ({string.Join(", ", parameters)});

                            -- Lock it back down to keep the database safe
                            IF @HasIdentity = 1
                            BEGIN
                                SET IDENTITY_INSERT [{tableName}] OFF;
                            END
                        "; 
                using (var connection = new Microsoft.Data.SqlClient.SqlConnection(GetConnectionString(dbName)))
                {
                    await connection.OpenAsync();
                    using (var command = new Microsoft.Data.SqlClient.SqlCommand(query, connection))
                    {
                        command.Parameters.AddRange(commandParameters.ToArray());
                        await command.ExecuteNonQueryAsync();
                        return Ok(new { message = "Row inserted succesfully" });
                    }
                }
            }
            catch (Exception ex) {
                return BadRequest(new { error = ex.Message });
            }
        }
        [HttpGet("{tableName}/schema")]
        public async Task<IActionResult> GetTableSchema([FromQuery] string dbName, string tableName)
        {
            try
            {
                var schema = new List<Dictionary<string, string>>();

                // This queries SQL Server's internal rulebook for a specific table
                string query = @"
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = @tableName";

                using (var connection = new Microsoft.Data.SqlClient.SqlConnection(GetConnectionString(dbName)))
                {
                    await connection.OpenAsync();
                    using (var command = new Microsoft.Data.SqlClient.SqlCommand(query, connection))
                    {
                        command.Parameters.AddWithValue("@tableName", tableName);
                        using (var reader = await command.ExecuteReaderAsync())
                        {
                            while (await reader.ReadAsync())
                            {
                                schema.Add(new Dictionary<string, string>
                        {
                            { "ColumnName", reader["COLUMN_NAME"].ToString() },
                            { "DataType", reader["DATA_TYPE"].ToString() },
                            { "IsNullable", reader["IS_NULLABLE"].ToString() }
                        });
                            }
                        }
                    }
                }
                return Ok(schema);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }
        [HttpDelete("{tableName}/column/{columnName}")]
        public async Task<IActionResult> DropColumn([FromQuery] string dbName, string tableName, string columnName)
        {
            try
            {
                string safeTable = tableName.Replace("]", "]]");
                string safeCol = columnName.Replace("]", "]]");
                string query = $"ALTER TABLE [{safeTable}] DROP COLUMN [{safeCol}]";

                using (var connection = new Microsoft.Data.SqlClient.SqlConnection(GetConnectionString(dbName)))
                {
                    await connection.OpenAsync();
                    using (var command  = new Microsoft.Data.SqlClient.SqlCommand(query, connection))
                    {
                        await command.ExecuteNonQueryAsync();
                        return Ok(new { message = "Column deleted succesfully." });
                    }
                }
            }
            catch (Microsoft.Data.SqlClient.SqlException sqlEx)
            {
                return BadRequest(new { error = $"Database restricted this action. {sqlEx.Message}" });
            }
            catch (Exception ex)
            {
                return BadRequest(new {error =  ex.Message});
            }
        }
        [HttpPost("{tableName}/column")]
        public async Task<IActionResult> AddColumn([FromQuery] string dbName, string tableName, [FromBody] Dictionary<string, string> payload)
        {
            try
            {
                if (!payload.ContainsKey("columnName") || !payload.ContainsKey("dataType"))
                    return BadRequest(new { error = "Missing column name or data type." });
                string rawColumnName = payload["columnName"].Trim();
                string friendlyType = payload["dataType"].ToLower();
                //sql injection guard
                string safeTable = tableName.Replace("]", "]]");
                string safeCol = rawColumnName.Replace("]", "]]").Replace(" ", "_");

                if (string.IsNullOrWhiteSpace(safeCol))
                    return BadRequest(new { error = "Column name cannot be empty" });
                // Translate User-Friendly UI types to strict SQL Server types
                string sqlType = friendlyType switch
                {
                    "text" => "NVARCHAR(MAX)",
                    "number" => "INT",
                    "decimal" => "DECIMAL(18,2)",
                    "date" => "DATETIME",
                    "checkbox" => "BIT",
                    _ => "NVARCHAR(MAX)" // Fallback
                };

                // We MUST append "NULL" at the end, or SQL Server will crash if the table already has rows!
                string query = $"ALTER TABLE [{safeTable}] ADD [{safeCol}] {sqlType} NULL";
                using (var connection = new Microsoft.Data.SqlClient.SqlConnection(GetConnectionString(dbName)))
                {
                    await connection.OpenAsync();
                    using (var command = new Microsoft.Data.SqlClient.SqlCommand(query, connection))
                    {
                        await command.ExecuteNonQueryAsync();
                        return Ok(new { message = "Column added succesfully." });
                    }
                }
            } catch(Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }   
        }
        [HttpPost("add-foreign-key")]
        public async Task<IActionResult> AddForeignKey(
            [FromQuery] string dbName,
            [FromQuery] string tableName,
            [FromQuery] string columnName,
            [FromQuery] string targetTable,
            [FromQuery] string targetColumn = "Id") // We default to targeting the 'Id' column
        {
            if (!IsValidIdentifier(dbName) || !IsValidIdentifier(tableName) ||
        !IsValidIdentifier(columnName) || !IsValidIdentifier(targetTable) || !IsValidIdentifier(targetColumn))
            {
                return BadRequest(new { error = "Invalid database, table, or column name." });
            }
            try
            {
                // generate sql constraint
                string constraintName = $"FK_{tableName}_{columnName}_{targetTable}";

                // The SQL command that actually links the tables together
                string query = $@"
            ALTER TABLE [{tableName}] 
            ADD CONSTRAINT [{constraintName}] 
            FOREIGN KEY ([{columnName}]) 
            REFERENCES [{targetTable}]([{targetColumn}])";

                using (var connection = new SqlConnection(GetConnectionString(dbName)))
                {
                    await connection.OpenAsync();
                    using (var command = new SqlCommand(query, connection))
                    {
                        await command.ExecuteNonQueryAsync();
                    }
                }
                return Ok(new { message = $"Successfully linked {tableName}.{columnName} to {targetTable}.{targetColumn}!" });
            }
            catch (SqlException ex)
            {
                return BadRequest(new { error = $"Could not create relationship. DB Error: {ex.Message}" });
            }
        }
        [HttpGet("view-join")]
        public IActionResult GetJoinedView(
        [FromQuery] string dbName,
        [FromQuery] string mainTable,
        [FromQuery] string fkColumn,
        [FromQuery] string targetTable,
        [FromQuery] string targetColumn = "Id") 
        {
            if (string.IsNullOrEmpty(dbName)) return BadRequest("Database name is required.");

            var results = new List<Dictionary<string, object>>();

            // use the targetColumn variable instead of hardcoding 'Id'
            string query = $"SELECT m.*, t.* FROM [{mainTable}] m LEFT JOIN [{targetTable}] t ON m.[{fkColumn}] = t.[{targetColumn}]";

            try
            {
                using (var connection = new SqlConnection(GetConnectionString(dbName)))
                {
                    connection.Open();
                    using (var command = new SqlCommand(query, connection))
                    using (var reader = command.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            var row = new Dictionary<string, object>();
                            for (int i = 0; i < reader.FieldCount; i++)
                            {
                                string colName = reader.GetName(i);

                                // Prevent JSON crashes if both tables have the same column name
                                if (row.ContainsKey(colName))
                                {
                                    colName = $"{targetTable}_{colName}";
                                }

                                row[colName] = reader.IsDBNull(i) ? "" : reader.GetValue(i);
                            }
                            results.Add(row);
                        }
                    }
                }
                return Ok(results);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpGet("foreign-keys")]
        public IActionResult GetForeignKeys([FromQuery] string dbName, [FromQuery] string tableName)
        {
            if (string.IsNullOrEmpty(dbName) || string.IsNullOrEmpty(tableName))
                return BadRequest("Database and table names are required.");

            var relationships = new List<Dictionary<string, string>>();

            // This query asks SQL Server for all outgoing links originating from the specified table
            string query = @"
        SELECT 
            c_parent.name AS LocalColumn,
            t_ref.name AS TargetTable,
            c_ref.name AS TargetColumn
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        INNER JOIN sys.tables t_parent ON fkc.parent_object_id = t_parent.object_id
        INNER JOIN sys.columns c_parent ON fkc.parent_object_id = c_parent.object_id AND fkc.parent_column_id = c_parent.column_id
        INNER JOIN sys.tables t_ref ON fkc.referenced_object_id = t_ref.object_id
        INNER JOIN sys.columns c_ref ON fkc.referenced_object_id = c_ref.object_id AND fkc.referenced_column_id = c_ref.column_id
        WHERE t_parent.name = @tableName";

            try
            {
                using (var connection = new SqlConnection(GetConnectionString(dbName)))
                {
                    connection.Open();
                    using (var command = new SqlCommand(query, connection))
                    {
                        command.Parameters.AddWithValue("@tableName", tableName);
                        using (var reader = command.ExecuteReader())
                        {
                            while (reader.Read())
                            {
                                relationships.Add(new Dictionary<string, string>
                        {
                            { "LocalColumn", reader.GetString(0) },
                            { "TargetTable", reader.GetString(1) },
                            { "TargetColumn", reader.GetString(2) }
                        });
                            }
                        }
                    }
                }
                return Ok(relationships);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }
        [HttpGet("{tableName}")]
        public IActionResult GetTableData(string tableName, [FromQuery] string dbName, [FromQuery] string search = "", [FromQuery] bool exactMatch = false, [FromQuery] string searchColumn = "ALL")
        {
            var rows = new List<Dictionary<string, object>>();

            using (SqlConnection connection = new SqlConnection(GetConnectionString(dbName)))
            {
                connection.Open();

                var columnTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                string colQuery = "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tableName";
                using (SqlCommand colCmd = new SqlCommand(colQuery, connection))
                {
                    colCmd.Parameters.AddWithValue("@tableName", tableName);
                    using (SqlDataReader colReader = colCmd.ExecuteReader())
                    {
                        while (colReader.Read())
                        {
                            columnTypes.Add(colReader.GetString(0), colReader.GetString(1));
                        }
                    }
                }

                if (columnTypes.Count == 0) return NotFound("Table not found or has no columns.");

                string sqlQuery = $"SELECT * FROM [{tableName}]";

                if (!string.IsNullOrEmpty(search))
                {
                    List<string> searchClauses = new List<string>();
                    string cleanSearch = search.Trim().ToLower();
                    //check if targeted column is a number
                    bool isNumericSearch = decimal.TryParse(search.Trim(), out decimal searchNum);
                    // 1. Identify which columns to search
                    var targetColumns = columnTypes.Keys.ToList();
                    if (searchColumn != "ALL")
                    {
                        // Case-insensitive security check
                        var matchedColumn = targetColumns.FirstOrDefault(c => c.Equals(searchColumn, StringComparison.OrdinalIgnoreCase));
                        if (matchedColumn != null)
                        {
                            targetColumns = new List<string> { matchedColumn };
                        }
                    }

                    // 2. Loop ONLY over the target columns 
                    foreach (var col in targetColumns)
                    {

                        string dataType = columnTypes[col].ToLower();
                        // check if its an image
                        bool isDbBinary = dataType.Contains("image") || dataType.Contains("binary") || dataType.Contains("varbinary");
                        if (isDbBinary)
                        {
                            continue;
                        }
                        // Check if the database column is a math type
                        bool isDbNumeric = dataType.Contains("int") || dataType.Contains("money") ||
                                           dataType.Contains("decimal") || dataType.Contains("numeric") ||
                                           dataType.Contains("float") || dataType.Contains("real");

                        if (isDbNumeric)
                        {
                            // If the column is a number, and the user typed a number...
                            if (isNumericSearch)
                            {
                                // Use strict mathematical equality
                                searchClauses.Add($"[{col}] = @searchNumber");
                            }
                            // If they typed text then completely skip numeric columns
                        }
                        else
                        {
                            string safelyCastedCol = $"CONVERT(NVARCHAR(MAX), [{col}])";

                            if (exactMatch)
                            {
                                if (cleanSearch == "true") searchClauses.Add($"{safelyCastedCol} = '1'");
                                else if (cleanSearch == "false") searchClauses.Add($"{safelyCastedCol} = '0'");
                                else searchClauses.Add($"{safelyCastedCol} = @searchExact");
                            }
                            else
                            {
                                if (cleanSearch == "true") searchClauses.Add($"({safelyCastedCol} LIKE @searchPartial OR {safelyCastedCol} = '1')");
                                else if (cleanSearch == "false") searchClauses.Add($"({safelyCastedCol} LIKE @searchPartial OR {safelyCastedCol} = '0')");
                                else searchClauses.Add($"{safelyCastedCol} LIKE @searchPartial");
                            }
                        }
                    }
                    // Safety check: If they typed text into a table that only has numbers, we'd have 0 clauses.
                    if (searchClauses.Count > 0)
                    {
                        sqlQuery += " WHERE " + string.Join(" OR ", searchClauses);
                    }
                    else
                    {
                        // Forces the query to return 0 rows cleanly instead of crashing
                        sqlQuery += " WHERE 1=0";
                    }
                }

                // ====== (X-RAY) ======
                Console.WriteLine("\n=================================");
                Console.WriteLine("EXECUTING SQL: " + sqlQuery);
                Console.WriteLine($"RECEIVED -> Search: '{search}', Exact: {exactMatch}, Column: '{searchColumn}'");
                Console.WriteLine("=================================\n");

                using (SqlCommand command = new SqlCommand(sqlQuery, connection))
                {
                    if (!string.IsNullOrEmpty(search))
                    {
                        if (exactMatch) command.Parameters.AddWithValue("@searchExact", search.Trim());
                        else command.Parameters.AddWithValue("@searchPartial", "%" + search.Trim() + "%");

                        if(decimal.TryParse(search.Trim(), out decimal searchNum)) {
                            command.Parameters.AddWithValue("@searchNumber", searchNum);
                        }
                    }

                    using (SqlDataReader reader = command.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            var row = new Dictionary<string, object>();
                            for (int i = 0; i < reader.FieldCount; i++)
                            {
                                object cellValue = reader.GetValue(i);
                                if (cellValue == DBNull.Value)
                                {
                                    row.Add(reader.GetName(i), null);
                                }
                                else
                                {
                                    row.Add(reader.GetName(i), reader.GetValue(i));
                                }
                            }
                            rows.Add(row);
                        }
                    }
                }
            }
            return Ok(rows);
        }
        
    }
}

