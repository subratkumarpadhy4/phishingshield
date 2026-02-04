// Service Worker Window Polyfill for Firebase (Legacy support removed)
// Running on cloud backend (https://oculus-eight.vercel.app)

let db = null; // No longer used

console.log("[Oculus] Service Worker Starting... " + new Date().toISOString());

// API Endpoints
const DEV_MODE = false;
const API_BASE = DEV_MODE ? "http://localhost:3000/api" : "https://oculus-eight.vercel.app/api";
const LOCAL_API = "http://localhost:3000/api/reports";
const GLOBAL_API = "https://oculus-eight.vercel.app/api/reports";

// -----------------------------------------------------------------------------
// TRUSTED EXTENSIONS WHITELIST (Tier 1: Trusted)
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// TRUSTED EXTENSIONS WHITELIST (Tier 1: Trusted)
// -----------------------------------------------------------------------------
// Map of ID -> Name for extensions we explicitly trust.
const TRUSTED_EXTENSIONS = {
    "ghbmnnjooekpmoecnnnilnnbdlolhkhi": "Google Docs Offline",
    "kbfnbcaeplbcioakkpcpgfkobkghlhen": "Grammarly",
    "cfhdojbkjhnklbpkdaibdccddilifddb": "Adblock Plus",
    "cjpalhdlnbpafiamejdnhcphjbkeiagm": "uBlock Origin",
    "eimadpbcbfnmbkopoojfekhnkhdbieeh": "Dark Reader",
    "pkeeekfbjjpdkbngjolptfiedbfbcjoa": "LastPass", // Just examples, can be expanded
    // Add PhishingShield's own ID if known, though it won't check itself usually
};

// -----------------------------------------------------------------------------
// EXTENSION SCANNER LOGIC (Shared)
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// EXTENSION SCANNER LOGIC (Shared)
// -----------------------------------------------------------------------------

// Calculate Risk Score based on Permissions & Manifest
function checkExtensionRisk(ext) {
    // 1. Check Whitelist (TIER: TRUSTED)
    if (TRUSTED_EXTENSIONS[ext.id]) {
        return { tier: 'TRUSTED', riskScore: 0, manifest: 'Verified', details: [] };
    }

    let riskScore = 0;
    let details = [];
    const perms = ext.permissions || [];

    // 2. Manifest Version Check (Google Deprecation)
    const mv = ext.manifestVersion || 2; // Default to 2 if unknown
    if (mv === 2) {
        riskScore += 40;
        details.push("Manifest V2 (Legacy/Unsafe)");
    }

    // 3. Permission Risk Scoring
    if (perms.includes('<all_urls>') || perms.some(p => p.includes('://*'))) {
        riskScore += 50;
        details.push("Access to All Websites");
    }
    if (perms.includes('cookies')) {
        riskScore += 20;
        details.push("Read/Write Cookies");
    }
    if (perms.includes('tabs')) {
        riskScore += 10;
        details.push("Read Browser Tabs");
    }
    if (perms.includes('webRequest') || perms.includes('webRequestBlocking')) {
        riskScore += 30;
        details.push("Intercept Network Requests");
    }
    if (perms.includes('info.private')) {
        riskScore += 90; // Extremely rare/suspicious
        details.push("Access Private Info");
    }

    // 4. Determine Tier
    let tier = 'SAFE';
    if (riskScore >= 70) tier = 'CRITICAL';
    else if (riskScore >= 40) tier = 'HIGH_RISK';
    else if (riskScore >= 20) tier = 'CAUTION';

    return {
        id: ext.id,
        name: ext.name,
        tier: tier,
        riskScore: riskScore,
        manifestVersion: mv,
        installType: ext.installType,
        permissions: perms,
        details: details
    };
}

// Full Scan function (Cleans up deleted extensions automatically)
function scanAllExtensions() {
    if (!chrome.management) return;

    chrome.management.getAll((extensions) => {
        const results = [];
        const selfId = chrome.runtime.id;

        extensions.forEach(ext => {
            // Skip self and disabled extensions (optional: User said "only loaded one")
            if (ext.id === selfId || !ext.enabled) return;

            const assessment = checkExtensionRisk(ext);

            // Only store if there's some risk or it's noteworthy
            // User requested showing analysis, so we might want to store ALL loaded extensions 
            // so they can be analyzed in the dashboard.
            results.push(assessment);

            // Notification for new critical threats
            if (assessment.tier === 'CRITICAL' && Date.now() - (ext.installTime || 0) < 60000) {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'images/icon48.png',
                    title: '🚨 Critical Extension Detected',
                    message: `${ext.name} has dangerous permissions! Check Dashboard.`,
                    priority: 2
                });
            }
        });

        // OVERWRITE storage to ensure deleted extensions are gone
        chrome.storage.local.set({ suspectedExtensions: results }, () => {
            console.log(`[Oculus] Extension Scan Complete. Found ${results.length} active extensions.`);
        });
    });
}

// -----------------------------------------------------------------------------
// EVENT LISTENERS (Real-time Scanning)
// -----------------------------------------------------------------------------
if (chrome.management) {
    // 1. Startup
    chrome.runtime.onStartup.addListener(() => {
        scanAllExtensions();
        // Restore Shadow Profile if needed
        chrome.storage.local.get(['digital_dna_mode'], (res) => {
            if (res.digital_dna_mode === 'always') {
                const SCRIPT_ID = "digital-dna-script";
                chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }, (scripts) => {
                    if (!scripts || scripts.length === 0) {
                        console.log("[Oculus] restoring Shadow Profile...");
                        chrome.scripting.registerContentScripts([{
                            id: SCRIPT_ID,
                            js: ["js/digital_dna.js"],
                            matches: ["<all_urls>"],
                            runAt: "document_start",
                            world: "MAIN"
                        }]);
                    }
                });
            }
        });
    });

    // 2. Install / Uninstall / Enable / Disable
    chrome.management.onInstalled.addListener(scanAllExtensions);
    chrome.management.onUninstalled.addListener(scanAllExtensions);
    chrome.management.onEnabled.addListener(scanAllExtensions);
    chrome.management.onDisabled.addListener(scanAllExtensions);

    // Initial Scan on load
    scanAllExtensions();
}

// -----------------------------------------------------------------------------
// CONTEXT MENU - REPORT WEBSITE
// -----------------------------------------------------------------------------
console.log("[Oculus] Initializing context menu module...");

// Create context menu item for reporting websites
function createContextMenu() {
    console.log("[Oculus] createContextMenu() called");

    // Check if contextMenus API is available
    if (!chrome.contextMenus) {
        console.error("[Oculus] contextMenus API not available - extension may not have permission");
        return;
    }

    // Remove all existing menus first to prevent duplicates
    chrome.contextMenus.removeAll(() => {
        if (chrome.runtime.lastError) {
            console.warn("[Oculus] Error removing old menus:", chrome.runtime.lastError.message);
        }

        // Now create the menu item
        chrome.contextMenus.create({
            id: "report-to-phishingshield",
            title: "Report to PhishingShield",
            contexts: ["page", "link", "selection"]
        }, () => {
            if (chrome.runtime.lastError) {
                console.error("[Oculus] Context Menu Creation Error:", chrome.runtime.lastError.message);
            } else {
                console.log("[Oculus] ✅ Context menu created successfully!");
            }
        });
    });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "report-to-phishingshield") {
        console.log("[Oculus] Report context menu clicked");

        // Get the URL to report (either clicked link or current page)
        // info.linkUrl is available when right-clicking on a link
        // tab.url is available when right-clicking on the page
        const urlToReport = info.linkUrl || (tab && tab.url) || '';

        if (!urlToReport || urlToReport.startsWith('chrome://') || urlToReport.startsWith('chrome-extension://') || urlToReport.startsWith('edge://') || urlToReport.startsWith('moz-extension://')) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'images/icon48.png',
                title: 'Cannot Report',
                message: 'System pages cannot be reported.',
                priority: 2
            });
            return;
        }

        chrome.storage.local.get(['currentUser', 'adminUser', 'users'], (data) => {
            // --- ROBUST USER IDENTITY RETRIEVAL ---
            let reporterEmail = 'Anonymous';
            let reporterName = 'Anonymous';

            // 1. Check currentUser (Primary)
            if (data.currentUser && data.currentUser.email) {
                reporterEmail = data.currentUser.email;
                reporterName = data.currentUser.name || 'User';
            }
            // 2. Check adminUser (Secondary)
            else if (data.adminUser && data.adminUser.email) {
                reporterEmail = data.adminUser.email;
                reporterName = data.adminUser.name || 'Admin';
            }

            // 3. Fallback: Check 'users' cache if we have an email but generic name
            if (reporterEmail !== 'Anonymous' && (reporterName === 'User' || reporterName === 'Admin')) {
                const cachedUsers = data.users || [];
                const found = cachedUsers.find(u => u.email === reporterEmail);
                if (found && found.name) {
                    reporterName = found.name;
                    console.log(`[Oculus] Found better name in cache for ${reporterEmail}: ${reporterName}`);
                }
            }

            // Display string for legacy compatibility
            const reporterDisplay = (reporterEmail !== 'Anonymous')
                ? `${reporterName} (${reporterEmail})`
                : 'Anonymous';

            console.log(`[Oculus] 🚩 Reporting as: ${reporterDisplay}`);
            console.log(`[Oculus] Account Status: ${reporterEmail !== 'Anonymous' ? 'LOGGED_IN' : 'GUEST'}`);

            let hostname;
            try {
                hostname = new URL(urlToReport).hostname;
            } catch (e) {
                hostname = urlToReport;
            }

            // TRY TO GET ANALYSIS FROM TAB FIRST
            function sendReport(analysisData = null) {
                const reportPayload = {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                    url: urlToReport,
                    hostname: hostname,
                    reporter: reporterDisplay,
                    reporterName: reporterName,
                    reporterEmail: reporterEmail,
                    timestamp: Date.now(),
                    status: 'pending',
                    // Attach User's Local Analysis
                    aiAnalysis: analysisData ? {
                        score: analysisData.score || 0,
                        suggestion: (analysisData.score > 70) ? 'BAN' : (analysisData.score > 40 ? 'CAUTION' : 'IGNORE'),
                        reason: (analysisData.reasons || []).join(' | '),
                        timestamp: Date.now()
                    } : null
                };

                // Use Shared Submission Logic (Offline Sync Supported)
                submitReport(reportPayload, (res) => {
                    // Success (or Queued)
                    console.log("[Oculus] Context Menu Report Handled:", res);

                    // Add XP
                    chrome.storage.local.get(['userXP', 'userLevel'], (data) => {
                        let xp = data.userXP || 0;
                        xp += 10;
                        updateXP(10);
                    });

                    // Notify User
                    if (tab && tab.id) {
                        const msg = res.queued ?
                            "Report queued for offline sync.\n(+10 XP)" :
                            "Thank you for keeping the web safe.\n(+10 XP)";

                        chrome.tabs.sendMessage(tab.id, {
                            type: "SHOW_NOTIFICATION",
                            title: res.queued ? "Report Queued" : "Report Sent!",
                            message: msg
                        }).catch(() => {
                            // Fallback
                            chrome.scripting.executeScript({
                                target: { tabId: tab.id },
                                func: (m) => alert("✅ " + m),
                                args: [msg]
                            });
                        });
                    }
                });
            }

            // Fetch Analysis from Content Script
            if (tab && tab.id) {
                chrome.tabs.sendMessage(tab.id, { type: "GET_RISK_ANALYSIS" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log("[Oculus] Could not fetch analysis (Script blocked?), sending basic report.");
                        sendReport(null);
                    } else {
                        console.log("[Oculus] Got Analysis from Tab:", response);
                        sendReport(response);
                    }
                });
            } else {
                sendReport(null);
            }
        });
    }
});

// -----------------------------------------------------------------------------
// MESSAGE LISTENERS
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// CONNECTION KEEP-ALIVE (Robust SW Lifespan)
// -----------------------------------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'keepAlive') {
        console.log("[Oculus] Keep-Alive Connection Established");
        port.onDisconnect.addListener(() => {
            console.log("[Oculus] Keep-Alive Connection Closed - Client Disconnected");
        });
        // Optional: Send a heartbeat back periodically if really needed, but connection itself helps
    }
});

// -----------------------------------------------------------------------------
// MESSAGE LISTENERS
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// OFFLINE SYNC & REPORTING LOGIC
// -----------------------------------------------------------------------------
// API endpoints already defined at top of file (lines 9-10)

/**
 * reliable report submission with offline queueing
 */
function submitReport(payload, sendResponse) {
    // 1. Always save to local history (User Experience)
    chrome.storage.local.get(['reportedSites'], (res) => {
        const logs = res.reportedSites || [];
        // Avoid duplicates in history
        if (!logs.some(r => r.id === payload.id)) {
            logs.push(payload);
            chrome.storage.local.set({ reportedSites: logs });
        }
    });

    const tryGlobal = () => {
        fetch(GLOBAL_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                console.log("[Oculus] ✅ Report Synced to Global Server:", data);
                if (sendResponse) sendResponse({ success: true, data: data });
            })
            .catch(err => {
                console.warn("[Oculus] ⚠️ Global Sync Failed. Queuing report...", err);
                // Queue for later
                queueReportForSync(payload);
                if (sendResponse) sendResponse({ success: true, queued: true }); // treat as success to client
            });
    };

    // 2. Try LOCAL API First (Timeout 2s)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    fetch(LOCAL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
    })
        .then(res => {
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error("Local API Error");
            return res.json();
        })
        .then(data => {
            console.log("[Oculus] ✅ Report Sent to LOCAL Server:", data);
            if (sendResponse) sendResponse({ success: true, data: data });

            // Backup: Fire-and-forget to Global as well (Dual Write for consistency)
            fetch(GLOBAL_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(e => console.log("Global backup write failed (non-critical):", e));
        })
        .catch(err => {
            console.log("[Oculus] Local Server Unreachable (or timeout). Falling back to Global...", err);
            tryGlobal();
        });
}

function queueReportForSync(payload) {
    chrome.storage.local.get(['pendingReports'], (res) => {
        const queue = res.pendingReports || [];
        if (!queue.some(r => r.id === payload.id)) {
            queue.push(payload);
            chrome.storage.local.set({ pendingReports: queue }, () => {
                console.log(`[Oculus] Report queued. Total pending: ${queue.length}`);
                // Try to sync again soon
                chrome.alarms.create('retrySync', { delayInMinutes: 1 });
            });
        }
    });
}

function processPendingReports() {
    chrome.storage.local.get(['pendingReports'], (res) => {
        const queue = res.pendingReports || [];
        if (queue.length === 0) return;

        console.log(`[Oculus] 🔄 Processing ${queue.length} pending reports...`);

        // Take first item
        const report = queue[0];

        fetch(GLOBAL_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(report)
        })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                console.log(`[Oculus] ✅ Pending report ${report.id} synced!`);

                // Remove from queue on success
                const newQueue = queue.slice(1);
                chrome.storage.local.set({ pendingReports: newQueue }, () => {
                    // Determine if we should continue immediately or wait
                    if (newQueue.length > 0) {
                        processPendingReports(); // Process next
                    }
                });
            })
            .catch(err => {
                console.warn(`[Oculus] Sync retry failed for ${report.id}:`, err);
                // Keep in queue, wait for next alarm
            });
    });
}

// Alarm Listener for Sync
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'retrySync' || alarm.name === 'periodicSync') {
        processPendingReports();
    }
});

// Create periodic sync alarm if not exists
chrome.alarms.get('periodicSync', (a) => {
    if (!a) chrome.alarms.create('periodicSync', { periodInMinutes: 5 });
});

// Also trigger on online check
self.addEventListener('online', () => {
    console.log("[Oculus] Came Online! Syncing...");
    processPendingReports();
});


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // console.log("[Oculus] 🔵 Message received:", request.type);

    // PING to wake up service worker
    if (request.type === "PING") {
        sendResponse({ success: true, awake: true });
        return false; // Synchronous response
    }

    // 1. EXTENSION SECURITY CHECK (Async)
    if (request.type === "CHECK_EXTENSION_ID") {
        const extId = request.id;
        chrome.management.get(extId, (info) => {
            if (chrome.runtime.lastError) {
                console.warn(`[Oculus] Could not query extension ${extId}:`, chrome.runtime.lastError);
                sendResponse({ tier: 'HIGH_RISK', name: 'Unknown' });
                return;
            }
            const result = checkExtensionRisk(extId, info);
            sendResponse(result);
        });
        return true; // Keep channel open
    }

    // 2. LOG VISIT
    if (request.type === "LOG_VISIT") {
        const data = request.data;
        // Respond immediately
        sendResponse({ success: true });

        // Async processing (fire and forget)
        updateXP(5);
        chrome.storage.local.get(['visitLog'], (res) => {
            const logs = Array.isArray(res.visitLog) ? res.visitLog : [];
            if (logs.length > 200) logs.shift();
            if (data) logs.push(data);
            chrome.storage.local.set({ visitLog: logs });
        });
        return false; // Response already sent synchronously
    }

    // 3. ADD XP
    if (request.type === "ADD_XP") {
        const amount = request.amount || 10;
        updateXP(amount);
        sendResponse({ success: true });
        return false; // Synchronous response
    }

    // 4. REPORT SITE (Async using Helper)
    if (request.type === "REPORT_SITE") {
        chrome.storage.local.get(['currentUser', 'adminUser', 'users'], (data) => {
            // --- ROBUST USER IDENTITY RETRIEVAL (MATCHING CONTEXT MENU) ---
            let reporterEmail = 'Anonymous';
            let reporterName = 'Anonymous';

            if (data.currentUser && data.currentUser.email) {
                reporterEmail = data.currentUser.email;
                reporterName = data.currentUser.name || 'User';
            } else if (data.adminUser && data.adminUser.email) {
                reporterEmail = data.adminUser.email;
                reporterName = data.adminUser.name || 'Admin';
            }

            if (reporterEmail !== 'Anonymous' && (reporterName === 'User' || reporterName === 'Admin')) {
                const cachedUsers = data.users || [];
                const found = cachedUsers.find(u => u.email === reporterEmail);
                if (found && found.name) reporterName = found.name;
            }

            const reporterDisplay = (reporterEmail !== 'Anonymous')
                ? `${reporterName} (${reporterEmail})`
                : 'Anonymous';

            const reportPayload = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                url: request.url,
                hostname: request.hostname,
                reporter: reporterDisplay,
                reporterName: reporterName,
                reporterEmail: reporterEmail,
                timestamp: Date.now(),
                status: 'pending'
            };

            submitReport(reportPayload, sendResponse);
        });
        return true; // Keep channel open
    }

    // NEW: Debug Identity Handler
    if (request.type === "GET_DEBUG_IDENTITY") {
        chrome.storage.local.get(['currentUser'], (data) => {
            sendResponse({
                currentUser: data.currentUser,
                serviceWorkerActive: true
            });
        });
        return true;
    }

    // 5. UPDATE BLOCKLIST
    if (request.type === "UPDATE_BLOCKLIST") {
        const bypassUrl = request.bypassUrl || null;
        blocklistCache.data = null;
        blocklistCache.timestamp = 0;
        updateBlocklistFromStorage(bypassUrl, function () {
            sendResponse({ success: true, blocklistUpdated: true });
        }, true);
        return true; // Keep channel open
    }

    // 6. FORCE BLOCKLIST SYNC
    if (request.type === "FORCE_BLOCKLIST_SYNC") {
        blocklistCache.data = null;
        blocklistCache.timestamp = 0;
        updateBlocklistFromStorage(null, function () {
            sendResponse({ success: true, synced: true });
        }, true);
        return true; // Keep channel open
    }

    // 7. SYNC XP
    if (request.type === "SYNC_XP") {
        syncXPToServer();
        sendResponse({ success: true });
        return false; // Synchronous
    }

    // 8. SCAN CONTENT (Use Global Server for AI)
    if (request.type === "SCAN_CONTENT") {
        const payload = {
            url: request.url,
            content: request.content
        };

        console.log(`[Oculus] 🤖 Initiating AI Scan for ${payload.url.substring(0, 50)}...`);

        // Use API_BASE for AI scanning (Local or Global)
        const scanEndpoint = `${API_BASE}/ai/scan`;
        console.log(`[Oculus] 🤖 Initiating AI Scan via ${scanEndpoint}...`);

        fetch(scanEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                console.log("[Oculus] ✅ AI Scan Success:", data);
                sendResponse(data);
            })
            .catch(err => {
                console.error("[Oculus] AI Scan Failed:", err);
                sendResponse({ success: false, error: err.message });
            });

        return true; // Keep channel open
    }




    // 9. TOGGLE SHADOW PROFILE (Digital DNA)
    if (request.type === "TOGGLE_SHADOW_PROFILE") {
        const SCRIPT_ID = "digital-dna-script";

        if (request.enabled) {
            // 1. PERSISTENCE: Register script globally (for future reloads)
            chrome.scripting.registerContentScripts([{
                id: SCRIPT_ID,
                js: ["js/digital_dna.js"],
                matches: ["<all_urls>"],
                runAt: "document_start",
                world: "MAIN"
            }]).catch(err => { /* Ignore duplicate */ });

            // 2. IMMEDIATE ACTION: Inject Script Tag (Guaranteed Main World Execution)
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTab = tabs[0];
                if (activeTab) {
                    chrome.scripting.executeScript({
                        target: { tabId: activeTab.id },
                        func: () => {
                            const s = document.createElement('script');
                            s.src = chrome.runtime.getURL('js/digital_dna.js');
                            s.onload = function () { this.remove(); };
                            (document.head || document.documentElement).appendChild(s);
                            console.log("[Oculus] Injecting Digital DNA via Script Tag...");
                        }
                    }).catch(e => console.warn("Script Tag Injection Failed", e));
                }
            });

            sendResponse({ success: true });

        } else {
            // Unregister script
            chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] })
                .catch(err => { });
            sendResponse({ success: true });
        }
        return true;
    }

    return false;
});

/**
 * Simple and Reliable XP System
 */
function calculateLevel(xp) {
    return Math.floor(Math.sqrt(xp / 100)) + 1;
}

function updateXP(amount) {
    console.log("[Oculus] ========== updateXP CALLED ==========");
    console.log("[Oculus] Amount:", amount);

    if (amount === undefined || amount === null || amount === 0) {
        console.warn("[Oculus] Invalid XP amount:", amount);
        return;
    }

    // VISIBLE DEBUGGING FOR PENALTY
    if (amount < 0) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'images/icon48.png',
            title: '⚠️ Applying Penalty',
            message: `Processing ${amount} XP deduction...`,
            priority: 2
        });
    }

    // Show badge notification (different color for negative amounts)
    try {
        if (amount > 0) {
            chrome.action.setBadgeText({ text: `+${amount}` });
            chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
        } else {
            chrome.action.setBadgeText({ text: `${amount}` });
            chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
        }
        setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
    } catch (e) {
        console.warn("[Oculus] Badge update failed:", e);
    }

    // Get current XP and update it
    console.log("[Oculus] Reading storage...");
    chrome.storage.local.get(['userXP', 'userLevel', 'users', 'currentUser'], (data) => {
        console.log("[Oculus] Storage data received:", data);
        // Initialize if not set
        let currentXP = typeof data.userXP === 'number' ? data.userXP : 0;
        let currentLevel = typeof data.userLevel === 'number' ? data.userLevel : 1;
        let users = Array.isArray(data.users) ? data.users : [];
        let currentUser = data.currentUser || null;

        // Add XP (can be negative for penalties)
        currentXP = currentXP + amount;
        // Ensure XP doesn't go below 0
        if (currentXP < 0) {
            currentXP = 0;
        }
        const newLevel = calculateLevel(currentXP);

        console.log("[Oculus] XP Update: " + (currentXP - amount) + " + " + amount + " = " + currentXP + " (Level " + newLevel + ")");

        // Check for level up
        if (newLevel > currentLevel) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'images/icon48.png',
                title: '🎉 Level Up!',
                message: `Congratulations! You reached Level ${newLevel}.`
            });

            // Broadcast to all tabs
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.id) {
                        chrome.tabs.sendMessage(tab.id, {
                            type: "LEVEL_UP",
                            level: newLevel
                        }).catch(() => { });
                    }
                });
            });
        }

        // Check for XP penalty (negative amount)
        if (amount < 0) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'images/icon48.png',
                title: '⚠️ XP Penalty Applied',
                message: `You lost ${Math.abs(amount)} XP for visiting a banned website.`
            });
        }

        // Prepare update object
        const updateData = {
            userXP: currentXP,
            userLevel: newLevel,
            lastXpUpdate: Date.now(), // Timestamp for precise sync
            pendingXPSync: true
        };

        // Update user in users array if logged in
        if (currentUser && currentUser.email) {
            const userIndex = users.findIndex(u => u && u.email === currentUser.email);
            if (userIndex >= 0) {
                users[userIndex].xp = currentXP;
                users[userIndex].level = newLevel;
                updateData.users = users;
            }
        }

        // Save to storage
        console.log("[Oculus] Saving to storage:", updateData);
        chrome.storage.local.set(updateData, () => {
            if (chrome.runtime.lastError) {
                console.error("[Oculus] ❌ FAILED to save XP:", chrome.runtime.lastError);
            } else {
                console.log("[Oculus] ✅ XP saved successfully:", currentXP);

                // [FIX] Trigger Immediate Sync with DIRECT DATA
                // Prevents race conditions where storage isn't ready
                syncXPToServer(
                    { isPenalty: amount < 0 },
                    {
                        userXP: currentXP,
                        userLevel: newLevel,
                        lastXpUpdate: updateData.lastXpUpdate,
                        currentUser: currentUser
                    }
                );
            }
        });
    });
    console.log("[Oculus] ========== updateXP EXIT ==========");
}

function updateSafeStreak(isCritical) {
    chrome.storage.local.get(['lastCriticalTime', 'safeStreak'], (result) => {
        if (isCritical) {
            chrome.storage.local.set({
                lastCriticalTime: Date.now(),
                safeStreak: 0,
                pendingXPSync: true // Sync the reset
            });
        }
    });
}

/**
 * Fortress Mode: Block 3rd Party Scripts
 */
function updateFortressRules(enabled) {
    const FORTRESS_RULE_ID = 999;

    if (enabled) {
        chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [{
                "id": FORTRESS_RULE_ID,
                "priority": 10,
                "action": { "type": "block" },
                "condition": {
                    "resourceTypes": ["script"],
                    "domainType": "thirdParty"
                }
            }]
        }, () => {
            console.log("[Oculus] Fortress Mode: 3rd Party Scripts Blocked.");
        });
    } else {
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [FORTRESS_RULE_ID]
        }, () => {
            console.log("[Oculus] Fortress Mode: Normal Script Access Restored.");
        });
    }
}

console.log("PhishingShield Service Worker Loaded - " + new Date().toISOString());

// Create context menu - this is critical for MV3
// Try to create immediately (for cases where extension was already installed)
try {
    createContextMenu();
} catch (e) {
    console.error("[Oculus] Error creating context menu on startup:", e);
}

// Create context menu on install/update
chrome.runtime.onInstalled.addListener((details) => {
    console.log("[Oculus] Extension installed/updated:", details.reason);
    createContextMenu();
});

// Also create on browser startup
chrome.runtime.onStartup.addListener(() => {
    console.log("[Oculus] Browser startup");
    createContextMenu();
});

// Initialize XP system on startup
chrome.storage.local.get(['userXP', 'userLevel'], (result) => {
    console.log("[Oculus] Startup - Current XP:", result.userXP, "Level:", result.userLevel);
    if (result.userXP === undefined || result.userXP === null) {
        chrome.storage.local.set({ userXP: 0, userLevel: 1 }, () => {
            console.log("[Oculus] ✅ XP system initialized to 0");
        });
    } else {
        console.log("[Oculus] XP system already initialized:", result.userXP);
    }
});

// Listen for storage changes to debug
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.userXP) {
        console.log("[Oculus] 🔔 Storage changed - userXP:", changes.userXP.newValue, "(was:", changes.userXP.oldValue, ")");
    }
});

// Test function - call this from console to verify service worker is active
self.testServiceWorker = function () {
    console.log("[Oculus] ✅ Service Worker is ACTIVE!");
    chrome.storage.local.get(['userXP', 'userLevel'], (r) => {
        console.log("[Oculus] Current XP:", r.userXP, "Level:", r.userLevel);
    });
    return true;
};

/**
 * COMMUNITY BLOCKLIST
 * Converts 'banned' reports into active blocking rules.
 * Syncs with server to get global banned sites.
 */
// Cache for blocklist to reduce server calls
let blocklistCache = {
    data: null,
    timestamp: 0,
    TTL: 2000 // 2 seconds cache
};

function updateBlocklistFromStorage(bypassUrl = null, callback = null, forceRefresh = false) {
    // First get local banned sites and blacklist, and bypass tokens
    chrome.storage.local.get(['reportedSites', 'blacklist', 'bypassTokens'], (result) => {
        const reports = result.reportedSites || [];
        const blacklist = result.blacklist || [];
        let bypassTokens = result.bypassTokens || [];

        // Clean up old bypass tokens (older than 5 minutes or already used)
        const now = Date.now();
        bypassTokens = bypassTokens.filter(token => {
            // Remove tokens older than 5 minutes or already used
            return !token.used && (now - token.timestamp) < 5 * 60 * 1000;
        });

        // If a specific URL is being bypassed, ensure it's in the tokens
        if (bypassUrl) {
            const existingToken = bypassTokens.find(t => t.url === bypassUrl);
            if (!existingToken) {
                bypassTokens.push({
                    url: bypassUrl,
                    timestamp: now,
                    used: false
                });
            }
        }

        // Save cleaned up tokens
        chrome.storage.local.set({ bypassTokens: bypassTokens });

        let banned = reports.filter(r => r.status === 'banned');

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

        // Also add any URLs from blacklist array that aren't in reports
        // (Server status check will happen in processBlocklist)
        blacklist.forEach(url => {
            const normalizedUrl = normalizeUrl(url);
            // Check if already in banned list (using normalized comparison)
            const alreadyBanned = banned.some(r => {
                const rUrl = normalizeUrl(r.url);
                const rHostname = normalizeUrl(r.hostname || '');
                return rUrl === normalizedUrl || rHostname === normalizedUrl;
            });

            if (!alreadyBanned) {
                try {
                    const hostname = new URL(url).hostname;
                    banned.push({
                        url: url,
                        hostname: hostname,
                        status: 'banned'
                    });
                } catch (e) {
                    // If URL parsing fails, use as-is
                    banned.push({
                        url: url,
                        hostname: url,
                        status: 'banned'
                    });
                }
            }
        });

        // FETCH BANNED SITES FROM SERVER (GLOBAL PROTECTION)
        const API_GLOBAL = 'https://oculus-eight.vercel.app/api/reports';
        const API_LOCAL = 'http://localhost:3000/api/reports';
        const nowServer = Date.now();

        // Use cache if available and not expired, unless force refresh
        if (!forceRefresh && blocklistCache.data && (nowServer - blocklistCache.timestamp) < blocklistCache.TTL) {
            console.log("[Oculus] Using cached blocklist data");
            processBlocklist(blocklistCache.data, banned, bypassTokens, callback);
            return;
        }

        // Fetch from BOTH Local and Global servers
        Promise.allSettled([
            fetch(API_LOCAL).then(res => res.json()).catch(err => []),
            fetch(API_GLOBAL).then(res => res.json()).catch(err => [])
        ]).then(results => {
            const localData = results[0].status === 'fulfilled' ? results[0].value : [];
            const globalData = results[1].status === 'fulfilled' ? results[1].value : [];

            // Helper to merge arrays unique by ID
            const mergedReports = [...localData];
            globalData.forEach(item => {
                if (!mergedReports.some(loc => loc.id === item.id)) {
                    mergedReports.push(item);
                }
            });

            console.log(`[Oculus] Fetched Reports: ${localData.length} Local, ${globalData.length} Global. Merged: ${mergedReports.length}`);

            // Update cache
            blocklistCache.data = mergedReports;
            blocklistCache.timestamp = nowServer;

            // Clean up blacklist: Remove URLs that are explicitly unbanned on server
            const unbannedUrls = new Set();
            mergedReports.forEach(r => {
                if (r.status !== 'banned') {
                    unbannedUrls.add(normalizeUrl(r.url));
                    try {
                        const hostname = r.hostname || new URL(r.url).hostname;
                        unbannedUrls.add(normalizeUrl(hostname));
                    } catch (e) {
                        // Skip if URL parsing fails
                    }
                }
            });

            // Remove unbanned URLs from blacklist array
            if (unbannedUrls.size > 0) {
                const cleanedBlacklist = blacklist.filter(url => {
                    const normalized = normalizeUrl(url);
                    return !unbannedUrls.has(normalized);
                });

                if (cleanedBlacklist.length !== blacklist.length) {
                    console.log(`[Oculus] Cleaning blacklist: removed ${blacklist.length - cleanedBlacklist.length} unbanned URLs`);
                    chrome.storage.local.set({ blacklist: cleanedBlacklist });
                }
            }

            processBlocklist(mergedReports, banned, bypassTokens, callback);
        });
    });
}

// Helper function to process blocklist data
function processBlocklist(serverReports, banned, bypassTokens, callback) {
    const serverBanned = serverReports.filter(r => r.status === 'banned');

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

    // Create a map of ALL server reports (not just banned) for status checking
    // Index by both URL and hostname for flexible matching
    const serverReportsByUrl = new Map();
    const serverReportsByHostname = new Map();

    serverReports.forEach(r => {
        const urlKey = normalizeUrl(r.url);
        if (!serverReportsByUrl.has(urlKey)) {
            serverReportsByUrl.set(urlKey, r);
        }

        // Also index by hostname
        try {
            const hostname = r.hostname || new URL(r.url).hostname;
            const hostKey = normalizeUrl(hostname);
            if (!serverReportsByHostname.has(hostKey)) {
                serverReportsByHostname.set(hostKey, r);
            }
        } catch (e) {
            // Skip if URL parsing fails
        }
    });

    // Helper to find matching server report for a banned item
    const findServerReport = (bannedItem) => {
        const urlKey = normalizeUrl(bannedItem.url);
        const hostnameKey = normalizeUrl(bannedItem.hostname || '');

        // Check by URL first
        let serverReport = serverReportsByUrl.get(urlKey);
        if (serverReport) return serverReport;

        // Check by hostname
        if (hostnameKey) {
            serverReport = serverReportsByHostname.get(hostnameKey);
            if (serverReport) return serverReport;
        }

        // Also check if any server report's URL/hostname matches this banned item's URL/hostname
        for (const r of serverReports) {
            const rUrlKey = normalizeUrl(r.url);
            const rHostnameKey = normalizeUrl(r.hostname || '');

            if (rUrlKey === urlKey || rUrlKey === hostnameKey ||
                (hostnameKey && rHostnameKey === hostnameKey) ||
                (hostnameKey && rHostnameKey === urlKey)) {
                return r;
            }
        }

        return null;
    };

    // Merge local and server banned sites (deduplicate by URL)
    // BUT: Remove any local banned sites that are explicitly unbanned on server
    const bannedMap = new Map();

    // First, add local banned sites, but check server status
    banned.forEach(r => {
        const serverReport = findServerReport(r);

        // If server has this URL and it's NOT banned, skip it (it's been unbanned)
        if (serverReport && serverReport.status !== 'banned') {
            console.log(`[Oculus] Skipping ${r.url} - server status is '${serverReport.status}' (unbanned)`);
            return; // Skip this banned entry
        }

        const key = normalizeUrl(r.url);
        bannedMap.set(key, r);
    });

    // Then add server banned sites
    serverBanned.forEach(r => {
        const key = normalizeUrl(r.url);
        if (!bannedMap.has(key)) {
            bannedMap.set(key, r);
        } else {
            // Update with server data (server is source of truth)
            bannedMap.set(key, r);
        }
    });

    banned = Array.from(bannedMap.values());

    // Filter out URLs that have active bypass tokens
    // Match by both full URL and hostname for flexibility
    const activeBypassUrls = new Set();
    const activeBypassHostnames = new Set();
    bypassTokens.forEach(token => {
        activeBypassUrls.add(token.url);
        try {
            const urlObj = new URL(token.url);
            activeBypassHostnames.add(urlObj.hostname);
        } catch (e) {
            // If URL parsing fails, skip hostname
        }
    });

    banned = banned.filter(r => {
        // Check if URL matches
        if (activeBypassUrls.has(r.url)) return false;
        // Check if hostname matches
        try {
            const rHostname = r.hostname || new URL(r.url).hostname;
            if (activeBypassHostnames.has(rHostname)) return false;
        } catch (e) {
            // If parsing fails, continue
        }
        return true;
    });

    console.log(`[Oculus] Blocklist: ${banned.length} sites (${bypassTokens.length} bypassed)`);

    // Convert to Rules
    const newRules = banned.map((r, index) => {
        let hostname;
        try {
            hostname = r.hostname || new URL(r.url).hostname;
        } catch (e) {
            hostname = r.url;
        }

        return {
            "id": 2000 + index, // IDs 2000+ for Community Blocklist
            "priority": 1,
            "action": {
                "type": "redirect",
                "redirect": { "extensionPath": "/banned.html?url=" + encodeURIComponent(r.url) }
            },
            "condition": {
                "urlFilter": "||" + hostname,
                "resourceTypes": ["main_frame"]
            }
        };
    }).filter(rule => rule && rule.condition.urlFilter !== "||undefined"); // Filter invalid rules

    // Clear old 2000+ rules and add new ones
    chrome.declarativeNetRequest.getDynamicRules((currentRules) => {
        const removeIds = currentRules.filter(r => r.id >= 2000).map(r => r.id);
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: removeIds,
            addRules: newRules
        }, () => {
            console.log(`[Oculus] Blocklist Updated: ${newRules.length} sites blocked globally.`);
            if (callback) callback();
        });
    });
}

// Update on Startup
chrome.runtime.onStartup.addListener(updateBlocklistFromStorage);
chrome.runtime.onInstalled.addListener(updateBlocklistFromStorage);

// UPDATE_BLOCKLIST is handled in the main message listener above

// --- FAST BLOCKLIST SYNC (DISABLED BY USER REQUEST) ---
// Note: Chrome alarms minimum is 1 minute, so we use setInterval for faster sync
let blocklistSyncInterval = null;

function startBlocklistSync() {
    // Clear any existing interval
    if (blocklistSyncInterval) {
        clearInterval(blocklistSyncInterval);
    }
    console.log("[Oculus] Periodic sync disabled. Use 'Force Sync' in Admin Panel.");

    // Sync every 10 seconds (Global Protection Heartbeat)
    blocklistSyncInterval = setInterval(() => {
        updateBlocklistFromStorage(null, () => {
            // success callback (silent)
        });
    }, 10000); // 10 seconds
    console.log("[Oculus] Periodic blocklist sync enabled (10s)");
}

// Start the sync interval (Effectively does nothing now)
startBlocklistSync();

// Also sync on tab activation to catch updates quickly - DISABLED BY USER REQUEST
/*
chrome.tabs.onActivated.addListener(() => {
    updateBlocklistFromStorage(null, () => {
        console.log("[Oculus] Blocklist synced (tab activated)");
    });
});
*/

// -----------------------------------------------------------------------------
// BYPASS TOKEN MANAGEMENT - One-time bypass for banned sites
// -----------------------------------------------------------------------------

// Listen for tab updates to detect when user navigates to a bypassed URL
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only process when navigation is complete (status === 'complete')
    if (changeInfo.status === 'complete' && tab.url) {
        chrome.storage.local.get(['bypassTokens'], (data) => {
            const tokens = data.bypassTokens || [];
            const activeTokens = tokens.filter(t => !t.used);

            // Check if this URL matches any active bypass token
            const matchingToken = activeTokens.find(token => {
                try {
                    const tokenUrl = new URL(token.url);
                    const currentUrl = new URL(tab.url);
                    // Match by hostname (allows navigation to any page on the domain)
                    return tokenUrl.hostname === currentUrl.hostname;
                } catch (e) {
                    // Fallback to exact URL match
                    return token.url === tab.url;
                }
            });

            if (matchingToken) {
                console.log('[Oculus] User navigated to bypassed URL:', tab.url);
                console.log('[Oculus] Marking bypass token as used (one-time use)');

                // Mark token as used
                matchingToken.used = true;
                matchingToken.usedAt = Date.now();

                // Save updated tokens
                chrome.storage.local.set({ bypassTokens: tokens }, () => {
                    // Rebuild blocklist to re-block this URL
                    console.log('[Oculus] Rebuilding blocklist - URL will be blocked again on next visit');
                    updateBlocklistFromStorage();
                });
            }
        });
    }
});

// -----------------------------------------------------------------------------
// XP SYNC (Global Leaderboard)
// -----------------------------------------------------------------------------

// Sync XP every 1 minute
chrome.alarms.create("syncXP", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "syncXP") {
        syncXPToServer();
    }
});

function syncXPToServer(customData = {}, directData = null) {
    const doSync = (res) => {
        // Sync always if user is logged in (acts as heartbeat to fetch server updates like Admin Promotions)
        if (res.currentUser && res.currentUser.email) {
            console.log("[Oculus] Syncing XP to Global Leaderboard...", customData);

            // CRITICAL: If lastXpUpdate is missing, use a timestamp that's OLDER than current time
            const syncTimestamp = res.lastXpUpdate || (res.pendingXPSync ? Date.now() : Date.now() - 60000); // If no timestamp, use 1 min ago

            const userData = {
                ...res.currentUser,
                xp: res.userXP,
                level: res.userLevel,
                lastUpdated: syncTimestamp, // Send timestamp (old if not set, to prevent overwriting admin edits)

                ...customData // Allow overrides like { isPenalty: true }
            };

            // Sync to server
            fetch(`${API_BASE}/users/sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(userData)
            })
                .then(async r => {
                    const data = await r.json();

                    // HANDLE DELETED USER (Force Logout)
                    if (r.status === 410 || r.status === 404 || (data.error === "USER_DELETED") || (data.error === "USER_VIOLATION")) {
                        console.warn("[Oculus] Account DELETED by Server. Logging out...");
                        chrome.storage.local.remove(['currentUser', 'userXP', 'userLevel', 'pendingXPSync'], () => {
                            chrome.notifications.create({
                                type: 'basic',
                                iconUrl: 'images/icon48.png',
                                title: '🚨 Account Deleted',
                                message: 'Your account has been removed by the administrator. You have been logged out.',
                                priority: 2,
                                requireInteraction: true
                            });
                            // Broadcast logout
                            chrome.tabs.query({}, (tabs) => {
                                tabs.forEach(tab => {
                                    if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "LOGOUT" }).catch(() => { });
                                });
                            });
                        });
                        return; // Stop processing
                    }

                    if (data.success) {
                        console.log("[Oculus] ✅ XP Global Sync Successful");
                        chrome.storage.local.set({ pendingXPSync: false });

                        // 2-Way Sync: Always check server response and update if server has newer data
                        // CRITICAL: Server always returns the current server state, even if request was rejected
                        if (data.user) {
                            const serverTime = Number(data.user.lastUpdated) || 0;
                            const localTime = Number(res.lastXpUpdate) || 0;

                            // Always update if server timestamp is newer OR if server XP is different (admin edit)
                            // This ensures admin edits propagate to client even if client sent old XP
                            if (serverTime > localTime || (data.user.xp !== res.userXP && serverTime > localTime)) {
                                console.log(`[Oculus] 📥 Server is newer (${serverTime} > ${localTime}). Updating local XP: ${res.userXP} -> ${data.user.xp}`);

                                chrome.storage.local.set({
                                    userXP: data.user.xp,
                                    userLevel: data.user.level || calculateLevel(data.user.xp),
                                    lastXpUpdate: serverTime
                                }, () => {

                                    // Notify tabs to update HUD
                                    chrome.tabs.query({}, (tabs) => {
                                        tabs.forEach(tab => {
                                            if (tab.id) chrome.tabs.sendMessage(tab.id, {
                                                type: "XP_UPDATE",
                                                xp: data.user.xp,
                                                level: data.user.level
                                            }).catch(() => { });
                                        });
                                    });
                                });
                            } else {
                                console.log(`[Oculus] Local is newer (${localTime} >= ${serverTime}) and XP matches. Keeping local XP: ${res.userXP}`);
                            }
                        }
                    } else if (r.status === 403 || r.status === 401) {
                        // Soft Logout / Auth Token Invalid?
                        console.warn("[Oculus] Auth Error during sync:", data.message);
                    }

                    // --- REPORT SELF-HEALING (Persistence) ---
                    // Check if my reports exist on server. If not (Wipe), re-upload.
                    if (data.success) syncReportsHeal();
                })
                .catch(e => console.error("[Oculus] ❌ XP Sync Failed:", e));
        }
    };

    if (directData) {
        doSync(directData);
    } else {
        chrome.storage.local.get(['currentUser', 'userXP', 'userLevel', 'pendingXPSync', 'lastXpUpdate'], doSync);
    }
}

function syncReportsHeal() {
    chrome.storage.local.get(['reportedSites'], (res) => {
        const myReports = res.reportedSites || [];
        if (myReports.length === 0) return;

        fetch(`${API_BASE}/reports`)
            .then(r => r.json())
            .then(serverReports => {
                const serverUrls = new Set(serverReports.map(r => r.url));

                myReports.forEach(localR => {
                    if (!serverUrls.has(localR.url)) {
                        console.warn(`[Oculus] Report missing on server (Wipe?): ${localR.url}. Re-uploading...`);
                        fetch(`${API_BASE}/reports`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(localR)
                        }).catch(e => console.error("Report Heal Failed", e));
                    }
                });
            })
            .catch(() => { });
    });
}
// -----------------------------------------------------------------------------
// SUSPICIOUS DOWNLOAD MONITOR & VIRUSTOTAL SCANNER
// -----------------------------------------------------------------------------
const DANGEROUS_EXTENSIONS = [
    'exe', 'scr', 'pif', 'bat', 'vbs', 'ps1', 'msi', 'com', 'cmd', 'js', 'gadget'
];

if (chrome.downloads && chrome.downloads.onCreated) {
    chrome.downloads.onCreated.addListener((downloadItem) => {
        // 1. Basic Filters: Ignore blob/data urls
        if (!downloadItem.url || downloadItem.url.startsWith('blob:') || downloadItem.url.startsWith('data:')) {
            return;
        }

        console.log(`[Oculus] Intercepting download: ${downloadItem.url}`);

        // 2. PAUSE DOWNLOAD FOR ANALYSIS
        chrome.downloads.pause(downloadItem.id, async () => {
            if (chrome.runtime.lastError) {
                console.warn("[Oculus] Could not pause download:", chrome.runtime.lastError);
                return; // Already completed or error
            }

            const filename = (downloadItem.filename || "unknown").toLowerCase();
            const url = downloadItem.url;

            // --- HEURISTIC CHECKS (Local, Fast) ---

            // Check 1: Double Extension (e.g. invoice.pdf.exe)
            const isDoubleExtension = /\.[a-z0-9]{3,4}\.(exe|scr|pif|bat)$/i.test(filename);

            // Check 2: Dangerous Extension
            const fileExt = filename.split('.').pop();
            const isDangerousExt = DANGEROUS_EXTENSIONS.includes(fileExt);

            if (isDoubleExtension) {
                blockDownload(downloadItem.id, "🛑 BLOCKED: Deceptive File Extension",
                    `The file "${filename}" is likely an executable disguised as a document.`);
                return;
            }

            // Notify user scan is starting
            chrome.notifications.create({
                type: "basic",
                iconUrl: "images/icon128.png",
                title: "Scanning Download 🛡️",
                message: isDangerousExt ? `Scanning potentially risky .${fileExt} file...` : "Verifying file source with VirusTotal...",
                priority: 0
            });

            // --- VIRUSTOTAL CHECK (Cloud, Slow) ---
            try {
                const response = await fetch(`${API_BASE}/antivirus/scan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ resource: url, type: 'url' })
                });

                const data = await response.json();
                let isMalicious = false;
                let vendors = 0;

                if (data.success && data.result) {
                    const stats = data.result.last_analysis_stats;
                    if (stats) {
                        // Strict Block: >= 1 Malicious OR >= 2 Suspicious
                        if (stats.malicious >= 1 || stats.suspicious >= 2) {
                            isMalicious = true;
                            vendors = (stats.malicious || 0) + (stats.suspicious || 0);
                        }
                    }
                } else if (!data.success && data.message && data.message.includes("Scan started")) {
                    // New URL queued. Fail Open (Allow), but warn if dangerous ext?
                    if (isDangerousExt) {
                        chrome.notifications.create({
                            type: 'basic', iconUrl: 'images/icon48.png',
                            title: "⚠️ CAUTION: Unverified Executable",
                            message: `This .${fileExt} file is unknown to VirusTotal. Proceed with caution.`,
                            priority: 1
                        });
                    }
                    chrome.downloads.resume(downloadItem.id);
                    return;
                }

                if (isMalicious) {
                    blockDownload(downloadItem.id, "Download Blocked 🚨",
                        `PhishingShield detected a malicious file source! (${vendors} vendors flagged it)`);
                } else {
                    // SAFE
                    chrome.downloads.resume(downloadItem.id);
                }

            } catch (error) {
                console.error("[Oculus] Download scan error:", error);
                // Fail Open (Resume)
                chrome.downloads.resume(downloadItem.id);
            }
        });
    });

    // Helper to block and notify
    function blockDownload(downloadId, title, message) {
        chrome.downloads.cancel(downloadId, () => {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'images/icon128.png',
                title: title,
                message: message,
                priority: 2,
                buttons: [{ title: "View Details in Dashboard" }]
            });
        });
    }

    // Handle Notification Clicks
    chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
        if (btnIdx === 0) {
            chrome.tabs.create({ url: "dashboard.html#tab-virustotal" });
        }
    });

} else {
    console.warn("[Oculus] chrome.downloads API not available.");
}
