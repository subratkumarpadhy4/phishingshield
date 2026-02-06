const https = require('https');

const url = "https://oculus-eight.vercel.app/api/trust/score?domain=google.com";

console.log(`Fetching ${url}...`);

https.get(url, (res) => {
    let data = '';

    console.log('Status Code:', res.statusCode);

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log('Body:', data);
        try {
            const json = JSON.parse(data);
            console.log('Parsed JSON:', json);
        } catch (e) {
            console.log('Failed to parse JSON');
        }
    });

}).on("error", (err) => {
    console.log("Error: " + err.message);
});
