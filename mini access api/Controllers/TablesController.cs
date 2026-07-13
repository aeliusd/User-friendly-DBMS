using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using System.Collections.Generic;
using System.Data;
namespace mini_access_api.Controllers
{
    public class FileUploadRequest
    {
        public IFormFile File { get; set; }
        public string DatabaseName { get; set; }
    }
    public class CellUpdateRequest
    {
        public string TableName { get; set; }
        public string ColumnName { get; set; }
        public string PrimaryKeyName { get; set; }
        public string PrimaryKeyValue { get; set; }
        public string NewValue { get; set; }
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
        private readonly string _connectionstring = "Server=.\\SQLEXPRESS;Database=Northwind;Trusted_Connection=True;TrustServerCertificate=True;";
        [HttpPut("update-cell")]
        public IActionResult UpdateCell([FromBody] CellUpdateRequest request)
        {
            if (!IsValidIdentifier(request.TableName) || !IsValidIdentifier(request.ColumnName))
            {
                return BadRequest(new { error = "Invalid table or column name." });
            }
            // Enforce Rule: Never allow updating the primary key column via inline editing
            if (request.ColumnName.ToLower() == "id" || request.ColumnName.EndsWith("id", System.StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest(new { error = "Primary key columns cannot be modified." });
            }

            // Dynamically construct the query safely using parameterized values for the data
            string query = $@"
                UPDATE [{request.TableName}] 
                SET [{request.ColumnName}] = @Value 
                WHERE [{request.PrimaryKeyName}] = @Id";

            using (SqlConnection conn = new SqlConnection(_connectionstring))
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
            var databaseName = request.DatabaseName;
            if (file == null || file.Length == 0)
            {
                return BadRequest("No file uploaded");
            }
            string tableName = new string(databaseName.Where(c => char.IsLetterOrDigit(c) || c == '_').ToArray());
            if (string.IsNullOrEmpty(tableName))
            {
                tableName = "ImportedData_" + Guid.NewGuid().ToString().Substring(0,5);
            }
            using var stream = new StreamReader(file.OpenReadStream());
            var headerLine = await stream.ReadLineAsync();
            if (string.IsNullOrWhiteSpace(headerLine))
                return BadRequest("CSV file is empty.");
            var headers = headerLine.Split(",")
                                    .Select(h => new string(h.Where(char.IsLetterOrDigit).ToArray()))
                                    .Select((h, i) => string.IsNullOrEmpty(h) ? $"Column{i}" : h)
                                    .ToArray();
            using var connection = new SqlConnection(_connectionstring);
            await connection.OpenAsync();

            var createTableSql = $"CREATE TABLE [{tableName}] (Id INT IDENTITY(1,1) PRIMARY KEY, ";
            createTableSql += string.Join(", ", headers.Select(h => $"[{h}] NVARCHAR(MAX)")) + ")";

            using (var createCmd = new SqlCommand(createTableSql, connection))
            {
                try
                {
                    await createCmd.ExecuteNonQueryAsync();
                }
                catch (SqlException)
                {
                    return BadRequest($"A database workspace named '{tableName}' already exists. Please choose a different name or rename your file.");
                }
            }
            while (!stream.EndOfStream)
            {
                var line = await stream.ReadLineAsync();
                if (string.IsNullOrWhiteSpace(line)) continue;

                var values = line.Split(',');

                // Build the INSERT command safely
                var insertSql = $"INSERT INTO [{tableName}] ({string.Join(", ", headers.Select(h => $"[{h}]"))}) " +
                                $"VALUES ({string.Join(", ", headers.Select((h, i) => $"@p{i}"))})";

                using var insertCmd = new SqlCommand(insertSql, connection);

                // Map the values to the parameters
                for (int i = 0; i < headers.Length; i++)
                {
                    string val = i < values.Length ? values[i].Trim() : ""; // Handle missing data gracefully
                    insertCmd.Parameters.AddWithValue($"@p{i}", val);
                }

                await insertCmd.ExecuteNonQueryAsync();
            }

            return Ok($"Database workspace '{tableName}' successfully generated and populated!");
        }
        [HttpGet("workspaces")]
        public IActionResult GetWorkspaces()
        {
            List<string> workspaces = new List<string>();

            // Find all tables that are NOT part of the standard Northwind schema
            string query = @"
        SELECT TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_TYPE = 'BASE TABLE' 
        AND TABLE_NAME NOT IN (
            'Categories', 'CustomerCustomerDemo', 'CustomerDemographics', 'Customers', 
            'Employees', 'EmployeeTerritories', 'Order Details', 'Orders', 
            'Products', 'Region', 'Shippers', 'Suppliers', 'Territories'
        ) AND TABLE_NAME NOT LIKE 'sys%'";

            using (SqlConnection connection = new SqlConnection(_connectionstring))
            {
                connection.Open();
                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    using (SqlDataReader reader = command.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            workspaces.Add(reader.GetString(0));
                        }
                    }
                }
            }
            return Ok(workspaces);
        }
        [HttpGet("list")]
        public IActionResult GetTables([FromQuery] string workspace = "Northwind")
        {
            string query = "";
            if (workspace == "Northwind")
            {
                query = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' " +
                        "AND TABLE_NAME IN ('Categories', 'CustomerCustomerDemo', 'CustomerDemographics', 'Customers', " +
                        "'Employees', 'EmployeeTerritories', 'Order Details', 'Orders', 'Products', 'Region', 'Shippers', 'Suppliers', 'Territories')";
            }
            else
            {
                query = $"SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '{workspace}'";
            }
            List<string> tables = new List<string>();
            using (SqlConnection connection = new SqlConnection(_connectionstring))
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
        [HttpGet("{tableName}")]
        public IActionResult GetTableData(string tableName, [FromQuery] string search = "", [FromQuery] bool exactMatch = false, [FromQuery] string searchColumn = "ALL")
        {
            var rows = new List<Dictionary<string, object>>();

            using (SqlConnection connection = new SqlConnection(_connectionstring))
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

