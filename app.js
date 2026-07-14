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
    const fileInput = document.getElementById('csvFile');
    if (fileInput.files.length === 0) {
        alert('Please select a CSV file to import first.');
        return;
    }
    const file = fileInput.files[0];

    const dbName = file.name.replace(".csv", "").replace(/[^a-zA-Z0-9]/g, "_");
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('DatabaseName', dbName);
    try {
        const response = await fetch(`${apiURL}/upload`, {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            alert(`Database '${dbName}' imported successfully!`);

            const dbList = document.getElementById('database-list');
            const newBtn = document.createElement('button');
            newBtn.className = 'db-btn';
            newBtn.innerText = dbName;
            newBtn.onclick = () => selectDatabase(dbName);
            dbList.appendChild(newBtn);

            fileInput.value = "";
        }
        else {
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

async function loadTablesForWorkspace(dbName) {
    try {
        const response = await fetch(`${apiURL}/list?workspace=${dbName}`);
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
        let fetchUrl = `${apiURL}/${tableName}`;

        if (searchQuery !== '') {
            fetchUrl += `?search=${encodeURIComponent(searchQuery)}&exactMatch=${isExactMatch}&searchColumn=${encodeURIComponent(searchColumn)}`;
        }

        const response = await fetch(fetchUrl);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server responded with: ${errorText}`);
        }
        const rows = await response.json();

        controlPanel.style.display = 'block';

        if(rows.length === 0) {
            container.innerHTML = `<p>No data found for your query in: ${tableName}</p>`;
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

        currentColumns.forEach(column => {
            let arrow = '';
            if (column === currentSortColumn) {
                arrow = sortAscending ? ' ▲' : ' ▼';
            }
            html += `<th style="cursor: pointer; background-color: #f2f2f2;" onclick="sortTable('${column}')">
                    ${column}${arrow}
                 </th>`;
        });

        html += '<th style="background-color: #f2f2f2; text-align: center;">Actions</th>';
        html += '</tr>';

        const totalPages = Math.ceil(globalTableData.length / rowsPerPage);
        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = startIndex + rowsPerPage;
        const paginatedRows = globalTableData.slice(startIndex, endIndex);

        const pkColumnName = currentColumns[0];

        paginatedRows.forEach(row => {
            html += '<tr>';
            currentColumns.forEach(column => {
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
       container.innerHTML = `<h2>Data for: ${ActiveTableName} <span style="font-size: 14px; color: gray; font-weight: normal;">(${globalTableData.length} total records)</span></h2>` + html;
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
                PrimaryKeyName: pkName,
                PrimaryKeyValue: String(pkValue)
            })
        });

        if (response.ok) {
            // Push the DELETE action to the undo stack
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
            const response = await fetch(`https://localhost:7162/api/tables/update-cell`, { 
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
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
            // BULLETPROOF: Hardcoded the exact C# API url
            const response = await fetch(`https://localhost:7162/api/tables/${lastAction.tableName}/row`, {
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

                renderTable();
            } else {
                // Read the exact error message from C#
                const errorData = await response.json(); 
                console.error("Failed to undo delete. Status:", response.status, "Message:", errorData);
            }
        } catch (err) {
            console.error("Failed to undo delete:", err);
        }
    }
}
document.addEventListener('keydown', function(event) {
    // Detects Ctrl + Z (or Cmd + Z on Mac)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        // Prevent browser's default undo if focusing a text input
        event.preventDefault(); 
        undoLastAction();
    }
});
async function loadWorkspacesOnBoot() {
    try {
        const response = await fetch(`${apiURL}/workspaces`);
        if (!response.ok) throw new Error("Failed to load custom workspaces.");
        
        const workspaces = await response.json();
        const dbList = document.getElementById('database-list');
        
        // Loop through the custom DBs and inject their buttons
        workspaces.forEach(dbName => {
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