// editor.js — Ghost//Process scene editor (vanilla JS)
//
// Loads story.json, renders the selected scene's background + sprites
// + hitboxes into the preview canvas, lets the user drag sprites to
// position them, drag-draw hitboxes, and edit scene/item metadata.
// Saves back to story.json via PUT /api/story.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const SCENE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const EDITOR_TOKEN_SESSION_KEY = 'ghost-process-editor-token';

// ---------- editor state ----------
const state = {
  story: null,
  sceneId: null,
  selected: null,
  bgImages: {},
  spriteFrames: {},          // { 'id/scene': HTMLImageElement } — currently displayed frame
  spriteFrameLists: {},      // { 'id/scene': [HTMLImageElement, ...] } — all frames
  spriteAnim: {},            // { 'id/scene': { idx, lastT, playing } } — playback state
  tool: 'select',
  dirty: false,
  // Viewport (canvas size in pixels — independent of on-screen CSS
  // scale). Defaults to DESKTOP 1280×720 because that's the
  // PlayStation-style window the desktop runtime renders at and
  // the one the user is most likely to be testing against. Mobile
  // is reachable via the viewport dropdown (Phone — 390×844).
  //
  // IMPORTANT: editor and runtime MUST agree on the meaning of
  // placement values. The runtime clamps out-of-range [0,1]
  // fraction values to canvasH / 0 (v0.2.27/v0.2.28 — see
  // src/runtime/sprites.js). The editor preview also clamps so
  // that what you see matches what the runtime will draw.
  vpW: 1280,
  vpH: 720,
  // Currently-active drag state. We never re-render the overlay
  // mid-drag; instead we mutate the handle element directly so pointer
  // events keep firing on it.
  drag: null, // { kind: 'move'|'resize', targetKind: 'sprite'|'hitbox', ref, handle, lastX, lastY, startX, startY }
};

// ---------- canvas ----------
const bgCanvas = $('#bg-canvas');
const bgCtx = bgCanvas.getContext('2d');
const overlay = $('#overlay');
const frame = $('#canvas-frame');

// ---------- snap-to-edge ----------
//
// User's request, in plain English:
//   "the top edge of the sprite box should snap to the top edge of
//    the viewport. The bottom edge of the sprite box should snap to
//    the bottom edge of the viewport. It's that simple."
//
// So the snap value for placementY depends on which edge we're
// snapping:
//
//   * BOTTOM edge:  placementY → 1.0  (sprite's BOTTOM at canvas bottom)
//   * TOP edge:     placementY → spriteH/vpH  (sprite's TOP at canvas top)
//
// Both snap zones have the same park-friendly width: within
// SNAP_PX pixels of cursor travel past the canvas edge, the
// Edge-resistance snap for the Y axis.
//
// placementY in this codebase is the sprite's BOTTOM-edge Y as a
// fraction of canvas height (NOT the centre — see placementYFor).
// placementX is the sprite's centre X as a fraction of canvas
// width. Both functions below respect that, so the result of
// snapping is exactly: sprite edge = canvas edge.
//
// snapY returns the snap-friendly edge value when the cursor is
// within SNAP_PX of an edge, and the raw value otherwise — even
// if the raw value is <0 or >1 (i.e. cursor parked past the
// canvas edge). The runtime does NOT clamp out-of-range values
// (v0.2.32+): the editor and the runtime both trust the saved
// value and the canvas clips naturally at its border, with a
// one-shot console warning. So the drag handle, the canvas
// preview, and the in-game render all read from the same
// placementX/placementY and disagree only at the canvas
// border — not with each other. Honest-about-position.
//
// placementY in this codebase is the sprite's BOTTOM-edge Y as a
// fraction of canvas height (NOT the centre — see placementYFor).
// placementX is the sprite's centre X as a fraction of canvas
// width. Both functions below respect that, so the result of
// snapping is exactly: sprite edge = canvas edge.
//
// NO spring-back, NO clamp, NO warp to adjacent edge. The snap
// only kicks in within SNAP_PX of the edge so the user gets a
// sticky feel when they're close to the edge but the value still
// tracks when they're far from it (in any direction, including
// past the edge).
//
// Edge selection by axis:
//   Y < 0.5 → user's cursor favours TOP edge.
//   Y >= 0.5 → user's cursor favours BOTTOM edge.
//   (X is its own axis; left/right are independent of Y.)

const SNAP_PX = 50;  // snap-attached distance (px, 1:1 on phone/desktop).
const UNSNAP_PX = 8;  // hysteresis: cursor must come this far back
                      // inside the canvas before the snap releases
                      // (so the user can park NEAR an edge without
                      // getting pulled to the edge while returning).

function snapY(v, spriteH, vpH, snapPx, prevV) {
  // BOTTOM edge: snap to v=1 within snapPx past edge.
  // Only snap when the sprite is moving FURTHER off-canvas from the
  // previous frame (prevV <= 1 → now v > 1, OR prevV > 1 → v > prevV).
  // When returning (v < prevV while past edge), do NOT snap.
  if (v > 1) {
    const movingOut = (prevV === undefined) || v > prevV;
    if (movingOut && (v - 1) * vpH < snapPx) return 1;
    return v;  // cursor far past edge OR returning: save raw value
  }
  // TOP edge: snap to v=spriteH/vpH within snapPx past top.
  const topPx = v * vpH - spriteH;
  if (topPx < 0) {
    const movingOut = (prevV === undefined) || v < prevV;
    if (movingOut && -topPx < snapPx) return spriteH / vpH;
    return v;
  }
  // Inside canvas with prev outside: if cursor is within UNSNAP_PX
  // of returning to the edge zone, don't snap — let user park where
  // they want.
  if (prevV !== undefined && (prevV > 1 || prevV * vpH - spriteH < 0)) {
    // we just came back inside; v is the raw value, keep it.
    return v;
  }
  return v;
}

function snapX(v, spriteW, vpW, snapPx, prevV) {
  // placementX is centre; sprite's left = v*vpW - spriteW/2, right = +spriteW/2.
  const rightPx = v * vpW + spriteW / 2;
  const leftPx  = v * vpW - spriteW / 2;
  // RIGHT edge: snap only when moving further out.
  if (rightPx > vpW) {
    const movingOut = (prevV === undefined) || v > prevV;
    if (movingOut && rightPx - vpW < snapPx) return 1 - spriteW / (2 * vpW);
    return v;
  }
  // LEFT edge: snap only when moving further out.
  if (leftPx < 0) {
    const movingOut = (prevV === undefined) || v < prevV;
    if (movingOut && -leftPx < snapPx) return spriteW / (2 * vpW);
    return v;
  }
  // Just returned inside: keep raw value (no snap-back-to-edge).
  if (prevV !== undefined) {
    const prevRightPx = prevV * vpW + spriteW / 2;
    const prevLeftPx  = prevV * vpW - spriteW / 2;
    if (prevRightPx > vpW || prevLeftPx < 0) return v;
  }
  return v;
}
// (Constants MAGNET / MAGNET_PRE_PX / MAGNET_POST_PX and function
// springBackOverdrag removed; replaced by snapEdge above.  The
// user has explicitly asked — multiple times — for NO spring-back:
// whatever value the user parks the cursor at is what gets saved.)

// Hitbox drag still needs a clamp helper and a "how far past the
// canvas edge the user can drag the corners" budget.
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
const EDGE_OVERDRAG = 0.20;

// ---------- selection / scene lifecycle ----------
function clearActiveDrag() {
  const drag = state.drag;
  state.drag = null;
  if (!drag?.handle) return;

  const moveHandler = drag.targetKind === 'sprite' ? onSpriteDragMove : onHitboxDragMove;
  const endHandler = drag.targetKind === 'sprite' ? onSpriteDragEnd : onHitboxDragEnd;
  drag.handle.removeEventListener('pointermove', moveHandler);
  drag.handle.removeEventListener('pointerup', endHandler);
  drag.handle.removeEventListener('pointercancel', endHandler);
  drag.handle.classList.remove('dragging');
}

function selectionBelongsToCurrentStory(selection = state.selected) {
  if (!selection) return true;
  if (selection.kind === 'sprite') {
    return (getScene()?.characters || []).includes(selection.ref);
  }
  if (selection.kind === 'hitbox') {
    return (getScene()?.hitboxes || []).includes(selection.ref);
  }
  if (selection.kind === 'item') {
    return Object.values(state.story?.items || {}).includes(selection.ref);
  }
  return false;
}

function validateSelection() {
  if (!selectionBelongsToCurrentStory()) state.selected = null;
  return state.selected;
}

function switchScene(sceneId, { render = true } = {}) {
  const scenes = state.story?.scenes;
  if (!scenes || !Object.prototype.hasOwnProperty.call(scenes, sceneId)) return false;

  if (sceneId !== state.sceneId) {
    state.sceneId = sceneId;
    state.selected = null;
    clearActiveDrag();
  }
  if (render) renderAll();
  return true;
}

// ---------- API ----------
async function loadStory() {
  const res = await fetch('/api/story');
  const story = await res.json();
  // Every fetch creates new object identities. Drop refs into the previous
  // story before replacing it, even when the same scene remains selected.
  state.selected = null;
  clearActiveDrag();
  state.story = story;
}

function readEditorToken() {
  try {
    return typeof sessionStorage === 'undefined'
      ? ''
      : (sessionStorage.getItem(EDITOR_TOKEN_SESSION_KEY) || '');
  } catch (_) {
    return '';
  }
}

function storeEditorToken(token) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(EDITOR_TOKEN_SESSION_KEY, token);
    }
  } catch (_) {}
}

// Mutation-only fetch wrapper. Tokens remain tab-scoped in sessionStorage and
// a 401 gets at most one interactive retry.
async function mutationFetch(url, options) {
  const send = (token) => {
    const headers = { ...(options.headers || {}) };
    if (token) headers['X-Editor-Token'] = token;
    return fetch(url, { ...options, headers });
  };

  const failedResponse = await send(readEditorToken());
  if (failedResponse.status !== 401) return failedResponse;

  const suppliedToken = prompt('Editor token required for this server:');
  if (suppliedToken === null) return failedResponse;
  storeEditorToken(suppliedToken);
  return send(suppliedToken);
}

async function saveStory() {
  const res = await mutationFetch('/api/story', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state.story),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setStatus('save FAILED: ' + (err.error || res.statusText), 'dirty');
    return false;
  }
  state.dirty = false;
  setStatus('saved', 'saved');
  return true;
}

// Directory contents are immutable for the lifetime of an editor page. Keep
// the promise itself so concurrent inspector renders share the same request,
// rather than merely caching after the first response has completed.
const listDirCache = new Map();
function listDir(rel) {
  if (listDirCache.has(rel)) return listDirCache.get(rel);

  const request = fetch('/api/list?dir=' + encodeURIComponent(rel))
    .then(async (res) => {
      if (!res.ok) {
        listDirCache.delete(rel);
        return [];
      }
      return res.json();
    })
    .catch((error) => {
      // Failed requests remain retryable; successful (including empty)
      // directory listings stay cached for the rest of this editor session.
      listDirCache.delete(rel);
      throw error;
    });
  listDirCache.set(rel, request);
  return request;
}

async function loadImage(path) {
  if (state.bgImages[path]) return state.bgImages[path];
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { state.bgImages[path] = img; resolve(img); };
    img.onerror = reject;
    img.src = path;
  });
}

async function loadSpriteFrame(charConfig, sceneId) {
  const key = charConfig.id + '/' + sceneId;
  // Return cached single-frame Image if we already have one (used by
  // the rect computation / overlay box). Animation playback reads
  // spriteFrameLists[key] directly for the per-frame list.
  if (state.spriteFrames[key]) return state.spriteFrames[key];
  const frames = await loadSpriteFrameList(charConfig, sceneId);
  if (!frames || frames.length === 0) return null;
  // The legacy single-frame cache gets frame 0 — that's the static
  // fallback for code paths that don't know about animations.
  state.spriteFrames[key] = frames[0];
  return frames[0];
}

async function loadSpriteFrameList(charConfig, sceneId) {
  const key = charConfig.id + '/' + sceneId;
  if (state.spriteFrameLists[key]) return state.spriteFrameLists[key];
  const sceneCfg = (charConfig.scenes || {})[sceneId];
  if (!sceneCfg) return null;
  const dir = sceneCfg.frames.replace(/[\\/][^\\/]*\*\.[^\\/]*$/, '');
  const list = await listDir(dir);
  if (!list || list.length === 0) return null;
  // Resolve the file name pattern (e.g. frame_*.png → frame_NN.png).
  const baseName = sceneCfg.frames.replace(/^.*[\\/]/, '').replace(/\*\.png$/, '').replace(/\*$/, '');
  // Filter + sort numerically so frame_2.png comes before frame_10.png.
  const pngs = list.filter(f => f.startsWith(baseName) && /\.png$/i.test(f));
  pngs.sort((a, b) => {
    const na = parseInt(a.match(/(\d+)\.png$/i)?.[1] ?? '0', 10);
    const nb = parseInt(b.match(/(\d+)\.png$/i)?.[1] ?? '0', 10);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
  if (pngs.length === 0) {
    const any = list.find(f => /\.png$/i.test(f));
    if (any) pngs.push(any);
  }
  if (pngs.length === 0) return null;
  const frames = [];
  for (const f of pngs) {
    const img = await loadImage(dir + '/' + f);
    frames.push(img);
  }
  state.spriteFrameLists[key] = frames;
  // Default playback state: paused, frame 0.
  if (!state.spriteAnim[key]) {
    state.spriteAnim[key] = { idx: 0, lastT: 0, playing: false };
  }
  return frames;
}

// ---------- animation preview (play button) ----------
async function togglePlay(charConfig) {
  const key = charConfig.id + '/' + state.sceneId;
  // Make sure all frames are loaded.
  await loadSpriteFrameList(charConfig, state.sceneId);
  const anim = state.spriteAnim[key];
  if (!anim) return;
  anim.playing = !anim.playing;
  if (anim.playing) {
    // Always restart from the rest pose when starting playback — the
    // user's expectation is "press play, see the rest pose, then
    // animate". If we'd just paused mid-animation, the resume point
    // is irrelevant: from the user's POV they wanted a fresh preview.
    anim.idx = 0;
    anim._phase = 0;
  }
  anim.lastT = performance.now();
  // Update spriteFrames cache to current frame immediately.
  const frames = state.spriteFrameLists[key];
  if (frames && frames.length) {
    state.spriteFrames[key] = frames[anim.idx % frames.length];
  }
  if (anim.playing) startAnimTick();
  renderPreview();
  renderOverlay(); // refresh play/pause icon
}

function startAnimTick() {
  if (state._animTickHandle) return;
  const tick = (t) => {
    state._animTickHandle = requestAnimationFrame(tick);
    let anyPlaying = false;
    for (const key in state.spriteAnim) {
      const anim = state.spriteAnim[key];
      if (!anim.playing) continue;
      anyPlaying = true;
      const frames = state.spriteFrameLists[key];
      if (!frames || frames.length < 2) { anim.playing = false; continue; }
      // fps from sceneCfg if available, else 6.
      const [charId, sceneId] = key.split('/');
      const cfg = (state.story.scenes[sceneId]?.characters || []).find(c => c.id === charId);
      const scfg = cfg?.scenes?.[sceneId];
      const fps = (scfg && scfg.fps) || 6;
      const dt = t - anim.lastT;
      const step = Math.floor(dt / (1000 / fps));
      if (step > 0) {
        anim.lastT = t;
        // Drive the sprite's frame index according to the same
        // playForward / playReverse / loop logic as the in-game
        // runtime (src/runtime/sprites.js). Mirrors _phase 0/1/2.
        const playForward = scfg?.playForward === true;
        const playReverse = scfg?.playReverse === true;
        const loop = scfg?.loop !== false;  // default true
        const N = frames.length;
        if (playForward && playReverse) {
          // Ping-pong: 0→N-1→0. Loop=true keeps bouncing; loop=false
          // freezes on frame 0 after the first full cycle.
          for (let i = 0; i < step; i++) {
            if (anim._phase === undefined) anim._phase = 0;
            if (anim._phase === 0) {
              anim.idx++;
              if (anim.idx >= N) {
                if (!loop) { anim.idx = 0; anim._phase = 2; anim.playing = false; break; }
                anim.idx = N - 2; anim._phase = 1;
              }
            } else if (anim._phase === 1) {
              anim.idx--;
              if (anim.idx < 0) {
                if (!loop) { anim.idx = 0; anim._phase = 2; anim.playing = false; break; }
                anim.idx = 1; anim._phase = 0;
              }
            }
          }
        } else if (playForward) {
          anim.idx = (anim.idx + step) % N;
          if (!loop && anim.idx === 0 && step > 0) { anim.playing = false; }
        } else if (playReverse) {
          anim.idx = (anim.idx - step + N * Math.ceil(step / N)) % N;
          if (!loop && anim.idx === 0 && step > 0) { anim.playing = false; }
        } else {
          // No direction set: behave like simple loop forward (matches
          // runtime default when neither flag is set).
          anim.idx = (anim.idx + step) % N;
        }
        state.spriteFrames[key] = frames[anim.idx];
      }
    }
    if (anyPlaying) {
      renderPreview();
      // Re-render the overlay too so the play/pause icon stays in sync
      // if the sprite's bounding box needs to refresh.
      renderOverlay();
    }
    else state._animTickHandle = null;
  };
  state._animTickHandle = requestAnimationFrame(tick);
}

// ---------- status bar ----------
function setStatus(msg, cls) {
  const el = $('#status');
  el.textContent = msg;
  el.className = 'status' + (cls ? ' ' + cls : '');
}
function markDirty() {
  state.dirty = true;
  setStatus('unsaved changes', 'dirty');
}

// ---------- viewport / scaling ----------
function setViewport(w, h) {
  state.vpW = w; state.vpH = h;
  bgCanvas.width = w;
  bgCanvas.height = h;
  bgCanvas.style.width = w + 'px';
  bgCanvas.style.height = h + 'px';
  frame.style.width = w + 'px';
  frame.style.height = h + 'px';
  scaleFrameToFit();
}
function scaleFrameToFit() {
  // Pick a CSS scale so the frame fits the available center area
  // without horizontal or vertical scroll on this screen.
  const center = $('#center');
  const availW = center.clientWidth - 24;
  const availH = center.clientHeight - 96; // subtract viewport toolbar + padding
  const scale = Math.min(1, availW / state.vpW, availH / state.vpH);
  frame.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', scaleFrameToFit);

// ---------- coordinate helpers (use current viewport) ----------
function vpW() { return state.vpW; }
function vpH() { return state.vpH; }
function placementYFor(charConfig) {
  // placementY is ALWAYS a canvas-height fraction. 0 = top edge of
  // canvas, 1 = bottom edge, >1 = past the bottom (sprite partially
  // off-canvas below). The drag handler now allows values past the
  // edge so the user can park a sprite partially off-canvas if they
  // want — we treat those values as a fraction, not as raw pixels.
  if (typeof charConfig.placementY === 'number') {
    return vpH() * charConfig.placementY;
  }
  return vpH() - 30;
}
function targetHFor(charConfig) {
  if (typeof charConfig.targetH === 'number') {
    const v = charConfig.targetH;
    return (v >= 0 && v <= 2) ? vpH() * v : v;
  }
  return vpH() * 0.85;
}
function placementXFor(charConfig, spriteW) {
  // Continuous numeric placementX takes priority when present — it
  // tracks the user's actual drag position. Falls back to the named
  // slot dropdown otherwise so existing characters keep working.
  //
  // placementX is the centre-X as a fraction of canvas width:
  //   0 = sprite centre pinned at the left edge of the canvas
  //   1 = sprite centre pinned at the right edge
  //   <0 or >1 = partially / fully past the edge (allowed — the
  //     drag handler rubber-bands past the edges symmetrically with
  //     placementY; we do NOT clamp here so the user can place the
  //     sprite partially off-canvas if they want).
  if (typeof charConfig.placementX === 'number') {
    return vpW() * charConfig.placementX;
  }
  const pos = charConfig.position || 'center';
  if (pos === 'bottomright' && spriteW) return vpW() - 20 - spriteW / 2;
  switch (pos) {
    case 'left':       return vpW() * 0.25;
    case 'right':      return vpW() * 0.75;
    case 'bottomright': return vpW() - 20;
    case 'closeup':    return vpW() * 0.50;
    case 'center':
    default:           return vpW() * 0.50;
  }
}
// On-canvas rect for a sprite at its current placement values.
// Returns RAW (no clamp). The drag overlay (orange dashed box)
// and the canvas draw both use this raw rect so they move
// together 1:1 with the cursor — including past the canvas
// edge, where the canvas's own clipping (canvas.drawImage to
// outside-frame geometry) decides what is visible.
//
// placementYFor / placementXFor already return px values, NOT
// fractions — do not multiply by vpW / vpH here.
function computeSpriteRect(charConfig) {
  const img = state.spriteFrames[charConfig.id + '/' + state.sceneId];
  if (img) {
    let scale = targetHFor(charConfig) / img.height;
    const maxW = vpW() * 0.95;
    if (img.width * scale > maxW) scale = maxW / img.width;
    const w = img.width * scale;
    const h = img.height * scale;
    const cy = placementYFor(charConfig);
    const cx = placementXFor(charConfig, w);
    return { x: cx - w / 2, y: cy - h, w, h };
  }
  // Placeholder rect for sprites without frames yet — needs to exist
  // so the user can still click/drag/delete them, otherwise a freshly
  // added sprite becomes invisible (no handle) the moment you click
  // away from it. Aspect ~2:1, default targetH.
  const h = targetHFor(charConfig);
  const w = h * 0.5;
  const cy = placementYFor(charConfig);
  const cx = placementXFor(charConfig, w);
  return { x: cx - w / 2, y: cy - h, w, h, noFrames: true };
}
function hitboxRectPx(hb) {
  return { x: hb.x * vpW(), y: hb.y * vpH(), w: hb.w * vpW(), h: hb.h * vpH() };
}

// ---------- preview render ----------
function getScene() { return state.story?.scenes?.[state.sceneId] || null; }

async function renderPreview() {
  bgCtx.fillStyle = '#000';
  bgCtx.fillRect(0, 0, vpW(), vpH());
  const sc = getScene();
  if (!sc) return;
  if (sc.bg) {
    try {
      const img = await loadImage(`assets/backgrounds/${sc.bg}.png`);
      const sa = vpW() / vpH(), sb = img.width / img.height;
      let dw, dh, dx, dy;
      if (sb > sa) { dh = vpH(); dw = dh * sb; dx = (vpW() - dw) / 2; dy = 0; }
      else         { dw = vpW(); dh = dw / sb; dx = 0; dy = (vpH() - dh) / 2; }
      bgCtx.drawImage(img, dx, dy, dw, dh);
    } catch (e) { /* skip */ }
  }
  for (const c of (sc.characters || [])) {
    const img = state.spriteFrames[c.id + '/' + state.sceneId];
    if (!img) continue;
    // Use the same raw rect as the drag overlay — the canvas and
    // the orange box move together 1:1 with the cursor, including
    // past the canvas edge. Canvas clipping at the frame border
    // decides what's visible; the saved value in story.json can
    // land outside [0,1] and is what the runtime will render.
    const r = computeSpriteRect(c);
    if (r) bgCtx.drawImage(img, r.x, r.y, r.w, r.h);
  }
  renderOverlay();
}

function renderOverlay() {
  // Build a fresh DOM tree, but PRESERVE the handle currently being
  // dragged so pointer events keep firing on it during a drag.
  const draggingKey = state.drag ? dragKey(state.drag) : null;
  const oldNodes = new Map();
  for (const node of overlay.querySelectorAll('.sprite-handle, .hitbox-handle')) {
    oldNodes.set(node.dataset.key, node);
  }
  overlay.innerHTML = '';
  const sc = getScene();
  if (!sc) return;

  for (const c of (sc.characters || [])) {
    const r = computeSpriteRect(c);
    if (!r) continue;
    const placeholder = !!r.noFrames;
    let div = draggingKey === dragKey({ kind: 'move', targetKind: 'sprite', ref: c }) ? oldNodes.get('sprite:' + c.id) : null;
    if (!div) {
      div = document.createElement('div');
      div.className = placeholder ? 'sprite-handle no-frames' : 'sprite-handle';
      div.dataset.key = 'sprite:' + c.id;
      const lbl = document.createElement('span'); lbl.className = 'label';
      lbl.textContent = placeholder ? `${c.id} (no frames)` : c.id;
      div.appendChild(lbl);
      // Play/pause button — top-left of the sprite box. Previews the
      // animation in real-time on the canvas. Doesn't initiate drag.
      // Skip for placeholders (no frames to preview).
      if (!placeholder) {
        const playBtn = document.createElement('button');
        playBtn.className = 'play-btn';
        playBtn.title = 'Preview animation';
        playBtn.textContent = '▶';
        playBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          togglePlay(c);
        });
        div.appendChild(playBtn);
      }
      const grip = document.createElement('span'); grip.className = 'resize'; grip.title = 'drag to resize';
      div.appendChild(grip);
      attachSpriteDrag(div, c);
    }
    // Reflect playback state on the play button (re-render safe —
    // re-binds only the icon, keeps the click handler). No-op for
    // placeholders (no play button appended above).
    const playBtn = div.querySelector('.play-btn');
    if (playBtn) {
      const animKey = c.id + '/' + state.sceneId;
      const anim = state.spriteAnim[animKey];
      playBtn.textContent = (anim && anim.playing) ? '❚❚' : '▶';
      playBtn.classList.toggle('playing', !!(anim && anim.playing));
    }
    div.style.left = r.x + 'px';
    div.style.top = r.y + 'px';
    div.style.width = r.w + 'px';
    div.style.height = r.h + 'px';
    if (state.selected?.kind === 'sprite' && state.selected.ref === c) div.classList.add('selected');
    if (state.drag?.ref === c) div.classList.add('dragging');
    overlay.appendChild(div);
  }

  for (let i = 0; i < (sc.hitboxes || []).length; i++) {
    const hb = sc.hitboxes[i];
    const r = hitboxRectPx(hb);
    let div = draggingKey === dragKey({ kind: 'move', targetKind: 'hitbox', ref: hb }) ? oldNodes.get('hitbox:' + i) : null;
    if (!div) {
      div = document.createElement('div');
      div.className = 'hitbox-handle';
      div.dataset.key = 'hitbox:' + i;
      const lbl = document.createElement('span'); lbl.className = 'label'; lbl.textContent = hb.item || ('hb[' + i + ']');
      div.appendChild(lbl);
      const grip = document.createElement('span'); grip.className = 'resize'; grip.title = 'drag to resize';
      div.appendChild(grip);
      attachHitboxDrag(div, hb, i);
    }
    div.style.left = r.x + 'px';
    div.style.top = r.y + 'px';
    div.style.width = r.w + 'px';
    div.style.height = r.h + 'px';
    if (state.selected?.kind === 'hitbox' && state.selected.ref === hb) div.classList.add('selected');
    if (state.drag?.ref === hb) div.classList.add('dragging');
    overlay.appendChild(div);
  }
}

function dragKey(d) {
  return d.targetKind + ':' + (d.targetKind === 'sprite' ? d.ref.id : state.story.scenes[state.sceneId].hitboxes.indexOf(d.ref));
}

// ---------- sprite drag (incremental deltas) ----------
function attachSpriteDrag(div, charConfig) {
  div.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    div.setPointerCapture(e.pointerId);
    // Selection update + drag start must NOT trigger a re-render of
    // the overlay — that would orphan `div` while we still need
    // pointer events on it. Update in-place instead.
    state.selected = { kind: 'sprite', ref: charConfig };
    // Mark this handle as selected (in-place) so the user sees it.
    div.classList.add('selected');
    document.querySelectorAll('.sprite-handle.selected, .hitbox-handle.selected').forEach(n => {
      if (n !== div) n.classList.remove('selected');
    });
    // Lazy-update the right panel by toggling its data attribute and
    // letting the next renderRight() call pick it up; calling
    // renderRight() here is fine because it doesn't touch the overlay.
    renderRight();

    const isResize = e.target.classList.contains('resize');
    // Compute the current visual centre of the sprite as a fraction
    // of vpW. This works whether the sprite uses continuous
    // placementX or the legacy named position slot — we just look at
    // the rendered centre. We snapshot it at mousedown so the first
    // horizontal move is purely incremental (no jump) regardless of
    // what positioning model the character uses today.
    const r = computeSpriteRect(charConfig);
    const startPX = (r && vpW() > 0) ? ((r.x + r.w / 2) / vpW()) : 0.5;
    state.drag = {
      kind: isResize ? 'resize' : 'move',
      targetKind: 'sprite',
      ref: charConfig,
      handle: div,
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      startPlacementY: typeof charConfig.placementY === 'number' ? charConfig.placementY : 0.97,
      startPlacementX: startPX,
      // Previous frame's snapped placement — used by snapX/snapY to
      // know which direction the cursor is moving so the snap can
      // release when the user drags back inside the canvas.
      lastPlacementY: typeof charConfig.placementY === 'number' ? charConfig.placementY : 0.97,
      lastPlacementX: startPX,
      startTargetH: typeof charConfig.targetH === 'number' ? charConfig.targetH : 0.85,
    };
    div.classList.add('dragging');
    div.addEventListener('pointermove', onSpriteDragMove);
    div.addEventListener('pointerup', onSpriteDragEnd);
    div.addEventListener('pointercancel', onSpriteDragEnd);
  });
}

function onSpriteDragMove(e) {
  if (!state.drag) return;
  const dx = e.clientX - state.drag.lastX;
  const dy = e.clientY - state.drag.lastY;
  state.drag.lastX = e.clientX;
  state.drag.lastY = e.clientY;
  const charConfig = state.drag.ref;
  if (state.drag.kind === 'move') {
    // Edge-anchor snap-to-edge drag (the user's actual request):
    // As the cursor approaches a canvas edge, the sprite's leading
    // edge snaps TO the canvas edge and stays glued for up to
    // SNAP_PX pixels of cursor travel past the edge. After that
    // the sprite breaks free and follows the cursor 1:1.
    //
    // NO spring-back, NO clamp, NO warp-to-other-edge. Whatever
    // placement the user parks on is what gets saved.
    const dyUnits = (e.clientY - state.drag.startY) / vpH();
    const dxUnits = (e.clientX - state.drag.startX) / vpW();
    // Need the rendered sprite's full extent on each axis to know
    // where its leading edge sits.
    //   placementY is the BOTTOM-edge Y as a fraction of vpH.
    //   placementX is the centre X as a fraction of vpW.
    // snapY / snapX convert that edge convention directly.
    const rect = computeSpriteRect(charConfig);
    const spriteH = rect ? rect.h : vpH() * 0.2;
    const spriteW = rect ? rect.w : vpW() * 0.2;
    // Compute the cursor-driven placement (1:1 inside canvas, free
    // outside). snapY / snapX then pin the sprite's edge to the
    // canvas edge when the cursor's edge is within SNAP_PX of
    // crossing.
    const newPYraw = state.drag.startPlacementY + dyUnits;
    const newPXraw = state.drag.startPlacementX + dxUnits;
    // Snap-to-edge disabled (user preference): drive the sprite 1:1
    // from the cursor at all times. For precise edge placement, use
    // the numeric placementX / placementY inputs in the inspector.
    const newPY = newPYraw;
    const newPX = newPXraw;
    // One-shot diagnostic so the user can confirm vpW/vpH and
    // sprite dimensions are sane numbers. Triggers once at the start
    // of a drag; afterwards it's quiet. Open the browser console.
    if (!state._snapDiag) {
      state._snapDiag = true;
      console.log('[editor-drag] vpW=' + vpW() + ' vpH=' + vpH()
        + ' spriteW=' + spriteW.toFixed(1)
        + ' spriteH=' + spriteH.toFixed(1)
        + ' SNAP_PX=' + SNAP_PX + 'px');
    }
    if (newPYraw < 0 || newPYraw > 1 || newPXraw < 0 || newPXraw > 1) {
      console.log('[editor-drag]',
        'cursor Y raw=' + newPYraw.toFixed(3),
        'snap Y=' + newPY.toFixed(3),
        'cursor X raw=' + newPXraw.toFixed(3),
        'snap X=' + newPX.toFixed(3));
    }
    charConfig.placementY = newPY;
    charConfig.placementX = newPX;
    // The legacy named position slot conflicts with continuous
    // placementX — clear it once numeric dragging starts so the
    // inspector doesn't show a stale slot.
    if ('position' in charConfig) delete charConfig.position;
  } else {
    // resize: vertical delta from the START of the drag (the notch
    // bottom), not the (post-rebuild) rect of the handle. startTargetH
    // is the height fraction at mousedown; we add dy/H to it. Clamp
    // stays tight — height has no "off canvas" natural meaning.
    const newTH = state.drag.startTargetH + (e.clientY - state.drag.startY) / vpH();
    charConfig.targetH = Math.max(0.05, Math.min(1.5, newTH));
  }
  // Mutate the handle position in place — do NOT re-render the
  // overlay during drag, or pointer capture on the original node
  // would be lost.
  const r = computeSpriteRect(charConfig);
  if (r) {
    state.drag.handle.style.left = r.x + 'px';
    state.drag.handle.style.top = r.y + 'px';
    state.drag.handle.style.width = r.w + 'px';
    state.drag.handle.style.height = r.h + 'px';
  }
  // Redraw the canvas (cheap) but not the overlay.
  redrawCanvasOnly();
  // Live-update the right-panel number fields so the user can see
  // the exact fraction.
  syncRightFromSelection();
}

function onSpriteDragEnd(e) {
  const handle = state.drag.handle;
  const draggedRef = state.drag.ref;
  handle.removeEventListener('pointermove', onSpriteDragMove);
  handle.removeEventListener('pointerup', onSpriteDragEnd);
  handle.removeEventListener('pointercancel', onSpriteDragEnd);
  handle.classList.remove('dragging');
  state.drag = null;
  // No spring-back. Whatever the user parked on (linear inside
  // [0,1], rubber-banded past the edge) is the value that stays.
  // Save the cursor position to discourage the legacy Position-slot
  // dropdown showing a stale value, then live-sync the inspector
  // number fields.
  if (draggedRef && 'position' in draggedRef) renderRight();
  else { syncRightFromSelection(); }
  markDirty();
  renderOverlay();
}

// ---------- hitbox drag (incremental deltas) ----------
function attachHitboxDrag(div, hb, idx) {
  div.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    div.setPointerCapture(e.pointerId);
    state.selected = { kind: 'hitbox', ref: hb, idx };
    div.classList.add('selected');
    document.querySelectorAll('.sprite-handle.selected, .hitbox-handle.selected').forEach(n => {
      if (n !== div) n.classList.remove('selected');
    });
    renderRight();
    const isResize = e.target.classList.contains('resize');
    state.drag = {
      kind: isResize ? 'resize' : 'move',
      targetKind: 'hitbox',
      ref: hb,
      handle: div,
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      startXFrac: hb.x, startYFrac: hb.y,
      startWFrac: hb.w, startHFrac: hb.h,
    };
    div.classList.add('dragging');
    div.addEventListener('pointermove', onHitboxDragMove);
    div.addEventListener('pointerup', onHitboxDragEnd);
    div.addEventListener('pointercancel', onHitboxDragEnd);
  });
}

function onHitboxDragMove(e) {
  if (!state.drag) return;
  const hb = state.drag.ref;
  const dx = e.clientX - state.drag.startX;
  const dy = e.clientY - state.drag.startY;
  if (state.drag.kind === 'move') {
    // Allow modest over-drag past canvas edges; spring back inside on
    // release (see onHitboxDragEnd → springBackOverdrag).
    const newX = state.drag.startXFrac + dx / vpW();
    const newY = state.drag.startYFrac + dy / vpH();
    hb.x = clamp(newX, -EDGE_OVERDRAG, 1 + EDGE_OVERDRAG - Math.max(0.02, hb.w));
    hb.y = clamp(newY, -EDGE_OVERDRAG, 1 + EDGE_OVERDRAG - Math.max(0.02, hb.h));
  } else {
    // Resize is wall-anchored: width/height are clamped to keep the
    // hitbox on-canvas in both directions. Tiny over-drag is allowed
    // here too so a "drag past corner" doesn't visually snap to the
    // edge mid-gesture.
    hb.w = clamp(state.drag.startWFrac + dx / vpW(), 0.02, 1 + EDGE_OVERDRAG - hb.x);
    hb.h = clamp(state.drag.startHFrac + dy / vpH(), 0.02, 1 + EDGE_OVERDRAG - hb.y);
  }
  const r = hitboxRectPx(hb);
  state.drag.handle.style.left = r.x + 'px';
  state.drag.handle.style.top = r.y + 'px';
  state.drag.handle.style.width = r.w + 'px';
  state.drag.handle.style.height = r.h + 'px';
  redrawCanvasOnly();
  syncRightFromSelection();
}

function onHitboxDragEnd() {
  const handle = state.drag.handle;
  const draggedRef = state.drag.ref;
  handle.removeEventListener('pointermove', onHitboxDragMove);
  handle.removeEventListener('pointerup', onHitboxDragEnd);
  handle.removeEventListener('pointercancel', onHitboxDragEnd);
  handle.classList.remove('dragging');
  state.drag = null;
  // spring-back removed (user said NO spring-back). Whatever pixel
  // value the user parked the corner at is what gets saved.
  markDirty();
  renderOverlay();
}

// ---------- redraw canvas-only (no DOM rebuild) ----------
async function redrawCanvasOnly() {
  bgCtx.fillStyle = '#000';
  bgCtx.fillRect(0, 0, vpW(), vpH());
  const sc = getScene();
  if (!sc) return;
  if (sc.bg) {
    try {
      const img = await loadImage(`assets/backgrounds/${sc.bg}.png`);
      const sa = vpW() / vpH(), sb = img.width / img.height;
      let dw, dh, dx, dy;
      if (sb > sa) { dh = vpH(); dw = dh * sb; dx = (vpW() - dw) / 2; dy = 0; }
      else         { dw = vpW(); dh = dw / sb; dx = 0; dy = (vpH() - dh) / 2; }
      bgCtx.drawImage(img, dx, dy, dw, dh);
    } catch (e) {}
  }
  for (const c of (sc.characters || [])) {
    const img = state.spriteFrames[c.id + '/' + state.sceneId];
    if (!img) continue;
    // Same raw rect as the overlay's drag handle — see renderPreview.
    const r = computeSpriteRect(c);
    if (r) bgCtx.drawImage(img, r.x, r.y, r.w, r.h);
  }
}

// ---------- live right-panel sync ----------
function syncRightFromSelection() {
  if (!state.selected) return;
  const right = $('#right');
  if (state.selected.kind === 'sprite') {
    const c = state.selected.ref;
    const px = right.querySelector('input[data-sync="placementX"]');
    const py = right.querySelector('input[data-sync="placementY"]');
    const th = right.querySelector('input[data-sync="targetH"]');
    if (px) px.value = (typeof c.placementX === 'number') ? c.placementX.toFixed(3) : '';
    if (py) py.value = (typeof c.placementY === 'number') ? c.placementY.toFixed(3) : '';
    if (th) th.value = (typeof c.targetH === 'number') ? c.targetH.toFixed(3) : '';
  }
  if (state.selected.kind === 'hitbox') {
    const hb = state.selected.ref;
    const x = right.querySelector('input[data-sync="hb.x"]');
    const y = right.querySelector('input[data-sync="hb.y"]');
    const w = right.querySelector('input[data-sync="hb.w"]');
    const h = right.querySelector('input[data-sync="hb.h"]');
    if (x) x.value = hb.x.toFixed(3);
    if (y) y.value = hb.y.toFixed(3);
    if (w) w.value = hb.w.toFixed(3);
    if (h) h.value = hb.h.toFixed(3);
  }
}

// ---------- left panel ----------
function renderSceneList() {
  const ul = $('#scene-list');
  ul.innerHTML = '';
  const scenes = state.story.scenes || {};
  for (const [sid, sc] of Object.entries(scenes)) {
    const li = document.createElement('li');
    li.dataset.sceneId = sid;
    if (sc.bg) li.classList.add('has-bg');
    if (sid === state.sceneId) li.classList.add('active');
    const sw = document.createElement('span'); sw.className = 'swatch'; li.appendChild(sw);
    const lbl = document.createElement('span'); lbl.textContent = sid; li.appendChild(lbl);
    const cnt = document.createElement('span'); cnt.className = 'count';
    cnt.textContent = `${(sc.characters || []).length}c/${(sc.hitboxes || []).length}h`;
    li.appendChild(cnt);
    li.onclick = () => { switchScene(sid); };
    ul.appendChild(li);
  }
}

function renderItemList() {
  const ul = $('#item-list');
  ul.innerHTML = '';
  const items = state.story.items || {};
  for (const [iid, it] of Object.entries(items)) {
    const li = document.createElement('li');
    li.dataset.itemId = iid;
    if (state.selected?.kind === 'item' && state.selected.ref?.id === iid) li.classList.add('active');
    const sw = document.createElement('span'); sw.className = 'swatch'; li.appendChild(sw);
    const lbl = document.createElement('span'); lbl.textContent = it.name || iid; li.appendChild(lbl);
    li.onclick = () => { state.selected = { kind: 'item', ref: it }; renderRight(); };
    ul.appendChild(li);
  }
}

// ---------- draw hitbox tool ----------
function setupDrawTool() {
  $('#tool-select').onclick = () => setTool('select');
  $('#tool-draw-hitbox').onclick = () => setTool('draw-hitbox');
  $('#tool-add-sprite').onclick = () => addNewSprite();

  frame.addEventListener('pointerdown', onFrameDown);
}

function setTool(t) {
  state.tool = t;
  $$('.bottombar .tool-group button').forEach(b => b.classList.remove('active'));
  if (t === 'select') $('#tool-select').classList.add('active');
  if (t === 'draw-hitbox') $('#tool-draw-hitbox').classList.add('active');
  const banner = $('#tool-banner');
  banner.style.display = (t === 'draw-hitbox') ? 'inline' : 'none';
}

function onFrameDown(e) {
  if (state.tool !== 'draw-hitbox') return;
  if (e.target.closest('.sprite-handle, .hitbox-handle')) return;
  e.preventDefault();
  frame.setPointerCapture(e.pointerId);
  const r = frame.getBoundingClientRect();
  // Account for CSS scale of the frame
  const scale = frame.getBoundingClientRect().width / vpW();
  const sx = (e.clientX - r.left) / scale;
  const sy = (e.clientY - r.top) / scale;
  const start = { x: sx / vpW(), y: sy / vpH() };
  showDrawPreview(start.x, start.y, 0, 0);
  const move = (ev) => {
    const cx = (ev.clientX - r.left) / scale / vpW();
    const cy = (ev.clientY - r.top) / scale / vpH();
    const x = Math.min(start.x, cx), y = Math.min(start.y, cy);
    const w = Math.abs(cx - start.x), h = Math.abs(cy - start.y);
    showDrawPreview(x, y, w, h);
  };
  const up = (ev) => {
    frame.removeEventListener('pointermove', move);
    frame.removeEventListener('pointerup', up);
    frame.removeEventListener('pointercancel', up);
    const cx = (ev.clientX - r.left) / scale / vpW();
    const cy = (ev.clientY - r.top) / scale / vpH();
    const x = Math.max(0, Math.min(1 - 0.02, Math.min(start.x, cx)));
    const y = Math.max(0, Math.min(1 - 0.02, Math.min(start.y, cy)));
    const w = Math.abs(cx - start.x);
    const h = Math.abs(cy - start.y);
    hideDrawPreview();
    if (w > 0.02 && h > 0.02) addNewHitbox(x, y, Math.min(w, 1 - x), Math.min(h, 1 - y));
    setTool('select');
  };
  frame.addEventListener('pointermove', move);
  frame.addEventListener('pointerup', up);
  frame.addEventListener('pointercancel', up);
}

function showDrawPreview(x, y, w, h) {
  let pv = $('#draw-preview');
  if (!pv) {
    pv = document.createElement('div'); pv.id = 'draw-preview';
    overlay.appendChild(pv);
  }
  pv.style.left = (x * vpW()) + 'px';
  pv.style.top = (y * vpH()) + 'px';
  pv.style.width = (w * vpW()) + 'px';
  pv.style.height = (h * vpH()) + 'px';
}
function hideDrawPreview() {
  const pv = $('#draw-preview'); if (pv) pv.remove();
}

function addNewHitbox(x, y, w, h) {
  const sc = getScene();
  if (!sc.hitboxes) sc.hitboxes = [];
  const items = Object.keys(state.story.items || {});
  const hb = { x, y, w, h, item: items[0] || null, label: 'New hitbox' };
  sc.hitboxes.push(hb);
  state.selected = { kind: 'hitbox', ref: hb, idx: sc.hitboxes.length - 1 };
  markDirty();
  renderAll();
}

function addNewSprite() {
  const sc = getScene();
  const used = new Set((sc.characters || []).map(c => c.id));
  let name = 'sprite';
  let i = 1;
  while (used.has(name + i)) i++;
  name = name + i;
  const char = {
    id: name,
    position: 'right',
    placementY: 0.85,
    targetH: 0.85,
    speaker: name.toUpperCase(),
    scenes: {
      [state.sceneId]: { frames: `assets/sprites/${name}/${state.sceneId}/frame_*.png`, fps: 4, loop: true },
    },
  };
  if (!sc.characters) sc.characters = [];
  sc.characters.push(char);
  state.selected = { kind: 'sprite', ref: char };
  markDirty();
  renderAll();
}

// ---------- inspector (right panel) ----------
let activeInspectorLifecycle = null;

function beginInspectorRender() {
  if (activeInspectorLifecycle) {
    activeInspectorLifecycle.disposed = true;
    for (const cleanup of activeInspectorLifecycle.cleanups) cleanup();
    activeInspectorLifecycle.cleanups.clear();
  }
  activeInspectorLifecycle = { disposed: false, cleanups: new Set() };
  return activeInspectorLifecycle;
}

function retainInspectorCleanup(lifecycle, cleanup) {
  if (lifecycle.disposed) {
    cleanup();
    return;
  }
  lifecycle.cleanups.add(cleanup);
}

function renderRight() {
  const lifecycle = beginInspectorRender();
  validateSelection();
  const right = $('#right');
  right.innerHTML = '';
  const sceneHdr = document.createElement('div');
  sceneHdr.className = 'section';
  const sceneHeading = document.createElement('h2');
  sceneHeading.textContent = `Scene — ${state.sceneId || '—'}`;
  sceneHdr.appendChild(sceneHeading);
  right.appendChild(sceneHdr);

  const sc = getScene();
  if (sc) {
    right.appendChild(makeField('background', 'Background (assets/backgrounds/*.png)', makePlaceholder()));
    fillAsync($('#right .field[data-key="background"] .ctrl'), makeBgPicker(sc), lifecycle);
    right.appendChild(makeField('bgPalette', 'Palette', makePlaceholder()));
    fillAsync($('#right .field[data-key="bgPalette"] .ctrl'), makePalettePicker(sc), lifecycle);
    right.appendChild(makeField('music', 'Music (assets/audio/*)', makePlaceholder()));
    fillAsync($('#right .field[data-key="music"] .ctrl'), makeMusicEditor(sc, lifecycle), lifecycle);
    right.appendChild(makeField('ink', 'Ink file', makeTextInput(sc.ink || '', v => { sc.ink = v; markDirty(); })));
    // --- Scene tasks (per-scene, surfaced as toast hints + auto-completion) ---
    right.appendChild(makeTasksPanel(sc));
  }

  if (state.selected?.kind === 'sprite') {
    const c = state.selected.ref;
    right.appendChild(makeField('header', `Sprite — ${c.id}`));
    // Legacy named position slot — only meaningful when the sprite
    // doesn't have a numeric placementX. If placementX is set, hide
    // this dropdown to avoid confusion (the two are mutually
    // exclusive — see onSpriteDragMove which deletes `position` on
    // first numeric drag).
    if (typeof c.placementX !== 'number') {
      right.appendChild(makeField('position', 'Position slot',
        makeSelect(c.position || 'center',
          [['left','left'], ['center','center'], ['right','right'], ['bottomright','bottomright'], ['closeup','closeup']],
          v => { c.position = v; delete c.placementX; markDirty(); renderAll(); })));
    }
    right.appendChild(makeField('placementX', 'placementX (0=left, 1=right, off-canvas OK)',
      makeNumberInput(typeof c.placementX === 'number' ? c.placementX : 0.5,
        v => { c.placementX = v; delete c.position; markDirty(); renderAll(); }, undefined, undefined, 0.01, 'placementX')));
    right.appendChild(makeField('placementY', 'placementY (0=top, 1=bottom, off-canvas OK)',
      makeNumberInput(typeof c.placementY === 'number' ? c.placementY : 0.97, v => { c.placementY = v; markDirty(); renderAll(); }, undefined, undefined, 0.01, 'placementY')));
    right.appendChild(makeField('targetH', 'targetH (fraction of canvas height)',
      makeNumberInput(typeof c.targetH === 'number' ? c.targetH : 0.85, v => { c.targetH = v; markDirty(); renderAll(); }, 0.05, 3, 0.01, 'targetH')));
    right.appendChild(makeField('speaker', 'Speaker label',
      makeTextInput(c.speaker || '', v => { c.speaker = v; markDirty(); })));
    const scfg = (c.scenes || {})[state.sceneId];
    if (scfg) {
      right.appendChild(makeField('frames', 'Frames glob', makeTextInput(scfg.frames || '', v => { scfg.frames = v; markDirty(); })));
      right.appendChild(makeField('fps', 'FPS', makeNumberInput(scfg.fps || 4, v => { scfg.fps = v; markDirty(); })));
    }
    const del = document.createElement('div');
    del.className = 'actions';
    del.innerHTML = `<button class="danger" id="del-sprite">Delete sprite</button>`;
    del.querySelector('button').onclick = () => {
      const sc = getScene();
      sc.characters = sc.characters.filter(x => x !== c);
      state.selected = null;
      markDirty();
      renderAll();
    };
    right.appendChild(del);
  }

  if (state.selected?.kind === 'hitbox') {
    const hb = state.selected.ref;
    right.appendChild(makeField('header', `Hitbox — ${hb.item || '(no item)'}`));
    right.appendChild(makeField('item', 'Linked item',
      makeSelect(hb.item || '', Object.keys(state.story.items || {}).map(k => [k, k]),
        v => { hb.item = v || null; markDirty(); renderAll(); })));
    right.appendChild(makeField('label', 'Label',
      makeTextInput(hb.label || '', v => { hb.label = v; markDirty(); renderAll(); })));
    const row = document.createElement('div'); row.className = 'row';
    row.appendChild(makeField('x', 'x', makeNumberInput(hb.x, v => { hb.x = v; markDirty(); renderAll(); }, 0, 1, 0.01, 'hb.x')));
    row.appendChild(makeField('y', 'y', makeNumberInput(hb.y, v => { hb.y = v; markDirty(); renderAll(); }, 0, 1, 0.01, 'hb.y')));
    right.appendChild(row);
    const row2 = document.createElement('div'); row2.className = 'row';
    row2.appendChild(makeField('w', 'w', makeNumberInput(hb.w, v => { hb.w = v; markDirty(); renderAll(); }, 0, 1, 0.01, 'hb.w')));
    row2.appendChild(makeField('h', 'h', makeNumberInput(hb.h, v => { hb.h = v; markDirty(); renderAll(); }, 0, 1, 0.01, 'hb.h')));
    right.appendChild(row2);
    const del = document.createElement('div');
    del.className = 'actions';
    del.innerHTML = `<button class="danger" id="del-hb">Delete hitbox</button>`;
    del.querySelector('button').onclick = () => {
      const sc = getScene();
      sc.hitboxes = sc.hitboxes.filter(x => x !== hb);
      state.selected = null;
      markDirty();
      renderAll();
    };
    right.appendChild(del);
  }

  if (state.selected?.kind === 'item') {
    const it = state.selected.ref;
    right.appendChild(makeField('header', `Item — ${it.id}`));
    right.appendChild(makeField('name', 'Name', makeTextInput(it.name || '', v => { it.name = v; markDirty(); renderItemList(); })));
    right.appendChild(makeField('icon', 'Icon (assets/items/*.png)', makePlaceholder()));
    fillAsync($('#right .field[data-key="icon"] .ctrl'), makeIconPicker(it), lifecycle);
    right.appendChild(makeField('description', 'Description', makeTextArea(it.description || '', v => { it.description = v; markDirty(); })));
    right.appendChild(makeField('pickup_message', 'Pickup message', makeTextInput(it.pickup_message || '', v => { it.pickup_message = v; markDirty(); })));
    right.appendChild(makeField('key', 'Key item',
      makeCheckbox(!!it.key, v => { it.key = v; markDirty(); })));
  }
}

function makeField(key, labelText, controlEl) {
  const div = document.createElement('div');
  div.className = 'field';
  div.dataset.key = key;
  if (key === 'header') {
    const h = document.createElement('h2'); h.textContent = labelText;
    div.appendChild(h);
    return div;
  }
  const lbl = document.createElement('label'); lbl.textContent = labelText; div.appendChild(lbl);
  const ctrl = document.createElement('div'); ctrl.className = 'ctrl'; ctrl.appendChild(controlEl);
  div.appendChild(ctrl);
  return div;
}

// --- Tasks panel --------------------------------------------------------
// Per-scene task list. Each task is a small object the runtime TaskTracker
// reads from sceneConfig.tasks[]. The runtime recognises these types:
//   pickup       — { item }
//   use_item     — { item }
//   goto_hitbox  — { target } (target scene of the hitbox the player must click)
//   goto_dialog  — { ink_node } (resolved by Ink # goto:<node>)
//   custom       — Ink calls EXTERNAL complete_task(id) when satisfied
// `hint` is shown in a toast when dialogue is dismissed and any task is
// still open; it disappears on completion.
const TASK_TYPE_FIELDS = {
  pickup: ['item'],
  use_item: ['item'],
  goto_hitbox: ['target'],
  goto_dialog: ['ink_node'],
  custom: [],
};
const TASK_TYPES = Object.keys(TASK_TYPE_FIELDS);
const TASK_SPECIFIC_FIELDS = ['item', 'items', 'result', 'target', 'ink_node', 'on_hitbox'];

function setTaskType(t, type) {
  t.type = type;
  const allowed = new Set(TASK_TYPE_FIELDS[type] || []);
  for (const key of TASK_SPECIFIC_FIELDS) {
    if (!allowed.has(key)) delete t[key];
  }
}

function makeTasksPanel(sc) {
  const div = document.createElement('div');
  div.className = 'field tasks-panel';
  div.dataset.key = 'tasks';
  const hdr = document.createElement('label');
  hdr.textContent = 'Tasks (player-facing hints + auto-completion)';
  div.appendChild(hdr);
  const list = document.createElement('div');
  list.className = 'tasks-list';
  div.appendChild(list);

  const renderList = () => {
    list.innerHTML = '';
    const tasks = sc.tasks || (sc.tasks = []);
    if (tasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tasks-empty';
      empty.textContent = 'No tasks. Click "+ Add" to author one.';
      list.appendChild(empty);
      return;
    }
    tasks.forEach((t, idx) => list.appendChild(makeTaskRow(t, idx, tasks, renderList)));
  };
  renderList();

  const actions = document.createElement('div');
  actions.className = 'actions';
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add task';
  addBtn.onclick = () => {
    const tasks = sc.tasks || (sc.tasks = []);
    tasks.push({ id: `task_${tasks.length + 1}`, type: 'pickup', hint: '' });
    markDirty();
    renderRight();
  };
  actions.appendChild(addBtn);
  div.appendChild(actions);
  return div;
}

function makeTaskRow(t, idx, tasks, refresh) {
  const row = document.createElement('div');
  row.className = 'task-row';
  const head = document.createElement('div');
  head.className = 'task-head';
  // Type select
  const typeSel = document.createElement('select');
  for (const ty of TASK_TYPES) {
    const opt = document.createElement('option');
    opt.value = ty; opt.textContent = ty;
    if (ty === t.type) opt.selected = true;
    typeSel.appendChild(opt);
  }
  typeSel.onchange = () => {
    // Reset type-specific fields when type changes so we don't carry over
    // orphan keys, including legacy trigger_dialog/on_hitbox data.
    setTaskType(t, typeSel.value);
    markDirty();
    renderRight();
  };
  head.appendChild(typeSel);

  const delBtn = document.createElement('button');
  delBtn.className = 'danger small';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete this task';
  delBtn.onclick = () => {
    tasks.splice(idx, 1);
    markDirty();
    renderRight();
  };
  head.appendChild(delBtn);
  row.appendChild(head);

  // ID (always shown — used as the EXTERNAL complete_task argument)
  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.placeholder = 'id';
  idInput.value = t.id || '';
  idInput.oninput = () => { t.id = idInput.value.trim(); markDirty(); };
  row.appendChild(idInput);

  // Hint (always shown)
  const hintInput = document.createElement('input');
  hintInput.type = 'text';
  hintInput.placeholder = 'hint shown to the player';
  hintInput.value = t.hint || '';
  hintInput.oninput = () => { t.hint = hintInput.value; markDirty(); };
  row.appendChild(hintInput);

  // Type-specific fields
  if (t.type === 'pickup') {
    appendField(row, 'item', t.item || '', v => { t.item = v; markDirty(); },
      'item id to pick up');
  } else if (t.type === 'use_item') {
    appendField(row, 'item', t.item || '', v => { t.item = v; markDirty(); },
      'item id to use');
  } else if (t.type === 'goto_hitbox') {
    appendField(row, 'target', t.target || '', v => { t.target = v; markDirty(); },
      'hitbox target scene id');
  } else if (t.type === 'goto_dialog') {
    appendField(row, 'ink_node', t.ink_node || '', v => { t.ink_node = v; markDirty(); },
      'Ink knot name (# goto:...)');
  }
  // custom has no extra fields beyond id + hint.

  return row;
}

function appendField(row, key, value, onChange, placeholder) {
  const i = document.createElement('input');
  i.type = 'text';
  i.placeholder = placeholder || key;
  i.value = value;
  i.oninput = () => onChange(i.value);
  row.appendChild(i);
}

function makePlaceholder() {
  const span = document.createElement('span');
  span.textContent = 'loading…';
  span.style.color = '#6c7280';
  return span;
}
async function fillAsync(container, asyncBuilder, lifecycle = null) {
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(makePlaceholder());
  try {
    const el = await asyncBuilder;
    if (lifecycle?.disposed) return;
    container.innerHTML = '';
    container.appendChild(el);
  } catch (e) {
    if (lifecycle?.disposed) return;
    container.textContent = 'error: ' + e.message;
  }
}
function makeTextInput(value, onChange) {
  const i = document.createElement('input'); i.type = 'text'; i.value = value;
  i.oninput = () => onChange(i.value);
  return i;
}
function makeTextArea(value, onChange) {
  const i = document.createElement('textarea'); i.value = value;
  i.oninput = () => onChange(i.value);
  return i;
}
function makeNumberInput(value, onChange, min, max, step, sync) {
  const i = document.createElement('input'); i.type = 'number';
  i.value = value; if (min !== undefined) i.min = min; if (max !== undefined) i.max = max; if (step !== undefined) i.step = step;
  if (sync) i.dataset.sync = sync;
  i.oninput = () => {
    const raw = i.value.trim();
    if (!raw) return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) onChange(parsed);
  };
  return i;
}
function makeSelect(value, options, onChange) {
  const s = document.createElement('select');
  for (const [v, lbl] of options) {
    const o = document.createElement('option'); o.value = v; o.textContent = lbl; s.appendChild(o);
  }
  s.value = value;
  s.onchange = () => onChange(s.value);
  return s;
}
function makeCheckbox(value, onChange) {
  const i = document.createElement('input'); i.type = 'checkbox'; i.checked = value;
  i.onchange = () => onChange(i.checked);
  return i;
}

async function makeBgPicker(sc) {
  const sel = document.createElement('select');
  const files = await listDir('assets/backgrounds');
  const pngs = files.filter(f => /\.png$/i.test(f) && !f.includes('.prompt.') && !/_v\d+\.png$/.test(f));
  const noBg = document.createElement('option'); noBg.value = ''; noBg.textContent = '— none —'; sel.appendChild(noBg);
  for (const f of pngs) {
    const o = document.createElement('option'); o.value = f.replace(/\.png$/, ''); o.textContent = f; sel.appendChild(o);
  }
  sel.value = sc.bg || '';
  sel.onchange = () => { sc.bg = sel.value || null; markDirty(); renderSceneList(); renderPreview(); };
  return sel;
}
async function makePalettePicker(sc) {
  const sel = document.createElement('select');
  const files = await listDir('assets/palettes').catch(() => []);
  const paletteFiles = files.filter(f => /\.(js|json)$/.test(f));
  const noBg = document.createElement('option'); noBg.value = ''; noBg.textContent = '— none —'; sel.appendChild(noBg);
  for (const f of paletteFiles) {
    const o = document.createElement('option'); o.value = f.replace(/\.(js|json)$/, ''); o.textContent = f; sel.appendChild(o);
  }
  sel.value = sc.bgPalette || '';
  sel.onchange = () => { sc.bgPalette = sel.value || null; markDirty(); };
  return sel;
}
async function makeMusicEditor(sc, lifecycle = activeInspectorLifecycle) {
  const files = await listDir('assets/audio');
  const audio = files.filter(f => /\.(mp3|mid|ogg)$/i.test(f));

  // Determine current mode from sc.music. A string (or single-track
  // shape) is "single"; an Array is "medley"; null/undefined is empty.
  const detectMode = () => {
    if (Array.isArray(sc.music)) return 'medley';
    if (typeof sc.music === 'string' && sc.music) return 'single';
    if (sc.music && typeof sc.music === 'object') return 'single'; // single-track object form
    return 'empty';
  };
  // Mutable working copy. The MedleyEditor mutates this list in place,
  // and we write it back to sc.music on any change.
  const wrap = document.createElement('div');

  // --- mode selector (only shown when there's content) ---
  const modeRow = document.createElement('div');
  modeRow.className = 'music-mode';
  modeRow.appendChild(modeBtn('Single track', 'single'));
  modeRow.appendChild(modeBtn('Medley (queue)', 'medley'));
  wrap.appendChild(modeRow);

  function modeBtn(label, mode) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      const cur = detectMode();
      if (cur === mode) return;
      // Convert: single → medley (wrap in array), medley → single
      // (collapse to first track), empty → leave empty until picker
      // changes.
      if (mode === 'medley') {
        if (cur === 'single') {
          sc.music = [{ file: typeof sc.music === 'string' ? sc.music : sc.music.file }];
        } else {
          sc.music = [];
        }
      } else {
        if (cur === 'medley') {
          sc.music = sc.music[0]?.file || '';
        } else {
          sc.music = '';
        }
      }
      markDirty();
      render();
    };
    return b;
  }

  function syncModeButtons() {
    const cur = detectMode();
    [...modeRow.children].forEach((b, i) => {
      b.classList.toggle('active', (i === 0 && cur === 'single') || (i === 1 && cur === 'medley'));
    });
  }

  // --- single-track picker ---
  const singleWrap = document.createElement('div');
  const singleSel = document.createElement('select');
  const noBg = document.createElement('option'); noBg.value = ''; noBg.textContent = '— none —'; singleSel.appendChild(noBg);
  for (const f of audio) {
    const o = document.createElement('option'); o.value = f; o.textContent = f; singleSel.appendChild(o);
  }
  // Set initial value — works whether sc.music is a string OR a
  // single-track object (legacy medley-of-1 form).
  const initSingle = typeof sc.music === 'string'
    ? sc.music
    : (sc.music && typeof sc.music === 'object' && !Array.isArray(sc.music) ? sc.music.file : '');
  singleSel.value = initSingle || '';
  singleSel.onchange = () => { sc.music = singleSel.value || null; markDirty(); };
  singleWrap.appendChild(singleSel);
  // Single-track preview button — lets the user audition the chosen
  // file without entering medley mode.
  const singlePlay = document.createElement('button');
  singlePlay.textContent = '▶ Play';
  singlePlay.style.cssText = 'margin-top:4px;font-size:11px;padding:3px 10px';
  singlePlay.onclick = () => {
    if (!singleSel.value) return;
    QueuePlayer.playOne('assets/audio/' + singleSel.value);
  };
  singleWrap.appendChild(singlePlay);

  // --- medley editor ---
  const medleyWrap = document.createElement('div');
  medleyWrap.style.display = 'none';

  const head = document.createElement('div');
  head.className = 'medley-head';
  const headLabel = document.createElement('span');
  headLabel.className = 'label';
  head.appendChild(headLabel);
  const playAllBtn = document.createElement('button');
  playAllBtn.textContent = '▶ Play queue';
  playAllBtn.onclick = () => QueuePlayer.playQueue(getMedley());
  head.appendChild(playAllBtn);
  const stopBtn = document.createElement('button');
  stopBtn.textContent = '⏹ Stop';
  stopBtn.onclick = () => QueuePlayer.stop();
  head.appendChild(stopBtn);
  medleyWrap.appendChild(head);

  const list = document.createElement('ul');
  list.className = 'medley-list';
  medleyWrap.appendChild(list);

  const addRow = document.createElement('div');
  addRow.className = 'medley-add';
  const addSel = document.createElement('select');
  const addDef = document.createElement('option'); addDef.value = ''; addDef.textContent = '— pick track —'; addSel.appendChild(addDef);
  for (const f of audio) {
    const o = document.createElement('option'); o.value = f; o.textContent = f; addSel.appendChild(o);
  }
  addRow.appendChild(addSel);
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add';
  addBtn.onclick = () => {
    if (!addSel.value) return;
    const tracks = getMedley();
    tracks.push({ file: addSel.value });
    writeMedley(tracks);
    addSel.value = '';
    renderList();
  };
  addRow.appendChild(addBtn);
  medleyWrap.appendChild(addRow);

  const status = document.createElement('div');
  status.className = 'medley-status';
  status.innerHTML = '<span>idle</span>';
  medleyWrap.appendChild(status);

  function getMedley() {
    if (Array.isArray(sc.music)) return sc.music;
    // Normalise to a working array if we're in single/empty mode but
    // the user added a track. Should not happen given the UI, but be
    // defensive against manual edits.
    sc.music = [];
    return sc.music;
  }
  function writeMedley(tracks) {
    sc.music = tracks;
    markDirty();
  }

  function renderList() {
    const tracks = getMedley();
    list.innerHTML = '';
    headLabel.textContent = tracks.length === 0
      ? 'medley — 0 tracks'
      : `medley — ${tracks.length} track${tracks.length === 1 ? '' : 's'}`;
    tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'medley-row';
      const idx = document.createElement('span');
      idx.className = 'idx'; idx.textContent = (i + 1) + '.';
      li.appendChild(idx);

      const sel = document.createElement('select');
      for (const f of audio) {
        const o = document.createElement('option'); o.value = f; o.textContent = f; sel.appendChild(o);
      }
      sel.value = t.file || '';
      sel.onchange = () => { t.file = sel.value; markDirty(); };
      li.appendChild(sel);

      const fadeAt = document.createElement('input');
      fadeAt.type = 'number'; fadeAt.step = '0.1'; fadeAt.min = '0';
      fadeAt.placeholder = 'fadeAt s';
      fadeAt.value = (t.fadeAt !== undefined && t.fadeAt !== null) ? t.fadeAt : '';
      fadeAt.title = 'crossfade into NEXT track at this many seconds (blank = auto)';
      fadeAt.onchange = () => {
        if (fadeAt.value === '') {
          delete t.fadeAt;
        } else {
          t.fadeAt = parseFloat(fadeAt.value);
        }
        markDirty();
      };
      li.appendChild(fadeAt);

      const up = document.createElement('button');
      up.className = 'icon-btn'; up.textContent = '↑'; up.title = 'move up';
      up.disabled = i === 0;
      up.onclick = () => { moveTrack(i, i - 1); };
      li.appendChild(up);

      const down = document.createElement('button');
      down.className = 'icon-btn'; down.textContent = '↓'; down.title = 'move down';
      down.disabled = i === tracks.length - 1;
      down.onclick = () => { moveTrack(i, i + 1); };
      li.appendChild(down);

      const playBtn = document.createElement('button');
      playBtn.className = 'icon-btn play'; playBtn.textContent = '▶'; playBtn.title = 'play this track';
      // Pass the row index so the status subscriber can highlight this row
      // even when playing a single track (mode='one') — previously the
      // highlight was only applied in mode='queue'.
      playBtn.onclick = () => QueuePlayer.playOne('assets/audio/' + t.file, { medleyIndex: i });
      li.appendChild(playBtn);

      // We need a 7th cell for delete — adjust the grid template via inline style.
      li.style.gridTemplateColumns = '22px 1fr 56px 22px 22px 22px 22px';
      const del = document.createElement('button');
      del.className = 'icon-btn danger'; del.textContent = '✕'; del.title = 'remove';
      del.onclick = () => {
        tracks.splice(i, 1);
        writeMedley(tracks);
        renderList();
      };
      li.appendChild(del);

      list.appendChild(li);
    });
  }

  function moveTrack(from, to) {
    if (to < 0 || to >= getMedley().length) return;
    const tracks = getMedley();
    const [t] = tracks.splice(from, 1);
    tracks.splice(to, 0, t);
    writeMedley(tracks);
    renderList();
  }

  function render() {
    const cur = detectMode();
    syncModeButtons();
    if (cur === 'medley') {
      singleWrap.style.display = 'none';
      medleyWrap.style.display = '';
      renderList();
    } else {
      medleyWrap.style.display = 'none';
      singleWrap.style.display = '';
      // Refresh singleSel.value in case sc.music changed via the
      // mode toggle (single→medley→single round-trip).
      const v = typeof sc.music === 'string'
        ? sc.music
        : (sc.music && typeof sc.music === 'object' && !Array.isArray(sc.music) ? sc.music.file : '');
      singleSel.value = v || '';
    }
  }

  wrap.appendChild(singleWrap);
  wrap.appendChild(medleyWrap);

  // Subscribe to QueuePlayer status changes to highlight the
  // currently-playing row + show progress text. The inspector owns this
  // subscription and disposes it before replacing the panel on a rerender.
  const unsubscribeStatus = QueuePlayer.onStatus((s) => {
    // Update row highlights. Both queue mode (s.index = current queue index)
    // and one mode (s.index = the row's medleyIndex if known, else -1) light
    // up the matching row. index === -1 means no row should highlight (e.g.
    // single-track preview button).
    [...list.children].forEach((row, i) => {
      row.classList.toggle('playing', s.index === i);
    });
    if (s.mode === 'idle') {
      status.classList.remove('now-playing');
      status.innerHTML = '<span>idle</span>';
    } else if (s.mode === 'one') {
      status.classList.add('now-playing');
      status.innerHTML = `<span>▶</span><span class="progress">${escapeHtml(s.file)}</span>`;
    } else if (s.mode === 'queue') {
      status.classList.add('now-playing');
      const file = getMedley()[s.index]?.file || '?';
      status.innerHTML = `<span>▶</span><span class="progress">${s.index + 1}/${getMedley().length} — ${escapeHtml(file)}</span>`;
    }
  });
  retainInspectorCleanup(lifecycle, unsubscribeStatus);

  render();
  return wrap;
}

// ---------- sequential queue player (editor-only) ----------
// Plays scene music tracks one-after-another. Unlike the in-game
// MusicHandler (which crossfades by fadeAt in real time), this just
// waits for each track to end before starting the next. The user
// wants to audition each track in isolation while iterating on
// story.json — not rehearse the crossfade timing.
const QueuePlayer = (() => {
  const listeners = new Set();
  let state = { mode: 'idle', index: -1, file: null };
  let currentAudio = null;
  let onEndedNext = null;

  function emit() {
    for (const fn of listeners) fn(state);
  }
  function setState(s) {
    state = s;
    emit();
  }
  function stopInternal() {
    if (onEndedNext) { clearTimeout(onEndedNext); onEndedNext = null; }
    if (currentAudio) {
      try { currentAudio.pause(); } catch (e) {}
      currentAudio = null;
    }
  }
  return {
    onStatus(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    playOne(src, opts = {}) {
      stopInternal();
      const a = new Audio(src);
      currentAudio = a;
      // medleyIndex (optional): the row index in the current medley that
      // owns this file. Reported to status subscribers so the row can be
      // highlighted even when we're not in queue mode. -1 = no row (e.g.
      // the single-track preview button).
      setState({
        mode: 'one',
        index: typeof opts.medleyIndex === 'number' ? opts.medleyIndex : -1,
        file: src.split('/').pop()
      });
      a.play().catch((e) => {
        // Browser blocked autoplay — usually means the user hasn't
        // interacted with the editor yet. The play button click
        // counts as the gesture though; this catch is for edge cases.
        console.warn('audio play() rejected:', e);
      });
      a.onended = () => {
        if (currentAudio === a) {
          currentAudio = null;
          setState({ mode: 'idle', index: -1, file: null });
        }
      };
    },
    playQueue(tracks) {
      stopInternal();
      if (!tracks || tracks.length === 0) return;
      const playIndex = (i) => {
        if (i >= tracks.length) {
          currentAudio = null;
          setState({ mode: 'idle', index: -1, file: null });
          return;
        }
        const t = tracks[i];
        const a = new Audio('assets/audio/' + t.file);
        currentAudio = a;
        setState({ mode: 'queue', index: i, file: t.file });
        a.play().catch((e) => {
          console.warn('audio play() rejected:', e);
          // Skip to next track so we don't silently hang the queue.
          onEndedNext = setTimeout(() => playIndex(i + 1), 200);
        });
        a.onended = () => {
          if (currentAudio === a) currentAudio = null;
          playIndex(i + 1);
        };
      };
      playIndex(0);
    },
    stop() {
      stopInternal();
      setState({ mode: 'idle', index: -1, file: null });
    },
    _state() { return state; },
  };
})();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
async function makeIconPicker(it) {
  const wrap = document.createElement('div');
  const sel = document.createElement('select');
  const files = await listDir('assets/items');
  const pngs = files.filter(f => /\.png$/i.test(f));
  const noBg = document.createElement('option'); noBg.value = ''; noBg.textContent = '— none —'; sel.appendChild(noBg);
  for (const f of pngs) {
    const o = document.createElement('option'); o.value = 'assets/items/' + f; o.textContent = f; sel.appendChild(o);
  }
  sel.value = it.icon || '';
  sel.onchange = () => { it.icon = sel.value || null; markDirty(); renderRight(); };
  wrap.appendChild(sel);
  const prev = document.createElement('div'); prev.className = 'icon-preview';
  if (it.icon) {
    const img = document.createElement('img'); img.src = it.icon; prev.appendChild(img);
  }
  wrap.appendChild(prev);
  return wrap;
}

// ---------- add scene / add item ----------
$('#add-scene-btn').onclick = () => {
  const id = prompt('Scene id (lower-snake, e.g. terminal_lab):');
  if (!id) return;
  if (!SCENE_ID_PATTERN.test(id)) {
    alert('Scene id must match /^[a-z][a-z0-9_]*$/ (lower-snake, starting with a letter).');
    return;
  }
  if (Object.prototype.hasOwnProperty.call(state.story.scenes, id)) { alert('already exists'); return; }
  state.story.scenes[id] = { id, kind: 'ink', bg: null, music: null, ink: 'ink/' + id + '.ink', characters: [], hitboxes: [] };
  switchScene(id, { render: false });
  markDirty(); renderAll();
};
$('#add-item-btn').onclick = () => {
  const id = prompt('Item id (lowercase_snake):');
  if (!id) return;
  if (state.story.items[id]) { alert('already exists'); return; }
  if (!state.story.items) state.story.items = {};
  state.story.items[id] = { id, name: id, description: '', icon: null, pickup_message: 'You picked up ' + id + '.' };
  state.selected = { kind: 'item', ref: state.story.items[id] };
  markDirty(); renderItemList(); renderRight();
};

// ---------- top bar ----------
$('#save-btn').onclick = saveStory;
$('#reload-btn').onclick = async () => {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  await loadStory(); state.dirty = false;
  renderAll(); setStatus('loaded', '');
};
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- viewport toolbar ----------
function setupViewportToolbar() {
  const sel = $('#viewport-size');
  const custom = $('#custom-fields');
  sel.onchange = () => {
    const v = sel.value;
    if (v === 'custom') {
      custom.style.display = 'inline-flex';
      $('#vw').value = state.vpW; $('#vh').value = state.vpH;
    } else {
      custom.style.display = 'none';
      const [w, h] = v.split('x').map(Number);
      setViewport(w, h);
      renderPreview();
    }
  };
  const apply = () => { setViewport(parseInt($('#vw').value, 10), parseInt($('#vh').value, 10)); renderPreview(); };
  $('#vw').onchange = apply; $('#vh').onchange = apply;
}

// ---------- mobile tab toggle ----------
function setupMobileTabs() {
  $$('.tab-toggle button').forEach(b => {
    b.onclick = () => {
      const tab = b.dataset.tab;
      const left = $('#left'), right = $('#right');
      $$('.tab-toggle button').forEach(x => x.classList.remove('active'));
      // close everything
      left.classList.remove('show'); right.classList.remove('show');
      // mobile layout: only one of left/right or none is visible
      if (tab === 'left') { left.classList.add('show'); b.classList.add('active'); }
      else if (tab === 'right') { right.classList.add('show'); b.classList.add('active'); }
      else { b.classList.add('active'); }
    };
  });
}

// ---------- main render ----------
async function renderAll() {
  renderSceneList();
  renderItemList();
  $('#scene-name').textContent = state.sceneId ? `scene: ${state.sceneId}` : '— no scene —';

  const sc = getScene();
  if (sc) {
    for (const c of (sc.characters || [])) {
      try { await loadSpriteFrame(c, state.sceneId); } catch (e) { /* missing */ }
    }
  }
  await renderPreview();
  renderRight();
  scaleFrameToFit();
}

async function main() {
  await loadStory();
  const ids = Object.keys(state.story.scenes || {});
  const initialSceneId = ids.includes('alley') ? 'alley' : ids[0];
  if (initialSceneId) switchScene(initialSceneId, { render: false });
  // If state.vpW / state.vpH were never initialised (this code path
  // hit on a fresh editor load — setViewport is only called from the
  // dropdown's onchange, which doesn't fire on first load), inherit
  // the dropdown's currently-selected value. Without this, vpW() /
  // vpH() return undefined and every drag movement is divided by
  // undefined, producing NaN placement values that no one can read.
  if (typeof state.vpW !== 'number' || typeof state.vpH !== 'number') {
    const sel = document.getElementById('viewport-size');
    const def = sel ? sel.value : '390x844';
    const [dw, dh] = def.split('x').map(Number);
    state.vpW = dw; state.vpH = dh;
  }
  setViewport(state.vpW, state.vpH);
  setupViewportToolbar();
  setupMobileTabs();
  setupDrawTool();
  await renderAll();
}
main().catch(err => { console.error(err); setStatus('ERROR: ' + err.message, 'error'); });