
// GLOBAL MAP STATE
let globeInstance = null;
let mapInitialized = false;

function initThreatMap() {
    if (mapInitialized) return;
    mapInitialized = true;

    console.log("Initializing Global Threat Map...");

    // 1. Generate Fake Data (Simulate Global Attacks)
    // Red: Attackers (CN, RU, NK, Eastern Europe)
    // Green: Victims (User Locations - US, IN, EU)
    const N = 80;
    const arcsData = [...Array(N).keys()].map(() => ({
        startLat: (Math.random() - 0.5) * 180,
        startLng: (Math.random() - 0.5) * 360,
        endLat: (Math.random() - 0.5) * 160,
        endLng: (Math.random() - 0.5) * 360,
        color: ['#ef4444', '#dc2626', '#b91c1c'][Math.round(Math.random() * 2)]
    }));

    // High Traffic "Hotspots" (Hex Bins)
    const weightData = [...Array(300).keys()].map(() => ({
        lat: (Math.random() - 0.5) * 180,
        lng: (Math.random() - 0.5) * 360,
        weight: Math.random()
    }));

    // 2. Initialize Globe
    const elem = document.getElementById('globe-container');

    // Auto-Rotate
    globeInstance = Globe()(elem)
        .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
        .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
        .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
        .arcsData(arcsData)
        .arcColor('color')
        .arcDashLength(0.4)
        .arcDashGap(2)
        .arcDashInitialGap(() => Math.random())
        .arcDashAnimateTime(1500 + Math.random() * 2000) // Varied speeds
        .arcStroke(0.6)
        .hexBinPointsData(weightData)
        .hexBinPointWeight('weight')
        .hexBinResolution(4)
        .hexBinMerge(true)
        .enablePointerInteraction(true);

    // Initial Controls
    globeInstance.controls().autoRotate = true;
    globeInstance.controls().autoRotateSpeed = 0.5;

    // 3. Live Ticker Logic
    const ticker = document.getElementById('map-ticker');
    const nodesEl = document.getElementById('map-nodes');
    const rateEl = document.getElementById('map-rate');

    // Stats
    nodesEl.textContent = "1,492";
    rateEl.textContent = "420"; // Blazing fast ;)

    // Fake Ticker Updates
    const attackTypes = ["SQL Injection", "XSS Payload", "Phishing Attempt", "Credential Stuffing", "Botnet Probe"];
    const locations = ["Beijing, CN", "Moscow, RU", "Pyongyang, KP", "Lagos, NG", "Dallas, US", "Mumbai, IN"];

    setInterval(() => {
        // Update Count
        let current = parseInt(nodesEl.textContent.replace(/,/g, ''));
        nodesEl.textContent = (current + Math.floor(Math.random() * 5)).toLocaleString();

        // Update Rate
        let rate = parseInt(rateEl.textContent);
        rateEl.textContent = rate + Math.floor(Math.random() * 10 - 3); // Fluctuate

        // Update Text
        const type = attackTypes[Math.floor(Math.random() * attackTypes.length)];
        const loc = locations[Math.floor(Math.random() * locations.length)];
        const ip = `192.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.X`;

        ticker.textContent = `⚠️ ALERT: ${type} detected from ${loc} [${ip}] ... BLOCKING ... STATUS: SECURE ... 🛡️ Oculus Defense Active ...`;
    }, 2000);
}
