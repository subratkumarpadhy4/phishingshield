/**
 * PhishingShield Antivirus Logic (VirusTotal Integration)
 * Matches the VirusTotal-like interface in dashboard.html
 */

// Tab Switching
function switchVtTab(tabName) {
    const tabs = document.querySelectorAll('.vt-tab');
    const sections = document.querySelectorAll('.vt-section');

    // Reset Tabs
    tabs.forEach(t => {
        t.style.borderBottomColor = 'transparent';
        t.style.color = 'var(--secondary)';
        t.classList.remove('active');
    });

    // Reset Sections
    sections.forEach(s => s.style.display = 'none');

    // Activate Selected
    const activeTab = document.querySelector(`.vt-tab[onclick*="'${tabName}'"]`);
    if (activeTab) {
        activeTab.style.borderBottomColor = 'var(--primary)';
        activeTab.style.color = 'var(--primary)';
        activeTab.classList.add('active');
    }

    const activeSection = document.getElementById(`vt-section-${tabName}`);
    if (activeSection) {
        activeSection.style.display = 'block';
    }
}

// ------------------------------------------------------------------
// FILE SCANNING (Client-side Hash -> Backend Lookup)
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// FILE SCANNING (Client-side Hash -> Backend Lookup)
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    // 1. File Input Listener
    const fileInput = document.getElementById('vt-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                startFileScan(file);
            }
        });
    }

    // 2. Scan URL Button
    const btnScanUrl = document.getElementById('btn-scan-url');
    if (btnScanUrl) {
        btnScanUrl.addEventListener('click', scanUrl);
    }

    // 3. Scan Search Button
    const btnScanSearch = document.getElementById('btn-scan-search');
    if (btnScanSearch) {
        btnScanSearch.addEventListener('click', scanSearch);
    }

    // 4. Tab Switching (CSP Safe)
    const tabs = document.querySelectorAll('.vt-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Derive tab name from text: FILE -> file
            const tabName = tab.textContent.trim().toLowerCase();
            switchVtTab(tabName);
        });
    });
});

async function startFileScan(file) {
    showLoading();
    try {
        // 1. Calculate SHA-256 Hash
        const hash = await calculateFileHash(file);
        console.log("File Hash:", hash);

        // 2. Send Hash to Backend
        fetchVTAnalysis(hash, 'file', file.name);

    } catch (error) {
        console.error("File hashing failed:", error);
        alert("Error reading file.");
        hideLoading();
    }
}

async function calculateFileHash(file) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------
// URL SCANNING
// ------------------------------------------------------------------
function scanUrl() {
    const urlInput = document.getElementById('vt-url-input');
    const url = urlInput.value.trim();
    if (!url) return alert("Please enter a URL");

    showLoading();

    // First, submit URL for scanning (POST)
    // Actually, backend can handle the complexity: 
    // If backend logic is simple, we might just call /scan with type 'url'
    fetchVTAnalysis(url, 'url', url);
}

// ------------------------------------------------------------------
// SEARCH SCANNING
// ------------------------------------------------------------------
function scanSearch() {
    const input = document.getElementById('vt-search-input');
    const query = input.value.trim();
    if (!query) return alert("Please enter a search term");

    showLoading();

    // Determine type roughly? 
    // Or let backend handle "search" type which tries to guess
    // For now, assume it's a hash or domain/ip, handled same as 'url' or 'file' logic in backend?
    // VT API has specific endpoints for IP, Domain, Hash.
    // We'll send type 'search' and query.
    fetchVTAnalysis(query, 'search', query);
}

// ------------------------------------------------------------------
// BACKEND API CALL
// ------------------------------------------------------------------
async function fetchVTAnalysis(resource, type, displayName) {
    try {
        // Ensure API_BASE available
        const baseUrl = (typeof API_BASE !== 'undefined') ? API_BASE : "https://phishingshield-ruby.vercel.app/api";

        console.log(`[Antivirus] Scanning ${type}: ${resource} at ${baseUrl}/antivirus/scan`);

        const response = await fetch(`${baseUrl}/antivirus/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resource, type })
        });

        // Check for HTTP errors
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server returned ${response.status}: ${errText}`);
        }

        const data = await response.json();

        if (data.success) {
            renderResults(data.result, displayName);
        } else {
            console.warn("[Antivirus] Scan returned unsuccessful:", data);

            if (data.message && data.message.includes("Scan started")) {
                // Formatting for queued URL scan
                alert("ℹ️ " + data.message);
            } else if (data.message && (data.message.includes("not found") || data.message.includes("not in VirusTotal"))) {
                // Graceful handling for unknown files
                alert("ℹ️ No Detection Found\n\nThis file/resource has not been analyzed by VirusTotal before. \n\nThis usually means the file is new or private.");
            } else {
                // Actual errors
                alert("⚠️ Scan Error: " + (data.message || "Unknown error"));
            }
            hideLoading();
        }

    } catch (error) {
        console.error("VT API Error:", error);
        alert(`❌ Connection Failed: ${error.message}`);
        hideLoading();
    }
}

// ------------------------------------------------------------------
// RENDERING
// ------------------------------------------------------------------
function showLoading() {
    document.getElementById('vt-results').style.display = 'none';
    document.getElementById('vt-loading').style.display = 'block';
}

function hideLoading() {
    document.getElementById('vt-loading').style.display = 'none';
}

function renderResults(data, displayName) {
    hideLoading();
    document.getElementById('vt-results').style.display = 'block';

    // 1. Update Header
    document.getElementById('vt-res-target').textContent = displayName || "Unknown";
    // Date formatting if available in data
    const dateStr = data.last_analysis_date ? new Date(data.last_analysis_date * 1000).toLocaleString() : "Just now";
    document.getElementById('vt-res-date').textContent = dateStr;

    // 2. Score
    // data.last_analysis_stats: { malicious, suspicious, harmless, undetected }
    const stats = data.last_analysis_stats || { malicious: 0, harmless: 0, undetected: 0 };
    const total = (stats.malicious || 0) + (stats.suspicious || 0) + (stats.harmless || 0) + (stats.undetected || 0); // Approx
    const positives = (stats.malicious || 0) + (stats.suspicious || 0);

    document.getElementById('vt-positives').textContent = positives;
    document.getElementById('vt-total').textContent = total > 0 ? total : Object.keys(data.last_analysis_results || {}).length;

    const badge = document.getElementById('vt-score-badge');
    if (positives > 0) {
        badge.style.borderColor = '#ef4444';
        badge.style.color = '#ef4444';
    } else {
        badge.style.borderColor = '#10b981';
        badge.style.color = '#10b981';
    }

    // 3. Render Engines
    const grid = document.getElementById('vt-engines-grid');
    grid.innerHTML = '';

    const results = data.last_analysis_results || {};
    // Convert to array and sort (Positives first)
    const entries = Object.entries(results).sort((a, b) => {
        const catA = a[1].category;
        const catB = b[1].category;
        if (catA === 'malicious' && catB !== 'malicious') return -1;
        if (catA !== 'malicious' && catB === 'malicious') return 1;
        return 0;
    });

    entries.forEach(([engineName, result]) => {
        const card = document.createElement('div');
        card.style.cssText = `
            padding: 10px; 
            border: 1px solid #e2e8f0; 
            border-radius: 8px; 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            font-size: 12px;
        `;

        let statusColor = '#94a3b8'; // gray
        let statusIcon = '❔';

        if (result.category === 'malicious') {
            statusColor = '#ef4444'; // red
            statusIcon = '🦠';
        } else if (result.category === 'suspicious') {
            statusColor = '#f59e0b'; // orange
            statusIcon = '⚠️';
        } else if (result.category === 'harmless' || result.category === 'undetected') {
            statusColor = '#10b981'; // green
            statusIcon = '✅';
        }

        card.innerHTML = `
            <span style="font-weight: 600; color: var(--dark);">${engineName}</span>
            <span style="color: ${statusColor}; font-weight: bold;">${statusIcon} ${result.result || result.category}</span>
        `;

        grid.appendChild(card);
    });
}
