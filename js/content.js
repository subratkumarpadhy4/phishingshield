// PhishingShield Content Script

console.log("PhishingShield Content Script Active");

chrome.storage.local.get(['enablePreview', 'enableLogin', 'enableDownloads', 'enableFortress'], (result) => {
    // Default to true if not set, meaning features are enabled by default
    const enablePreview = result.enablePreview !== false;
    const enableLogin = result.enableLogin !== false;
    const enableDownloads = result.enableDownloads !== false; // Default true
    const enableFortress = result.enableFortress === true; // Default false

    if (enablePreview) {
        initLinkPreview();
    }

    if (enableLogin) {
        initLoginProtection();
    }

    // Pass Fortress Mode to Risk Analysis
    initRiskAnalysis(enableFortress);
    initDownloadProtection(enableFortress, enableDownloads);
    initFortressClipboard(enableFortress);

    // Initial Sync for Fresh XP
    chrome.runtime.sendMessage({ type: "SYNC_XP" });
});

// Listener for Real-Time Events (Level Up)
// Listener for Real-Time Events (Level Up & Notifications)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // LEVEL UP
    if (message.type === "LEVEL_UP") {
        showToast("🎉", "LEVEL UP!", `You are now Level ${message.level}`, "#0d6efd", "#0dcaf0");
    }

    // GENERAL NOTIFICATION (Detailed)
    if (message.type === "SHOW_NOTIFICATION") {
        showToast("✅", message.title, message.message, "#198754", "#20c997");
    }
});

// Helper for beautiful toasts
// Helper for beautiful toasts (Premium Glassmorphism Design)
function showToast(icon, title, text, color1, color2) {
    // Remove existing toast if any
    const existingToast = document.getElementById('phishingshield-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'phishingshield-toast';
    toast.innerHTML = `
        <div style="
            display: flex; 
            align-items: center; 
            justify-content: center; 
            width: 40px; 
            height: 40px; 
            background: rgba(255, 255, 255, 0.2); 
            border-radius: 50%; 
            font-size: 20px; 
            box-shadow: 0 4px 10px rgba(0,0,0,0.1);
            backdrop-filter: blur(5px);
            -webkit-backdrop-filter: blur(5px);
        ">${icon}</div>
        <div style="flex: 1;">
            <div style="font-weight: 700; font-size: 15px; margin-bottom: 3px; letter-spacing: 0.3px;">${title}</div>
            <div style="font-size: 13px; opacity: 0.9; line-height: 1.4;">${text.replace(/\n/g, '<br>')}</div>
        </div>
    `;

    // Dynamic Gradient based on input colors, but with glass feel
    // color1 is usually the main color (e.g. #198754 for success)
    const bgGradient = `linear-gradient(135deg, ${color1}dd, ${color2}dd)`;

    toast.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 30px;
        background: ${bgGradient};
        color: white;
        padding: 16px 20px;
        border-radius: 16px;
        box-shadow: 
            0 10px 30px rgba(0, 0, 0, 0.25), 
            0 0 0 1px rgba(255, 255, 255, 0.2) inset;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 2147483647;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex;
        align-items: center;
        gap: 15px;
        min-width: 300px;
        max-width: 400px;
        transform: translateY(100px) scale(0.9);
        opacity: 0;
        animation: ps-toast-in 0.5s cubic-bezier(0.19, 1, 0.22, 1) forwards;
    `;

    // Add Keyframes unique to this toast
    if (!document.getElementById('ps-toast-style')) {
        const style = document.createElement('style');
        style.id = 'ps-toast-style';
        style.innerHTML = `
            @keyframes ps-toast-in { 
                to { transform: translateY(0) scale(1); opacity: 1; } 
            }
            @keyframes ps-toast-out { 
                to { transform: translateY(20px) scale(0.95); opacity: 0; } 
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // Remove after 5 seconds
    setTimeout(() => {
        toast.style.animation = 'ps-toast-out 0.4s cubic-bezier(0.19, 1, 0.22, 1) forwards';
        setTimeout(() => toast.remove(), 400);
    }, 5000);
}

// SERVICE WORKER KEEP-ALIVE (Robust Connection)
// Uses long-lived port instead of interval messaging
let keepAlivePort;
function connectKeepAlive() {
    // Safety check: specific to "Extension context invalidated"
    if (!chrome.runtime?.id) return;

    try {
        keepAlivePort = chrome.runtime.connect({ name: 'keepAlive' });
        keepAlivePort.onDisconnect.addListener(() => {
            console.log("Keep-Alive disconnected. Reconnecting...");
            setTimeout(connectKeepAlive, 1000); // Reconnect after 1s
        });
    } catch (e) {
        // Extension context invalidated
        console.warn("Connection failed:", e);
    }
}
// Start connection
if (chrome.runtime?.id) connectKeepAlive();
// Fallback: Still ping occasionally to force activity if connection sits idle too long
setInterval(() => {
    if (keepAlivePort) {
        try {
            keepAlivePort.postMessage({ ping: true });
        } catch (e) { connectKeepAlive(); }
    }
}, 25000);

// ... (Link Preview and Login - No changes needed) ...

// Cache for sync access (Download Protection)
let currentPageAnalysis = { score: 0, reasons: [] };

/**
 * Feature 3 (Hackathon): Real-Time Risk Analysis HUD
 */
function initRiskAnalysis(isFortressMode) {
    if (window.location.href.includes('warning.html')) return;
    if (window.location.protocol === 'chrome-extension:') return; // Skip extension pages
    if (window.location.protocol === 'chrome:') return; // Skip chrome:// pages

    chrome.storage.local.get(['userLevel'], async (data) => {
        const userLevel = data.userLevel || 1;
        // const enableQR = userLevel >= 5;       // Unlocks at SCOUT Rank
        const enableQR = true;
        // const enableML = userLevel >= 10;      // Unlocks at CYBER NINJA (Level 10)
        const enableML = true;
        // const enableChameleon = userLevel >= 20; // Unlocks at SENTINEL Rank
        const enableChameleon = true;

        // Configure Risk Engine Locks
        if (typeof RiskEngine !== 'undefined' && RiskEngine.configure) {
            RiskEngine.configure({
                enableQR: enableQR,
                enableML: enableML,
                enableChameleon: enableChameleon
            });
        }

        setTimeout(async () => {
            // Fail-safe: Try to get engine from window if implicit fail
            const Engine = window.RiskEngine || RiskEngine;

            // Default Analysis
            let analysis = {
                score: 0,
                reasons: [],
                primaryThreat: "Analysis Failed (Engine Missing)"
            };

            if (typeof Engine !== 'undefined' && Engine.analyzePage) {
                try {
                    analysis = await Engine.analyzePage();
                } catch (e) {
                    console.error("Risk Engine Crashed:", e);
                    analysis.reasons.push("Error: " + e.message);
                }
            } else {
                console.warn("RiskEngine Missing - Sending fallback log.");
            }

            // 🐍 CHAMELEON CHECK (Visual DNA)
            // FEATURE LOCK: Unlocks at Level 20 (Sentinel)
            if (enableChameleon && typeof Chameleon !== 'undefined') {
                const dnaResult = Chameleon.scan();
                if (dnaResult.isClone) {
                    console.warn("[Content] 🦎 Chameleon Detected Clone:", dnaResult.brand);
                    analysis.score = 100; // Critical Threat - Override to Max
                    analysis.primaryThreat = `🚨 IMPERSONATION: ${dnaResult.brand.toUpperCase()}`;
                    // Add to TOP of reasons
                    analysis.reasons.unshift(
                        `🦎 CHAMELEON ALERT: Page mimics ${dnaResult.brand.toUpperCase()} visual style but is NOT official (+100)`
                    );
                }
            } else if (!enableChameleon && typeof Chameleon !== 'undefined') {
                // Optional: Log locked state
                // console.log("Chameleon Scan Locked (Level < 10)");
            }

            // Fortress Mode: Heightened Sensitivity
            if (isFortressMode) {
                analysis.score += 25; // Base paranoia penalty
                analysis.reasons.push("🛡️ Fortress Mode: Security Tightened (+25)");
                if (analysis.score > 100) analysis.score = 100;
            }
            // Listen for request to get current analysis
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                if (request.type === "GET_RISK_ANALYSIS") {
                    // If we have analysis, send it back
                    // analysis variable is global in this scope
                    sendResponse(analysis);
                }
            });

            // Initial Analysis
            console.log("PhishingShield Risk Analysis:", analysis);

            // Cap score at 100
            analysis.score = Math.min(analysis.score, 100);

            // Update Cache
            currentPageAnalysis = analysis;

            console.log("[Content] Sending LOG_VISIT message...");

            const visitData = {
                url: window.location.href,
                hostname: window.location.hostname || window.location.pathname.split('/').pop(),
                score: analysis.score,
                reasons: analysis.reasons,
                primaryThreat: analysis.primaryThreat,
                timestamp: Date.now()
            };

            // Send LOG_VISIT message with timeout fallback
            let messageReceived = false;
            const timeout = setTimeout(() => {
                if (!messageReceived) {
                    console.warn("[Content] Service worker not responding, updating XP directly");
                    // Fallback: Update XP directly
                    chrome.storage.local.get(['userXP', 'userLevel', 'users', 'currentUser', 'visitLog'], (data) => {
                        let currentXP = typeof data.userXP === 'number' ? data.userXP : 0;
                        currentXP += 5; // +5 XP for visit
                        const newLevel = Math.floor(Math.sqrt(currentXP / 100)) + 1;

                        const logs = Array.isArray(data.visitLog) ? data.visitLog : [];
                        // Keep last 200 entries for better history tracking
                        if (logs.length > 200) logs.shift();
                        logs.push(visitData);

                        const updateData = {
                            userXP: currentXP,
                            userLevel: newLevel,
                            visitLog: logs,
                            pendingXPSync: true
                        };

                        // Update user in users array if logged in
                        if (data.currentUser && data.currentUser.email && Array.isArray(data.users)) {
                            const users = [...data.users];
                            const userIndex = users.findIndex(u => u && u.email === data.currentUser.email);
                            if (userIndex >= 0) {
                                users[userIndex].xp = currentXP;
                                users[userIndex].level = newLevel;
                                updateData.users = users;
                            }
                        }

                        chrome.storage.local.set(updateData, () => {
                            console.log("[Content] ✅ XP updated directly (fallback):", currentXP);
                        });
                    });
                }
            }, 1000);

            chrome.runtime.sendMessage({
                type: "LOG_VISIT",
                data: visitData
            }, (response) => {
                clearTimeout(timeout);
                messageReceived = true;
                if (chrome.runtime.lastError) {
                    console.error("[Content] ❌ LOG_VISIT Error:", chrome.runtime.lastError.message);
                } else {
                    console.log("[Content] ✅ LOG_VISIT Sent Success, response:", response);
                }
            });

            // Fortress Mode: Show HUD for ALMOST EVERYTHING (Score > 0)
            // Standard Mode: Show HUD for Low/Moderate Risk (Score >= 20)
            const threshold = isFortressMode ? 0 : 19;

            if (analysis.score < 20) {
                // Award 10 XP for safe site browsing
                console.log("[Content] Sending ADD_XP message (safe site)...");

                let xpMessageReceived = false;
                const xpTimeout = setTimeout(() => {
                    if (!xpMessageReceived) {
                        console.warn("[Content] Service worker not responding for ADD_XP, updating directly");
                        // Fallback: Update XP directly
                        chrome.storage.local.get(['userXP', 'userLevel', 'users', 'currentUser'], (data) => {
                            let currentXP = typeof data.userXP === 'number' ? data.userXP : 0;
                            currentXP += 10; // +10 XP for safe site
                            const newLevel = Math.floor(Math.sqrt(currentXP / 100)) + 1;

                            const updateData = {
                                userXP: currentXP,
                                userLevel: newLevel,
                                pendingXPSync: true
                            };

                            // Update user in users array if logged in
                            if (data.currentUser && data.currentUser.email && Array.isArray(data.users)) {
                                const users = [...data.users];
                                const userIndex = users.findIndex(u => u && u.email === data.currentUser.email);
                                if (userIndex >= 0) {
                                    users[userIndex].xp = currentXP;
                                    users[userIndex].level = newLevel;
                                    updateData.users = users;
                                }
                            }

                            chrome.storage.local.set(updateData, () => {
                                console.log("[Content] ✅ ADD_XP updated directly (fallback):", currentXP);
                            });
                        });
                    }
                }, 1000);

                chrome.runtime.sendMessage({ type: "ADD_XP", amount: 10 }, (response) => {
                    clearTimeout(xpTimeout);
                    xpMessageReceived = true;
                    if (chrome.runtime.lastError) {
                        console.error("[Content] ❌ ADD_XP Error:", chrome.runtime.lastError.message);
                    } else {
                        console.log("[Content] ✅ ADD_XP Sent Success, response:", response);
                    }
                });
            }



            if (analysis.score > threshold && analysis.score > 0) {
                showRiskHUD(analysis);
            }

            // --- PHASE 2: REAL AI VERIFICATION (Async with Cache) ---
            // Optimization: Check cache first to save API calls/time
            const hasSensitiveInput = document.querySelector('input[type="password"]');
            if (analysis.score >= 20 || hasSensitiveInput) {

                checkAICache(window.location.href, (cachedResult) => {
                    if (cachedResult) {
                        console.log("[Content] ⚡ Using Cached AI Result");
                        updateAnalysisWithAI(analysis, cachedResult);
                    } else {
                        console.log("[Content] Initiating Real AI Scan (No Cache)...");
                        chrome.runtime.sendMessage({
                            type: "SCAN_CONTENT",
                            url: window.location.href,
                            content: document.body.innerText.substring(0, 5000)
                        }, (res) => {
                            if (chrome.runtime.lastError) return;
                            if (res && res.error) console.error("AI Error:", res.error);

                            if (res && res.aiAnalysis) {
                                // Cache the result
                                cacheAIResult(window.location.href, res.aiAnalysis);
                                updateAnalysisWithAI(analysis, res.aiAnalysis);
                            }
                        });
                    }
                });
            }
        }, 1500);
    });
}

// ...HUD function...

/**
 * Feature 4: Download Protection
 */
function initDownloadProtection(isFortressMode, isEnabled) {
    // If feature is disabled AND not in Fortress Mode, do nothing.
    // Fortress Mode overrides the toggle to ensure safety.
    if (!isEnabled && !isFortressMode) return;

    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link || !link.href) return;

        const url = link.href.toLowerCase();
        // Standard risky list + New additions (zip, iso)
        const riskyExtensions = ['.exe', '.msi', '.bat', '.cmd', '.sh', '.zip', '.rar', '.dmg', '.iso'];
        const isRiskyFile = riskyExtensions.some(ext => url.endsWith(ext));

        // Fortress Mode: Check ALL downloads (basic heuristic for files)
        // Checks if it ends in a 3-4 letter extension that isn't .html/.php
        const isFileDownload = /\.[a-z0-9]{3,4}$/.test(url) && !url.includes('.html') && !url.includes('.htm');

        if (isRiskyFile || (isFortressMode && isFileDownload)) {
            const isHttp = window.location.protocol === 'http:';
            const analysis = currentPageAnalysis; // Use cached sync result
            const isRiskyScore = analysis.score > 30;

            // Trigger if: Risky File Extension (ALWAYS) OR HTTP OR Risky Score OR Fortress Mode
            const isDoubleExtension = /\.[a-z0-9]{3,4}\.(exe|scr|pif|bat)$/i.test(url);

            if (isRiskyFile || isDoubleExtension || isHttp || isRiskyScore || isFortressMode) {
                let message = `⚠️ SECURITY WARNING: Download Intercepted.\n`;
                if (isFortressMode) message += `🛡️ Fortress Mode is Active (Zero Trust Enabled).\n`;

                message += `\nRisk Factors:\n`;

                if (isDoubleExtension) {
                    message += `🛑 DECEPTIVE FILE PATTERN DETECTED!\n`;
                    message += `- File is disguised (Double Extension)\n`;
                    message += `- Likely MALWARE masquerading as a document\n`;
                } else if (isRiskyFile) {
                    message += `- High Risk File Type (Executable/Script)\n`;
                }

                if (isHttp) message += `- Connection is not secure (HTTP)\n`;
                if (isRiskyScore) message += `- High Risk Score (Phishing Detected)\n`;

                message += `\nDo you want to proceed?`;

                if (!confirm(message)) {
                    e.preventDefault();
                } else {
                    // Double Confirmation Requirement for Risky Extensions in all modes
                    if (isRiskyFile || isDoubleExtension) {
                        if (!confirm("⚠️ FINAL WARNING: This file type is commonly used for malware.\n\nAre you ABSOLUTELY sure you want to download this?")) {
                            e.preventDefault();
                        }
                    }
                }
            }
        }
    });
}


/**
 * Feature 1: Link Hover Preview
 */
function initLinkPreview() {
    function createTooltip() {
        let tooltip = document.getElementById('phishingshield-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'phishingshield-tooltip';
            tooltip.style.display = 'none';
            document.body.appendChild(tooltip);
        }
        return tooltip;
    }

    const tooltip = createTooltip();

    document.addEventListener('mouseover', (event) => {
        const target = event.target.closest('a');
        if (target && target.href) {
            const href = target.href;
            const text = target.innerText.trim();

            // Show true destination
            // User Request: Show only the "main website" (hostname) to avoid clutter
            let displayUrl = href;
            try {
                const urlObj = new URL(href);
                // If it's a valid URL with a hostname, show ONLY the hostname (e.g. "www.apple.com")
                if (urlObj.hostname) {
                    displayUrl = urlObj.hostname;
                }
            } catch (e) {
                // Keep full text if parsing fails
            }

            let tooltipText = `Destination: ${displayUrl}`;
            let isSuspicious = false;

            // Basic Heuristic for Tooltip Suspicion
            try {
                const url = new URL(href);
                // Excessive subdomains (more than 3 dots is a simple heuristic)
                // e.g. login.update.banc.com
                const parts = url.hostname.split('.');
                if (parts.length > 4) { // e.g. a.b.c.com is 4 parts. 
                    isSuspicious = true;
                }

                // Feature: Mismatch Check
                // SKIP this check on Search Engines (Google, Bing) because their links often redirect/track
                // causing valid links to look like mismatches (e.g. Text: "apple.com", Href: "google.com/url?...")
                const hostname = window.location.hostname;
                const isSearchEngine = /google|bing|yahoo|duckduckgo/.test(hostname);

                if (!isSearchEngine) {
                    // Mismatch Logic:
                    // If the visual text LOOKS like a URL (e.g. "paypal.com", "login.secure.net")
                    // BUT the actual href goes somewhere else, flag it.

                    // Regex for "URL-like" text (contains a dot, no spaces)
                    const isUrlLike = /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\.[a-zA-Z]{2,})?$/.test(text);

                    if (isUrlLike) {
                        try {
                            // Normalize both visual and actual URL for comparison
                            const visualDomain = text.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
                            const actualDomain = url.hostname.replace(/^www\./, '');

                            // If visual text is "google.com" but actual link is "evil.com" -> SUSPICIOUS
                            // We use 'includes' generously to allow subdomains, but flag if totally different
                            if (!actualDomain.includes(visualDomain) && !visualDomain.includes(actualDomain)) {
                                isSuspicious = true;
                                tooltipText += `\n⚠️ DECEPTIVE LINK: Text says "${text}" but goes to "${actualDomain}"`;
                            }
                        } catch (e) { }
                    }
                }

            } catch (e) {
                // Invalid URL
            }

            tooltip.textContent = tooltipText;
            if (isSuspicious) {
                tooltip.classList.add('suspicious');
                tooltip.textContent = "⚠️ SUSPICIOUS LINK: " + tooltipText;
                // Add Pulse Effect to the Anchor itself
                target.classList.add('suspicious-pulse');
            } else {
                tooltip.classList.remove('suspicious');
                target.classList.remove('suspicious-pulse');
            }

            tooltip.style.display = 'block';

            // Position next to cursor
            // We'll update position in mousemove
        }
    });

    document.addEventListener('mousemove', (event) => {
        if (tooltip.style.display === 'block') {
            const x = event.pageX + 10;
            const y = event.pageY + 10;
            tooltip.style.left = x + 'px';
            tooltip.style.top = y + 'px';
        }
    });

    document.addEventListener('mouseout', (event) => {
        const target = event.target.closest('a');
        if (target) {
            tooltip.style.display = 'none';
        }
    });
}


/**
 * Feature 2: Login Form Honeypot / Security Check
 */
function initLoginProtection() {
    function checkForInsecureLogin() {
        const passwordInputs = document.querySelectorAll('input[type="password"]');

        if (passwordInputs.length > 0) {
            if (window.location.protocol !== 'https:') {
                // Insecure page with password field!
                injectSecurityBanner();
            }
        }
    }

    // Run immediately
    checkForInsecureLogin();

    // Also run on DOM changes in case it's an SPA
    const observer = new MutationObserver(() => {
        checkForInsecureLogin();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function injectSecurityBanner(customMsg) {
    if (document.getElementById('phishingshield-banner')) return;

    const msg = customMsg || `⚠️ SECURITY ALERT: Unencrypted password field detected on this page. DO NOT ENTER YOUR CREDENTIALS.`;

    const banner = document.createElement('div');
    banner.id = 'phishingshield-banner';
    banner.innerHTML = `
        <p>${msg}</p>
    `;
    document.body.prepend(banner); // Add to top of body

    // Adjust body margin if needed to not hide content, or just overlay (user request says "prominent... top of page")
    document.body.style.marginTop = '60px';
}

function showRiskHUD(analysis) {
    // If HUD exists, UPDATE it instead of returning
    // If HUD exists, UPDATE it instead of returning
    const existingHUD = document.getElementById('phishingshield-hud');
    if (existingHUD) {
        try {
            // CRITICAL: Update Data First (so info panel has new data even if display fails)
            existingHUD.dataset.analysisIdx = JSON.stringify(analysis);

            // Update Score Badge
            const scoreBadge = document.getElementById('ps-score-badge');
            if (scoreBadge) {
                scoreBadge.innerText = analysis.score;

                // User Request: No background highlighter, just text color
                scoreBadge.style.backgroundColor = 'transparent';
                scoreBadge.style.padding = '0'; // Remove padding if it looks like a box

                let textColor = '#2ed573'; // Default Green
                if (typeof getScoreColor === 'function') {
                    textColor = getScoreColor(analysis.score);
                } else {
                    textColor = analysis.score > 50 ? '#ff4757' : '#2ed573';
                }
                scoreBadge.style.color = textColor;
            }

            // Update Threat Text
            const threatText = document.getElementById('ps-threat-text');
            if (threatText) {
                threatText.innerText = analysis.primaryThreat;
            }

            // Update Details Panel (Always re-render the list content to ensure it's fresh when opened)
            const panel = document.getElementById('hud-details-panel');
            if (panel) {
                // Use 'analysis' object directly.

                let listHtml = '<ul>';
                analysis.reasons.forEach(r => {
                    const match = r.match(/(.*)\s\(\s*([+-]\d+)\s*\)$/);
                    let text = r;
                    let badge = '';

                    if (match) {
                        text = match[1].trim();
                        const scoreVal = parseInt(match[2]);
                        const isSafety = scoreVal < 0 || text.includes('Adaptive Trust') || text.includes('Verified Official');
                        const badgeClass = isSafety ? 'ps-score-badge bonus' : 'ps-score-badge';
                        const sign = scoreVal > 0 ? '+' : '';
                        badge = `<span class="${badgeClass}">${sign}${scoreVal}</span>`;
                    } else if (r.includes('Fortress Mode')) {
                        if (r.includes('+25')) badge = `<span class="ps-score-badge">+25</span>`;
                    } else if (r.includes('(+')) {
                        const simpleMatch = r.match(/\(\+(\d+)\)/);
                        if (simpleMatch) {
                            badge = `<span class="ps-score-badge">+${simpleMatch[1]}</span>`;
                            text = r.replace(`(+${simpleMatch[1]})`, '').trim();
                        }
                    }
                    if (r.includes('AI Analysis') && analysis.aiReportText) {
                        const parts = r.split('(+');
                        if (parts.length > 1) {
                            text = parts[0].trim();
                            // Use data attribute but NO inline handler. Class 'ps-ai-details-btn' will be bound later.
                            badge = `<button class="ps-score-badge ps-ai-details-btn" data-report="${analysis.aiReportText.replace(/['"]/g, "&quot;")}" style="cursor:pointer; border:1px solid #aaa; margin-right:5px;">View Details</button> <span class="ps-score-badge">+${parts[1].replace(')', '')}</span>`;
                        }
                    } else if (r.includes('Real AI Analysis') && analysis.score > 20) {
                        // Fallback for AI text if regex misses it
                        const parts = r.split('(+');
                        if (parts.length > 1) {
                            text = parts[0].trim();
                            badge = `<span class="ps-score-badge">+${parts[1].replace(')', '')}</span>`;
                        }
                    }
                    listHtml += `<li><span>${text}</span>${badge}</li>`;
                });
                listHtml += '</ul>';

                // Keep the title, just update list
                const h4 = panel.querySelector('h4');
                panel.innerHTML = '';
                if (h4) panel.appendChild(h4);
                panel.insertAdjacentHTML('beforeend', listHtml);

                // Bind AI Details Button
                const aiBtn = panel.querySelector('.ps-ai-details-btn');
                if (aiBtn) {
                    aiBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        alert("🧠 AI ASSESSMENT:\n\n" + aiBtn.getAttribute('data-report'));
                    });
                }
            }

        } catch (e) {
            console.error("HUD Update Failed:", e);
        }
        return;
    }

    // CHECK FOR SPECIFIC QUISHING WARNING
    if (analysis.reasons.some(r => r.includes('Suspicious QR Code Link') || r.includes('Quishing'))) {
        // VISIBLE WARNING (Toast)
        if (typeof showToastNotification === 'function') {
            showToastNotification("🚨 Suspicious QR Detected", "Do NOT scan this QR code. It leads to a suspicious website.", "danger");
        }
    }

    // Cleanup
    const existingStyles = document.getElementById('ps-styles');
    if (existingStyles) existingStyles.remove();

    const hud = document.createElement('div');
    hud.id = 'phishingshield-hud';

    // FLOATING PILL / CAPSULE DESIGN (Minimal)
    const styles = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center;
        gap: 15px;
        padding: 12px 20px;
        background: rgba(20, 20, 20, 0.95);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 50px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: white;
        transform: translateY(20px) scale(0.95);
        opacity: 0;
        animation: ps-pop-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        max-width: 400px;
        overflow: visible !important;
    `;

    // Keyframes & Classes
    const styleSheet = document.createElement('style');
    styleSheet.id = 'ps-styles';
    styleSheet.textContent = `
        @keyframes ps-pop-in {
            to { transform: translateY(0) scale(1); opacity: 1; }
        }
        .ps-divider {
            width: 1px;
            height: 24px;
            background: rgba(255,255,255,0.2);
        }
        .ps-action-btn {
            background: none;
            border: none;
            cursor: pointer;
            padding: 8px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #aaa;
            transition: all 0.2s;
            font-size: 18px;
        }
        .ps-action-btn:hover {
            background: rgba(255,255,255,0.2);
            color: white;
            transform: scale(1.1);
        }
        .ps-action-btn.danger { color: #ff6b6b; }
        .ps-action-btn.danger:hover { background: rgba(220, 53, 69, 0.2); }
        
        /* DETAILS PANEL - Enhanced Visibility */
        #hud-details-panel {
            position: fixed;
            bottom: 130px;
            right: 30px;
            width: 320px;
            max-height: 400px;
            overflow-y: auto;
            background: linear-gradient(135deg, rgba(20, 20, 20, 0.98), rgba(30, 30, 30, 0.98));
            backdrop-filter: blur(15px);
            -webkit-backdrop-filter: blur(15px);
            border: 2px solid rgba(96, 165, 250, 0.3);
            border-radius: 16px;
            padding: 18px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.7), 
                        0 0 20px rgba(96, 165, 250, 0.2),
                        inset 0 1px 0 rgba(255, 255, 255, 0.1);
            display: none;
            color: #eee;
            font-size: 13px;
            line-height: 1.5;
            animation: slideUp 0.3s ease-out;
            z-index: 2147483646;
        }
        
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        #hud-details-panel h4 {
            margin: 0 0 12px 0;
            color: #fff;
            font-size: 15px;
            font-weight: 700;
            border-bottom: 2px solid rgba(96, 165, 250, 0.3);
            padding-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        #hud-details-panel h4::before {
            content: '🔍';
            font-size: 16px;
        }
        
        #hud-details-panel ul {
            padding-left: 0;
            margin: 0;
            list-style: none;
        }
        #hud-details-panel li {
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(255, 255, 255, 0.03);
            border-left: 3px solid rgba(96, 165, 250, 0.4);
            padding: 10px 12px;
            border-radius: 6px;
            transition: all 0.2s;
        }
        
        #hud-details-panel li:hover {
            background: rgba(255, 255, 255, 0.08);
            border-left-color: rgba(96, 165, 250, 0.8);
            transform: translateX(3px);
        }
        
        #hud-details-panel li:last-child {
            margin-bottom: 0;
        }
        .ps-score-badge {
            background: rgba(255, 71, 87, 0.25);
            color: #ff6b6b;
            font-size: 11px;
            padding: 4px 8px;
            border-radius: 6px;
            font-weight: bold;
            margin-left: 10px;
            white-space: nowrap;
            border: 1px solid rgba(255, 71, 87, 0.3);
        }
        .ps-score-badge.bonus {
            background: rgba(46, 213, 115, 0.25);
            color: #2ed573;
            border-color: rgba(46, 213, 115, 0.3);
        }
    `;
    document.head.appendChild(styleSheet);

    hud.style.cssText = styles;

    // Status Logic
    let color = '#ffc107'; // Yellow
    let icon = '⚠️';
    if (analysis.score >= 50) {
        color = '#ff6b6b'; // Red
        icon = '🚨';
    }

    // Prepare reasons list with Score Parsing
    const reasonsList = analysis.reasons.map(r => {
        // Regex to extract score: "Some reason (+25)" or "Reason (-10)"
        // Flexible: allows spaces inside parens, before parens, and handles different spacing
        const match = r.match(/(.*)\s\(\s*([+-]\d+)\s*\)$/);

        let text = r;
        let badge = '';

        if (match) {
            text = match[1].trim();
            const scoreVal = parseInt(match[2]);
            const isBonus = scoreVal < 0; // Negative score is good (bonus)
            // Ensure bonus class is applied if score is negative OR if the text implies safety (Green pattern)
            const isSafety = isBonus || text.includes('Adaptive Trust') || text.includes('Verified Official');
            const badgeClass = isSafety ? 'ps-score-badge bonus' : 'ps-score-badge';

            // Ensure sign is displayed
            const sign = scoreVal > 0 ? '+' : '';
            badge = `<span class="${badgeClass}">${sign}${scoreVal}</span>`;
        } else if (r.includes('Fortress Mode')) {
            if (r.includes('+25')) badge = `<span class="ps-score-badge">+25</span>`;
        } else if (r.includes('(+')) {
            // Backup parsing for simple (+Number) if regex failed
            const simpleMatch = r.match(/\(\+(\d+)\)/);
            if (simpleMatch) {
                badge = `<span class="ps-score-badge">+${simpleMatch[1]}</span>`;
                text = r.replace(`(+${simpleMatch[1]})`, '').trim();
            }
        }

        return `<li><span>${text}</span>${badge}</li>`;
    }).join('');

    hud.innerHTML = `
        <!-- Details Panel (Hidden by default) -->
        <div id="hud-details-panel">
            <h4>Risk Factors Detected</h4>
            <ul>${reasonsList || '<li style="justify-content:center; opacity:0.7;">No specific threats found.</li>'}</ul>
        </div>

        <!-- Left: Icon & Score -->
        <div style="display:flex; align-items:center; gap:10px;">
            <div style="font-size: 22px;">${icon}</div>
            <div style="display:flex; flex-direction:column; line-height:1.2;">
                <span id="ps-score-badge" style="font-weight:800; font-size:16px;">${analysis.score}<small style="font-size:11px; opacity:0.7;">/100</small></span>
                <span id="ps-threat-text" style="font-size:11px; color:${color}; font-weight:600; max-width:120px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${analysis.primaryThreat || 'Threat Detected'}
                </span>
            </div>
        </div>

        <div class="ps-divider"></div>

        <!-- Right: Small Icon Actions -->
        <div style="display:flex; align-items:center; gap:5px;">
            <!-- Order: Inspect -> Info -> Report -->
            <button id="hud-inspect" class="ps-action-btn" title="Inspect Page">🔍</button>
            <button id="hud-info" class="ps-action-btn" title="View Details">ℹ️</button>
            <button id="hud-report" class="ps-action-btn danger" title="Report Phishing">🚩</button>
            <div style="width:10px;"></div> <!-- Spacer -->
            <button id="hud-close" class="ps-action-btn" title="Close" style="font-size:14px; background:rgba(255,255,255,0.1);">✕</button>
        </div>
    `;

    document.body.appendChild(hud);

    // Bindings
    document.getElementById('hud-close').addEventListener('click', () => hud.remove());

    document.getElementById('hud-inspect').addEventListener('click', () => {
        activateInspectorMode(analysis);
    });

    // Toggle Details
    const infoBtn = document.getElementById('hud-info');
    const panel = document.getElementById('hud-details-panel');

    // Log for debugging
    console.log('[HUD] Info button initialized. Panel element:', panel);
    console.log('[HUD] Analysis data:', analysis);
    console.log('[HUD] Reasons count:', analysis.reasons?.length || 0);

    infoBtn.addEventListener('click', (e) => {
        // Prevent event bubbling issues
        e.stopPropagation();

        console.log('[HUD] Info button clicked. Current panel display:', panel.style.display);

        if (panel.style.display === 'block') {
            panel.style.display = 'none';
            infoBtn.style.color = '#aaa';
            infoBtn.style.background = 'none';
            console.log('[HUD] Panel hidden');
        } else {
            panel.style.display = 'block';
            infoBtn.style.color = '#fff'; // Active state
            infoBtn.style.background = 'rgba(255,255,255,0.2)';
            console.log('[HUD] Panel shown. Content:', panel.innerHTML);
        }
    });

    document.getElementById('hud-report').addEventListener('click', () => {
        if (confirm("Flag this site as malicious?")) {
            chrome.runtime.sendMessage({
                type: "REPORT_SITE",
                url: window.location.href,
                hostname: window.location.hostname
            }, () => {
                alert("Site Flagged.");
                hud.remove();
            });
        }
    });
}

/**
 * Feature 5: Visual Inspector Mode
 * Highlights elements on the page that triggered risk factors.
 */
function activateInspectorMode(analysis) {
    // 0. Spotlight Overlay
    if (!document.getElementById('phishingshield-spotlight-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'phishingshield-spotlight-overlay';
        document.body.appendChild(overlay);

        overlay.style.display = 'block';
    }

    // Add Exit Inspector Button
    if (!document.getElementById('phishingshield-exit-inspect')) {
        const exitBtn = document.createElement('button');
        exitBtn.id = 'phishingshield-exit-inspect';
        exitBtn.innerText = "Exit Inspector Mode";
        exitBtn.style.cssText = "position: fixed; top: 20px; right: 20px; z-index: 2147483647; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.3);";
        exitBtn.onclick = deactivateInspectorMode;
        document.body.appendChild(exitBtn);
    }

    // 1. Highlight Urgency Keywords
    if (typeof RiskEngine !== 'undefined') {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        const urgencyNodes = [];

        while (walker.nextNode()) {
            const node = walker.currentNode;
            const text = node.textContent.toLowerCase();

            // Check if this text node contains any urgency keywords
            RiskEngine.urgencyKeywords.forEach(keyword => {
                if (text.includes(keyword)) {
                    // Start strict: only highlight if it's the dominant text or a significant phrase
                    if (node.parentElement && node.parentElement.tagName !== 'SCRIPT' && node.parentElement.tagName !== 'STYLE') {
                        urgencyNodes.push(node.parentElement);
                    }
                }
            });
        }

        urgencyNodes.forEach(el => {
            el.style.border = "3px solid #dc3545";
            el.style.boxShadow = "0 0 10px #dc3545";
            el.classList.add('antigravity-float'); // Add animation
            el.setAttribute("title", "⚠️ PhishingShield: Detected Urgency Keyword");
        });
    }

    // 2. Highlight Insecure Password Fields
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    passwordInputs.forEach(input => {
        input.style.border = "3px solid #ff0000";
        input.style.backgroundColor = "#ffe6e6";
        input.classList.add('antigravity-float'); // Add animation
        input.setAttribute("title", "⚠️ Insecure Password Field");
    });

    // 3. Highlight Risky Links (from Download Protection)
    const links = document.querySelectorAll('a');
    links.forEach(link => {
        const href = link.href.toLowerCase();
        if (/\.[a-z0-9]{3,4}$/.test(href) && !href.includes('.html')) {
            // Executable/file check
            if (href.endsWith('.exe') || href.endsWith('.zip') || href.endsWith('.dmg')) {
                link.style.border = "2px dashed #ffc107";
                link.style.backgroundColor = "rgba(255, 193, 7, 0.2)";
            }
        }
    });

    // alert("🔍 Inspector Mode Active..."); // REMOVED for user preference
}

function deactivateInspectorMode() {
    // Remove Overlay
    const overlay = document.getElementById('phishingshield-spotlight-overlay');
    if (overlay) overlay.remove();

    // Remove Exit Button
    const exitBtn = document.getElementById('phishingshield-exit-inspect');
    if (exitBtn) exitBtn.remove();

    // Remove Highlights
    document.querySelectorAll('.antigravity-float').forEach(el => {
        el.classList.remove('antigravity-float');
        el.style.border = '';
        el.style.boxShadow = '';
        el.style.backgroundColor = '';
        el.removeAttribute('title');
    });

    document.querySelectorAll('.suspicious-pulse').forEach(el => {
        el.classList.remove('suspicious-pulse');
        el.style.border = '';
        el.style.backgroundColor = '';
    });

    // Remove link borders
    document.querySelectorAll('a').forEach(el => {
        if (el.style.border.includes('dashed')) {
            el.style.border = '';
            el.style.backgroundColor = '';
        }
    });
}

/**
 * Feature 6: Fortress Mode Clipboard Protection
 */
function initFortressClipboard(isFortressMode) {
    if (!isFortressMode) return;

    // Only block if site is risky (>70)
    ['copy', 'cut', 'paste'].forEach(event => {
        document.addEventListener(event, (e) => {
            const analysis = RiskEngine.analyzePage();
            if (analysis.score > 70) {
                e.preventDefault();
                e.stopPropagation();

                // Show mini toast
                let toast = document.createElement('div');
                toast.textContent = "🛡️ Fortress Mode: Clipboard Disabled on High-Risk Site";
                toast.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:rgba(0,0,0,0.8); color:white; padding:15px; border-radius:5px; z-index:2147483647;";
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 2000);
            }
        }, true); // Capture phase
    });
}

/**
 * Toast Notification (In-Page Fallback)
 * Look-alike of Chrome Notification but guaranteed to render.
 */
function showToastNotification(title, message, type = 'info') {
    if (document.getElementById('ps-toast')) return;

    const toast = document.createElement('div');
    toast.id = 'ps-toast';

    const bgColor = type === 'danger' ? '#dc3545' : '#007bff';
    const icon = type === 'danger' ? '🚨' : 'ℹ️';

    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        background: white;
        color: #333;
        padding: 16px 24px;
        border-right: 6px solid ${bgColor};
        border-radius: 8px;
        box-shadow: 0 8px 25px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        gap: 15px;
        align-items: flex-start;
        animation: slideInRight 0.4s ease-out;
        max-width: 350px;
    `;

    toast.innerHTML = `
        <div style="font-size: 24px;">${icon}</div>
        <div>
            <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;">${title}</div>
            <div style="font-size: 13px; color: #555; line-height: 1.4;">${message}</div>
        </div>
        <button style="background:none; border:none; color:#999; cursor:pointer; font-size:18px; position:absolute; top:5px; right:8px;" onclick="this.parentElement.remove()">×</button>
    `;

    // Add Keyframe if needed (likely existing, but safe to add inline or assume simple transition)
    document.body.appendChild(toast);

    // Auto dismiss
    setTimeout(() => {
        if (toast) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            toast.style.transition = 'all 0.4s';
            setTimeout(() => toast.remove(), 400);
        }
    }, 8000);
}

/**
 * AI Caching System
 */
function checkAICache(url, callback) {
    chrome.storage.local.get(['aiCache'], (data) => {
        const cache = data.aiCache || {};
        const entry = cache[url];
        // Valid if exists and younger than 24 hours
        if (entry && (Date.now() - entry.timestamp < 86400000)) { // 24h ms
            callback(entry.data);
        } else {
            callback(null);
        }
    });
}

function cacheAIResult(url, aiData) {
    chrome.storage.local.get(['aiCache'], (data) => {
        const cache = data.aiCache || {};
        // Prune old entries if too big (>100 urls)
        const keys = Object.keys(cache);
        if (keys.length > 100) delete cache[keys[0]];

        cache[url] = {
            timestamp: Date.now(),
            data: aiData
        };
        chrome.storage.local.set({ aiCache: cache });
    });
}

function updateAnalysisWithAI(analysis, aiResult) {
    console.log("[Content] AI Scan Returned:", aiResult);
    const aiScore = aiResult.score || 0;

    // Only show if significant or mismatch
    if (aiScore < 20 && analysis.score < 20) {
        console.log("[Content] AI confirms safe, staying hidden.");
        return;
    }

    console.log("[Content] Updating HUD with AI Result");

    // Merge logic
    analysis.score = Math.max(analysis.score, aiScore);

    const aiMsg = `🤖 AI Analysis Detected Threat (+${aiScore})`;
    let duplicate = false;
    for (let r of analysis.reasons) { if (r.includes('AI Analysis')) duplicate = true; }

    if (!duplicate) {
        analysis.reasons.push(aiMsg);
        // Store full text for the "View Details" button
        analysis.aiReportText = aiResult.reason;
    }

    // AI Override removed per user request (Primary Threat stays as heuristic detection)

    showRiskHUD(analysis);
}

function getScoreColor(score) {
    if (score >= 80) return '#ff4757'; // Critical (Red)
    if (score >= 50) return '#ffa502'; // Warning (Orange)
    return '#2ed573'; // Safe (Green)
}
