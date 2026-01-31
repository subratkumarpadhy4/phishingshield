// Use existing API config if available (e.g., from auth.js), otherwise define it
if (typeof window.DEV_MODE === 'undefined') {
    window.DEV_MODE = false; // FORCE LOCALHOST
}
// Force it again just to be sure
window.DEV_MODE = false;

if (typeof window.API_BASE === 'undefined') {
    window.API_BASE = window.DEV_MODE ? "http://localhost:3000/api" : "https://phishingshield-ruby.vercel.app/api";
}

console.log(`[ADMIN] Running in ${window.DEV_MODE ? 'DEVELOPMENT' : 'PRODUCTION'} mode`);
console.log(`[ADMIN] API Base: ${window.API_BASE}`);
var API_BASE = window.API_BASE; // Local alias for convenience

// REPORTS FILTER STATE
let allReportsCache = [];
let currentReportFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
    // 0. SECURITY HANDSHAKE
    checkAdminAccess();



    // 1. Sidebar Navigation Logic
    const navLinks = document.querySelectorAll('.nav-link');
    const tabs = document.querySelectorAll('.tab-content');
    const pageTitle = document.getElementById('page-title');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            // Remove active classes
            navLinks.forEach(l => l.classList.remove('active'));
            tabs.forEach(t => t.classList.remove('active'));

            // Activate content
            link.classList.add('active');
            const tabId = link.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');

            // Update Title
            pageTitle.textContent = link.textContent.replace(/^.\s/, ''); // Remove emoji

            // Special Tab Logic
            if (tabId === 'banned-sites') {
                loadBannedSites();
            }
        });
    });

    // Handle "View All" button
    document.getElementById('view-all-users').addEventListener('click', () => {
        document.querySelector('[data-tab="users"]').click();
    });

    // 2. Set Date
    const now = new Date();
    document.getElementById('current-date').textContent = now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // 3. Load Data from Storage
    loadDashboardData();

    // 4. Debug / Simulation Tools
    setupDebugTools();

    // 5. Setup Modal Handlers (Replaces inline onclicks)
    setupModalHandlers();

    // 6. Setup Report Filter Handlers (Safely attached)
    setupReportFilters();

    // 7. Setup Trust Filter Handlers
    setupTrustFilters();

    // 8. Keep-Alive Service (Robust)
    connectKeepAlive();
});

let keepAlivePort;
function connectKeepAlive() {
    if (!chrome.runtime || !chrome.runtime.connect) return;
    try {
        keepAlivePort = chrome.runtime.connect({ name: 'keepAlive' });
        keepAlivePort.onDisconnect.addListener(() => {
            // Reconnect logic
            setTimeout(connectKeepAlive, 5000);
        });
    } catch (e) {
        console.warn('Keep-Alive failed', e);
    }
}

// TRUST FILTER LOGIC
// TRUST FILTER LOGIC
function setupTrustFilters() {
    const searchInput = document.getElementById('trust-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();

            if (window.trustDataCache) {
                const filtered = window.trustDataCache.filter(item => {
                    return !query ||
                        (item.domain && item.domain.toLowerCase().includes(query)) ||
                        (item.url && item.url.toLowerCase().includes(query)) ||
                        (item.reporter && item.reporter.toLowerCase().includes(query)); // Added per request
                });
                renderTrustTable(filtered);
            }
        });
    }
}

function setupReportFilters() {
    // 1. Search Logic
    const searchInput = document.getElementById('reports-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            // Apply Filters (Search + Status + Rank)
            triggerFilterUpdate();
        });
    }

    // 2. Filter Tabs & Rank Filter
    const filters = ['all', 'pending', 'banned', 'ignored'];
    filters.forEach(status => {
        const btn = document.getElementById(`filter-${status}`);
        if (btn) {
            btn.onclick = null;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                setReportFilter(status); // This sets the global currentReportFilter
                triggerFilterUpdate();
            });
        }
    });

    const rankFilter = document.getElementById('filter-rank');
    if (rankFilter) {
        rankFilter.addEventListener('change', () => {
            triggerFilterUpdate();
        });
    }

    // Consolidated Filter Logic
    function triggerFilterUpdate() {
        // Need to grab users AND current admin info
        chrome.storage.local.get(['users', 'currentUser', 'userLevel'], (data) => {
            const users = data.users || [];
            const currentUser = data.currentUser || {};
            const localLevel = data.userLevel || 1;

            // Build User Rank Map: email -> rankName
            const userRankMap = {};

            // 1. Map all regular users
            console.log(`[Admin Filter] Validating ${users.length} users for Rank Map...`);
            users.forEach(u => {
                const emailKey = (u.email || '').toLowerCase().trim();
                if (!emailKey) return;

                const level = u.level || 1;
                let rank = 'novice';
                if (level >= 20) rank = 'sentinel';
                else if (level >= 5) rank = 'scout';

                userRankMap[emailKey] = rank;

                // Specific Debug for Known Users
                if (emailKey.includes('gopa') || emailKey.includes('rajkumar')) {
                    console.log(`[Admin Filter] Mapped: ${emailKey} -> Level ${level} (${rank})`);
                }
            });

            // 2. Explicitly map the Current User (Admin/Self)
            const adminEmail = (currentUser.email || '').toLowerCase().trim();
            if (adminEmail) {
                let myRank = 'novice';
                if (localLevel >= 20) myRank = 'sentinel';
                else if (localLevel >= 5) myRank = 'scout';

                userRankMap[adminEmail] = myRank;
                console.log(`[Admin] Self-Mapped (Force Override): ${adminEmail} -> ${myRank} (Lvl ${localLevel})`);
            }

            const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
            const status = currentReportFilter;
            const targetRank = rankFilter ? rankFilter.value : 'all';

            const filtered = allReportsCache.filter(r => {
                // 1. Text Search
                const matchesSearch = !query ||
                    (r.url && r.url.toLowerCase().includes(query)) ||
                    (r.reporter && r.reporter.toLowerCase().includes(query));

                // 2. Status Filter
                const matchesStatus = status === 'all' || r.status === status;

                // 3. Rank Filter
                let matchesRank = true;
                if (targetRank !== 'all') {
                    // Normalize reporter email
                    let rawEmail = r.reporterEmail || r.reporter || '';

                    // EXTRACT EMAIL FROM FORMAT "Name (email)"
                    if (rawEmail.includes('(') && rawEmail.includes(')')) {
                        const parts = rawEmail.split('(');
                        if (parts.length > 1) {
                            rawEmail = parts[parts.length - 1].replace(')', '').trim();
                        }
                    }

                    const reporterKey = rawEmail.toLowerCase().trim();

                    // Lookup Rank (Default to 'novice' if not found)
                    const actualRank = reporterKey && userRankMap[reporterKey] ? userRankMap[reporterKey] : 'novice';

                    // DEBUG: Log mismatch explanation if this is the admin
                    if (reporterKey === adminEmail && actualRank !== targetRank && targetRank === 'sentinel') {
                        console.warn(`[Filter Debug] Admin Report (${reporterKey}) classified as ${actualRank}, but filter wanted ${targetRank}. Map Value:`, userRankMap[reporterKey]);
                    }

                    matchesRank = (actualRank === targetRank);
                }

                return matchesSearch && matchesStatus && matchesRank;
            });

            renderReports(filtered);
        });
    }

    // 3. Refresh Button
    const refreshReportsBtn = document.getElementById('btn-refresh-reports');
    if (refreshReportsBtn) {
        refreshReportsBtn.onclick = null;
        refreshReportsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const originalText = refreshReportsBtn.innerText;
            refreshReportsBtn.innerText = "Refreshing...";
            refreshReportsBtn.disabled = true;

            // Clear cache
            allReportsCache = [];

            // Clear search input to prevent stale filters
            const searchInput = document.getElementById('reports-search');
            if (searchInput) searchInput.value = '';

            // Force Sync of Users too (to fix rank filter issues)
            if (typeof Auth !== 'undefined' && Auth.getUsers) {
                console.log("[Admin] Force-Refeshing User Roster...");
                Auth.getUsers(() => { console.log("[Admin] User Roster Updated"); });
            }

            chrome.storage.local.set({ cachedGlobalReports: [] }, () => {
                console.log('[Admin] Cache cleared, reloading reports...');
                loadDashboardData();
                setTimeout(() => {
                    refreshReportsBtn.innerText = originalText;
                    refreshReportsBtn.disabled = false;
                }, 2000);
            });
        });
    }

    // 4. Delete All / Cleanup Button (Preserve Banned)
    const btnDeleteAll = document.getElementById('btn-delete-all-reports');
    if (btnDeleteAll) {
        // Use .onclick to prevent duplicate listeners
        btnDeleteAll.onclick = async (e) => {
            e.preventDefault();

            if (confirm("Are you sure you want to delete ALL non-banned reports?\n\nThis action will clear pending and ignored reports but keep Banned sites intact.")) {
                const originalText = btnDeleteAll.innerText;
                btnDeleteAll.innerText = "Deleting...";
                btnDeleteAll.disabled = true;

                try {
                    // Update Server
                    const res = await fetch(`${API_BASE}/reports/cleanup`, { method: 'POST' });

                    // Check for JSON response
                    const contentType = res.headers.get("content-type");
                    if (!contentType || !contentType.includes("application/json")) {
                        throw new Error(`Server returned non-JSON response (${res.status}). API might be deploying.`);
                    }

                    const data = await res.json();

                    if (!res.ok) throw new Error(data.message || 'Server error');

                    // Update Local Storage Logic (Remove non-banned)
                    chrome.storage.local.get(['reportedSites'], (storageData) => {
                        let localReports = storageData.reportedSites || [];
                        const bannedOnly = localReports.filter(r => r.status === 'banned');

                        chrome.storage.local.set({ reportedSites: bannedOnly, cachedGlobalReports: [] }, () => {
                            console.log('[Admin] Local reports cleaned up (Kept banned only)');

                            // Refresh UI
                            allReportsCache = [];
                            loadDashboardData();
                            alert(`✅ Cleanup Complete\n\nDeleted ${data.count} reports from server.\n\nPage will reload to sync changes.`);
                            location.reload();
                        });
                    });

                } catch (error) {
                    console.error('[Admin] Cleanup failed:', error);
                    alert("Failed to delete reports: " + error.message);
                } finally {
                    btnDeleteAll.innerText = originalText;
                    btnDeleteAll.disabled = false;
                }
            }
        };
    }
}

function setupModalHandlers() {
    // User Modal
    const userModal = document.getElementById('user-modal');
    const userCloseX = document.getElementById('modal-close-x');
    const userCloseBtn = document.getElementById('modal-close-btn');

    if (userCloseX) {
        userCloseX.addEventListener('click', () => {
            if (userModal) userModal.classList.add('hidden');
        });
    }

    if (userCloseBtn) {
        userCloseBtn.addEventListener('click', () => {
            if (userModal) userModal.classList.add('hidden');
        });
    }

    // Report Detail Modal
    const reportModal = document.getElementById('report-modal');
    const reportCloseX = document.getElementById('report-modal-close-x');

    if (reportCloseX) {
        reportCloseX.addEventListener('click', () => {
            if (reportModal) reportModal.classList.add('hidden');
        });
    }
}

function setupDebugTools() {
    // Check Environment
    if (!chrome.runtime || !chrome.runtime.id) {
        const header = document.querySelector('header');
        const alert = document.createElement('div');
        alert.style.cssText = "background:#dc3545; color:white; padding:15px; margin-bottom:20px; border-radius:8px; font-weight:bold; display:flex; align-items:center; gap:10px;";
        alert.innerHTML = "<span>⚠️ RUNNING IN FILE MODE. STORAGE IS DISCONNECTED. PLEASE OPEN VIA EXTENSION POPUP.</span>";
        header.prepend(alert);
    }

    // Add Debug Button
    const container = document.querySelector('#settings .table-container');
    if (container) {
        // Divider
        container.appendChild(document.createElement('hr'));

        // "Memory" Restore Button (No downloads)
        const btnRestore = document.createElement('button');
        btnRestore.className = "btn btn-outline";
        btnRestore.textContent = "🔄 Restore Data to Server";
        btnRestore.title = "Restores missing reports from this browser's memory to the server.";
        btnRestore.onclick = restoreFromMemory;
        container.appendChild(btnRestore);
    }

}

function restoreFromMemory() {
    chrome.storage.local.get(['cachedGlobalReports'], (data) => {
        const cached = data.cachedGlobalReports || [];

        if (cached.length === 0) {
            alert("No saved data found in this browser's memory.");
            return;
        }

        // 1. Fetch Current Server State first to differentiate between "Full Wipe" and "Partial Missing"
        const statusDiv = document.createElement('div');
        statusDiv.style.cssText = "position:fixed; top:20px; right:20px; background:#0d6efd; color:white; padding:15px; border-radius:5px; z-index:10000; font-weight:bold;";
        statusDiv.innerText = "🔍 Checking Server State...";
        document.body.appendChild(statusDiv);

        fetch('https://phishingshield-ruby.vercel.app/api/reports')
            .then(res => res.json())
            .then(serverReports => {
                // map existing IDs for fast lookup
                const serverIds = new Set(serverReports.map(r => r.id));

                // 2. Identify Missing Reports
                const missingReports = cached.filter(r => !serverIds.has(r.id));

                if (missingReports.length === 0) {
                    statusDiv.style.background = "#198754";
                    statusDiv.innerText = "✅ Server is already up-to-date.";
                    setTimeout(() => statusDiv.remove(), 2500);
                    return;
                }

                // 3. User Confirmation based on scenario
                statusDiv.remove(); // Remove checking status
                let message = "";
                if (serverReports.length === 0) {
                    message = `🚨 SERVER WIPE DETECTED!\n\nThe server is empty, but your browser remembers ${missingReports.length} reports.\n\nRestore all data?`;
                } else {
                    message = `⚠️ Sync Gap Detected\n\nFound ${missingReports.length} reports in your memory that are missing from the server.\n\nRestore them now?`;
                }

                if (!confirm(message)) return;

                // 4. Restore Logic
                statusDiv.innerText = "⏳ Syncing...";
                document.body.appendChild(statusDiv);
                statusDiv.style.background = "#0d6efd";

                let count = 0;
                let errors = 0;

                const uploadNext = (index) => {
                    if (index >= missingReports.length) {
                        statusDiv.style.background = "#198754";
                        statusDiv.innerText = `✅ Restoration Complete! (${count} sent)`;
                        setTimeout(() => statusDiv.remove(), 2500);
                        loadDashboardData();
                        return;
                    }

                    const report = missingReports[index];
                    fetch('https://phishingshield-ruby.vercel.app/api/reports', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(report)
                    })
                        .then(res => {
                            if (res.ok) count++;
                            else errors++;
                        })
                        .catch(() => errors++)
                        .finally(() => {
                            statusDiv.innerText = `⏳ Restoring ${count}/${missingReports.length}...`;
                            uploadNext(index + 1);
                        });
                };

                uploadNext(0);
            })
            .catch(err => {
                statusDiv.style.background = "#dc3545";
                statusDiv.innerText = "❌ Connection Failed. Data saved in memory.";
                console.error(err);
                setTimeout(() => statusDiv.remove(), 3000);
            });
    });
}

async function checkAdminAccess() {
    const lockScreen = document.getElementById('lock-screen');
    const lockStatus = document.getElementById('lock-status');
    const API_BASE = "https://phishingshield-ruby.vercel.app/api";

    console.log("[Admin Check] SECURITY DISABLED - AUTO-LOGIN INITIATED");

    // AUTO-LOGIN CONFIGURATION
    const AUTO_ADMIN_EMAIL = "rajkumarpadhy2006@gmail.com";
    const DUMMY_TOKEN = "auto-admin-access-token-bypass";

    // Directly set storage credentials without checking server
    chrome.storage.local.set({
        adminToken: DUMMY_TOKEN,
        // No expiry needed as we want permanent access
        adminUser: {
            email: AUTO_ADMIN_EMAIL,
            role: 'admin',
            name: 'System Admin'
        }
    }, () => {
        console.log(`[Admin Check] Auto-logged in as ${AUTO_ADMIN_EMAIL}`);
        unlockUI();

        // Trigger Fresh Data Load
        if (typeof Auth !== 'undefined' && Auth.getUsers) {
            // Background refresh of global data
            Auth.getUsers(() => {
                console.log("Admin: Global Data Refreshed");
                loadDashboardData();
            });
            if (Auth.getGlobalReports) Auth.getGlobalReports(() => null);
        } else {
            loadDashboardData();
        }
    });
}

function unlockUI() {
    const lockScreen = document.getElementById('lock-screen');
    if (lockScreen) {
        lockScreen.style.opacity = '0';
        setTimeout(() => {
            lockScreen.style.display = 'none';
        }, 500);
    }
}

function lockUI() {
    // Default state of HTML, but ensuring it here
    const lockScreen = document.getElementById('lock-screen');
    if (lockScreen) {
        lockScreen.style.display = 'flex';
        lockScreen.style.opacity = '1';
    }
}


// 2. DASHBOARD DATA
function loadDashboardData() {
    // Helper to process data after fetching users
    const processData = (users, globalReports) => {
        const storage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : {
            get: (keys, cb) => {
                const res = {};
                keys.forEach(k => { const item = localStorage.getItem(k); if (item) res[k] = JSON.parse(item); });
                cb(res);
            }
        };

        storage.get(['visitLog', 'currentUser', 'stats_guest_count', 'reportedSites', 'userXP', 'userLevel'], (data) => {
            const logs = data.visitLog || [];
            // Use Global if available, else local
            const reports = (globalReports && globalReports.length > 0) ? globalReports : (data.reportedSites || []);

            // DYNAMIC FIX: Sync Current User Stats from Global Variables
            // This ensures the Admin Panel sees the latest Level/XP even if the 'users' array is stale.
            const currentEmail = data.currentUser ? data.currentUser.email : null;
            if (currentEmail) {
                const userIndex = users.findIndex(u => u.email === currentEmail);
                console.log("Admin Debug: Current Email", currentEmail, "Index", userIndex, "Global XP", data.userXP);
                if (userIndex !== -1) {
                    // Force update display data from live counters
                    users[userIndex].xp = (data.userXP !== undefined) ? data.userXP : users[userIndex].xp;
                    users[userIndex].level = (data.userLevel !== undefined) ? data.userLevel : users[userIndex].level;
                    console.log("Admin Debug: Synced User Data", users[userIndex]);
                }
            }

            // --- Update Stats Cards ---
            // 1. User Stats
            const signedCount = users.length;
            const unsignedCount = data.stats_guest_count || 0; // Reading tracked guest count
            const totalUsers = signedCount + unsignedCount;

            document.getElementById('stats-total-users').textContent = totalUsers;
            document.getElementById('stats-signed').textContent = signedCount;
            document.getElementById('stats-unsigned').textContent = unsignedCount;

            // 2. Total Threats (count high risk in logs)
            const totalThreats = logs.filter(l => l.score > 20).length;
            document.getElementById('stats-threats').textContent = totalThreats;

            // 3. System Sync & Server Status Logic
            checkServerStatus();

            // --- Populate Users Table ---

            // --- Populate Logs Table ---
            // GOD MODE: Aggregate logs from ALL users if available
            let aggregatedLogs = [...logs]; // Start with local logs
            users.forEach(u => {
                if (u.history && Array.isArray(u.history)) {
                    // Tag them with user email for context
                    const userLogs = u.history.map(h => ({ ...h, reporter: u.email }));
                    aggregatedLogs = aggregatedLogs.concat(userLogs);
                }
            });

            // Sort by timestamp (newest first)
            aggregatedLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            // Pass aggregated logs to renderUsers for Risk Factor calc
            renderUsers(users, aggregatedLogs);

            renderLogs(aggregatedLogs);

            // --- Populate Reports Table ---
            // --- Populate Reports Table ---
            // Fetch from Backend (Data Source Logic: Localhost > Cloud)
            // Use LOCAL server first with timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

            fetch(`${API_BASE}/reports?t=${Date.now()}`, { signal: controller.signal })
                .then(res => res.json())
                .then(serverReports => {
                    clearTimeout(timeoutId);
                    console.log("[Admin] Fetched Global Reports:", serverReports);
                    console.log("[Admin] Number of reports:", Array.isArray(serverReports) ? serverReports.length : 'Not an array');

                    // --- SERVER RESTORATION LOGIC (Persistence Hack) ---
                    // If server returns EMPTY list (because it reset), but we have a Local Cache,
                    // we assume the server wiped and we RESTORE it from our cache.
                    chrome.storage.local.get(['cachedGlobalReports'], (c) => {
                        const cached = c.cachedGlobalReports || [];

                        if (serverReports.length === 0 && cached.length > 0) {
                            console.warn("⚠️ SERVER DATA LOSS DETECTED! Restoring from Admin Cache...");

                            // 1. Show Recovery UI
                            const alertBox = document.createElement('div');
                            alertBox.style.cssText = "position:fixed; top:20px; right:20px; background:#ffc107; color:black; padding:15px; z-index:9999; border-radius:8px; font-weight:bold; box-shadow:0 5px 15px rgba(0,0,0,0.2);";
                            alertBox.innerHTML = `🔄 Server Reset Detected. Restoring ${cached.length} reports...`;
                            document.body.appendChild(alertBox);

                            // 2. Restore to Server (One by one to avoid payload limits, or batch if API supported)
                            // We'll just push them back effectively.
                            let restoredCount = 0;
                            cached.forEach(report => {
                                fetch('https://phishingshield-ruby.vercel.app/api/reports', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(report)
                                }).then(() => {
                                    restoredCount++;
                                    if (restoredCount === cached.length) {
                                        alertBox.style.background = "#198754";
                                        alertBox.style.color = "white";
                                        alertBox.innerHTML = `✅ Server Restored (${restoredCount} reports).`;
                                        setTimeout(() => alertBox.remove(), 3000);
                                        loadDashboardData(); // Reload to confirm
                                    }
                                });
                            });

                            // Use Cached data for NOW so UI looks instant
                            allReportsCache = cached;
                            renderReports(cached);

                        } else if (serverReports.length >= cached.length) {
                            // Normal Case: Server has data. Update our Cache.
                            console.log("[Admin] Updating Local Cache with latest Server Data");
                            chrome.storage.local.set({ cachedGlobalReports: serverReports });

                            // Helper to normalize URLs for comparison
                            const normalizeUrl = (u) => {
                                if (!u) return '';
                                try {
                                    let normalized = u.trim().toLowerCase();
                                    normalized = normalized.replace(/^https?:\/\//, '');
                                    normalized = normalized.replace(/\/+$/, '');
                                    return normalized;
                                } catch (e) {
                                    return u.trim().toLowerCase();
                                }
                            };

                            // MERGE logic for UI - Server data takes precedence for status
                            const localReports = data.reportedSites || [];
                            const mergedReports = [...serverReports];

                            // Add local reports that don't exist on server, but prioritize server status
                            localReports.forEach(localR => {
                                // First try to find by ID
                                let serverReport = mergedReports.find(serverR => serverR.id === localR.id);

                                // If not found by ID, try to find by URL (normalized)
                                if (!serverReport) {
                                    const localUrlNorm = normalizeUrl(localR.url);
                                    serverReport = mergedReports.find(serverR => {
                                        const serverUrlNorm = normalizeUrl(serverR.url);
                                        const serverHostnameNorm = normalizeUrl(serverR.hostname || '');
                                        return serverUrlNorm === localUrlNorm ||
                                            serverHostnameNorm === localUrlNorm ||
                                            normalizeUrl(localR.hostname || '') === serverUrlNorm;
                                    });
                                }

                                if (!serverReport) {
                                    // Local report not on server, add it
                                    mergedReports.push(localR);
                                } else {
                                    // Report exists on both - server status takes precedence
                                    // Server already has the correct status, so we keep it
                                }
                            });

                            mergedReports.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                            allReportsCache = mergedReports;
                            renderReports(mergedReports);
                        } else {
                            // Edge Case: Server has SOME data but less than cache? 
                            // Usually implies partial wipe or just new reports. We trust Server + Cache merge.
                            // CRITICAL FIX: Update existing entries with server status (server is source of truth)

                            // Helper to normalize URLs for comparison
                            const normalizeUrl = (u) => {
                                if (!u) return '';
                                try {
                                    let normalized = u.trim().toLowerCase();
                                    normalized = normalized.replace(/^https?:\/\//, '');
                                    normalized = normalized.replace(/\/+$/, '');
                                    return normalized;
                                } catch (e) {
                                    return u.trim().toLowerCase();
                                }
                            };

                            const mergedCache = [...cached];
                            serverReports.forEach(serverR => {
                                // First try to find by ID
                                let existingIndex = mergedCache.findIndex(c => c.id === serverR.id);

                                // If not found by ID, try to find by URL (normalized)
                                if (existingIndex === -1) {
                                    const serverUrlNorm = normalizeUrl(serverR.url);
                                    existingIndex = mergedCache.findIndex(c => {
                                        const cacheUrlNorm = normalizeUrl(c.url);
                                        const cacheHostnameNorm = normalizeUrl(c.hostname || '');
                                        return cacheUrlNorm === serverUrlNorm ||
                                            cacheHostnameNorm === serverUrlNorm ||
                                            normalizeUrl(serverR.hostname || '') === cacheUrlNorm;
                                    });
                                }

                                if (existingIndex !== -1) {
                                    // Update existing entry with server data (server status takes precedence)
                                    const oldStatus = mergedCache[existingIndex].status;
                                    console.log(`[Admin] Updating cached report ${serverR.id || serverR.url}: ${oldStatus} -> ${serverR.status}`);
                                    mergedCache[existingIndex] = serverR; // Server is source of truth
                                } else {
                                    // New report from server, add it
                                    mergedCache.push(serverR);
                                }
                            });
                            chrome.storage.local.set({ cachedGlobalReports: mergedCache });
                            allReportsCache = mergedCache;
                            renderReports(mergedCache);
                        }
                    });
                })
                .catch(err => {
                    console.warn("[Admin] Could not fetch global reports (Server Offline?)", err);
                    // Fallback to Cache first, then Local
                    chrome.storage.local.get(['cachedGlobalReports'], (c) => {
                        const cached = c.cachedGlobalReports || [];
                        if (cached.length > 0) {
                            console.log("[Admin] Using Offline Cache");
                            allReportsCache = cached;
                            renderReports(cached);
                        } else {
                            allReportsCache = reports;
                            renderReports(reports); // Fallback to local user reports
                        }
                    });
                });

        });
    };

    // Toggle Trust Panel
    document.getElementById('btn-refresh-trust').addEventListener('click', () => {
        loadTrustData();
    });

    // DELETE LOGS
    const btnDeleteLogs = document.getElementById('btn-delete-logs');
    if (btnDeleteLogs) {
        btnDeleteLogs.onclick = async () => {
            if (confirm("⚠️ Are you sure you want to clear ALL threat logs?\n\nThis action cannot be undone.")) {
                // Clear Local Logs
                chrome.storage.local.set({ visitLog: [] }, () => {
                    console.log('[Admin] Local visit logs cleared');
                });

                // Clear Server Logs (if API exists)
                try {
                    await fetch('https://phishingshield-ruby.vercel.app/api/logs/clear', { method: 'POST' });
                } catch (e) {
                    console.warn('[Admin] Failed to clear server logs or API not supported', e);
                }

                // Refresh UI
                document.getElementById('logs-table').querySelector('tbody').innerHTML = '';
                alert("✅ Threat logs have been cleared.");
                loadDashboardData();
            }
        };
    }

    // REFRESH USERS functionality
    const btnRefreshUsers = document.getElementById('btn-refresh-users');
    if (btnRefreshUsers) {
        // Use .onclick to prevent duplicate listeners if this function re-runs
        btnRefreshUsers.onclick = () => {
            const originalText = "↻ Refresh List";
            btnRefreshUsers.innerText = 'Refreshing...';
            btnRefreshUsers.disabled = true;

            const resetBtn = () => {
                setTimeout(() => {
                    btnRefreshUsers.innerText = originalText;
                    btnRefreshUsers.disabled = false;
                }, 1000);
            };

            // Safe Storage Clear with Fallback
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.remove(['cachedUsers'], () => {
                    if (chrome.runtime.lastError) console.warn("Storage warning:", chrome.runtime.lastError);
                    loadDashboardData();
                    resetBtn();
                });
            } else {
                console.warn("[Admin] Chrome Storage not available. Skipping cache clear.");
                loadDashboardData();
                resetBtn();
            }
        };
    }

    // EXPORT CSV functionality
    const btnExportCsv = document.getElementById('btn-export-csv');
    if (btnExportCsv) {
        btnExportCsv.onclick = () => {
            console.log('[Admin] Exporting CSV...');
            // Fetch users from storage
            chrome.storage.local.get(['cachedUsers'], (data) => {
                const users = data.cachedUsers || [];

                if (users.length === 0) {
                    alert('No user data available to export.');
                    return;
                }

                // Define CSV Headers
                const headers = ['Name', 'Email', 'Role', 'XP', 'Level', 'Status', 'Joined Date'];

                // Map user data to rows
                const rows = users.map(user => {
                    const joinedDate = user.joined ? new Date(user.joined).toLocaleDateString() : 'N/A';
                    // Escape quotes and commas for CSV format
                    const clean = (val) => `"${String(val || '').replace(/"/g, '""')}"`;

                    return [
                        clean(user.name || 'Unknown'),
                        clean(user.email || ''),
                        clean(user.role || 'user'),
                        clean(user.xp || 0),
                        clean(user.level || 1),
                        clean(user.status || 'active'),
                        clean(joinedDate)
                    ].join(',');
                });

                // Combine headers and rows
                const csvContent = [headers.join(','), ...rows].join('\n');

                // Create and trigger download
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.setAttribute('href', url);
                link.setAttribute('download', `PhishingShield_Users_${new Date().toISOString().split('T')[0]}.csv`);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
        };
    }

    // DELETE ALL REPORTS BUTTON (Fixed: Uses onclick to prevent duplicates)
    const btnDeleteAll = document.getElementById('btn-delete-all-reports');
    if (btnDeleteAll) {
        btnDeleteAll.onclick = () => {
            // 1. Single Confirmation
            if (!confirm("⚠️ Remove all Pending/Ignored reports?\n\nThis will permanently delete 'Pending' and 'Ignored' reports from both Local Storage and the Server.\n\nNote: 'Banned' sites will be preserved.")) {
                return;
            }

            chrome.storage.local.get(['reportedSites', 'cachedGlobalReports'], async (data) => {
                const localReports = data.reportedSites || [];
                const cachedReports = data.cachedGlobalReports || [];

                // Merge Unique to get full picture
                const allReports = [...localReports];
                cachedReports.forEach(c => {
                    if (!allReports.find(r => r.id === c.id)) allReports.push(c);
                });

                // FILTER LOGIC
                const reportsToKeep = allReports.filter(r => r.status === 'banned');
                const reportsToDelete = allReports.filter(r => r.status !== 'banned');
                const deleteIds = reportsToDelete.map(r => r.id);

                if (deleteIds.length === 0) {
                    alert("No pending/ignored reports to delete.");
                    return;
                }

                console.log(`[Admin] Deleting ${deleteIds.length} reports, Keeping ${reportsToKeep.length} banned.`);

                // Disable button
                btnDeleteAll.disabled = true;
                btnDeleteAll.innerText = "Deleting...";

                // 2. Delete from Server
                try {
                    let serverUrl = 'https://phishingshield-ruby.vercel.app/api/reports/delete';
                    // Simple connectivity check
                    try {
                        await fetch('https://phishingshield-ruby.vercel.app/api/users', { method: 'HEAD', signal: AbortSignal.timeout(1000) });
                    } catch (e) {
                        // If Local fails, try Global
                        serverUrl = 'https://phishingshield-ruby.vercel.app/api/reports/delete';
                    }

                    const response = await fetch(serverUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: deleteIds })
                    });

                    const resJson = await response.json();

                    if (resJson.success) {
                        console.log("[Admin] Server deletion successful.", resJson);
                    } else {
                        throw new Error(resJson.message);
                    }

                } catch (e) {
                    console.warn("[Admin] Could not delete from server:", e);
                    alert("⚠️ Server Warning: " + e.message + "\n\nReports deleted locally, but may reappear if you have a connection issue.");
                }

                // 3. Update Local Storage
                chrome.storage.local.set({
                    reportedSites: reportsToKeep,
                    cachedGlobalReports: reportsToKeep
                }, () => {
                    console.log("[Admin] Local storage updated.");

                    // Update UI Variables
                    allReportsCache = reportsToKeep;

                    btnDeleteAll.disabled = false;
                    btnDeleteAll.innerText = "🗑️ Delete All";

                    alert(`✅ Successful!\n\nDeleted: ${deleteIds.length}\nPreserved (Banned): ${reportsToKeep.length}`);

                    // Smooth refresh: fetch fresh data from server to ensure sync
                    fetch('https://phishingshield-ruby.vercel.app/api/reports')
                        .then(res => res.json())
                        .then(freshReports => {
                            chrome.storage.local.set({ cachedGlobalReports: freshReports }, () => {
                                allReportsCache = freshReports;
                                renderReports(freshReports);
                                console.log('[Admin] Reports refreshed after delete');
                            });
                        })
                        .catch(err => {
                            console.error('[Admin] Failed to refresh reports:', err);
                            // Fallback: use local data
                            renderReports(reportsToKeep);
                        });
                });
            });
        };
    }

    // Trigger Load
    console.log("Fetching Data...");

    // 1. Fetch Users logic with Auto-Restore
    const fetchUsers = () => {
        // Use Global Sync to ensure we get latest data including XP changes
        return fetch(`${API_BASE}/users/global-sync?t=${Date.now()}`)
            .then(res => res.json())
            .then(serverUsers => {
                console.log("[Admin] Fetched Global Users:", serverUsers.length);

                return new Promise((resolve) => {
                    chrome.storage.local.get(['cachedUsers'], (data) => {
                        const cached = data.cachedUsers || [];

                        // CACHE LOGIC:
                        if (serverUsers.length === 0 && cached.length > 0) {
                            console.warn("⚠️ SERVER USER DATA LOSS DETECTED! Restoring users from Admin Cache...");

                            // Restore UI
                            const alertBox = document.createElement('div');
                            alertBox.style.cssText = "position:fixed; top:20px; left:20px; background:#ffc107; color:black; padding:15px; z-index:9999; border-radius:8px; font-weight:bold; box-shadow:0 5px 15px rgba(0,0,0,0.2);";
                            alertBox.innerText = `🔄 Restoring ${cached.length} missing users to server...`;
                            document.body.appendChild(alertBox);

                            // Restore execution
                            let restored = 0;
                            const promises = cached.map(u => {
                                return fetch(`${API_BASE}/users/sync`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(u)
                                }).then(() => restored++);
                            });

                            Promise.allSettled(promises).then(() => {
                                alertBox.innerText = `✅ Restored ${restored} users.`;
                                alertBox.style.background = "#198754";
                                alertBox.style.color = "white";
                                setTimeout(() => alertBox.remove(), 3000);
                                resolve(cached); // Use cached for now
                            });

                        } else if (serverUsers.length >= cached.length) {
                            // Normal / Update: Update Cache
                            console.log("[Admin] Updating User Cache");
                            chrome.storage.local.set({ cachedUsers: serverUsers });
                            resolve(serverUsers);
                        } else {
                            // Merge
                            const missing = cached.filter(c => !serverUsers.find(s => s.email === c.email));
                            if (missing.length > 0) {
                                console.log(`[Admin] Restoring ${missing.length} missing users`);
                                missing.forEach(u => {
                                    fetch(`${API_BASE}/users/sync`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(u)
                                    });
                                });
                            }
                            const merged = [...serverUsers, ...missing];
                            chrome.storage.local.set({ cachedUsers: merged });
                            resolve(merged);
                        }
                    });
                });
            })
            .catch(err => {
                console.warn("[Admin] User Fetch Failed (Offline?):", err);
                return new Promise(resolve => {
                    chrome.storage.local.get(['cachedUsers'], r => resolve(r.cachedUsers || []));
                });
            });
    };

    // Execute
    fetchUsers().then(users => {
        // Continue with processData
        chrome.storage.local.get(['reports'], r => {
            // We use the existing processData flow but pass our smart user list
            processData(users || [], []);
        });
    });
}


// Filter Logic
window.setReportFilter = function (status) {
    currentReportFilter = status;

    // Update Buttons UI
    ['all', 'pending', 'banned', 'ignored'].forEach(s => {
        const btn = document.getElementById(`filter-${s}`);
        if (btn) {
            if (s === status) {
                btn.classList.add('btn-active');
                btn.classList.remove('btn-outline');
            } else {
                btn.classList.remove('btn-active');
                btn.classList.add('btn-outline');
            }
        }
    });

    // Re-render
    renderReports();
};

function renderReports(reports) {
    const tbody = document.querySelector('#reports-table tbody');
    if (!tbody) {
        console.error('[Admin] Reports table body not found!');
        return;
    }
    tbody.innerHTML = '';

    // Use Cache or provided reports (but do NOT overwrite cache implicitly)
    let dataToRender = reports || allReportsCache || [];

    // Filter out invalid reports
    dataToRender = dataToRender.filter(r => r && (r.url || r.hostname));

    // Apply Filter
    if (currentReportFilter !== 'all') {
        dataToRender = dataToRender.filter(r => {
            const status = r.status || 'pending';
            return status === currentReportFilter;
        });
    }

    if (!dataToRender || dataToRender.length === 0) {
        const filterText = currentReportFilter !== 'all' ? currentReportFilter : '';
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px; color:#6c757d;">No ${filterText} reports found.</td></tr>`;
        console.log('[Admin] No reports to display. Filter:', currentReportFilter, 'Total cached:', allReportsCache.length);
        return;
    }

    console.log('[Admin] Rendering', dataToRender.length, 'reports');

    // Sort by Date (newest first)
    const sorted = [...dataToRender].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    sorted.forEach((r, index) => {
        // Validate report has required fields
        if (!r || (!r.url && !r.hostname)) {
            console.warn('[Admin] Skipping invalid report:', r);
            return; // Skip invalid reports
        }

        const date = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : 'Unknown';

        // --- SYSTEM SYNC LOGIC ---
        function checkServerStatus() {
            console.log("[System Sync] Checking connectivity...");

            // UI Elements
            const syncValue = document.getElementById('stats-sync-value');
            const syncStatus = document.getElementById('stats-sync-status');

            if (!syncValue || !syncStatus) return;

            let localOnline = false;
            let globalOnline = false;

            // 1. Check Local Server
            const checkLocal = fetch('https://phishingshield-ruby.vercel.app/api/reports', { method: 'HEAD' })
                .then(res => { localOnline = res.ok; })
                .catch(() => { localOnline = false; });

            // 2. Check Global Server
            const checkGlobal = fetch('https://phishingshield-ruby.vercel.app/api/reports', { method: 'HEAD' })
                .then(res => { globalOnline = res.ok; })
                .catch(() => { globalOnline = false; });

            // Execute Both
            Promise.allSettled([checkLocal, checkGlobal]).then(() => {
                console.log(`[System Sync] Local: ${localOnline}, Global: ${globalOnline}`);

                if (localOnline && globalOnline) {
                    // 100%
                    syncValue.textContent = "100%";
                    syncValue.style.color = "#166534"; // green
                    syncStatus.innerHTML = `✅ <strong>All Systems Online</strong>`;
                } else if (!localOnline && !globalOnline) {
                    // 0%
                    syncValue.textContent = "0%";
                    syncValue.style.color = "#dc3545"; // red
                    syncStatus.innerHTML = `❌ <strong>System Blackout</strong>`;
                } else {
                    // 50%
                    syncValue.textContent = "50%";
                    syncValue.style.color = "#d97706"; // orange

                    if (localOnline) {
                        syncStatus.innerHTML = `⚠️ <strong>Local Only</strong> (Global Offline)`;
                    } else {
                        syncStatus.innerHTML = `⚠️ <strong>Global Only</strong> (Local Offline)`;
                    }
                }
            });
        }
        const status = r.status || 'pending';

        // Escape HTML to prevent XSS
        const escapeHtml = (text) => {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = String(text);
            return div.innerHTML;
        };

        let statusBadge = '<span class="badge" style="background:#ffc107; color:black">PENDING</span>';

        // Safely get URL - try multiple sources
        const reportUrl = r.url || r.hostname || 'Unknown URL';
        const escapedUrl = escapeHtml(reportUrl);
        const escapedId = escapeHtml(r.id || '');

        // Safely get hostname
        let hostname = r.hostname;
        if (!hostname && reportUrl !== 'Unknown URL') {
            try {
                hostname = new URL(reportUrl).hostname;
            } catch (e) {
                hostname = reportUrl; // Fallback to full URL if parsing fails
            }
        }
        const escapedHostname = escapeHtml(hostname || reportUrl);

        // Action buttons based on status
        let actionBtn = '';
        if (status === 'banned') {
            statusBadge = '<span class="badge" style="background:#dc3545; color:white">🚫 BANNED</span>';
        } else if (status === 'ignored') {
            statusBadge = '<span class="badge" style="background:#6c757d; color:white">IGNORED</span>';
        }

        // Unified Action: Always show "View Details" to open Modal
        actionBtn = `
            <button class="btn btn-outline action-open-modal" data-id="${escapedId}" style="padding:4px 8px; font-size:12px;">View Details</button>
        `;

        // Parse reporter to separate Name and Email if possible for better display
        let reporterDisplay = r.reporterName || r.reporter || 'Anonymous';
        let reporterEmail = r.reporterEmail || '';

        // If format is "Name (email)", we can bold the name (legacy fallback)
        if (!r.reporterName && reporterDisplay.includes('(')) {
            const parts = reporterDisplay.split('(');
            const name = parts[0].trim();
            const email = parts[1].replace(')', '').trim();
            reporterDisplay = `<strong>${escapeHtml(name)}</strong> <span style="font-size:12px; color:#6c757d;">(${escapeHtml(email)})</span>`;
        } else if (r.reporterName && r.reporterEmail) {
            // Modern format with split fields
            reporterDisplay = `<strong>${escapeHtml(r.reporterName)}</strong> <span style="font-size:12px; color:#6c757d;">(${escapeHtml(r.reporterEmail)})</span>`;
        } else {
            reporterDisplay = escapeHtml(reporterDisplay);
        }

        const tr = document.createElement('tr');
        // Truncate URL if too long for display
        const displayUrl = escapedUrl.length > 50 ? escapedUrl.substring(0, 47) + '...' : escapedUrl;
        tr.innerHTML = `
            <td style="font-family:monospace; color:#0d6efd;" title="${escapedUrl}">${displayUrl}</td>
            <td>${reporterDisplay}</td>
            <td>${date}</td>
            <td>${statusBadge}</td>
            <td>${actionBtn}</td>
        `;
        tbody.appendChild(tr);

        // Attach event listeners to buttons (CSP-safe, no inline handlers)

        // 1. Initial "View Details" Button Handler (Pending Status)
        const initialViewBtn = tr.querySelector('.action-initial-view');
        if (initialViewBtn) {
            initialViewBtn.addEventListener('click', (e) => {
                const container = e.target.closest('.action-wrapper');
                if (container) {
                    // Inject the full set of options
                    container.innerHTML = `
                        <button class="btn action-ban-dynamic" style="background:#dc3545; padding:4px 8px; font-size:11px;" title="Block">🚫 BAN</button>
                        <button class="btn action-ignore-dynamic" style="background:#6c757d; padding:4px 8px; font-size:11px;" title="Ignore">✓ IGNORE</button>
                        <button class="btn action-details-dynamic" style="background:#0d6efd; padding:4px 8px; font-size:11px;" title="Details">🔍 DETAILS</button>
                    `;

                    // Bind newly created buttons using closure variables
                    container.querySelector('.action-ban-dynamic').addEventListener('click', () => window.banSite(r.url, r.id));
                    container.querySelector('.action-ignore-dynamic').addEventListener('click', () => window.ignoreReport(r.url, r.id));
                    container.querySelector('.action-details-dynamic').addEventListener('click', () => window.viewSiteDetails(r.url, r.id));
                }
            });
        }

        // 1. Modal trigger
        const modalBtn = tr.querySelector('.action-open-modal');
        if (modalBtn) {
            modalBtn.addEventListener('click', () => {
                const reportId = modalBtn.dataset.id || '';
                console.log('[Admin] Looking for report with ID:', reportId);
                console.log('[Admin] Cache size:', allReportsCache.length);

                // Try to find in cache first
                let report = allReportsCache.find(x => x.id === reportId);

                // Fallback: if not found in cache, try the original report object
                if (!report && r && r.id === reportId) {
                    console.log('[Admin] Report not in cache, using original object');
                    report = r;
                }

                // Final fallback: just use the original report
                if (!report) {
                    console.warn('[Admin] Report not found by ID, using fallback');
                    report = r;
                }

                openReportModal(report);
            });
        }

        // 2. Standard Listeners (for Banned/Ignored status where buttons exist immediately)
        const banBtn = tr.querySelector('.action-ban');
        if (banBtn) {
            banBtn.addEventListener('click', () => {
                window.banSite(banBtn.dataset.url, banBtn.dataset.id);
            });
        }

        const unbanBtn = tr.querySelector('.action-unban');
        if (unbanBtn) {
            unbanBtn.addEventListener('click', () => {
                window.unbanSite(unbanBtn.dataset.url, unbanBtn.dataset.id);
            });
        }

        const ignoreBtn = tr.querySelector('.action-ignore');
        if (ignoreBtn) {
            ignoreBtn.addEventListener('click', () => {
                window.ignoreReport(ignoreBtn.dataset.url, ignoreBtn.dataset.id);
            });
        }

        const detailsBtn = tr.querySelector('.action-details');
        if (detailsBtn) {
            detailsBtn.addEventListener('click', () => {
                window.viewSiteDetails(detailsBtn.dataset.url, detailsBtn.dataset.id);
            });
        }
    });
}

// Global function to ban a harmful site
window.banSite = async function (url, reportId) {
    console.log('[Admin] banSite called with:', { url, reportId });

    try {
        let hostname;
        try {
            hostname = new URL(url).hostname;
        } catch (e) {
            hostname = url;
            console.warn('[Admin] Could not parse URL, using as-is:', url);
        }

        if (!confirm(`🚫 BAN HARMFUL SITE\n\nThis will block access to:\n${hostname}\n\nAll users will see a warning when visiting this site.\n\nProceed?`)) {
            console.log('[Admin] User cancelled ban');
            return;
        }

        console.log('[Admin] User confirmed ban, proceeding...');

        // Update status on server first and WAIT for response
        // Use LOCAL server first
        const response = await fetch(`${API_BASE}/reports/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: reportId, status: 'banned' })
        });

        const resData = await response.json();

        if (!response.ok || !resData.success) {
            throw new Error(resData.message || 'Server returned error');
        }

        console.log('[Admin] Server updated successfully, status set to banned');

        // Update cached global reports to reflect the ban immediately
        chrome.storage.local.get(['cachedGlobalReports'], (cacheData) => {
            const cachedReports = cacheData.cachedGlobalReports || [];
            const reportIndex = cachedReports.findIndex(r => r.id === reportId || r.url === url);
            if (reportIndex !== -1) {
                cachedReports[reportIndex].status = 'banned';
                cachedReports[reportIndex].bannedAt = Date.now();
            } else {
                // Add to cache if not present
                cachedReports.push({
                    id: reportId,
                    url: url,
                    hostname: hostname,
                    status: 'banned',
                    bannedAt: Date.now(),
                    timestamp: Date.now(),
                    reporter: 'Admin'
                });
            }
            chrome.storage.local.set({ cachedGlobalReports: cachedReports });
        });

        // Update local storage for immediate UI feedback
        chrome.storage.local.get(['reportedSites', 'blacklist'], (data) => {
            let reports = data.reportedSites || [];
            let blacklist = data.blacklist || [];

            // 1. Update Report Status in local storage
            const reportIndex = reports.findIndex(r => r.id === reportId || r.url === url);
            if (reportIndex !== -1) {
                reports[reportIndex].status = 'banned';
                reports[reportIndex].bannedAt = Date.now();
            } else {
                // If not in local, add it
                reports.push({
                    id: reportId,
                    url: url,
                    hostname: hostname,
                    status: 'banned',
                    bannedAt: Date.now(),
                    timestamp: Date.now()
                });
            }

            // 2. Add to Blacklist (both URL and hostname for better blocking)
            // Helper to normalize URLs for comparison
            const normalizeUrl = (u) => {
                if (!u) return '';
                try {
                    let normalized = u.trim().toLowerCase();
                    normalized = normalized.replace(/^https?:\/\//, '');
                    normalized = normalized.replace(/\/+$/, '');
                    return normalized;
                } catch (e) {
                    return u.trim().toLowerCase();
                }
            };

            const normalizedUrl = normalizeUrl(url);
            const normalizedHostname = normalizeUrl(hostname);

            // Check if URL is already in blacklist (using normalized comparison)
            const urlInBlacklist = blacklist.some(item => {
                const normalizedItem = normalizeUrl(item);
                return normalizedItem === normalizedUrl;
            });

            // Check if hostname is already in blacklist
            const hostnameInBlacklist = hostname && blacklist.some(item => {
                const normalizedItem = normalizeUrl(item);
                return normalizedItem === normalizedHostname;
            });

            if (!urlInBlacklist) {
                blacklist.push(url);
            }
            if (hostname && !hostnameInBlacklist) {
                blacklist.push(hostname);
            }

            // 3. Save to storage
            chrome.storage.local.set({ reportedSites: reports, blacklist: blacklist }, () => {
                console.log('[Admin] Site banned, blacklist updated:', blacklist);

                // Notify Background Script to update rules immediately
                chrome.runtime.sendMessage({ type: "UPDATE_BLOCKLIST" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Admin] Error sending UPDATE_BLOCKLIST:', chrome.runtime.lastError);
                    }

                    // Also trigger immediate sync for other instances
                    chrome.runtime.sendMessage({ type: "FORCE_BLOCKLIST_SYNC" }, () => {
                        console.log('[Admin] Force sync triggered');
                    });

                    alert(`✅ Site Banned Successfully!\n\n${hostname} is now blocked globally.\n\nAll users across all devices will see a warning page when visiting this site.`);
                    loadDashboardData(); // Refresh UI
                    loadBannedSites(); // Refresh banned sites table
                });
            });
        });
    } catch (error) {
        console.error('[Admin] Error in banSite:', error);
        alert('Error banning site: ' + error.message + '\n\nPlease try again or check your connection.');
    }
};

// Global function to ignore a report (mark as false positive)
window.ignoreReport = async function (url, reportId) {
    if (!confirm(`Mark this report as FALSE POSITIVE?\n\n${url}\n\nThis will mark the site as safe and ignore the report.`)) return;

    try {
        // Update status on server AND WAIT for it
        // Use LOCAL server first
        const response = await fetch(`${API_BASE}/reports/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: reportId, status: 'ignored' })
        });
        const resData = await response.json();

        if (!response.ok || !resData.success) {
            throw new Error(resData.message || 'Server returned error');
        }

        console.log("[Admin] Server ignored report successfully.");
    } catch (err) {
        console.error('Server update failed:', err);
        alert("Warning: Could not update server. Updating locally only.");
    }

    // Now update UI
    chrome.storage.local.get(['reportedSites'], (data) => {
        let reports = data.reportedSites || [];
        const reportIndex = reports.findIndex(r => r.id === reportId || r.url === url);
        if (reportIndex !== -1) {
            reports[reportIndex].status = 'ignored';
            reports[reportIndex].ignoredAt = Date.now();
            chrome.storage.local.set({ reportedSites: reports }, () => {
                alert(`✓ Report Ignored\n\nThis site has been marked as safe.`);
                loadDashboardData();
            });
        }
    });
};

// Global function to unban a site
window.unbanSite = async function (url, reportId) {
    console.log('[Admin] unbanSite called with:', { url, reportId });

    try {
        let hostname;
        try {
            hostname = new URL(url).hostname;
        } catch (e) {
            hostname = url;
            console.warn('[Admin] Could not parse URL, using as-is:', url);
        }

        if (!confirm(`Unban this site?\n\n${url}\n\nThis will allow users to visit the site again.`)) {
            console.log('[Admin] User cancelled unban');
            return;
        }

        console.log('[Admin] User confirmed unban, proceeding...');

        // Update status on server and WAIT for response
        // Use LOCAL server first
        const response = await fetch(`${API_BASE}/reports/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: reportId, status: 'pending' })
        });

        const resData = await response.json();

        if (!response.ok || !resData.success) {
            throw new Error(resData.message || 'Server returned error');
        }

        console.log('[Admin] Server updated successfully, status set to pending');

        // Update cached global reports to reflect the unban immediately
        chrome.storage.local.get(['cachedGlobalReports'], (cacheData) => {
            const cachedReports = cacheData.cachedGlobalReports || [];

            // Helper to normalize URLs for comparison
            const normalizeUrl = (u) => {
                if (!u) return '';
                try {
                    let normalized = u.trim().toLowerCase();
                    normalized = normalized.replace(/^https?:\/\//, '');
                    normalized = normalized.replace(/\/+$/, '');
                    return normalized;
                } catch (e) {
                    return u.trim().toLowerCase();
                }
            };

            const normalizedUrl = normalizeUrl(url);
            const normalizedHostname = normalizeUrl(hostname);

            // Find and update all matching reports (by ID or normalized URL)
            cachedReports.forEach((report, index) => {
                if (report.id === reportId) {
                    cachedReports[index].status = 'pending';
                    delete cachedReports[index].bannedAt;
                } else {
                    const rUrl = normalizeUrl(report.url);
                    const rHostname = normalizeUrl(report.hostname);
                    if (rUrl === normalizedUrl || rUrl === normalizedHostname ||
                        rHostname === normalizedUrl || rHostname === normalizedHostname) {
                        cachedReports[index].status = 'pending';
                        delete cachedReports[index].bannedAt;
                    }
                }
            });

            chrome.storage.local.set({ cachedGlobalReports: cachedReports });
        });

        chrome.storage.local.get(['reportedSites', 'blacklist'], (data) => {
            let reports = data.reportedSites || [];
            let blacklist = data.blacklist || [];

            // Helper function to normalize URLs for comparison
            const normalizeUrl = (u) => {
                if (!u) return '';
                try {
                    // Remove protocol, trailing slashes, and normalize
                    let normalized = u.trim().toLowerCase();
                    normalized = normalized.replace(/^https?:\/\//, ''); // Remove http:// or https://
                    normalized = normalized.replace(/\/+$/, ''); // Remove trailing slashes
                    return normalized;
                } catch (e) {
                    return u.trim().toLowerCase();
                }
            };

            const normalizedUrl = normalizeUrl(url);
            const normalizedHostname = normalizeUrl(hostname);

            // Update report status - check by ID first, then URL (normalized)
            const reportIndex = reports.findIndex(r => {
                if (r.id === reportId) return true;
                const rUrl = normalizeUrl(r.url);
                return rUrl === normalizedUrl || rUrl === normalizedHostname;
            });
            if (reportIndex !== -1) {
                reports[reportIndex].status = 'pending';
                delete reports[reportIndex].bannedAt;
            }

            // Remove from blacklist - check all variations (with/without protocol, trailing slashes, etc.)
            blacklist = blacklist.filter(item => {
                const normalizedItem = normalizeUrl(item);
                // Remove if it matches the URL or hostname in any format
                return normalizedItem !== normalizedUrl && normalizedItem !== normalizedHostname;
            });

            console.log('[Admin] Site unbanned, blacklist updated:', blacklist);

            chrome.storage.local.set({ reportedSites: reports, blacklist: blacklist }, () => {
                // Clear blocklist cache to force fresh fetch from server
                chrome.runtime.sendMessage({ type: "UPDATE_BLOCKLIST" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Admin] Error sending UPDATE_BLOCKLIST:', chrome.runtime.lastError);
                    }

                    // Also trigger immediate sync for other instances
                    chrome.runtime.sendMessage({ type: "FORCE_BLOCKLIST_SYNC" }, () => {
                        console.log('[Admin] Force sync triggered');
                    });

                    alert(`✅ Site Unbanned\n\nUsers can now visit this site.\n\nNote: Other devices will sync within 10 seconds.`);
                    // Smooth refresh: fetch fresh data from server
                    fetch('https://phishingshield-ruby.vercel.app/api/reports')
                        .then(res => res.json())
                        .then(freshReports => {
                            chrome.storage.local.set({ cachedGlobalReports: freshReports }, () => {
                                allReportsCache = freshReports;
                                renderReports(freshReports);
                                console.log('[Admin] Reports refreshed after unban');
                            });
                        })
                        .catch(err => {
                            console.error('[Admin] Failed to refresh reports:', err);
                            // Fallback: just update local cache
                            allReportsCache = allReportsCache.map(r =>
                                r.id === reportId ? { ...r, status: 'pending' } : r
                            );
                            renderReports(allReportsCache);
                        });
                });
            });
        });
    } catch (error) {
        console.error('[Admin] Error in unbanSite:', error);
        alert('Error unbanning site: ' + error.message + '\n\nPlease try again or check your connection.');
    }
};

// Global function to view site details
window.viewSiteDetails = function (url, reportId) {
    chrome.storage.local.get(['reportedSites'], (data) => {
        const reports = data.reportedSites || [];
        const report = reports.find(r => r.id === reportId || r.url === url);

        const hostname = new URL(url).hostname;
        const details = `
🚨 SITE REPORT DETAILS

URL: ${url}
Hostname: ${hostname}
Report ID: ${reportId}
Status: ${report?.status || 'pending'}
Reported by: ${report?.reporter || 'Unknown'}
Reported at: ${report?.timestamp ? new Date(report.timestamp).toLocaleString() : 'Unknown'}
${report?.bannedAt ? `Banned at: ${new Date(report.bannedAt).toLocaleString()}` : ''}

Actions:
• Copy URL to clipboard
• Open site in new tab (to verify)
• Export report data
        `;

        const action = confirm(details + '\n\nOpen this site in a new tab to verify?');
        if (action) {
            chrome.tabs.create({ url: url, active: false });
        }
    });
};

function renderUsers(users, allLogs) {
    const recentBody = document.querySelector('#recent-users-table tbody');
    const allBody = document.querySelector('#all-users-table tbody');

    if (!recentBody || !allBody) return;

    recentBody.innerHTML = '';
    allBody.innerHTML = '';

    if (users.length === 0) {
        recentBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">No users registered yet.</td></tr>';
        allBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">No users database found.</td></tr>';
        return;
    }

    // Sort users by joined date (descending)
    // Note: older user objects might not have 'joined', so fallback
    const sortedUsers = [...users].sort((a, b) => (b.joined || 0) - (a.joined || 0));

    sortedUsers.forEach((user, index) => {
        // Prepare Data
        const name = user.name || 'Unknown';
        const email = user.email || 'N/A';
        const level = user.level || 1;
        const xp = user.xp || 0;
        const joinedDate = user.joined ? new Date(user.joined).toLocaleDateString() : 'Unknown';

        // Calc Risk & Activity
        const userLogs = allLogs ? allLogs.filter(l => l.reporter === email) : [];
        const highRisk = userLogs.filter(l => l.score > 50).length;
        let riskBadge = '<span class="badge" style="background:#198754; color:white">LOW</span>';
        if (highRisk > 5) riskBadge = '<span class="badge" style="background:#dc3545; color:white">HIGH</span>';
        else if (highRisk > 0) riskBadge = '<span class="badge" style="background:#ffc107; color:black">MEDIUM</span>';

        let lastActive = 'Never';
        if (user.lastCriticalTime) lastActive = new Date(user.lastCriticalTime).toLocaleString();
        else if (user.joined) lastActive = new Date(user.joined).toLocaleDateString();

        // --- 1. Recent Users Row (Limit 5) ---
        if (index < 5) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:32px; height:32px; background:#e9ecef; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#6c757d;">
                            ${name.charAt(0).toUpperCase()}
                        </div>
                        ${name}
                    </div>
                </td>
                <td>${email}</td>
                <td><span class=\"badge badge-user\">User</span></td>
                <td><span class=\"badge badge-active\">Active</span></td>
                <td>${joinedDate}</td>
            `;
            recentBody.appendChild(row);
        }

        // --- 2. All Users Row ---
        // Calculate detailed XP progress (mock max 1000 for visuals)
        const xpPercent = Math.min((xp / (level * 100)) * 100, 100);

        const allRow = document.createElement('tr');
        // REPLACED: Added Last Active and Risk Factor columns
        allRow.innerHTML = `
            <td><strong>${name}</strong></td>
            <td>${email}</td>
            <td>Lvl ${level}</td>
            <td style="font-size:12px; color:#6c757d;">${lastActive}</td>
            <td>${riskBadge}</td>
        `;

        // Create Action Cell Programmatically
        const actionCell = document.createElement('td');
        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn btn-outline';
        viewBtn.style.padding = '4px 8px';
        viewBtn.style.fontSize = '12px';
        viewBtn.textContent = 'View Details';

        viewBtn.addEventListener('click', () => {
            // Populate Modal
            document.getElementById('modal-name').textContent = name;
            document.getElementById('modal-email').textContent = email;
            document.getElementById('modal-avatar').textContent = name.charAt(0).toUpperCase();
            document.getElementById('modal-rank').textContent = user.level > 5 ? 'Elite' : 'Novice';

            document.getElementById('modal-xp').textContent = user.xp || 0;
            document.getElementById('modal-level').textContent = user.level || 1;
            document.getElementById('modal-streak').textContent = user.safeStreak || 0;

            const lastIncident = user.lastCriticalTime ? new Date(user.lastCriticalTime).toLocaleDateString() : 'None';
            document.getElementById('modal-incident').textContent = lastIncident;

            // History
            const histBody = document.getElementById('modal-history-body');
            histBody.innerHTML = '';

            if (user.history && user.history.length > 0) {
                [...user.history].reverse().slice(0, 10).forEach(h => {
                    const row = document.createElement('tr');
                    const riskColor = h.score >= 60 ? '#dc3545' : (h.score >= 20 ? '#ffc107' : '#198754');
                    row.innerHTML = `
                        <td>${h.timestamp ? new Date(h.timestamp).toLocaleTimeString() : 'N/A'}</td>
                        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis;">${h.url}</td>
                        <td style="color:${riskColor}; font-weight:bold;">${h.score}%</td>
                    `;
                    histBody.appendChild(row);
                });
            } else {
                histBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:10px; color:#adb5bd;">No synced history available.</td></tr>';
            }
            document.getElementById('user-modal').classList.remove('hidden');

            // DYNAMIC BUTTON INJECTION into Modal Footer
            const footer = document.getElementById('modal-footer');
            if (footer) {
                footer.innerHTML = ''; // Clear previous

                // 1. Edit XP Button
                const editXPBtn = document.createElement('button');
                editXPBtn.className = 'btn btn-outline';
                editXPBtn.textContent = 'Edit XP';
                editXPBtn.style.color = '#ffc107';
                editXPBtn.style.borderColor = '#ffc107';
                editXPBtn.onclick = () => {
                    const newXPStr = prompt(`Update XP for ${name}\n\nCurrent: ${user.xp}`, user.xp);
                    if (newXPStr === null) return;

                    const newXP = parseInt(newXPStr);
                    if (isNaN(newXP) || newXP < 0) {
                        alert("Invalid XP");
                        return;
                    }

                    // Sync Logic - Admin Edit (can increase or decrease XP)
                    // Use a timestamp with a buffer (30s) to ensure it stays newer even if client clocks differ
                    const adminTimestamp = Date.now() + 30000;
                    const updatedUser = {
                        ...user,
                        xp: newXP,
                        level: Math.floor(Math.sqrt(newXP / 100)) + 1,
                        lastUpdated: adminTimestamp, // CRITICAL: Buffer to prevent immediate revert
                        forceUpdate: true, // CRITICAL: Admin override
                        isPenalty: (newXP < user.xp)
                    };

                    console.log(`[Admin] Editing XP for ${name}: ${user.xp} -> ${newXP} (forceUpdate: ${updatedUser.forceUpdate})`);

                    fetch(`${API_BASE}/users/sync`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updatedUser)
                    })
                        .then(res => res.json())
                        .then(data => {
                            if (data.success) {
                                const change = newXP - user.xp;
                                const changeText = change > 0 ? `+${change}` : `${change}`;
                                alert(`✅ XP Updated & Synced!\n\n${user.xp} ${changeText} = ${newXP} XP\nLevel: ${updatedUser.level}`);
                                // Quick UI update
                                document.getElementById('modal-xp').textContent = newXP;
                                document.getElementById('modal-level').textContent = updatedUser.level;
                                // Background refresh
                                loadDashboardData();
                            } else {
                                alert("❌ Sync failed: " + (data.message || data.error || "Unknown error"));
                                console.error("[Admin] XP Update Failed:", data);
                            }
                        })
                        .catch(e => {
                            alert("❌ Server Error: " + e.message);
                            console.error("[Admin] XP Update Error:", e);
                        });
                };

                // 2. Delete Button
                const deleteUserBtn = document.createElement('button');
                deleteUserBtn.className = 'btn btn-outline';
                deleteUserBtn.textContent = 'Delete User';
                deleteUserBtn.style.color = '#dc3545';
                deleteUserBtn.style.borderColor = '#dc3545';
                deleteUserBtn.onclick = () => {
                    if (confirm(`⚠️ DELETE USER: ${name}?\n\nThis will permanently remove:\n- Account Access\n- XP & Rank History\n- Trust Score Votes\n\nThis action will typically propagate to the Global Server as well.\n\nAre you sure?`)) {

                        // Disable button to prevent double-click
                        deleteUserBtn.disabled = true;
                        deleteUserBtn.innerText = "Deleting...";

                        fetch(`${API_BASE}/users/delete`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: email })
                        })
                            .then(async (res) => {
                                const data = await res.json();
                                if (data.success) {
                                    // 1. Remove from Local Cache Immediately (Optimistic UI)
                                    chrome.storage.local.get(['cachedUsers'], (storage) => {
                                        const cached = storage.cachedUsers || [];
                                        const updated = cached.filter(u => u.email !== email);
                                        chrome.storage.local.set({ cachedUsers: updated }, () => {
                                            alert("✅ User deleted successfully.");
                                            document.getElementById('user-modal').classList.add('hidden');
                                            loadDashboardData(); // Refresh UI
                                        });
                                    });
                                } else {
                                    throw new Error(data.message || "Unknown server error");
                                }
                            })
                            .catch(e => {
                                alert("❌ Delete failed: " + e.message);
                                deleteUserBtn.disabled = false;
                                deleteUserBtn.innerText = "Delete User";
                            });
                    }
                };

                // 3. Close Button
                const closeBtn = document.createElement('button');
                closeBtn.className = 'btn btn-outline';
                closeBtn.textContent = 'Close';
                closeBtn.onclick = () => document.getElementById('user-modal').classList.add('hidden');

                // Append with proper spacing
                footer.appendChild(editXPBtn);
                footer.appendChild(deleteUserBtn);
                footer.appendChild(closeBtn);
            }
        });

        actionCell.appendChild(viewBtn);
        // Note: Edit and Delete buttons moved to Modal Footer

        allRow.appendChild(actionCell);

        allBody.appendChild(allRow);
    });
}


function loadBannedSites() {
    const tbody = document.getElementById('banned-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading...</td></tr>';

    // Use the PROXY endpoint which handles CORS and merging automatically (Cache-Busted)
    fetch(`${API_BASE}/reports/global-sync?t=${Date.now()}`)
        .then(res => res.json())
        .then(mergedReports => {
            // Filter for banned sites from the merged list
            const bannedSites = mergedReports.filter(r => r.status === 'banned');

            if (bannedSites.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color:#adb5bd;">No banned sites found.</td></tr>';
                return;
            }

            tbody.innerHTML = '';
            bannedSites.forEach(site => {
                const row = document.createElement('tr');
                const escapedUrl = site.url.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                const escapedId = (site.id || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                row.innerHTML = `
                    <td>
                        <div style="font-weight:600;">${site.url}</div>
                        <div style="font-size:12px; color:#adb5bd;">${site.hostname || site.url}</div>
                    </td>
                    <td>${new Date(site.timestamp || site.bannedAt || Date.now()).toLocaleDateString()}</td>
                    <td>${site.reporter || site.reportedBy || 'Unknown'}</td>
                    <td>
                        <button class="btn btn-outline btn-unban" style="color: #28a745; border-color: #28a745; font-size: 12px; padding: 4px 8px;">
                            ✅ Unban
                        </button>
                        ${site.notes ? `<div style="font-size:10px; margin-top:5px; color:#6c757d;">Note: ${site.notes}</div>` : ''}
                    </td>
                `;

                // CSP-Safe Event Listener
                const unbanBtn = row.querySelector('.btn-unban');
                if (unbanBtn) {
                    unbanBtn.addEventListener('click', () => {
                        window.unbanSite(site.url, site.id);
                    });
                }

                tbody.appendChild(row);
            });
        })
        .catch(err => {
            console.error('[Admin] Failed to fetch banned sites from server:', err);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color:#dc3545;">Error loading banned sites. Please refresh.</td></tr>';
        });
}



function renderLogs(logs) {
    const tbody = document.querySelector('#logs-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color:#adb5bd;">No threats detected yet. System clean.</td></tr>';
        return;
    }

    // Show last 20 logs
    const recentLogs = [...logs].reverse().slice(0, 20);

    recentLogs.forEach(log => {
        const time = new Date(log.timestamp).toLocaleString();
        const score = log.score || 0;

        // Determine Badges
        let statusHtml = '';
        if (score > 50) statusHtml = '<span class="badge" style="background:#dc3545; color:white">CRITICAL</span>';
        else if (score > 20) statusHtml = '<span class="badge" style="background:#ffc107; color:black">WARNING</span>';
        else statusHtml = '<span class="badge" style="background:#198754; color:white">SAFE</span>';

        // Reason logic
        const reasons = (log.reasons || []).join(', ').substring(0, 50) + (log.reasons?.length > 1 ? '...' : '');

        const row = document.createElement('tr');
        const reporterDisplay = log.reporter ? `<span title="${log.reporter}" style="cursor:help; border-bottom:1px dotted #ccc;">${log.reporter.split('@')[0]}...</span>` : '<span class="badge badge-user">Local</span>';

        row.innerHTML = `
            <td>${time}</td>
            <td>${reporterDisplay}</td>
            <td style="font-family:monospace; color:#0d6efd; max-width:150px; overflow:hidden; text-overflow:ellipsis;">${log.hostname}</td>
            <td>${reasons || 'N/A'}</td>
            <td>${score}/100</td>
            <td>${statusHtml}</td>
        `;
        tbody.appendChild(row);
    });
}

function openReportModal(report) {
    const modal = document.getElementById('report-modal');
    if (!modal) return;

    // Defensive check: ensure report exists
    if (!report || !report.url) {
        console.error('[Admin] openReportModal called with invalid report:', report);
        console.log('[Admin] allReportsCache has', allReportsCache.length, 'reports');
        alert('Error: Report data not found. Please refresh the page and try again.');
        return;
    }

    console.log('[Admin] Opening modal for report:', report.id, report.url);

    // Populate Data
    document.getElementById('report-modal-url').textContent = report.url;
    document.getElementById('report-modal-reporter').textContent = report.reporter || 'Anonymous';
    document.getElementById('report-modal-date').textContent = new Date(report.timestamp).toLocaleString();

    // Status Badge
    const statusContainer = document.getElementById('report-modal-status-container');
    const status = report.status || 'pending';
    if (status === 'banned') statusContainer.innerHTML = '<span class="badge" style="background:#dc3545; color:white">🚫 BANNED</span>';
    else if (status === 'ignored') statusContainer.innerHTML = '<span class="badge" style="background:#6c757d; color:white">IGNORED</span>';
    else statusContainer.innerHTML = '<span class="badge" style="background:#ffc107; color:black">PENDING REVIEW</span>';

    // --- AI ANALYSIS LOGIC ---
    const aiLoading = document.getElementById('ai-loading');
    const aiResult = document.getElementById('ai-result-container');
    const aiAction = document.getElementById('ai-action-container');
    const btnRunAI = document.getElementById('btn-run-ai');

    const aiPublish = document.getElementById('ai-publish-container');
    const btnPublishAI = document.getElementById('btn-publish-ai');

    // Reset UI
    aiLoading.style.display = 'none';
    aiResult.style.display = 'none';
    aiAction.style.display = 'none';
    if (aiPublish) aiPublish.style.display = 'none';

    // ALWAYS show the Action Button first, never auto-show result
    aiAction.style.display = 'block';

    // Logic: Allow running/re-running analysis anytime
    if (report.aiAnalysis) {
        renderAIResult(report.aiAnalysis);
        btnRunAI.innerHTML = '<i class="fas fa-sync"></i> Re-Analyze (AI)';
        aiAction.style.display = 'block'; // Allow re-scan
    } else {
        btnRunAI.innerHTML = 'Run AI Analysis';
        aiAction.style.display = 'block';
    }

    btnRunAI.onclick = () => {
        // Show provider selection instead of immediately running
        aiAction.style.display = 'none';

        // Create provider selection UI
        const providerSelection = document.createElement('div');
        providerSelection.id = 'provider-selection';
        providerSelection.style.cssText = 'display: flex; gap: 10px; justify-content: center; margin: 20px 0;';

        const groqBtn = document.createElement('button');
        groqBtn.className = 'btn';
        groqBtn.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 24px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; transition: transform 0.2s;';
        groqBtn.innerHTML = '🚀 Analyze with Groq<br><small style="opacity:0.8; font-size:11px;">Llama 3.3 70B</small>';
        groqBtn.onmouseover = () => groqBtn.style.transform = 'scale(1.05)';
        groqBtn.onmouseout = () => groqBtn.style.transform = 'scale(1)';

        const geminiBtn = document.createElement('button');
        geminiBtn.className = 'btn';
        geminiBtn.style.cssText = 'background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 12px 24px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; transition: transform 0.2s;';
        geminiBtn.innerHTML = '✨ Analyze with Gemini<br><small style="opacity:0.8; font-size:11px;">Gemini 2.5 Flash</small>';
        geminiBtn.onmouseover = () => geminiBtn.style.transform = 'scale(1.05)';
        geminiBtn.onmouseout = () => geminiBtn.style.transform = 'scale(1)';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-outline';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding: 12px 24px;';

        providerSelection.appendChild(groqBtn);
        providerSelection.appendChild(geminiBtn);
        providerSelection.appendChild(cancelBtn);

        // Insert after aiAction container
        aiAction.parentNode.insertBefore(providerSelection, aiAction.nextSibling);

        // Handler function for running analysis with selected provider
        const runAnalysis = (provider) => {
            console.log('[Admin] Starting AI analysis with provider:', provider);
            console.log('[Admin] Report data:', { id: report.id, url: report.url });

            providerSelection.remove();
            aiLoading.style.display = 'block';

            const requestPayload = {
                id: report.id,
                url: report.url,  // Add URL as fallback for server lookup
                provider: provider
            };

            console.log('[Admin] Sending AI verification request:', requestPayload);

            fetch(`${API_BASE}/reports/ai-verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload)
            })
                .then(res => {
                    console.log('[Admin] AI analysis response status:', res.status);
                    return res.json();
                })
                .then(data => {
                    console.log('[Admin] AI analysis response data:', data);
                    aiLoading.style.display = 'none';
                    aiAction.style.display = 'block';

                    if (data.success && data.aiAnalysis) {
                        console.log('[Admin] AI analysis successful:', data.aiAnalysis);
                        report.aiAnalysis = data.aiAnalysis;
                        renderAIResult(report.aiAnalysis);
                        btnRunAI.innerHTML = '<i class="fas fa-check"></i> Analysis Updated';
                        setTimeout(() => {
                            btnRunAI.innerHTML = '<i class="fas fa-sync"></i> Re-Analyze (AI)';
                        }, 2000);
                    } else {
                        console.error('[Admin] AI analysis failed:', data);
                        alert("AI Analysis Failed: " + (data.error || data.message || 'Unknown Error'));
                    }
                })
                .catch(err => {
                    console.error('[Admin] AI analysis network error:', err);
                    aiLoading.style.display = 'none';
                    aiAction.style.display = 'block';
                    alert("Network Error during AI Scan: " + err.message);
                });
        };

        groqBtn.onclick = () => runAnalysis('groq');
        geminiBtn.onclick = () => runAnalysis('gemini');
        cancelBtn.onclick = () => {
            providerSelection.remove();
            aiAction.style.display = 'block';
        };
    };

    function renderAIResult(analysis) {
        aiResult.style.display = 'block';
        const score = analysis.riskScore || analysis.score || analysis.phishing_risk_score || 0;
        const suggestion = analysis.suggestion;

        document.getElementById('ai-score').textContent = `Risk Score: ${score}/100`;

        // Handle multi-line reason text with proper formatting
        const reasonElement = document.getElementById('ai-reason');
        const reasonText = analysis.reason || "Analysis completed.";

        // Replace newlines with <br> tags and preserve formatting
        reasonElement.innerHTML = reasonText
            .replace(/\n/g, '<br>')
            .replace(/🚨/g, '<br><br>🚨')
            .replace(/🎯/g, '<br><br>🎯');

        // Apply better styling for readability
        reasonElement.style.whiteSpace = 'pre-wrap';
        reasonElement.style.lineHeight = '1.6';

        // --- Dynamic Powered By Label ---
        const providerLabel = document.querySelector('.ai-provider-label');
        if (providerLabel) {
            if ((reasonText || "").includes("[Heuristic]")) {
                // Check if it's Gemini fallback or pure heuristic
                if (reasonText.includes("Gemini")) {
                    providerLabel.innerText = "POWERED BY GEMINI";
                    providerLabel.style.opacity = "1";
                    providerLabel.title = "Verified by Gemini 2.5 Flash (Groq Unavailable)";
                } else {
                    providerLabel.innerText = "LOCAL SYSTEM CHECK";
                    providerLabel.style.opacity = "0.7";
                    providerLabel.title = "No AI key provided. Using local pattern matching.";
                }
            } else {
                providerLabel.innerText = "POWERED BY PHISHINGSHIELD";
                providerLabel.style.opacity = "1";
                providerLabel.title = "Verified by AI Threat Analysis via PhishingShield Engine";
            }
        }

        const badge = document.getElementById('ai-badge');
        badge.textContent = `AI: ${suggestion}`;

        if (suggestion === 'BAN') {
            badge.style.background = '#fee2e2';
            badge.style.color = '#dc2626';
        } else if (suggestion === 'CAUTION') {
            badge.style.background = '#fef3c7';
            badge.style.color = '#d97706';
        } else {
            badge.style.background = '#dcfce7';
            badge.style.color = '#166534';
        }

        // --- Handle Publish/Upload Button Visibility ---
        if (aiPublish) {
            if (analysis.published) {
                aiPublish.style.display = 'none';
            } else {
                aiPublish.style.display = 'block';
                // --- RESET BUTTON STATE ---
                btnPublishAI.innerHTML = '📤 Upload Report to User';
                btnPublishAI.disabled = false;
                btnPublishAI.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';

                btnPublishAI.onclick = async () => {
                    btnPublishAI.innerHTML = 'Uploading...';
                    btnPublishAI.disabled = true;

                    try {
                        const res = await fetch(`${API_BASE}/reports/publish`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: report.id })
                        });
                        const data = await res.json();

                        if (data.success) {
                            btnPublishAI.innerHTML = '✅ Uploaded to User';
                            btnPublishAI.style.background = '#10b981';
                            analysis.published = true;
                            setTimeout(() => {
                                aiPublish.style.display = 'none';
                            }, 2000);
                        } else {
                            alert('Publish failed: ' + data.message);
                            btnPublishAI.innerHTML = '📤 Upload Report to User';
                            btnPublishAI.disabled = false;
                        }
                    } catch (err) {
                        alert('Network Error while uploading report.');
                        btnPublishAI.innerHTML = '📤 Upload Report to User';
                        btnPublishAI.disabled = false;
                    }
                };
            }
        }
    }


    // Footer Actions
    const footer = document.getElementById('report-modal-footer');
    footer.innerHTML = '';

    // Create Buttons dynamically
    // 1. BAN (if not already banned)
    if (status !== 'banned') {
        const banBtn = document.createElement('button');
        banBtn.className = 'btn';
        banBtn.style.background = '#dc3545';
        banBtn.style.color = 'white';
        banBtn.innerHTML = '🚫 Ban Site';
        banBtn.onclick = () => {
            window.banSite(report.url, report.id);
            modal.classList.add('hidden');
        };
        footer.appendChild(banBtn);
    }

    // 2. UNBAN (if banned)
    if (status === 'banned') {
        const unbanBtn = document.createElement('button');
        unbanBtn.className = 'btn';
        unbanBtn.style.background = '#198754';
        unbanBtn.style.color = 'white';
        unbanBtn.textContent = '✅ Unban Site';
        unbanBtn.onclick = () => {
            window.unbanSite(report.url, report.id);
            modal.classList.add('hidden');
        };
        footer.appendChild(unbanBtn);
    }

    // 3. IGNORE (if pending)
    if (status === 'pending') {
        const ignoreBtn = document.createElement('button');
        ignoreBtn.className = 'btn btn-outline';
        ignoreBtn.textContent = '✓ Ignore Report';
        ignoreBtn.onclick = () => {
            window.ignoreReport(report.url, report.id);
            modal.classList.add('hidden');
        };
        footer.appendChild(ignoreBtn);
    }

    // 4. Verify Link
    const verifyBtn = document.createElement('button');
    verifyBtn.className = 'btn btn-outline';
    verifyBtn.style.borderColor = '#0d6efd';
    verifyBtn.style.color = '#0d6efd';
    verifyBtn.innerHTML = '🔗 Open Link';
    verifyBtn.onclick = () => {
        chrome.tabs.create({ url: report.url, active: false });
    };
    footer.appendChild(verifyBtn);

    // 5. Close Button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-outline';
    closeBtn.style.marginLeft = '10px';
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => modal.classList.add('hidden');
    footer.appendChild(closeBtn);

    // Show
    modal.classList.remove('hidden');
}

// --- LOGOUT LOGIC + COMMUNITY TRUST MANAGER LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    // Inject Logout button into user panel (Admin session control)
    const userPanel = document.querySelector('.user-panel');
    if (userPanel && !document.getElementById('admin-logout-btn')) {
        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'admin-logout-btn';
        logoutBtn.textContent = 'Logout';
        logoutBtn.style.cssText = 'margin-top: 10px; width: 100%; padding: 8px; background: #dc3545; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;';
        logoutBtn.onclick = () => {
            chrome.storage.local.remove(['adminToken', 'adminTokenExpiry', 'adminUser'], () => {
                const adminLoginUrl = chrome.runtime?.getURL ? chrome.runtime.getURL('admin-login.html') : 'admin-login.html';
                window.location.href = adminLoginUrl;
            });
        };
        userPanel.appendChild(logoutBtn);
    }

    // COMMUNITY TRUST MANAGER: bind buttons & tab hooks
    let trustDataLoaded = false; // Flag to track if data has been loaded

    const refreshTrustBtn = document.getElementById('btn-refresh-trust');
    if (refreshTrustBtn) {
        refreshTrustBtn.addEventListener('click', () => {
            // Force refresh by clearing cache
            refreshTrustBtn.dataset.forceRefresh = 'true';
            loadTrustData();
            // Reset flag after a delay
            setTimeout(() => {
                refreshTrustBtn.dataset.forceRefresh = 'false';
            }, 1000);
        });
    }



    const clearTrustBtn = document.getElementById('btn-clear-trust');
    if (clearTrustBtn) {
        clearTrustBtn.addEventListener('click', handleClearTrust);
    }

    const trustTabLink = document.querySelector('[data-tab="trust"]');

    if (trustTabLink) {
        trustTabLink.addEventListener('click', () => {
            // Always reload data when tab is clicked to ensure fresh global sync
            console.log('[Admin] Community Trust tab clicked - loading fresh data...');
            loadTrustData();
            trustDataLoaded = true;
        });
    }
});

function loadTrustData() {
    const tbody = document.querySelector('#trust-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Fetching data...</td></tr>';

    // Always use cache-busting to ensure fresh data
    const cacheParam = `?t=${Date.now()}`;
    const url = `${API_BASE}/trust/all${cacheParam}`;

    console.log('[Admin] Fetching trust data from server...', url);

    fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(res => {
            if (!res) throw new Error('No response from server');
            if (!res.ok) return res.text().then(t => { throw new Error(t) });
            return res.json();
        })
        .then(data => {
            console.log('[Admin] Trust data received:', Array.isArray(data) ? `${data.length} entries` : 'Not an array');

            if (!Array.isArray(data)) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#dc3545;">Invalid data format.</td></tr>';
                return;
            }

            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#6c757d;">No trust data recorded yet.</td></tr>';
                return;
            }

            // CACHE DATA FOR SEARCH
            window.trustDataCache = data;

            // Render Initial View
            renderTrustTable(data);
        })
        .catch(err => {
            console.error("Failed to load trust data:", err);
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#dc3545; padding:20px;">
                <div style="margin-bottom:10px;">❌ Error loading trust data</div>
                <div style="font-size:12px; color:#6c757d;">${err.message}</div>
            </td></tr>`;
        });
}

function renderTrustTable(data) {
    const tbody = document.querySelector('#trust-table tbody');
    if (!tbody) return;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#6c757d;">No matching domains found.</td></tr>';
        return;
    }

    tbody.innerHTML = '';

    // Sort by Total Votes (Impact) descending
    // Create a copy to avoid mutating cache if passed directly
    const sortedData = [...data].sort((a, b) => {
        const aTotal = (a.safe || 0) + (a.unsafe || 0);
        const bTotal = (b.safe || 0) + (b.unsafe || 0);
        return bTotal - aTotal;
    });

    sortedData.forEach(item => {
        if (!item || !item.domain) return;

        const total = (item.safe || 0) + (item.unsafe || 0);

        let scoreVal = 0;
        let scoreText = 'N/A';
        let barColor = '#e2e8f0';

        if (total > 0) {
            scoreVal = Math.round((item.safe / total) * 100);
            scoreText = scoreVal + '%';
            barColor = scoreVal >= 70 ? '#10b981' : (scoreVal > 30 ? '#f59e0b' : '#ef4444');
        }

        let statusBadge = '';
        if (total === 0) statusBadge = '<span class="badge" style="background:#f1f5f9; color:#64748b">NO DATA</span>';
        else if (scoreVal >= 70) statusBadge = '<span class="badge" style="background:#dcfce7; color:#166534">SAFE</span>';
        else if (scoreVal <= 30) statusBadge = '<span class="badge" style="background:#fee2e2; color:#991b1b">MALICIOUS</span>';
        else statusBadge = '<span class="badge" style="background:#fff7ed; color:#9a3412">SUSPICIOUS</span>';

        const progressBar = `
            <div style="width:100px; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden; display:inline-block; vertical-align:middle; margin-right:8px;">
                <div style="width:${total === 0 ? 0 : scoreVal}%; height:100%; background:${barColor}"></div>
            </div>
            <span style="font-weight:bold; font-size:12px;">${scoreText}</span>
        `;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:600; color:#1e293b;">${item.domain}</td>
            <td>${progressBar}</td>
            <td style="color:#166534;">+${item.safe || 0}</td>
            <td style="color:#dc3545;">-${item.unsafe || 0}</td>
            <td>${statusBadge} <span style="font-size:11px; color:#64748b; margin-left:5px;">(${total} votes)</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// function handleTrustSync() Removed (Auto-sync enabled)
// function checkTrustSyncStatus() Removed (Auto-sync enabled)

function handleClearTrust() {
    if (!confirm("⚠️ Are you sure you want to delete ALL trust scores?\n\nThis cannot be undone.")) return;

    fetch('https://phishingshield-ruby.vercel.app/api/trust/clear', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert("Trust history cleared successfully.");
                loadTrustData(); // Reload table (should be empty)
            }
        })
        .catch(err => {
            console.error(err);
            alert("Failed to clear history.");
        });
}

// --- SYSTEM SYNC LOGIC ---
function checkServerStatus() {
    console.log("[System Sync] Checking connectivity...");

    // UI Elements
    const syncValue = document.getElementById('stats-sync-value');
    const syncStatus = document.getElementById('stats-sync-status');

    if (!syncValue || !syncStatus) return;

    let localOnline = false;
    let globalOnline = false;

    // 1. Check Local Server
    const checkLocal = fetch('https://phishingshield-ruby.vercel.app/api/reports', { method: 'HEAD' })
        .then(res => { localOnline = res.ok; })
        .catch(() => { localOnline = false; });

    // 2. Check Global Server
    const checkGlobal = fetch('https://phishingshield-ruby.vercel.app/api/reports', { method: 'HEAD' })
        .then(res => { globalOnline = res.ok; })
        .catch(() => { globalOnline = false; });

    // Execute Both
    Promise.allSettled([checkLocal, checkGlobal]).then(() => {
        console.log(`[System Sync] Local: ${localOnline}, Global: ${globalOnline}`);

        if (localOnline && globalOnline) {
            // 100%
            syncValue.textContent = "100%";
            syncValue.style.color = "#166534"; // green
            syncStatus.innerHTML = `✅ <strong>All Systems Online</strong>`;
        } else if (!localOnline && !globalOnline) {
            // 0%
            syncValue.textContent = "0%";
            syncValue.style.color = "#dc3545"; // red
            syncStatus.innerHTML = `❌ <strong>System Blackout</strong>`;
        } else {
            // 50%
            syncValue.textContent = "50%";
            syncValue.style.color = "#d97706"; // orange

            if (localOnline) {
                syncStatus.innerHTML = `⚠️ <strong>Local Only</strong> (Global Offline)`;
            } else {
                syncStatus.innerHTML = `⚠️ <strong>Global Only</strong> (Local Offline)`;
            }
        }
    });
}

