/**
 * PhishingShield Authentication Module
 * Backend: Node.js (Localhost:3000)
 */

// Initialize EmailJS (Frontend fallback if server fails, but server handles OTP now)
if (typeof emailjs !== 'undefined') {
    try { emailjs.init({ publicKey: "BxDgzDbuSkLEs4H_9" }); } catch (e) { console.warn(e); }
}

// Toggle this for development
if (typeof window.DEV_MODE === 'undefined') {
    window.DEV_MODE = false;
}
if (typeof window.API_BASE === 'undefined') {
    window.API_BASE = window.DEV_MODE ? "http://localhost:3000/api" : "https://phishingshield-ruby.vercel.app/api";
}

var DEV_MODE = window.DEV_MODE;
var API_BASE = window.API_BASE;

console.log(`[AUTH] Running in ${DEV_MODE ? 'DEVELOPMENT' : 'PRODUCTION'} mode`);
console.log(`[AUTH] API Base: ${API_BASE}`);

// Helper function to handle Render's slow cold starts
function fetchWithTimeout(url, options = {}, timeout = 120000) { // 2 minute timeout for Render
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout - server may be waking up')), timeout)
        )
    ]);
}

const Auth = {
    // 1. REGISTER: Check Backend if email exists
    register: function (name, email, password, callback) {
        // Step 1: Check Exists
        fetchWithTimeout(`${API_BASE}/users`)
            .then(res => res.json())
            .then(users => {
                const exists = users.find(u => u.email === email);
                if (exists) {
                    callback({ success: false, message: "Email already registered (Global)." });
                } else {
                    this._proceedRegister(name, email, password, callback);
                }
            })
            .catch(err => {
                console.warn("Backend Unreachable:", err);
                // Fallback Local Check (if server is down, we technically can't sync global yet)
                this._localCheckRegister(name, email, password, callback);
            });
    },

    _localCheckRegister: function (name, email, password, callback) {
        chrome.storage.local.get(['users'], (result) => {
            const users = result.users || [];
            if (users.some(u => u.email === email)) {
                callback({ success: false, message: "Email already registered locally." });
            } else {
                this._proceedRegister(name, email, password, callback);
            }
        });
    },

    _proceedRegister: function (name, email, password, callback) {
        // Step 2: Request Server to Send OTP
        fetchWithTimeout(`${API_BASE}/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    // Store pending state locally
                    const tempUser = { name, email, password };
                    chrome.storage.local.set({ pendingUser: tempUser }, () => {
                        callback({ success: true, otp: 'CHECK_EMAIL' });
                    });
                } else {
                    callback({ success: false, message: "Server: " + data.message });
                }
            })
            .catch(err => {
                console.error("OTP Request Failed", err);
                callback({ success: false, message: "Server Error: " + err.message });
            });
    },

    /**
     * Verifies OTP and Finalizes Registration
     */
    verifyOTP: function (inputOtp, callback) {
        chrome.storage.local.get(['pendingUser', 'users'], (result) => {
            const pending = result.pendingUser;
            if (!pending) {
                callback({ success: false, message: "Session Expired" });
                return;
            }

            // Verify with Backend
            fetch(`${API_BASE}/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: pending.email, otp: inputOtp })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        // Success! Create User
                        const newUser = {
                            name: pending.name,
                            email: pending.email,
                            password: pending.password,
                            xp: 0,
                            level: 1,
                            joined: Date.now(),
                            rank: 'Novice'
                        };

                        // Sync to Backend
                        this._syncUserToBackend(newUser);

                        // Save Locally
                        let users = result.users || [];
                        users.push(newUser);
                        chrome.storage.local.set({ users: users, currentUser: newUser, userXP: 0, userLevel: 1, pendingUser: null }, () => {
                            callback({ success: true, user: newUser });
                        });
                    } else {
                        callback({ success: false, message: "Invalid OTP" });
                    }
                })
                .catch(err => {
                    callback({ success: false, message: "Verification Failed (Network)." });
                });
        });
    },

    _syncUserToBackend: function (user) {
        fetch(`${API_BASE}/users/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        }).then(r => console.log("User Created on Node Backend")).catch(e => console.error(e));
    },

    /**
     * Logs in a user
     */
    login: function (email, password, callback) {
        // Use Server-Side Login (Secure)
        fetch(`${API_BASE}/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    console.log("[Auth] Login Successful:", data.user.email);
                    // Server returns user object and token
                    // We need to adapt it to the local format expected by _restoreSession
                    const user = data.user;
                    // Token handling could be added here if needed for future authenticated requests
                    this._restoreSession(user, callback);
                } else {
                    console.warn("[Auth] Login Failed:", data.message);
                    callback({ success: false, message: data.message });
                }
            })
            .catch(err => {
                console.warn("Backend Login Error", err);
                // Fallback to local only if network fails completely? 
                // BUT local passwords might be plain text vs hashed on server. 
                // For now, let's try local fallback just in case of offline mode, 
                // assuming local storage has the right data.
                this._localLogin(email, password, callback);
            });
    },

    _localLogin: function (email, password, callback) {
        chrome.storage.local.get(['users'], (res) => {
            const users = res.users || [];
            const user = users.find(u => u.email === email && u.password === password);
            if (user) {
                this._restoreSession(user, callback);
            } else {
                callback({ success: false, message: "Invalid email or password." });
            }
        });
    },

    _restoreSession: function (user, callback) {
        // Calculate Level
        const xp = user.xp || 0;
        const lvl = Math.floor(Math.sqrt(xp / 100)) + 1;
        user.level = lvl;

        // Restore Settings
        if (user.settings) {
            chrome.storage.local.set(user.settings);
        }

        chrome.storage.local.get(['users'], (res) => {
            let users = res.users || [];
            // Merge/Update local user list with this fresh user
            const idx = users.findIndex(u => u.email === user.email);
            if (idx !== -1) users[idx] = user;
            else users.push(user);

            chrome.storage.local.set({
                currentUser: user,
                userXP: xp,
                userLevel: lvl,
                users: users
            }, () => {
                callback({ success: true, user: user });
            });
        });
    },

    /**
     * Logs out
     */
    logout: function (callback) {
        chrome.storage.local.get(['currentUser', 'userXP'], (res) => {
            const u = res.currentUser;
            if (u) {
                // Final Sync before logout
                u.xp = res.userXP;
                this._syncUserToBackend(u);
            }
            chrome.storage.local.remove(['currentUser', 'userXP', 'userLevel'], () => {
                if (callback) callback();
            });
        });
    },

    // --- SYNC FUNCTIONS ---

    syncSettings: function (newSettings) {
        chrome.storage.local.get(['currentUser'], (res) => {
            const user = res.currentUser;
            if (user) {
                // Update local obj too
                user.settings = { ...user.settings, ...newSettings };
                this._syncUserToBackend(user);
            }
        });
    },

    syncState: function () {
        chrome.storage.local.get(['currentUser', 'userXP', 'userLevel', 'pendingXPSync'], (res) => {
            if (res.currentUser) {
                const u = res.currentUser;
                u.xp = res.userXP;
                u.level = res.userLevel;
                // Only sync if needed usually, but we force sync for robustness now
                this._syncUserToBackend(u);
                chrome.storage.local.set({ pendingXPSync: false });
            }
        });
    },

    syncReports: function () {
        chrome.storage.local.get(['reportedSites'], (result) => {
            let reports = result.reportedSites || [];
            reports.forEach(r => {
                if (!r.synced) {
                    fetch(`${API_BASE}/reports`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(r)
                    }).then(() => {
                        console.log("Report Synced:", r.url);
                        // Mark synced could involve updating local storage again
                        // For simplicity, we assume success
                    }).catch(e => console.error(e));
                }
            });
        });
    },

    // For Admin: Fetch Global Reports
    getGlobalReports: function (callback) {
        fetch(`${API_BASE}/reports`)
            .then(res => res.json())
            .then(data => callback(data))
            .catch(err => {
                console.error("Fetch Global Reports Failed", err);
                chrome.storage.local.get(['reportedSites'], r => callback(r.reportedSites || []));
            });
    },

    // For Admin/Dashboard: Fetch Global Users (Synced)
    getUsers: function (callback) {
        fetch(`${API_BASE}/users/global-sync?t=${Date.now()}`)
            .then(res => res.json())
            .then(data => {
                // PROTECTION: If Server Wipe detected (empty list), DO NOT overwrite local cache
                if (!data || data.length === 0) {
                    console.warn("[Auth] Server returned 0 users (Potential Wipe). Preserving local cache.");
                    chrome.storage.local.get(['users'], r => callback(r.users || []));
                    return;
                }

                // Normal Update
                chrome.storage.local.set({ users: data });
                callback(data);
            })
            .catch(err => {
                console.error("Fetch Global Users Failed", err);
                chrome.storage.local.get(['users'], r => callback(r.users || []));
            });
    },

    checkSession: function (callback) {
        chrome.storage.local.get(['currentUser'], (r) => callback(r.currentUser || null));
    },

    updateProfile: function (email, data, callback) {
        chrome.storage.local.get(['currentUser'], (res) => {
            let u = res.currentUser;
            if (u && u.email === email) {
                Object.assign(u, data);
                // Sync
                this._syncUserToBackend(u);
                // Local
                chrome.storage.local.set({ currentUser: u });
                callback({ success: true, user: u });
            } else {
                callback({ success: false, message: "User session error" });
            }
        });
    },

    deleteAccount: function (email, callback) {
        fetch(`${API_BASE}/users/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        }).then(() => {
            chrome.storage.local.remove(['currentUser', 'userXP', 'userLevel'], () => callback({ success: true }));
        });
    },

    // --- PASSWORD RESET ---
    sendResetCode: function (email, callback) {
        // reuse existing send-otp endpoint
        fetch(`${API_BASE}/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    callback({ success: true });
                } else {
                    callback({ success: false, message: data.message });
                }
            })
            .catch(err => callback({ success: false, message: "Network Error" }));
    },

    confirmReset: function (email, otp, newPassword, callback) {
        // 1. Verify OTP first
        fetch(`${API_BASE}/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    // 2. If valid, update password
                    this._updatePasswordBackend(email, newPassword, callback);
                } else {
                    callback({ success: false, message: "Invalid Code" });
                }
            })
            .catch(err => callback({ success: false, message: "Verification Failed" }));
    },

    _updatePasswordBackend: function (email, password, callback) {
        fetch(`${API_BASE}/users/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    // Update verification logic locally if user happens to be logged in (unlikely for forgot pass)
                    callback({ success: true });
                } else {
                    callback({ success: false, message: data.message });
                }
            })
            .catch(err => callback({ success: false, message: "Update Failed" }));
    }
};

// Expose globally
if (typeof window !== 'undefined') {
    window.Auth = Auth;
}
