# Oculus Development Prompts

This document contains a curated list of **50 Detailed Technical Prompts** used to build, refine, and deploy the Oculus (formerly PhishingShield) project. These prompts cover the entire development lifecycle, from initialization to final polish.

---

## 🏗️ Phase 1: Foundation & Core Engines

1.  **Project Shell**: "Initialize a new Chrome Extension project called 'Oculus'. I need a Manifest V3 `manifest.json` configured with permissions for `storage`, `tabs`, `activeTab`, `scripting`, and `host_permissions` for `<all_urls>`. Create the basic directory structure (`js/`, `css/`, `images/`, `api/`) and empty files for `background.js`, `content.js`, and `popup.html`."
2.  **Risk Engine Logic**: "Create a `RiskEngine` class in `js/risk_engine.js`. It needs three methods: `calculateEntropy(url)` to detect random-looking strings, `isTyposquat(domain)` which uses Levenshtein distance to check against a hardcoded list of top 50 banks (e.g., chase, paypal), and `detectSuspiciousTLD(domain)` to flag TLDs like `.xyz` or `.top`. Export this class so it can be used in the content script."
3.  **Chameleon Engine**: "I need a 'Visual DNA' scanner called `Chameleon` in `js/chameleon.js`. It should access the DOM and extract the dominant background color and check for specific keywords like 'Login', 'Password', or 'Verify'. If the page uses Facebook's hex color `#1877F2` but the `window.location.hostname` is NOT `facebook.com`, it should return a `{ risk: 100, type: 'CLONE' }` object."
4.  **Backend Infrastructure**: "Set up a robust Node.js Express server in the `api/` folder. Configure `dotenv` for environment variables and `mongoose` to connect to a MongoDB Atlas cluster. Create a standardized error handling middleware and a CORS configuration that only allows requests from the Chrome Extension ID."
5.  **Auth System**: "Build a secure authentication system. Create a Mongoose User Schema with `email`, `password` (hashed), and `xp`. Implement `/api/register` and `/api/login` endpoints. Login should verify the password with `bcrypt` and return a JWT signed with `process.env.JWT_SECRET`."

## 🤖 Phase 2: AI Intelligence Integration

6.  **Gemini AI Service**: "Create a module `api/ai_service.js`. Implement a function `analyzeWithGemini(url, pageText)` that constructs a prompt for the Google Gemini 1.5 Flash API. The prompt should be: 'Analyze this webpage content for phishing indicators, urgency, or credential theft. URL: ${url}. Content: ${text}. Return JSON: { suspicious: boolean, score: 0-100, reason: string }'."
7.  **AI Fallback Controller**: "Enhance the AI service with a fallback mechanism. Wrap the main `analyzePage` function in a try-catch block. If the Gemini API call fails or times out (>3s), catch the error and immediately call `analyzeWithGroq` (using Llama-3-70b) instead. Ensure the final returned JSON structure is identical regardless of which model answered."
8.  **Smart Caching**: "We are hitting the AI API too often. Implement a caching system in `background.js`. Before requesting a new scan, check `chrome.storage.local` for a key matching the current URL. If a record exists and is less than 24 hours old, return the cached risk score instead of making a network request."
9.  **Interception Overlay**: "Create a blocking mechanism in `content.js`. If the AI returns a `riskScore > 75`, immediately hide the page body (`display: none`) and inject an `<iframe>` pointing to `chrome.runtime.getURL('warning.html')`. Pass the `reason` and `url` as query parameters to the warning page."

## 🎮 Phase 3: Gamification & User Progression

10. **Leveling Algorithm**: "Implement the XP logic in a shared utility file. The formula is `Level = Math.floor(Math.sqrt(totalXP / 100)) + 1`. Create a function `addXP(userEmail, amount)` in the backend that updates the user's XP, checks if they leveled up, and if so, returns `{ newLevel: X, levelUp: true }` in the response."
11. **Feature Gating**: "In `content.js`, I want to conditionally run features based on user level. Wrap the QR Scanner initialization in an `if (userLevel >= 5)` check, and the Chameleon Engine in `if (userLevel >= 20)`. If the user is too low level, log a console message: 'Locked: Upgrade to Level X'."
12. **Leaderboard Endpoint**: "Create a `/api/leaderboard` GET endpoint. It should query the MongoDB User collection, sort by `xp` descending, limit to top 50 users, and project only the `name`, `level`, and `xp` fields (hide emails for privacy)."
13. **Dashboard UI**: "Build a `dashboard.html` that serves as the main user hub. It needs a 'My Progress' card showing a circular progress bar for the current level, and a 'Leaderboard' table that fetches data from the API and renders rows dynamically."
14. **Toast Notification System**: "Implement a custom graphical notification system in `content.js`. Create a function `showToast(title, message, icon)`. Use it to show a green 'Safe Site (+10 XP)' popup when visiting safe sites, and a gold 'LEVEL UP!' popup with a confetti CSS animation when a level threshold is crossed."

## 📷 Phase 4: Advanced Threat Detection

15. **QR Code Scanner**: "Integrate the `jsQR` library into `content.js`. Set up a `MutationObserver` to watch for new images added to the DOM. When an image loads, draw it to a hidden canvas and scan for QR data. If a URL is found, pass it to the `RiskEngine` to check for malicious domains."
16. **Download Interceptor**: "In `content.js`, add a capture event listener for all `click` events on links (`<a>`). If the `href` ends in `.exe`, `.msi`, or `.zip`, pause the event. Check the current page's Risk Score. If it's High (>50), show a browser confirmation dialog: 'Warning: The current site is suspicious. Do you really want to download ${filename}?'."
17. **Homograph Detection**: "Update the `RiskEngine` to detect Homograph attacks. Use a regex to check if the hostname contains non-ASCII characters (Punycode). If it does, AND it resolves to a visually similar string to a major brand (e.g., 'app1e.com' or Cyrillic characters), flag it as `CRITICAL_THREAT`."
18. **Fortress Mode Logic**: "Implement 'Fortress Mode' in `background.js`. Listen for `chrome.downloads.onCreated`. If `fortressMode` is enabled in storage, strictly cancel any download that isn't a PDF or Image, and show a notification: 'Download blocked by Fortress Mode'."

## 🛠️ Phase 5: Admin Portal & Reports

19. **Admin Dashboard Layout**: "Create `admin.html` with a reliable admin experience. It needs a sidebar with links to 'Dashboard', 'Reports', and 'Users'. The main view should show cards for 'Pending Reports', 'Total Bans', and 'System Health'. Protect this route so it redirects to login if no admin token is found."
20. **Reporting API**: "Create a `/api/reports` endpoint. It handles `POST` (create new report from extension) and `GET` (fetch all reports for admin). Reports should have `url`, `reason`, `reporterEmail`, `status` (pending/banned/safe), and `timestamp`."
21. **Ban List Synchronization**: "Implement a 'Dynamic Rules' system. In `background.js`, on `runtime.onStartup`, fetch the list of Banned URLs from `/api/reports/banned`. Use `chrome.declarativeNetRequest.updateDynamicRules` to block these domains at the network level."
22. **Admin Auth Middleware**: "Create a middleware `isAdmin` in the backend. It should verify the JWT token and check if `user.role === 'admin'`. Apply this middleware to critical routes like `DELETE /userid` and `PATCH /report/status`."

## 🌐 Phase 6: UI/UX & Brand Identity

23. **Dark Mode Toggle**: "The dashboard needs a theme switcher. Create a button that toggles a `dark-theme` class on the `<body>`. In CSS, use CSS variables for everything: `--bg-color: #ffffff` vs `--bg-color: #1a1a1a`. Persist the user's choice in `chrome.storage.local`."
24. **Rebranding Execution**: "Perform a full rebrand from 'PhishingShield' to 'Oculus'. Regex replace the name in all HTML files, update the `<title>` tags, rewrite the `manifest.json` name, and rename the root folder if necessary. Ensure the API health check message also says 'Oculus Security API'."
25. **Landing Page Redesign**: "Transform `index.html` into a conversion-focused landing page. It needs a Hero section with a gradient headline 'Install Oculus', a 'Features' grid showcasing AI/QR/Antivirus, and a 'Live Threats' counter."
26. **Installation Experience**: "Users are struggling to install the unpacked extension. Add a visually distinct 'Installation Guide' block to `index.html`. It should list 4 clear steps: Download ZIP, Unzip, Enable Developer Mode, Load Unpacked. Add a 'Download ZIP' button that links directly to the repo archive."

## 🚀 Phase 7: Deployment & Serverless Config

27. **Vercel Configuration**: "I need to deploy the Express backend to Vercel. Create a `vercel.json` file. Configure it to route `/api/(.*)` to `api/index.js` and have the root `/` serve the static `index.html` file. ensure `builds` configuration is modern (or removed) to avoid 404s."
28. **Environment Security**: "Set up the environment variables. Create a `.env.example` file listing `GEMINI_API_KEY`, `GROQ_API_KEY`, `MONGODB_URI`, and `JWT_SECRET`. Explain in the README how to set these up in the Vercel Project Settings."
29. **Build Optimization**: "Create a `build.js` script using `esbuild` or `terser`. It should minify `content.js` and `background.js` into a `dist/` folder to reduce the extension package size and obfuscate the logic slightly."
30. **Uptime Monitoring**: "Add a simple `/health` GET endpoint to `api/index.js` that returns a 200 OK and a timestamp. I will use this with UptimeRobot to ensure the API doesn't go to sleep or crash."

## 🧪 Phase 8: Testing & Validation

31. **Risk Engine Unit Tests**: "Write a Jest test suite `tests/risk.test.js`. Test cases: `isTyposquat('google.com')` should be false, `isTyposquat('gooogle.com')` should be true. `calculateEntropy` should return a higher number for random strings like `a8j291l.com`."
32. **Phishing Simulation Page**: "Create a standalone HTML file `tests/phishing_sim.html`. It should contain common phishing phrases like 'Urgent Action Required' and 'Verify your Password'. Use this to manually verify that the AI analysis correctly flags the page content."
33. **Malicious QR Test**: "Generate a test file `tests/qr_danger.html`. Use a QR generator library to create a QR code pointing to a known suspicious URL (e.g., a typosquat). Open this page and verify that the extension's QR scanner detects it and shows the Red Overlay."
34. **Performance Profiling**: "The content script runs on every page load. Optimize `content.js` so `RiskEngine` runs inside a `requestIdleCallback`. Ensure the scanning loop doesn't block the main thread for more than 50ms."

## 🔧 Phase 9: Debugging & Fixes

35. **Fixing Vercel 404s**: "The Vercel deployment gives a 404 on the root page. Modify `vercel.json` to explicitly rewrite `source: '/'` to `destination: '/index.html'`. Remove the legacy `builds` array as it conflicts with Vercel's auto-detection."
36. **Admin Login Routing**: "The Admin login page is failing. It's trying to POST to `/auth/admin/login`, but that route doesn't exist. Update `admin-login.js` to use the standard `/api/users/login` endpoint, but add a client-side check to verify the returned user has admin privileges."
37. **Data Sync Conflict**: "There's a bug where local data overwrites admin edits. In `dashboard.js`, before pushing local XP to the server, compare the `lastUpdated` timestamp. Only push if local time > server time. Otherwise, pull the server data."
38. **Admin Account Restoration**: "I deleted the admin user by accident. Write a temporary script or `curl` command to POST to `/api/users/create` and regenerate the user `admin@oculus.com` with `level: 100` and `role: 'admin'`."

## 📦 Phase 10: Final Polish & Release

39. **Manifest Cleanup**: "Prepare for the Web Store. Review `manifest.json`. Remove `unsafe-eval` from CSP. Ensure all icons (`16`, `48`, `128`) are present. Verify that the 'description' field accurately reflects the current feature set."
40. **Documentation**: "Write a professional `README.md`. It should have specific sections: 'Features', 'Installation', 'Development Setup', 'API Documentation', and 'Testing'. Include screenshots of the Dashboard and the Warning Page."
41. **Demo Accessibility**: "For the demo judges, add the Admin credentials (`rajkumarpadhy2006@gmail.com`) directly to the Hero section of `index.html`. Style it in a yellow 'Access Box' so they don't miss it."
42. **Unlocking Features**: "We need to show off everything today. In `content.js`, temporarily comment out the `if (level >= 5)` checks. Hardcode `enableQR = true` and `enableChameleon = true` so the demo runs smoothly without grinding XP."
43. **Version Management**: "Bump the version number in `manifest.json` and `package.json` to `2.0.0` to verify that the update system works. Tag a new release in Git."
44. **Privacy Policy**: "Create `privacy.html`. State clearly that Oculus analyzes URLs locally and via AI for security purposes only, and does not sell or store personal browsing history permanently."
45. **Graphic Assets**: "Generate a set of promotional images. I need a 'Promotional Tile' (440x280) and a 'Screenshot' (1280x800) for the Web Store listing. Use the `generate_image` tool to create a mock UI if needed."
46. **Network Reliability**: "Implement exponential backoff in `background.js` for API calls. If the server returns 500 or timeout, retry after 1s, then 2s, then 4s, up to 3 times before giving up."
47. **Browser Compatibility**: "Check compatibility with Brave and Edge. Ensure that `chrome.runtime` calls are polyfilled or compatible with the `browser` namespace if we want to support Firefox later."
48. **Feedback Mechanism**: "Add a 'False Positive' report button on the warning overlay. When clicked, it should send the URL to a special `/api/feedback` endpoint so we can whitelist it manually."
49. **Persistent Login**: "Ensure the user stays logged in. On browser startup (`runtime.onStartup`), check for a stored JWT token. Verify it against `/api/auth/verify`. If valid, restore the user session state."
50. **Code Cleanup**: "Run a final linting pass. Remove `console.log` statements from production code (except validation errors). Ensure indentation is consistent (4 spaces) across all JS and HTML files."
