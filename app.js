const apiURL = 'https://localhost:7162/api/tables';
let currentColumns = [];
let ActiveTableName = '';

let globalTableData = []; // Store the fetched data globally
let currentSortColumn = '';
let sortAscending = true;
// pagination variables
let currentPage = 1;
const rowsPerPage = 15;

let currentDatabase = 'Northwind'; // Default database
let undoStack = [];
let redoStack = [];

let hiddenColumns = [];
function hideColumn(columnName) {
    if (!hiddenColumns.includes(columnName)) {
        hiddenColumns.push(columnName);
        renderTable();
    }
}

function showColumn(columnName) {
    hiddenColumns = hiddenColumns.filter(col => col !== columnName);
    renderTable();
}
async function selectDatabase(dbName, clickedButton) {
    currentDatabase = dbName;
    
    document.querySelectorAll('.db-btn').forEach(btn => btn.classList.remove('active'));
    if (clickedButton) clickedButton.classList.add('active');

    document.getElementById('current-db-title').innerText = `${dbName} Workspace`;
    document.getElementById('dashboard-view').classList.add('hidden');
    document.getElementById('data-view').classList.remove('hidden');

    await loadTablesForWorkspace(dbName);
}

async function handleCSVUpload() {
    if (!currentDatabase) {
        alert("Please select a database from the sidebar first.");
        return;
    }

    const fileInput = document.getElementById('csvFile');
    if (fileInput.files.length === 0) {
        alert('Please select a CSV file to import first.');
        return;
    }
    const tableName = prompt("What should we name this new table?");
    if (!tableName) {
        fileInput.value = ""; // clear the input if they cancel
        return; 
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('DatabaseName', currentDatabase); 
    formData.append('TableName', tableName);

    try {
        const response = await fetch(`${apiURL}/upload`, {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            alert(`Table '${tableName}' imported successfully!`);
            fileInput.value = "";
            loadTablesForWorkspace(currentDatabase); // Refresh the dropdown
        } else {
            const errorText = await response.text();
            alert(`Upload failed:  ${errorText}`);
        }
    }
    catch (error) {
        console.error("Error transmitting file:", error);
        alert("An error occurred while transmitting the file.");
    }


}
//Export to CSV function
async function exportToCSV(exportType) {
    if(!ActiveTableName) {
        alert("Please select a table first!");
        return;
    }
    let dataToExport = [];
    let fileName = "";
    if(exportType === 'filtered')
    {
        if(!globalTableData || globalTableData.length === 0)
        {
            alert("No data currently available to export");
            return;
        }
        dataToExport = globalTableData;
        fileName = `${ActiveTableName}_Filtered.csv`;
    }
    else if(exportType === 'full') {
        try {
            const response = await fetch(`${apiURL}/${ActiveTableName}`);
            if(!response.ok) throw new Error("Failed to fetch full table");
            dataToExport = await response.json();
            fileName = `${ActiveTableName}_Full_Table.csv`;
        }
        catch(err) {
            console.error(err);
            alert ("Could not load the full table for export");
            return;
        }

    }
    if(dataToExport.length === 0) return;
    let rawColumns = Object.keys(dataToExport[0]);
    const exportColumns = rawColumns.filter(col => col.toLowerCase() !== 'isdeleted');

    const activeData = dataToExport.filter(row => {
        if (row['IsDeleted'] === 1 || row['IsDeleted'] === true) return false;
        if (row['isdeleted'] === 1 || row['isdeleted'] === true) return false; 
        return true; 
    });

    if (activeData.length === 0) {
        alert("No active data to export!");
        return;
    }
    let csvContent = exportColumns.join(",") + "\n";

    activeData.forEach(row => {
        let rowData= exportColumns.map(col=> {
            let cell = row[col] === null ? '' : String(row[col]);
            cell = cell.replace(/"/g, '""'); // Escape quotes
            return `"${cell}"`;              // Wrap in quotes
        });
        csvContent +=rowData.join(',') + "\n";
    });
    const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function promptCreateDatabase() {
    const dbName = prompt("Enter new database name (alphanumeric and underscores only):");
    if (!dbName) return;
    
    try {
        const response = await fetch(`${apiURL}/create-database?dbName=${dbName}`, { method: 'POST' });
        if (response.ok) {
            alert(`Database '${dbName}' created successfully!`);
            loadWorkspacesOnBoot(); // Refresh the sidebar to show the new DB
        } else {
            const err = await response.json();
            alert(err.error);
        }
    } catch (e) {
        console.error("Network error:", e);
    }
}
async function promptCreateEmptyTable() {
    if (!currentDatabase) {
        alert("Please select a database from the sidebar first!");
        return;
    }
    const tableName = prompt("Enter new table name (alphanumeric and underscores only):");
    if (!tableName) return;
    
    try {
        const response = await fetch(`${apiURL}/create-table?dbName=${currentDatabase}&tableName=${tableName}`, { method: 'POST' });
        if (response.ok) {
            alert(`Table '${tableName}' created successfully!`);
            loadTablesForWorkspace(currentDatabase); // Refresh the dropdown to show the new table
        } else {
            const err = await response.json();
            alert(err.error);
        }
    } catch (e) {
        console.error("Network error:", e);
    }
}

async function loadTablesForWorkspace(dbName) {
    try {
        const response = await fetch(`${apiURL}/list?dbName=${dbName}`);
        if (!response.ok) throw new Error("Failed to fetch workspace tables.");
        
        const tables = await response.json();
        
        // Grab your existing HTML <select> dropdown element for tables
        const tableSelect = document.getElementById('tableSelect'); // Make sure this ID matches your HTML drop-down!
        tableSelect.innerHTML = '<option value="">-- Select a Table --</option>';
        tables.forEach(table => {
            const option = document.createElement('option');
            option.value = table;
            option.textContent = table;
            tableSelect.appendChild(option);
        });

        // 1. Clear the visual data grid
        const container = document.getElementById('data-container');
        if (container) {
            container.innerHTML = '<p style="color: gray;">Select a table from the dropdown above to view data.</p>';
        }

        // 2. Wipes the global memory so it forgets the old table
        ActiveTableName = '';
        globalTableData = [];
        currentColumns = [];

        // 3. Resets the search controls
        document.getElementById('search-box').value = '';
        document.getElementById('exact-match-checkbox').checked = false;
        document.getElementById('column-dropdown').innerHTML = '<option value="ALL">All Columns</option>';
    }
    catch(err) {
        console.error("Error loading workspace:", err);
        alert(`Could not load tables for workspace: ${dbName}`);
    }
}


// Load data for a specific table, optionally with search parameters
async function loadTableData(tableName, searchQuery = '', isExactMatch = false, searchColumn = 'ALL') {
    if(ActiveTableName !== tableName) {
        currentSortColumn = '';
    }
    ActiveTableName = tableName;
    const container = document.getElementById('data-container');
    const controlPanel = document.getElementById('control-panel');

    container.innerHTML = `Loading data for table ${tableName}...`;
    try {
        let fetchUrl = `${apiURL}/${tableName}?dbName=${currentDatabase}`;
        if (searchQuery !== '') {
            
            fetchUrl += `&search=${encodeURIComponent(searchQuery)}&exactMatch=${isExactMatch}&searchColumn=${encodeURIComponent(searchColumn)}`;
        }

        const response = await fetch(fetchUrl);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server responded with: ${errorText}`);
        }
        const rows = await response.json();

        controlPanel.style.display = 'block';

        if(rows.length === 0) {
            try {
                const schemaResponse = await fetch(`${apiURL}/${tableName}/schema?dbName=${currentDatabase}`);
                if (schemaResponse.ok) {
                    const schema = await schemaResponse.json();
                    currentColumns = schema.map(col => col.ColumnName);
                } else {
                    currentColumns = ['Id']; // Fallback emergency column
                }
            } catch (schemaErr) {
                currentColumns = ['Id'];
            }
            
            globalTableData = []; 
            populateDropdown();
            renderTable(); // This draws the headers and your "Add Column" buttons!
            return;
        }

        currentColumns = Object.keys(rows[0]);
        populateDropdown();

        globalTableData = rows; // Store the fetched data globally
        currentPage = 1; // Reset to the first page whenever new data is loaded
        if(currentSortColumn != '') {
            applyCurrentSort(); // Reapply the current sort if a column was previously sorted
        } else {
            renderTable();
        }
    }
    catch (error) {
        console.error(`Error fetching data for table ${tableName}:`, error);
        container.innerHTML = '<p> Error fetching table data</p>';
    }
}
// Populate the dropdown with current columns and maintain the previous selection if possible
function populateDropdown() {
    const dropdown = document.getElementById('column-dropdown');
    const currentSelection = dropdown.value; 
    
    dropdown.innerHTML = '<option value="ALL">All Columns</option>';
    
    currentColumns.forEach(col => {
        const option = document.createElement('option');
        option.value = col;
        option.textContent = col;
        dropdown.appendChild(option);
    });

    if (currentColumns.includes(currentSelection)) {
        dropdown.value = currentSelection;
    }
}
// Execute search based on user input
function executeSearch() {
    if (ActiveTableName === '') {
        alert("Please select a table from the sidebar first!");
        return;
    }
    const text = document.getElementById('search-box').value;
    const isExact = document.getElementById('exact-match-checkbox').checked;
    const column = document.getElementById('column-dropdown').value; // Grab dropdown value
    loadTableData(ActiveTableName, text, isExact, column);
}

// Clear search input, uncheck the checkbox, reset dropdown, and reload table data
function clearSearch() {
    document.getElementById('search-box').value = '';
    document.getElementById('exact-match-checkbox').checked = false; // Uncheck the box
    document.getElementById('column-dropdown').value = 'ALL';
    loadTableData(ActiveTableName, '', false, 'ALL');
}

// Redraw the table based on the current globalTableData and currentColumns
function renderTable() {
    const container = document.getElementById('data-container');
    let html = '<table border="1" cellpadding="5" cellspacing="0"><tr>';
    const pkColumnName = currentColumns[0];
    const visibleColumns = currentColumns.filter(col => !hiddenColumns.includes(col));

    visibleColumns.forEach(column => {
        let arrow = '';
        if (column === currentSortColumn) {
            arrow = sortAscending ? ' ▲' : ' ▼';
        }

        if (column === pkColumnName) {
            html += `<th style="cursor: pointer; background-color: #f2f2f2;" onclick="sortTable('${column}')">
                        ${column}${arrow} <br><span style="font-size: 11px; font-weight: normal;">(PK)</span>
                     </th>`;
        } else {
            // Added the subtle (hide) text link next to the Delete button
            html += `<th style="cursor: pointer; background-color: #f2f2f2;" onclick="sortTable('${column}')">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span>${column}${arrow}</span>
                            <div>
                                <button onclick="event.stopPropagation(); hideColumn('${column}')" title="Hide Column" style="color: #6c757d; background: none; border: none; cursor: pointer; font-size: 12px; margin-left: 10px; padding: 0;">(hide)</button>
                                <button onclick="event.stopPropagation(); promptDeleteColumn('${column}')" title="Delete Column" style="color: #dc3545; background: none; border: none; cursor: pointer; font-size: 14px; font-weight: bold; margin-left: 5px;">✖</button>
                            </div>
                        </div>
                     </th>`;
        }
    });

    html += '<th style="background-color: #f2f2f2; text-align: center;">Actions</th>';
    html += '</tr>';

    const totalPages = Math.ceil(globalTableData.length / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const paginatedRows = globalTableData.slice(startIndex, endIndex);

    paginatedRows.forEach(row => {
        html += '<tr>';

        visibleColumns.forEach(column => {
            let cellData = row[column] !== null ? row[column] : '';
            let cellStr = cellData.toString().trim();
            let isBase64Image = cellStr.startsWith('/9j/') || 
                            cellStr.startsWith('iVBORw') || 
                            cellStr.startsWith('R0lGOD') ||
                            cellStr.startsWith('FRwv');

            if (isBase64Image) {
            let mimeType = 'image/jpeg';
            let finalBase64Data = cellStr; // Default

            if (cellStr.startsWith('iVBORw')) mimeType = 'image/png';
            else if (cellStr.startsWith('R0lGOD')) mimeType = 'image/gif';
            else if (cellStr.startsWith('FRwv')) {
                // It's a Northwind Image! 
                mimeType = 'image/bmp';
                // Slices off the 78-byte OLE header (104 Base64 chars) to reveal the real image
                finalBase64Data = cellStr.substring(104); 
            }

            // Render it using the cleaned-up data!
            cellData = `<img src="data:${mimeType};base64,${finalBase64Data}" style="max-height: 50px; border-radius: 4px;" alt="Image" />`;
        } else if (typeof cellData === 'string' && cellData.includes('#')) {
            let parts = cellData.split('#');

            if (parts.length >= 3) {
                let displayText = parts[0].trim();
                let url = parts[1].trim();
                let urlLower = url.toLowerCase();

                // SAFETY CHECK: The middle part has to actually be a web address!
                let isRealUrl = urlLower.startsWith('http') || 
                                urlLower.startsWith('www') || 
                                urlLower.startsWith('mailto:');

                if (isRealUrl) {
                    if (displayText === '') displayText = url;

                    // Safety net: if it starts with www, force http:// so the browser doesn't get confused
                    let finalUrl = urlLower.startsWith('www') ? 'http://' + url : url;

                    cellData = `<a href="${finalUrl}" target="_blank" style="color: #007bff; text-decoration: underline;">${displayText}</a>`;
                }
            }
        } else {
            const urlRegex = /(https?:\/\/[^\s]+)/g;

            if (typeof cellData === 'string' && urlRegex.test(cellData)) {
                // Split the sentence from the URL
                const parts = cellData.split(urlRegex);
                const sentence = parts[0]; // The text before the URL
                const url = parts[1];      // The URL itself
                
                // Create a clean link where the sentence is the display text
                cellData = `<a href="${url}" target="_blank" style="color: #007bff; text-decoration: none;">${sentence}</a>`;
            }  
                // Safety net for actual long text (like the Notes column!)
            else if (typeof cellData === 'string' && cellData.length > 100) {
                // 1. Make the text safe so random < or > characters don't break the table HTML
                let safeText = cellData.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                let shortText = safeText.substring(0, 80) + '...';
                
                // 2. Create a toggleable HTML block
                cellData = `
                    <div>
                        <span style="display: inline;">
                            ${shortText} 
                            <a href="javascript:void(0);" 
                            onclick="this.parentElement.style.display='none'; this.parentElement.nextElementSibling.style.display='inline';" 
                            style="color: #007bff; text-decoration: none; font-weight: bold;">(more)</a>
                        </span>
                        <span style="display: none;">
                            ${safeText} 
                            <a href="javascript:void(0);" 
                            onclick="this.parentElement.style.display='none'; this.parentElement.previousElementSibling.style.display='inline';" 
                            style="color: #007bff; text-decoration: none; font-weight: bold;">(less)</a>
                        </span>
                    </div>
                `;
            }
        }
        const pkColumnName = currentColumns[0];
        const isPrimaryKey = column.toLowerCase() === 'id' ||column === pkColumnName;
        let rawValue = row[column] !== null ? row[column].toString() : '';
        // Escapes backslashes, JS single quotes, HTML double quotes, and newlines
        let escapedRaw = rawValue
            .replace(/\\/g, "\\\\")  
            .replace(/'/g, "\\'")    
            .replace(/"/g, "&quot;") 
            .replace(/\n/g, "\\n")   
            .replace(/\r/g, "");
        if (!isPrimaryKey) {
                // Adds a pointer cursor and the double-click event, passing 'this' (the TD element) and the raw data
                html += `<td style="cursor: pointer;" ondblclick="makeCellEditable(this, '${ActiveTableName}', '${column}', '${pkColumnName}', '${row[pkColumnName]}', '${escapedRaw}')">${cellData}</td>`;
            } else {
                html += `<td>${cellData}</td>`;
            }   
        });

        html += `<td style="text-align: center;">
            <button onclick="deleteRow('${row[pkColumnName]}', '${pkColumnName}')" title="Delete Row" style="cursor:pointer; background:none; border:none; font-size:1.2rem; transition: transform 0.1s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">🗑️</button>
        </td>`;
        html += '</tr>';
    });
    html += '</table>';

    // pagination control
    if (totalPages > 1) {
        html += `
        <div style="margin-top: 15px; display: flex; align-items: center; gap: 15px; font-family: sans-serif;">
        <button onclick="changePage(-1)" ${currentPage === 1 ? 'disabled' : ''} style="padding: 5px 15px; cursor: pointer;">Previous</button>
        <span style="font-weight: bold;">Page ${currentPage} of ${totalPages}</span>
        <button onclick="changePage(1)" ${currentPage === totalPages ? 'disabled' : ''} style="padding: 5px 15px; cursor: pointer;">Next</button>
        </div>
        `;
    }
    //hidden dropdown
    let hiddenDropdownHtml = '';
    if (hiddenColumns.length > 0) {
        let hiddenItems = hiddenColumns.map(col => 
            `<div onclick="showColumn('${col}')" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; font-size: 13px;" onmouseover="this.style.backgroundColor='#f8f9fa'" onmouseout="this.style.backgroundColor='white'">
                <span>${col}</span> <span style="font-size: 12px; color: #28a745; margin-left: 10px;">➕</span>
            </div>`
        ).join('');

        hiddenDropdownHtml = `
            <div style="position: relative; display: inline-block; margin-right: 10px;">
                <button onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'" style="padding: 8px 15px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; transition: background 0.2s;" onmouseover="this.style.backgroundColor='#5a6268'" onmouseout="this.style.backgroundColor='#6c757d'">
                    Hidden (${hiddenColumns.length}) ▼
                </button>
                <div style="display: none; position: absolute; right: 0; top: 100%; margin-top: 5px; background-color: white; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; min-width: 150px; text-align: left;">
                    ${hiddenItems}
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h2>Data for: ${ActiveTableName} <span style="font-size: 14px; color: gray; font-weight: normal;">(${globalTableData.length} total records)</span></h2>
            <div style="display: flex; align-items: center;">
                ${hiddenDropdownHtml}
                <button onclick="showAddColumnModal()" style="margin-right: 10px; padding: 8px 15px; background-color: #f8f9fa; color: #333; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; font-weight: bold; transition: background 0.2s;" onmouseover="this.style.backgroundColor='#e2e6ea'" onmouseout="this.style.backgroundColor='#f8f9fa'">
                    ⚙️ Add Column
                </button>
                <button onclick="showAddRowModal()" style="padding: 8px 15px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; transition: background 0.2s;" onmouseover="this.style.backgroundColor='#218838'" onmouseout="this.style.backgroundColor='#28a745'">
                    + Add Row
                </button>
            </div>
        </div>
    ` + html;
}
// Sort table data based on the clicked column
function sortTable(column) {
    if(currentSortColumn === column) {
        sortAscending = !sortAscending; // Toggle sort order
    } else {
        currentSortColumn = column;
        sortAscending = true; // Default to ascending when a new column is selected
    }
    currentPage = 1; // Reset to the first page whenever a new sort is applied
    applyCurrentSort();
    globalTableData.sort((a, b) => {
        let valA = a[column] !== null ? a[column] : '';
        let valB = b[column] !== null ? b[column] : '';
        let numA = Number(valA);
        let numB = Number(valB);
        let isNumeric = !isNaN(numA) && !isNaN(numB) && valA !== '' && valB !== '';
        if (isNumeric) {
            return sortAscending ? numA - numB : numB - numA;
        } else {
            let strA = valA.toString().toLowerCase();
            let strB = valB.toString().toLowerCase();
            if (strA < strB) return sortAscending ? -1 : 1;
            if (strA > strB) return sortAscending ? 1 : -1;
            return 0;
        }
    });
    renderTable();
}
function applyCurrentSort() {
    globalTableData.sort((a, b) => {
        let valA = a[currentSortColumn] !== null ? a[currentSortColumn] : '';
        let valB = b[currentSortColumn] !== null ? b[currentSortColumn] : '';
        
        let numA = Number(valA);
        let numB = Number(valB);
        let isNumeric = !isNaN(numA) && !isNaN(numB) && valA !== '' && valB !== '';
        
        if (isNumeric) {
            return sortAscending ? numA - numB : numB - numA;
        } else {
            let strA = valA.toString().toLowerCase();
            let strB = valB.toString().toLowerCase();
            if (strA < strB) return sortAscending ? -1 : 1;
            if (strA > strB) return sortAscending ? 1 : -1;
            return 0;
        }
    });
    renderTable();
}
function changePage(direction) {
    currentPage += direction;
    renderTable();
}

// Inline helper functions
function makeCellEditable(td, tableName, columnName, pkName, pkValue, originalValue) {
    if (td.querySelector('input')) return;
    let inputType = 'text';
    if (!isNaN(originalValue) && originalValue !== '') inputType = "number";
    
    // Create the input element
    const input = document.createElement('input');
    input.type = inputType;
    input.value = originalValue;
    input.style.width = "100%";
    input.style.boxSizing = "border-box";

    // Clear the current cell content (including links/images) and insert the input
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();

    // Save changes on Enter key, cancel on Escape key
    input.onkeydown = async function(e) {
        if (e.key === 'Enter') {
            const newValue = input.value;
            if (newValue === originalValue) {
                // No change made, just reload table to restore original formatting
                renderTable(); 
                return;
            }
            
            await saveCellUpdate(tableName, columnName, pkName, pkValue, newValue, td, originalValue);
        } else if (e.key === 'Escape') {
             // Cancel editing, reload table to restore original formatting
            renderTable();
        }
    };
    // Revert back if user clicks outside the input box without pressing enter
    input.onblur = function() {
        renderTable(); 
    };
}
async function saveCellUpdate(tableName, columnName, pkName, pkValue, newValue, td, originalValue) {
    try {
        const response = await fetch(`${apiURL}/update-cell`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                DatabaseName: currentDatabase,
                TableName: tableName,
                ColumnName: columnName,
                PrimaryKeyName: pkName,
                PrimaryKeyValue: String(pkValue),
                NewValue: newValue
            })
        });

        const result = await response.json();

        if (response.ok) {
            // Update the global data array so the change persists on pagination/sorting
            const rowToUpdate = globalTableData.find(r => String(r[pkName]) === String(pkValue));
            if (rowToUpdate) {
                const originalValue = rowToUpdate[columnName];
                redoStack = [];
                undoStack.push({
                    action: "EDIT",
                    tableName: ActiveTableName,
                    columnName: columnName,
                    pkName: pkName,
                    rowId: pkValue,
                    oldValue: originalValue,
                    newValue: newValue
                });

                rowToUpdate[columnName] = newValue;
            }
            // Re-render to apply the normal HTML formatting (links, truncation, etc)
            renderTable();
        } else {
            // Display database errors (like unique constraint or data type mismatch)
            alert(result.error || "An error occurred while saving.");
            renderTable(); 
        }
    } catch (err) {
        console.error("Update error:", err);
        alert("Failed to communicate with the server.");
        renderTable();
    }
}
async function deleteRow(pkValue, pkName) {
    const rowToDelete = globalTableData.find(r => String(r[pkName]) === String(pkValue));
    if (!rowToDelete) return;
    const clonedRowData = { ...rowToDelete};
    try {
        const response = await fetch(`${apiURL}/${ActiveTableName}/row`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                DatabaseName: currentDatabase,
                PrimaryKeyName: pkName,
                PrimaryKeyValue: String(pkValue)
            })
        });

        if (response.ok) {
            // Push the DELETE action to the undo stack
            redoStack = [];
            undoStack.push({
                action: "DELETE",
                tableName: ActiveTableName,
                rowData: clonedRowData, // We save the whole row data to insert it back later!
                pkName: pkName,
                rowId: pkValue
            });

            // Remove it from our local RAM
            globalTableData = globalTableData.filter(r => String(r[pkName]) !== String(pkValue));
            renderTable();
        } else {
            console.error("Failed to delete row from database.");
        }
    } catch (err) {
        console.error("Error executing delete:", err);
    }
}

async function showAddRowModal() {
    if (!currentColumns || currentColumns.length === 0) return;

    const pkName = currentColumns[0];
    let schemaData = [];

    // Fetch the database rules before drawing the form
    try {
        const response = await fetch(`${apiURL}/${ActiveTableName}/schema?dbName=${currentDatabase}`);
        if (response.ok) {
            schemaData = await response.json();
        }
    } catch (err) {
        console.warn("Could not load schema, defaulting to text inputs.");
    }

    // Create the background and modal
    const overlay = document.createElement('div');
    overlay.id = 'addRowOverlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 1000;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; padding: 20px; border-radius: 8px; width: 400px; max-height: 80vh; overflow-y: auto; font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.2);';

    let formHtml = `<h3 style="margin-top: 0; border-bottom: 1px solid #eee; padding-bottom: 10px;">Add New Row: ${ActiveTableName}</h3>`;
    formHtml += `<div id="formErrors" style="color: red; margin-bottom: 10px; font-size: 14px; font-weight: bold;"></div>`;

    // Dynamically generate inputs based on Schema Rules
    currentColumns.forEach(col => {
        if (col !== pkName) {
            
            // Find the rules for this specific column
            const colSchema = schemaData.find(s => s.ColumnName === col);
            
            let isRequired = false;
            let htmlInputType = "text"; 
            let stepAttribute = ""; // Used to allow decimals in number fields

            if (colSchema) {
                // Check if it needs a red star
                isRequired = colSchema.IsNullable === "NO";

                // Translate SQL types to HTML5 input types
                const sqlDataType = colSchema.DataType.toLowerCase();
                
                if (['int', 'bigint', 'smallint', 'tinyint'].includes(sqlDataType)) {
                    htmlInputType = "number";
                } 
                else if (['decimal', 'numeric', 'money', 'float', 'real'].includes(sqlDataType)) {
                    htmlInputType = "number";
                    stepAttribute = 'step="any"'; // Allows decimals
                }
                else if (['date', 'datetime', 'datetime2'].includes(sqlDataType)) {
                    htmlInputType = "datetime-local";
                }
                else if (sqlDataType === 'bit') {
                    htmlInputType = "checkbox"; // True/False!
                }
            }

            // Draw the Label (with the red star if required)
            const requiredStar = isRequired ? `<span style="color: red; margin-left: 3px;">*</span>` : '';
            formHtml += `<div style="margin-bottom: 15px;">
                            <label style="display: block; font-weight: bold; margin-bottom: 5px; font-size: 14px;">${col}${requiredStar}</label>`;
            
            // Draw the Input box
            if (htmlInputType === "checkbox") {
                formHtml += `<input type="checkbox" id="input_${col}" style="transform: scale(1.5); margin-left: 5px;" />`;
            } else {
                formHtml += `<input type="${htmlInputType}" ${stepAttribute} id="input_${col}" placeholder="Enter ${col}..." style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />`;
            }
            
            formHtml += `</div>`;
        }
    });

    formHtml += `
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 15px;">
            <button onclick="document.getElementById('addRowOverlay').remove()" style="padding: 8px 15px; cursor: pointer; background: #f8f9fa; border: 1px solid #ccc; border-radius: 4px;">Cancel</button>
            <button onclick="submitNewRow()" style="padding: 8px 15px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Save Row</button>
        </div>
    `;

    modal.innerHTML = formHtml;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

async function submitNewRow() {
    const pkName = currentColumns[0];
    const backendPayload = {}; 
    const uiMemoryRow = {};

    // Gather all the text the user typed into the form
    currentColumns.forEach(col => {
        if (col !== pkName) {
            const inputEl = document.getElementById(`input_${col}`);
            if (inputEl) {
                let val = "";
                // If it's a checkbox, grab True/False. Otherwise, grab the text.
                if (inputEl.type === "checkbox") {
                    val = inputEl.checked ? "1" : "0";
                } else {
                    val = inputEl.value.trim();
                }
                uiMemoryRow[col] = val;
                if (val !== "") {
                    backendPayload[col] = val;
                } 
            }
        }
    });

    try {
        const response = await fetch(`${apiURL}/${ActiveTableName}/add-new-row?pkName=${pkName}&dbName=${currentDatabase}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(backendPayload) 
        });

        if (response.ok) {
            const data = await response.json();
            
            // Add the new ID to our Full UI object
            uiMemoryRow[pkName] = data.newId;

            // Push the Full object into the browser's memory
            globalTableData.push(uiMemoryRow);
            
            // Push to the Undo Stack (so Redo knows all the column names)
            redoStack = [];
            undoStack.push({
                action: "CREATE",
                tableName: ActiveTableName,
                pkName: pkName,
                rowId: data.newId,
                rowData: uiMemoryRow 
            });

            // Draw the table and destroy the popup
            renderTable(); 
            document.getElementById('addRowOverlay').remove();
            
        } else {
            const errorData = await response.json(); 
            document.getElementById('formErrors').innerText = `Database Error: ${errorData.error}`;
        }
    } catch (err) {
        document.getElementById('formErrors').innerText = `Network Error: ${err.message}`;
    }   
}


//Command pattern undo
async function undoLastAction() {
    if (undoStack.length === 0) {
        console.log("Nothing to undo!");
        return;
    }

    const lastAction = undoStack.pop();
    console.log("Undoing action:", lastAction);

    if (lastAction.action === "EDIT") {
        try {
            // BULLETPROOF: Hardcoded the exact C# API url
            const response = await fetch(`${apiURL}/update-cell`, { 
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    DatabaseName: currentDatabase,
                    TableName: lastAction.tableName,
                    ColumnName: lastAction.columnName,
                    PrimaryKeyName: lastAction.pkName,
                    PrimaryKeyValue: String(lastAction.rowId),
                    NewValue: lastAction.oldValue !== null ? String(lastAction.oldValue) : "" 
                })
            });

            if (response.ok) {
                const row = globalTableData.find(r => String(r[lastAction.pkName]) === String(lastAction.rowId));
                if (row) {
                    row[lastAction.columnName] = lastAction.oldValue;
                }
                redoStack.push(lastAction);
                renderTable();
            } else {
                console.error("Failed to undo edit. Status:", response.status);
            }
        } catch (err) {
            console.error("Failed to undo edit:", err);
        }
    } 
    else if (lastAction.action === "DELETE") {
        try {
            const response = await fetch(`${apiURL}/${lastAction.tableName}/row?dbName=${currentDatabase}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(lastAction.rowData) 
            });

            if (response.ok) {
                globalTableData.push(lastAction.rowData);
                
                const pk = lastAction.pkName;
                globalTableData.sort((a, b) => {
                    return isNaN(a[pk]) ? String(a[pk]).localeCompare(String(b[pk])) : Number(a[pk]) - Number(b[pk]);
                });
                redoStack.push(lastAction);
                renderTable();
            } else {
                // Read the exact error message from C#
                const errorData = await response.json(); 
                console.error("Failed to undo delete. Status:", response.status, "Message:", errorData);
            }
        } catch (err) {
            console.error("Failed to undo delete:", err);
        }
    } else if(lastAction.action === "CREATE") {
        try {
            const response = await fetch(`${apiURL}/${lastAction.tableName}/row`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    DatabaseName: currentDatabase,
                    PrimaryKeyName: lastAction.pkName,
                    PrimaryKeyValue: String(lastAction.rowId)
                })
            });

            if (response.ok) {
                // Wipe it from the browser's memory and refresh the screen
                globalTableData = globalTableData.filter(r => String(r[lastAction.pkName]) !== String(lastAction.rowId));
                renderTable();
                redoStack.push(lastAction);
            } else {
                console.error("Failed to undo create. Status:", response.status);
            }
        } catch (err) {
            console.error("Failed to undo create:", err);
        }
    }
}

//command pattern redo
async function redoLastAction() {
    if (redoStack.length === 0) {
        console.log("Nothing to redo!");
        return;
    }

    const lastAction = redoStack.pop();
    console.log("Redoing action:", lastAction);

    if (lastAction.action === "EDIT") {
        try {
            // REDO an edit by pushing the NEW value back to the database
            const response = await fetch(`${apiURL}/update-cell`, { 
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    DatabaseName: currentDatabase,
                    TableName: lastAction.tableName,
                    ColumnName: lastAction.columnName,
                    PrimaryKeyName: lastAction.pkName,
                    PrimaryKeyValue: String(lastAction.rowId),
                    NewValue: lastAction.newValue !== null ? String(lastAction.newValue) : "" // Use the NEW value here!
                })
            });

            if (response.ok) {
                const row = globalTableData.find(r => String(r[lastAction.pkName]) === String(lastAction.rowId));
                if (row) {
                    row[lastAction.columnName] = lastAction.newValue;
                }
                undoStack.push(lastAction); // Put it back in the Undo stack!
                renderTable();
            }
        } catch (err) { console.error("Failed to redo edit:", err); }
    } 
    else if (lastAction.action === "DELETE") {
        try {
            // REDO a delete by deleting it again
            const response = await fetch(`${apiURL}/${lastAction.tableName}/row`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    DatabaseName: currentDatabase,
                    PrimaryKeyName: lastAction.pkName,
                    PrimaryKeyValue: String(lastAction.rowId)
                })
            });

            if (response.ok) {
                globalTableData = globalTableData.filter(r => String(r[lastAction.pkName]) !== String(lastAction.rowId));
                undoStack.push(lastAction); // Put it back in the Undo stack!
                renderTable();
            }
        } catch (err) { console.error("Failed to redo delete:", err); }
    }
    else if (lastAction.action === "CREATE") {
        try {
            // REDO a create by inserting it back into the database.
            const response = await fetch(`${apiURL}/${lastAction.tableName}/row?dbName=${currentDatabase}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(lastAction.rowData) 
            });

            if (response.ok) {
                globalTableData.push(lastAction.rowData);
                const pk = lastAction.pkName;
                globalTableData.sort((a, b) => {
                    return isNaN(a[pk]) ? String(a[pk]).localeCompare(String(b[pk])) : Number(a[pk]) - Number(b[pk]);
                });
                
                undoStack.push(lastAction); // Put it back in the Undo stack!
                renderTable();
            }
        } catch (err) { console.error("Failed to redo create:", err); }
    }
}

//Warning modal for deleting a column
function promptDeleteColumn(columnName)
{
    const overlay = document.createElement('div');
    overlay.id = 'deleteColOverlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1000;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; padding: 25px; border-radius: 8px; width: 450px; font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.3); border-top: 5px solid #dc3545;';

    modal.innerHTML = `
        <h3 style="margin-top: 0; color: #dc3545;">Delete Column: ${columnName}</h3>
        <p style="font-size: 14px; color: #333;">This action <b>cannot be undone</b>. This will permanently delete the column and all data stored within it.</p>
        <p style="font-size: 14px; color: #333;">Please type <strong>${columnName}</strong> to confirm.</p>
        
        <input type="text" id="confirmColName" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; margin-bottom: 15px;" autocomplete="off" />
        <div id="colDeleteErrors" style="color: red; margin-bottom: 10px; font-size: 13px; font-weight: bold; line-height: 1.4;"></div>
        
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
            <button onclick="document.getElementById('deleteColOverlay').remove()" style="padding: 8px 15px; cursor: pointer; background: #f8f9fa; border: 1px solid #ccc; border-radius: 4px;">Cancel</button>
            <button onclick="executeColumnDelete('${columnName}')" style="padding: 8px 15px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">I understand, delete this column</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}
// api call to delete a column
async function executeColumnDelete(columnName) {
    const inputEl = document.getElementById('confirmColName');
    if (inputEl.value !== columnName) {
        document.getElementById('colDeleteErrors').innerText = "Column name does not match.";
        return;
    }
    try {
        const response = await fetch(`${apiURL}/${ActiveTableName}/column/${columnName}?dbName=${currentDatabase}`, {
            method: 'DELETE'
        });
        if(response.ok) {
            undoStack = [];
            redoStack = [];

            currentColumns = currentColumns.filter(c => c !== columnName);
            globalTableData.forEach(row => delete row[columnName]);
            
            document.getElementById('deleteColOverlay').remove();
            renderTable();
        } else {
            const errorData = await response.json();
            document.getElementById('colDeleteErrors').innerText = errorData.error;
        }
    } catch(err) {
        document.getElementById('colDeleteErrors').innerText = `Network Error: ${err.message}`;
    }
}
// Add column modal
function showAddColumnModal() {
    const overlay = document.createElement('div');
    overlay.id = 'addColOverlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1000;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; padding: 25px; border-radius: 8px; width: 400px; font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.3); border-top: 5px solid #28a745;';

    modal.innerHTML = `
        <h3 style="margin-top: 0; color: #28a745;">Add New Column</h3>
        
        <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold; font-size: 14px;">Column Name:</label>
            <input type="text" id="newColName" placeholder="e.g., DiscountCode" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" autocomplete="off" />
            <small style="color: gray; font-size: 11px;">Spaces will be converted to underscores.</small>
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold; font-size: 14px;">Data Type:</label>
            <select id="newColType" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;">
                <option value="text">Text (Any letters or numbers)</option>
                <option value="number">Whole Number (e.g., 100)</option>
                <option value="decimal">Decimal / Money (e.g., 19.99)</option>
                <option value="date">Date & Time</option>
                <option value="checkbox">True / False (Checkbox)</option>
            </select>
        </div>
        
        <div id="colAddErrors" style="color: red; margin-bottom: 10px; font-size: 13px; font-weight: bold;"></div>
        
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
            <button onclick="document.getElementById('addColOverlay').remove()" style="padding: 8px 15px; cursor: pointer; background: #f8f9fa; border: 1px solid #ccc; border-radius: 4px;">Cancel</button>
            <button onclick="submitNewColumn()" style="padding: 8px 15px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Add Column</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.getElementById('newColName').focus(); // Auto-focus the input
}
async function submitNewColumn(){
    const colName = document.getElementById('newColName').value.trim();
    const colType = document.getElementById('newColType').value;
    const errorDiv = document.getElementById('colAddErrors');

    if (!colName) {
        errorDiv.innerText = "Please enter a column name.";
        return;
    }
    try {
        const response = await fetch(`${apiURL}/${ActiveTableName}/column?dbName=${currentDatabase}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                columnName: colName, 
                dataType: colType 
            })
        });

        if (response.ok) {
            // schema changed so reset the undo/redo
            undoStack = []; 
            redoStack = [];

            document.getElementById('addColOverlay').remove();
            // re-fetch table data to ensure correct schema
            loadTableData(ActiveTableName); 
            
        } else {
            const errorData = await response.json();
            errorDiv.innerText = errorData.error || "Failed to add column.";
        }
    } catch (err) {
        errorDiv.innerText = `Network Error: ${err.message}`;
    }
}
document.addEventListener('keydown', function(event) {
    // Detects Ctrl + Z (or Cmd + Z on Mac)
   if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'z') {
            event.preventDefault(); 
            undoLastAction();
        } else if (event.key.toLowerCase() === 'y') {
            event.preventDefault();
            redoLastAction();
        }
    }
});
async function loadWorkspacesOnBoot() {
    try {
        const response = await fetch(`${apiURL}/databases`);
        if (!response.ok) throw new Error("Failed to load databases.");
        
        const databases = await response.json();
        const dbList = document.getElementById('database-list');
        dbList.innerHTML = '';
        // Loop through the custom DBs and inject their buttons
        databases.forEach(dbName => {
            const newBtn = document.createElement('button');
            newBtn.className = 'db-btn';
            newBtn.innerText = dbName;
            newBtn.onclick = function() { selectDatabase(dbName, this); };
            dbList.appendChild(newBtn);
        });
    } catch (err) {
        console.error("Boot error:", err);
    }
}
loadWorkspacesOnBoot(); // Call the function to load workspaces on boot