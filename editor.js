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
  story: null,                  // server-side story.json
  sceneId: null,                // currently selected scene id
  selected: null,               // { kind: 'sprite'|'hitbox'|'item', ref: ... }
  bgImages: {},                 // filename -> HTMLImageElement (cache)
  spriteFrames: {},             // charId -> [HTMLImageElement] (first frame)
  tool: 'select',               // 'select' | 'draw-hitbox'
  dirty: false,
};

// ---------- canvas ----------
const CANVAS_W = 390, CANVAS_H = 844;
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
  // Frames is a glob like "assets/sprites/<id>/<scene>/idle_*.png".
  // Strip the "*.png" tail and list the parent dir, then pick the
  // first matching file.
  const dir = sceneCfg.frames.replace(/[\\/][^\\/]*\*\.[^\\/]*$/, '');
  const list = await listDir(dir);
  if (!list || list.length === 0) return null;
  const baseName = sceneCfg.frames.replace(/^.*[\\/]/, '').replace(/\*\.png$/, '').replace(/\*$/, '');
  let framePath = null;
  // First try the prefix match
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

// ---------- left panel: scenes ----------
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

// ---------- preview canvas ----------
function getScene() { return state.story.scenes[state.sceneId]; }

function placementYFor(charConfig) {
  if (typeof charConfig.placementY === 'number') {
    const v = charConfig.placementY;
    return (v >= 0 && v <= 1) ? CANVAS_H * v : v;
  }
  return CANVAS_H - 30;
}

function targetHFor(charConfig) {
  if (typeof charConfig.targetH === 'number') {
    const v = charConfig.targetH;
    return (v >= 0 && v <= 2) ? CANVAS_H * v : v;
  }
  return CANVAS_H * 0.85;
}

function placementXFor(charConfig, spriteW) {
  const pos = charConfig.position || 'center';
  if (pos === 'bottomright' && spriteW) return CANVAS_W - 20 - spriteW / 2;
  switch (pos) {
    case 'left':       return CANVAS_W * 0.25;
    case 'right':      return CANVAS_W * 0.75;
    case 'bottomright': return CANVAS_W - 20;
    case 'closeup':    return CANVAS_W * 0.50;
    case 'center':
    default:           return CANVAS_W * 0.50;
  }
}

function computeSpriteRect(charConfig) {
  const img = state.spriteFrames[charConfig.id + '/' + state.sceneId];
  if (!img) return null;
  let scale = targetHFor(charConfig) / img.height;
  const maxW = CANVAS_W * 0.95;
  if (img.width * scale > maxW) scale = maxW / img.width;
  const w = img.width * scale;
  const h = img.height * scale;
  const cx = placementXFor(charConfig, w);
  const cy = placementYFor(charConfig);
  return { x: cx - w / 2, y: cy - h, w, h };
}

function hitboxRectPx(hb) {
  return {
    x: hb.x * CANVAS_W,
    y: hb.y * CANVAS_H,
    w: hb.w * CANVAS_W,
    h: hb.h * CANVAS_H,
  };
}

async function renderPreview() {
  bgCtx.fillStyle = '#000';
  bgCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const sc = getScene();
  if (!sc) return;
  if (sc.bg) {
    try {
      const img = await loadImage(`assets/backgrounds/${sc.bg}.png`);
      // Cover-fit
      const sa = CANVAS_W / CANVAS_H, sb = img.width / img.height;
      let dw, dh, dx, dy;
      if (sb > sa) { dh = CANVAS_H; dw = dh * sb; dx = (CANVAS_W - dw) / 2; dy = 0; }
      else         { dw = CANVAS_W; dh = dw / sb; dx = 0; dy = (CANVAS_H - dh) / 2; }
      bgCtx.drawImage(img, dx, dy, dw, dh);
    } catch (e) { /* skip */ }
  }

  // Draw sprites into bg canvas (mirror game rendering)
  for (const c of (sc.characters || [])) {
    const img = state.spriteFrames[c.id + '/' + state.sceneId];
    if (!img) continue;
    const r = computeSpriteRect(c);
    if (r) bgCtx.drawImage(img, r.x, r.y, r.w, r.h);
  }

  // Overlay DOM handles
  renderOverlay();
}

function renderOverlay() {
  overlay.innerHTML = '';
  const sc = getScene();
  if (!sc) return;

  for (const c of (sc.characters || [])) {
    const r = computeSpriteRect(c);
    if (!r) continue;
    const div = document.createElement('div');
    div.className = 'sprite-handle';
    if (state.selected?.kind === 'sprite' && state.selected.ref === c) div.classList.add('selected');
    div.style.left = r.x + 'px';
    div.style.top = r.y + 'px';
    div.style.width = r.w + 'px';
    div.style.height = r.h + 'px';
    const lbl = document.createElement('span');
    lbl.className = 'label';
    lbl.textContent = c.id;
    div.appendChild(lbl);
    const grip = document.createElement('span');
    grip.className = 'resize';
    div.appendChild(grip);
    attachSpriteDrag(div, c, r);
    overlay.appendChild(div);
  }

  for (let i = 0; i < (sc.hitboxes || []).length; i++) {
    const hb = sc.hitboxes[i];
    const r = hitboxRectPx(hb);
    const div = document.createElement('div');
    div.className = 'hitbox-handle';
    if (state.selected?.kind === 'hitbox' && state.selected.ref === hb) div.classList.add('selected');
    div.style.left = r.x + 'px';
    div.style.top = r.y + 'px';
    div.style.width = r.w + 'px';
    div.style.height = r.h + 'px';
    const lbl = document.createElement('span');
    lbl.className = 'label';
    lbl.textContent = hb.item || ('hb[' + i + ']');
    div.appendChild(lbl);
    const grip = document.createElement('span');
    grip.className = 'resize';
    div.appendChild(grip);
    attachHitboxDrag(div, hb, i, r);
    overlay.appendChild(div);
  }
}

// ---------- sprite drag (sets placementY fraction + position label) ----------
function attachSpriteDrag(div, charConfig, rect) {
  div.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize')) {
      e.preventDefault(); e.stopPropagation();
      state.selected = { kind: 'sprite', ref: charConfig };
      renderRight(); renderOverlay();
      startSpriteResize(div, charConfig);
    } else {
      e.preventDefault();
      state.selected = { kind: 'sprite', ref: charConfig };
      renderRight(); renderOverlay();
      startSpriteMove(div, charConfig);
    }
  });
}

function startSpriteMove(handle, charConfig) {
  const startY = handle.getBoundingClientRect().top;
  const startPY = placementYFor(charConfig);
  const move = (ev) => {
    const dy = ev.clientY - startY;
    // placementY = CANVAS_H - handle.offsetTop - dy - handle.offsetHeight   (new feet-y in px)
    const newFeetPy = startPY + dy;
    charConfig.placementY = Math.max(0, Math.min(1, newFeetPy / CANVAS_H));
    renderPreview();
    renderRight();
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    markDirty();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}

function startSpriteResize(handle, charConfig) {
  const startH = handle.offsetHeight;
  const startTH = targetHFor(charConfig);
  const move = (ev) => {
    const dy = ev.clientY - handle.getBoundingClientRect().top - startH;
    const newTH = startTH + dy;
    charConfig.targetH = Math.max(40, newTH) / CANVAS_H;
    renderPreview();
    renderRight();
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    markDirty();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}

// ---------- hitbox drag ----------
function attachHitboxDrag(div, hb, idx, rect) {
  div.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize')) {
      e.preventDefault(); e.stopPropagation();
      state.selected = { kind: 'hitbox', ref: hb, idx };
      renderRight(); renderOverlay();
      startHitboxResize(div, hb);
    } else {
      e.preventDefault();
      state.selected = { kind: 'hitbox', ref: hb, idx };
      renderRight(); renderOverlay();
      startHitboxMove(div, hb);
    }
  });
}

function startHitboxMove(handle, hb) {
  const startX = handle.getBoundingClientRect().left;
  const startY = handle.getBoundingClientRect().top;
  const move = (ev) => {
    const dx = (ev.clientX - startX) / CANVAS_W;
    const dy = (ev.clientY - startY) / CANVAS_H;
    hb.x = Math.max(0, Math.min(1 - hb.w, hb.x + dx));
    hb.y = Math.max(0, Math.min(1 - hb.h, hb.y + dy));
    renderPreview();
    renderRight();
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    markDirty();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}

function startHitboxResize(handle, hb) {
  const move = (ev) => {
    const r = handle.getBoundingClientRect();
    const newW = (ev.clientX - r.left) / CANVAS_W;
    const newH = (ev.clientY - r.top) / CANVAS_H;
    hb.w = Math.max(0.02, Math.min(1 - hb.x, newW));
    hb.h = Math.max(0.02, Math.min(1 - hb.y, newH));
    renderPreview();
    renderRight();
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    markDirty();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
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
  if (t === 'draw-hitbox') {
    banner.textContent = 'Draw hitbox: click + drag inside the canvas';
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

let drawStart = null;
function onFrameDown(e) {
  if (state.tool !== 'draw-hitbox') return;
  if (e.target.closest('.sprite-handle, .hitbox-handle')) return;
  const r = frame.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  drawStart = { x, y };
  // preview while dragging
  const move = (ev) => {
    const cx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const cy = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
    showDrawPreview(Math.min(drawStart.x, cx), Math.min(drawStart.y, cy),
                    Math.abs(cx - drawStart.x), Math.abs(cy - drawStart.y));
  };
  const up = (ev) => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    const cx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const cy = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
    const x = Math.min(drawStart.x, cx);
    const y = Math.min(drawStart.y, cy);
    const w = Math.abs(cx - drawStart.x);
    const h = Math.abs(cy - drawStart.y);
    if (w > 0.02 && h > 0.02) {
      addNewHitbox(x, y, w, h);
    }
    drawStart = null;
    hideDrawPreview();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}

function showDrawPreview(x, y, w, h) {
  let pv = $('#draw-preview');
  if (!pv) {
    pv = document.createElement('div');
    pv.id = 'draw-preview';
    pv.style.cssText = 'position:absolute;border:1px dashed #6cba6c;background:rgba(108,186,108,0.1);box-sizing:border-box;pointer-events:none;z-index:999';
    overlay.appendChild(pv);
  }
  pv.style.left = (x * CANVAS_W) + 'px';
  pv.style.top = (y * CANVAS_H) + 'px';
  pv.style.width = (w * CANVAS_W) + 'px';
  pv.style.height = (h * CANVAS_H) + 'px';
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
  setTool('select');
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

// ---------- right panel: properties ----------
function renderRight() {
  const right = $('#right');
  right.innerHTML = '';

  // Scene header
  const sceneHdr = document.createElement('div');
  sceneHdr.className = 'section';
  sceneHdr.innerHTML = `<h2>Scene — ${state.sceneId || '—'}</h2>`;
  right.appendChild(sceneHdr);

  const sc = getScene();
  if (sc) {
    // Background picker — async, inserted into a placeholder div so we
    // can await it.
    right.appendChild(makeField('background', 'Background (file in assets/backgrounds/)', makePlaceholder()));
    fillAsync($('#right .field[data-key="background"] .ctrl'), makeBgPicker(sc));
    right.appendChild(makeField('bgPalette', 'Palette', makePlaceholder()));
    fillAsync($('#right .field[data-key="bgPalette"] .ctrl'), makePalettePicker(sc));
    right.appendChild(makeField('music', 'Music (file in assets/audio/)', makePlaceholder()));
    fillAsync($('#right .field[data-key="music"] .ctrl'), makeMusicPicker(sc));
    right.appendChild(makeField('ink', 'Ink file (ink/*.ink)', makeTextInput(sc.ink || '', v => { sc.ink = v; markDirty(); })));
  }

  if (state.selected?.kind === 'sprite') {
    const c = state.selected.ref;
    right.appendChild(makeField('header', `Sprite — ${c.id}`));
    right.appendChild(makeField('position', 'Position slot',
      makeSelect(c.position || 'center',
        [['left','left'], ['center','center'], ['right','right'], ['bottomright','bottomright'], ['closeup','closeup']],
        v => { c.position = v; markDirty(); renderAll(); })));
    right.appendChild(makeField('placementY', 'placementY (fraction of canvas)',
      makeNumberInput(typeof c.placementY === 'number' ? c.placementY : 0.97, v => { c.placementY = v; markDirty(); renderAll(); }, 0, 1, 0.01)));
    right.appendChild(makeField('targetH', 'targetH (fraction of canvas)',
      makeNumberInput(typeof c.targetH === 'number' ? c.targetH : 0.85, v => { c.targetH = v; markDirty(); renderAll(); }, 0.1, 2, 0.01)));
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
    row.appendChild(makeField('x', 'x', makeNumberInput(hb.x, v => { hb.x = v; markDirty(); renderAll(); }, 0, 1, 0.01)));
    row.appendChild(makeField('y', 'y', makeNumberInput(hb.y, v => { hb.y = v; markDirty(); renderAll(); }, 0, 1, 0.01)));
    right.appendChild(row);
    const row2 = document.createElement('div'); row2.className = 'row';
    row2.appendChild(makeField('w', 'w', makeNumberInput(hb.w, v => { hb.w = v; markDirty(); renderAll(); }, 0, 1, 0.01)));
    row2.appendChild(makeField('h', 'h', makeNumberInput(hb.h, v => { hb.h = v; markDirty(); renderAll(); }, 0, 1, 0.01)));
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
    const h = document.createElement('h2'); h.textContent = labelText; h.style.marginTop = '12px';
    div.appendChild(h);
    return div;
  }
  const lbl = document.createElement('label'); lbl.textContent = labelText; div.appendChild(lbl);
  const ctrl = document.createElement('div'); ctrl.className = 'ctrl'; ctrl.appendChild(controlEl);
  div.appendChild(ctrl);
  return div;
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
  const i = document.createElement('input');
  i.type = 'text'; i.value = value;
  i.oninput = () => onChange(i.value);
  return i;
}
function makeTextArea(value, onChange) {
  const i = document.createElement('textarea');
  i.value = value;
  i.oninput = () => onChange(i.value);
  return i;
}
function makeNumberInput(value, onChange, min, max, step) {
  const i = document.createElement('input');
  i.type = 'number'; i.value = value; if (min !== undefined) i.min = min; if (max !== undefined) i.max = max; if (step !== undefined) i.step = step;
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
  const i = document.createElement('input');
  i.type = 'checkbox'; i.checked = value;
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
  // The palette names are the bgPalette values; read from the palette file listing if available
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
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- main render ----------
async function renderAll() {
  renderSceneList();
  renderItemList();
  $('#scene-name').textContent = state.sceneId ? `scene: ${state.sceneId}` : '— no scene —';

  const sc = getScene();
  if (sc) {
    // Preload sprites for this scene
    for (const c of (sc.characters || [])) {
      try { await loadSpriteFrame(c, state.sceneId); } catch (e) { /* missing sprite — skip */ }
    }
  }

  await renderPreview();
  renderRight();
}

async function main() {
  await loadStory();
  // Default to alley if it exists, else first scene
  const ids = Object.keys(state.story.scenes || {});
  state.sceneId = ids.includes('alley') ? 'alley' : (ids[0] || null);
  setupDrawTool();
  await renderAll();
}
main().catch(err => {
  console.error(err);
  setStatus('ERROR: ' + err.message, 'dirty');
});