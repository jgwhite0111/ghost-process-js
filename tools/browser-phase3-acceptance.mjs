#!/usr/bin/env node
/*
 * Repository-owned Phase 3 + Phase 4 browser acceptance test.
 *
 * Owns the app server lifecycle, drives a real Chromium page over CDP, records
 * console/page errors, and leaves screenshots/reports under artifacts/browser.
 * It deliberately uses only Node's built-in WebSocket/fetch APIs.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PHASE4_PORT || process.env.PHASE3_PORT || 8876);
const BASE = `http://${HOST}:${PORT}`;
const CDP = process.env.BROWSER_CDP_URL || 'http://127.0.0.1:9222';
const ARTIFACTS = `${ROOT}/artifacts/browser`;
const STORY_PATH = `${ROOT}/story.json`;
const INK_PATH = `${ROOT}/ink/alley.ink`;
const originalStory = await readFile(STORY_PATH, 'utf8');
const originalInk = await readFile(INK_PATH, 'utf8');
const phase4InkFixture = `${originalInk.trimEnd()}\n\n=== Phase4Acceptance ===\n# phase4:heading\nPHASE 4 SYSTEM\n* [Open details]\n    # phase4:success\n    DETAILS SELECTED\n    -> END\n* [Cancel]\n    # phase4:dim\n    CANCELLED\n    -> END\n`;
const failures = [];
const checks = [];
const consoleErrors = [];
const pageErrors = [];
let server;
let cdp;
let sessionId;
let targetId;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  checks.push({ name, ok, detail: detail || undefined });
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) throw new Error(failures.at(-1));
}

async function waitFor(fn, timeout = 10000, label = 'condition') {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}${last ? ` (${String(last)})` : ''}`);
}

class CDPClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async connect() {
    const version = await fetch(`${this.url}/json/version`).then(r => {
      if (!r.ok) throw new Error(`CDP version HTTP ${r.status}`);
      return r.json();
    });
    this.ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else pending.resolve(msg.result || {});
        return;
      }
      const listeners = this.listeners.get(msg.method) || [];
      for (const listener of listeners) listener(msg.params || {});
    });
    this.ws.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP socket closed'));
      this.pending.clear();
    });
  }
  command(method, params = {}, session) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (session) message.sessionId = session;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, 20000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify(message));
    });
  }
  on(method, listener) {
    const list = this.listeners.get(method) || [];
    list.push(listener);
    this.listeners.set(method, list);
  }
  off(method, listener) {
    const list = this.listeners.get(method) || [];
    this.listeners.set(method, list.filter(item => item !== listener));
  }
  async close() { try { this.ws?.close(); } catch (_) {} }
}

async function startServer() {
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, HOST, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', data => { output += data; });
  server.stderr.on('data', data => { output += data; });
  server.on('exit', (code, signal) => {
    if (!globalThis.__shuttingDown && !failures.length) failures.push(`server exited early (${code ?? signal}): ${output}`);
  });
  await waitFor(async () => {
    if (server.exitCode !== null) throw new Error(`server exited ${server.exitCode}: ${output}`);
    const response = await fetch(`${BASE}/api/story`).catch(() => null);
    return response?.ok;
  }, 15000, 'server readiness endpoint');
  check('server readiness endpoint responds', true);
}

async function openPage() {
  cdp = new CDPClient(CDP);
  await cdp.connect();
  const created = await cdp.command('Target.createTarget', { url: 'about:blank' });
  targetId = created.targetId;
  const attached = await cdp.command('Target.attachToTarget', { targetId, flatten: true });
  sessionId = attached.sessionId;
  await cdp.command('Runtime.enable', {}, sessionId);
  await cdp.command('Page.enable', {}, sessionId);
  await cdp.command('Log.enable', {}, sessionId);
  cdp.on('Runtime.exceptionThrown', params => pageErrors.push(params.exceptionDetails?.text || 'uncaught exception'));
  cdp.on('Log.entryAdded', params => {
    const entry = params.entry;
    if (entry.level === 'error' && !String(entry.url || '').endsWith('/favicon.ico')) {
      consoleErrors.push(`${entry.text || 'browser log error'}${entry.url ? ` (${entry.url})` : ''}`);
    }
  });
  cdp.on('Runtime.consoleAPICalled', params => {
    const text = (params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ');
    if (params.type === 'error') consoleErrors.push(text);
  });
  await cdp.command('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false,
  }, sessionId);
}

async function evaluate(expression, awaitPromise = true) {
  const result = await cdp.command('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true, userGesture: true,
  }, sessionId);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'page evaluation failed';
    throw new Error(detail);
  }
  return result.result?.value;
}

async function navigate(path) {
  await cdp.command('Page.navigate', { url: `${BASE}${path}` }, sessionId);
  await waitFor(() => evaluate('document.readyState === "complete"'), 15000, `${path} load`);
}

async function pageWait(expression, label, timeout = 15000) {
  return waitFor(() => evaluate(expression), timeout, label);
}

async function click(selector) {
  return evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('missing ${selector}'); node.click(); return true; })()`);
}

async function clickText(selector, text) {
  return evaluate(`(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(n => n.textContent.includes(${JSON.stringify(text)})); if (!node) throw new Error('missing text ${text}'); node.click(); return true; })()`);
}

async function selectOverlay(id) {
  await clickText('#overlay-tree li', id);
  await pageWait(`state.selected?.kind === 'overlay' && state.selected?.ref?.id === ${JSON.stringify(id)} && document.querySelector('#right .field[data-key="parent"] select')`, `${id} inspector`);
}

async function setSelect(selector, value) {
  return evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('missing select'); node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('change', { bubbles: true })); return node.value; })()`);
}

async function screenshot(name) {
  const result = await cdp.command('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  await writeFile(`${ARTIFACTS}/${name}.png`, Buffer.from(result.data, 'base64'));
}

async function mouse(type, x, y, buttons = 0) {
  await cdp.command('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0 }, sessionId);
}

async function drag(selector, dx, dy, grip = false) {
  const rect = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); const r = ((${JSON.stringify(grip)}) ? node.querySelector('.resize') : node).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const x = rect.x + rect.w / 2, y = rect.y + rect.h / 2;
  await mouse('mouseMoved', x, y);
  await mouse('mousePressed', x, y, 1);
  await mouse('mouseMoved', x + dx, y + dy, 1);
  await mouse('mouseReleased', x + dx, y + dy, 0);
}

async function runEditorAcceptance() {
  await navigate('/editor.html');
  await pageWait(`typeof state !== 'undefined' && state.story && state.sceneId === 'alley'`, 'editor story load');
  check('editor opened on alley scene', await evaluate('state.sceneId === "alley"'));
  await screenshot('editor-initial');

  for (const type of ['container', 'image', 'text', 'hotspot']) await click(`[data-overlay-add="${type}"]`);
  await pageWait('state.story.scenes.alley.overlay.elements.length === 4', 'overlay creation');
  check('editor creates container/image/text/hotspot', await evaluate('state.story.scenes.alley.overlay.elements.map(e => e.type).join(",") === "container,image,text,hotspot"'));

  // Keep the handles spatially separate so the pointer test hits the selected
  // element rather than a later-painted overlapping sibling.
  for (const [id, x, y] of [['text_3', '0.4', '0.1'], ['hotspot_4', '0.65', '0.65']]) {
    await selectOverlay(id);
    for (const [key, value] of [['x', x], ['y', y]]) {
      await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(`#right .field[data-key="${key}"] input`)}); n.value = ${JSON.stringify(value)}; n.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    }
  }

  await selectOverlay('container_1');
  await click('#right .field[data-key="clip"] input');
  check('container clipping is authorable', await evaluate('state.story.scenes.alley.overlay.elements.find(e => e.id === "container_1").clip === true'));

  await selectOverlay('image_2');
  await setSelect('#right .field[data-key="parent"] select', 'container_1');
  await pageWait('state.story.scenes.alley.overlay.elements.find(e => e.id === "image_2").parent === "container_1"', 'nested parent');
  const geometry = await evaluate(`(() => {
    const sc = state.story.scenes.alley; const parent = sc.overlay.elements.find(e => e.id === 'container_1'); const child = sc.overlay.elements.find(e => e.id === 'image_2');
    const stage = overlayStage(); const node = document.querySelector('[data-key="overlay:image_2"]');
    const r = { left: parseFloat(node.style.left), top: parseFloat(node.style.top), width: parseFloat(node.style.width), height: parseFloat(node.style.height) };
    const expected = { left: stage.x + (parent.x + child.x * parent.w) * stage.w, top: stage.y + (parent.y + child.y * parent.h) * stage.h, width: child.w * parent.w * stage.w, height: child.h * parent.h * stage.h };
    return { r, expected, stage };
  })()`);
  check('nested overlay layout uses fitted stage geometry', Math.abs(geometry.r.left - geometry.expected.left) < 2 && Math.abs(geometry.r.width - geometry.expected.width) < 2, JSON.stringify(geometry));
  await screenshot('editor-nested-layout');

  const beforeMove = await evaluate('state.story.scenes.alley.overlay.elements.find(e => e.id === "image_2").x');
  await drag('[data-key="overlay:image_2"]', 40, 20);
  const afterMove = await evaluate('state.story.scenes.alley.overlay.elements.find(e => e.id === "image_2").x');
  check('overlay drag changes normalized position', afterMove > beforeMove, `${beforeMove} -> ${afterMove}`);
  const beforeResize = await evaluate('state.story.scenes.alley.overlay.elements.find(e => e.id === "image_2").w');
  await drag('[data-key="overlay:image_2"]', 30, 15, true);
  const afterResize = await evaluate('state.story.scenes.alley.overlay.elements.find(e => e.id === "image_2").w');
  check('overlay resize changes normalized size', afterResize > beforeResize, `${beforeResize} -> ${afterResize}`);

  await click('#right .field[data-key="locked"] input');
  const lockedBefore = await evaluate('state.story.scenes.alley.overlay.elements.find(e => e.id === "image_2").x');
  await drag('[data-key="overlay:image_2"]', 45, 25);
  const lockedAfter = await evaluate('state.story.scenes.alley.overlay.elements.find(e => e.id === "image_2").x');
  check('locked overlay does not move', lockedAfter === lockedBefore, `${lockedBefore} -> ${lockedAfter}`);
  await click('#right .field[data-key="locked"] input');

  await selectOverlay('text_3');
  await clickText('#right button', 'Duplicate');
  await pageWait('state.story.scenes.alley.overlay.elements.some(e => e.id === "text_3_copy")', 'duplicate');
  check('overlay duplicate is inserted', await evaluate('state.story.scenes.alley.overlay.elements.length === 5'));
  await selectOverlay('text_3_copy');
  await clickText('#right button', '↑ reorder');
  check('overlay reorder changes array order', await evaluate('state.story.scenes.alley.overlay.elements.findIndex(e => e.id === "text_3_copy") < state.story.scenes.alley.overlay.elements.findIndex(e => e.id === "text_3")'));
  await clickText('#right button', 'Delete');
  await pageWait('!state.story.scenes.alley.overlay.elements.some(e => e.id === "text_3_copy")', 'delete');
  check('overlay deletion removes duplicate', true);

  await selectOverlay('text_3');
  const textArea = '#right .field[data-key="content"] .overlay-content-editor textarea';
  await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(textArea)}); n.value = 'PHASE 3'; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  check('text inspector edits authored text', await evaluate('state.story.scenes.alley.overlay.elements.find(e => e.id === "text_3").text === "PHASE 3"'));

  await selectOverlay('hotspot_4');
  await clickText('.actions-list button', '+ action');
  await setSelect('.actions-list select', 'giveItem');
  await pageWait('document.querySelectorAll(".actions-list select").length >= 2', 'action payload control');
  await setSelect('.actions-list select:nth-of-type(2)', 'rusty_key');
  check('typed hotspot action is editable', await evaluate('state.story.scenes.alley.overlay.elements.find(e => e.id === "hotspot_4").events.activate.actions[0].item === "rusty_key"'));

  await setSelect('#right .field[data-key="bgFit"] select', 'contain');
  await click('#right .field[data-key="hudInventory"] input');
  check('scene bgFit and HUD fields are authorable', await evaluate('state.story.scenes.alley.bgFit === "contain" && state.story.scenes.alley.hud.inventory === false'));

  await click('#save-btn');
  await pageWait('document.querySelector("#status")?.textContent.trim().toLowerCase().startsWith("saved")', 'editor save');
  const persisted = await fetch(`${BASE}/api/story`).then(r => r.json());
  check('editor save persists overlay schema', persisted.scenes.alley.overlay.elements.length === 4 && persisted.scenes.alley.bgFit === 'contain' && persisted.scenes.alley.hud.inventory === false);
  await click('#reload-btn');
  await pageWait('state.story.scenes.alley.overlay.elements.length === 4 && state.dirty === false', 'editor reload');
  check('editor reload restores persisted overlay', await evaluate('state.story.scenes.alley.overlay.elements.some(e => e.id === "hotspot_4")'));

  await clickText('#scene-list li', 'cold_open');
  await pageWait('state.sceneId === "cold_open" && document.querySelectorAll(".overlay-element-handle").length === 0', 'editor scene switch away');
  check('editor scene switch removes prior overlay handles', true);
  await clickText('#scene-list li', 'alley');
  await pageWait('state.sceneId === "alley" && document.querySelectorAll(".overlay-element-handle").length === 4', 'editor scene switch back');
  check('editor scene switch remounts overlay handles', true);
  await screenshot('editor-final');
}

async function runPhase4EditorAcceptance() {
  // Add dedicated text regions for Ink lines and choices so authored container
  // hierarchy from Phase 3 remains untouched.
  await click('[data-overlay-add="text"]');
  await click('[data-overlay-add="text"]');
  await pageWait('state.story.scenes.alley.overlay.elements.length === 6', 'Phase 4 content regions');

  // Scene-local view CRUD is exercised through the editor controls. Exact
  // object state is inspected through CDP without adding production globals.
  await evaluate('state.selected = null; renderRight(); true');
  await clickText('.scene-views-editor button', '+ view');
  await clickText('.scene-views-editor button', '+ view');
  await evaluate(`(() => {
    const rename = (index, value) => {
      const input = document.querySelectorAll('.scene-views-editor > .row input')[index];
      if (!input) throw new Error('missing view input ' + index);
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    rename(0, 'overview'); return true;
  })()`);
  await evaluate(`(() => {
    const input = document.querySelectorAll('.scene-views-editor > .row input')[1];
    if (!input) throw new Error('missing second view input');
    input.value = 'details'; input.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`);
  await setSelect('.scene-views-editor .field[data-key="initialView"] select', 'overview');
  check('editor authors scene-local views and initialView', await evaluate(`JSON.stringify(state.story.scenes.alley.overlay.views) === '["overview","details"]' && state.story.scenes.alley.overlay.initialView === 'overview'`));

  await selectOverlay('text_5');
  await setSelect('#right .field[data-key="content"] .overlay-content-editor > select', 'inkLines');
  await evaluate(`(() => {
    const el = state.story.scenes.alley.overlay.elements.find(e => e.id === 'text_5');
    el.content.tagStyles = {'phase4:heading':'heading','phase4:success':'success','phase4:dim':'dim'};
    markDirty(); renderAll(); return true;
  })()`);

  await selectOverlay('text_6');
  await setSelect('#right .field[data-key="content"] .overlay-content-editor > select', 'inkChoices');
  await setSelect('#right .field[data-key="controlPreset"] select', 'terminal-command');
  // Restrict choices to details in the real membership editor and mark that
  // view active for presentation.
  await evaluate(`(() => {
    const toggle = (key, labelText, checked) => {
      const field = document.querySelector('#right .field[data-key="' + key + '"]');
      const label = [...field.querySelectorAll('label')].find(node => node.textContent.trim() === labelText);
      if (!label) throw new Error('missing membership ' + key + ':' + labelText);
      const input = label.querySelector('input'); input.checked = checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    toggle('visibleIn', 'overview', false); return true;
  })()`);
  await selectOverlay('text_6');
  await evaluate(`(() => {
    const field = document.querySelector('#right .field[data-key="activeIn"]');
    const label = [...field.querySelectorAll('label')].find(node => node.textContent.trim() === 'details');
    const input = label.querySelector('input'); input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true })); return true;
  })()`);

  // The same shared action data is surfaced by both activate and
  // choiceSelected editors; direct lexical mutation avoids test-only exports.
  await evaluate(`(() => {
    const elements = state.story.scenes.alley.overlay.elements;
    const hotspot = elements.find(e => e.id === 'hotspot_4');
    hotspot.events.activate.actions.push(
      {type:'setView', view:'details'},
      {type:'openInk', knot:'Phase4Acceptance'}
    );
    const choices = elements.find(e => e.id === 'text_6');
    choices.events = {choiceSelected:{actions:[{type:'setView', view:'overview'}]}};
    markDirty(); renderAll(); return true;
  })()`);
  await selectOverlay('hotspot_4');
  check('editor surfaces setView and openInk activate actions', await evaluate(`[...document.querySelectorAll('#right .field[data-key="actions"] .actions-list .row select:first-child')].map(n => n.value).join(',') === 'giveItem,setView,openInk'`));
  await selectOverlay('text_6');
  check('editor surfaces choiceSelected actions', await evaluate(`document.querySelector('#right .field[data-key="choiceSelected"] .actions-list .row select')?.value === 'setView'`));

  await setSelect('#overlay-preview-view', 'overview');
  await pageWait('document.querySelectorAll(".overlay-element-handle").length === 5', 'overview preview filtering');
  await setSelect('#overlay-preview-view', 'details');
  await pageWait('document.querySelectorAll(".overlay-element-handle").length === 6', 'details preview filtering');
  check('preview selection stays transient', await evaluate(`state.previewView === 'details' && !Object.prototype.hasOwnProperty.call(state.story.scenes.alley.overlay, 'previewView')`));
  await screenshot('editor-phase4-details');

  await click('#save-btn');
  await pageWait(`(() => { const text = document.querySelector('#status')?.textContent.trim().toLowerCase() || ''; return text.startsWith('saved') || text.includes('failed'); })()`, 'Phase 4 editor save response');
  const saveStatus = await evaluate(`document.querySelector('#status')?.textContent.trim() || ''`);
  check('Phase 4 editor save succeeds', saveStatus.toLowerCase().startsWith('saved'), saveStatus);
  const persisted = await fetch(`${BASE}/api/story`).then(r => r.json());
  const overlay = persisted.scenes.alley.overlay;
  check('Phase 4 editor save persists views and Ink bindings', overlay.elements.length === 6
    && overlay.views.join(',') === 'overview,details'
    && overlay.initialView === 'overview'
    && overlay.elements.find(e => e.id === 'text_5')?.content?.source === 'inkLines'
    && overlay.elements.find(e => e.id === 'text_6')?.content?.source === 'inkChoices');
  check('preview view is never serialized', !Object.prototype.hasOwnProperty.call(overlay, 'previewView'));
  await click('#reload-btn');
  await pageWait(`state.story.scenes.alley.overlay.views.join(',') === 'overview,details' && state.dirty === false`, 'Phase 4 editor reload');
  check('Phase 4 references survive reload', await evaluate(`(() => {
    const elements = state.story.scenes.alley.overlay.elements;
    return elements.find(e => e.id === 'hotspot_4').events.activate.actions.some(a => a.type === 'setView' && a.view === 'details')
      && elements.find(e => e.id === 'text_6').events.choiceSelected.actions.some(a => a.type === 'setView' && a.view === 'overview');
  })()`));
}

async function runRuntimeAcceptance() {
  await navigate('/index.html?scene=alley');
  await pageWait('window.Engine?._state?.current?.sceneId === "alley" && document.querySelectorAll(".scene-overlay-root").length === 1 && document.querySelector("#inventory-button")?.hidden === true && getComputedStyle(document.querySelector("#inventory-button")).display === "none" && getComputedStyle(document.querySelector(".dialogue-box")).display === "none"', 'runtime alley overlay and HUD');
  const runtime = await evaluate(`(() => {
    const root = document.querySelector('.scene-overlay-root'); const stage = document.querySelector('.scene-overlay-stage');
    const parent = document.querySelector('[data-overlay-id="container_1"]'); const child = document.querySelector('[data-overlay-id="image_2"]');
    const hud = document.querySelector('#inventory-button');
    return { roots: document.querySelectorAll('.scene-overlay-root').length, children: root?.querySelectorAll('.scene-overlay-element').length, nested: child?.parentElement === parent, overflow: getComputedStyle(parent).overflow, stage: stage ? {left: stage.offsetLeft, top: stage.offsetTop, width: stage.offsetWidth, height: stage.offsetHeight} : null, hudHidden: hud?.hidden, hudDisplay: hud ? getComputedStyle(hud).display : null, dialogueDisplay: getComputedStyle(document.querySelector('.dialogue-box')).display };
  })()`);
  check('runtime renders all overlay elements once', runtime.roots === 1 && runtime.children === 6, JSON.stringify(runtime));
  check('runtime preserves hierarchy and clipping', runtime.nested && runtime.overflow === 'hidden');
  check('runtime contain fit uses a fitted 4:3 stage', runtime.stage && runtime.stage.width > 0 && runtime.stage.height > 0 && Math.abs(runtime.stage.width / runtime.stage.height - 4 / 3) < 0.02, JSON.stringify(runtime.stage));
  check('runtime HUD visibility follows scene config', runtime.hudHidden === true && runtime.hudDisplay === 'none', JSON.stringify({ hidden: runtime.hudHidden, display: runtime.hudDisplay }));
  check('generic Ink bindings suppress the global dialogue panel', runtime.dialogueDisplay === 'none', runtime.dialogueDisplay);
  await screenshot('runtime-alley');

  const hotspotRect = await evaluate(`(() => { const r = document.querySelector('[data-overlay-id="hotspot_4"]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await mouse('mouseMoved', hotspotRect.x, hotspotRect.y);
  await mouse('mousePressed', hotspotRect.x, hotspotRect.y, 1);
  await mouse('mouseReleased', hotspotRect.x, hotspotRect.y, 0);
  await pageWait('window.STATE.inventory.includes("rusty_key") && document.querySelector(".scene-overlay-root")?.dataset.activeView === "details" && document.querySelectorAll("[data-overlay-id=text_6] .scene-overlay-ink-choice").length === 2', 'hotspot pointer activation and Phase 4 view/Ink action', 5000);
  check('hotspot pointer activation executes typed giveItem', true);
  check('setView exposes the details-only choice region', await evaluate(`!document.querySelector('[data-overlay-id="text_6"]').hidden && document.querySelector('[data-overlay-id="text_6"]').dataset.active === 'true'`));
  check('openInk renders tagged lines and authored choice controls', await evaluate(`document.querySelector('[data-overlay-id="text_5"] .overlay-tag-heading')?.textContent === 'PHASE 4 SYSTEM' && [...document.querySelectorAll('[data-overlay-id="text_6"] button')].every(node => node.dataset.controlPreset === 'terminal-command')`));
  await screenshot('runtime-phase4-details');
  await click('[data-overlay-id="text_6"] button');
  await pageWait('document.querySelector(".scene-overlay-root")?.dataset.activeView === "overview" && document.querySelector("[data-overlay-id=text_6]")?.hidden === true', 'choiceSelected setView action');
  check('choiceSelected returns to overview through the shared executor', true);
  check('Ink continuation renders the selected result', await evaluate(`document.querySelector('[data-overlay-id="text_5"] .overlay-tag-success')?.textContent === 'DETAILS SELECTED'`));
  await screenshot('runtime-phase4-choice');
  await evaluate('window.STATE.inventory = []; window.Inventory?._updateCount?.();');
  await evaluate('document.querySelector("[data-overlay-id=hotspot_4]").focus();');
  check('hotspot can receive keyboard focus', await evaluate('document.activeElement?.dataset?.overlayId === "hotspot_4"'));
  await cdp.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
  await cdp.command('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
  await cdp.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
  await pageWait('window.STATE.inventory.includes("rusty_key")', 'hotspot Enter activation', 5000);
  check('hotspot Enter activation executes typed giveItem', true);

  await evaluate('window.Engine.goTo("cold_open")');
  await pageWait('window.Engine?._state?.current?.sceneId === "cold_open" && document.querySelectorAll(".scene-overlay-root").length === 0', 'runtime teardown');
  check('runtime teardown removes overlay DOM on scene switch', true);
  await evaluate('window.Engine.goTo("alley")');
  await pageWait('window.Engine?._state?.current?.sceneId === "alley" && document.querySelectorAll(".scene-overlay-root").length === 1', 'runtime re-entry');
  const roots = await evaluate('document.querySelectorAll(".scene-overlay-root").length');
  check('runtime re-entry does not leak duplicate overlay roots', roots === 1, String(roots));
  await screenshot('runtime-reentry');
}

async function cleanup() {
  globalThis.__shuttingDown = true;
  try { await writeFile(STORY_PATH, originalStory); } catch (error) { failures.push(`restore story.json: ${error.message}`); }
  try { await writeFile(INK_PATH, originalInk); } catch (error) { failures.push(`restore ink/alley.ink: ${error.message}`); }
  try {
    if (targetId && cdp) await Promise.race([
      cdp.command('Target.closeTarget', { targetId }),
      sleep(1000),
    ]);
  } catch (_) {}
  await cdp?.close();
  if (server && server.exitCode === null) server.kill('SIGTERM');
  await sleep(200);
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, async () => {
    try { await cleanup(); } finally { process.exit(code); }
  });
}

await mkdir(ARTIFACTS, { recursive: true });
try {
  await writeFile(INK_PATH, phase4InkFixture);
  await startServer();
  await openPage();
  await runEditorAcceptance();
  await runPhase4EditorAcceptance();
  await runRuntimeAcceptance();
} catch (error) {
  failures.push(error.message || String(error));
  try { await screenshot('failure'); } catch (_) {}
} finally {
  await cleanup();
}

const report = {
  ok: failures.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0,
  base: BASE,
  checks,
  failures,
  consoleErrors,
  pageErrors,
  artifacts: ARTIFACTS,
};
await writeFile(`${ARTIFACTS}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
