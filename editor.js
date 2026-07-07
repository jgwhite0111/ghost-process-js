// editor.js — Ghost//Process scene editor (vanilla JS)
//
// Loads story.json, renders the selected scene's background + sprites
// + hitboxes into the preview canvas, lets the user drag sprites to
// position them, drag-draw hitboxes, and edit scene/item metadata.
// Saves back to story.json via PUT /api/story.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------- editor state ----------
const state = {
  story: null,
  sceneId: null,
  selected: null,
  bgImages: {},
  spriteFrames: {},
  tool: 'select',
  dirty: false,
  // Viewport (canvas size in pixels — independent of on-screen CSS scale)
  vpW: 390,
  vpH: 844,
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

// ---------- API ----------
async function loadStory() {
  const res = await fetch('/api/story');
  state.story = await res.json();
}

async function saveStory() {
  const res = await fetch('/api/story', {
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

async function listDir(rel) {
  const res = await fetch('/api/list?dir=' + encodeURIComponent(rel));
  if (!res.ok) return [];
  return await res.json();
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
  if (state.spriteFrames[key]) return state.spriteFrames[key];
  const sceneCfg = (charConfig.scenes || {})[sceneId];
  if (!sceneCfg) return null;
  const dir = sceneCfg.frames.replace(/[\\/][^\\/]*\*\.[^\\/]*$/, '');
  const list = await listDir(dir);
  if (!list || list.length === 0) return null;
  const baseName = sceneCfg.frames.replace(/^.*[\\/]/, '').replace(/\*\.png$/, '').replace(/\*$/, '');
  let framePath = null;
  const prefixMatch = list.find(f => f.startsWith(baseName) && /\.png$/i.test(f));
  if (prefixMatch) framePath = dir + '/' + prefixMatch;
  if (!framePath) {
    const any = list.find(f => /\.png$/i.test(f));
    if (any) framePath = dir + '/' + any;
  }
  if (!framePath) return null;
  return await loadImage(framePath).then(img => { state.spriteFrames[key] = img; return img; });
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
  if (typeof charConfig.placementY === 'number') {
    const v = charConfig.placementY;
    return (v >= 0 && v <= 1) ? vpH() * v : v;
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
function computeSpriteRect(charConfig) {
  const img = state.spriteFrames[charConfig.id + '/' + state.sceneId];
  if (!img) return null;
  let scale = targetHFor(charConfig) / img.height;
  const maxW = vpW() * 0.95;
  if (img.width * scale > maxW) scale = maxW / img.width;
  const w = img.width * scale;
  const h = img.height * scale;
  const cx = placementXFor(charConfig, w);
  const cy = placementYFor(charConfig);
  return { x: cx - w / 2, y: cy - h, w, h };
}
function hitboxRectPx(hb) {
  return { x: hb.x * vpW(), y: hb.y * vpH(), w: hb.w * vpW(), h: hb.h * vpH() };
}

// ---------- preview render ----------
function getScene() { return state.story.scenes[state.sceneId]; }

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
    let div = draggingKey === dragKey({ kind: 'move', targetKind: 'sprite', ref: c }) ? oldNodes.get('sprite:' + c.id) : null;
    if (!div) {
      div = document.createElement('div');
      div.className = 'sprite-handle';
      div.dataset.key = 'sprite:' + c.id;
      const lbl = document.createElement('span'); lbl.className = 'label'; lbl.textContent = c.id;
      div.appendChild(lbl);
      const grip = document.createElement('span'); grip.className = 'resize'; grip.title = 'drag to resize';
      div.appendChild(grip);
      attachSpriteDrag(div, c);
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
    state.drag = {
      kind: isResize ? 'resize' : 'move',
      targetKind: 'sprite',
      ref: charConfig,
      handle: div,
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      startPlacementY: typeof charConfig.placementY === 'number' ? charConfig.placementY : 0.97,
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
    const newPY = state.drag.startPlacementY + (e.clientY - state.drag.startY) / vpH();
    charConfig.placementY = Math.max(0, Math.min(1, newPY));
    // Also let user drag horizontally to pick a position slot.
    const absDx = e.clientX - state.drag.startX;
    if (Math.abs(absDx) > 40) {
      if (absDx > 0) charConfig.position = 'right';
      else charConfig.position = 'left';
      state.drag.startPlacementY = charConfig.placementY; // rebaseline
      state.drag.startX = e.clientX;
    }
  } else {
    // resize: vertical delta from the START of the drag (the notch
    // bottom), not the (post-rebuild) rect of the handle. startTargetH
    // is the height fraction at mousedown; we add dy/H to it.
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
  handle.removeEventListener('pointermove', onSpriteDragMove);
  handle.removeEventListener('pointerup', onSpriteDragEnd);
  handle.removeEventListener('pointercancel', onSpriteDragEnd);
  handle.classList.remove('dragging');
  state.drag = null;
  markDirty();
  // Re-render overlay once at the end so selection handles are correct.
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
    hb.x = Math.max(0, Math.min(1 - hb.w, state.drag.startXFrac + dx / vpW()));
    hb.y = Math.max(0, Math.min(1 - hb.h, state.drag.startYFrac + dy / vpH()));
  } else {
    hb.w = Math.max(0.02, Math.min(1 - hb.x, state.drag.startWFrac + dx / vpW()));
    hb.h = Math.max(0.02, Math.min(1 - hb.y, state.drag.startHFrac + dy / vpH()));
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
  handle.removeEventListener('pointermove', onHitboxDragMove);
  handle.removeEventListener('pointerup', onHitboxDragEnd);
  handle.removeEventListener('pointercancel', onHitboxDragEnd);
  handle.classList.remove('dragging');
  state.drag = null;
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
    const py = right.querySelector('input[data-sync="placementY"]');
    const th = right.querySelector('input[data-sync="targetH"]');
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
    li.onclick = () => { state.sceneId = sid; renderAll(); };
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
      [state.sceneId]: { frames: `assets/sprites/${name}/${state.sceneId}/idle_*.png`, fps: 4, loop: true },
    },
  };
  if (!sc.characters) sc.characters = [];
  sc.characters.push(char);
  state.selected = { kind: 'sprite', ref: char };
  markDirty();
  renderAll();
}

// ---------- inspector (right panel) ----------
function renderRight() {
  const right = $('#right');
  right.innerHTML = '';
  const sceneHdr = document.createElement('div');
  sceneHdr.className = 'section';
  sceneHdr.innerHTML = `<h2>Scene — ${state.sceneId || '—'}</h2>`;
  right.appendChild(sceneHdr);

  const sc = getScene();
  if (sc) {
    right.appendChild(makeField('background', 'Background (assets/backgrounds/*.png)', makePlaceholder()));
    fillAsync($('#right .field[data-key="background"] .ctrl'), makeBgPicker(sc));
    right.appendChild(makeField('bgPalette', 'Palette', makePlaceholder()));
    fillAsync($('#right .field[data-key="bgPalette"] .ctrl'), makePalettePicker(sc));
    right.appendChild(makeField('music', 'Music (assets/audio/*)', makePlaceholder()));
    fillAsync($('#right .field[data-key="music"] .ctrl'), makeMusicPicker(sc));
    right.appendChild(makeField('ink', 'Ink file', makeTextInput(sc.ink || '', v => { sc.ink = v; markDirty(); })));
    // --- Scene tasks (per-scene, surfaced as toast hints + auto-completion) ---
    right.appendChild(makeTasksPanel(sc));
  }

  if (state.selected?.kind === 'sprite') {
    const c = state.selected.ref;
    right.appendChild(makeField('header', `Sprite — ${c.id}`));
    right.appendChild(makeField('position', 'Position slot',
      makeSelect(c.position || 'center',
        [['left','left'], ['center','center'], ['right','right'], ['bottomright','bottomright'], ['closeup','closeup']],
        v => { c.position = v; markDirty(); renderAll(); })));
    right.appendChild(makeField('placementY', 'placementY (0=top, 1=bottom)',
      makeNumberInput(typeof c.placementY === 'number' ? c.placementY : 0.97, v => { c.placementY = v; markDirty(); renderAll(); }, 0, 1, 0.01, 'placementY')));
    right.appendChild(makeField('targetH', 'targetH (fraction of canvas height)',
      makeNumberInput(typeof c.targetH === 'number' ? c.targetH : 0.85, v => { c.targetH = v; markDirty(); renderAll(); }, 0.05, 1.5, 0.01, 'targetH')));
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
    fillAsync($('#right .field[data-key="icon"] .ctrl'), makeIconPicker(it));
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
//   use_item     — { item, on_hitbox }
//   goto_hitbox  — { target } (label of a hitbox the player must click)
//   trigger_dialog — { ink_node } (resolved by Ink # goto:<node>)
//   combine      — { items[] } (future)
//   custom       — Ink calls EXTERNAL complete_task(id) when satisfied
// `hint` is shown in a toast when dialogue is dismissed and any task is
// still open; it disappears on completion.
const TASK_TYPES = ['pickup', 'use_item', 'goto_hitbox', 'trigger_dialog', 'combine', 'custom'];

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
    // orphan keys (e.g. an old `item` from a use_item row when switching
    // to a `goto_hitbox`).
    const oldKeys = Object.keys(t);
    t.type = typeSel.value;
    if (t.type === 'pickup')      { delete t.on_hitbox; delete t.items; delete t.ink_node; }
    else if (t.type === 'use_item'){ delete t.items; delete t.ink_node; }
    else if (t.type === 'goto_hitbox') { delete t.item; delete t.on_hitbox; delete t.items; delete t.ink_node; }
    else if (t.type === 'trigger_dialog') { delete t.item; delete t.on_hitbox; delete t.items; delete t.target; }
    else if (t.type === 'combine') { delete t.item; delete t.on_hitbox; delete t.ink_node; delete t.target; }
    else if (t.type === 'custom') { delete t.item; delete t.on_hitbox; delete t.items; delete t.ink_node; delete t.target; }
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
    appendField(row, 'on_hitbox', t.on_hitbox || '', v => { t.on_hitbox = v; markDirty(); },
      'hitbox label / target');
  } else if (t.type === 'goto_hitbox') {
    appendField(row, 'target', t.target || '', v => { t.target = v; markDirty(); },
      'hitbox label / target to click');
  } else if (t.type === 'trigger_dialog') {
    appendField(row, 'ink_node', t.ink_node || '', v => { t.ink_node = v; markDirty(); },
      'Ink knot name (# goto:...)');
  } else if (t.type === 'combine') {
    const itemsInput = document.createElement('input');
    itemsInput.type = 'text';
    itemsInput.placeholder = 'items (comma-separated)';
    itemsInput.value = (t.items || []).join(',');
    itemsInput.oninput = () => {
      t.items = itemsInput.value.split(',').map(s => s.trim()).filter(Boolean);
      markDirty();
    };
    row.appendChild(itemsInput);
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
async function fillAsync(container, asyncBuilder) {
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(makePlaceholder());
  try {
    const el = await asyncBuilder;
    container.innerHTML = '';
    container.appendChild(el);
  } catch (e) {
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
  i.oninput = () => onChange(parseFloat(i.value));
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
  const tres = files.filter(f => /\.tres$/.test(f));
  const noBg = document.createElement('option'); noBg.value = ''; noBg.textContent = '— none —'; sel.appendChild(noBg);
  for (const f of tres) {
    const o = document.createElement('option'); o.value = f.replace(/\.tres$/, ''); o.textContent = f; sel.appendChild(o);
  }
  sel.value = sc.bgPalette || '';
  sel.onchange = () => { sc.bgPalette = sel.value || null; markDirty(); };
  return sel;
}
async function makeMusicPicker(sc) {
  const sel = document.createElement('select');
  const files = await listDir('assets/audio');
  const audio = files.filter(f => /\.(mp3|mid|ogg)$/i.test(f));
  const noBg = document.createElement('option'); noBg.value = ''; noBg.textContent = '— none —'; sel.appendChild(noBg);
  for (const f of audio) {
    const o = document.createElement('option'); o.value = f; o.textContent = f; sel.appendChild(o);
  }
  sel.value = sc.music || '';
  sel.onchange = () => { sc.music = sel.value || null; markDirty(); };
  return sel;
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
  const id = prompt('Scene id (lowercase, no spaces):');
  if (!id) return;
  if (state.story.scenes[id]) { alert('already exists'); return; }
  state.story.scenes[id] = { id, kind: 'ink', bg: null, music: null, ink: 'ink/' + id + '.ink', characters: [], hitboxes: [] };
  state.sceneId = id;
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
  state.sceneId = ids.includes('alley') ? 'alley' : (ids[0] || null);
  setViewport(state.vpW, state.vpH);
  setupViewportToolbar();
  setupMobileTabs();
  setupDrawTool();
  await renderAll();
}
main().catch(err => { console.error(err); setStatus('ERROR: ' + err.message, 'error'); });