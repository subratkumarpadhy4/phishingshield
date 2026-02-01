/**
 * PhishingShield Threat Intelligence Service
 * Connects to external APIs (Google Safe Browsing / PhishTank) 
 * and maintains a local cache of known threats.
 */

if (typeof window.DEV_MODE === 'undefined') {
    window.DEV_MODE = false; // CONNECT TO VERCEL (Production)
}
var DEV_MODE = window.DEV_MODE;
const GLOBAL_API = "https://oculus-eight.vercel.app/api";

const ThreatIntel = {
    // Configuration
    apiKey: "",
    useSimulatedMode: true,
    backendUrl: DEV_MODE ? "http://localhost:3000/api" : GLOBAL_API,

    // Local Blocklist (Cache of known bad domains for demo purposes)
    localBlocklist: [
        "example-phish.com",
        "bad-site.net",
        "login-secure-update.xyz",
        "apple-id-verify.co",
        "paypal-security-alert.net"
    ],

    /**
     * Checks a URL against Threat Intelligence sources.
     * Returns a Promise that resolves to a ThreatReport.
     */
    check: async function (url) {
        return new Promise(async (resolve) => {
            const hostname = new URL(url).hostname;

            // 1. Check Local Blocklist (Fastest)
            if (this.localBlocklist.some(d => hostname === d || hostname.endsWith("." + d))) {
                console.log(`[ThreatIntel] Blocked by Local Custom Blocklist: ${hostname}`);
                return resolve({
                    isThreat: true,
                    source: "Local Intel Cache",
                    type: "MALWARE",
                    riskScore: 100
                });
            }

            // 2. Check Global Server Blocklist (From our own backend)
            try {
                // In a real extension, we would fetch this periodically, not per request to save bandwidth.
                // For now, we assume the background.js has synced it.
                // We'll simulate a check here or rely on the background script.
            } catch (e) { }

            // 3. Check External APIs (Google Safe Browsing / PhishTank)
            if (!this.useSimulatedMode && this.apiKey) {
                // Real API Check Implementation would go here
                // const isSafe = await this.queryGoogleSafeBrowsing(url);    
            } else {
                // Simulation Mode Logic
                // If url contains "test-phish", we flag it
                if (url.includes("test-phish") || url.includes("malware-demo")) {
                    return resolve({
                        isThreat: true,
                        source: "Simulated Threat Intel",
                        type: "SOCIAL_ENGINEERING",
                        riskScore: 90
                    });
                }
            }

            // 4. Safe
            resolve({
                isThreat: false,
                source: "Clean",
                riskScore: 0
            });
        });
    },

    /**
     * Report a new threat to the central server (Crowdsourcing)
     */
    report: async function (url, type) {
        console.log(`[ThreatIntel] Reporting ${url} as ${type}...`);
        // API call to our backend would go here
    },

    /**
     * Get Community Trust Score
     */
    getTrustScore: async function (url) {
        try {
            const domain = new URL(url).hostname;
            const res = await fetch(`${this.backendUrl}/trust/score?domain=${domain}`);
            if (res.ok) return await res.json();
            return null;
        } catch (e) {
            console.error("[ThreatIntel] Failed to get trust score", e);
            return null;
        }
    },

    /**
     * Submit a Vote
     * @param {string} url 
     * @param {string} vote 'safe' | 'unsafe'
     */
    vote: async function (url, vote) {
        try {
            const domain = new URL(url).hostname;
            console.log(`[ThreatIntel] Preparing vote for ${domain}...`);

            // 1. Get User Identity for Anti-Spam
            const getUserId = () => new Promise(resolve => {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.get(['currentUser'], (res) => {
                        resolve(res.currentUser ? res.currentUser.email : null);
                    });
                } else {
                    resolve(null);
                }
            });

            const userId = await getUserId();
            console.log(`[ThreatIntel] User ID: ${userId}`);

            // 2. Send Vote
            const res = await fetch(`${this.backendUrl}/trust/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain, vote, userId })
            });

            const data = await res.json();
            console.log(`[ThreatIntel] Vote Response:`, data);

            return data; // Return full response object (success, message)
        } catch (e) {
            console.error("[ThreatIntel] Failed to vote", e);
            return { success: false, message: e.message || "Network error. Is server running?" };
        }
    },

    /**
     * Scan a resource (File Hash or URL) using VirusTotal API via Backend
     * @param {string} resource - The hash (SHA256) or URL to scan
     * @param {string} type - 'file' or 'url'
     */
    scanResource: async function (resource, type) {
        try {
            console.log(`[ThreatIntel] Scanning ${type}: ${resource} ...`);
            const res = await fetch(`${this.backendUrl}/antivirus/scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resource, type })
            });
            const data = await res.json();
            return data;
        } catch (e) {
            console.error("[ThreatIntel] Scan failed:", e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Analyze Email Metadata & Content via Backend AI
     */
    analyzeEmail: async function (data) { // data = { senderName, senderEmail, content }
        try {
            console.log(`[ThreatIntel] Analyzing email...`);

            // Setup Timeout (15 seconds max)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const res = await fetch(`${this.backendUrl}/ai/analyze-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!res.ok) throw new Error(`Server Error: ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error("[ThreatIntel] Email analysis failed:", e);
            if (e.name === 'AbortError') return { success: false, error: 'Timeout: AI took too long.' };
            return { success: false, error: e.message };
        }
    }
};

// Export for usage in other modules
if (typeof window !== 'undefined') {
    window.ThreatIntel = ThreatIntel;
}
