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
        html += '</tr>';

        const totalPages = Math.ceil(globalTableData.length / rowsPerPage);
        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = startIndex + rowsPerPage;
        const paginatedRows = globalTableData.slice(startIndex, endIndex);

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
            // Safety net for actual long text (like the Notes column!)
            
                html += `<td>${cellData}</td>`;
            });
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