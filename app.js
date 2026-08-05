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

let masterTableData = []; // Store an unfiltered copy of the active table or SQL query view
let activeMultiFilters = []; // Stores active filter objects
let currentTableSchemaCache = []; // Caches schema data types for columns

let hiddenColumns = [];
let currentTableFKs = [];
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

    // Safe UI toggling: only change style if the element exists
    const controlPanel = document.getElementById('control-panel');
    if (controlPanel) controlPanel.style.display = 'block';

    const dbTitle = document.getElementById('current-db-title');
    if (dbTitle) dbTitle.innerText = `${dbName} Workspace`;

    const dashboardView = document.getElementById('dashboard-view');
    if (dashboardView) dashboardView.classList.add('hidden');

    const dataView = document.getElementById('data-view');
    if (dataView) dataView.classList.remove('hidden');

    const deleteBtn = document.getElementById('deleteDbBtn');
    if (deleteBtn) deleteBtn.style.display = 'block';

    await loadTablesForWorkspace(dbName);
}

async function handleCSVUpload() {
    if (!currentDatabase) {
        showToast("Please select a database from the sidebar first.");
        return;
    }

    const fileInput = document.getElementById('csvFile');
    if (fileInput.files.length === 0) {
        showToast('Please select a CSV file to import first.');
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
            showToast(`Table '${tableName}' imported successfully!`);
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
        showToast("Please select a table first!");
        return;
    }
    let dataToExport = [];
    let fileName = "";
    if(exportType === 'filtered')
    {
        if(!globalTableData || globalTableData.length === 0)
        {
            showToast("No data currently available to export");
            return;
        }
        dataToExport = globalTableData;
        fileName = `${ActiveTableName}_Filtered.csv`;
    }
    else if (exportType === 'full') {
        // --- NEW SAFETY CHECK: If it's a SQL Query View, use the in-memory data! ---
        if (ActiveTableName.startsWith("SQL Query")) {
            dataToExport = globalTableData;
            fileName = `${ActiveTableName.replace(/[^a-zA-Z0-9_]/g, '_')}_Full.csv`;
        } else {
            try {
                const response = await fetch(`${apiURL}/${ActiveTableName}`);
                if (!response.ok) throw new Error("Failed to fetch full table");
                dataToExport = await response.json();
                fileName = `${ActiveTableName}_Full_Table.csv`;
            } catch (err) {
                console.error(err);
                showToast("Could not load the full table for export");
                return;
            }
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
        showToast("No active data to export!");
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
            showToast(`Database '${dbName}' created successfully!`);
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
        showToast("Please select a database from the sidebar first!");
        return;
    }
    const tableName = prompt("Enter new table name (alphanumeric and underscores only):");
    if (!tableName) return;
    
    try {
        const response = await fetch(`${apiURL}/create-table?dbName=${currentDatabase}&tableName=${tableName}`, { method: 'POST' });
        if (response.ok) {
            showToast(`Table '${tableName}' created successfully!`);
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
        const searchBoxInput = document.getElementById('search-box');
        if (searchBoxInput) {
            searchBoxInput.value = '';
        }
        const exactMatchCheckbox = document.getElementById('exact-match-checkbox');
        if (exactMatchCheckbox) {
            exactMatchCheckbox.checked = false;
        }
        const columnDropdown = document.getElementById('column-dropdown');
        if (columnDropdown) {
            columnDropdown.innerHTML = '<option value="ALL">All Columns</option>';
        }

        // Hide table-specific tools when loading a new workspace
        document.getElementById('table-action-buttons').style.display = 'none';
        document.getElementById('table-specific-tools').style.display = 'none';
        await recoverSessionWorkspace(true);    
    }
    catch(err) {
        console.error("Error loading workspace:", err);
        alert(`Could not load tables for workspace: ${dbName}`);
    }
}

// Handles showing/hiding the UI tools when a table is selected
function handleTableSelection(tableName) {
    if (tableName && customSqlViews[tableName]) {
        // --- NEW: It's a saved SQL Query View! ---
        loadCustomSqlView(tableName);
    } else if (tableName) {
        // --- EXISTING: It's a normal database table ---
        const actionButtons = document.getElementById('table-action-buttons');
        actionButtons.style.display = 'flex';
        // Ensure all buttons (Rename, Relationships, Delete) are visible again
        Array.from(actionButtons.children).forEach(btn => btn.style.display = 'inline-flex');

        document.getElementById('table-specific-tools').style.display = 'flex';
        loadTableData(tableName);
    } else {
        // Hide tools if "-- Select a Table --" is chosen
        ActiveTableName = '';
        document.getElementById('table-action-buttons').style.display = 'none';
        document.getElementById('table-specific-tools').style.display = 'none';
        document.getElementById('data-container').innerHTML = '<p style="color: gray;">Select a table from the dropdown above to view data.</p>';
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
        masterTableData = [...rows]; // Keep an unfiltered copy for future reference

        try {
            const schemaResponse = await fetch(`${apiURL}/${tableName}/schema?dbName=${currentDatabase}`);
            if (schemaResponse.ok) currentTableSchemaCache = await schemaResponse.json();
        } catch (e) {
            currentTableSchemaCache = [];
        }

        // Reset active filters when loading a brand new table
        if (ActiveTableName !== tableName) {
            activeMultiFilters = [];
            updateFilterBadgeUI();
        }

        currentPage = 1; // Reset to the first page whenever new data is loaded
        //silently fetch relationships
        try {
            const fkRes = await fetch(`${apiURL}/foreign-keys?dbName=${currentDatabase}&tableName=${tableName}`);
            if (fkRes.ok) {
                currentTableFKs = await fkRes.json();
            } else {
                currentTableFKs = [];
            }
        } catch(e) {
            currentTableFKs = [];
        }
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
        showToast("Please select a table from the sidebar first!");
        return;
    }
    const text = document.getElementById('search-box').value;
    const isExact = document.getElementById('exact-match-checkbox').checked;
    const column = document.getElementById('column-dropdown').value; // Grab dropdown value
    if (customSqlViews[ActiveTableName]) {
        loadCustomSqlView(ActiveTableName, text, isExact, column);
    } else {
        loadTableData(ActiveTableName, text, isExact, column);
    }
}

// Clear search input, uncheck the checkbox, reset dropdown, and reload table data
// Now also clears filters
function clearSearch() {
    document.getElementById('search-box').value = '';
    document.getElementById('exact-match-checkbox').checked = false; // Uncheck the box
    document.getElementById('column-dropdown').value = 'ALL';
    //clear filters
    activeMultiFilters = [];
    if (typeof updateFilterBadgeUI === 'function') {
        updateFilterBadgeUI();
    }
    // clear tables or queries
    if (customSqlViews[ActiveTableName]) {
        loadCustomSqlView(ActiveTableName, '', false, 'ALL');
    } else {
        loadTableData(ActiveTableName, '', false, 'ALL');
    }
}

// Redraw the table based on the current globalTableData and currentColumns
function renderTable() {
    const container = document.getElementById('data-container');
    // add a scrollable wrapper div before the table starts
// Added the ID so our keyboard listener can find it!
    let html = '<div id="table-scroll-wrapper" style="width: 100%; max-width: 100%; overflow-x: auto; padding-bottom: 15px;"><table><tr>';    const pkColumnName = currentColumns[0];
    const visibleColumns = currentColumns.filter(col => !hiddenColumns.includes(col));

    visibleColumns.forEach(column => {
        let arrow = '';
        if (column === currentSortColumn) {
            arrow = sortAscending ? ' ▲' : ' ▼';
        }

        let headerBg = '#f8f9fa';
        let headerTextColor = '#212529';
        
        if (column.startsWith('A | ')) {
            headerBg = '#e2e3e5';       // Gray
            headerTextColor = '#383d41';
        } else if (column.startsWith('B | ')) {
            headerBg = '#d1ecf1';       // Cyan
            headerTextColor = '#0c5460';
        }

        if (column === pkColumnName) {
            html += `<th style="cursor: pointer; background-color: ${headerBg}; color: ${headerTextColor}; border-bottom: 2px solid #ccc;" onclick="sortTable('${column}')">
                        ${column}${arrow} <br><span style="font-size: 11px; font-weight: normal;">(PK)</span>
                     </th>`;
        } else {
            html += `<th style="cursor: pointer; background-color: ${headerBg}; color: ${headerTextColor}; border-bottom: 2px solid #ccc;" onclick="sortTable('${column}')">
                        <div style="display: flex; justify-content: flex-start; align-items: center; gap: 10px;">                            
                            <span>${column}${arrow}</span>
                            <div>
                                <button onclick="event.stopPropagation(); hideColumn('${column}')" title="Hide Column" style="color: #6c757d; background: none; border: none; cursor: pointer; font-size: 12px; margin-left: 10px; padding: 0;">(hide)</button>
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
            if (typeof cellData === 'string' && cellData.includes('T00:00:00')) {
                cellData = cellData.split('T')[0]; // Turns '1948-12-08T00:00:00' into '1948-12-08'
            }
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
            else if (typeof cellData === 'string' && cellData.length > 40) {
                // 1. Make the text safe so random < or > characters don't break the table HTML
                let safeText = cellData.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                let shortText = safeText.substring(0, 30) + '...';
                
                // 2. Create a toggleable HTML block (with white-space: normal to override the CSS!)
                cellData = `
                    <div style="white-space: normal; line-height: 1.4;">
                        <span style="display: inline;">
                            ${shortText} 
                            <a href="javascript:void(0);" 
                            onclick="this.parentElement.style.display='none'; this.parentElement.nextElementSibling.style.display='inline';" 
                            style="color: #007bff; text-decoration: none; font-weight: bold; margin-left: 5px;">(more)</a>
                        </span>
                        <span style="display: none;">
                            ${safeText} 
                            <a href="javascript:void(0);" 
                            onclick="this.parentElement.style.display='none'; this.parentElement.previousElementSibling.style.display='inline';" 
                            style="color: #007bff; text-decoration: none; font-weight: bold; margin-left: 5px;">(less)</a>
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

        let cellBgStyle = '';
            if (column.startsWith('B | ')) {
                cellBgStyle = 'background-color: #e8f4f8;'; // Albastru glaciar subțire pentru celulele B
            } else if (column.startsWith('A | ')) {
                cellBgStyle = 'background-color: #ffffff;'; // Alb curat pentru celulele A
            }
        if (!isPrimaryKey) {
                html += `<td style="cursor: pointer; ${cellBgStyle}" ondblclick="makeCellEditable(this, '${ActiveTableName}', '${column}', '${pkColumnName}', '${row[pkColumnName]}', '${escapedRaw}')">${cellData}</td>`;
            } else {
                html += `<td style="${cellBgStyle}">${cellData}</td>`;
            }
        });

        html += `<td style="text-align: center;">
            <button onclick="deleteRow('${row[pkColumnName]}', '${pkColumnName}')" title="Delete Row" style="cursor:pointer; background:none; border:none; font-size:1.2rem; transition: transform 0.1s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">🗑️</button>
        </td>`;
        html += '</tr>';
    });
    html += '</table></div>';

    // pagination control
    let paginationHtml = ''; 
    if (totalPages > 1) {
        paginationHtml = `
        <div style="margin-top: 15px; display: flex; align-items: center; gap: 15px; font-family: sans-serif;">
            <button onclick="changePage(-1)" ${currentPage === 1 ? 'disabled' : ''} class="btn btn-secondary" style="${currentPage === 1 ? 'opacity: 0.5; cursor: not-allowed;' : ''}">Previous</button>
            <span style="font-weight: bold; font-size: 14px;">Page ${currentPage} of ${totalPages}</span>
            <button onclick="changePage(1)" ${currentPage === totalPages ? 'disabled' : ''} class="btn btn-secondary" style="${currentPage === totalPages ? 'opacity: 0.5; cursor: not-allowed;' : ''}">Next</button>
        </div>
        `;
        html += paginationHtml;
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

    const isSqlView = ActiveTableName.startsWith("SQL Query");

        // Conditionally render Manage Columns & Add Row ONLY if it's a real table
        const manageButtonsHtml = isSqlView ? '' : `
            <button onclick="showManageColumnsModal()" class="btn btn-secondary" style="margin-right: 10px; background-color: #6c757d; color: white;">
                🛠️ Manage Columns
            </button>
            <button onclick="showAddRowModal()" class="btn btn-success">
                + Add Row
            </button>
        `;

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h2>Data for: ${ActiveTableName} <span style="font-size: 14px; color: gray; font-weight: normal;">(${globalTableData.length} total records)</span></h2>
                <div style="display: flex; align-items: center;">
                    ${hiddenDropdownHtml}
                    ${manageButtonsHtml}
                </div>
            </div>
            ${paginationHtml} 
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
async function makeCellEditable(td, tableName, columnName, pkName, pkValue, originalValue) {
    if (td.querySelector('input') || td.querySelector('select')) return;
    
    // 1. Check if this column is a Foreign Key
    const fkInfo = currentTableFKs.find(fk => fk.LocalColumn === columnName);
    
    if (fkInfo) {
        // --- IT IS A FOREIGN KEY: BUILD A DROPDOWN ---
        td.innerHTML = '<span style="color: gray; font-size: 12px;">Loading...</span>';
        
        try {
            // Fetch the data from the linked table (e.g., Suppliers)
            const targetRes = await fetch(`${apiURL}/${fkInfo.TargetTable}?dbName=${currentDatabase}`);
            const targetData = await targetRes.json();
            
            const select = document.createElement('select');
            select.style.width = "100%";
            select.style.padding = "4px";
            select.style.boxSizing = "border-box";
            
            // Add a blank default option
            select.appendChild(new Option('-- Select --', ''));
            
            // Generate the options
            targetData.forEach(row => {
                const targetId = row[fkInfo.TargetColumn];
                let displayVal = targetId;
                
                // SMART DISPLAY: Try to find a text column for the name (ignores IDs)
                const keys = Object.keys(row);
                for(let k of keys) {
                    if(k !== fkInfo.TargetColumn && typeof row[k] === 'string' && !k.toLowerCase().includes('id')) {
                        displayVal = `${row[k]} (ID: ${targetId})`;
                        break;
                    }
                }
                
                const opt = new Option(displayVal, targetId);
                if (String(targetId) === String(originalValue)) opt.selected = true; // Select current value
                select.appendChild(opt);
            });
            
            td.innerHTML = '';
            td.appendChild(select);
            select.focus();
            
            // Save immediately when they pick a new dropdown option
            select.onchange = async function() {
                const newValue = select.value;
                if (newValue === originalValue) { renderTable(); return; }
                await saveCellUpdate(tableName, columnName, pkName, pkValue, newValue, td, originalValue);
            };
            
            // Cancel on Escape or clicking away
            select.onkeydown = function(e) { if (e.key === 'Escape') renderTable(); };
            select.onblur = function() { renderTable(); };
            
        } catch(e) {
            console.error("Failed to load dropdown data:", e);
            renderTable(); // Abort safely
        }
    } else {
        // --- NORMAL COLUMN: USE EXISTING INPUT BOX ---
        let inputType = 'text';
        if (!isNaN(originalValue) && originalValue !== '') inputType = "number";
        
        const input = document.createElement('input');
        input.type = inputType;
        input.value = originalValue;
        input.style.width = "100%";
        input.style.boxSizing = "border-box";

        td.innerHTML = '';
        td.appendChild(input);
        input.focus();

        input.onkeydown = async function(e) {
            if (e.key === 'Enter') {
                const newValue = input.value;
                if (newValue === originalValue) {
                    renderTable(); 
                    return;
                }
                await saveCellUpdate(tableName, columnName, pkName, pkValue, newValue, td, originalValue);
            } else if (e.key === 'Escape') {
                renderTable();
            }
        };
        input.onblur = function() { renderTable(); };
    }
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
                syncBrowserHistory();
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
            syncBrowserHistory();
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
            syncBrowserHistory();
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
        showToast("Nothing to undo!");
        return;
    }

    const lastAction = undoStack.pop();
    showToast(`↩️ Undid ${lastAction.action.toLowerCase()} on ${lastAction.tableName}`);

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
    } else if (lastAction.action === "RENAME_TABLE") {
        try {
            // Rename from newName BACK to oldName
            await fetch(`${apiURL}/${lastAction.newName}/rename?dbName=${currentDatabase}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newName: lastAction.oldName })
            });
            
            redoStack.push(lastAction);
            await loadTablesForWorkspace(currentDatabase);
            document.getElementById('tableSelect').value = lastAction.oldName;
            handleTableSelection(lastAction.oldName);
        } catch (err) { console.error("Undo table rename failed", err); }
    }
    else if (lastAction.action === "RENAME_COLUMN") {
        try {
            // Rename from newName BACK to oldName
            await fetch(`${apiURL}/${lastAction.tableName}/column/${lastAction.newName}/rename?dbName=${currentDatabase}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newName: lastAction.oldName })
            });
            
            redoStack.push(lastAction);
            loadTableData(lastAction.tableName);
        } catch (err) { console.error("Undo column rename failed", err); }
    }
}

//command pattern redo
async function redoLastAction() {
    if (redoStack.length === 0) {
        showToast(`Nothing to redo!`);
        return;
    }

    const lastAction = redoStack.pop();
    showToast(`↪️ Redid ${lastAction.action.toLowerCase()} on ${lastAction.tableName}`);

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
    } else if (lastAction.action === "RENAME_TABLE") {
        try {
            // Rename from oldName FORWARD to newName
            await fetch(`${apiURL}/${lastAction.oldName}/rename?dbName=${currentDatabase}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newName: lastAction.newName })
            });
            
            undoStack.push(lastAction);
            await loadTablesForWorkspace(currentDatabase);
            document.getElementById('tableSelect').value = lastAction.newName;
            handleTableSelection(lastAction.newName);
        } catch (err) { console.error("Redo table rename failed", err); }
    }
    else if (lastAction.action === "RENAME_COLUMN") {
        try {
            // Rename from oldName FORWARD to newName
            await fetch(`${apiURL}/${lastAction.tableName}/column/${lastAction.oldName}/rename?dbName=${currentDatabase}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newName: lastAction.newName })
            });
            
            undoStack.push(lastAction);
            loadTableData(lastAction.tableName);
        } catch (err) { console.error("Redo column rename failed", err); }
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
async function openRelationshipModal()
{
    if(!currentDatabase || !ActiveTableName) {
        showToast("Please select a database and open a table first!");
        return;
    }
    document.getElementById('rel-current-table').innerText = ActiveTableName;
    const localColumnSelect = document.getElementById('rel-local-column');
    localColumnSelect.innerHTML = '';
    currentColumns.forEach(col =>{
        const option = document.createElement('option');
        option.value = col;
        option.textContent = col;
        localColumnSelect.appendChild(option);
    });
    const targetTableSelect = document.getElementById('rel-target-table');
    targetTableSelect.innerHTML = '<option value="">Loading tables...</option>';

    try {
        const response = await fetch(`${apiURL}/list?dbName=${currentDatabase}`);
        if (response.ok) {
            const tables = await response.json();
            targetTableSelect.innerHTML = '';
            
            tables.forEach(table => {
                const option = document.createElement('option');
                option.value = table;
                option.textContent = table;
                targetTableSelect.appendChild(option);
            });
        } else {
            targetTableSelect.innerHTML = '<option value="">Failed to load tables</option>';
        }
    } catch (err) {
        console.error("Error fetching tables for relationship modal:", err);
        targetTableSelect.innerHTML = '<option value="">Network Error</option>';
    }
    document.getElementById('relationshipModal').style.display = 'flex';
}
function closeRelationshipModal() {
    document.getElementById('relationshipModal').style.display = 'none';
}
async function submitRelationship() {
    const localColumn = document.getElementById('rel-local-column').value;
    const targetTable = document.getElementById('rel-target-table').value;
    if (!localColumn || !targetTable) {
        showToast("Please select both a table and a column!");
        return;
    }
    try {
        const fetchUrl = `${apiURL}/add-foreign-key?dbName=${currentDatabase}&tableName=${ActiveTableName}&columnName=${localColumn}&targetTable=${targetTable}&targetColumn=Id`;
        
        const response = await fetch(fetchUrl, { method: 'POST' });
        if(response.ok) {
            const result = await response.json();
            showToast(result.message);
            closeRelationshipModal();
        } else {
            const errorData = await response.json();
            alert(errorData.error || "Failed to create relationship.");
        }
    } catch(err) {
        console.error("Error creating relationship!");
        alert("A network error occured while creating the relationship.");
    }
}
// Open the Smart Join View Modal
async function openJoinViewModal() {
    if (!currentDatabase || !ActiveTableName) {
        showToast("Please select a database and open a table first!");
        return;
    }

    const selectDropdown = document.getElementById('smart-relationship-select');
    selectDropdown.innerHTML = '<option value="">Loading relationships...</option>';
    document.getElementById('join-results-container').innerHTML = '<p style="padding: 15px; color: #666; text-align: center;">Select a relationship above and click Load View.</p>';
    document.getElementById('join-search-container').style.display = 'none';
    document.getElementById('joinViewModal').style.display = 'flex';
    
    try {
        const response = await fetch(`${apiURL}/foreign-keys?dbName=${currentDatabase}&tableName=${ActiveTableName}`);
        if (response.ok) {
            const relationships = await response.json();
            
            if (relationships.length === 0) {
                selectDropdown.innerHTML = '<option value="">No foreign keys found for this table.</option>';
                return;
            }

            selectDropdown.innerHTML = '<option value="">-- Select a Relationship --</option>';
            
            relationships.forEach(rel => {
                const option = document.createElement('option');
                // We store the data we need to construct the URL later right inside the option value
                option.value = JSON.stringify(rel); 
                option.textContent = `${rel.LocalColumn} ➔ linked to ${rel.TargetTable} (${rel.TargetColumn})`;
                selectDropdown.appendChild(option);
            });
        }
    } catch (err) {
        console.error("Error fetching relationships:", err);
        selectDropdown.innerHTML = '<option value="">Failed to load relationships</option>';
    }
}

// Close the Join View Modal
function closeJoinViewModal() {
    document.getElementById('joinViewModal').style.display = 'none';
}

// Fetch and render the joined data
// NEW: Variables to track the joined data and hidden columns
let currentJoinData = [];
let hiddenJoinColumns = new Set();

// Fetch the joined data from C#
async function loadJoinedData() {
    const selectedValue = document.getElementById('smart-relationship-select').value;
    const container = document.getElementById('join-results-container');

    if (!selectedValue) {
        showToast("Please select a valid relationship first.");
        return;
    }

    const rel = JSON.parse(selectedValue);
    container.innerHTML = "<p style='padding: 15px; text-align: center;'>Loading data...</p>";

    try {
        const fetchUrl = `${apiURL}/view-join?dbName=${currentDatabase}&mainTable=${ActiveTableName}&fkColumn=${rel.LocalColumn}&targetTable=${rel.TargetTable}&targetColumn=${rel.TargetColumn}`;
        const response = await fetch(fetchUrl);
        
        if (!response.ok) {
            const err = await response.json();
            container.innerHTML = `<p style="color:red; padding:15px;">Database Error: ${err.error}</p>`;
            return;
        }

        currentJoinData = await response.json();
        
        if (currentJoinData.length === 0) {
            container.innerHTML = "<p style='padding:15px; text-align:center;'>No joined data found.</p>";
            return;
        }

        // Clear any previously hidden columns when loading a new relationship
        hiddenJoinColumns.clear(); 
        // clear old searches and show the search box
        const searchBox = document.getElementById('join-search-box');
        if (searchBox) searchBox.value = ''; 
        document.getElementById('join-search-container').style.display = 'block';
        // Render the table!
        renderJoinTable();

    } catch (err) {
        console.error("Error loading joined data:", err);
        container.innerHTML = "<p style='color:red; padding:15px;'>A network error occurred.</p>";
    }
}

// Function to render the table with colors and hidden column logic
// Function to render the table with colors, hidden columns, and LIVE SEARCH
function renderJoinTable() {
    const container = document.getElementById('join-results-container');
    if (!currentJoinData || currentJoinData.length === 0) return;

    // 1. Grab the search text from the box
    const searchBox = document.getElementById('join-search-box');
    const searchTerm = searchBox ? searchBox.value.toLowerCase().trim() : '';

    // 2. Filter the data! (If search is empty, it just keeps all rows)
    let dataToRender = currentJoinData;
    if (searchTerm !== '') {
        dataToRender = currentJoinData.filter(row => {
            // Checks every cell in the row to see if it matches your search
            return Object.values(row).some(val => 
                val !== null && val !== undefined && String(val).toLowerCase().includes(searchTerm)
            );
        });
    }

    // Always use the original data to get the column headers, so they don't disappear on an empty search
    const allColumns = Object.keys(currentJoinData[0]);
    const visibleColumns = allColumns.filter(col => !hiddenJoinColumns.has(col));

    let html = '';

    // If there are hidden columns, show a "Restore" banner at the top
    if (hiddenJoinColumns.size > 0) {
        html += `
        <div style="padding: 10px; background: #fff3cd; border-bottom: 1px solid #ffeeba; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 2;">
            <span style="color: #856404; font-size: 14px; font-weight: bold;">Hidden Columns: ${hiddenJoinColumns.size}</span>
            <button onclick="restoreJoinColumns()" class="btn btn-primary" style="padding: 4px 10px; font-size: 12px;">Restore All</button>
        </div>`;
    }

    html += '<table style="width:100%; border-collapse: collapse; text-align: left;"><thead><tr>';
    
    visibleColumns.forEach(col => {
        const isMainTable = currentColumns.includes(col);
        const headerBg = isMainTable ? '#e9ecef' : '#d1ecf1';
        
        html += `
        <th style="border: 1px solid #ccc; padding: 10px; background-color: ${headerBg}; position: sticky; top: ${hiddenJoinColumns.size > 0 ? '40px' : '0'}; z-index: 1;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>${col}</span>
                <span onclick="hideJoinColumn('${col}')" style="cursor: pointer; color: #dc3545; font-size: 10px; margin-left: 15px;" title="Hide Column">❌</span>
            </div>
        </th>`;
    });
    html += '</tr></thead><tbody>';

    // 3. Inform the user if their search found nothing
    if (dataToRender.length === 0) {
        html += `<tr><td colspan="${visibleColumns.length}" style="padding: 20px; text-align: center; color: gray; font-style: italic;">No matching records found for "${searchTerm}".</td></tr>`;
    } else {
        // 4. Loop over the FILTERED data
        dataToRender.forEach(row => {
            html += '<tr>';
            visibleColumns.forEach(col => {
                const isMainTable = currentColumns.includes(col);
                const cellBg = isMainTable ? '#ffffff' : '#f4f8fb';
                const cellValue = row[col] !== null && row[col] !== undefined ? row[col] : '';
                
                html += `<td style="border: 1px solid #eee; padding: 10px; background-color: ${cellBg};">${cellValue}</td>`;
            });
            html += '</tr>';
        });
    }

    html += '</tbody></table>';
    container.innerHTML = html;
}

// Helper function to hide a column and immediately re-render
function hideJoinColumn(colName) {
    hiddenJoinColumns.add(colName);
    renderJoinTable();
}

// Helper function to clear hidden columns and immediately re-render
function restoreJoinColumns() {
    hiddenJoinColumns.clear();
    renderJoinTable();
}
async function deleteCurrentTable() {
    if (!currentDatabase || !ActiveTableName) return;
    
    if (!confirm(`Are you absolutely sure you want to PERMANENTLY delete the table '${ActiveTableName}' and all its data? This cannot be undone.`)) {
        return;
    }

    try {
        const fetchUrl = `${apiURL}/delete-table?dbName=${currentDatabase}&tableName=${ActiveTableName}`;
        const response = await fetch(fetchUrl, { method: 'DELETE' });
        
        if (response.ok) {
            const result = await response.json();
            showToast(result.message);
            document.getElementById('data-container').innerHTML = '<p style="color: gray;">Select a table from the dropdown above to view data.</p>';
            
            const dropdown = document.getElementById('tableSelect');
            for (let i = 0; i < dropdown.options.length; i++) {
                if (dropdown.options[i].value === ActiveTableName) {
                    dropdown.remove(i);
                    break;
                }
            }
            dropdown.value = ""; // Reset the dropdown to the default state
            ActiveTableName = null;
            
            // Hide table-specific tools now that the table is gone
            document.getElementById('table-action-buttons').style.display = 'none';
            document.getElementById('table-specific-tools').style.display = 'none';
            
        } else {
            const err = await response.json();
            alert(`Delete Failed:\n${err.error}`);
        }
    } catch (err) {
        console.error("Deletion JS Error:", err);
        alert("An error occurred while updating the UI after deletion.");
    }
}

async function deleteCurrentDatabase() {
    if (!currentDatabase) return;

    const userInput = prompt(`WARNING: This will permanently destroy the database '${currentDatabase}' and ALL tables inside it.\n\nType the database name exactly to confirm:`);
    
    if (userInput !== currentDatabase) {
        if (userInput !== null) showToast("Database name did not match. Deletion canceled.");
        return;
    }

    try {
        const fetchUrl = `${apiURL}/delete-database?dbName=${currentDatabase}`;
        const response = await fetch(fetchUrl, { method: 'DELETE' });
        
        if (response.ok) {
            const result = await response.json();
            showToast(result.message);
            
            // 1. Clear internal state variables
            currentDatabase = null;
            ActiveTableName = null;
            
            // 2. Wipe the table dropdown completely so ghost tables don't remain
            document.getElementById('tableSelect').innerHTML = '<option value="">-- Select a Table --</option>';
            
            // 3. Reset the main viewing area using the correct ID
            document.getElementById('data-container').innerHTML = '<div style="padding: 20px; color: gray;">Database deleted. Please select another database from the sidebar.</div>';
            
            // 4. Hide the toolbars
            document.getElementById('control-panel').style.display = 'none';
            document.getElementById('deleteDbBtn').style.display = 'none';
            
            // 5. Refresh your sidebar database list!
            loadWorkspacesOnBoot();
            
        } else {
            const err = await response.json();
            alert(`Delete Failed:\n${err.error}`);
        }
    } catch (err) {
        console.error("Database Deletion JS Error:", err);
        alert("A network error occurred while trying to update the UI.");
    }
}
function openSqlModal() {
    if (!currentDatabase) {
        showToast("Please select a database first!");
        return;
    }
    document.getElementById('sqlModal').style.display = 'flex';
    document.getElementById('sql-results-container').innerHTML = '<p style="padding: 15px; color: gray; text-align: center;">Results will appear here.</p>';
}

function closeSqlModal() {
    document.getElementById('sqlModal').style.display = 'none';
}

function switchSqlTab(selectedIndex) {
    // 1. Hide all tab content panes
    document.querySelectorAll('.sql-tab-pane').forEach((pane, idx) => {
        pane.style.display = (idx === selectedIndex) ? 'block' : 'none';
    });

    // 2. Reset styling on all tab buttons
    document.querySelectorAll('.sql-tab-btn').forEach((btn, idx) => {
        if (idx === selectedIndex) {
            // Active Tab Style
            btn.style.backgroundColor = '#ffffff';
            btn.style.borderBottomColor = '#ffffff';
            btn.style.fontWeight = 'bold';
            btn.style.color = '#007bff';
        } else {
            // Inactive Tab Style
            btn.style.backgroundColor = '#e9ecef';
            btn.style.borderBottomColor = '#dee2e6';
            btn.style.fontWeight = 'normal';
            btn.style.color = '#495057';
        }
    });
}

let currentSqlBatchResults = [];
let customSqlViews = {}; // Stores { "SQL Query #1": [...data], "SQL Query #3": [...data] }
let globalSqlQueryCounter = 0;
function openSqlResultInWorkspace(idx, overrideTitle = null, showFeedback = true) {
    const item = currentSqlBatchResults[idx];
    if (!item || !item.data || item.data.length === 0) {
        if (showFeedback) showToast("⚠️ No data available to load.");
        return;
    }

    let viewName = overrideTitle;
    if (!viewName) {
        globalSqlQueryCounter++;
        viewName = `SQL Query #${globalSqlQueryCounter}`;
        // Safety check against collisions
        while (customSqlViews[viewName] || document.querySelector(`#tableSelect option[value="${viewName}"]`)) {
            globalSqlQueryCounter++;
            viewName = `SQL Query #${globalSqlQueryCounter}`;
        }
    } else {
        // Synchronize global counter if a higher numbered query is restored
        const match = viewName.match(/#(\d+)/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > globalSqlQueryCounter) {
                globalSqlQueryCounter = num;
            }
        }
    }

    // Save query to session using the exact viewName
    if (item && item.command && item.type === 'data') {
        saveQueryToSession(viewName, item.command, currentDatabase);
    }

    // Store data in memory
    customSqlViews[viewName] = [...item.data];

    // Add or select option in dropdown
    const dropdown = document.getElementById('tableSelect');
    if (dropdown) {
        let optionExists = Array.from(dropdown.options).some(opt => opt.value === viewName);
        if (!optionExists) {
            const option = document.createElement('option');
            option.value = viewName;
            option.setAttribute('data-session-query', 'true');
            option.textContent = `📊 ${viewName} (${item.data.length} rows)`;
            dropdown.appendChild(option);
        }
        dropdown.value = viewName;
    }

    loadCustomSqlView(viewName);

    if (showFeedback) {
        showToast(`✅ Added '${viewName}' to your Workspace dropdown!`);
    }
}

// Helper: Loads a custom SQL view from memory into the normal table grid
function loadCustomSqlView(viewName, searchQuery = '', isExactMatch = false, searchColumn = 'ALL') {
    const rawData = customSqlViews[viewName];
    if (!rawData || rawData.length === 0) return;

    ActiveTableName = viewName;
    masterTableData = [...rawData]; // Keep a master copy for filtering
    currentTableSchemaCache = [];
    // 1. Apply Client-Side Filtering if a search term is present
    let filteredData = [...rawData];
    if (searchQuery.trim() !== '') {
        const query = searchQuery.trim().toLowerCase();
        filteredData = rawData.filter(row => {
            if (searchColumn !== 'ALL' && row[searchColumn] !== undefined && row[searchColumn] !== null) {
                const cellVal = String(row[searchColumn]).toLowerCase();
                return isExactMatch ? cellVal === query : cellVal.includes(query);
            } else {
                // Search across all columns in the row
                return Object.values(row).some(val => {
                    if (val === null || val === undefined) return false;
                    const cellVal = String(val).toLowerCase();
                    return isExactMatch ? cellVal === query : cellVal.includes(query);
                });
            }
        });
    }

    // 2. Assign filtered data to globalTableData so pagination & sorting work normally
    globalTableData = filteredData;
    
    // Always use the original headers from rawData so columns don't vanish on an empty search result
    currentColumns = Object.keys(rawData[0]);
    currentPage = 1;
    hiddenColumns = [];
    currentSortColumn = '';

    // Only wipe the search boxes if we are loading the view fresh (not actively searching)
    if (searchQuery === '') {
        document.getElementById('search-box').value = '';
        document.getElementById('exact-match-checkbox').checked = false;
    }
    
    populateDropdown();

    document.getElementById('control-panel').style.display = 'block';

    // Show #table-action-buttons, but ONLY reveal the "Rename Table" button (index 0)
    const actionButtons = document.getElementById('table-action-buttons');
    actionButtons.style.display = 'flex';
    Array.from(actionButtons.children).forEach((btn, idx) => {
        btn.style.display = (idx === 0) ? 'inline-flex' : 'none';
    });

    document.getElementById('table-specific-tools').style.display = 'flex';

    renderTable();
}
async function runRawSql() {
    const query = document.getElementById('sql-query-input').value.trim();
    const container = document.getElementById('sql-results-container');

    if (!query) {
        showToast("⚠️ Please enter a SQL query.");
        return;
    }

    container.innerHTML = "<p style='padding: 15px; text-align: center;'>Executing...</p>";

    try {
        const response = await fetch(`${apiURL}/custom-query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dbName: currentDatabase, query: query })
        });
        
        const result = await response.json();

        if (!response.ok) {
            container.innerHTML = `<div style="color:#721c24; background-color:#f8d7da; padding:15px; border-bottom:1px solid #f5c6cb;"><b>SQL Error:</b><br>${result.error}</div>`;
            return;
        }

        const batch = result.results || (result.type ? [{ index: 1, command: query, ...result }] : []);
        if (batch.length === 0) {
            container.innerHTML = "<p style='padding:15px; text-align:center;'>No results returned.</p>";
            return;
        }
        currentSqlBatchResults = batch; // Store for later use in "Open in Workspace"
        // =================================================================
        // BUILD TABBED INTERFACE
        // =================================================================
        
        let tabsHtml = `<div style="display: flex; border-bottom: 1px solid #dee2e6; background: #f8f9fa; gap: 4px; padding: 8px 8px 0 8px; overflow-x: auto; position: sticky; top: 0; z-index: 10;">`;
        let panesHtml = `<div style="padding: 15px; background: #ffffff;">`;

        batch.forEach((item, idx) => {
            const isFirst = (idx === 0);

            // 1. Determine Tab Button Label & Icon
            let tabLabel = `Result #${item.index}`;
            let tabColor = "#495057";
            if (item.type === 'error') {
                tabLabel = `⚠️ Result #${item.index} (Error)`;
                tabColor = "#dc3545";
            } else if (item.type === 'message') {
                tabLabel = `✅ Result #${item.index} (Message)`;
            } else if (item.type === 'data') {
                tabLabel = `📊 Result #${item.index} (${item.rowCount || item.data.length} rows)`;
            }

            // 2. Build Tab Button
            const activeBg = isFirst ? '#ffffff' : '#e9ecef';
            const activeBorderBottom = isFirst ? '#ffffff' : '#dee2e6';
            const activeWeight = isFirst ? 'bold' : 'normal';
            const activeColor = isFirst ? '#007bff' : tabColor;

            tabsHtml += `
            <button id="sql-tab-btn-${idx}" 
                    class="sql-tab-btn"
                    onclick="switchSqlTab(${idx})" 
                    style="background-color: ${activeBg}; 
                           border: 1px solid #dee2e6; 
                           border-bottom: 2px solid ${activeBorderBottom}; 
                           margin-bo    ttom: -1px; 
                           padding: 8px 14px; 
                           border-radius: 6px 6px 0 0; 
                           cursor: pointer; 
                           font-size: 13px; 
                           font-weight: ${activeWeight}; 
                           color: ${activeColor}; 
                           white-space: nowrap; 
                           transition: all 0.15s ease;">
                ${tabLabel}
            </button>`;

            // 3. Build Content Pane (Only the first one is visible by default)
            const displayStyle = isFirst ? 'block' : 'none';
            panesHtml += `
            <div id="sql-pane-${idx}" class="sql-tab-pane" style="display: ${displayStyle};">
                <!-- Header displaying the exact SQL command executed -->
                <div style="background: #f1f3f5; padding: 8px 12px; border: 1px solid #e9ecef; border-radius: 4px; margin-bottom: 12px; font-family: monospace; font-size: 13px; color: #343a40; display: flex; justify-content: space-between; align-items: center;">
                    <span><b>Command #${item.index}:</b> ${escapeHtml(item.command)}</span>
                    <span style="font-size: 11px; color: #6c757d; text-transform: uppercase;">${item.type}</span>
                </div>`;

            // A. Error Output (NO BUTTON)
            if (item.type === 'error') {
                panesHtml += `
                <div style="color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; padding: 12px 15px; font-size: 13px;">
                    <b>SQL Error:</b> ${escapeHtml(item.error)}
                </div>`;
            }
            // B. Success / Mutation Output like "5 rows affected" (NO BUTTON)
            else if (item.type === 'message') {
                panesHtml += `
                <div style="color: #155724; background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; padding: 12px 15px; font-size: 13px;">
                    <b>Success:</b> ${item.message}
                </div>`;
            }
            // C. SELECT Data Grid Output
            else if (item.type === 'data') {
                const data = item.data;
                
                // C1. Empty SELECT query (NO BUTTON)
                if (data.length === 0) {
                    panesHtml += `<p style="padding: 12px 0; margin: 0; color: gray; font-style: italic; font-size: 13px;">Query executed successfully. 0 rows returned.</p>`;
                } 
                // C2. ACTUAL DATA TABLE (ONLY HERE DO WE SHOW THE BUTTON!)
                else {
                    const columns = Object.keys(data[0]);
                    
                    // Button is strictly rendered only when real rows exist
                    panesHtml += `
                    <div style="margin-bottom: 12px;">
                        <button onclick="openSqlResultInWorkspace(${idx})" class="btn btn-primary" style="padding: 6px 14px; font-size: 13px; background-color: #007bff; color: white;">
                            🚀 View as Normal Table
                        </button>
                    </div>`;

                    // Table preview inside the modal tab
                    panesHtml += '<div style="overflow-x: auto; max-height: 280px; border: 1px solid #dee2e6; border-radius: 4px;"><table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;"><thead><tr>';
                    
                    columns.forEach(col => {
                        panesHtml += `<th style="border: 1px solid #dee2e6; padding: 8px 10px; background-color: #e9ecef; position: sticky; top: 0; z-index: 1;">${col}</th>`;
                    });
                    panesHtml += '</tr></thead><tbody>';

                    data.forEach(row => {
                        panesHtml += '<tr>';
                        columns.forEach(col => {
                            const val = row[col] !== null && row[col] !== undefined ? row[col] : '';
                            panesHtml += `<td style="border: 1px solid #eee; padding: 8px 10px; background-color: white;">${val}</td>`;
                        });
                        panesHtml += '</tr>';
                    });
                    
                    panesHtml += '</tbody></table></div>';
                }
            }

            panesHtml += `</div>`; // Close pane
        });

        tabsHtml += `</div>`; // Close tab bar
        panesHtml += `</div>`; // Close pane container

        container.innerHTML = tabsHtml + panesHtml;

        // Refresh sidebar tables if any data was mutated
        const hasMutation = batch.some(r => r.type === 'message');
        if (hasMutation) {
            try {
                const tableResponse = await fetch(`${apiURL}/list?dbName=${currentDatabase}`);
                if (tableResponse.ok) {
                    const tables = await tableResponse.json();
                    const dropdown = document.getElementById('tableSelect');
                    const currentSelection = dropdown.value; 
                    
                    dropdown.innerHTML = '<option value="">-- Select a Table --</option>';
                    tables.forEach(table => {
                        dropdown.innerHTML += `<option value="${table}">${table}</option>`;
                    });
                    
                    if (tables.includes(currentSelection)) {
                        dropdown.value = currentSelection;
                    }
                }
            } catch (e) {
                console.error("Failed to silently refresh table list:", e);
            }
        }
    } catch (err) {
        console.error(err);
        container.innerHTML = "<p style='color:red; padding: 15px;'>A network error occurred while executing the query.</p>";
    }
}

// Small helper to prevent HTML injection inside code cards
function escapeHtml(text) {
    if (!text) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
// --- SCHEMA VISUALIZER LOGIC ---

function openSchemaModal() {
    if (!currentDatabase) {
        showToast("Please select a database first!");
        return;
    }
    document.getElementById('schema-db-name').innerText = currentDatabase;
    document.getElementById('schemaModal').style.display = 'flex';
    generateSchemaDiagram();
}

function closeSchemaModal() {
    document.getElementById('schemaModal').style.display = 'none';
    document.getElementById('schema-content').innerHTML = '<p style="color: gray;">Generating map...</p>'; // Reset
}

async function generateSchemaDiagram() {
    const container = document.getElementById('schema-content');

    try {
        // 1. Fetch all tables
        const tablesRes = await fetch(`${apiURL}/list?dbName=${currentDatabase}`);
        const tables = await tablesRes.json();

        if (tables.length === 0) {
            container.innerHTML = '<p style="color: gray;">This database has no tables yet.</p>';
            return;
        }

        container.innerHTML = '<p style="color: gray;">Analyzing relationships... please wait.</p>';

        // 2. Fetch Foreign Keys for EVERY table simultaneously
        const fkPromises = tables.map(table =>
            fetch(`${apiURL}/foreign-keys?dbName=${currentDatabase}&tableName=${table}`).then(r => r.json())
        );
        const allForeignKeys = await Promise.all(fkPromises);

        // 3. Begin building the Mermaid Syntax String
        let mermaidSyntax = 'erDiagram\n';

        tables.forEach((table, index) => {
            const tableFks = allForeignKeys[index];
            
            // FIX 1: Sanitize table names! (Convert spaces/hyphens to underscores)
            const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '_');

            if (tableFks && tableFks.length > 0) {
                // If it has links, draw them
                tableFks.forEach(fk => {
                    const safeTarget = fk.TargetTable.replace(/[^a-zA-Z0-9_]/g, '_');
                    mermaidSyntax += `    ${safeTarget} ||--o{ ${safeTable} : "${fk.LocalColumn}"\n`;
                });
            } else {
                // FIX 2: If it has no links, just declare the name! No empty { } brackets.
                mermaidSyntax += `    ${safeTable}\n`;
            }
        });

        // 4. Inject the string into a div and let Mermaid draw the graphics
        container.innerHTML = `<div class="mermaid" style="padding: 20px;">\n${mermaidSyntax}\n</div>`;
        
        // Command Mermaid to process the new text
        mermaid.init(undefined, document.querySelectorAll('.mermaid'));

    } catch (err) {
        console.error("Schema Generation Error:", err);
        container.innerHTML = '<p style="color:red; padding: 20px;">An error occurred while generating the map.</p>';
    }
}
async function promptRenameTable() {
    if (!currentDatabase || !ActiveTableName) return;
    
    const newName = prompt(`Rename '${ActiveTableName}' to:`, ActiveTableName);
    if (!newName || newName === ActiveTableName) return; 

    // =================================================================
    // 1. IN-MEMORY SQL QUERY VIEW RENAME
    // =================================================================
    if (customSqlViews[ActiveTableName]) {
        const oldName = ActiveTableName;

        // A. Move data to the new key in our memory object
        customSqlViews[newName] = customSqlViews[oldName];
        delete customSqlViews[oldName];

        // B. Update the <option> text & value in the #tableSelect dropdown
        const dropdown = document.getElementById('tableSelect');
        for (let i = 0; i < dropdown.options.length; i++) {
            if (dropdown.options[i].value === oldName) {
                dropdown.options[i].value = newName;
                dropdown.options[i].textContent = `📊 ${newName} (${globalTableData.length} rows)`;
                break;
            }
        }

        // C. Update active state and refresh the header
        ActiveTableName = newName;
        dropdown.value = newName;
        renderTable();
        showToast(`✏️ Renamed view to '${newName}'`);
        return;
    }

    // =================================================================
    // 2. PHYSICAL SQL DATABASE TABLE RENAME
    // =================================================================
    try {
        const response = await fetch(`${apiURL}/${ActiveTableName}/rename?dbName=${currentDatabase}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newName: newName })
        });

        if (response.ok) {
            undoStack.push({ action: "RENAME_TABLE", oldName: ActiveTableName, newName: newName });
            syncBrowserHistory();
            redoStack = [];
            
            await loadTablesForWorkspace(currentDatabase);
            document.getElementById('tableSelect').value = newName;
            handleTableSelection(newName);
        } else {
            const err = await response.json(); 
            alert(`Rename Failed:\n${err.error}`);
        }
    } catch (err) { 
        alert("Network error during rename."); 
    }
}

function showRenameColumnModal() {
    if (!currentColumns || currentColumns.length <= 1) {
        showToast("No custom columns available to rename.");
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'renameColOverlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1000;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; padding: 25px; border-radius: 8px; width: 400px; font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.3); border-top: 5px solid #007bff;';

    // Filter out the 'Id' column so they can't accidentally break the database
    let optionsHtml = currentColumns
        .filter(c => c.toLowerCase() !== 'id')
        .map(c => `<option value="${c}">${c}</option>`)
        .join('');

    modal.innerHTML = `
        <h3 style="margin-top: 0; color: #007bff;">Rename Column</h3>
        
        <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold; font-size: 14px;">Select Column:</label>
            <select id="renameColOldName" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;">
                ${optionsHtml}
            </select>
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold; font-size: 14px;">New Column Name:</label>
            <input type="text" id="renameColNewName" placeholder="e.g., NewName" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" autocomplete="off" />
        </div>
        
        <div id="colRenameErrors" style="color: red; margin-bottom: 10px; font-size: 13px; font-weight: bold;"></div>
        
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
            <button onclick="document.getElementById('renameColOverlay').remove()" style="padding: 8px 15px; cursor: pointer; background: #f8f9fa; border: 1px solid #ccc; border-radius: 4px;">Cancel</button>
            <button onclick="executeRenameColumnFromModal()" style="padding: 8px 15px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Rename</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.getElementById('renameColNewName').focus();
}

async function executeRenameColumnFromModal() {
    const oldColumnName = document.getElementById('renameColOldName').value;
    const newName = document.getElementById('renameColNewName').value.trim();
    const errorDiv = document.getElementById('colRenameErrors');

    if (!newName) {
        errorDiv.innerText = "Please enter a new column name.";
        return;
    }
    if (newName === oldColumnName) {
        document.getElementById('renameColOverlay').remove();
        return;
    }

    try {
        const response = await fetch(`${apiURL}/${ActiveTableName}/column/${oldColumnName}/rename?dbName=${currentDatabase}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newName: newName })
        });

        if (response.ok) {
            // Push action to undo stack!
            undoStack.push({ action: "RENAME_COLUMN", tableName: ActiveTableName, oldName: oldColumnName, newName: newName });
            syncBrowserHistory();
            redoStack = [];
            
            document.getElementById('renameColOverlay').remove();
            
            // Reload table to show new headers
            loadTableData(ActiveTableName);
        } else {
            const err = await response.json();
            errorDiv.innerText = err.error || "Failed to rename column.";
        }
    } catch (err) {
        errorDiv.innerText = `Network Error: ${err.message}`;
    }
}
// 1. The Main Hub Modal
function showManageColumnsModal() {
    const overlay = document.createElement('div');
    overlay.id = 'manageColsOverlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1000;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; padding: 25px; border-radius: 8px; width: 550px; font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.3); border-top: 5px solid #17a2b8; display: flex; flex-direction: column; max-height: 80vh;';

    let colsHtml = '<div style="flex: 1; overflow-y: auto; margin-bottom: 20px; border: 1px solid #eee; border-radius: 4px;"><table style="width: 100%; border-collapse: collapse;">';
    
    currentColumns.forEach(col => {
        const isId = col.toLowerCase() === 'id';
        colsHtml += `
            <tr>
                <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: ${isId ? 'bold' : 'normal'};">
                    ${col} ${isId ? '<span style="color: gray; font-size: 12px; margin-left: 10px;">(Primary Key)</span>' : ''}
                </td>
                <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
                    ${!isId ? `
                        <button onclick="document.getElementById('manageColsOverlay').remove(); openRenameSpecificColumn('${col}')" class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px; margin-right: 5px; background-color: #6c757d; color: white;">✏️ Rename</button>
                        <button onclick="document.getElementById('manageColsOverlay').remove(); promptDeleteColumn('${col}')" class="btn btn-danger" style="padding: 4px 10px; font-size: 12px;">🗑️ Delete</button>
                    ` : '<span style="color: gray; font-size: 12px; font-style: italic;">System Locked</span>'}
                </td>
            </tr>
        `;
    });
    
    colsHtml += '</table></div>';

    modal.innerHTML = `
        <h3 style="margin-top: 0; color: #17a2b8;">Manage Columns: ${ActiveTableName}</h3>
        ${colsHtml}
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #eee; padding-top: 15px;">
            <!-- Reuses your exact Add Column Modal! -->
            <button onclick="document.getElementById('manageColsOverlay').remove(); showAddColumnModal()" class="btn btn-success">➕ Add New Column</button>
            <button onclick="document.getElementById('manageColsOverlay').remove()" class="btn btn-secondary">Close</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// 2. The Clean Rename Popup
function openRenameSpecificColumn(oldColumnName) {
    const overlay = document.createElement('div');
    overlay.id = 'renameSingleColOverlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1050;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; padding: 25px; border-radius: 8px; width: 400px; font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.3); border-top: 5px solid #007bff;';

    modal.innerHTML = `
        <h3 style="margin-top: 0; color: #007bff;">Rename Column: ${oldColumnName}</h3>
        
        <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold; font-size: 14px;">New Column Name:</label>
            <input type="text" id="renameSingleColNewName" placeholder="Enter new name..." style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" autocomplete="off" />
        </div>
        
        <div id="colSingleRenameErrors" style="color: red; margin-bottom: 10px; font-size: 13px; font-weight: bold;"></div>
        
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
            <button onclick="document.getElementById('renameSingleColOverlay').remove(); showManageColumnsModal();" class="btn btn-secondary">Cancel</button>
            <button onclick="executeSingleRename('${oldColumnName}')" class="btn btn-primary">Rename</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.getElementById('renameSingleColNewName').focus();
}

// 3. The Rename Execution
async function executeSingleRename(oldColumnName) {
    const newName = document.getElementById('renameSingleColNewName').value.trim();
    const errorDiv = document.getElementById('colSingleRenameErrors');

    if (!newName) { errorDiv.innerText = "Please enter a new column name."; return; }
    if (newName === oldColumnName) { document.getElementById('renameSingleColOverlay').remove(); showManageColumnsModal(); return; }

    try {
        const response = await fetch(`${apiURL}/${ActiveTableName}/column/${oldColumnName}/rename?dbName=${currentDatabase}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newName: newName })
        });

        if (response.ok) {
            undoStack.push({ action: "RENAME_COLUMN", tableName: ActiveTableName, oldName: oldColumnName, newName: newName });
            syncBrowserHistory();
            redoStack = [];
            document.getElementById('renameSingleColOverlay').remove();
            
            // Reload the table and reopen the manager so they can keep working
            await loadTableData(ActiveTableName);
            showManageColumnsModal();
        } else {
            const err = await response.json();
            errorDiv.innerText = err.error || "Failed to rename column.";
        }
    } catch (err) {
        errorDiv.innerText = `Network Error: ${err.message}`;
    }
}
// VISUAL CONDITION BUILDER (ADVANCED JOINS)
// =================================================================
let joinColumnsCache = { A:[], B:[] }; // Stores the column names for the two tables in memory

async function openAdvancedJoinModal() {
    if (!currentDatabase || !ActiveTableName) {
        showToast("Please select a database and table first!");
        return;
    }

    const tableA = document.getElementById('join-table-a');
    const tableB = document.getElementById('join-table-b');

    tableA.innerHTML = '';
    tableB.innerHTML = '<option value="">-- Select Table B --</option>';

    // 1. Populate tables list
    try {
        const res = await fetch(`${apiURL}/list?dbName=${currentDatabase}`);
        const tables = await res.json();

        tables.forEach(t => {
            tableA.add(new Option(t, t));
            if (t !== ActiveTableName) tableB.add(new Option(t, t));
        });

        tableA.value = ActiveTableName;
        await loadJoinColumns('A');

        // Pick the first available Table B by default
        if (tableB.options.length > 1) {
            tableB.selectedIndex = 1;
            await loadJoinColumns('B');
        }

        // Reset and add the first default condition row
        document.getElementById('join-conditions-list').innerHTML = '';
        addJoinConditionRow();
        document.getElementById('join-type-select').onchange = updateJoinSqlPreview;
        updateJoinSqlPreview();

        document.getElementById('advancedJoinModal').style.display = 'flex';
    } catch (e) {
        console.error("Error opening Advanced Join Modal:", e);
        showToast("Could not load database tables.");
    }
}

function closeAdvancedJoinModal() {
    document.getElementById('advancedJoinModal').style.display = 'none';
}

async function loadJoinColumns(side) {
    const tableName = document.getElementById(side === 'A' ? 'join-table-a' : 'join-table-b').value;
    if (!tableName) return;

    // Update the visual table name label above the checkboxes
    const labelEl = document.getElementById(side === 'A' ? 'join-label-a' : 'join-label-b');
    if (labelEl) labelEl.innerText = tableName;

    try {
        const res = await fetch(`${apiURL}/${tableName}/schema?dbName=${currentDatabase}`);
        if (res.ok) {
            const schema = await res.json();
            joinColumnsCache[side] = schema.map(c => c.ColumnName);
        }
    } catch (e) {
        joinColumnsCache[side] = ['Id'];
    }

    // 1. Refresh condition dropdowns
    const selector = (side === 'A') ? '.join-col-a' : '.join-col-b, .join-col-b2';
    document.querySelectorAll(selector).forEach(select => {
        const currentVal = select.value;
        select.innerHTML = joinColumnsCache[side].map(c => `<option value="${c}">${c}</option>`).join('');
        if (joinColumnsCache[side].includes(currentVal)) select.value = currentVal;
    });

    // 2. NEW: Render Checkboxes for Column Selection!
    const chkContainer = document.getElementById(side === 'A' ? 'join-checkboxes-a' : 'join-checkboxes-b');
    if (chkContainer) {
        chkContainer.innerHTML = joinColumnsCache[side].map(col => `
            <label style="font-size:12px; cursor:pointer; display:flex; align-items:center; gap:6px; color:#333; user-select:none;">
                <input type="checkbox" class="join-chk-${side.toLowerCase()}" value="${col}" checked onchange="updateJoinSqlPreview()" />
                <span>${col}</span>
            </label>
        `).join('');
    }

    updateJoinSqlPreview();
}

// Quick "All / None" toggle for the checkboxes
function toggleJoinCheckboxes(side, checkStatus) {
    document.querySelectorAll(`.join-chk-${side.toLowerCase()}`).forEach(chk => {
        chk.checked = checkStatus;
    });
    updateJoinSqlPreview();
}

function buildJoinSqlString() {
    const tableA = document.getElementById('join-table-a').value;
    const tableB = document.getElementById('join-table-b').value;
    const joinType = document.getElementById('join-type-select').value;

    if (!tableA || !tableB) return "";

    // 1. Collect Checked Columns and wrap them in clean aliases: [A | ColName] and [B | ColName]
    let selectedCols = [];
    
    document.querySelectorAll('.join-chk-a:checked').forEach(chk => {
        selectedCols.push(`A.[${chk.value}] AS [A | ${chk.value}]`);
    });
    document.querySelectorAll('.join-chk-b:checked').forEach(chk => {
        selectedCols.push(`B.[${chk.value}] AS [B | ${chk.value}]`);
    });

    // Fallback safety: if user unchecked literally everything, use A.*, B.*
    const selectClause = selectedCols.length > 0 ? selectedCols.join(", ") : "A.*, B.*";

    let sql = `SELECT ${selectClause} \nFROM [${tableA}] A\n${joinType} [${tableB}] B ON `;
    const rows = document.querySelectorAll('.join-condition-row');

    if (rows.length === 0) return sql + "1=1";

    let conditions = [];
    rows.forEach(row => {
        const colA = row.querySelector('.join-col-a').value;
        const op = row.querySelector('.join-operator').value;
        const colB = row.querySelector('.join-col-b').value;
        const colB2 = row.querySelector('.join-col-b2').value;

        if (op === 'BETWEEN') {
            conditions.push(`A.[${colA}] BETWEEN B.[${colB}] AND B.[${colB2}]`);
        } else {
            conditions.push(`A.[${colA}] ${op} B.[${colB}]`);
        }
    });

    return sql + conditions.join(" AND ");
}

function addJoinConditionRow() {
    const container = document.getElementById('join-conditions-list');
    const rowId = 'join-row-' + Date.now();

    const colsA = joinColumnsCache.A.map(c => `<option value="${c}">${c}</option>`).join('');
    const colsB = joinColumnsCache.B.map(c => `<option value="${c}">${c}</option>`).join('');

    const rowHtml = `
    <div id="${rowId}" class="join-condition-row" style="display:flex; gap:8px; align-items:center; background:#f8f9fa; padding:8px; border:1px solid #dee2e6; border-radius:4px;">
        <span style="font-size:11px; font-weight:bold; color:#6c757d; width:35px;">A .</span>
        <select class="form-control join-col-a" onchange="updateJoinSqlPreview()" style="flex:1;">${colsA}</select>
        
        <select class="form-control join-operator" onchange="handleOperatorChange(this); updateJoinSqlPreview()" style="width:130px; font-weight:bold; color:#007bff;">
            <option value="=">= (Equals)</option>
            <option value=">=">>= (Greater/Eq)</option>
            <option value="<="><= (Less/Eq)</option>
            <option value=">">> (Greater)</option>
            <option value="<">< (Less)</option>
            <option value="BETWEEN">BETWEEN (Range)</option>
            <option value="LIKE">LIKE (Pattern)</option>
        </select>

        <span style="font-size:11px; font-weight:bold; color:#6c757d; width:35px;">B .</span>
        <select class="form-control join-col-b" onchange="updateJoinSqlPreview()" style="flex:1;">${colsB}</select>

        <!-- Hidden 2nd Column Input ONLY used when BETWEEN is selected -->
        <span class="between-and-label" style="display:none; font-size:11px; font-weight:bold; color:#6c757d;">AND B.</span>
        <select class="form-control join-col-b2" onchange="updateJoinSqlPreview()" style="display:none; flex:1;">${colsB}</select>

        <button onclick="document.getElementById('${rowId}').remove(); updateJoinSqlPreview();" style="background:none; border:none; color:#dc3545; cursor:pointer; font-weight:bold; padding:0 6px;">✖</button>
    </div>`;

    container.insertAdjacentHTML('beforeend', rowHtml);
    updateJoinSqlPreview();
}

// Automatically reveal the second dropdown when "BETWEEN" is chosen!
function handleOperatorChange(operatorSelect) {
    const row = operatorSelect.closest('.join-condition-row');
    const isBetween = (operatorSelect.value === 'BETWEEN');
    row.querySelector('.between-and-label').style.display = isBetween ? 'inline' : 'none';
    row.querySelector('.join-col-b2').style.display = isBetween ? 'block' : 'none';
}


function updateJoinSqlPreview() {
    const preview = document.getElementById('join-preview-box');
    preview.innerText = buildJoinSqlString();
}

async function executeAdvancedJoin() {
    const sqlQuery = buildJoinSqlString();
    if (!sqlQuery) {
        showToast("⚠️ Invalid join configuration.");
        return;
    }

    showToast("⏳ Executing custom join query...");

    try {
        // 1. Send the generated query to your existing C# backend endpoint
        const response = await fetch(`${apiURL}/custom-query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dbName: currentDatabase, query: sqlQuery })
        });

        const result = await response.json();

        if (!response.ok) {
            alert(`Join SQL Error:\n${result.error}`);
            return;
        }

        const batch = result.results || [];
        const dataItem = batch.find(item => item.type === 'data');

        if (!dataItem || !dataItem.data || dataItem.data.length === 0) {
            alert("The join executed successfully, but returned 0 matching records.");
            return;
        }

        // 2. We use your existing openSqlResultInWorkspace logic to load it into the dropdown!
        currentSqlBatchResults = batch;
        const dataIndex = batch.indexOf(dataItem);
        openSqlResultInWorkspace(dataIndex);
        saveQueryToSession(`📊 Joined View (${dataItem.data.length} rows)`, sqlQuery, currentDatabase);
        closeAdvancedJoinModal();
        showToast(`✅ Loaded Joined Workspace (${dataItem.data.length} records)!`);

    } catch (err) {
        console.error("Advanced Join error:", err);
        alert("A network error occurred while executing the join.");
    }
}

// =================================================================
// 1. UNIFIED EXPORT HANDLER
// =================================================================
function handleUnifiedExport() {
    const action = document.getElementById('exportActionSelect').value;
    // Directly pass 'filtered' or 'full' to your real export function:
    exportToCSV(action);
}

// =================================================================
// 2. UNIFIED TABLE SETTINGS MODAL
// =================================================================
function openTableSettingsModal() {
    const activeTable = document.getElementById('tableSelect').value;
    if (!activeTable) {
        showToast("⚠️ Please select an active table first.");
        return;
    }

    document.getElementById('settings-table-name-label').innerText = activeTable;
    document.getElementById('newTableNameInput').value = activeTable;

    // Build the column visibility checkboxes
    const container = document.getElementById('settings-columns-checkboxes');
    if (container && typeof visibleColumns !== 'undefined' && typeof currentColumns !== 'undefined') {
        container.innerHTML = currentColumns.map(col => {
            const isChecked = visibleColumns.includes(col);
            return `
                <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                    <input type="checkbox" value="${col}" ${isChecked ? 'checked' : ''} onchange="toggleColumnFromSettings('${col}')" />
                    <span>${col}</span>
                </label>`;
        }).join('');
    }

    document.getElementById('tableSettingsModal').style.display = 'flex';
}

function closeTableSettingsModal() {
    document.getElementById('tableSettingsModal').style.display = 'none';
    // Refresh table rendering if visibility changed
    if (typeof renderTable === 'function') renderTable();
}

function toggleColumnFromSettings(columnName) {
    if (typeof hideColumn === 'function' && typeof showColumn === 'function') {
        if (visibleColumns.includes(columnName)) {
            hideColumn(columnName);
        } else {
            showColumn(columnName);
        }
    }
}

function toggleAllColumnsVisibility(showAll) {
    if (typeof currentColumns === 'undefined') return;
    currentColumns.forEach(col => {
        const chk = document.querySelector(`#settings-columns-checkboxes input[value="${col}"]`);
        if (chk) chk.checked = showAll;
    });
    visibleColumns = showAll ? [...currentColumns] : [currentColumns[0]]; // Keep PK visible
    if (typeof renderTable === 'function') renderTable();
}

function executeRenameFromModal() {
    const newName = document.getElementById('newTableNameInput').value.trim();
    if (!newName) return;
    closeTableSettingsModal();
    // Call your existing rename table function
    if (typeof renameTable === 'function') renameTable(newName);
}

function executeDeleteTableFromModal() {
    closeTableSettingsModal();
    // Call your existing delete table function
    if (typeof deleteTable === 'function') deleteTable();
}

// =================================================================
// 3. UNIFIED SCHEMA & LINKS MODAL
// =================================================================
function openSchemaLinksModal() {
    document.getElementById('schemaLinksModal').style.display = 'flex';
    switchSchemaTab('map'); // Default to Schema Map
}

function closeSchemaLinksModal() {
    document.getElementById('schemaLinksModal').style.display = 'none';
}

function switchSchemaTab(tabName) {
    // Hide all panes
    document.querySelectorAll('.schema-tab-pane').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.schema-tab-btn').forEach(b => {
        b.style.borderBottom = 'none';
        b.style.fontWeight = 'normal';
        b.style.color = '#64748b';
    });

    // Activate selected tab
    const pane = document.getElementById(`schema-tab-pane-${tabName}`);
    const btn = document.getElementById(`schema-tab-btn-${tabName}`);
    if (pane) pane.style.display = 'block';
    if (btn) {
        btn.style.borderBottom = '2px solid #007bff';
        btn.style.fontWeight = 'bold';
        btn.style.color = '#007bff';
    }

    // Trigger your existing renderers when opening the tab
    if (tabName === 'map' && typeof renderSchemaMap === 'function') {
        renderSchemaMap('unified-schema-map-container');
    } else if (tabName === 'view' && typeof loadRelationshipsList === 'function') {
        loadRelationshipsList('unified-relationships-list');
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    
    const isCollapsed = sidebar.classList.contains('collapsed');
    
    // Toggle the open button on the Dashboard view
    const openBtnDash = document.getElementById('sidebarOpenBtnDash');
    if (openBtnDash) {
        openBtnDash.style.display = isCollapsed ? 'inline-flex' : 'none';
    }
    
    // Toggle the open button on the Workspace view
    const openBtnWorkspace = document.getElementById('sidebarOpenBtn');
    if (openBtnWorkspace) {
        openBtnWorkspace.style.display = isCollapsed ? 'inline-flex' : 'none';
    }
}

const SESSION_KEY = 'workspace_session_queries';

function saveQueryToSession(title, sqlQuery, dbName) {
    let sessionQueries = getSessionQueries();
    
    // Avoid saving duplicates if they run the exact same query twice
    const exists = sessionQueries.some(q => q.sqlQuery === sqlQuery && q.dbName === dbName);
    if (!exists) {
        sessionQueries.push({ title, sqlQuery, dbName });
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionQueries));
    }
}

function getSessionQueries(dbName) {
    const data = sessionStorage.getItem(SESSION_KEY);
    const allQueries = data ? JSON.parse(data) : [];
    
    // If a dbName is passed, ONLY return queries belonging to this specific workspace
    if (dbName) {
        return allQueries.filter(q => q.dbName === dbName);
    }
    return allQueries;
}

function clearSessionQueries() {
    sessionStorage.removeItem(SESSION_KEY);
}
async function recoverSessionWorkspace(silent = false) {
    const dropdown = document.getElementById('tableSelect');
    if (!dropdown) return;

    // Remove only old session query options
    const sessionOptions = dropdown.querySelectorAll('option[data-session-query="true"]');
    sessionOptions.forEach(opt => opt.remove());

    const savedQueries = getSessionQueries(currentDatabase);
    if (savedQueries.length === 0) return;

    for (let i = 0; i < savedQueries.length; i++) {
        const item = savedQueries[i];

        // Guard: check if already present
        const alreadyExists = Array.from(dropdown.options).some(opt => opt.value === item.title);
        if (alreadyExists) continue; 

        try {
            const response = await fetch(`${apiURL}/custom-query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dbName: item.dbName, query: item.sqlQuery })
            });

            const result = await response.json();
            if (response.ok && result.results) {
                const batch = result.results;
                const dataItem = batch.find(r => r.type === 'data');
                if (dataItem && dataItem.data) {
                    currentSqlBatchResults = batch;
                    const dataIndex = batch.indexOf(dataItem);
                    
                    // Pass item.title and silent = true to avoid toasts and keep exact names/numbers
                    openSqlResultInWorkspace(dataIndex, item.title, !silent); 
                }
            }
        } catch (e) {
            console.warn("Could not restore session query:", item.title, e);
        }
    }
}

// Trigger recovery automatically after the DOM finishes loading:
window.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure default DB/tables load first
    setTimeout(recoverSessionWorkspace, 600);
});
document.addEventListener("DOMContentLoaded", () => {
  const contextMenu = document.getElementById("custom-context-menu");
  // We attach to 'data-container' because it ALWAYS exists in the HTML!
  const tableContainer = document.getElementById("data-container"); 
  let currentTargetCell = null;

  // 1. Intercept Right-Click inside the Spreadsheet Container
  tableContainer.addEventListener("contextmenu", (e) => {
    // Check if the user right-clicked a table header (th) or data cell (td)
    const cell = e.target.closest("th, td");
    if (!cell) return;

    e.preventDefault(); // Stop default browser menu
    currentTargetCell = cell;

    // Determine if it's a header or standard cell
    const isHeader = cell.tagName.toLowerCase() === "th";
    toggleContextualItems(isHeader);

    // Position & Show the menu (with viewport collision protection)
    positionMenu(e.clientX, e.clientY);
    contextMenu.classList.remove("hidden");
  });

  // 2. Hide specific menu items depending on cell type (<th> vs <td>)
  function toggleContextualItems(isHeader) {
    const headerItems = contextMenu.querySelectorAll(".header-only");
    const cellItems = contextMenu.querySelectorAll(".cell-only");

    headerItems.forEach(item => item.style.display = isHeader ? "flex" : "none");
    cellItems.forEach(item => item.style.display = isHeader ? "none" : "flex");
  }

  // 3. Viewport Collision Prevention
  function positionMenu(clickX, clickY) {
    const menuWidth = contextMenu.offsetWidth || 230;
    const menuHeight = contextMenu.offsetHeight || 200;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    const left = (clickX + menuWidth > windowWidth) ? clickX - menuWidth : clickX;
    const top = (clickY + menuHeight > windowHeight) ? clickY - menuHeight : clickY;

    contextMenu.style.left = `${left + window.scrollX}px`;
    contextMenu.style.top = `${top + window.scrollY}px`;
  }

  // 4. Handle Menu Item Clicks
  contextMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".menu-item");
    if (!item || !currentTargetCell) return;

    const action = item.dataset.action;
    executeAction(action, currentTargetCell);
    hideMenu();
  });

  // 5. Execute Action Router (wired to modals)
  function executeAction(action, cell) {
    // clean up column names in case they have sort arrows attached
    let rawText = cell.innerText.replace(' ▲', '').replace(' ▼', '').replace('(PK)', '').trim();
    // For headers that have the "(hide)" button text inside them, grab only the first word
    const columnName = rawText.split('\n')[0].trim();

    switch (action) {
      case "copy-cell":
        const textToCopy = cell.innerText.trim();
        navigator.clipboard.writeText(textToCopy);
        showToast(`Copied "${cell.innerText}" to clipboard`);
        break;

      case "insert-row-above":
        // Triggers your existing Add Row modal!
        showAddRowModal(); 
        break;

      case "rename-column":
        // Triggers your existing clean column rename modal!
        openRenameSpecificColumn(columnName);
        break;

      case "delete-column":
        // Triggers your existing red warning modal for column deletion!
        promptDeleteColumn(columnName);
        break;

      case "view-foreign-keys":
        // Triggers your existing Mermaid Schema Map modal!
        openJoinViewModal();
        break;

      case "rename-table":
        // Triggers your existing Table Rename prompt!
        promptRenameTable();
        break;
    }
  }

  // 6. Global Menu Dismissal Listeners
  function hideMenu() {
    contextMenu.classList.add("hidden");
    currentTargetCell = null;
  }

  document.addEventListener("click", (e) => {
    if (!contextMenu.contains(e.target)) hideMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideMenu();
  });

  window.addEventListener("scroll", hideMenu, { passive: true });
});
let currentHistoryIndex = 0;

// 1. Set the initial baseline state when the page boots
window.addEventListener("DOMContentLoaded", () => {
    history.replaceState({ index: 0 }, document.title, window.location.href);
});

// 2. Helper: Call this whenever an action is pushed to your undoStack!
function syncBrowserHistory() {
    currentHistoryIndex++;
    history.pushState({ index: currentHistoryIndex }, document.title, window.location.href);
}

// MULTI-COLUMN FILTER ENGINE (Supports Normal Tables & SQL Queries)
// =================================================================

function showMultiFilterModal() {
    renderFilterRowsUI();
    document.getElementById('multiFilterModal').style.display = 'flex';
}

function closeMultiFilterModal() {
    document.getElementById('multiFilterModal').style.display = 'none';
}

// Detect column data type using Schema Cache OR inspecting live row values (for SQL Views)
function getColumnDataType(colName) {
    // 1. Try checking backend SQL schema first
    const schemaCol = currentTableSchemaCache.find(c => c.ColumnName === colName);
    if (schemaCol && schemaCol.DataType) {
        const dt = schemaCol.DataType.toLowerCase();
        if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'money', 'float', 'real'].includes(dt)) {
            return 'number';
        }
        if (['date', 'datetime', 'datetime2', 'timestamp'].includes(dt)) {
            return 'date';
        }
        return 'text';
    }

    // 2. Fallback for SQL Query views: inspect first non-null value in masterTableData
    for (let row of masterTableData) {
        let val = row[colName];
        if (val !== null && val !== undefined && val !== '') {
            let str = String(val).trim();
            // Check if valid number
            if (!isNaN(Number(str))) return 'number';
            // Check if date format (YYYY-MM-DD or contains date separators)
            if (/^\d{4}[-/.]\d{2}[-/.]\d{2}/.test(str)) return 'date';
            return 'text';
        }
    }
    return 'text'; // Default
}

// Add a new blank filter row
function addFilterRow(defaultCol = null) {
    if (!currentColumns || currentColumns.length === 0) return;
    const col = defaultCol || currentColumns[0];
    const type = getColumnDataType(col);

    activeMultiFilters.push({
        id: 'filter_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        column: col,
        type: type,
        operator: type === 'text' ? 'starts_with' : 'smaller',
        val1: '',
        val2: '',
        selectedForClear: false
    });

    renderFilterRowsUI();
}

// Render all filter rows inside the modal
function renderFilterRowsUI() {
    const container = document.getElementById('filter-rows-container');
    const clearTools = document.getElementById('filter-clear-tools');
    
    if (activeMultiFilters.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:#64748b; padding:20px; font-style:italic;">No active filters. Click "+ Add Filter on a Column" below to start.</p>`;
        clearTools.style.display = 'none';
        updateFilterBadgeUI();
        return;
    }

    clearTools.style.display = 'flex';
    updateSelectedClearCountUI();

    let html = '';
    activeMultiFilters.forEach((filter, idx) => {
        // Build Column Options
        const colOptions = currentColumns.map(c => 
            `<option value="${c}" ${c === filter.column ? 'selected' : ''}>${c}</option>`
        ).join('');

        // Build Operator Options based on Data Type
        let opOptions = '';
        if (filter.type === 'number' || filter.type === 'date') {
            opOptions = `
                <option value="smaller" ${filter.operator === 'smaller' ? 'selected' : ''}>Smaller (<)</option>
                <option value="bigger" ${filter.operator === 'bigger' ? 'selected' : ''}>Bigger (>)</option>
                <option value="like" ${filter.operator === 'like' ? 'selected' : ''}>Like / Equals (=)</option>
                <option value="interval" ${filter.operator === 'interval' ? 'selected' : ''}>Interval (Between)</option>
            `;
        } else {
            opOptions = `
                <option value="starts_with" ${filter.operator === 'starts_with' ? 'selected' : ''}>Starts With</option>
                <option value="ends_with" ${filter.operator === 'ends_with' ? 'selected' : ''}>Ends With</option>
                <option value="contains" ${filter.operator === 'contains' ? 'selected' : ''}>Contains</option>
            `;
        }

        // Build Input Fields (Dual inputs appear when operator === 'interval')
        const inputType = filter.type === 'number' ? 'number' : (filter.type === 'date' ? 'date' : 'text');
        const isInterval = filter.operator === 'interval';

        html += `
        <div style="display:flex; align-items:center; gap:8px; background:#f8fafc; border:1px solid #e2e8f0; padding:10px; border-radius:6px;">
            <!-- Checkbox for selective clearing -->
            <input type="checkbox" onchange="toggleSelectFilterForClear(${idx}, this.checked)" ${filter.selectedForClear ? 'checked' : ''} title="Select to clear" style="cursor:pointer;" />
            
            <!-- Column Selector -->
            <select onchange="handleFilterColumnChange(${idx}, this.value)" class="form-control" style="width:160px; font-weight:bold;">
                ${colOptions}
            </select>

            <!-- Operator Selector -->
            <select onchange="handleFilterOperatorChange(${idx}, this.value)" class="form-control" style="width:140px; color:#4f46e5; font-weight:bold;">
                ${opOptions}
            </select>

            <!-- Input Value 1 -->
            <input type="${inputType}" value="${filter.val1}" oninput="activeMultiFilters[${idx}].val1 = this.value" placeholder="Value..." class="form-control" style="flex:1;" />

            <!-- Input Value 2 (ONLY visible for Interval / Between) -->
            <span id="label-and-${filter.id}" style="display:${isInterval ? 'inline' : 'none'}; font-size:12px; font-weight:bold; color:#64748b;">AND</span>
            <input type="${inputType}" value="${filter.val2}" oninput="activeMultiFilters[${idx}].val2 = this.value" placeholder="End Value..." id="val2-${filter.id}" class="form-control" style="flex:1; display:${isInterval ? 'block' : 'none'};" />

            <!-- Single Row Remove Button -->
            <button onclick="removeFilterRow(${idx})" style="background:none; border:none; color:#dc3545; cursor:pointer; font-size:16px; font-weight:bold; padding:0 6px;" title="Remove filter">✖</button>
        </div>`;
    });

    container.innerHTML = html;
}

// Handlers for dropdown changes inside the modal
function handleFilterColumnChange(idx, newCol) {
    const type = getColumnDataType(newCol);
    activeMultiFilters[idx].column = newCol;
    activeMultiFilters[idx].type = type;
    activeMultiFilters[idx].operator = type === 'text' ? 'starts_with' : 'smaller';
    activeMultiFilters[idx].val1 = '';
    activeMultiFilters[idx].val2 = '';
    renderFilterRowsUI();
}

function handleFilterOperatorChange(idx, newOp) {
    activeMultiFilters[idx].operator = newOp;
    renderFilterRowsUI();
}

function toggleSelectFilterForClear(idx, isChecked) {
    activeMultiFilters[idx].selectedForClear = isChecked;
    updateSelectedClearCountUI();
}

function updateSelectedClearCountUI() {
    const count = activeMultiFilters.filter(f => f.selectedForClear).length;
    const countEl = document.getElementById('selected-filter-count');
    if (countEl) countEl.innerText = count;
}

function removeFilterRow(idx) {
    activeMultiFilters.splice(idx, 1);
    renderFilterRowsUI();
    applyMultiColumnFilters();
}

// Clear ONLY checkboxes that were selected
function clearSelectedFilters() {
    activeMultiFilters = activeMultiFilters.filter(f => !f.selectedForClear);
    renderFilterRowsUI();
    applyMultiColumnFilters();
}

// Clear everything
function clearAllFilters() {
    activeMultiFilters = [];
    renderFilterRowsUI();
    applyMultiColumnFilters();
}

function updateFilterBadgeUI() {
    const badge = document.getElementById('active-filters-badge');
    if (!badge) return;
    if (activeMultiFilters.length > 0) {
        badge.style.display = 'inline-flex';
        badge.innerText = ` ${activeMultiFilters.length} Active Filter${activeMultiFilters.length > 1 ? 's' : ''}`;
    } else {
        badge.style.display = 'none';
    }
}

// APPLY ALL ACTIVE FILTERS AGAINST MASTER TABLE DATA
function applyMultiColumnFilters() {
    updateFilterBadgeUI();

    // If no filters are active, restore full table from master cache
    if (activeMultiFilters.length === 0) {
        globalTableData = [...masterTableData];
        currentPage = 1;
        renderTable();
        return;
    }

    // Filter masterTableData through every active condition
    globalTableData = masterTableData.filter(row => {
        return activeMultiFilters.every(filter => {
            if (filter.val1 === '' && filter.operator !== 'interval') return true; // Ignore empty filters

            let cellVal = row[filter.column];
            if (cellVal === null || cellVal === undefined) return false;

            // --- TEXT FILTERS ---
            if (filter.type === 'text') {
                const str = String(cellVal).toLowerCase();
                const target = String(filter.val1).toLowerCase();
                if (filter.operator === 'starts_with') return str.startsWith(target);
                if (filter.operator === 'ends_with') return str.endsWith(target);
                if (filter.operator === 'contains') return str.includes(target);
            }

            // --- NUMBER / DATE FILTERS ---
            if (filter.type === 'number' || filter.type === 'date') {
                let numCell, num1, num2;
                if (filter.type === 'date') {
                    numCell = new Date(cellVal).getTime();
                    num1 = new Date(filter.val1).getTime();
                    num2 = new Date(filter.val2).getTime();
                } else {
                    numCell = Number(cellVal);
                    num1 = Number(filter.val1);
                    num2 = Number(filter.val2);
                }

                if (isNaN(numCell) || isNaN(num1)) return false;

                if (filter.operator === 'smaller') return numCell < num1;
                if (filter.operator === 'bigger') return numCell > num1;
                if (filter.operator === 'like') return String(cellVal).toLowerCase().includes(String(filter.val1).toLowerCase());
                if (filter.operator === 'interval') {
                    if (isNaN(num2)) return false;
                    const min = Math.min(num1, num2);
                    const max = Math.max(num1, num2);
                    return numCell >= min && numCell <= max;
                }
            }
            return true;
        });
    });

    currentPage = 1; // Reset pagination to Page 1
    renderTable();
    showToast(`Filtered to ${globalTableData.length} matching records`);
}

// 3. Listen for clicks on the browser's top-left Back (<-) and Forward (->) arrows
window.addEventListener("popstate", (event) => {
    const newIndex = (event.state && typeof event.state.index === "number") ? event.state.index : 0;

    if (newIndex < currentHistoryIndex) {
        // User clicked Browser BACK arrow
        if (undoStack.length === 0) {
            // No undo possible, give the user feedback
            showToast("⚠️ Undo history was cleared by a structural schema change.");
            console.log("[History] Back arrow clicked, but undo stack is empty.");
        } else {
            console.log("[Browser Navigation] Back arrow detected -> Undoing last action");
            undoLastAction();
        }
    } else if (newIndex > currentHistoryIndex) {
        // User clicked Browser FORWARD arrow
        if (redoStack.length === 0) {
            console.log("[History] Forward arrow clicked, but redo stack is empty.");
            showToast("⚠️ Nothing to redo!");
        } else {
            console.log("[Browser NaviFgation] Forward arrow detected -> Redoing last action");
            redoLastAction();
        }
    }

    currentHistoryIndex = newIndex;
});
document.addEventListener('keydown', function(event) {
    // Detects Ctrl + Z (or Cmd + Z on Mac)
   if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'z') {
            event.preventDefault(); 
            if (undoStack.length > 0) {
                history.back();
            } else {
                // ADDED THIS ELSE BLOCK:
                showToast("⚠️ Nothing to undo!");
            }
        } else if (event.key.toLowerCase() === 'y') {
            event.preventDefault();
            if (redoStack.length > 0) {
                history.forward();
            } else {
                // ADDED THIS ELSE BLOCK:
                showToast("⚠️ Nothing to redo!");
            }
        }
    }
    // Allow Left/Right arrow keys to seamlessly scroll the table
    // SAFETY CHECK: Make sure the user isn't currently typing in an input box!
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        const wrapper = document.getElementById('table-scroll-wrapper');
        if (wrapper) {
            if (event.key === 'ArrowRight') {
                wrapper.scrollLeft += 50; // Scroll 50px right
            } else if (event.key === 'ArrowLeft') {
                wrapper.scrollLeft -= 50; // Scroll 50px left
            }
        }
    }
});

// Real, Visual Toast Notification System
function showToast(message) {
  // 1. Check if our toast container exists yet; if not, create it
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = "position: fixed; bottom: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 10px;";
    document.body.appendChild(container);
  }

  // 2. Create the toast element
  const toast = document.createElement("div");
  toast.innerText = message;
  toast.style.cssText = `
    background-color: #1f2937;
    color: #ffffff;
    padding: 12px 18px;
    border-radius: 6px;
    font-family: sans-serif;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    border-left: 4px solid #f59e0b;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.25s ease;
    max-width: 320px;
  `;

  container.appendChild(toast);

  // 3. Trigger slide-in animation
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  // 4. Automatically slide out and remove after 3.5 seconds
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}
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