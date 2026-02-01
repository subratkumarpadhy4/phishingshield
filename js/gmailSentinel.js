/**
 * Gmail Sentinel - AI-Powered Email Forensics
 * Part of Oculus Chrome Extension
 */

const GmailSentinel = {

    init: function () {
        console.log("🛡️ Oculus AI Gmail Sentinel Active");
        this.observeDOM();
    },

    observeDOM: function () {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    this.scanHeaders();
                    this.injectAttachmentScanners();
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    },

    /**
     * AI-Powered Header Scan
     */
    scanHeaders: function () {
        // STRICT CHECK: Are we actually reading an email?
        // .a3s is the class for the message body content. If it's not there, we're likely in the list view.
        if (!document.querySelector('.a3s')) {
            return;
        }

        // Gmail Selectors Strategy (More Precise):
        // Only look for senders within the main role="main" container to avoid sidebars/chats
        const mainContainer = document.querySelector('div[role="main"]');
        if (!mainContainer) return;

        const senders = mainContainer.querySelectorAll('.gD');

        if (senders.length === 0) {
            // Fallback for popouts
            const fallback = document.querySelectorAll('.a3s');
            if (fallback.length > 0) {
                // Try to find header relative to body? Hard.
                // Stick to .gD for now as it's the standard for 'Card' header
            }
            return;
        }

        this.processSenders(senders);
    },

    processSenders: function (nodeList) {
        nodeList.forEach(sender => {
            // Avoid re-scanning same element
            if (sender.dataset.oculusScanned) return;

            // Validate it's a real email sender node
            const email = sender.getAttribute('email');
            const name = sender.textContent; // "Team Unstop"

            if (!email || !name) return;

            // Mark as scanned immediately to prevent double-fire
            sender.dataset.oculusScanned = "true";

            console.log(`[GmailSentinel] Found sender: ${name} <${email}>`);

            // Only analyze if the name looks like a brand Or if user forced "Analyze All" (future feature)
            // For hackathon: Analyze everything that isn't me
            if (this.looksLikeBrand(name)) {
                this.analyzeWithAI(sender, name, email);
            } else {
                // Add Manual Scan Button for "Other" senders
                const scanBtn = document.createElement('span');
                scanBtn.innerHTML = "🔍 Scan";
                scanBtn.style.cssText = "border: 1px solid #ccc; color: #555; padding: 1px 6px; border-radius: 4px; font-size: 10px; margin-left: 5px; cursor: pointer; opacity: 0.7;";
                scanBtn.title = "Manually analyze this sender with Oculus AI";

                scanBtn.onmouseover = () => scanBtn.style.opacity = "1";
                scanBtn.onmouseout = () => scanBtn.style.opacity = "0.7";

                scanBtn.onclick = (e) => {
                    e.stopPropagation();
                    scanBtn.remove(); // Remove button to avoid double clicking
                    this.analyzeWithAI(sender, name, email);
                };

                sender.parentNode.appendChild(scanBtn);
            }
        });
    },

    // Simple heuristic to avoid checking "John Doe"
    looksLikeBrand: function (name) {
        // Expanded List + Generic terms
        const keywords = ["PayPal", "Google", "Amazon", "Microsoft", "Apple", "Support", "Team", "Security", "Bank", "Service", "Verify", "Alert", "Notification", "Unstop", "Hero", "Campus"];
        return keywords.some(k => name.includes(k));
    },

    analyzeWithAI: async function (element, name, email) {
        // 1. Get Email Body Content (for context)
        // Tactic: Find the closest common container then look for message body (.a3s)
        const emailContainer = element.closest('.gs') || document.body;
        const bodyElement = emailContainer.querySelector('.a3s.aiL');
        const bodyContent = bodyElement ? bodyElement.innerText : "No content found";

        // 2. Add "Analyzing" indicator
        const badge = document.createElement('span');
        badge.innerHTML = " 🤖 Analyzing...";
        badge.style.cssText = "font-size:10px; color:#888; margin-left:5px; background:#f0f0f0; padding:2px 4px; border-radius:4px;";
        element.parentNode.appendChild(badge);

        if (typeof ThreatIntel !== 'undefined') {
            const result = await ThreatIntel.analyzeEmail({
                senderName: name,
                senderEmail: email,
                content: bodyContent.substring(0, 500) // First 500 chars usually enough
            });

            console.log("[GmailSentinel] Analysis Result:", result); // Debug Log

            badge.remove(); // Remove loading spinner

            if (result.success && result.analysis) {
                this.applyVerdict(element, result.analysis, email);
            } else {
                // Handle Error / No Result
                console.warn("[GmailSentinel] Failed:", result.error);
                badge.innerHTML = " ⚠️ Unavailable";
                // Re-append since we removed it
                element.parentNode.appendChild(badge);
            }
        } else {
            badge.innerHTML = " ❌ ThreatEngine Missing";
        }
    },

    applyVerdict: function (element, analysis, realEmail) {
        // 1. Re-Verify Element Existence (Gmail DOM changes fast!)
        if (!element.isConnected) {
            console.warn("[GmailSentinel] Element lost during analysis. Attempting to re-find...");
            // Try to find a sender with the same email in the open view
            const potentialMatches = document.querySelectorAll(`.gD[email="${realEmail}"]`);
            if (potentialMatches.length > 0) {
                element = potentialMatches[0]; // Use the fresh one
                console.log("[GmailSentinel] Found fresh element.");
            } else {
                console.error("[GmailSentinel] Could not find sender element to update UI.");
                // We can still show the modal though!
            }
        }

        // Inject Styles if not already there
        if (!document.getElementById('oculus-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'oculus-modal-styles';
            style.innerHTML = `
                .oculus-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(5px); }
                .oculus-modal { background: #1a1a1a; color: #fff; width: 500px; padding: 25px; border-radius: 16px; border: 1px solid #333; box-shadow: 0 20px 50px rgba(0,0,0,0.5); font-family: 'Segoe UI', sans-serif; animation: popIn 0.3s ease; position: relative; }
                .oculus-modal h2 { margin-top: 0; font-size: 22px; display: flex; align-items: center; gap: 10px; }
                .oculus-modal .score-circle { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; border: 3px solid; }
                .oculus-modal .details { margin: 20px 0; background: #2a2a2a; padding: 15px; border-radius: 8px; font-size: 14px; line-height: 1.5; color: #ddd; }
                .oculus-modal .btn-close { background: #444; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; float: right; font-weight: bold; transition: 0.2s; }
                .oculus-modal .btn-close:hover { background: #666; }
                .oculus-stat-row { display: flex; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px solid #333; padding-bottom: 8px; }
                .oculus-stat-label { color: #888; font-size: 12px; }
                .oculus-stat-val { font-weight: bold; font-family: monospace; }
                .oculus-tag { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; }
                .oculus-tag.safe { background: rgba(40, 167, 69, 0.2); color: #28a745; }
                .oculus-tag.danger { background: rgba(220, 53, 69, 0.2); color: #dc3545; }
                @keyframes popIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
            `;
            document.head.appendChild(style);
        }

        const isRisk = analysis.is_spoofed || analysis.risk_score > 70;

        if (isRisk) {
            // 1. DANGER: Text Decoration + Warning Button + AUTO POPUP
            const warningBtn = document.createElement('span');
            warningBtn.innerHTML = `⚠️ <b>FAKE ${analysis.claimed_brand?.toUpperCase() || 'SENDER'}</b>`;
            warningBtn.style.cssText = "background: #d9534f; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; margin-left: 10px; font-size: 12px; cursor: pointer; box-shadow: 0 0 10px rgba(217, 83, 79, 0.5);";
            warningBtn.onclick = (e) => { e.stopPropagation(); this.showModal(analysis, realEmail, true); };

            element.parentNode.appendChild(warningBtn);
            element.style.textDecoration = "line-through";
            element.style.color = "#d9534f";

            this.showModal(analysis, realEmail, true);

        } else if (analysis.risk_score < 30) {
            // 2. SAFE: Trusted Badge (Clickable for Analysis)
            const safeBtn = document.createElement('span');
            safeBtn.innerHTML = `✅ <b>Verified ${analysis.claimed_brand || ''}</b>`;
            safeBtn.style.cssText = "background: #28a745; color: white; padding: 2px 8px; border-radius: 4px; font-weight: bold; margin-left: 10px; font-size: 11px; cursor: pointer; opacity: 0.9;";
            safeBtn.onclick = (e) => { e.stopPropagation(); this.showModal(analysis, realEmail, false); };
            element.parentNode.appendChild(safeBtn);

            // AUTO POPUP for Safe (Requested by User)
            this.showModal(analysis, realEmail, false);
        } else {
            // 3. CAUTION (Risk 30-70) - The "Middle" Ground
            const cautionBtn = document.createElement('span');
            cautionBtn.innerHTML = `⚠️ <b>Suspicious (${analysis.risk_score}%)</b>`;
            cautionBtn.style.cssText = "background: #f0ad4e; color: white; padding: 2px 8px; border-radius: 4px; font-weight: bold; margin-left: 10px; font-size: 11px; cursor: pointer;";
            cautionBtn.onclick = (e) => { e.stopPropagation(); this.showModal(analysis, realEmail, true); }; // Show danger modal style for caution
            element.parentNode.appendChild(cautionBtn);

            // Auto-popup for caution too, just in case
            this.showModal(analysis, realEmail, true);
        }
    },

    showModal: function (analysis, realEmail, isDanger) {
        // Prevent duplicates
        if (document.querySelector('.oculus-modal-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'oculus-modal-overlay';

        const color = isDanger ? '#dc3545' : '#28a745';
        const title = isDanger ? '⚠️ Security Alert' : '🛡️ Authenticity Verified';
        const scoreColor = isDanger ? '#dc3545' : '#28a745';

        overlay.innerHTML = `
            <div class="oculus-modal" style="border-top: 5px solid ${color}">
                <h2>
                    <div class="score-circle" style="border-color: ${scoreColor}; color: ${scoreColor}">
                        ${analysis.risk_score}
                    </div>
                    ${title}
                </h2>
                
                <div class="details">
                    <div class="oculus-stat-row">
                        <span class="oculus-stat-label">CLAIMED ENTITY</span>
                        <span class="oculus-stat-val">${analysis.claimed_brand || 'Unknown'}</span>
                    </div>
                    <div class="oculus-stat-row">
                        <span class="oculus-stat-label">ACTUAL SENDER</span>
                        <span class="oculus-stat-val" style="color: ${isDanger ? '#ff6b6b' : '#fff'}">${realEmail}</span>
                    </div>
                    <div class="oculus-stat-row">
                        <span class="oculus-stat-label">DOMAIN CHECK</span>
                        <span class="oculus-tag ${isDanger ? 'danger' : 'safe'}">
                            ${isDanger ? '❌ MISMATCH' : '✅ LEGITIMATE'}
                        </span>
                    </div>
                    
                    <div style="margin-top: 15px; border-top: 1px solid #444; padding-top: 10px;">
                        <span class="oculus-stat-label">AI FORENSIC ANALYSIS:</span>
                        <p style="margin-top: 5px; font-style: italic;">
                            "${analysis.analysis || analysis.reason || 'No analysis provided.'}"
                        </p>
                    </div>
                </div>

                <div style="text-align: right;">
                    ${isDanger ? `<button class="btn-close" style="background: #d9534f; color: white; margin-right: 10px;" onclick="window.open('https://phishingreport.com', '_blank')">🚨 REPORT PHISHING</button>` : ''}
                    <button class="btn-close" id="ocCloseBtn">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Close Logic
        const close = () => overlay.remove();
        document.getElementById('ocCloseBtn').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    },

    injectAttachmentScanners: function () {
        const attachments = document.querySelectorAll('a[href*="ui=2&ik="][href*="view=att"]:not([data-oculus-scan-btn])');

        attachments.forEach(att => {
            att.setAttribute('data-oculus-scan-btn', 'true');
            const btn = document.createElement('div');
            btn.innerHTML = "🛡️ Scan Virus";
            btn.style.cssText = "background: #333; color: #fff; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-top: 4px; text-align: center; display: inline-block; z-index: 999; position: relative;";
            btn.title = "Calculate Hash & Check VirusTotal";

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.scanFile(att.href, btn);
            });

            const container = att.closest('span[download_url]') || att.parentNode;
            container.appendChild(btn);
        });
    },

    scanFile: async function (downloadUrl, btnElement) {
        btnElement.innerHTML = "⏳ Downloading...";

        try {
            const response = await fetch(downloadUrl);
            const blob = await response.blob();

            btnElement.innerHTML = "⚙️ Hashing...";
            const arrayBuffer = await blob.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            console.log("File Hash:", hashHex);
            btnElement.innerHTML = "☁️ Checking VT...";

            if (typeof ThreatIntel !== 'undefined') {
                const result = await ThreatIntel.scanResource(hashHex, 'file');

                if (result.success && result.result) {
                    const stats = result.result.last_analysis_stats;
                    const malicious = stats.malicious;

                    if (malicious > 0) {
                        btnElement.style.background = "#d9534f"; // Red
                        btnElement.innerHTML = `⛔ DANGER (${malicious}/60)`;
                        this.showFileModal(hashHex, malicious, stats, true);
                    } else {
                        btnElement.style.background = "#5cb85c"; // Green
                        btnElement.innerHTML = `✅ Safe (0/${stats.harmless + stats.undetected})`;
                        // SHOW SAFE MODAL AS REQUESTED
                        this.showFileModal(hashHex, malicious, stats, false);
                    }
                } else {
                    btnElement.innerHTML = "⚠️ Unknown File";
                    btnElement.title = "File not found in VirusTotal database.";
                    btnElement.style.background = "#f0ad4e";
                }
            } else {
                btnElement.innerHTML = "❌ Error (No Intel)";
            }
        } catch (error) {
            console.error(error);
            btnElement.innerHTML = "❌ Fail";
            alert("Could not scan file. " + error.message);
        }
    },


    showFileModal: function (hash, maliciousCount, stats, isDanger) {
        if (document.querySelector('.oculus-modal-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'oculus-modal-overlay';
        overlay.innerHTML = `
             <div class="oculus-modal" style="border-top: 5px solid ${isDanger ? '#dc3545' : '#28a745'}">
                <h2>${isDanger ? '⛔ MALWARE DETECTED' : '✅ FILE VERIFIED'}</h2>
                <div class="details">
                    <div class="oculus-stat-row"><span class="oculus-stat-label">SHA-256 HASH</span><span class="oculus-stat-val" style="font-size:10px">${hash}</span></div>
                    <div class="oculus-stat-row"><span class="oculus-stat-label">VENDORS FLAGGED</span><span class="oculus-stat-val" style="color: ${isDanger ? 'red' : 'green'}">${maliciousCount} / 60</span></div>
                </div>
                <div style="text-align: right;"><button class="btn-close" id="ocFileClose">Close</button></div>
             </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('ocFileClose').onclick = () => overlay.remove();
    }
};

// Start
setTimeout(() => GmailSentinel.init(), 2000);
