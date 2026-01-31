const express = require("express");
const path = require("path");
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
// const path = require("path"); // Moved to top
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// MongoDB setup
const { connectDB, isConnected, TrustScore, Report, User, AuditLog, AdminSession, DeletedUser } = require('./db');

const app = express();
console.log("-----------------------------------------");
console.log("[DEBUG] MAIN SERVER STARTING - LOADED server.js");
console.log("-----------------------------------------");
const PORT = process.env.PORT || 3000;

// PERFORMANCE: Reduce logging in production
const IS_PRODUCTION = !!(process.env.RENDER || process.env.VERCEL);
const log = IS_PRODUCTION ? () => { } : console.log;
const logError = console.error; // Always log errors

// Initialize MongoDB connection
(async () => {
    try {
        await connectDB();
        console.log('[Server] MongoDB ready');
    } catch (error) {
        console.warn('[Server] MongoDB not available, using JSON file storage');
    }
})();

// OPTIMIZATION: Helper function for fetch with timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = 2000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

// OPTIMIZATION: Add MongoDB query cache
const queryCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

function getCacheKey(collection, query) {
    return `${collection}:${JSON.stringify(query)}`;
}

function getFromCache(key) {
    const cached = queryCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    queryCache.delete(key);
    return null;
}

function setCache(key, data) {
    queryCache.set(key, { data, timestamp: Date.now() });
}
// OPTIMIZATION: Background Sync Timer - Only run on LOCAL server, not on Render
if (!process.env.RENDER && !process.env.VERCEL) {
    setInterval(async () => {
        try {
            const localData = await readData(TRUST_FILE);
            if (!localData || localData.length === 0) return;

            let syncCount = 0;
            for (const entry of localData) {
                if ((entry.safe || 0) + (entry.unsafe || 0) > 0) {
                    await fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/trust/seed', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(entry)
                    }, 3000).catch(() => { });
                    syncCount++;
                }
            }
            if (syncCount > 0) {
                log(`[Auto-Sync] background-sync: ✓ ${syncCount} sites updated on global cloud.`);
            }
        } catch (error) {
            logError('[Auto-Sync] background-sync failed:', error.message);
        }
    }, 5 * 60 * 1000); // Every 5 minutes
}

const REPORTS_FILE = path.join(__dirname, 'reports.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const DELETED_USERS_FILE = path.join(__dirname, 'data', 'deleted_users.json'); // Persistent deletion list
const AUDIT_LOG_FILE = path.join(__dirname, 'data', 'audit_logs.json');
const TRUST_FILE = path.join(__dirname, 'data', 'trust_scores.json');


console.log("Groq Key Status:", process.env.GROQ_API_KEY ? "Found" : "Not Found");
console.log("Gemini Key Status:", process.env.GEMINI_API_KEY ? "Found" : "Not Found");

// Admin Configuration (Server-Side Only)
const ADMIN_EMAILS = ["rajkumarpadhy2006@gmail.com"]; // Add more admin emails here
const JWT_SECRET =
    process.env.JWT_SECRET ||
    "phishingshield-secret-key-change-in-production-2024";
const JWT_EXPIRY_ADMIN = "10d"; // Admin sessions expire in 10 days

// Middleware
// Enhanced CORS configuration for Chrome extension and web access
app.use(
    cors({
        origin: "*", // Allow all origins (Chrome extensions use chrome-extension:// URLs)
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
        credentials: false,
    }),
);

// Handle preflight requests
app.options("*", cors());

// OPTIMIZATION: Reduce logging middleware overhead in production
app.use((req, res, next) => {
    log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

app.use(bodyParser.json());

// PREVENT CRASHES: Global Error Handlers
process.on("uncaughtException", (err) => {
    console.error("CRITICAL ERROR (Uncaught Exception):", err);
    // Keep server alive
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("CRITICAL ERROR (Unhandled Rejection):", reason);
    // Keep server alive
});

// Initialize Data Files
if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(path.dirname(AUDIT_LOG_FILE))) fs.mkdirSync(path.dirname(AUDIT_LOG_FILE), { recursive: true });
if (!fs.existsSync(AUDIT_LOG_FILE)) fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(TRUST_FILE)) fs.writeFileSync(TRUST_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(DELETED_USERS_FILE)) fs.writeFileSync(DELETED_USERS_FILE, JSON.stringify([], null, 2));

// --- Data Access Layer (MongoDB with JSON fallback + Query Cache) ---
const readData = async (file) => {
    log(`[DEBUG] readData called for: ${file}`);
    if (isConnected()) {
        log(`[DEBUG] MongoDB is connected`);
        try {
            if (file === TRUST_FILE) {
                const cacheKey = getCacheKey('trustscores', {});
                const cached = getFromCache(cacheKey);
                if (cached) return cached;

                const docs = await TrustScore.find({}).lean();
                const result = docs.map(doc => ({
                    domain: doc.domain,
                    safe: doc.safe || 0,
                    unsafe: doc.unsafe || 0,
                    voters: doc.voters instanceof Map ? Object.fromEntries(doc.voters) : (doc.voters || {})
                }));
                setCache(cacheKey, result);
                return result;
            } else if (file === REPORTS_FILE) {
                const cacheKey = getCacheKey('reports', {});
                const cached = getFromCache(cacheKey);
                if (cached) return cached;

                const docs = await Report.find({}).lean();
                const result = docs.map(doc => {
                    const { _id, __v, createdAt, updatedAt, ...rest } = doc;
                    return rest;
                });
                setCache(cacheKey, result);
                return result;
            } else if (file === USERS_FILE) {
                log(`[DEBUG] Fetching Users from MongoDB...`);
                const cacheKey = getCacheKey('users', {});
                const cached = getFromCache(cacheKey);
                if (cached) return cached;

                const docs = await User.find({}).lean();
                log(`[DEBUG] Found ${docs.length} users`);
                const result = docs.map(doc => {
                    const { _id, __v, createdAt, updatedAt, ...rest } = doc;
                    return rest;
                });
                setCache(cacheKey, result);
                return result;
            } else if (file === AUDIT_LOG_FILE) {
                const docs = await AuditLog.find({}).sort({ timestamp: -1 }).lean();
                return docs.map(doc => {
                    const { _id, __v, createdAt, updatedAt, ...rest } = doc;
                    return rest;
                });
            } else if (file === DELETED_USERS_FILE) {
                const docs = await DeletedUser.find({}).lean();
                return docs.map(doc => ({
                    email: doc.email,
                    deletedAt: doc.deletedAt
                }));
            }
        } catch (error) {
            logError(`[MongoDB] Error reading ${file}:`, error.message);
        }
    } else {
        log(`[DEBUG] MongoDB NOT connected`);
    }

    // JSON fallback
    log(`[DEBUG] Falling back to JSON for ${file}`);
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return [];
    }
};

const writeData = async (file, data) => {
    // OPTIMIZATION: Clear cache for this collection
    if (file === TRUST_FILE) {
        queryCache.delete(getCacheKey('trustscores', {}));
    } else if (file === REPORTS_FILE) {
        queryCache.delete(getCacheKey('reports', {}));
    } else if (file === USERS_FILE) {
        queryCache.delete(getCacheKey('users', {}));
    }

    if (isConnected()) {
        try {
            if (file === TRUST_FILE) {
                // Bulk upsert trust scores
                const operations = data.map(item => ({
                    updateOne: {
                        filter: { domain: item.domain?.toLowerCase().trim() },
                        update: {
                            $set: {
                                domain: item.domain?.toLowerCase().trim(),
                                safe: item.safe || 0,
                                unsafe: item.unsafe || 0,
                                voters: item.voters || {},
                                updatedAt: new Date()
                            }
                        },
                        upsert: true
                    }
                }));
                if (operations.length > 0) {
                    await TrustScore.bulkWrite(operations);
                }
                return;
            } else if (file === REPORTS_FILE) {
                // Bulk upsert reports
                const operations = data.map(item => ({
                    updateOne: {
                        filter: { id: item.id },
                        update: { $set: { ...item } },
                        upsert: true
                    }
                }));
                if (operations.length > 0) {
                    await Report.bulkWrite(operations);
                }
                return;
            } else if (file === USERS_FILE) {
                // Bulk upsert users
                const operations = data.map(item => ({
                    updateOne: {
                        filter: { email: item.email?.toLowerCase().trim() },
                        update: { $set: { ...item, email: item.email?.toLowerCase().trim() } },
                        upsert: true
                    }
                }));
                if (operations.length > 0) {
                    await User.bulkWrite(operations);
                }
                return;
            } else if (file === AUDIT_LOG_FILE) {
                // Insert audit logs (append only)
                if (data.length > 0) {
                    await AuditLog.insertMany(data.map(item => ({ ...item })), { ordered: false });
                }
                return;
            } else if (file === DELETED_USERS_FILE) {
                // Bulk upsert deleted users
                const operations = data.map(item => ({
                    updateOne: {
                        filter: { email: item.email?.toLowerCase().trim() },
                        update: { $set: { email: item.email?.toLowerCase().trim(), deletedAt: item.deletedAt || new Date() } },
                        upsert: true
                    }
                }));
                if (operations.length > 0) {
                    await DeletedUser.bulkWrite(operations);
                }
                return;
            }
        } catch (error) {
            console.error(`[MongoDB] Error writing ${file}:`, error.message);
            // Fallback to JSON
        }
    }

    // JSON fallback
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

// Sync version for backward compatibility (calls async but doesn't await - use carefully)
const readDataSync = (file) => {
    // Try JSON first for immediate return
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return [];
    }
};


// --- TRUST SCORE SYSTEM (Community Voting) ---
// Cache for individual trust scores
const trustScoreCache = new Map(); // domain -> { data, timestamp }

app.get('/api/trust/score', async (req, res) => {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: "Domain required" });

    const normalizedDomain = domain.toLowerCase().trim();

    // Check cache first (5 second TTL for individual scores)
    const cached = trustScoreCache.get(normalizedDomain);
    if (cached && (Date.now() - cached.timestamp) < 5000) {
        return res.json(cached.data);
    }

    // 1. Read Local Data FIRST (Fast response)
    const scores = await readData(TRUST_FILE);
    let domainData = scores.find(s => {
        const domain = s.domain || '';
        return domain.toLowerCase().trim() === normalizedDomain;
    });

    // 2. Try Global Server (ASYNC - don't block response if local has data)
    const globalFetchPromise = !process.env.RENDER && !process.env.VERCEL ? (async () => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s timeout for faster response

            const globalRes = await fetchWithTimeout(
                `https://phishingshield-ruby.vercel.app/api/trust/score?domain=${normalizedDomain}`,
                {},
                1000
            );

            if (globalRes.ok) {
                const globalData = await globalRes.json();
                return globalData;
            }
        } catch (e) {
            console.warn(`[Trust] Global fetch failed for ${domain}: ${e.message}`);
        }
        return null;
    })() : Promise.resolve(null);

    // Wait for global data (with timeout) and merge before returning
    if (domainData) {
        // Recalculate if counts are zero but voters exist
        if ((domainData.safe === 0 && domainData.unsafe === 0) && domainData.voters && Object.keys(domainData.voters).length > 0) {
            domainData.safe = Object.values(domainData.voters).filter(v => v === 'safe').length;
            domainData.unsafe = Object.values(domainData.voters).filter(v => v === 'unsafe').length;
            console.log(`[Trust] Recalculated counts for ${normalizedDomain}: ${domainData.safe}S, ${domainData.unsafe}U`);
        }
        const localTotal = (domainData.safe || 0) + (domainData.unsafe || 0);

        // Wait for global data with timeout (max 1.5s wait)
        try {
            const globalData = await Promise.race([
                globalFetchPromise,
                new Promise(resolve => setTimeout(() => resolve(null), 1500))
            ]);

            // Only use global data if it has MORE votes than local (or local is empty)
            if (globalData && globalData.votes !== undefined && (globalData.votes > localTotal)) {
                // Use global data as source of truth (it has all votes from all laptops)
                const globalSafe = globalData.safe !== undefined ? globalData.safe : Math.round((globalData.score / 100) * globalData.votes);
                const globalUnsafe = globalData.unsafe !== undefined ? globalData.unsafe : (globalData.votes - globalSafe);
                const globalTotal = globalData.votes;

                // Merge voters: combine local and global voters (global takes priority for vote counts, but merge voters map)
                // Update MongoDB or JSON with global data (global is source of truth)
                if (isConnected()) {
                    await TrustScore.findOneAndUpdate(
                        { domain: normalizedDomain },
                        {
                            domain: normalizedDomain,
                            safe: globalSafe,
                            unsafe: globalUnsafe,
                            voters: { ...(globalData.voters || domainData.voters || {}) },
                            updatedAt: new Date()
                        },
                        { upsert: true, new: true }
                    );
                } else {
                    const scores = await readData(TRUST_FILE);
                    const localIndex = scores.findIndex(s => {
                        const domain = s.domain || '';
                        return domain.toLowerCase().trim() === normalizedDomain;
                    });
                    const mergedVoters = { ...(globalData.voters || domainData.voters || {}) };

                    if (localIndex !== -1) {
                        scores[localIndex].safe = globalSafe;
                        scores[localIndex].unsafe = globalUnsafe;
                        scores[localIndex].voters = mergedVoters;
                        await writeData(TRUST_FILE, scores);
                    } else if (globalTotal > 0) {
                        scores.push({
                            domain: normalizedDomain,
                            safe: globalSafe,
                            unsafe: globalUnsafe,
                            voters: mergedVoters
                        });
                        await writeData(TRUST_FILE, scores);
                    }
                }

                const response = {
                    score: globalData.score,
                    votes: globalTotal,
                    safe: globalSafe,
                    unsafe: globalUnsafe,
                    status: globalData.status || (globalData.score > 70 ? 'safe' : (globalData.score < 30 ? 'malicious' : 'suspect'))
                };

                trustScoreCache.set(normalizedDomain, { data: response, timestamp: Date.now() });
                return res.json(response);
            }
        } catch (e) {
            console.warn(`[Trust] Global fetch error for ${normalizedDomain}: ${e.message} - using local data`);
        }

        // Fallback to local data if global fetch fails or times out
        const localScore = localTotal === 0 ? null : Math.round(((domainData.safe || 0) / localTotal) * 100);
        const response = {
            score: localScore,
            votes: localTotal,
            safe: domainData.safe || 0,
            unsafe: domainData.unsafe || 0,
            status: localScore === null ? 'unknown' : (localScore > 70 ? 'safe' : (localScore < 30 ? 'malicious' : 'suspect'))
        };

        trustScoreCache.set(normalizedDomain, { data: response, timestamp: Date.now() });
        return res.json(response);
    }

    // No local data - wait for global (but with timeout)
    try {
        const globalData = await Promise.race([
            globalFetchPromise,
            new Promise(resolve => setTimeout(() => resolve(null), 1500))
        ]);

        if (globalData && globalData.votes > 0) {
            // Save global data to local cache for faster future access
            const globalSafe = globalData.safe !== undefined ? globalData.safe : Math.round((globalData.score / 100) * globalData.votes);
            const globalUnsafe = globalData.unsafe !== undefined ? globalData.unsafe : (globalData.votes - globalSafe);

            // Save global data to local cache
            if (isConnected()) {
                await TrustScore.findOneAndUpdate(
                    { domain: normalizedDomain },
                    {
                        domain: normalizedDomain,
                        safe: globalSafe,
                        unsafe: globalUnsafe,
                        voters: {},
                        updatedAt: new Date()
                    },
                    { upsert: true }
                );
            } else {
                const scores = await readData(TRUST_FILE);
                const exists = scores.find(s => {
                    const domain = s.domain || '';
                    return domain.toLowerCase().trim() === normalizedDomain;
                });
                if (!exists) {
                    scores.push({
                        domain: normalizedDomain,
                        safe: globalSafe,
                        unsafe: globalUnsafe,
                        voters: {}
                    });
                    await writeData(TRUST_FILE, scores);
                }
            }

            const response = {
                score: globalData.score,
                votes: globalData.votes,
                safe: globalSafe,
                unsafe: globalUnsafe,
                status: globalData.status
            };

            trustScoreCache.set(normalizedDomain, { data: response, timestamp: Date.now() });
            return res.json(response);
        }
    } catch (e) {
        console.warn(`[Trust] Global fetch error: ${e.message}`);
    }

    // No data found
    const noDataResponse = { score: null, votes: 0, safe: 0, unsafe: 0, status: 'unknown' };
    trustScoreCache.set(normalizedDomain, { data: noDataResponse, timestamp: Date.now() });
    return res.json(noDataResponse);
});

app.post('/api/trust/vote', async (req, res) => {
    // userId is recommended to limit spam
    const { domain, vote, userId } = req.body; // vote: 'safe' or 'unsafe'
    if (!domain || !vote) return res.status(400).json({ error: "Domain and vote required" });

    // Normalize domain (lowercase, trim)
    const normalizedDomain = domain.toLowerCase().trim();

    // ANTI-DATA-LOSS: Use IP as fallback for anonymous voters so they are tracked in the map
    const effectiveUserId = userId || `anon_${(req.ip || 'unknown').replace(/[^a-zA-Z0-9]/g, '')}`;

    console.log(`[Trust] Processing vote for ${normalizedDomain}: ${vote} (User: ${effectiveUserId})`);

    try {
        let entry;
        let shouldUpdate = false;

        if (isConnected()) {
            // Use MongoDB
            entry = await TrustScore.findOne({ domain: normalizedDomain });

            if (!entry) {
                entry = new TrustScore({
                    domain: normalizedDomain,
                    safe: 0,
                    unsafe: 0,
                    voters: {}
                });
            }

            // Initialize voters object
            if (!entry.voters) entry.voters = {};

            // Ensure voters is a plain object (not Map)
            const votersObj = entry.voters instanceof Map
                ? Object.fromEntries(entry.voters)
                : (entry.voters || {});

            // ANONYMOUS MODE FALLBACK: If no userId, allow infinite votes (legacy behavior)
            if (userId && votersObj[userId]) {
                const previousVote = votersObj[userId];

                if (previousVote === vote) {
                    return res.json({ success: true, message: "You have already voted this way." });
                } else {
                    // Switch vote
                    if (previousVote === 'safe') entry.safe = Math.max(0, entry.safe - 1);
                    else entry.unsafe = Math.max(0, entry.unsafe - 1);

                    if (vote === 'safe') entry.safe++;
                    else entry.unsafe++;

                    votersObj[userId] = vote;
                    entry.voters = votersObj;
                    shouldUpdate = true;
                    console.log(`[Trust] Vote SWITCHED for ${domain} by ${userId}: ${previousVote} -> ${vote}`);
                }
            } else {
                // New Vote
                if (vote === 'safe') entry.safe++;
                else if (vote === 'unsafe') entry.unsafe++;

                // Track it (EVERY vote is now tracked in the map)
                votersObj[effectiveUserId] = vote;
                entry.voters = votersObj;
                shouldUpdate = true;
            }

            await entry.save();
        } else {
            // JSON fallback
            let scores = await readData(TRUST_FILE);
            entry = scores.find(s => {
                const domain = s.domain || '';
                return domain.toLowerCase().trim() === normalizedDomain;
            });

            if (!entry) {
                entry = { domain: normalizedDomain, safe: 0, unsafe: 0, voters: {} };
                scores.push(entry);
            } else {
                entry.domain = normalizedDomain;
            }

            if (!entry.voters) entry.voters = {};

            if (userId && entry.voters[userId]) {
                const previousVote = entry.voters[userId];

                if (previousVote === vote) {
                    return res.json({ success: true, message: "You have already voted this way." });
                } else {
                    if (previousVote === 'safe') entry.safe = Math.max(0, entry.safe - 1);
                    else entry.unsafe = Math.max(0, entry.unsafe - 1);

                    if (vote === 'safe') entry.safe++;
                    else entry.unsafe++;

                    entry.voters[userId] = vote;
                    console.log(`[Trust] Vote SWITCHED for ${domain} by ${userId}: ${previousVote} -> ${vote}`);
                }
            } else {
                if (vote === 'safe') entry.safe++;
                else if (vote === 'unsafe') entry.unsafe++;

                entry.voters[effectiveUserId] = vote;
            }

            await writeData(TRUST_FILE, scores);
        }

        console.log(`[Trust] Vote saved locally for ${normalizedDomain}: ${vote} (User: ${userId || 'Anon'})`);

        // Clear caches to force fresh data fetch
        trustScoreCache.delete(normalizedDomain);
        trustAllCache.data = null;
        trustAllCache.timestamp = 0;
        console.log(`[Trust] Cleared cache for ${normalizedDomain} after vote`);
    } catch (error) {
        console.error(`[Trust] Error processing vote:`, error);
        return res.status(500).json({ success: false, message: "Failed to process vote" });
    }

    // --- GLOBAL SYNC (FORWARD WRITE) ---
    // Forward vote to global server immediately (don't wait, fire and forget)
    if (!process.env.RENDER && !process.env.VERCEL) {
        console.log(`[Trust-Sync] [SEND] Forwarding vote to global server: ${normalizedDomain} = ${vote} (User: ${effectiveUserId})`);
        // Use effectiveUserId to ensure anonymous votes are tracked consistently globally
        fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/trust/vote', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ domain: normalizedDomain, vote, userId: effectiveUserId })
        })
            .then(async globalRes => {
                if (globalRes.ok) {
                    const result = await globalRes.json().catch(() => ({}));
                    console.log(`[Trust-Sync] [SEND] ✓ Vote forwarded successfully to global server for ${normalizedDomain}`);
                    console.log(`[Trust-Sync] [SEND] Global server response:`, result);
                } else {
                    const errorText = await globalRes.text().catch(() => 'Unable to read error');
                    console.error(`[Trust-Sync] [SEND] ✗ Global server returned ${globalRes.status} for ${normalizedDomain}`);
                    console.error(`[Trust-Sync] [SEND] Error response: ${errorText.substring(0, 200)}`);
                }
            })
            .catch(e => {
                console.error(`[Trust-Sync] [SEND] ✗ FAILED to forward vote to global server: ${e.message}`);
                console.error(`[Trust-Sync] [SEND] Error details:`, e);
            });
    } else {
        console.log(`[Trust-Sync] [SEND] Running on global server (RENDER=true), vote already saved globally`);
    }

    res.json({ success: true, message: "Vote recorded." });
});

// Admin: Clear all trust history
app.post('/api/trust/clear', async (req, res) => {
    // In a real app, requireAdmin middleware here.
    try {
        if (isConnected()) {
            await TrustScore.deleteMany({});
        } else {
            await writeData(TRUST_FILE, []);
        }
        console.warn("[Admin] Trust history cleared.");
        res.json({ success: true, message: "All trust scores cleared." });
    } catch (error) {
        console.error("[Admin] Error clearing trust history:", error);
        res.status(500).json({ success: false, message: "Failed to clear trust history" });
    }
});

// Cache for trust/all to improve performance
let trustAllCache = {
    data: null,
    timestamp: 0,
    TTL: 10 * 1000 // 10 seconds cache (reduced for faster sync)
};

// Admin: Get all trust scores
app.get('/api/trust/all', async (req, res) => {
    try {
        const now = Date.now();
        // Bypass cache if explicitly requested (refresh button with ?t=timestamp) or ?nocache=true
        const forceRefresh = req.query.t !== undefined || req.query.nocache === 'true';
        // Don't use cache for admin portal - always fetch fresh to ensure sync
        // Cache only causes stale data issues across devices
        const useCache = false; // Disabled - always fetch fresh data

        if (forceRefresh) {
            console.log('[Trust] Cache bypassed - forcing fresh data fetch');
        }

        // 1. Read Local Trust Data (we'll merge with global, but global takes priority)
        let localScores = [];
        try {
            localScores = await readData(TRUST_FILE) || [];
        } catch (e) {
            console.error('[Trust] Error reading local trust file:', e);
            localScores = [];
        }

        // Start with empty map - GLOBAL data will populate it first (source of truth)
        const mergedMap = new Map();

        // 2. Fetch Global Trust Data (WAIT for it with timeout, but don't block too long)
        // CRITICAL: Always fetch global data to ensure sync across devices
        if (!process.env.RENDER && !process.env.VERCEL) {
            try {
                log('[Trust] [SYNC] Fetching global trust data from https://phishingshield-ruby.vercel.app/api/trust/all...');
                const fetchStart = Date.now();
                const globalResponse = await fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/trust/all', {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }, 2000); // OPTIMIZATION: Reduced from 5s to 2s
                const fetchDuration = Date.now() - fetchStart;
                console.log(`[Trust] [SYNC] Global fetch completed in ${fetchDuration}ms with status ${globalResponse.status}`);

                if (globalResponse.ok) {
                    const globalScores = await globalResponse.json();
                    console.log(`[Trust] Successfully fetched ${globalScores ? globalScores.length : 0} global entries`);

                    if (!Array.isArray(globalScores)) {
                        console.warn('[Trust] Global server returned non-array data:', typeof globalScores, globalScores);
                        // If global returns wrong format, treat as empty and fallback to local
                    } else if (globalScores.length === 0) {
                        console.log('[Trust] Global server returned empty array - will use local data if available');
                        // Empty global response - will fallback to local below
                    } else {
                        // GLOBAL DATA SYNC
                        globalScores.forEach(entry => {
                            if (!entry || !entry.domain) return;
                            const normalizedDomain = entry.domain.toLowerCase().trim();

                            // If global returns empty counts but local has data, we'll merge below.
                            // But first, populate map with global data.
                            const globalVoters = entry.voters || {};
                            const globalSafe = entry.safe || 0;
                            const globalUnsafe = entry.unsafe || 0;

                            mergedMap.set(normalizedDomain, {
                                domain: normalizedDomain,
                                safe: globalSafe,
                                unsafe: globalUnsafe,
                                voters: globalVoters
                            });
                        });

                        // STEP 2: Merge local data into global data
                        // CRITICAL: Global data is the source of truth, but local data might have newer voters
                        localScores.forEach(localEntry => {
                            if (!localEntry || !localEntry.domain) return;
                            const normalizedDomain = localEntry.domain.toLowerCase().trim();
                            const globalEntry = mergedMap.get(normalizedDomain);

                            if (globalEntry) {
                                // Merge voters maps
                                const combinedVoters = { ...globalEntry.voters, ...localEntry.voters };

                                // Recalculate counts based on combined map (Anti-Data-Loss)
                                const recalculatedSafe = Object.values(combinedVoters).filter(v => v === 'safe').length;
                                const recalculatedUnsafe = Object.values(combinedVoters).filter(v => v === 'unsafe').length;

                                mergedMap.set(normalizedDomain, {
                                    domain: normalizedDomain,
                                    safe: Math.max(recalculatedSafe, globalEntry.safe || 0, localEntry.safe || 0),
                                    unsafe: Math.max(recalculatedUnsafe, globalEntry.unsafe || 0, localEntry.unsafe || 0),
                                    voters: combinedVoters
                                });
                            } else {
                                // Local only
                                mergedMap.set(normalizedDomain, localEntry);
                            }
                        });

                        // Update local file with merged global data (so it persists locally)
                        // CRITICAL: Use global vote counts (source of truth), but preserve merged voters
                        const scoresToSave = Array.from(mergedMap.values());
                        await writeData(TRUST_FILE, scoresToSave);
                        console.log(`[Trust] Saved ${scoresToSave.length} entries to local file with global vote counts (source of truth)`);
                    }
                } else {
                    const errorText = await globalResponse.text().catch(() => 'Unable to read error response');
                    console.error(`[Trust] [SYNC] Global server returned ${globalResponse.status}: ${globalResponse.statusText}`);
                    console.error(`[Trust] [SYNC] Error response: ${errorText.substring(0, 200)}`);
                }
            } catch (e) {
                console.error(`[Trust] [SYNC] Global fetch FAILED: ${e.message}`);
                console.error(`[Trust] [SYNC] Error type: ${e.name}, stack: ${e.stack?.substring(0, 300)}`);
                // Continue with local data only if global fetch fails, but log the failure
                console.warn(`[Trust] [SYNC] Returning local data only due to global fetch failure`);
            }
        } else {
            console.log('[Trust] Running on global server (RENDER=true), skipping global fetch');
            // When running as global server, use local data (which IS the global data)
            localScores.forEach(entry => {
                if (entry && entry.domain) {
                    const normalizedDomain = entry.domain.toLowerCase().trim();
                    let safeCount = entry.safe || 0;
                    let unsafeCount = entry.unsafe || 0;

                    // Recalculate if needed
                    if ((safeCount === 0 && unsafeCount === 0) && entry.voters && Object.keys(entry.voters).length > 0) {
                        safeCount = Object.values(entry.voters).filter(v => v === 'safe').length;
                        unsafeCount = Object.values(entry.voters).filter(v => v === 'unsafe').length;
                    }

                    mergedMap.set(normalizedDomain, {
                        domain: normalizedDomain,
                        safe: safeCount,
                        unsafe: unsafeCount,
                        voters: entry.voters || {}
                    });
                }
            });
        }

        // CRITICAL FIX: If mergedMap is empty (global fetch failed or returned empty), fallback to local data
        // This ensures friend's device shows at least their local votes if global is unreachable
        if (mergedMap.size === 0 && localScores.length > 0) {
            console.log('[Trust] [SYNC] Global fetch failed, falling back to local data');
            localScores.forEach(entry => {
                if (entry && entry.domain) {
                    const normalizedDomain = entry.domain.toLowerCase().trim();
                    let safeCount = entry.safe || 0;
                    let unsafeCount = entry.unsafe || 0;

                    // Recalculate if needed
                    if ((safeCount === 0 && unsafeCount === 0) && entry.voters && Object.keys(entry.voters).length > 0) {
                        safeCount = Object.values(entry.voters).filter(v => v === 'safe').length;
                        unsafeCount = Object.values(entry.voters).filter(v => v === 'unsafe').length;
                    }

                    mergedMap.set(normalizedDomain, {
                        domain: normalizedDomain,
                        safe: safeCount,
                        unsafe: unsafeCount,
                        voters: entry.voters || {}
                    });
                }
            });
        }

        // Return merged data (global + local)
        const mergedScores = Array.from(mergedMap.values());

        // Log summary of merged data
        const totalVotes = mergedScores.reduce((sum, e) => sum + (e.safe || 0) + (e.unsafe || 0), 0);
        console.log(`[Trust] [SYNC] Returning ${mergedScores.length} trust entries with ${totalVotes} total votes (merged global + local)`);

        // Update cache (for future use, though we disabled it above)
        trustAllCache.data = mergedScores;
        trustAllCache.timestamp = now;

        res.json(mergedScores);

        // AUTO-REPAIR / SYNC-UP (Background - don't block)
        if (!process.env.RENDER && !process.env.VERCEL && localScores.length > 0) {
            // Run in background
            setImmediate(() => {
                const globalScores = Array.from(mergedMap.values());
                // Normalize domains for comparison
                const globalDomains = new Set(globalScores.map(g => (g.domain || '').toLowerCase().trim()));
                const missingInGlobal = localScores.filter(l => {
                    const localDomain = (l.domain || '').toLowerCase().trim();
                    return !globalDomains.has(localDomain);
                });

                if (missingInGlobal.length > 0) {
                    console.log(`[Trust-Sync] Found ${missingInGlobal.length} domains missing globally. Syncing...`);
                    missingInGlobal.forEach(item => {
                        fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/trust/seed', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(item)
                        }).catch(() => { });
                    });
                }
            });
        }
    } catch (error) {
        console.error('[Trust] Error in /api/trust/all:', error);
        console.error('[Trust] Error stack:', error.stack);
        // Fallback to local only - ensure we always return an array
        try {
            const localScores = await readData(TRUST_FILE) || [];
            res.json(localScores);
        } catch (fallbackError) {
            console.error('[Trust] Fallback also failed:', fallbackError);
            res.json([]); // Return empty array as last resort
        }
    }
});

// Admin: Seed Trust Data (Restore from backup)
app.post('/api/trust/seed', async (req, res) => {
    const data = req.body; // Expects { domain, safe, unsafe, voters }
    if (!data.domain) return res.status(400).json({ error: "Domain required" });

    const normalizedDomain = data.domain.toLowerCase().trim();

    try {
        if (isConnected()) {
            const entry = await TrustScore.findOne({ domain: normalizedDomain });

            if (!entry) {
                await TrustScore.create({
                    domain: normalizedDomain,
                    safe: data.safe || 0,
                    unsafe: data.unsafe || 0,
                    voters: data.voters || {}
                });
                console.log(`[Trust] Restored/Seeded data for ${normalizedDomain}`);
            } else {
                // Merge: Take max values to be safe
                const currentTotal = (entry.safe || 0) + (entry.unsafe || 0);
                const seedTotal = (data.safe || 0) + (data.unsafe || 0);

                if (seedTotal > currentTotal) {
                    entry.safe = data.safe || 0;
                    entry.unsafe = data.unsafe || 0;
                    const votersObj = entry.voters instanceof Map
                        ? Object.fromEntries(entry.voters)
                        : (entry.voters || {});
                    entry.voters = { ...votersObj, ...(data.voters || {}) };
                    await entry.save();
                    console.log(`[Trust] Updated data for ${normalizedDomain} from seed`);
                }
            }
        } else {
            let scores = await readData(TRUST_FILE);
            let entry = scores.find(s => {
                const domain = s.domain || '';
                return domain.toLowerCase().trim() === normalizedDomain;
            });

            if (!entry) {
                scores.push({
                    domain: normalizedDomain,
                    safe: data.safe || 0,
                    unsafe: data.unsafe || 0,
                    voters: data.voters || {}
                });
                console.log(`[Trust] Restored/Seeded data for ${normalizedDomain}`);
            } else {
                const currentTotal = (entry.safe || 0) + (entry.unsafe || 0);
                const seedTotal = (data.safe || 0) + (data.unsafe || 0);

                if (seedTotal > currentTotal) {
                    entry.safe = data.safe || 0;
                    entry.unsafe = data.unsafe || 0;
                    entry.voters = { ...entry.voters, ...(data.voters || {}) };
                    console.log(`[Trust] Updated data for ${normalizedDomain} from seed`);
                }
            }

            await writeData(TRUST_FILE, scores);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[Trust] Error seeding data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin: Simulate Sync to Global Server
app.post('/api/trust/sync', async (req, res) => {
    try {
        // 1. Read Local Trust Data
        const localData = await readData(TRUST_FILE);

        // 2. REAL SYNC: Push local data to global server
        if (!process.env.RENDER && !process.env.VERCEL) {
            console.log(`[Trust-Sync] [PUSH] Starting full sync of ${localData.length} records to global server...`);

            // Push each entry to global seed endpoint
            // We use a loop with small delay to avoid overwhelming the cloud server
            for (const entry of localData) {
                try {
                    await fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/trust/seed', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(entry)
                    });
                } catch (e) {
                    console.warn(`[Trust-Sync] [PUSH] Failed to sync ${entry.domain}: ${e.message}`);
                }
            }
        }

        // 3. Update Sync Timestamp
        const META_FILE = path.join(__dirname, 'data', 'server_meta.json');
        let meta = {};
        if (fs.existsSync(META_FILE)) meta = JSON.parse(fs.readFileSync(META_FILE));

        meta.lastTrustSync = Date.now();
        fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));

        console.log(`[Sync] Trust scores synced to Global Server. Total records: ${localData.length}`);
        res.json({ success: true, syncedCount: localData.length, timestamp: meta.lastTrustSync });
    } catch (error) {
        console.error('[Sync] Error syncing trust scores:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin: Get Sync Status
app.get('/api/trust/sync-status', (req, res) => {
    const META_FILE = path.join(__dirname, 'data', 'server_meta.json');
    if (!fs.existsSync(META_FILE)) return res.json({ lastSync: null });

    const meta = JSON.parse(fs.readFileSync(META_FILE));
    res.json({ lastSync: meta.lastTrustSync || null });
});



// --- THREAT LOGS SYSTEM (Global Sync) ---
const LOGS_FILE = path.join(__dirname, 'data', 'threat_logs.json');

// GET /api/logs/all - Fetch and merge global + local logs
app.get('/api/logs/all', async (req, res) => {
    try {
        // 1. Read Local Logs
        const localLogs = await readData(LOGS_FILE);

        // 2. Fetch Global Logs
        let globalLogs = [];
        try {
            if (!process.env.RENDER && !process.env.VERCEL) {
                const response = await fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/logs/all', {}, 2000);
                if (response.ok) {
                    globalLogs = await response.json();
                    console.log(`[Logs] Fetched ${globalLogs.length} global threat logs`);
                }
            }
        } catch (e) {
            console.warn(`[Logs] Failed to fetch global logs: ${e.message}`);
        }

        // 3. Merge: Combine and deduplicate by timestamp+hostname
        const mergedMap = new Map();

        // Add global logs first
        globalLogs.forEach(log => {
            const key = `${log.timestamp}_${log.hostname}`;
            mergedMap.set(key, log);
        });

        // Add local logs if not in global
        localLogs.forEach(log => {
            const key = `${log.timestamp}_${log.hostname}`;
            if (!mergedMap.has(key)) {
                mergedMap.set(key, log);
            }
        });

        const mergedLogs = Array.from(mergedMap.values());
        // Sort by timestamp descending
        mergedLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        res.json(mergedLogs);
    } catch (error) {
        console.error('[Logs] Error in /api/logs/all:', error);
        res.json(await readData(LOGS_FILE)); // Fallback to local
    }
});

// POST /api/logs - Submit a new threat log
app.post('/api/logs', async (req, res) => {
    const log = req.body;
    if (!log.hostname) return res.status(400).json({ error: "Missing data" });

    // 1. Save locally
    const logs = await readData(LOGS_FILE);
    logs.push(log);

    // Keep last 1000 logs
    if (logs.length > 1000) {
        logs.shift();
    }

    await writeData(LOGS_FILE, logs);
    console.log(`[Logs] New threat log: ${log.hostname} (Score: ${log.score})`);

    // 2. Forward to global server
    if (!process.env.RENDER && !process.env.VERCEL) {
        fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(log)
        }).catch(e => console.warn(`[Logs-Sync] Failed to forward log: ${e.message}`));
    }

    res.json({ success: true });
});

// POST /api/logs/clear - Clear all threat logs (Admin only)
app.post('/api/logs/clear', async (req, res) => {
    await writeData(LOGS_FILE, []);
    console.warn("[Admin] Threat logs cleared locally");
    res.json({ success: true, message: "Local logs cleared" });
});

// --- ROUTES: REPORTS ---

// GET /api/reports
app.get("/api/reports", async (req, res) => {
    const { reporter } = req.query;
    let reports = await readData(REPORTS_FILE);

    // --- GLOBAL SYNC (FETCH UPDATES) ---
    // Ensure local server knows about global bans so banned.js doesn't auto-redirect
    if (!process.env.RENDER && !process.env.VERCEL) {
        try {
            // Fetch global reports with short timeout
            const globalRes = await fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports', {}, 2000);

            if (globalRes.ok) {
                const globalReports = await globalRes.json();
                let changed = false;

                globalReports.forEach(gReport => {
                    // Match by ID unique or URL
                    const localIdx = reports.findIndex(r =>
                        (gReport.id && r.id === gReport.id) ||
                        (r.url === gReport.url)
                    );

                    if (localIdx !== -1) {
                        // Update existing report if status changed (e.g. pending -> banned)
                        // This fixes the issue where local server still thinks site is pending
                        if (reports[localIdx].status !== gReport.status) {
                            reports[localIdx].status = gReport.status;
                            reports[localIdx].lastUpdated = Date.now();
                            changed = true;
                            console.log(`[Sync] Updated status for ${r.url}: ${r.status} -> ${gReport.status}`);
                        }
                    } else if (gReport.status === 'banned') {
                        // Add NEW banned sites from global (Crucial for protection)
                        reports.push(gReport);
                        changed = true;
                    }
                });

                if (changed) {
                    await writeData(REPORTS_FILE, reports);
                    console.log('[Reports] Synced global updates to local database');
                }
            }
        } catch (e) {
            // console.warn('[Reports] Global sync skipped:', e.message);
        }
    }


    if (reporter && typeof reporter === 'string') {
        const searchEmail = reporter.trim().toLowerCase();

        reports = reports.filter(r => {
            const rEmail = (r.reporterEmail || "").toLowerCase().trim();
            const rString = (r.reporter || "").toLowerCase();
            const rName = (r.reporterName || "").toLowerCase();

            // Match exact email, or if email is contained in legacy reporter string, or name matches
            return rEmail === searchEmail ||
                rString.includes(searchEmail) ||
                rName.includes(searchEmail);
        });
    }

    res.json(reports);
});

// POST /api/reports
app.post("/api/reports", async (req, res) => {
    const newReport = req.body;
    if (!newReport.url) return res.status(400).json({ error: "Missing URL" });

    const report = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        url: newReport.url,
        hostname: newReport.hostname || "Unknown",
        reporter: newReport.reporter || "Anonymous",
        reporterName: newReport.reporterName || "User",
        reporterEmail: newReport.reporterEmail || "Anonymous",
        timestamp: Date.now(),
        status: "pending",
        ...newReport,
    };

    // --- ENHANCEMENT: Resolve Real Name if missing ---
    if (report.reporterEmail && report.reporterEmail !== 'Anonymous' && (report.reporterName === 'User' || report.reporterName === 'Anonymous')) {
        // 1. Try JSON Storage
        const users = await readData(USERS_FILE);
        let reporterUser = users.find(u => u.email.toLowerCase() === report.reporterEmail.toLowerCase());

        // 2. Try MongoDB Fallback
        if (!reporterUser && isConnected()) {
            try {
                reporterUser = await User.findOne({ email: report.reporterEmail.toLowerCase() }).lean();
                if (reporterUser) console.log(`[Report] Found reporter ${report.reporterEmail} in MongoDB`);
            } catch (e) {
                console.warn("[Report] MongoDB lookup failed:", e.message);
            }
        }

        if (reporterUser && reporterUser.name) {
            report.reporterName = reporterUser.name;
            report.reporter = `${reporterUser.name} (${report.reporterEmail})`;
            console.log(`[Report] Resolved Anonymous reporter to: ${report.reporterName}`);
        }
    }

    const reports = await readData(REPORTS_FILE);

    // IDEMPOTENCY CHECK: Prevent duplicates
    // Check by ID (if provided) or strict URL match for pending reports
    const existing = reports.find(r =>
        (newReport.id && r.id === newReport.id)
    );

    if (existing) {
        console.log(`[Report] Skipped duplicate: ${newReport.url}`);
        return res.status(200).json({ message: "Report already exists", report: existing });
    }

    reports.push(report);
    await writeData(REPORTS_FILE, reports);

    console.log(`[Report] ${report.url} by ${report.reporter}`);

    // --- GLOBAL SYNC (FORWARD WRITE) ---
    if (!process.env.RENDER && !process.env.VERCEL) {
        fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(report)
        }).catch(e => console.warn(`[Report-Sync] Failed: ${e.message}`));
    }

    res.status(201).json({ message: "Report logged", report });
});

// --- ROUTES: USERS & AUTH ---

// Duplicate route removed







// (Duplicate global-sync removed - see implementation at bottom)


// GET /test-phish (Simulation Page)
app.get("/test-phish", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Urgent Security Update - Verify Account</title>
            <style>
                body { font-family: sans-serif; padding: 50px; text-align: center; background: #f8f9fa; }
                .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
                h1 { color: #dc3545; }
                button { background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 16px; margin-top: 10px; }
                input { padding: 10px; width: 100%; margin: 10px 0; border: 1px solid #ccc; border-radius: 5px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>⚠️ Account Suspended</h1>
                <p>We detected unauthorized access to your **Bank** account.</p>
                <p>Please <strong>login immediately</strong> to verify your identity or your funds will be frozen within 24 hours.</p>
                
                <form action="/login" method="POST">
                    <input type="email" placeholder="Email Address" />
                    <!-- Triggers Insecure Password Risk -->
                    <input type="password" placeholder="Enter Password" />
                    <button type="submit">Verify Now</button>
                </form>
                <br>
                <small>This is a safe simulation page to trigger PhishingShield HUD.</small>
            </div>
        </body>
        </html>
    `);
});

// Email Configuration (EmailJS - Works with Gmail, no domain verification needed)
const axios = require("axios");
let emailServiceReady = false;

// EmailJS Configuration
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || "service_orcv7av";
const EMAILJS_TEMPLATE_ID =
    process.env.EMAILJS_TEMPLATE_ID || "template_f0lfm5h";
const EMAILJS_PUBLIC_KEY =
    process.env.EMAILJS_PUBLIC_KEY || "BxDgzDbuSkLEs4H_9";

// Initialize EmailJS
function initializeEmailService() {
    if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
        console.warn(
            "[EMAIL] EmailJS not fully configured. OTPs will be logged to console.",
        );
        console.warn(
            "[EMAIL] Set EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, and EMAILJS_PUBLIC_KEY environment variables.",
        );
        return false;
    }

    try {
        console.log("[EMAIL] EmailJS initialized successfully");
        console.log(`[EMAIL] Service ID: ${EMAILJS_SERVICE_ID}`);
        console.log("[EMAIL] No domain verification needed - works with Gmail!");
        console.log("[EMAIL] Free tier: 200 emails/month");
        return true;
    } catch (error) {
        console.error("[EMAIL] Failed to initialize EmailJS:", error.message);
        console.log("[EMAIL] Server will continue without email functionality");
        return false;
    }
}

emailServiceReady = initializeEmailService();

// Helper function to convert HTML to plain text (simple version)
function htmlToText(html) {
    return html
        .replace(/<style[^>]*>.*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\n\s*\n/g, "\n")
        .trim();
}

// Helper function to send email via EmailJS
async function sendEmail(to, subject, htmlContent, options = {}) {
    // Extract OTP code from HTML
    const otpMatch = htmlContent.match(/>(\d{4,6})</);
    const otpCode = otpMatch ? otpMatch[1] : "XXXX";

    // Extract recipient name if available
    const toName = options.toName || "User";

    try {
        const payload = {
            service_id: EMAILJS_SERVICE_ID,
            template_id: EMAILJS_TEMPLATE_ID,
            user_id: EMAILJS_PUBLIC_KEY,
            template_params: {
                to_name: toName,
                to_email: to,
                email: to,
                otp: otpCode,
                subject: subject,
                message: htmlContent,
            },
        };

        const config = {
            headers: {
                "Content-Type": "application/json",
                Origin: "https://phishingshield-ruby.vercel.app",
            },
        };

        const response = await axios.post(
            "https://api.emailjs.com/api/v1.0/email/send",
            payload,
            config,
        );

        console.log("[EMAIL] Email sent successfully via EmailJS");
        return { success: true, response: response.data };
    } catch (error) {
        console.error("[EMAIL] EmailJS error:", error.message);
        if (error.response) {
            console.error("[EMAIL] EmailJS response:", error.response.data);
        }
        return { success: false, error: error.message };
    }
}

// In-memory OTP store (Global variable)
const otpStore = {};

// Automatic cleanup for OTPs and Rate Limits (Every 5 minutes)
setInterval(() => {
    const now = Date.now();

    // Clean OTPs
    Object.keys(otpStore).forEach(email => {
        if (otpStore[email].expires < now) {
            delete otpStore[email];
        }
    });

    // Clean Rate Limits
    Object.keys(adminRateLimit).forEach(key => {
        // defined below
        if (adminRateLimit[key].expires < now) {
            delete adminRateLimit[key];
        }
    });
}, 5 * 60 * 1000);

// Admin-specific stores
const adminPendingSessions = {}; // Stores temporary admin sessions before MFA
const adminSessions = {}; // Stores active admin sessions
const adminRateLimit = {}; // Rate limiting for admin endpoints
// Helper: Check if email is admin
function isAdminEmail(email) {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

// Helper: Generate 6-digit OTP for admin
function generateAdminOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper: Audit logging
async function logAdminAction(userId, action, ipAddress, success, details = {}) {
    try {
        const logs = (await readData(AUDIT_LOG_FILE)) || [];
        logs.push({
            id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            userId,
            action,
            ipAddress,
            userAgent: details.userAgent || "Unknown",
            success,
            details,
            timestamp: new Date().toISOString(),
        });
        await writeData(AUDIT_LOG_FILE, logs);
        console.log(
            `[AUDIT] ${action} - User: ${userId} - IP: ${ipAddress} - Success: ${success}`,
        );
    } catch (e) {
        console.error("Audit Log Error:", e);
    }
}

// Helper: Rate limiting check for admin
function checkAdminRateLimit(ip, endpoint) {
    const key = `${ip}:${endpoint}`;
    const now = Date.now();
    const LIMIT = 15; // 15 attempts (Updated by User)
    const WINDOW = 15 * 60 * 1000; // 15 minutes

    if (!adminRateLimit[key]) {
        adminRateLimit[key] = { count: 1, expires: now + WINDOW };
        return true;
    }

    const record = adminRateLimit[key];

    // Check if window expired (should be handled by cleanup, but double check)
    if (now > record.expires) {
        record.count = 1;
        record.expires = now + WINDOW;
        return true;
    }

    if (record.count >= LIMIT) {
        return false;
    }

    record.count++;
    return true;
}

// Helper: Get client IP
function getClientIP(req) {
    return (
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        "127.0.0.1"
    );
}

// POST /api/send-otp
app.post("/api/send-otp", async (req, res) => {
    const { email } = req.body;
    if (!email)
        return res.status(400).json({ success: false, message: "Email required" });

    // Generate 4-digit code
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    // Expires in 10 minutes
    otpStore[email] = {
        code: code,
        expires: Date.now() + 10 * 60 * 1000
    };

    // Log for Dev
    console.log(`[OTP] Preparing to send ${code} to ${email}...`);

    // EmailJS uses template, so FROM_EMAIL is set in EmailJS dashboard
    const fromEmail = process.env.FROM_EMAIL || "phishingshield@gmail.com";
    const mailOptions = {
        from: `"PhishingShield Security" <${fromEmail}>`,
        to: email,
        subject: "Your Verification Code",
        html: `
            <div style="background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px 0;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); overflow: hidden;">
                    <!-- Header -->
                    <div style="background-color: #0f172a; padding: 30px; text-align: center;">
                        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px;">PhishingShield</h1>
                    </div>
                    
                    <!-- Content -->
                    <div style="padding: 40px 30px; text-align: center;">
                        <h2 style="color: #1e293b; font-size: 22px; margin-bottom: 10px;">Verification Required</h2>
                        <p style="color: #64748b; font-size: 16px; line-height: 1.5; margin-bottom: 30px;">
                            You are registering or signing in to PhishingShield. Please use the verification code below to complete the process.
                        </p>
                        
                        <!-- OTP Code -->
                        <div style="background-color: #f1f5f9; border: 2px dashed #94a3b8; border-radius: 8px; padding: 20px; margin: 0 auto 30px; width: fit-content; min-width: 200px;">
                            <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #0d6efd; display: block;">${code}</span>
                        </div>
                        
                        <p style="color: #94a3b8; font-size: 14px; margin-top: 30px;">
                            This code will expire in 10 minutes.<br>
                            If you did not request this email, please ignore it.
                        </p>
                    </div>
                    
                    <!-- Footer -->
                    <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
                        <p style="color: #cbd5e1; font-size: 12px; margin: 0;">
                            &copy; ${new Date().getFullYear()} PhishingShield Security. All rights reserved.
                        </p>
                    </div>
                </div>
            </div>
        `,
    };

    // Check if email service is available
    if (!emailServiceReady) {
        console.log(
            `[OTP FALLBACK] Email service unavailable. Code for ${email}: ${code}`,
        );
        return res.json({
            success: true,
            message: "OTP generated (check server logs)",
        });
    }

    // Send email via EmailJS
    const emailResult = await sendEmail(
        email,
        mailOptions.subject,
        mailOptions.html,
        {
            toName: req.body.name || "User",
        },
    );

    if (emailResult.success) {
        console.log(`[OTP] Email sent successfully to ${email}`);
        res.json({ success: true, message: "OTP Sent to Email!" });
    } else {
        console.error("[OTP] Error sending email:", emailResult.error);
        console.log(`[OTP FALLBACK] Code for ${email}: ${code}`);
        res.json({ success: true, message: "OTP generated (check server logs)" });
    }
});

// POST /api/verify-otp (Mock)
app.post("/api/verify-otp", (req, res) => {
    const { email, otp } = req.body;

    const record = otpStore[email];

    if (!record) {
        return res.status(400).json({ success: false, message: "OTP expired or invalid" });
    }

    // Check Expiry
    if (Date.now() > record.expires) {
        delete otpStore[email];
        return res.status(400).json({ success: false, message: "OTP expired" });
    }

    // Check against stored code (Robust string comparison)
    const stored = String(record.code).trim();
    const input = otp ? String(otp).trim() : '';

    if (stored === input) {
        console.log(`[OTP] ✅ Verified for ${email}`);
        delete otpStore[email]; // Clear after use
        res.json({ success: true });
    } else {
        console.warn(
            `[OTP] ❌ Failed for ${email}. Expected: ${stored}, Got: ${input}`,
        );
        res.status(400).json({ success: false, message: "Invalid OTP" });
    }
});

// POST /api/users/sync (Create or Update User)
app.post("/api/users/sync", async (req, res) => {
    const userData = req.body;
    if (!userData.email) return res.status(400).json({ error: "Email required" });

    const users = await readData(USERS_FILE);
    const idx = users.findIndex((u) => u.email === userData.email);

    let finalUser;

    if (idx !== -1) {
        // UPDATE EXISTING USER
        const serverXP = Number(users[idx].xp) || 0;
        const serverLevel = Number(users[idx].level) || 1;

        const clientUpdated = Number(userData.lastUpdated) || 0;
        const serverUpdated = Number(users[idx].lastUpdated) || 0;

        console.log(`[Sync] Check for ${userData.email}: Client(${userData.xp}xp @ ${clientUpdated}) vs Server(${serverXP}xp @ ${serverUpdated}). Force: ${userData.forceUpdate}, Penalty: ${userData.isPenalty}`);

        // XP Update Logic (Priority Order):
        // 1. forceUpdate = true: ALWAYS override (Admin Edit - can increase or decrease)
        // 2. isPenalty = true: Override if it's a new event (clientUpdated > serverUpdated)
        // 3. XP increase: Standard gameplay progression (ONLY if timestamp is newer)
        // 4. Reject: Older timestamps or decreases without flags

        const isForced = userData.forceUpdate === true || String(userData.forceUpdate) === "true";

        if (isForced) {
            // Admin Force Update - ALWAYS accept (can increase or decrease XP)
            const adminEditTimestamp = clientUpdated || Date.now();
            console.log(`[Sync] Force Update: Overwriting XP for ${userData.email} (${serverXP} -> ${userData.xp}) at ${adminEditTimestamp}`);
            users[idx].xp = userData.xp;
            users[idx].level = userData.level;
            users[idx].lastUpdated = adminEditTimestamp;
            // Mark that this was an admin edit to prevent reverting
            users[idx]._adminEdit = true;
            users[idx]._adminEditTime = adminEditTimestamp;
            users[idx]._adminEditXP = userData.xp; // Store the admin-set XP value
        } else if ((userData.isPenalty === true || String(userData.isPenalty) === "true") && clientUpdated >= serverUpdated) {
            // Penalty System - Only if it's a new or immediate event
            console.log(`[Sync] Penalty Applied: Overwriting XP for ${userData.email} (${serverXP} -> ${userData.xp}). timestamps: C${clientUpdated} >= S${serverUpdated}`);
            users[idx].xp = userData.xp;
            users[idx].level = userData.level;
            users[idx].lastUpdated = clientUpdated || Date.now();
        } else if (userData.xp > serverXP) {
            // Standard XP Increase (Gameplay) - Accept only if timestamp is newer
            if (clientUpdated > serverUpdated) {
                console.log(`[Sync] XP Increase: ${serverXP} -> ${userData.xp} (timestamp: ${clientUpdated} > ${serverUpdated})`);
                users[idx].xp = userData.xp;
                users[idx].level = userData.level;
                users[idx].lastUpdated = clientUpdated || Date.now();
                // Clear admin edit flags as user has progressed beyond that point
                delete users[idx]._adminEdit;
                delete users[idx]._adminEditTime;
                delete users[idx]._adminEditXP;
            } else {
                // Timestamp is older - reject (prevents stale client data from overwriting newer server data)
                console.log(`[Sync] Rejected XP increase: ${serverXP} -> ${userData.xp} (Older timestamp: ${clientUpdated} <= ${serverUpdated})`);
            }
        } else {
            // XP decrease or same without forceUpdate/penalty - Reject (prevent accidental loss)
            console.log(`[Sync] Rejected XP change: ${serverXP} -> ${userData.xp} (No forceUpdate/penalty). Keeping server XP: ${serverXP}`);
            // Don't update XP, but still return current server state so client can sync
        }

        // Always update meta (name, settings) even if XP was rejected
        users[idx].name = userData.name || users[idx].name;
        users[idx].settings = userData.settings || users[idx].settings;

        finalUser = users[idx];
        await writeData(USERS_FILE, users);
        console.log(`[Sync] Final state for ${userData.email}: XP=${finalUser.xp}, Level=${finalUser.level}, lastUpdated=${finalUser.lastUpdated}`);

        // --- GLOBAL SYNC (FORWARD WRITE) ---
        // Forward this update to the central cloud server
        // CRITICAL: Always forward forceUpdate/admin edits to global server
        if (userData.forceUpdate === true) {
            fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/users/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData) // Forward with forceUpdate flag
            })
                .then(r => {
                    if (r.ok) {
                        console.log(`[Global-Forward] Admin edit forwarded to global server. Status: ${r.status}`);
                    } else {
                        console.warn(`[Global-Forward] Global server rejected admin edit. Status: ${r.status}`);
                    }
                })
                .catch(e => console.warn(`[Global-Forward] Failed to sync user: ${e.message}`));
        } else {
            // Regular sync - forward but don't block
            fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/users/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            })
                .then(r => console.log(`[Global-Forward] User update sent. Status: ${r.status}`))
                .catch(e => console.warn(`[Global-Forward] Failed to sync user: ${e.message}`));
        }

        // CRITICAL: Always return the FINAL user data (with updated XP and timestamp)
        // This ensures client gets the correct XP even if their request was rejected
        res.json({ success: true, user: finalUser });

    } else {
        // ZOMBIE KILLER: User does not exist locally.
        console.warn(`[Sync] Rejected non-existent user: ${userData.email}`);
        res.status(404).json({ success: false, error: "USER_VIOLATION", message: "User does not exist. Please register." });
    }
});

// POST /api/users/create (NEW: Explicit Registration)
app.post("/api/users/create", async (req, res) => {
    const userData = req.body;
    if (!userData.email) return res.status(400).json({ error: "Email required" });

    let users = await readData(USERS_FILE);
    const idx = users.findIndex((u) => u.email === userData.email);

    if (idx !== -1) {
        return res.status(400).json({ success: false, message: "User already exists" });
    }

    // Create New
    const finalUser = { ...userData, xp: 0, level: 1, joined: Date.now() };
    users.push(finalUser);
    await writeData(USERS_FILE, users);
    console.log(`[User] New user registered: ${userData.email}`);

    // Global Sync (Forward)
    try {
        fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/users/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalUser)
        }).catch(() => { });
    } catch (e) { }

    res.json({ success: true, user: finalUser });
});




// POST /api/users/reset-password
app.post("/api/users/reset-password", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Email/Pass required" });

    const users = await readData(USERS_FILE);
    const idx = users.findIndex((u) => u.email === email);

    if (idx !== -1) {
        users[idx].password = password;
        await writeData(USERS_FILE, users);
        console.log(`[User] Password reset for: ${email}`);

        // --- GLOBAL SYNC ---
        fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/users/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        }).catch(e => console.warn(`[Pass-Reset-Sync] Failed: ${e.message}`));

        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: "User not found" });
    }
});

// POST /api/users/delete
app.get("/api/users", async (req, res) => {
    console.log("[DEBUG] /api/users endpoint HIT");
    try {
        const users = await readData(USERS_FILE);
        console.log(`[DEBUG] /api/users returning ${users ? users.length : 0} users`);
        res.json(users || []);
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

app.get("/api/ping-server-js", (req, res) => {
    res.send("PONG FROM SERVER.JS");
});

app.post("/api/users/delete", async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: "Email is required" });
    }

    const targetEmail = email.trim().toLowerCase();

    let users = (await readData(USERS_FILE)) || [];
    const initialLen = users.length;

    // Case-insensitive filtering
    users = users.filter((u) => u.email.trim().toLowerCase() !== targetEmail);

    if (users.length !== initialLen) {
        // DIRECT MONGODB DELETE (Fixes persistence issue)
        if (isConnected()) {
            try {
                await User.deleteOne({ email: targetEmail });
                console.log(`[MongoDB] Removed user document: ${targetEmail}`);
            } catch (e) {
                console.error(`[MongoDB] Delete failed: ${e.message}`);
            }
        }

        await writeData(USERS_FILE, users); // Keep JSON in sync (if used)

        // --- ADD TO DELETED LIST (Tombstone Record) ---
        // This stops 'Global Sync' from re-importing this user if the global delete fails
        const deletedList = (await readData(DELETED_USERS_FILE)) || [];
        if (!deletedList.some(u => u.email === targetEmail)) {
            deletedList.push({ email: targetEmail, deletedAt: Date.now() });
            await writeData(DELETED_USERS_FILE, deletedList);
        }

        console.log(`[User] Deleted user: ${targetEmail} (Original: ${email})`);

        // --- GLOBAL SYNC ---
        fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/users/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: targetEmail })
        }).catch(e => console.warn(`[User-Del-Sync] Failed: ${e.message}`));

        res.json({ success: true });
    } else {
        console.warn(`[User] Delete failed - User not found: ${targetEmail}`);
        res.status(404).json({ success: false, message: "User not found" });
    }
});

// ============================================
// ADMIN AUTHENTICATION ENDPOINTS (SECURE)
// ============================================

// POST /api/auth/admin/login - Step 1: Primary Authentication
app.post("/api/auth/admin/login", async (req, res) => {
    const { email, password } = req.body;
    const ip = getClientIP(req);

    // Rate limiting check
    if (!checkAdminRateLimit(ip, "admin_login")) {
        logAdminAction(email || "unknown", "admin_login_attempt", ip, false, {
            reason: "rate_limit_exceeded",
        });
        return res.status(429).json({
            success: false,
            message: "Too many attempts. Please try again in 30 minutes.",
        });
    }

    if (!email || !password) {
        return res
            .status(400)
            .json({ success: false, message: "Email and password required" });
    }

    // Server-side admin check
    if (!isAdminEmail(email)) {
        logAdminAction(email, "admin_login_attempt", ip, false, {
            reason: "not_admin_email",
        });
        return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Find user
    let users = await readData(USERS_FILE);
    let user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());

    if (!user) {
        // --- GLOBAL SYNC FALLBACK ---
        console.log(`[Login] User ${email} not found locally. Checking global...`);
        try {
            const r = await fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/users', {}, 2000);
            if (r.ok) {
                const globalUsers = await r.json();
                if (Array.isArray(globalUsers)) {
                    user = globalUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
                    if (user) {
                        // Sync to local
                        console.log(`[Login] Found ${email} globally. Syncing to local...`);
                        users.push(user);
                        await writeData(USERS_FILE, users);
                    }
                }
            }
        } catch (e) {
            console.warn(`[Login] Global fetch failed: ${e.message}`);
        }
    }

    if (!user) {
        logAdminAction(email, "admin_login_attempt", ip, false, {
            reason: "user_not_found",
        });
        return res
            .status(401)
            .json({ success: false, message: "Invalid credentials" });
    }

    // Verify password (plaintext for now, but admin should use strong password)
    if (user.password !== password) {
        logAdminAction(email, "admin_login_attempt", ip, false, {
            reason: "invalid_password",
        });
        return res
            .status(401)
            .json({ success: false, message: "Invalid credentials" });
    }

    // Authenticated successfully - Generate Admin Session directly (No OTP)
    const sessionId = `admin_sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Generate JWT token for admin
    // Note: mfaVerified set to true as we are trusting password authentication now
    const adminToken = jwt.sign(
        {
            userId: user.email,
            email: user.email,
            role: "admin",
            mfaVerified: true,
            ipAddress: ip,
            sessionId: sessionId,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY_ADMIN },
    );

    // Store admin session PERSISTENTLY
    // Store admin session PERSISTENTLY
    const sessions = await getAdminSessions();
    sessions[sessionId] = {
        userId: user.email,
        token: adminToken,
        ip,
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 24 * 60 * 60 * 1000, // 10 days
    };
    await saveAdminSessions(sessions);

    logAdminAction(user.email, "admin_login_success", ip, true, {
        sessionId,
        method: "password_only",
    });

    res.json({
        success: true,
        token: adminToken,
        user: {
            email: user.email,
            name: user.name,
            role: "admin",
        },
        expiresIn: "10d",
        requiresMFA: false,
    });
});

// Persistent Admin Sessions
const SESSIONS_FILE = path.join(__dirname, "data", "admin_sessions.json");
if (!fs.existsSync(SESSIONS_FILE))
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}, null, 2));

async function getAdminSessions() {
    return (await readData(SESSIONS_FILE)) || {};
}

async function saveAdminSessions(sessions) {
    await writeData(SESSIONS_FILE, sessions);
}

// POST /api/auth/admin/verify-mfa - Step 2: MFA Verification
app.post("/api/auth/admin/verify-mfa", async (req, res) => {
    const { sessionId, otp } = req.body;
    const ip = getClientIP(req);

    if (!sessionId || !otp) {
        return res
            .status(400)
            .json({ success: false, message: "Session ID and OTP required" });
    }

    // Find pending session
    const pendingSession = adminPendingSessions[sessionId];

    if (!pendingSession) {
        logAdminAction("unknown", "admin_mfa_verify", ip, false, {
            reason: "invalid_session",
        });
        return res
            .status(401)
            .json({ success: false, message: "Invalid or expired session" });
    }

    // Check expiry
    if (Date.now() > pendingSession.expiresAt) {
        delete adminPendingSessions[sessionId];
        logAdminAction(pendingSession.email, "admin_mfa_verify", ip, false, {
            reason: "session_expired",
        });
        return res
            .status(401)
            .json({
                success: false,
                message: "Session expired. Please login again.",
            });
    }

    // Verify OTP
    const inputOTP = String(otp).trim();
    const storedOTP = String(pendingSession.otp).trim();

    if (inputOTP !== storedOTP) {
        logAdminAction(pendingSession.email, "admin_mfa_verify", ip, false, {
            reason: "invalid_otp",
        });
        return res.status(401).json({ success: false, message: "Invalid OTP" });
    }

    // OTP verified - create admin session
    const users = await readData(USERS_FILE);
    const user = users.find(
        (u) => u.email.toLowerCase() === pendingSession.email.toLowerCase(),
    );

    if (!user) {
        delete adminPendingSessions[sessionId];
        return res.status(404).json({ success: false, message: "User not found" });
    }

    // Generate JWT token for admin
    const adminToken = jwt.sign(
        {
            userId: user.email,
            email: user.email,
            role: "admin",
            mfaVerified: true,
            ipAddress: ip,
            sessionId: sessionId,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY_ADMIN },
    );

    // Store admin session PERSISTENTLY
    const sessions = await getAdminSessions();
    sessions[sessionId] = {
        userId: user.email,
        token: adminToken,
        ip,
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 24 * 60 * 60 * 1000, // 10 days
    };
    await saveAdminSessions(sessions);

    // Clean up pending session
    delete adminPendingSessions[sessionId];

    logAdminAction(user.email, "admin_login_success", ip, true, {
        sessionId,
        mfaMethod: "email",
    });

    res.json({
        success: true,
        token: adminToken,
        user: {
            email: user.email,
            name: user.name,
            role: "admin",
        },
        expiresIn: "10d",
    });
});

// Middleware: Verify Admin Token

// --- GENERIC AI SCAN ENDPOINT (For real-time page analysis) ---
app.post("/api/ai/scan", async (req, res) => {
    try {
        const { url, content } = req.body;
        if (!url) return res.status(400).json({ error: "URL required" });

        // Limit content to avoid token limits
        const safeContent = (content || "").substring(0, 10000);

        console.log(`[AI-Scan] Analyzing: ${url}`);

        if (process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY) {
            // Support both keys, but prefer GROQ logic if requested
            const Groq = require("groq-sdk");
            const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY });

            async function analyzeWithGroq() {
                const completion = await groq.chat.completions.create({
                    messages: [
                        {
                            role: "system",
                            content: `You are PhishingShield AI, an expert cybersecurity analyst specializing in phishing detection.

Your task is to analyze URLs and page content to identify potential threats.

Classify the site into one of 3 categories:
1. 'SAFE' - Legitimate, well-known sites (e.g., Instagram, Google, GitHub, universities, established companies)
2. 'SUSPICIOUS' - Unknown domains, URL shorteners, typosquatting, or unclear intent
3. 'MALICIOUS' - Clear phishing attempts, scams, fake login pages, credential harvesting

Provide a DETAILED analysis including:
- Overall classification
- Specific threat indicators found (if any)
- Domain reputation assessment
- URL pattern analysis
- Security concerns or red flags
- Recommended action for users

Return JSON format:
{
  "classification": "SAFE|SUSPICIOUS|MALICIOUS",
  "reason": "Detailed multi-sentence explanation covering all findings",
  "threatIndicators": ["list", "of", "specific", "threats", "found"],
  "confidence": "high|medium|low"
}`
                        },
                        {
                            role: "user",
                            content: `Analyze this URL for phishing threats:

URL: ${url}
Page Content: "${safeContent.replace(/(\\r\\n|\\n|\\r)/gm, " ")}"

Provide comprehensive analysis with specific details.`
                        }
                    ],
                    model: "llama-3.3-70b-versatile",
                    temperature: 0.1,
                    response_format: { type: "json_object" }
                });

                const result = JSON.parse(completion.choices[0]?.message?.content || "{}");

                // Manual Mapping to Risk Score
                const cls = (result.classification || "SUSPICIOUS").toUpperCase();
                let score = 45; // Default SUSPICIOUS
                if (cls === "SAFE") score = 0;
                else if (cls === "MALICIOUS") score = 95;

                const suggestion = (score > 70) ? "BAN" : (score > 30 ? "CAUTION" : "IGNORE");

                // Enhanced reason with threat indicators
                let reason = result.reason || "No detailed analysis available";

                // Add threat indicators if present
                if (result.threatIndicators && result.threatIndicators.length > 0) {
                    reason += "\n\n🚨 Threat Indicators:\n" + result.threatIndicators.map(t => `• ${t}`).join("\n");
                }

                // Add confidence level
                if (result.confidence) {
                    reason += `\n\n🎯 Confidence: ${result.confidence.toUpperCase()}`;
                }

                return {
                    score: score,
                    suggestion: suggestion,
                    reason: reason,
                    threatIndicators: result.threatIndicators || [],
                    confidence: result.confidence || "medium"
                };
            }

            try {
                const json = await analyzeWithGroq();
                console.log("[AI-Scan] Classification Result:", json);
                return res.json({ success: true, aiAnalysis: json });
            } catch (e) {
                console.error("[AI-Scan] Groq Failed:", e.message);
                return res.json({ success: false, error: e.message });
            }

        } else {
            console.log("[AI-Scan] No API Key. Skipping.");
            return res.json({ success: false, message: "No AI Key" });
        }
    } catch (error) {
        console.error("[AI-Scan] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- AI ANALYSIS ENDPOINT ---
app.post("/api/reports/ai-verify", async (req, res) => {
    try {
        const { id } = req.body;
        console.log("[AI-Verify] Received request for Report ID:", id);

        // FIX: Read reports from file (await is required as readData is async)
        const reports = await readData(REPORTS_FILE);

        let reportIndex = reports.findIndex((r) => r.id === id);

        // FALLBACK: If not found locally, check Global Server (Lazy Import)
        if (reportIndex === -1) {
            console.log("[AI-Verify] Report not found via ID. checking by URL...");

            // Try finding by URL (Fallback for client-side ephemeral IDs)
            // Find any pending report with same URL to latch onto
            const targetUrl = req.body.url ? req.body.url.toLowerCase() : null;
            if (targetUrl) {
                reportIndex = reports.findIndex(r => r.url.toLowerCase() === targetUrl);
            }

            if (reportIndex === -1) {
                console.log("[AI-Verify] Not found via URL either. Checking Global Server...");
                try {
                    // Use the same global URL as the sync process
                    const response = await fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports', {}, 2000);
                    if (response.ok) {
                        const globalReports = await response.json();
                        let globalReport = globalReports.find(r => r.id === id);

                        // Fallback: Find by URL in global reports
                        if (!globalReport && targetUrl) {
                            globalReport = globalReports.find(r => r.url.toLowerCase() === targetUrl);
                        }

                        if (globalReport) {
                            console.log("[AI-Verify] Found report remotely. Importing to local DB for analysis...");
                            // Check if we already have it (dual check)
                            const exists = reports.findIndex(r => r.id === globalReport.id);
                            if (exists === -1) {
                                reports.push(globalReport);
                                await writeData(REPORTS_FILE, reports);
                                reportIndex = reports.length - 1;
                            } else {
                                reportIndex = exists;
                            }
                        }
                    }
                } catch (e) {
                    console.warn("[AI-Verify] Global fetch failed:", e.message);
                }
            }
        }

        if (reportIndex === -1) {
            console.warn("[AI-Verify] Report not found in DB or Global:", id);
            return res.status(404).json({ error: "Report not found" });
        }

        const report = reports[reportIndex];

        if (!report.url) {
            console.warn("[AI-Verify] Report missing URL:", id);
            return res.status(400).json({ error: "Report data is incomplete (missing URL)" });
        }

        const url = report.url.toLowerCase();

        // --- REAL AI INTEGRATION ---
        let aiScore = 10;
        let aiSuggestion = "IGNORE";
        let aiReason = "No obvious threats detected.";

        console.log("[AI-Verify] Checking API keys...");
        console.log("[AI-Verify] GROQ_API_KEY exists:", !!process.env.GROQ_API_KEY);
        console.log("[AI-Verify] GEMINI_API_KEY exists:", !!process.env.GEMINI_API_KEY);

        if (process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY) {
            log("[AI-Verify] API keys found, proceeding with AI analysis");

            // OPTIMIZATION: Skip page content fetching (major latency bottleneck - was 5s timeout)
            // Analyze URL pattern only for faster response
            const pageContext = "URL-based analysis (optimized for speed)";

            // --- SHARED PROMPT ---
            const SYSTEM_PROMPT = `You are PhishingShield AI, an expert cybersecurity analyst.
Your task is to analyze URLs to identify phishing threats.

Classify the site into one of 3 categories:
1. 'SAFE' - Legitimate, well-known sites (e.g., Google, GitHub, Universities)
2. 'SUSPICIOUS' - Unknown domains, URL shorteners, typosquatting
3. 'MALICIOUS' - Clear phishing, scams, fake logins

Return JSON format:
{
  "classification": "SAFE|SUSPICIOUS|MALICIOUS",
  "reason": "Detailed explanation covering findings",
  "threatIndicators": ["list", "of", "threats"],
  "confidence": "high|medium|low"
}`;

            const USER_PROMPT = `Analyze this URL for phishing threats:
URL: ${url}
Provide comprehensive analysis based on URL pattern, domain reputation, and known threat indicators.`;

            let rawResult = null;
            let provider = "NONE";

            const requestedProvider = req.body.provider ? req.body.provider.toUpperCase() : null;
            log("[AI-Verify] Requested provider:", requestedProvider);

            // OPTIMIZATION: Set timeout for AI analysis (8 seconds max instead of unlimited)
            const AI_TIMEOUT = 8000;
            const aiAnalysisPromise = (async () => {
                // 1. TRY GROQ (if requested or as fallback)
                if ((requestedProvider === 'GROQ' || !requestedProvider) && process.env.GROQ_API_KEY) {
                    log("[AI-Verify] Attempting Groq analysis...");
                    try {
                        const Groq = require("groq-sdk");
                        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
                        const completion = await groq.chat.completions.create({
                            messages: [
                                { role: "system", content: SYSTEM_PROMPT },
                                { role: "user", content: USER_PROMPT }
                            ],
                            model: "llama-3.3-70b-versatile",
                            temperature: 0.1,
                            response_format: { type: "json_object" }
                        });
                        rawResult = JSON.parse(completion.choices[0]?.message?.content || "{}");
                        provider = "GROQ";
                        log("[AI-Verify] Groq Analysis Success");
                        return { rawResult, provider };
                    } catch (e) {
                        logError(`[AI-Verify] Groq Error (Falling back to Gemini):`, e.message);
                    }
                } else {
                    log("[AI-Verify] Skipping Groq (requested:", requestedProvider, ", key exists:", !!process.env.GROQ_API_KEY, ")");
                }

                // 2. TRY GEMINI (if requested or as fallback)
                log(`[AI-Verify] Checking Gemini... RawResult: ${!!rawResult}, Provider: ${requestedProvider}`);

                if (!rawResult && ((requestedProvider === 'GEMINI') || !requestedProvider) && process.env.GEMINI_API_KEY) {
                    try {
                        log("[AI-Verify] Initializing Gemini Client...");
                        const { GoogleGenerativeAI } = require("@google/generative-ai");
                        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

                        const generateWithModel = async (modelName) => {
                            log(`[AI-Verify] Attempting Gemini Model: ${modelName}`);
                            const model = genAI.getGenerativeModel({ model: modelName });
                            const fullPrompt = `${SYSTEM_PROMPT}\n\nTask:\n${USER_PROMPT}`;

                            try {
                                const result = await model.generateContent(fullPrompt);
                                const response = await result.response;
                                const text = response.text();
                                log(`[AI-Verify] Gemini Raw Response (${modelName}):`, text.substring(0, 500) + "...");

                                const jsonMatch = text.match(/\{[\s\S]*\}/);
                                if (jsonMatch) {
                                    return JSON.parse(jsonMatch[0]);
                                }
                                log(`[AI-Verify] JSON parse failed for ${modelName}. Raw text logged above.`);
                                throw new Error("No JSON found in response");
                            } catch (genErr) {
                                logError(`[AI-Verify] Generation Error (${modelName}):`, genErr.message);
                                throw genErr;
                            }
                        };

                        try {
                            rawResult = await generateWithModel("gemini-2.5-flash");
                            log("[AI-Verify] Gemini (2.5 Flash) Analysis Success");
                        } catch (err) {
                            log("[AI-Verify] Gemini 2.5 Flash failed, trying 2.0 Flash:", err.message);
                            try {
                                rawResult = await generateWithModel("gemini-2.0-flash");
                                log("[AI-Verify] Gemini (2.0 Flash) Analysis Success");
                            } catch (proErr) {
                                logError("[AI-Verify] Gemini Pro also failed.");
                            }
                        }

                        if (rawResult) provider = "GEMINI";

                    } catch (e) {
                        logError("[AI-Verify] Gemini Fatal Error:", e);
                    }
                }

                return { rawResult, provider };
            })();

            // OPTIMIZATION: Race AI analysis with timeout
            try {
                const result = await Promise.race([
                    aiAnalysisPromise,
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('AI analysis timeout')), AI_TIMEOUT)
                    )
                ]);

                rawResult = result.rawResult;
                provider = result.provider;
            } catch (timeoutError) {
                logError("[AI-Verify] AI analysis timed out after 8s");
                rawResult = null;
            }

            // 3. PROCESS RESULT
            if (rawResult) {
                const cls = (rawResult.classification || "SUSPICIOUS").toUpperCase();
                if (cls === "SAFE") aiScore = 0;
                else if (cls === "MALICIOUS") aiScore = 95;
                else aiScore = 45;

                aiSuggestion = (aiScore > 70) ? "BAN" : (aiScore > 30 ? "CAUTION" : "IGNORE");

                aiReason = rawResult.reason || "Analysis completed.";
                if (rawResult.threatIndicators?.length > 0) {
                    aiReason += "\n\n🚨 Indicators:\n" + rawResult.threatIndicators.map(t => `• ${t}`).join("\n");
                }

                // Add Provider Tag for Frontend Label Logic
                // Add Provider Tag text (Optional, user requested removal)
                // if (provider === "GEMINI") { ... }

                console.log(`[AI-Verify] Final Result (${provider}): Score ${aiScore}`);
            } else {
                aiReason = "AI Service Unavailable (Both Providers Failed)";
            }
        } else {
            // NO API KEY - Use Heuristics
            console.log("[AI-Verify] No API Key found. Using Heuristics.");
            aiReason = "[Heuristic] No suspicious keywords or IP patterns found.";

            const suspiciousKeywords = [
                "login",
                "signin",
                "secure",
                "account",
                "update",
                "verify",
                "wallet",
                "bank",
                "crypto",
            ];

            let riskCount = 0;
            suspiciousKeywords.forEach((word) => {
                if (url.includes(word)) riskCount++;
            });

            // Check for IP address usage (simple regex)
            if (/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(url)) {
                riskCount += 2;
            }

            if (riskCount >= 2) {
                aiScore = 85;
                aiSuggestion = "BAN";
                aiReason = "Multiple high-risk keywords detected (Phishing Indicators).";
            } else if (riskCount === 1) {
                aiScore = 45;
                aiSuggestion = "CAUTION";
                aiReason = "Contains sensitive keywords, requires manual review.";
            }
        }
        // Update Report with AI Data -- END of IF/ELSE Block
        reports[reportIndex] = {
            ...report,
            aiAnalysis: {
                score: aiScore,
                suggestion: aiSuggestion,
                reason: aiReason,
                published: false,
                timestamp: Date.now(),
            },
        };

        // FIX: Save using writeData (await for safety)
        await writeData(REPORTS_FILE, reports);

        console.log(`[AI-Verify] Analyzed ${url} -> ${aiSuggestion} (${aiScore})`);
        res.json({ success: true, aiAnalysis: reports[reportIndex].aiAnalysis });
    } catch (error) {
        console.error("[AI-Verify] Error:", error);
        res.status(500).json({ success: false, error: "AI Analysis Error: " + error.message });
    }
});

// POST /api/reports/publish
app.post("/api/reports/publish", async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, message: "Report ID required" });

    try {
        const reports = await readData(REPORTS_FILE);
        const idx = reports.findIndex(r => r.id === id);
        if (idx === -1) return res.status(404).json({ success: false, message: "Report not found" });

        if (!reports[idx].aiAnalysis) {
            return res.status(400).json({ success: false, message: "No AI analysis to publish. Please run AI verification first." });
        }

        reports[idx].aiAnalysis.published = true;
        await writeData(REPORTS_FILE, reports);

        console.log(`[Admin] Analysis published for report ${id}`);
        res.json({ success: true, message: "Analysis published to user dashboard successfully!" });
    } catch (error) {
        console.error("[Admin] Publish Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// MIDDLEWARE: Check Admin Access
const requireAdmin = async (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader)
        return res.status(401).json({ success: false, message: "Token required" });

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // Verify it's an admin token
        if (decoded.role !== "admin" || !decoded.mfaVerified) {
            return res
                .status(403)
                .json({ success: false, message: "Admin access required" });
        }

        // Verify session exists in PERSISTENT store
        const sessionId = decoded.sessionId;
        const sessions = await getAdminSessions(); // Read from file

        if (!sessions[sessionId]) {
            return res
                .status(401)
                .json({ success: false, message: "Session expired" });
        }

        // Check session expiry
        const session = sessions[sessionId];
        if (Date.now() > session.expiresAt) {
            delete sessions[sessionId];
            await saveAdminSessions(sessions);
            return res
                .status(401)
                .json({ success: false, message: "Session expired" });
        }

        req.admin = decoded;
        req.sessionId = sessionId;
        next();
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({ success: false, message: "Token expired" });
        }
        return res.status(401).json({ success: false, message: "Invalid token" });
    }
};

// GET /api/auth/admin/verify - Verify admin token validity
app.get("/api/auth/admin/verify", requireAdmin, (req, res) => {
    res.json({
        success: true,
        admin: {
            email: req.admin.email,
            role: req.admin.role,
        },
    });
});

// GET /api/admin/logs - Get audit logs (Admin Only)
app.get("/api/admin/logs", requireAdmin, async (req, res) => {
    const logs = (await readData(AUDIT_LOG_FILE)) || [];
    // Return last 100 logs
    const recentLogs = logs.slice(-100).reverse();
    res.json({ success: true, logs: recentLogs });
});

// --- REPORTS API ---

// (Duplicate Routes Removed)

// POST /api/reports/update - Update report status (ban/ignore/pending)
app.post("/api/reports/update", async (req, res) => {
    const { id, status } = req.body; // status: 'banned', 'ignored', 'pending'
    if (!id || !status)
        return res
            .status(400)
            .json({ success: false, message: "ID and status required" });

    const reports = (await readData(REPORTS_FILE)) || [];
    const idx = reports.findIndex((r) => r.id === id);

    if (idx !== -1) {
        reports[idx].status = status;
        reports[idx].lastUpdated = Date.now(); // Essential for sync logic
        if (status === "banned") reports[idx].bannedAt = Date.now();
        if (status === "ignored") reports[idx].ignoredAt = Date.now();

        await writeData(REPORTS_FILE, reports);
        console.log(`[Report] Updated status for ${id} to ${status}`);

        // --- GLOBAL SYNC (FORWARD WRITE) ---
        // Fire and forget - don't block local success
        if (!process.env.RENDER && !process.env.VERCEL) {
            fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status })
            })
                .then(r => console.log(`[Global-Forward] Report update sent to cloud. Status: ${r.status}`))
                .catch(e => console.warn(`[Global-Forward] Failed to sync with cloud: ${e.message}`));
        }

        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: "Report not found" });
    }
});

// POST /api/reports/delete - Bulk Delete Reports
app.post("/api/reports/delete", async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids))
        return res.status(400).json({ success: false, message: "IDs array required" });

    let reports = (await readData(REPORTS_FILE)) || [];
    const initialLen = reports.length;

    // Filter out reports whose IDs are in the deletion list
    // Crucially, we assume the FRONTEND has already filtered out 'banned' reports.
    // The server just deletes what it is told to delete.
    reports = reports.filter(r => !ids.includes(r.id));

    if (reports.length !== initialLen) {
        await writeData(REPORTS_FILE, reports);
        console.log(`[Report] Deleted ${initialLen - reports.length} reports.`);

        // --- GLOBAL SYNC ---
        if (!process.env.RENDER && !process.env.VERCEL) {
            fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            }).catch(e => console.warn(`[Report-Del-Sync] Failed: ${e.message}`));
        }

        res.json({ success: true, deletedCount: initialLen - reports.length });
    } else {
        res.json({ success: true, deletedCount: 0, message: "No matching reports found to delete." });
    }
});

// --- NEW: Global Sync Endpoint ---
// Proxies request to global server to avoid CORS issues in the browser
// and merges with local data.
app.get("/api/reports/global-sync", async (req, res) => {
    try {
        const localReports = (await readData(REPORTS_FILE)) || [];
        console.log(`[Global-Sync] Loaded ${localReports.length} local reports.`);

        // OPTIMIZATION: If we are the Global Server, we don't need to sync with ourselves.
        if (process.env.RENDER || process.env.VERCEL) {
            return res.json(localReports);
        }

        let globalReports = [];
        try {
            // Native fetch in Node 18+
            const response = await fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports');
            if (response.ok) {
                globalReports = await response.json();
                console.log(`[Global-Sync] Fetched ${globalReports.length} global reports.`);
            } else {
                console.warn(`[Global-Sync] Global fetch failed: ${response.status}`);
            }
        } catch (e) {
            console.warn(`[Global-Sync] Global fetch error: ${e.message}`);
        }

        // Merge Logic: ID Match + Status Priority
        // If Global has 'banned' or 'ignored', it overwrites 'pending' locally.
        const mergedReportsMap = new Map();
        let dataChanged = false;

        // 1. Load Local Reports First
        localReports.forEach(r => mergedReportsMap.set(r.id, r));

        // 2. Merge Global Reports
        const healingQueue = [];

        // Helper: Find existing report by ID OR unique URL
        const normalizeUrl = (u) => u ? u.trim().toLowerCase().replace(/\/+$/, "") : "";

        const findMatch = (gReport) => {
            if (mergedReportsMap.has(gReport.id)) return mergedReportsMap.get(gReport.id);

            const gUrl = normalizeUrl(gReport.url);
            // Fallback: Check by Normalized URL
            for (const localR of mergedReportsMap.values()) {
                if (normalizeUrl(localR.url) === gUrl) {
                    return localR;
                }
            }
            return null;
        };

        if (Array.isArray(globalReports)) {
            const processedIds = new Set();

            globalReports.forEach(globalR => {
                processedIds.add(globalR.id);
                const localR = findMatch(globalR);

                if (!localR) {
                    // New Report from Global -> Add it
                    mergedReportsMap.set(globalR.id, globalR);
                    dataChanged = true;
                } else {
                    // Conflict: Report exists (by ID or URL).
                    // Align IDs if we matched by URL but IDs differed
                    if (localR.id !== globalR.id) {
                        console.log(`[Global-Sync] Merging duplicate URL IDs: Local(${localR.id}) vs Global(${globalR.id})`);
                        // We keep the Global ID as canonical if possible, or just link them.
                        // For now, let's update the LOCAL record with the GLOBAL ID to converge.
                        mergedReportsMap.delete(localR.id);
                        // globalR.status = localR.status; // REMOVED: Don't overwrite yet, let time decide.
                        mergedReportsMap.set(globalR.id, globalR);
                    }

                    // TIME-BASED SYNCHRONIZATION (Last Write Wins)
                    const gTime = Number(globalR.lastUpdated) || 0;
                    const lTime = Number(localR.lastUpdated) || 0;

                    // Definitions essential for fallback logic and logging
                    const statusPriority = { 'banned': 3, 'ignored': 2, 'pending': 1 };
                    const gStatus = globalR.status || 'pending';
                    const lStatus = localR.status || 'pending';
                    const gScore = statusPriority[gStatus] || 0;
                    const lScore = statusPriority[lStatus] || 0;

                    if (gTime > lTime) {
                        // Global is newer -> Update Local
                        console.log(`[Global-Sync] Global '${gStatus}' (t=${gTime}) is newer than Local '${lStatus}' (t=${lTime}). Updating Local.`);
                        mergedReportsMap.set(globalR.id, globalR);
                        dataChanged = true;
                    }
                    else if (lTime > gTime) {
                        // Local is newer -> HEAL GLOBAL
                        console.log(`[Global-Sync] Local '${lStatus}' (t=${lTime}) is newer than Global '${gStatus}' (t=${gTime}). Healing...`);

                        // Construct the "Winning" object using Global ID but Local Status/Time
                        const winner = {
                            ...globalR,
                            status: lStatus,
                            lastUpdated: lTime,
                            bannedAt: (lStatus === 'banned') ? (localR.bannedAt || Date.now()) : globalR.bannedAt,
                            ignoredAt: (lStatus === 'ignored') ? (localR.ignoredAt || Date.now()) : globalR.ignoredAt
                        };
                        mergedReportsMap.set(globalR.id, winner); // Update local cache with winning hybrid
                        dataChanged = true;

                        fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports/update', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: globalR.id, status: lStatus }) // Use canonical Global ID
                        }).catch(e => console.warn(`[Heal-Fail] ${e.message}`));
                    }
                    else {
                        // Timestamps equal or missing (Legacy Mode).
                        // Fallback with SMART HEURISTIC for Banned vs Pending

                        let resolved = false;

                        // Case: Local Pending (Unban) vs Global Banned (Zombie)
                        // If Local has the SAME bannedAt time as Global, it means Local WAS banned at that time 
                        // but is now Pending (Unbanned). Local is newer.
                        if (lStatus === 'pending' && gStatus === 'banned') {
                            console.log(`[Global-Sync] Zombie Check: Local=Pending(t=${lTime}) vs Global=Banned(t=${gTime})`);
                            const sameBanTime = (Number(globalR.bannedAt) === Number(localR.bannedAt));

                            if (sameBanTime || (lTime > 0 && gTime === 0)) {
                                console.log(`[Global-Sync] Handled Zombie Ban: Trusting Local Unban.`);
                                const winner = { ...globalR, status: lStatus, lastUpdated: lTime || Date.now() };
                                mergedReportsMap.set(globalR.id, winner);
                                dataChanged = true;
                                resolved = true;

                                fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports/update', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ id: globalR.id, status: lStatus })
                                }).catch(() => { });
                            }
                        }

                        if (!resolved) {
                            if (gScore > lScore) {
                                // Standard Priority: Global wins
                                mergedReportsMap.set(globalR.id, globalR);
                                dataChanged = true;
                            } else if (lScore > gScore) {
                                // Standard Priority: Local wins -> Heal Global
                                const winner = { ...globalR, status: lStatus };
                                mergedReportsMap.set(globalR.id, winner);
                                dataChanged = true;

                                fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports/update', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ id: globalR.id, status: lStatus })
                                }).catch(() => { });
                            }
                        }
                    }
                }
            });

            // 3. PUSH MISSING REPORTS (Local-Only -> Global)
            for (const [id, report] of mergedReportsMap) {
                if (!processedIds.has(id)) {
                    console.log(`[Global-Sync] Found Local-Only report ${id} (${report.url}). Uploading to Cloud...`);
                    // Fire and forget upload
                    fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(report)
                    }).then(() => {
                        // Also sync status if not pending
                        if (report.status && report.status !== 'pending') {
                            fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports/update', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: report.id, status: report.status })
                            }).catch(() => { });
                        }
                    }).catch(e => console.warn(`[Push-Fail] ${e.message}`));
                }
            }
        }

        const mergedReports = Array.from(mergedReportsMap.values());

        // --- PERSISTENCE: Save merged state locally ---
        if (dataChanged) {
            console.log(`[Global-Sync] Updates found. Saving ${mergedReports.length} reports to local DB.`);
            await writeData(REPORTS_FILE, mergedReports);
        }

        // --- AUTO-REPAIR: If Global is empty/behind but Local has data, PUSH it up ---
        // This handles cases where the Cloud Server restarted and lost its ephemeral data.
        if (localReports.length > 0 && (!globalReports || globalReports.length === 0)) {
            console.warn(`[Global-Sync] ⚠️ Global Server appears empty/wiped. Attempting AUTO-REPAIR from Local Backup...`);

            // Send requests in chunks to avoid overwhelming the server
            // We fire-and-forget this background process
            (async () => {
                let successCount = 0;
                for (const r of localReports) {
                    try {
                        await fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(r)
                        });
                        // Also sync status if it's not pending
                        if (r.status !== 'pending') {
                            await fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/reports/update', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: r.id, status: r.status })
                            });
                        }
                        successCount++;
                    } catch (e) { /* ignore individual fail */ }
                }
                console.log(`[Global-Sync] ✅ Auto-Repair Triggered. Re-seeded ${successCount} reports to Global Server.`);
            })();
        }

        console.log(`[Global-Sync] Returning ${mergedReports.length} merged reports.`);
        res.json(mergedReports);

    } catch (error) {
        console.error("[Global-Sync] Error:", error);
        res.json((await readData(REPORTS_FILE)) || []);
    }
});

// --- NEW: Global User Sync Endpoint (Leaderboard) ---
app.get("/api/users/global-sync", async (req, res) => {
    try {
        const localUsers = (await readData(USERS_FILE)) || [];
        // Ensure Deleted Users file exists
        if (!fs.existsSync(DELETED_USERS_FILE)) await writeData(DELETED_USERS_FILE, []);
        const deletedUsers = (await readData(DELETED_USERS_FILE)) || [];

        console.log(`[User-Sync] Loaded ${localUsers.length} local users.`);

        if (process.env.RENDER || process.env.VERCEL) {
            console.log("[User-Sync] Global Server detected - returning local data only.");
            return res.json(localUsers);
        }

        let globalUsers = [];
        try {
            const response = await fetchWithTimeout('https://phishingshield-ruby.vercel.app/api/users');
            if (response.ok) {
                globalUsers = await response.json();
                console.log(`[User-Sync] Fetched ${globalUsers.length} global users.`);
            }
        } catch (e) {
            console.warn(`[User-Sync] Global fetch error: ${e.message}`);
        }

        // FILTER: Remove any Global User that is in our Local 'Deleted' list
        // This prevents Zombie Users from reappearing if global delete failed/lagged.
        if (Array.isArray(globalUsers)) {
            const deletedEmails = new Set(deletedUsers.map(u => u.email));
            const initialGlobalCount = globalUsers.length;
            globalUsers = globalUsers.filter(gUser => !deletedEmails.has(gUser.email));

            if (globalUsers.length !== initialGlobalCount) {
                console.log(`[User-Sync] Filtered out ${initialGlobalCount - globalUsers.length} zombie users (locally deleted).`);
            }
        }

        // Merge Logic: By Email. Prioritize timestamps (newer wins), not max XP.
        const mergedUsers = [...localUsers];
        let dataChanged = false;

        if (Array.isArray(globalUsers)) {
            globalUsers.forEach(gUser => {
                const idx = mergedUsers.findIndex(lUser => lUser.email === gUser.email);
                if (idx === -1) {
                    // New user from global
                    mergedUsers.push(gUser);
                    dataChanged = true;
                } else {
                    // Conflict Resolution: Timestamp-based (Last Write Wins)
                    // This allows recent admin edits (XP decrease) to override old global data
                    const localTime = Number(mergedUsers[idx].lastUpdated) || 0;
                    const globalTime = Number(gUser.lastUpdated) || 0;

                    if (globalTime > localTime) {
                        // Global is newer - use global data
                        console.log(`[User-Sync] Global newer for ${gUser.email}: Local(${localTime}) < Global(${globalTime})`);
                        mergedUsers[idx] = gUser;
                        dataChanged = true;
                    } else if (localTime > globalTime) {
                        // Local is newer - keep local data (admin edit or recent activity)
                        console.log(`[User-Sync] Local newer for ${gUser.email}: Local(${localTime}) > Global(${globalTime}) - keeping local`);
                        // Don't change - local is already correct
                    } else if (globalTime === 0 && localTime === 0) {
                        // Both have no timestamp - Fallback: Keep local (local is source of truth for admin edits)
                        console.log(`[User-Sync] No timestamps for ${gUser.email} - keeping local data`);
                        // Don't change - local is already correct
                    }
                    // If timestamps are equal, keep local (don't overwrite with potentially stale global)
                }
            });
        }

        // --- PERSISTENCE FIX ---
        // Save the merged list back to local file so it sticks
        if (dataChanged) {
            console.log(`[User-Sync] Data difference detected. updating local storage.`);
            await writeData(USERS_FILE, mergedUsers);
        }


        console.log(`[User-Sync] Returning ${mergedUsers.length} merged users for leaderboard.`);
        res.json(mergedUsers);

    } catch (error) {
        console.error("[User-Sync] Error:", error);
        res.json((await readData(USERS_FILE)) || []);
    }
});

// --- MOCKED WHOIS / DOMAIN AGE API ---
// In production, this would call a real WHOIS provider (e.g., WhoisXML, GoDaddy API)
app.get('/api/domain-age', (req, res) => {
    const domain = req.query.domain;
    if (!domain) return res.status(400).json({ error: "Missing domain" });

    // SIMULATION LOGIC:
    // 1. If domain contains "new", "test", "temp", "verify" -> Treat as VERY NEW (2 days old)
    // 2. If domain contains "google", "paypal", "amazon" -> Treat as OLD (10 years)
    // 3. Otherwise -> Random age for demo

    let daysOld = 365; // Default safe

    if (domain.match(/new|test|temp|verify|update|secure-login/)) {
        daysOld = 2; // Suspiciously new
    } else if (domain.match(/google|paypal|amazon|microsoft|facebook|apple|netflix/)) {
        daysOld = 5000; // Ancient
    } else {
        daysOld = Math.floor(Math.random() * 500); // Random
    }

    // Return the "Registration Date"
    const regDate = new Date();
    regDate.setDate(regDate.getDate() - daysOld);

    res.json({
        domain: domain,
        daysOld: daysOld,
        created: regDate.toISOString()
    });
});

// Start Server (Only for non-serverless environments)
// Vercel handles the server in serverless mode
if (!process.env.VERCEL) {
    // Bind to 0.0.0.0 to accept connections from Render's network
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`PhishingShield Backend running on port ${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
}

// Export for Vercel serverless functions
module.exports = app;
// Trigger redeploy Sat Jan 31 23:17:54 IST 2026
