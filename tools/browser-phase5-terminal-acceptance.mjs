#!/usr/bin/env node
/* Phase 5 raw-CDP acceptance for the data-driven terminal_ui overlay. */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PHASE5_PORT || 8877);
const BASE = `http://${HOST}:${PORT}`;
const CDP_URL = process.env.BROWSER_CDP_URL || 'http://127.0.0.1:9222';
const OUT = `${ROOT}/artifacts/browser`;
const checks = [], failures = [], consoleErrors = [], pageErrors = [], states = [];
let server, targetId, sessionId, cdp;

function check(name, condition, detail = '') {
  const ok = Boolean(condition); checks.push({ name, ok, detail: detail || undefined });
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
async function waitFor(fn, timeout = 15000, label = 'condition') {
  const started = Date.now(); let last;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}${last ? ` (${String(last)})` : ''}`);
}
class CDPClient {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    const version = await fetch(`${this.url}/json/version`).then(r => { if (!r.ok) throw new Error(`CDP HTTP ${r.status}`); return r.json(); });
    this.ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve, { once: true }); this.ws.addEventListener('error', reject, { once: true }); });
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result || {}); return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }
  command(method, params = {}, session = undefined) {
    const id = this.id++, payload = { id, method, params }; if (session) payload.sessionId = session;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 20000);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.ws.send(JSON.stringify(payload));
    });
  }
  on(method, listener) { const list = this.listeners.get(method) || []; list.push(listener); this.listeners.set(method, list); }
  close() { try { this.ws?.close(); } catch (_) {} }
}
async function evaluate(expression) {
  const result = await cdp.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'evaluation failed');
  return result.result?.value;
}
async function click(selector) {
  return evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) throw new Error('missing ${selector}'); n.click(); return true; })()`);
}
async function screenshot(name) {
  const result = await cdp.command('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  await writeFile(`${OUT}/${name}.png`, Buffer.from(result.data, 'base64'));
}
async function viewport(width, height) {
  await cdp.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await sleep(150);
}
async function snapshot(label) {
  return evaluate(`(() => {
    const rect = node => { const r = node?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,w:r.width,h:r.height} : null; };
    const root = document.querySelector('.scene-overlay-root[data-scene-id="terminal_ui"]');
    const stage = root?.querySelector('.scene-overlay-stage');
    const visible = selector => [...(root?.querySelectorAll(selector) || [])].filter(n => !n.hidden);
    const title = visible('[data-overlay-id^="title_"]')[0]?.textContent.trim() || '';
    const code = visible('[data-overlay-id^="code_"]')[0]?.textContent.trim() || '';
    const footer = visible('[data-overlay-id^="footer_"]')[0]?.textContent.trim() || '';
    return {
      label:${JSON.stringify(label)}, viewport:{w:innerWidth,h:innerHeight}, scene:window.Engine?._state?.current?.sceneId,
      overlayCount:document.querySelectorAll('.scene-overlay-root[data-scene-id="terminal_ui"]').length, view:window.Engine?._state?.current?.overlayLayer?.activeView,
      stage:rect(stage), title, code, footer:visible('[data-overlay-id^="footer_"]:not([data-overlay-id="footer_network"])')[0]?.textContent.trim() || '',
      launcherLabels:visible('[data-overlay-id$="_label"]').map(n => n.textContent.trim()),
      activeApps:visible('[data-overlay-id^="launcher_"][data-active="true"].scene-overlay-container').map(n => n.dataset.overlayId.replace('launcher_','')),
      lines:visible('.scene-overlay-ink-line').map(n => ({text:n.textContent,classes:n.className})),
      choices:visible('.scene-overlay-ink-choice').map(n => n.textContent.trim()),
      inventoryDisplay:getComputedStyle(document.querySelector('#inventory-button') || document.body).display,
      dialogueDisplay:getComputedStyle(document.querySelector('.dialogue-box') || document.body).display,
      legacyOverlayCount:document.querySelectorAll('.tui-overlay').length,
      legacyClass:document.body.classList.contains('terminal-ui-active'),
    };
  })()`);
}
async function startServer() {
  server = spawn(process.execPath, ['server.js'], { cwd:ROOT, env:{...process.env, HOST, PORT:String(PORT)}, stdio:['ignore','pipe','pipe'] });
  let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
  await waitFor(async () => { if (server.exitCode !== null) throw new Error(`server exited ${server.exitCode}: ${output}`); const r = await fetch(`${BASE}/api/story`).catch(() => null); return r?.ok; }, 15000, 'server readiness');
}
async function navigate(path) {
  await cdp.command('Page.navigate', { url:`${BASE}${path}` }, sessionId);
  await waitFor(() => evaluate('document.readyState === "complete"'), 15000, `${path} load`);
}

await mkdir(OUT, { recursive:true });
try {
  await startServer();
  cdp = new CDPClient(CDP_URL); await cdp.connect();
  const created = await cdp.command('Target.createTarget', { url:'about:blank' }); targetId = created.targetId;
  const attached = await cdp.command('Target.attachToTarget', { targetId, flatten:true }); sessionId = attached.sessionId;
  await cdp.command('Runtime.enable', {}, sessionId); await cdp.command('Page.enable', {}, sessionId); await cdp.command('Log.enable', {}, sessionId);
  cdp.on('Runtime.exceptionThrown', p => pageErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'uncaught exception'));
  cdp.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') consoleErrors.push((p.args || []).map(a => a.value ?? a.description ?? '').join(' ')); });
  cdp.on('Log.entryAdded', p => { if (p.entry?.level === 'error' && !String(p.entry.url || '').endsWith('/favicon.ico')) consoleErrors.push(p.entry.text || 'browser log error'); });
  await viewport(1280, 720); await navigate('/index.html?scene=terminal_ui');
  await waitFor(() => evaluate(`window.Engine?._state?.current?.sceneId === 'terminal_ui' && document.querySelectorAll('.scene-overlay-root[data-scene-id="terminal_ui"]').length === 1 && document.querySelectorAll('.scene-overlay-ink-line').length > 0`), 20000, 'generic terminal desktop');
  let state = await snapshot('desktop-1280x720'); states.push(state);
  check('generic desktop route and one overlay', state.scene === 'terminal_ui' && state.overlayCount === 1 && state.legacyOverlayCount === 0 && !state.legacyClass, JSON.stringify(state));
  check('generic launcher labels', state.launcherLabels.join(',') === 'LOG,EMAIL,MAP,SYSINFO,EXIT', state.launcherLabels.join(','));
  check('generic desktop title/code/footer', state.title === 'SABLE SYSTEM SHELL' && state.code === 'ROOT/INDEX' && state.footer === 'SHELL READY', JSON.stringify(state));
  check('generic terminal suppresses inventory and dialogue', state.inventoryDisplay === 'none' && state.dialogueDisplay === 'none', JSON.stringify(state));
  check('1280x720 generic stage is contained at 4:3', Math.abs(state.stage.w - 960) < 1 && Math.abs(state.stage.h - 720) < 1 && Math.abs(state.stage.x - 160) < 1, JSON.stringify(state.stage));
  await screenshot('phase5-generic-desktop-1280x720');

  const modules = [['log','SYSTEM LOG','SYS.LOG/ARCHIVE','LOG // ACTIVE'],['email','INTERNAL MAIL','COM.MAIL/LOCAL','EMAIL // ACTIVE'],['map','FACILITY MAP','NAV.OBELAB/SUB-2','MAP // ACTIVE'],['sysinfo','SYSTEM INFORMATION','SYS.DIAG/READ-ONLY','SYSINFO // ACTIVE']];
  for (const [id,title,code,footer] of modules) {
    await click(`[data-overlay-id="launcher_${id}_hotspot"]`);
    await waitFor(() => evaluate(`document.querySelector('[data-overlay-id="title_${id}"]')?.hidden === false && document.querySelectorAll('.scene-overlay-ink-choice').length > 0`), 5000, `${id} generic module`);
    state = await snapshot(id); states.push(state);
    check(`${id} generic title/code/footer`, state.title === title && state.code === code && state.footer === footer, JSON.stringify(state));
    check(`${id} generic active launcher and Ink`, state.activeApps.includes(id) && state.lines.length > 0 && state.choices.length === 1 && /RETURN/i.test(state.choices[0]), JSON.stringify({active:state.activeApps,lines:state.lines.length,choices:state.choices}));
    if (id === 'log') await screenshot('phase5-generic-module-log-1280x720');
    await click('.scene-overlay-ink-choice');
    await waitFor(() => evaluate(`window.Engine?._state?.current?.overlayLayer?.activeView === 'desktop' && document.querySelector('[data-overlay-id="title_desktop"]')?.hidden === false && document.querySelectorAll('.scene-overlay-ink-choice').length === 0`), 5000, `${id} generic RETURN`);
    state = await snapshot(`${id}-return`); states.push(state);
    check(`${id} generic RETURN restores desktop`, state.title === 'SABLE SYSTEM SHELL' && state.code === 'ROOT/INDEX' && state.footer === 'SHELL READY' && state.activeApps.length === 0 && state.choices.length === 0, JSON.stringify(state));
  }
  await click('[data-overlay-id="launcher_email_hotspot"]'); await waitFor(() => evaluate(`document.querySelector('[data-overlay-id="title_email"]')?.hidden === false`), 5000, 'email before generic close');
  await click('[data-overlay-id="titlebar_close"]');
  await waitFor(() => evaluate(`window.Engine?._state?.current?.overlayLayer?.activeView === 'desktop' && document.querySelectorAll('.scene-overlay-ink-choice').length === 0`), 5000, 'generic titlebar close');
  state = await snapshot('titlebar-close'); states.push(state); check('generic titlebar close restores desktop', state.title === 'SABLE SYSTEM SHELL' && state.activeApps.length === 0, JSON.stringify(state));

  for (const [width,height,name,expected] of [[1920,1080,'phase5-generic-desktop-1920x1080',{x:240,y:0,w:1440,h:1080}],[800,1000,'phase5-generic-desktop-800x1000',{x:0,y:200,w:800,h:600}]]) {
    await viewport(width,height); await waitFor(() => evaluate(`Math.abs(document.querySelector('.scene-overlay-stage').getBoundingClientRect().width - ${expected.w}) < 1`), 5000, `${width}x${height} resize`);
    state = await snapshot(`${width}x${height}`); states.push(state); check(`${width}x${height} generic contained stage`, ['x','y','w','h'].every(k => Math.abs(state.stage[k] - expected[k]) < 1), JSON.stringify(state.stage)); await screenshot(name);
  }
  await click('[data-overlay-id="launcher_map_hotspot"]'); await waitFor(() => evaluate(`document.querySelector('[data-overlay-id="title_map"]')?.hidden === false`), 5000, 'generic portrait map'); await screenshot('phase5-generic-module-map-800x1000');
  await viewport(1280,720); await click('[data-overlay-id="launcher_exit_hotspot"]');
  await waitFor(() => evaluate(`window.Engine?._state?.current?.sceneId === 'terminal_obelab' && document.querySelectorAll('.scene-overlay-root[data-scene-id="terminal_ui"]').length === 0`), 15000, 'generic EXIT');
  state = await snapshot('exit-terminal-obelab'); states.push(state); check('generic EXIT tears down and restores HUD', state.scene === 'terminal_obelab' && state.overlayCount === 0 && state.inventoryDisplay !== 'none' && !state.legacyClass, JSON.stringify(state));
  await evaluate(`window.Engine.goTo('terminal_ui'); true`); await waitFor(() => evaluate(`window.Engine?._state?.current?.sceneId === 'terminal_ui' && document.querySelectorAll('.scene-overlay-root[data-scene-id="terminal_ui"]').length === 1 && document.querySelectorAll('.scene-overlay-ink-line').length > 0`), 15000, 'generic re-entry');
  state = await snapshot('reentry'); states.push(state); check('generic re-entry starts fresh desktop', state.view === 'desktop' && state.title === 'SABLE SYSTEM SHELL' && state.activeApps.length === 0 && state.inventoryDisplay === 'none', JSON.stringify(state)); await screenshot('phase5-generic-reentry-1280x720');

  await navigate('/editor.html'); await waitFor(() => evaluate(`typeof state !== 'undefined' && state.story && state.story.scenes.terminal_ui && state.sceneId === 'alley'`), 15000, 'editor story load');
  await evaluate(`switchScene('terminal_ui'); true`); await waitFor(() => evaluate(`state.sceneId === 'terminal_ui' && document.querySelectorAll('#overlay-tree li').length === state.story.scenes.terminal_ui.overlay.elements.length`), 5000, 'terminal editor tree');
  check('editor exposes every terminal overlay element', await evaluate(`document.querySelectorAll('#overlay-tree li').length === state.story.scenes.terminal_ui.overlay.elements.length`));
  await evaluate(`(() => { const node=[...document.querySelectorAll('#overlay-tree li')].find(n => n.textContent.includes('hotspot: launcher_log_hotspot')); if (!node) throw new Error('missing launcher_log_hotspot tree row'); node.click(); return true; })()`);
  check('editor exposes terminal hotspot actions', await evaluate(`state.selected?.ref?.id === 'launcher_log_hotspot' && [...document.querySelectorAll('#right select')].some(n => n.value === 'setView') && [...document.querySelectorAll('#right select')].some(n => n.value === 'openInk')`));
} catch (error) { failures.push(error.stack || error.message || String(error)); }
finally { try { if (targetId) await cdp.command('Target.closeTarget', {targetId}); } catch (_) {} cdp?.close(); if (server) server.kill('SIGTERM'); }
const report = { ok:!failures.length && !consoleErrors.length && !pageErrors.length, base:BASE, checks, failures, consoleErrors, pageErrors, states, artifacts:OUT };
await writeFile(`${OUT}/phase5-generic-acceptance.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ok:report.ok, checks:checks.length, failures, consoleErrors, pageErrors, artifacts:OUT}, null, 2));
process.exitCode = report.ok ? 0 : 1;
