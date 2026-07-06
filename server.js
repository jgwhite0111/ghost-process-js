/* ============================================================
   GHOST//PROCESS — static + story API + ink API server
   Replaces python -m http.server. Adds:
     GET  /api/story         — read story.json
     PUT  /api/story         — validate + atomic-write story.json
     GET  /api/ink/<path>    — read .ink file (path under ink/)
     PUT  /api/ink/<path>    — atomic-write .ink file
     POST /api/assets        — multipart upload, saves under assets/
   Everything else is served as static files from this dir.
   Bound to 0.0.0.0:8765 so Tailscale works.
   ============================================================ */
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const ROOT          = __dirname;
const PORT          = parseInt(process.env.PORT, 10) || 8765;
const STORY_PATH    = path.join(ROOT, 'story.json');
const INK_DIR       = path.join(ROOT, 'ink');
const ASSETS_DIR    = path.join(ROOT, 'assets');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ limit: '512kb' }));

// ---------- GET /api/story ----------
app.get('/api/story', (_req, res) => {
    try {
        const raw = fs.readFileSync(STORY_PATH, 'utf8');
        res.type('application/json').send(raw);
    } catch (err) {
        res.status(500).json({ error: `Could not read story.json: ${err.message}` });
    }
});

// ---------- PUT /api/story ----------
app.put('/api/story', (req, res) => {
    const story = req.body;
    const err = validateStory(story);
    if (err) return res.status(400).json({ error: err });
    atomicWrite(STORY_PATH, JSON.stringify(story, null, 2) + '\n', res);
});

// ---------- GET /api/ink/<path> ----------
// Path is URL-encoded. The .ink files live under ink/. URL convention allows
// either /api/ink/<filename> or /api/ink/ink/<filename> (matches how story.json
// stores the path); strip any leading "ink/" prefix before resolving.
app.get('/api/ink/:path(*)', (req, res) => {
    let p = req.params.path;
    if (p.startsWith('ink/')) p = p.slice(4);
    const fp = safeJoin(INK_DIR, p);
    if (!fp) return res.status(400).json({ error: 'invalid path' });
    fs.readFile(fp, 'utf8', (err, data) => {
        if (err) return res.status(404).json({ error: err.message });
        res.type('text/plain').send(data);
    });
});

// ---------- PUT /api/ink/<path> ----------
app.put('/api/ink/:path(*)', (req, res) => {
    let p = req.params.path;
    if (p.startsWith('ink/')) p = p.slice(4);
    const fp = safeJoin(INK_DIR, p);
    if (!fp) return res.status(400).json({ error: 'invalid path' });
    const text = typeof req.body === 'string' ? req.body : '';
    atomicWrite(fp, text, res);
});

// ---------- POST /api/assets ----------
const upload = multer({
    storage: multer.diskStorage({
        destination: ASSETS_DIR,
        filename: (req, file, cb) => {
            const safe = (req.body.name || file.originalname)
                .replace(/[^A-Za-z0-9._-]/g, '_')
                .slice(0, 80);
            cb(null, safe);
        }
    }),
    limits: { fileSize: 8 * 1024 * 1024 }
});
app.post('/api/assets', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    res.json({
        ok: true,
        name: req.file.filename,
        path: `assets/${req.file.filename}`
    });
});

// ---------- GET /api/list?dir=<path> ----------
// Returns JSON array of filenames in the given directory (relative to ROOT).
// Path is resolved with safeJoin — refuses to escape ROOT.
app.get('/api/list', (req, res) => {
    const dir = req.query.dir;
    if (typeof dir !== 'string') return res.status(400).json({ error: 'dir query param required' });
    const fp = safeJoin(ROOT, dir);
    if (!fp) return res.status(400).json({ error: 'invalid path' });
    fs.readdir(fp, { withFileTypes: true }, (err, entries) => {
        if (err) return res.status(404).json({ error: err.message });
        const files = entries
            .filter(e => e.isFile())
            .map(e => e.name)
            .sort();
        res.json(files);
    });
});

// ---------- Static files ----------
app.use(express.static(ROOT, {
    extensions: ['html'],
    setHeaders: (res, p) => {
        // Source JS + story + ink + assets get no-cache so a fresh edit lands without hard refresh.
        const rel = p.replace(/^.*\/+/, '');
        if (rel === 'story.json' || p.includes('/ink/') ||
            p.includes('/src/') || p.includes('/runtime/') ||
            p.includes('/assets/') || rel === 'boot.js') {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// ---------- Helpers ----------
function atomicWrite(filePath, content, res) {
    const tmp = filePath + '.tmp.' + crypto.randomBytes(4).toString('hex');
    try {
        fs.writeFileSync(tmp, content, 'utf8');
        fs.renameSync(tmp, filePath);
        res.json({ ok: true, ts: Date.now() });
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (_) {}
        res.status(500).json({ error: `Could not write ${path.basename(filePath)}: ${e.message}` });
    }
}

// Resolve `relativePath` against `baseDir` and ensure the result
// stays inside `baseDir` (prevents `../` escape).
function safeJoin(baseDir, relativePath) {
    const fp = path.normalize(path.join(baseDir, relativePath));
    const base = path.normalize(baseDir + path.sep);
    if (!fp.startsWith(base)) return null;
    return fp;
}

function validateStory(s) {
    if (!s || typeof s !== 'object') return 'story must be an object';
    if (typeof s.start !== 'string') return 'story.start must be a string';
    if (!s.scenes || typeof s.scenes !== 'object') return 'story.scenes must be an object';
    if (!s.scenes[s.start]) return `story.start references missing scene "${s.start}"`;
    for (const [id, sc] of Object.entries(s.scenes)) {
        if (sc.id && sc.id !== id) return `scene key "${id}" has id "${sc.id}" (must match key)`;
        if (!['ink', 'choice', 'end', 'title'].includes(sc.kind)) {
            return `scene "${id}" has invalid kind "${sc.kind}" (must be ink|choice|end|title)`;
        }
        if (!Array.isArray(sc.hitboxes)) return `scene "${id}" hitboxes must be an array`;
        if (sc.ink && typeof sc.ink !== 'string') return `scene "${id}" ink must be a string path`;
    }
    return null;
}

// ---------- Listen ----------
app.listen(PORT, '0.0.0.0', () => {
    console.log(`ghost-process-js listening on http://0.0.0.0:${PORT}`);
    console.log(`  game:    http://0.0.0.0:${PORT}/index.html`);
    console.log(`  editor:  http://0.0.0.0:${PORT}/editor.html`);
});