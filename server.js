/* ============================================================
   GHOST//PROCESS — static + story API + ink API server
   Replaces python -m http.server. Adds:
     GET  /api/story         — read story.json
     PUT  /api/story         — validate + atomic-write story.json
     GET  /api/ink/<path>    — read .ink file (path under ink/)
     PUT  /api/ink/<path>    — atomic-write .ink file
     POST /api/assets        — multipart upload, saves under assets/
   Everything else is served as static files from this dir.
   Defaults to loopback. Non-loopback binds require EDITOR_TOKEN.
   ============================================================ */
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const ROOT             = __dirname;
const DEFAULT_HOST     = '127.0.0.1';
const DEFAULT_PORT     = 8765;
const MIN_TOKEN_LENGTH = 16;
const SCENE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const STORY_PATH       = path.join(ROOT, 'story.json');
const INK_DIR          = path.join(ROOT, 'ink');
const ASSETS_DIR       = path.join(ROOT, 'assets');

function createApp(config = getServerConfig({})) {
const app = express();
const mutationGuard = createMutationGuard(config);
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
app.put('/api/story', mutationGuard, (req, res) => {
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
app.put('/api/ink/:path(*)', mutationGuard, (req, res) => {
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
app.post('/api/assets', mutationGuard, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    let provenancePath = null;
    if (req.body.provenance) {
        try {
            const provenance = JSON.parse(req.body.provenance);
            provenancePath = `${req.file.path}.prompt.json`;
            fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + '\n');
        } catch (err) {
            return res.status(400).json({ error: `invalid provenance: ${err.message}` });
        }
    }
    res.json({
        ok: true,
        name: req.file.filename,
        path: `assets/${req.file.filename}`,
        provenance: provenancePath ? `assets/${path.basename(provenancePath)}` : null
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
        // Source JS + CSS + story + ink + assets + index.html get
        // no-cache so a fresh edit lands without a hard refresh.
        // Without this, Chrome happily serves a stale styles.css for
        // 304 roundtrips and CSS-only fixes look like nothing changed.
        const rel = p.replace(/^.*\/+/, '');
        if (rel === 'story.json' || p.includes('/ink/') ||
            p.includes('/src/') || p.includes('/runtime/') ||
            p.includes('/assets/') || rel === 'boot.js' ||
            rel === 'styles.css' || rel === 'index.html') {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

return app;
}

// ---------- Helpers ----------
function isLoopbackHost(host) {
    const normalized = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function getServerConfig(env = process.env) {
    const host = typeof env.HOST === 'string' && env.HOST.trim()
        ? env.HOST.trim()
        : DEFAULT_HOST;
    const port = parseInt(env.PORT, 10) || DEFAULT_PORT;
    const editorToken = typeof env.EDITOR_TOKEN === 'string' ? env.EDITOR_TOKEN : '';
    const requireEditorToken = !isLoopbackHost(host);

    if (requireEditorToken &&
        (editorToken.length < MIN_TOKEN_LENGTH || editorToken.trim().length < MIN_TOKEN_LENGTH)) {
        throw new Error(
            `Refusing non-loopback HOST "${host}": EDITOR_TOKEN must be a non-whitespace secret of at least ${MIN_TOKEN_LENGTH} characters`,
        );
    }

    return { host, port, editorToken, requireEditorToken };
}

function requestOriginMatchesHost(req) {
    const origin = req.get('origin');
    if (origin === undefined) return true;

    const requestHost = req.get('host');
    if (typeof origin !== 'string' || typeof requestHost !== 'string') return false;
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            parsed.host.toLowerCase() === requestHost.trim().toLowerCase();
    } catch (_) {
        return false;
    }
}

function secureTokenEqual(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string') return false;
    const actualDigest = crypto.createHash('sha256').update(actual, 'utf8').digest();
    const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return actual.length === expected.length && crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function createMutationGuard(config) {
    return function guardMutation(req, res, next) {
        if (!requestOriginMatchesHost(req)) {
            return res.status(403).json({ error: 'Request Origin does not match the request Host' });
        }
        if (config.requireEditorToken &&
            !secureTokenEqual(req.get('x-editor-token'), config.editorToken)) {
            return res.status(401).json({ error: 'Missing or invalid editor token' });
        }
        return next();
    };
}

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

function validateFiniteNumber(object, key, propertyPath) {
    if (!object || typeof object !== 'object' ||
        !Object.prototype.hasOwnProperty.call(object, key)) return null;
    if (typeof object[key] !== 'number' || !Number.isFinite(object[key])) {
        return `${propertyPath} must be a finite number`;
    }
    return null;
}

const OVERLAY_TYPES = new Set(['container', 'image', 'text', 'hotspot']);
const OVERLAY_ACTIONS = new Set(['giveItem', 'goToScene', 'openInk', 'setView']);
const OVERLAY_CONTENT_SOURCES = new Set(['literal', 'inkLines', 'inkChoices']);
const OVERLAY_TAG_PRESETS = new Set(['default', 'heading', 'warning', 'success', 'dim', 'divider']);
const OVERLAY_CONTROL_PRESETS = new Set(['default', 'terminal-command']);
const OVERLAY_EVENTS = new Set(['activate', 'choiceSelected']);

function getSceneInkKnots(scene) {
    if (typeof scene?.ink !== 'string' || !scene.ink.trim()) return null;
    const filePath = safeJoin(ROOT, scene.ink);
    if (!filePath || !filePath.startsWith(path.normalize(INK_DIR + path.sep)) || !fs.existsSync(filePath)) return null;
    const knots = new Set();
    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(/^\s*===\s*([A-Za-z_][A-Za-z0-9_]*)\s*===\s*$/gm)) knots.add(match[1]);
    return knots;
}

function validateOverlay(scene, sceneId, story) {
    if (!Object.prototype.hasOwnProperty.call(scene, 'overlay')) return null;
    const scenePath = `story.scenes[${JSON.stringify(sceneId)}]`;
    const overlay = scene.overlay;
    if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) return `${scenePath}.overlay must be an object`;
    for (const key of ['designWidth', 'designHeight']) {
        if (!Object.prototype.hasOwnProperty.call(overlay, key)) return `${scenePath}.overlay.${key} is required`;
        const error = validateFiniteNumber(overlay, key, `${scenePath}.overlay.${key}`);
        if (error) return error;
        if (overlay[key] <= 0) return `${scenePath}.overlay.${key} must be greater than zero`;
    }
    if (scene.bgFit !== undefined && !['cover', 'contain'].includes(scene.bgFit)) return `${scenePath}.bgFit must be cover or contain`;
    if (scene.hud !== undefined && (!scene.hud || typeof scene.hud !== 'object' || typeof scene.hud.inventory !== 'boolean')) return `${scenePath}.hud must be an object with boolean inventory`;
    if (overlay.views !== undefined) {
        if (!Array.isArray(overlay.views) || overlay.views.some(v => typeof v !== 'string' || !v.trim())) return `${scenePath}.overlay.views must be an array of non-empty strings`;
        if (new Set(overlay.views).size !== overlay.views.length) return `${scenePath}.overlay.views contains duplicate view names`;
        if (overlay.initialView !== undefined && !overlay.views.includes(overlay.initialView)) return `${scenePath}.overlay.initialView references missing view "${overlay.initialView}"`;
    } else if (overlay.initialView !== undefined) return `${scenePath}.overlay.initialView requires overlay.views`;
    if (!Array.isArray(overlay.elements)) return `${scenePath}.overlay.elements must be an array`;

    const inkKnots = getSceneInkKnots(scene);
    const byId = new Map();
    for (let index = 0; index < overlay.elements.length; index++) {
        const el = overlay.elements[index];
        const p = `${scenePath}.overlay.elements[${index}]`;
        if (!el || typeof el !== 'object' || Array.isArray(el)) return `${p} must be an object`;
        if (typeof el.id !== 'string' || !el.id.trim()) return `${p}.id must be a non-empty string`;
        if (byId.has(el.id)) return `${p}.id duplicates overlay element "${el.id}"`;
        byId.set(el.id, el);
        if (!OVERLAY_TYPES.has(el.type)) return `${p}.type "${el.type}" is unsupported`;
        for (const key of ['x', 'y', 'w', 'h']) {
            if (!Object.prototype.hasOwnProperty.call(el, key)) return `${p}.${key} is required`;
            const error = validateFiniteNumber(el, key, `${p}.${key}`);
            if (error) return error;
            if (el[key] < 0 || el[key] > 1) return `${p}.${key} must be between 0 and 1`;
        }
        if (el.w <= 0 || el.h <= 0) return `${p}.w and ${p}.h must be greater than zero`;
        if (el.parent !== undefined && (typeof el.parent !== 'string' || !el.parent.trim())) return `${p}.parent must be a non-empty element id`;
        for (const key of ['visibleIn', 'activeIn']) {
            if (el[key] !== undefined && (!Array.isArray(overlay.views) || !Array.isArray(el[key]) || el[key].some(v => typeof v !== 'string' || !overlay.views.includes(v)))) return `${p}.${key} contains an unknown view`;
            if (Array.isArray(el[key]) && new Set(el[key]).size !== el[key].length) return `${p}.${key} contains duplicate views`;
        }
        if (el.style !== undefined && (!el.style || typeof el.style !== 'object' || Array.isArray(el.style))) return `${p}.style must be an object`;
        if (el.content !== undefined) {
            if (!['container', 'text'].includes(el.type)) return `${p}.content is only supported on container or text elements`;
            if (!el.content || typeof el.content !== 'object' || Array.isArray(el.content)) return `${p}.content must be an object`;
            if (!OVERLAY_CONTENT_SOURCES.has(el.content.source)) return `${p}.content.source is unsupported`;
            if (['inkLines', 'inkChoices'].includes(el.content.source) && typeof scene.ink !== 'string') return `${p}.content.source ${el.content.source} requires a scene Ink file`;
            if (el.content.tagStyles !== undefined) {
                if (el.content.source !== 'inkLines' || !el.content.tagStyles || typeof el.content.tagStyles !== 'object' || Array.isArray(el.content.tagStyles)) return `${p}.content.tagStyles requires inkLines and must be an object`;
                for (const [tag, preset] of Object.entries(el.content.tagStyles)) {
                    if (!tag.trim() || typeof preset !== 'string' || !preset.trim()) return `${p}.content.tagStyles must map non-empty tags to non-empty presets`;
                    if (!OVERLAY_TAG_PRESETS.has(preset)) return `${p}.content.tagStyles.${tag} uses unsupported preset "${preset}"`;
                }
            }
            if (el.content.controlPreset !== undefined && (el.content.source !== 'inkChoices' || !OVERLAY_CONTROL_PRESETS.has(el.content.controlPreset))) return `${p}.content.controlPreset requires inkChoices and a supported preset`;
        }
        if (el.type === 'container' && el.clip !== undefined && typeof el.clip !== 'boolean') return `${p}.clip must be boolean`;
        if (el.type === 'image' && (typeof el.asset !== 'string' || !el.asset.startsWith('assets/'))) return `${p}.asset must be a project asset path`;
        if (el.type === 'text' && el.content?.source !== 'inkLines' && el.content?.source !== 'inkChoices' && typeof el.text !== 'string') return `${p}.text must be a string`;
        if (el.type === 'hotspot') {
            if (el.presentation !== undefined && !['inspect', 'control', 'invisible'].includes(el.presentation)) return `${p}.presentation is invalid`;
            if (el.label !== undefined && typeof el.label !== 'string') return `${p}.label must be a string`;
            if (!el.events || typeof el.events !== 'object' || Array.isArray(el.events)) return `${p}.events must be an object`;
        }
        if (el.events !== undefined) {
            for (const [eventName, event] of Object.entries(el.events)) {
                if (!OVERLAY_EVENTS.has(eventName)) return `${p}.events.${eventName} is unsupported`;
                if (eventName === 'choiceSelected' && el.content?.source !== 'inkChoices') return `${p}.events.choiceSelected requires inkChoices content`;
                if (eventName === 'activate' && el.type !== 'hotspot') return `${p}.events.activate requires a hotspot`;
                if (!event || typeof event !== 'object' || !Array.isArray(event.actions)) return `${p}.events.${eventName}.actions must be an array`;
                for (let actionIndex = 0; actionIndex < event.actions.length; actionIndex++) {
                    const action = event.actions[actionIndex];
                    const ap = `${p}.events.${eventName}.actions[${actionIndex}]`;
                    if (!action || typeof action !== 'object' || !OVERLAY_ACTIONS.has(action.type)) return `${ap}.type is unsupported`;
                    const field = action.type === 'giveItem' ? 'item' : action.type === 'goToScene' ? 'scene' : action.type === 'openInk' ? 'knot' : 'view';
                    if (typeof action[field] !== 'string' || !action[field].trim()) return `${ap}.${field} must be a non-empty string`;
                    if (action.type === 'giveItem' && !story.items?.[action.item]) return `${ap}.item references missing item "${action.item}"`;
                    if (action.type === 'goToScene' && !story.scenes?.[action.scene]) return `${ap}.scene references missing scene "${action.scene}"`;
                    if (action.type === 'setView' && !overlay.views?.includes(action.view)) return `${ap}.view references missing view "${action.view}"`;
                    if (action.type === 'openInk' && inkKnots && !inkKnots.has(action.knot)) return `${ap}.knot references missing Ink knot "${action.knot}"`;
                }
            }
        }
    }
    for (const [id, el] of byId) {
        if (el.parent !== undefined && !byId.has(el.parent)) return `${scenePath}.overlay element "${id}" references missing parent "${el.parent}"`;
        if (el.parent !== undefined && byId.get(el.parent).type !== 'container') return `${scenePath}.overlay element "${id}" parent "${el.parent}" is not a container`;
        const seen = new Set();
        let current = id;
        while (current) {
            if (seen.has(current)) return `${scenePath}.overlay contains a parent cycle at "${id}"`;
            seen.add(current);
            current = byId.get(current)?.parent;
        }
    }
    return null;
}

function validateStory(s) {
    if (!s || typeof s !== 'object') return 'story must be an object';
    if (Object.prototype.hasOwnProperty.call(s, 'recipes')) {
        return 'story.recipes is not supported';
    }
    if (typeof s.start !== 'string') return 'story.start must be a string';
    if (!s.scenes || typeof s.scenes !== 'object') return 'story.scenes must be an object';
    if (!s.scenes[s.start]) return `story.start references missing scene "${s.start}"`;
    let numericError = validateFiniteNumber(s, 'version', 'story.version');
    if (numericError) return numericError;
    for (const [id, sc] of Object.entries(s.scenes)) {
        const scenePath = `story.scenes[${JSON.stringify(id)}]`;
        if (!SCENE_ID_PATTERN.test(id)) {
            return `${scenePath} key must match /^[a-z][a-z0-9_]*$/`;
        }
        if (Object.prototype.hasOwnProperty.call(sc, 'id')) {
            if (typeof sc.id !== 'string' || !SCENE_ID_PATTERN.test(sc.id)) {
                return `${scenePath}.id must match /^[a-z][a-z0-9_]*$/`;
            }
            if (sc.id !== id) return `scene key "${id}" has id "${sc.id}" (must match key)`;
        }
        if (!['ink', 'choice', 'end', 'title', 'exploration'].includes(sc.kind)) {
            return `scene "${id}" has invalid kind "${sc.kind}" (must be ink|choice|end|title)`;
        }
        if (!Array.isArray(sc.hitboxes)) return `scene "${id}" hitboxes must be an array`;
        if (sc.ink && typeof sc.ink !== 'string') return `scene "${id}" ink must be a string path`;
        if (sc.kind === 'exploration') {
            if (!sc.exploration || typeof sc.exploration !== 'object') {
                return `${scenePath}.exploration must be an object`;
            }
            const exploration = sc.exploration;
            numericError = validateFiniteNumber(exploration, 'walkSpeed', `${scenePath}.exploration.walkSpeed`);
            if (numericError) return numericError;
            for (const [part, keys] of [['spawn', ['x', 'y']], ['walkableArea', ['x', 'y', 'w', 'h']]]) {
                if (!exploration[part] || typeof exploration[part] !== 'object') {
                    return `${scenePath}.exploration.${part} must be an object`;
                }
                for (const key of keys) {
                    numericError = validateFiniteNumber(exploration[part], key, `${scenePath}.exploration.${part}.${key}`);
                    if (numericError) return numericError;
                }
            }
        }
        if (Array.isArray(sc.tasks)) {
            for (let index = 0; index < sc.tasks.length; index++) {
                if (sc.tasks[index]?.type === 'combine') {
                    return `${scenePath}.tasks[${index}].type "combine" is not supported`;
                }
            }
        }

        numericError = validateFiniteNumber(sc, 'titleSizePct', `${scenePath}.titleSizePct`);
        if (numericError) return numericError;

        const musicEntries = Array.isArray(sc.music)
            ? sc.music.map((entry, index) => [entry, `${scenePath}.music[${index}]`])
            : [[sc.music, `${scenePath}.music`]];
        for (const [entry, entryPath] of musicEntries) {
            numericError = validateFiniteNumber(entry, 'fadeAt', `${entryPath}.fadeAt`);
            if (numericError) return numericError;
        }

        if (Array.isArray(sc.characters)) {
            for (let index = 0; index < sc.characters.length; index++) {
                const character = sc.characters[index];
                const characterPath = `${scenePath}.characters[${index}]`;
                for (const key of ['placementX', 'placementY', 'targetH']) {
                    numericError = validateFiniteNumber(character, key, `${characterPath}.${key}`);
                    if (numericError) return numericError;
                }
                if (character && typeof character.scenes === 'object' && character.scenes) {
                    for (const [overrideId, override] of Object.entries(character.scenes)) {
                        const overridePath = `${characterPath}.scenes[${JSON.stringify(overrideId)}]`;
                        numericError = validateFiniteNumber(override, 'fps', `${overridePath}.fps`);
                        if (numericError) return numericError;
                    }
                }
            }
        }

        for (let index = 0; index < sc.hitboxes.length; index++) {
            const hitbox = sc.hitboxes[index];
            const hitboxPath = `${scenePath}.hitboxes[${index}]`;
            for (const key of ['x', 'y', 'w', 'h']) {
                numericError = validateFiniteNumber(hitbox, key, `${hitboxPath}.${key}`);
                if (numericError) return numericError;
            }
        }
        const overlayError = validateOverlay(sc, id, s);
        if (overlayError) return overlayError;
    }
    return null;
}

// ---------- Listen ----------
if (require.main === module) {
    try {
        const config = getServerConfig(process.env);
        const app = createApp(config);
        app.listen(config.port, config.host, () => {
            const baseUrl = `http://${config.host}:${config.port}`;
            console.log(`ghost-process-js listening on ${baseUrl}`);
            console.log(`  game:    ${baseUrl}/index.html`);
            console.log(`  editor:  ${baseUrl}/editor.html`);
        });
    } catch (error) {
        console.error(`ghost-process-js startup refused: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = {
    createApp,
    createMutationGuard,
    getServerConfig,
    isLoopbackHost,
    validateOverlay,
    validateStory,
};
