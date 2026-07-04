// tools/vendor-deps.js — fetch Phaser + InkJS into vendor/ (no CDN)
//
// Usage: node tools/vendor-deps.js
//
// Downloads:
//   vendor/phaser.min.js  (Phaser 3.80.x)
//   vendor/ink-full.js    (InkJS 2.x — full bundle with Compiler for client-side compile)
//
// Why vendored: Tailscale-local server can't reach a CDN reliably,
// and we want offline-first development.

const https = require('https');
const fs = require('fs');
const path = require('path');

const VENDOR_DIR = path.join(__dirname, '..', 'vendor');
fs.mkdirSync(VENDOR_DIR, { recursive: true });

// jsdelivr serves npm packages at /npm/<name>@<version>/<file>.
const PHASER_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';
const INKJS_URL  = 'https://cdn.jsdelivr.net/npm/inkjs@2.2.0/dist/ink-full.js';

const downloads = [
    { url: PHASER_URL, dest: path.join(VENDOR_DIR, 'phaser.min.js'), name: 'Phaser 3.80.1' },
    { url: INKJS_URL,  dest: path.join(VENDOR_DIR, 'ink-full.js'),   name: 'InkJS 2.2.0 (full + Compiler)' }
];

function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetch(res.headers.location).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

(async () => {
    for (const dl of downloads) {
        process.stdout.write(`Fetching ${dl.name}... `);
        try {
            const buf = await fetch(dl.url);
            fs.writeFileSync(dl.dest, buf);
            console.log(`${(buf.length / 1024).toFixed(1)} KB → ${dl.dest}`);
        } catch (err) {
            console.log(`FAILED: ${err.message}`);
            process.exitCode = 1;
        }
    }
    if (process.exitCode) {
        console.log('\nSome downloads failed. Re-run or check your network.');
    } else {
        console.log('\nAll deps vendored. Run `npm start` to boot.');
    }
})();
