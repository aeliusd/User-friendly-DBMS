const apiURL = 'https://localhost:7162/api/tables';
let currentColumns = [];
let ActiveTableName = '';

async function loadTables() {
    try {
        const response = await fetch(apiURL);
        const tables = await response.json();
        const listElement = document.getElementById('table-list');
        listElement.innerHTML = '';

        tables.forEach(table => {
            const listItem = document.createElement('li');
            listItem.textContent = table;
            listItem.style.color = 'blue';
            listItem.style.cursor = 'pointer';

            listItem.onclick = () => {
                document.getElementById('search-box').value = '';
                document.getElementById('exact-match-checkbox').checked = false;
                document.getElementById('column-dropdown').innerHTML = '<option value="ALL">All Columns</option>';
                loadTableData(table);
            }
            listElement.appendChild(listItem);
        });
    }
    catch (error) {
        console.error('Error fetching tables:', error);
        document.getElementById('table-list').innerHTML = '<li>Error fetching tables</li>';
    }
}

async function loadTableData(tableName, searchQuery = '', isExactMatch = false, searchColumn = 'ALL') {
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

        let html = '<table border="1" cellpadding="5" cellspacing="0"><tr>';

        currentColumns.forEach(column => {
            html += `<th>${column}</th>`;
        });
        html += '</tr>';

        rows.forEach(row => {
            html += '<tr>';
            currentColumns.forEach(column => {
                const cellData = row[column] !== null ? row[column] : '';
                html += `<td>${cellData}</td>`;
            });
            html += '</tr>';
        });
        html += '</table>';
        container.innerHTML = `<h2> Data for: ${tableName}</h2>` + html;

    }
    catch (error) {
        console.error(`Error fetching data for table ${tableName}:`, error);
        container.innerHTML = '<p> Error fetching table data</p>';
    }
}
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

function clearSearch() {
    document.getElementById('search-box').value = '';
    document.getElementById('exact-match-checkbox').checked = false; // Uncheck the box
    document.getElementById('column-dropdown').value = 'ALL';
    loadTableData(ActiveTableName, '', false, 'ALL');
}


loadTables();