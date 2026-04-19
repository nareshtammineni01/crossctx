import { writeFile } from "fs/promises";
import type { CrossCtxOutput, CodeScanResult, CallChain } from "../types/index.js";

export async function saveGraph(output: CrossCtxOutput, outputPath: string): Promise<void> {
  const html = renderGraph(output);
  await writeFile(outputPath, html, "utf-8");
}

export function renderGraph(output: CrossCtxOutput): string {
  const scanResults = output.codeScanResults ?? [];
  const callChains = output.callChains ?? [];

  // Build graph nodes and edges from code scan results
  const services = buildServiceNodes(scanResults, output);
  const graphEdges = buildGraphEdges(callChains, scanResults, output);
  const endpointsData = buildEndpointsData(scanResults, output);

  // Build controller groupings for sidebar + single-service graph view
  const controllerGroups = buildControllerGroups(endpointsData);

  const dataJson = JSON.stringify({ services, graphEdges, endpointsData, callChains, controllerGroups }, null, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CrossCtx — API Dependency Explorer</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0d1117;
  --bg2: #161b22;
  --bg3: #21262d;
  --border: #30363d;
  --text: #c9d1d9;
  --text-dim: #8b949e;
  --text-bright: #f0f6fc;
  --blue: #58a6ff;
  --green: #3fb950;
  --orange: #d29922;
  --red: #f85149;
  --purple: #bc8cff;
  --pink: #f778ba;
  --cyan: #79c0ff;
  --sidebar-w: 280px;
  --panel-w: 360px;
  --header-h: 52px;
}

body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: var(--bg); color: var(--text); overflow: hidden; height: 100vh; display: flex; flex-direction: column; }

/* ── Header ── */
#header {
  height: var(--header-h);
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 16px;
  flex-shrink: 0;
  z-index: 100;
}
#header .logo { font-size: 16px; font-weight: 700; color: var(--text-bright); letter-spacing: -0.3px; }
#header .logo span { color: var(--blue); }
#header .pills { display: flex; gap: 8px; margin-left: auto; }
.pill { padding: 3px 10px; border-radius: 20px; font-size: 12px; background: var(--bg3); color: var(--text-dim); border: 1px solid var(--border); }
.pill strong { color: var(--text-bright); }
#view-toggle { background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; padding: 3px; display: flex; gap: 2px; margin-left: 8px; }
.toggle-btn { padding: 3px 10px; border-radius: 4px; font-size: 12px; background: transparent; color: var(--text-dim); border: none; cursor: pointer; transition: background 0.1s, color 0.1s; font-family: inherit; }
.toggle-btn.active { background: var(--bg2); color: var(--text-bright); box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
.toggle-btn:hover:not(.active) { color: var(--text); }

/* ── Layout ── */
#layout { display: flex; flex: 1; overflow: hidden; }

/* ── Sidebar ── */
#sidebar {
  width: var(--sidebar-w);
  background: var(--bg2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
}
#search-wrap { padding: 10px 12px; border-bottom: 1px solid var(--border); }
#search {
  width: 100%;
  padding: 7px 10px 7px 30px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%238b949e' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: 8px center;
}
#search:focus { border-color: var(--blue); }
#service-tree { flex: 1; overflow-y: auto; padding: 8px 0; }
.service-group { margin-bottom: 2px; }
.service-header {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  border-radius: 4px;
  margin: 0 4px;
  transition: background 0.1s;
  user-select: none;
}
.service-header:hover { background: var(--bg3); }
.service-header.active { background: rgba(88,166,255,0.1); }
.svc-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.svc-name { font-size: 13px; font-weight: 600; color: var(--text-bright); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.svc-badge { font-size: 11px; color: var(--text-dim); background: var(--bg3); padding: 1px 6px; border-radius: 10px; }
.svc-chevron { font-size: 10px; color: var(--text-dim); transition: transform 0.15s; }
.service-header.open .svc-chevron { transform: rotate(90deg); }
.endpoint-list { display: none; padding: 2px 0 4px; }
.service-header.open + .endpoint-list { display: block; }

/* ── Controller groups (inside service) ── */
.ctrl-group { margin-bottom: 1px; }
.ctrl-header {
  display: flex; align-items: center; gap: 7px;
  padding: 4px 12px 4px 24px;
  cursor: pointer;
  border-radius: 4px;
  margin: 0 4px;
  transition: background 0.1s;
  user-select: none;
}
.ctrl-header:hover { background: var(--bg3); }
.ctrl-icon { font-size: 10px; color: var(--text-dim); flex-shrink: 0; width: 12px; text-align: center; }
.ctrl-name { font-size: 12px; color: var(--text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ctrl-badge { font-size: 10px; color: var(--text-dim); background: var(--bg3); padding: 1px 5px; border-radius: 8px; border: 1px solid var(--border); }
.ctrl-chevron { font-size: 9px; color: var(--text-dim); transition: transform 0.15s; }
.ctrl-header.open .ctrl-chevron { transform: rotate(90deg); }
.ctrl-ep-list { display: none; padding: 1px 0 2px; }
.ctrl-header.open + .ctrl-ep-list { display: block; }

.endpoint-item {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 12px 4px 40px;
  cursor: pointer;
  border-radius: 4px;
  margin: 0 4px;
  transition: background 0.1s;
  font-size: 12px;
}
.endpoint-item:hover { background: var(--bg3); }
.endpoint-item.selected { background: rgba(88,166,255,0.15); }
.method-badge {
  font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px;
  min-width: 38px; text-align: center; flex-shrink: 0;
}
.method-GET { background: rgba(63,185,80,0.2); color: #3fb950; }
.method-POST { background: rgba(88,166,255,0.2); color: #58a6ff; }
.method-PUT { background: rgba(210,153,34,0.2); color: #d29922; }
.method-PATCH { background: rgba(188,140,255,0.2); color: #bc8cff; }
.method-DELETE { background: rgba(248,81,73,0.2); color: #f85149; }
.method-HEAD, .method-OPTIONS { background: var(--bg3); color: var(--text-dim); }
.ep-path { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.ep-chain-icon { font-size: 10px; color: var(--blue); opacity: 0; transition: opacity 0.1s; }
.endpoint-item:hover .ep-chain-icon { opacity: 1; }

/* ── Graph ── */
#graph-wrap { flex: 1; position: relative; overflow: hidden; }
#cy { width: 100%; height: 100%; }
.graph-controls {
  position: absolute; bottom: 16px; right: 16px;
  display: flex; flex-direction: column; gap: 6px;
  z-index: 10;
}
.ctrl-btn {
  width: 32px; height: 32px;
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 6px; color: var(--text); font-size: 16px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 0.1s;
}
.ctrl-btn:hover { background: var(--bg3); }
#graph-hint {
  position: absolute; bottom: 16px; left: 50%;
  transform: translateX(-50%);
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 12px;
  font-size: 11px; color: var(--text-dim);
  pointer-events: none;
  opacity: 1; transition: opacity 1s;
}
#graph-hint.hidden { opacity: 0; }

/* ── Confidence Legend ── */
#confidence-legend {
  position: absolute; bottom: 16px; left: 16px;
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 6px; padding: 8px 10px;
  font-size: 11px; color: var(--text-dim);
  pointer-events: none;
  display: none;
  z-index: 5;
}
#confidence-legend.visible { display: block; }
.conf-item { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.conf-item:last-child { margin-bottom: 0; }
.conf-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.conf-dot.high { background: #3fb950; }
.conf-dot.med { background: #d29922; }
.conf-dot.low { background: #f85149; }

/* ── Right Panel ── */
#panel {
  width: var(--panel-w);
  background: var(--bg2);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  transform: translateX(var(--panel-w));
  transition: transform 0.2s ease;
}
#panel.open { transform: translateX(0); }
#panel-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 10px;
  flex-shrink: 0;
}
#panel-header .method-badge { font-size: 11px; }
#panel-title { font-size: 13px; font-weight: 600; color: var(--text-bright); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#panel-close { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 18px; padding: 0 2px; }
#panel-close:hover { color: var(--text-bright); }
#panel-body { flex: 1; overflow-y: auto; padding: 0; min-height: 0; }

.panel-section { padding: 12px 16px; border-bottom: 1px solid var(--border); }
.panel-section-title { font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.panel-service { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.panel-service .svc-dot { width: 8px; height: 8px; }
.panel-service-name { font-size: 13px; color: var(--text); }
.panel-path { font-size: 13px; font-family: monospace; color: var(--cyan); word-break: break-all; }
.panel-summary { font-size: 13px; color: var(--text-dim); margin-top: 4px; }
.panel-source { font-size: 11px; color: var(--text-dim); margin-top: 6px; font-family: monospace; }

/* Payload shapes */
.payload-box {
  background: var(--bg3); border: 1px solid var(--border);
  border-radius: 6px; padding: 10px 12px; margin-top: 4px;
}
.payload-type-name { font-size: 11px; color: var(--purple); margin-bottom: 6px; font-family: monospace; }
.payload-field { display: flex; gap: 8px; margin-bottom: 3px; font-size: 12px; }
.field-name { color: var(--cyan); font-family: monospace; }
.field-type { color: var(--text-dim); font-family: monospace; }
.field-req { color: var(--red); font-size: 10px; }
.no-payload { font-size: 12px; color: var(--text-dim); font-style: italic; }

/* Call chain tree in panel */
.chain-tree { margin-top: 4px; }
.chain-node {
  display: flex; align-items: flex-start; gap: 6px;
  margin-bottom: 6px; font-size: 12px;
}
.chain-node.child { padding-left: 16px; }
.chain-node.grandchild { padding-left: 32px; }
.chain-connector { color: var(--border); font-family: monospace; flex-shrink: 0; padding-top: 1px; }
.chain-svc { color: var(--text-dim); }
.chain-ep { color: var(--blue); font-family: monospace; cursor: pointer; }
.chain-ep:hover { text-decoration: underline; }
.chain-badge-leaf { font-size: 10px; color: var(--green); }
.chain-badge-cycle { font-size: 10px; color: var(--orange); }
.chain-badge-unresolved { font-size: 10px; color: var(--text-dim); }
.chain-play-btn { background: var(--bg3); border: 1px solid var(--border); color: var(--blue); font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-family: inherit; }
.chain-play-btn:hover { background: rgba(88,166,255,0.15); }

/* ── Empty state ── */
#empty-state {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  text-align: center; pointer-events: none;
}
#empty-state h2 { font-size: 18px; color: var(--text-dim); font-weight: 400; }
#empty-state p { font-size: 13px; color: var(--text-dim); margin-top: 8px; opacity: 0.6; }

/* ── Scrollbars ── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

/* ── No results ── */
.no-results { padding: 16px; font-size: 13px; color: var(--text-dim); text-align: center; }

/* ── Context Builder ── */
#context-builder {
  border-top: 2px solid var(--border);
  background: var(--bg);
  flex-shrink: 0;
}
#ctx-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px 8px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border);
}
#ctx-header:hover { background: var(--bg3); }
#ctx-header-icon { font-size: 14px; }
#ctx-header-label { font-size: 12px; font-weight: 600; color: var(--text-bright); flex: 1; }
#ctx-header-chevron { font-size: 10px; color: var(--text-dim); transition: transform 0.15s; }
#ctx-header.open #ctx-header-chevron { transform: rotate(180deg); }
#ctx-body { display: none; padding: 10px 16px 14px; }
#ctx-header.open + #ctx-body { display: block; }

/* Purpose pills */
.ctx-purpose-row { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.ctx-purpose-btn {
  padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600;
  border: 1px solid var(--border); background: var(--bg3); color: var(--text-dim);
  cursor: pointer; font-family: inherit; transition: all 0.12s;
}
.ctx-purpose-btn:hover { border-color: var(--blue); color: var(--text); }
.ctx-purpose-btn.active { background: rgba(88,166,255,0.15); border-color: var(--blue); color: var(--blue); }

/* Context text area */
#ctx-text-wrap { position: relative; margin-bottom: 10px; }
#ctx-text {
  width: 100%; min-height: 140px; max-height: 260px;
  background: var(--bg3); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace;
  padding: 10px 12px; resize: vertical; outline: none;
  line-height: 1.55; white-space: pre-wrap; overflow-y: auto;
  display: block;
}
/* Copy button */
#ctx-copy-btn {
  width: 100%; padding: 9px 0; border-radius: 6px;
  background: var(--blue); color: #0d1117;
  border: none; font-size: 13px; font-weight: 700;
  cursor: pointer; font-family: inherit;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: background 0.15s, transform 0.1s;
}
#ctx-copy-btn:hover { background: #79c0ff; }
#ctx-copy-btn:active { transform: scale(0.98); }
#ctx-copy-btn.copied { background: var(--green); }
#ctx-copy-icon { font-size: 14px; }
</style>
</head>
<body>

<div id="header">
  <div class="logo">Cross<span>Ctx</span></div>
  <div id="view-toggle" style="display:none">
    <button id="btn-svc-view" class="toggle-btn active">Services</button>
    <button id="btn-ctrl-view" class="toggle-btn">Controllers</button>
  </div>
  <div class="pills">
    <div class="pill"><strong id="svc-count">0</strong> services</div>
    <div class="pill"><strong id="ctrl-count">0</strong> controllers</div>
    <div class="pill"><strong id="ep-count">0</strong> endpoints</div>
    <div class="pill"><strong id="chain-count">0</strong> call chains</div>
    <div class="pill"><strong id="dep-count">0</strong> dependencies</div>
  </div>
</div>

<div id="layout">
  <!-- Sidebar -->
  <div id="sidebar">
    <div id="search-wrap">
      <input id="search" type="text" placeholder="Search services, endpoints..." autocomplete="off" spellcheck="false">
    </div>
    <div id="service-tree"></div>
  </div>

  <!-- Graph -->
  <div id="graph-wrap">
    <div id="cy"></div>
    <div id="empty-state" style="display:none">
      <h2>No data to display</h2>
      <p>Run crossctx with project paths to populate the graph</p>
    </div>
    <div class="graph-controls">
      <button class="ctrl-btn" id="btn-fit" title="Fit to screen">⊡</button>
      <button class="ctrl-btn" id="btn-zoom-in" title="Zoom in">+</button>
      <button class="ctrl-btn" id="btn-zoom-out" title="Zoom out">−</button>
    </div>
    <div id="graph-hint">Click a service or endpoint to explore · Scroll to zoom · Drag to pan</div>
    <div id="confidence-legend">
      <div class="conf-item"><span class="conf-dot high"></span>High confidence (≥90%)</div>
      <div class="conf-item"><span class="conf-dot med"></span>Medium (70–89%)</div>
      <div class="conf-item"><span class="conf-dot low"></span>Low (&lt;70%)</div>
    </div>
  </div>

  <!-- Right panel -->
  <div id="panel">
    <div id="panel-header">
      <span id="panel-method" class="method-badge"></span>
      <span id="panel-title">Endpoint Details</span>
      <button id="panel-close">×</button>
    </div>
    <div id="panel-body"></div>

    <!-- Context Builder -->
    <div id="context-builder" style="display:none">
      <div id="ctx-header">
        <span id="ctx-header-icon">🤖</span>
        <span id="ctx-header-label">AI Context Builder</span>
        <span id="ctx-header-chevron">▼</span>
      </div>
      <div id="ctx-body">
        <div class="ctx-purpose-row">
          <button class="ctx-purpose-btn active" data-purpose="onboarding">Onboarding</button>
          <button class="ctx-purpose-btn" data-purpose="debug">Debug</button>
          <button class="ctx-purpose-btn" data-purpose="docs">Write Docs</button>
        </div>
        <div id="ctx-text-wrap">
          <textarea id="ctx-text" readonly spellcheck="false"></textarea>
        </div>
        <button id="ctx-copy-btn">
          <span id="ctx-copy-icon">⎘</span>
          <span id="ctx-copy-label">Copy context</span>
        </button>
      </div>
    </div>
  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js"></script>
<script>
// ─── Data ────────────────────────────────────────────────────────────────────
const DATA = ${dataJson};
const { services, graphEdges, endpointsData, callChains, controllerGroups } = DATA;

const SERVICE_COLORS = [
  '#58a6ff','#3fb950','#d29922','#f778ba','#bc8cff',
  '#79c0ff','#56d364','#ffa657','#ff7b72','#a5d6ff'
];
const CTRL_COLORS = [
  '#58a6ff','#3fb950','#d29922','#f778ba','#bc8cff',
  '#79c0ff','#56d364','#ffa657','#ff7b72','#a5d6ff',
  '#e3b341','#f0883e','#d2a8ff','#7ee787','#a8daff',
  '#ffb3c1','#c9d1d9','#ffd700','#98e2c6','#b08aff',
  '#ff9f43','#ee5a24','#6c5ce7','#00b894','#fd79a8'
];
const colorMap = {};
services.forEach((s, i) => { colorMap[s.id] = SERVICE_COLORS[i % SERVICE_COLORS.length]; });

// Build controller color map (per-controller unique colors)
const ctrlColorMap = {};
let ctrlColorIdx = 0;
if (controllerGroups) {
  Object.keys(controllerGroups).forEach(svcId => {
    const ctrls = controllerGroups[svcId];
    ctrls.forEach(ctrl => {
      ctrlColorMap[svcId + '::' + ctrl.name] = CTRL_COLORS[ctrlColorIdx++ % CTRL_COLORS.length];
    });
  });
}

// Whether we're in single-service mode (auto-shows controller view)
const isSingleService = services.length === 1;
// Current graph view: 'service' or 'controller'
let currentView = isSingleService ? 'controller' : 'service';

// Show view toggle for multi-service graphs
if (!isSingleService && services.length > 1) {
  document.getElementById('view-toggle').style.display = 'flex';
}

// ─── Stats ───────────────────────────────────────────────────────────────────
document.getElementById('svc-count').textContent = services.length;
document.getElementById('ep-count').textContent = endpointsData.length;
document.getElementById('chain-count').textContent = callChains.length;
document.getElementById('dep-count').textContent = graphEdges.length;
const totalCtrls = controllerGroups ? Object.values(controllerGroups).reduce((s, a) => s + a.length, 0) : 0;
document.getElementById('ctrl-count').textContent = totalCtrls;

// ─── Graph element builders ───────────────────────────────────────────────────
function buildServiceElements() {
  const nodes = services.map(s => ({
    data: {
      id: s.id,
      label: s.id,
      endpointCount: s.endpointCount,
      color: colorMap[s.id],
      language: s.language,
      framework: s.framework,
      nodeType: 'service',
    }
  }));
  const edges = graphEdges.map((e, i) => ({
    data: {
      id: 'e' + i,
      source: e.fromService,
      target: e.toService,
      label: e.fromEndpoint + ' → ' + e.toService,
      fromService: e.fromService,
      toService: e.toService,
      confidence: e.confidence ?? 0.5,
      rawUrl: e.rawUrl,
      callPattern: e.callPattern ?? '',
      type: e.type ?? 'sync',
    }
  }));
  return { nodes, edges };
}

function buildControllerElements() {
  const nodes = [];
  const edgeMap = new Map(); // "srcCtrl→tgtCtrl" → edge data (dedup)

  services.forEach(svc => {
    const ctrls = (controllerGroups && controllerGroups[svc.id]) || [];
    if (ctrls.length === 0) {
      // Service has no controller data — show as a single node
      nodes.push({ data: {
        id: 'svc::' + svc.id,
        label: svc.id,
        endpointCount: svc.endpointCount,
        color: colorMap[svc.id],
        nodeType: 'service',
      }});
      return;
    }
    ctrls.forEach(ctrl => {
      nodes.push({ data: {
        id: 'ctrl::' + svc.id + '::' + ctrl.name,
        label: ctrl.name.replace(/Controller$/, ''),
        endpointCount: ctrl.endpoints.length,
        // Use service color but slightly lighter via opacity
        color: colorMap[svc.id] || '#58a6ff',
        nodeType: 'controller',
        controllerName: ctrl.name,
        serviceId: svc.id,
        serviceBadge: svc.id,
      }});
    });
  });

  // Build edges from call chains — endpoint level → controller level
  callChains.forEach(chain => {
    (chain.edges || []).forEach(edge => {
      const fromSvc = edge.fromService;
      const toSvc = edge.toService;
      if (fromSvc === toSvc) return;

      // Find source controller from the "from" endpoint label
      const fromEpLabel = (edge.from || '').replace(fromSvc + ':', '').trim();
      const fromEp = endpointsData.find(e => e.service === fromSvc &&
        (e.method + ' ' + (e.fullPath || e.path)) === fromEpLabel);
      const fromCtrl = fromEp ? fromEp.controller : null;

      // Find target controller from the "to" endpoint label
      const toEpLabel = (edge.to || '').replace(toSvc + ':', '').trim();
      const toEp = endpointsData.find(e => e.service === toSvc &&
        (e.method + ' ' + (e.fullPath || e.path)) === toEpLabel);
      const toCtrl = toEp ? toEp.controller : null;

      const srcNodeId = fromCtrl
        ? ('ctrl::' + fromSvc + '::' + fromCtrl)
        : ('svc::' + fromSvc);
      const tgtNodeId = toCtrl
        ? ('ctrl::' + toSvc + '::' + toCtrl)
        : ('svc::' + toSvc);

      if (srcNodeId === tgtNodeId) return;
      const edgeKey = srcNodeId + '→' + tgtNodeId;
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, {
          id: 'ce' + edgeMap.size,
          source: srcNodeId,
          target: tgtNodeId,
          confidence: edge.confidence,
          type: 'sync',
        });
      }
    });
  });

  // Add async edges from message queues
  graphEdges.forEach(edge => {
    if (edge.type === 'async') {
      const fromSvc = edge.fromService;
      const toSvc = edge.toService;
      const srcNodeId = 'svc::' + fromSvc;
      const tgtNodeId = 'svc::' + toSvc;
      const edgeKey = srcNodeId + '→' + tgtNodeId + ':async';
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, {
          id: 'ce' + edgeMap.size,
          source: srcNodeId,
          target: tgtNodeId,
          confidence: 0.8,
          type: 'async',
        });
      }
    }
  });

  const edges = Array.from(edgeMap.values()).map(d => ({ data: d }));
  return { nodes, edges };
}

// ─── Cytoscape init ───────────────────────────────────────────────────────────
const cyStyle = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      'background-opacity': 0.85,
      'border-color': 'data(color)',
      'border-width': 2,
      'border-opacity': 1,
      'label': 'data(label)',
      'color': '#f0f6fc',
      'font-size': 11,
      'font-weight': 600,
      'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 6,
      'text-outline-color': '#0d1117',
      'text-outline-width': 2,
      'width': 'mapData(endpointCount, 1, 15, 40, 72)',
      'height': 'mapData(endpointCount, 1, 15, 40, 72)',
      'transition-property': 'background-opacity, border-width, width, height',
      'transition-duration': '0.15s',
    }
  },
  {
    selector: 'node:selected, node.highlighted',
    style: { 'background-opacity': 1, 'border-width': 3, 'z-index': 10 }
  },
  {
    selector: 'node.dimmed',
    style: { 'background-opacity': 0.2, 'border-opacity': 0.2, 'color': '#484f58' }
  },
  {
    selector: 'edge',
    style: {
      'width': 1.5,
      'line-color': '#30363d',
      'target-arrow-color': '#484f58',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 1.2,
      'curve-style': 'bezier',
      'opacity': 0.7,
    }
  },
  {
    selector: 'edge[confidence >= 0.9]',
    style: { 'line-color': '#3fb950', 'target-arrow-color': '#3fb950' }
  },
  {
    selector: 'edge[confidence >= 0.7][confidence < 0.9]',
    style: { 'line-color': '#d29922', 'target-arrow-color': '#d29922' }
  },
  {
    selector: 'edge[confidence < 0.7]',
    style: { 'line-color': '#f85149', 'target-arrow-color': '#f85149' }
  },
  {
    selector: 'edge.highlighted',
    style: { 'line-color': '#58a6ff', 'target-arrow-color': '#58a6ff', 'width': 2.5, 'opacity': 1, 'z-index': 10 }
  },
  {
    selector: 'edge.dimmed',
    style: { 'opacity': 0.1 }
  },
  {
    selector: 'edge[type="async"]',
    style: { 'line-style': 'dashed', 'line-color': '#d29922', 'target-arrow-color': '#d29922', 'line-dash-pattern': [4, 4] }
  },
];

const { nodes: initNodes, edges: initEdges } = currentView === 'controller'
  ? buildControllerElements()
  : buildServiceElements();

const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: [...initNodes, ...initEdges],
  style: cyStyle,
  layout: currentView === 'controller' || isSingleService
    ? { name: 'cose', animate: true, animationDuration: 500, nodeRepulsion: 6000, nodeOverlap: 30, idealEdgeLength: 120, padding: 50 }
    : { name: services.length > 1 ? 'cose' : 'grid', animate: true, animationDuration: 500, nodeRepulsion: 8000, nodeOverlap: 40, idealEdgeLength: 180, padding: 60 },
  wheelSensitivity: 0.3,
});

// Show confidence legend if there are edges
if (cy.edges().length > 0) {
  document.getElementById('confidence-legend').classList.add('visible');
}

// ─── View switcher ─────────────────────────────────────────────────────────────
function switchView(view) {
  if (view === currentView && !isSingleService) return;
  currentView = view;
  closePanel();

  // Update toggle button states
  document.getElementById('btn-svc-view').classList.toggle('active', view === 'service');
  document.getElementById('btn-ctrl-view').classList.toggle('active', view === 'controller');

  const { nodes, edges } = view === 'controller' ? buildControllerElements() : buildServiceElements();
  cy.elements().remove();
  cy.add([...nodes, ...edges]);

  // Update legend visibility
  const legendEl = document.getElementById('confidence-legend');
  if (cy.edges().length > 0) {
    legendEl.classList.add('visible');
  } else {
    legendEl.classList.remove('visible');
  }

  cy.layout(view === 'controller'
    ? { name: 'cose', animate: true, animationDuration: 500, nodeRepulsion: 6000, nodeOverlap: 30, idealEdgeLength: 120, padding: 50 }
    : { name: 'cose', animate: true, animationDuration: 500, nodeRepulsion: 8000, nodeOverlap: 40, idealEdgeLength: 180, padding: 60 }
  ).run();
}

document.getElementById('btn-svc-view').addEventListener('click', () => switchView('service'));
document.getElementById('btn-ctrl-view').addEventListener('click', () => switchView('controller'));

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function buildSidebar(filter = '') {
  const tree = document.getElementById('service-tree');
  tree.innerHTML = '';

  const filterLow = filter.toLowerCase();
  let anyVisible = false;

  services.forEach(svc => {
    const svcMatch = !filter || svc.id.toLowerCase().includes(filterLow);
    const svcEndpoints = endpointsData.filter(ep => ep.service === svc.id);

    // Get controllers for this service
    const ctrls = (controllerGroups && controllerGroups[svc.id]) || [];

    // Filter endpoints
    const visibleEps = filter
      ? svcEndpoints.filter(ep =>
          ep.path.toLowerCase().includes(filterLow) ||
          ep.method.toLowerCase().includes(filterLow) ||
          (ep.summary || '').toLowerCase().includes(filterLow) ||
          (ep.controller || '').toLowerCase().includes(filterLow) ||
          svc.id.toLowerCase().includes(filterLow)
        )
      : svcEndpoints;

    if (!svcMatch && visibleEps.length === 0) return;
    anyVisible = true;

    const group = document.createElement('div');
    group.className = 'service-group';
    group.dataset.svc = svc.id;

    // Service header
    const header = document.createElement('div');
    header.className = 'service-header' + (filter || services.length === 1 ? ' open' : '');
    header.innerHTML = \`
      <div class="svc-dot" style="background:\${colorMap[svc.id]}"></div>
      <span class="svc-name">\${svc.id}</span>
      <span class="svc-badge">\${visibleEps.length}</span>
      <span class="svc-chevron">▶</span>
    \`;
    header.addEventListener('click', () => {
      header.classList.toggle('open');
      if (currentView === "service") highlightService(svc.id);
    });

    // Endpoint list container (holds controller sub-groups)
    const epList = document.createElement('div');
    epList.className = 'endpoint-list';

    if (ctrls.length > 0) {
      // Build controller sub-groups
      ctrls.forEach(ctrl => {
        const ctrlEps = visibleEps.filter(ep => ep.controller === ctrl.name);
        if (ctrlEps.length === 0 && filter) return;

        const allCtrlEps = filter ? ctrlEps : ctrl.endpoints.map(id => endpointsData.find(e => e.id === id)).filter(Boolean);
        const displayEps = filter ? ctrlEps : allCtrlEps;
        if (displayEps.length === 0) return;

        const ctrlKey = svc.id + '::' + ctrl.name;
        const ctrlColor = ctrlColorMap[ctrlKey] || '#58a6ff';

        const ctrlGroup = document.createElement('div');
        ctrlGroup.className = 'ctrl-group';

        const ctrlHeader = document.createElement('div');
        ctrlHeader.className = 'ctrl-header' + (filter ? ' open' : '');
        ctrlHeader.innerHTML = \`
          <div class="svc-dot" style="background:\${ctrlColor}; width:8px; height:8px; flex-shrink:0"></div>
          <span class="ctrl-name">\${ctrl.name.replace('Controller', '')}</span>
          <span class="ctrl-badge">\${displayEps.length}</span>
          <span class="ctrl-chevron">▶</span>
        \`;
        ctrlHeader.addEventListener('click', (e) => {
          e.stopPropagation();
          ctrlHeader.classList.toggle('open');
          // Highlight this controller's node on graph (single-service mode)
          if (currentView === "controller") {
            const nodeId = 'ctrl::' + ctrl.name;
            const node = cy.$('#' + CSS.escape(nodeId));
            if (node.length) {
              cy.elements().removeClass('highlighted dimmed');
              cy.elements().not(node).addClass('dimmed');
              node.addClass('highlighted');
              cy.animate({ center: { eles: node }, zoom: cy.zoom(), duration: 200 });
            }
          }
        });

        const ctrlEpList = document.createElement('div');
        ctrlEpList.className = 'ctrl-ep-list';

        displayEps.forEach(ep => {
          if (!ep) return;
          const item = document.createElement('div');
          item.className = 'endpoint-item';
          item.dataset.epId = ep.id;
          item.innerHTML = \`
            <span class="method-badge method-\${ep.method}">\${ep.method}</span>
            <span class="ep-path" title="\${ep.fullPath || ep.path}">\${ep.fullPath || ep.path}</span>
            \${ep.hasChain ? '<span class="ep-chain-icon">⛓</span>' : ''}
          \`;
          item.addEventListener('click', (e) => { e.stopPropagation(); selectEndpoint(ep); });
          ctrlEpList.appendChild(item);
        });

        ctrlGroup.appendChild(ctrlHeader);
        ctrlGroup.appendChild(ctrlEpList);
        epList.appendChild(ctrlGroup);
      });
    } else {
      // No controller info — flat list fallback
      visibleEps.forEach(ep => {
        const item = document.createElement('div');
        item.className = 'endpoint-item';
        item.dataset.epId = ep.id;
        item.style.paddingLeft = '30px';
        item.innerHTML = \`
          <span class="method-badge method-\${ep.method}">\${ep.method}</span>
          <span class="ep-path" title="\${ep.fullPath || ep.path}">\${ep.fullPath || ep.path}</span>
          \${ep.hasChain ? '<span class="ep-chain-icon">⛓</span>' : ''}
        \`;
        item.addEventListener('click', (e) => { e.stopPropagation(); selectEndpoint(ep); });
        epList.appendChild(item);
      });
    }

    group.appendChild(header);
    group.appendChild(epList);
    tree.appendChild(group);
  });

  if (!anyVisible) {
    tree.innerHTML = '<div class="no-results">No results for "' + filter + '"</div>';
  }
}

buildSidebar();

document.getElementById('search').addEventListener('input', (e) => {
  buildSidebar(e.target.value);
});

// ─── Highlight helpers ────────────────────────────────────────────────────────
function resetGraph() {
  cy.elements().removeClass('highlighted dimmed');
}

function highlightService(svcId) {
  resetGraph();
  // In controller view, highlight all controller nodes belonging to this service
  if (currentView === 'controller') {
    const svcNodes = cy.nodes().filter(n => n.data('serviceId') === svcId || n.id() === 'svc::' + svcId);
    if (!svcNodes.length) return;
    const connected = svcNodes.neighborhood().union(svcNodes);
    cy.elements().not(connected).addClass('dimmed');
    connected.addClass('highlighted');
    cy.animate({ fit: { eles: connected, padding: 80 }, duration: 300 });
    return;
  }
  const node = cy.$('#' + CSS.escape(svcId));
  if (!node.length) return;

  const connected = node.neighborhood().union(node);
  cy.elements().not(connected).addClass('dimmed');
  connected.addClass('highlighted');
  cy.animate({ fit: { eles: connected, padding: 80 }, duration: 300 });
}

function highlightChain(chainEdges) {
  resetGraph();
  if (!chainEdges || chainEdges.length === 0) return;

  const involvedServices = new Set();
  chainEdges.forEach(e => { involvedServices.add(e.fromService); involvedServices.add(e.toService); });

  cy.elements().forEach(el => {
    if (el.isNode()) {
      // In service view: match by service ID
      // In controller view: match if node belongs to an involved service
      const nid = el.id();
      const nSvc = el.data('serviceId') || nid;
      const inChain = involvedServices.has(nid) || involvedServices.has(nSvc) ||
        (nid.startsWith('svc::') && involvedServices.has(nid.slice(5)));
      if (inChain) el.addClass('highlighted');
      else el.addClass('dimmed');
    }
    if (el.isEdge()) {
      const src = el.data('source'), tgt = el.data('target');
      const srcSvc = cy.$('#' + src).data('serviceId') || src;
      const tgtSvc = cy.$('#' + tgt).data('serviceId') || tgt;
      // Match edge if it connects services/controllers in the chain
      const isInChain = chainEdges.some(e =>
        (e.fromService === src && e.toService === tgt) ||
        (e.fromService === srcSvc && e.toService === tgtSvc)
      );
      if (isInChain) el.addClass('highlighted');
      else el.addClass('dimmed');
    }
  });

  const highlighted = cy.$('.highlighted');
  if (highlighted.length) cy.animate({ fit: { eles: highlighted, padding: 80 }, duration: 300 });
}

// Animate through call chain hops step by step
function animateChainHops(chainEdges) {
  if (!chainEdges || chainEdges.length === 0) return;
  resetGraph();

  let step = 0;
  function showStep() {
    if (step >= chainEdges.length) {
      // All hops shown — keep final state
      return;
    }
    const edge = chainEdges[step];
    // Find and highlight the edge on the graph
    cy.edges().forEach(el => {
      const src = el.data('source'), tgt = el.data('target');
      const srcSvc = cy.$('#' + src).data('serviceId') || src;
      const tgtSvc = cy.$('#' + tgt).data('serviceId') || tgt;
      if ((edge.fromService === src && edge.toService === tgt) ||
          (edge.fromService === srcSvc && edge.toService === tgtSvc)) {
        el.addClass('highlighted');
        el.removeClass('dimmed');
        // Dim the edge temporarily with a flash
        el.animate({ style: { 'width': 4 } }, { duration: 200, complete: () => el.animate({ style: { 'width': 2.5 } }, { duration: 200 }) });
      }
    });
    step++;
    setTimeout(showStep, 500);
  }
  showStep();
}

// ─── Panel ────────────────────────────────────────────────────────────────────
const panel = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');
const panelTitle = document.getElementById('panel-title');
const panelMethod = document.getElementById('panel-method');

function openPanel(content, title, method) {
  panelTitle.textContent = title;
  panelMethod.textContent = method || '';
  panelMethod.className = 'method-badge method-' + (method || '');
  if (!method) panelMethod.style.display = 'none';
  else panelMethod.style.display = '';
  panelBody.innerHTML = content;
  panel.classList.add('open');
}

function closePanel() {
  panel.classList.remove('open');
  resetGraph();
  document.querySelectorAll('.endpoint-item.selected').forEach(el => el.classList.remove('selected'));
  document.getElementById('context-builder').style.display = 'none';
  ctxCurrentEndpoint = null;
}

document.getElementById('panel-close').addEventListener('click', closePanel);

// ─── Endpoint selection ───────────────────────────────────────────────────────
function selectEndpoint(ep) {
  // Deselect previous
  document.querySelectorAll('.endpoint-item.selected').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(\`[data-ep-id="\${ep.id}"]\`);
  if (el) el.classList.add('selected');

  // Build panel content
  const color = colorMap[ep.service] || '#58a6ff';
  const svcDot = \`<div class="svc-dot" style="background:\${color}"></div>\`;
  let html = '';

  // Service info
  html += \`<div class="panel-section">
    <div class="panel-section-title">Service</div>
    <div class="panel-service">\${svcDot}<span class="panel-service-name">\${ep.service}</span></div>
    <div class="panel-path">\${ep.fullPath || ep.path}</div>
    \${ep.summary ? \`<div class="panel-summary">\${ep.summary}</div>\` : ''}
    \${ep.sourceFile ? \`<div class="panel-source">\${ep.sourceFile.split('/').slice(-2).join('/')}\${ep.line ? ':' + ep.line : ''}</div>\` : ''}
  </div>\`;

  // Request body
  html += \`<div class="panel-section">
    <div class="panel-section-title">Request Body</div>
    \${renderPayload(ep.requestBody)}
  </div>\`;

  // Response
  html += \`<div class="panel-section">
    <div class="panel-section-title">Response</div>
    \${renderPayload(ep.response)}
  </div>\`;

  // Call chain
  const chains = callChains.filter(c => c.rootService === ep.service && c.rootEndpoint === ep.method + ' ' + (ep.fullPath || ep.path));
  if (chains.length > 0) {
    const safeService = ep.service.replace(/'/g, "\\'");
    const safeEndpoint = (ep.method + ' ' + (ep.fullPath || ep.path)).replace(/'/g, "\\'");
    html += \`<div class="panel-section">
      <div class="panel-section-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>Call Chain</span>
        <button class="chain-play-btn" onclick="(function(){const ch=DATA.callChains.find(c=>c.rootService==='\${safeService}'&&c.rootEndpoint==='\${safeEndpoint}');if(ch)animateChainHops(ch.edges);})()" title="Animate call hops on graph">▶ Animate</button>
      </div>
      <div class="chain-tree">\${renderChainNode(chains[0].tree, 0)}</div>
    </div>\`;
    highlightChain(chains[0].edges);
  } else {
    // Highlight service on graph
    highlightService(ep.service);
  }

  openPanel(html, ep.fullPath || ep.path, ep.method);

  // Populate context builder for this endpoint
  updateContextBuilder(ep);
}

function renderPayload(payload) {
  if (!payload) return '<div class="no-payload">Not documented</div>';
  const fields = payload.fields || [];
  if (fields.length === 0 && !payload.typeName) return '<div class="no-payload">Not documented</div>';

  let html = '<div class="payload-box">';
  if (payload.typeName) html += \`<div class="payload-type-name">\${payload.typeName}</div>\`;
  if (fields.length === 0) {
    html += '<div class="no-payload" style="margin:0">Fields unknown</div>';
  } else {
    fields.forEach(f => {
      html += \`<div class="payload-field">
        <span class="field-name">\${f.name}</span>
        <span class="field-type">\${f.type}</span>
        \${f.required ? '<span class="field-req">*</span>' : ''}
      </div>\`;
    });
  }
  html += '</div>';
  return html;
}

function renderChainNode(node, depth) {
  const indent = depth === 0 ? '' : depth === 1 ? 'child' : 'grandchild';
  const connector = depth === 0 ? '' : depth === 1 ? '└─ ' : '   └─ ';
  const leafBadge = node.isLeaf && !node.isUnresolved ? '<span class="chain-badge-leaf">● end</span>' : '';
  const cycleBadge = node.isCycle ? '<span class="chain-badge-cycle">↺ cycle</span>' : '';
  const unresBadge = node.isUnresolved ? '<span class="chain-badge-unresolved">? unresolved</span>' : '';

  let html = \`<div class="chain-node \${indent}">
    \${depth > 0 ? \`<span class="chain-connector">\${connector}</span>\` : ''}
    <div>
      <span class="chain-svc">\${node.service} · </span>
      <span class="chain-ep" onclick="selectByLabel('\${node.service}', '\${node.endpoint}')">\${node.endpoint}</span>
      \${leafBadge}\${cycleBadge}\${unresBadge}
    </div>
  </div>\`;

  if (node.calls && node.calls.length > 0) {
    node.calls.forEach(child => { html += renderChainNode(child, depth + 1); });
  }

  return html;
}

function selectByLabel(service, endpointLabel) {
  const [method, ...pathParts] = endpointLabel.split(' ');
  const path = pathParts.join(' ');
  const ep = endpointsData.find(e => e.service === service && e.method === method && (e.fullPath === path || e.path === path));
  if (ep) selectEndpoint(ep);
}

// ─── Edge hover tooltip ───────────────────────────────────────────────────────
let edgeTip = null;
cy.on('mouseover', 'edge', function(e) {
  const edge = e.target;
  const conf = Math.round((edge.data('confidence') ?? 0) * 100);
  const from = edge.data('fromService') ?? edge.data('from') ?? '';
  const to = edge.data('toService') ?? edge.data('to') ?? '';
  const via = edge.data('callPattern') ?? edge.data('rawUrl') ?? '';
  const confColor = conf >= 90 ? '#3fb950' : conf >= 70 ? '#d29922' : '#f85149';

  const tip = document.createElement('div');
  tip.id = 'edge-tooltip';
  tip.style.cssText = 'position:fixed;background:#21262d;border:1px solid #30363d;border-radius:6px;padding:8px 10px;font-size:11px;color:#c9d1d9;pointer-events:none;z-index:1000;max-width:200px;word-break:break-word;';
  let tipContent = '<div style="color:#f0f6fc;margin-bottom:4px;font-weight:600">' + from + ' → ' + to + '</div>';
  tipContent += '<div>Confidence: <strong style="color:' + confColor + '">' + conf + '%</strong></div>';
  if (via) tipContent += '<div style="color:#8b949e;margin-top:4px;word-break:break-all">' + via + '</div>';
  tip.innerHTML = tipContent;
  document.body.appendChild(tip);
  edgeTip = tip;
});

cy.on('mousemove', 'edge', function(e) {
  if (edgeTip) {
    edgeTip.style.left = (e.originalEvent.clientX + 12) + 'px';
    edgeTip.style.top = (e.originalEvent.clientY - 10) + 'px';
  }
});

cy.on('mouseout', 'edge', function() {
  if (edgeTip) { edgeTip.remove(); edgeTip = null; }
});

// ─── Graph node click ─────────────────────────────────────────────────────────
cy.on('tap', 'node', function(evt) {
  const nodeId = evt.target.id();
  const nodeData = evt.target.data();

  if (nodeData.nodeType === 'controller') {
    // Controller node clicked (single-service view)
    const ctrlName = nodeData.controllerName;
    const svcId = nodeData.serviceId;
    const color = nodeData.color;
    const ctrlEndpoints = endpointsData.filter(ep => ep.service === svcId && ep.controller === ctrlName);

    // Highlight just this node
    cy.elements().removeClass('highlighted dimmed');
    cy.elements().not(evt.target).addClass('dimmed');
    evt.target.addClass('highlighted');

    // Expand this controller in sidebar
    const ctrlHeaders = document.querySelectorAll('.ctrl-header');
    ctrlHeaders.forEach(ch => {
      const badge = ch.querySelector('.ctrl-name');
      if (badge && badge.textContent === ctrlName.replace('Controller', '')) {
        ch.classList.add('open');
        // Scroll into view
        ch.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    let html = \`<div class="panel-section">
      <div class="panel-section-title">Controller</div>
      <div class="panel-service"><div class="svc-dot" style="background:\${color}"></div><span class="panel-service-name">\${ctrlName}</span></div>
      <div class="panel-summary" style="margin-top:4px">\${svcId} · \${ctrlEndpoints.length} endpoints</div>
    </div>\`;

    html += \`<div class="panel-section">
      <div class="panel-section-title">Endpoints (\${ctrlEndpoints.length})</div>\`;
    ctrlEndpoints.forEach(ep => {
      html += \`<div class="endpoint-item" style="padding-left:0; margin:0 0 2px; border-radius:4px; cursor:pointer" onclick="selectEndpoint(endpointsData.find(e=>e.id==='\${ep.id}'))">
        <span class="method-badge method-\${ep.method}">\${ep.method}</span>
        <span class="ep-path" title="\${ep.fullPath || ep.path}">\${ep.fullPath || ep.path}</span>
      </div>\`;
    });
    html += '</div>';

    openPanel(html, ctrlName, '');
    return;
  }

  // Service node clicked (multi-service view or controller view fallback node)
  const svcId = nodeId.startsWith('svc::') ? nodeId.slice(5) : nodeId;
  const svc = services.find(s => s.id === svcId);
  if (!svc) return;

  highlightService(svcId);

  const color = colorMap[svcId];
  const svcEndpoints = endpointsData.filter(ep => ep.service === svcId);

  let html = \`<div class="panel-section">
    <div class="panel-section-title">Service</div>
    <div class="panel-service"><div class="svc-dot" style="background:\${color}"></div><span class="panel-service-name">\${svcId}</span></div>
    <div class="panel-summary">\${svc.language} · \${svc.framework}</div>
  </div>\`;

  // Group by controller in the panel too
  const ctrls = (controllerGroups && controllerGroups[svcId]) || [];
  if (ctrls.length > 0) {
    ctrls.forEach(ctrl => {
      const ctrlEps = svcEndpoints.filter(ep => ep.controller === ctrl.name);
      if (ctrlEps.length === 0) return;
      html += \`<div class="panel-section">
        <div class="panel-section-title">\${ctrl.name} (\${ctrlEps.length})</div>\`;
      ctrlEps.forEach(ep => {
        html += \`<div class="endpoint-item" style="padding-left:0; margin:0 0 2px; border-radius:4px; cursor:pointer" onclick="selectEndpoint(endpointsData.find(e=>e.id==='\${ep.id}'))">
          <span class="method-badge method-\${ep.method}">\${ep.method}</span>
          <span class="ep-path" title="\${ep.fullPath || ep.path}">\${ep.fullPath || ep.path}</span>
        </div>\`;
      });
      html += '</div>';
    });
  } else {
    html += \`<div class="panel-section">
      <div class="panel-section-title">Endpoints (\${svcEndpoints.length})</div>\`;
    svcEndpoints.forEach(ep => {
      html += \`<div class="endpoint-item" style="padding-left:0; margin:0 0 2px; border-radius:4px; cursor:pointer" onclick="selectEndpoint(endpointsData.find(e=>e.id==='\${ep.id}'))">
        <span class="method-badge method-\${ep.method}">\${ep.method}</span>
        <span class="ep-path" title="\${ep.fullPath || ep.path}">\${ep.fullPath || ep.path}</span>
      </div>\`;
    });
    html += '</div>';
  }

  openPanel(html, svcId, '');
});

cy.on('tap', function(evt) {
  if (evt.target === cy) { closePanel(); resetGraph(); }
});

// ─── Controls ─────────────────────────────────────────────────────────────────
document.getElementById('btn-fit').addEventListener('click', () => cy.fit(undefined, 60));
document.getElementById('btn-zoom-in').addEventListener('click', () => cy.zoom(cy.zoom() * 1.3));
document.getElementById('btn-zoom-out').addEventListener('click', () => cy.zoom(cy.zoom() * 0.77));

// Hide hint after 4s
setTimeout(() => document.getElementById('graph-hint').classList.add('hidden'), 4000);

// Empty state
if (services.length === 0) document.getElementById('empty-state').style.display = 'block';

// ─── Context Builder ──────────────────────────────────────────────────────────

let ctxCurrentEndpoint = null;
let ctxCurrentPurpose = 'onboarding';

const CTX_PROMPTS = {
  onboarding: (ep, svc) =>
    \`You are helping onboard a new developer to a microservices codebase.\\n\` +
    \`Below is the full call chain context for \${ep.method} \${ep.fullPath || ep.path} in \${svc}.\\n\` +
    \`Please explain: what this endpoint does, which services it touches and why, what a new developer needs to understand to work with it safely, and any gotchas or side effects they should know about.\\n\\n\`,

  debug: (ep, svc) =>
    \`You are helping debug a production issue in a microservices system.\\n\` +
    \`Below is the full call chain context for \${ep.method} \${ep.fullPath || ep.path} in \${svc}.\\n\` +
    \`Please identify: potential failure points in this chain, what could cause latency or errors at each hop, what to check first when this endpoint behaves unexpectedly, and any circular dependencies or unresolved calls to watch out for.\\n\\n\`,

  docs: (ep, svc) =>
    \`You are a technical writer documenting a microservices API.\\n\` +
    \`Below is the full call chain context for \${ep.method} \${ep.fullPath || ep.path} in \${svc}.\\n\` +
    \`Please write API documentation covering: the endpoint contract (request/response), which downstream services are called and what data flows between them, any async message events triggered, and the overall purpose of this operation in the system.\\n\\n\`,
};

function serializeChainToText(node, depth) {
  const indent = '  '.repeat(depth);
  const connector = depth === 0 ? '' : '└─ ';
  let text = indent + connector + node.service + ' · ' + node.endpoint;
  if (node.isCycle) text += '  [↺ cycle]';
  if (node.isUnresolved) text += '  [? unresolved]';
  if (node.isLeaf && !node.isUnresolved) text += '  [leaf]';
  text += '\\n';

  // Include payload shapes if present
  if (depth === 0 && (node.requestBody || node.response)) {
    if (node.requestBody && node.requestBody.fields && node.requestBody.fields.length > 0) {
      text += indent + '  Request: ' + node.requestBody.fields.map(f => f.name + ': ' + f.type + (f.required ? '*' : '')).join(', ') + '\\n';
    }
    if (node.response && node.response.fields && node.response.fields.length > 0) {
      text += indent + '  Response: ' + node.response.fields.map(f => f.name + ': ' + f.type).join(', ') + '\\n';
    }
  }

  if (node.calls && node.calls.length > 0) {
    node.calls.forEach(child => { text += serializeChainToText(child, depth + 1); });
  }
  return text;
}

function buildContextText(ep, purpose) {
  const chain = DATA.callChains.find(c =>
    c.rootService === ep.service &&
    c.rootEndpoint === ep.method + ' ' + (ep.fullPath || ep.path)
  );

  const promptFn = CTX_PROMPTS[purpose] || CTX_PROMPTS.onboarding;
  let text = promptFn(ep, ep.service);

  text += '='.repeat(60) + '\\n';
  text += 'CrossCtx Context: ' + ep.method + ' ' + (ep.fullPath || ep.path) + ' (' + ep.service + ')\\n';
  text += '='.repeat(60) + '\\n\\n';

  // Entry point
  text += '--- Entry Point ---\\n';
  text += 'Service:  ' + ep.service + '\\n';
  text += 'Endpoint: ' + ep.method + ' ' + (ep.fullPath || ep.path) + '\\n';
  if (ep.summary) text += 'Summary:  ' + ep.summary + '\\n';
  if (ep.sourceFile) {
    const shortFile = ep.sourceFile.split('/').slice(-2).join('/');
    text += 'Source:   ' + shortFile + (ep.line ? ':' + ep.line : '') + '\\n';
  }
  if (ep.requestBody && ep.requestBody.fields && ep.requestBody.fields.length > 0) {
    text += 'Request body:\\n';
    ep.requestBody.fields.forEach(f => {
      text += '  ' + f.name + ': ' + f.type + (f.required ? ' (required)' : '') + '\\n';
    });
  }
  if (ep.response && ep.response.fields && ep.response.fields.length > 0) {
    text += 'Response:\\n';
    ep.response.fields.forEach(f => {
      text += '  ' + f.name + ': ' + f.type + '\\n';
    });
  }

  // Call chain
  if (chain) {
    text += '\\n--- Call Chain ---\\n';
    text += serializeChainToText(chain.tree, 0);

    // Services involved
    const involvedSvcs = new Set();
    involvedSvcs.add(ep.service);
    chain.edges.forEach(e => { involvedSvcs.add(e.fromService); involvedSvcs.add(e.toService); });

    text += '\\n--- Services Involved (' + involvedSvcs.size + ') ---\\n';
    involvedSvcs.forEach(svcId => {
      const svcMeta = services.find(s => s.id === svcId);
      const epCount = endpointsData.filter(e => e.service === svcId).length;
      if (svcMeta) {
        text += svcId + ' (' + svcMeta.language + '/' + svcMeta.framework + ', ' + epCount + ' endpoints)\\n';
      } else {
        text += svcId + '\\n';
      }
    });

    // Confidence summary
    if (chain.edges.length > 0) {
      const avgConf = Math.round(chain.edges.reduce((s, e) => s + (e.confidence || 0), 0) / chain.edges.length * 100);
      text += '\\n--- Resolution ---\\n';
      text += 'Call hops: ' + chain.edges.length + '\\n';
      text += 'Avg confidence: ' + avgConf + '%\\n';
    }
  } else {
    text += '\\n--- Call Chain ---\\n';
    text += '(No outbound calls detected from this endpoint)\\n';

    text += '\\n--- Service ---\\n';
    const svcMeta = services.find(s => s.id === ep.service);
    if (svcMeta) {
      text += ep.service + ' (' + svcMeta.language + '/' + svcMeta.framework + ')\\n';
    }
  }

  // Async message events
  if (ep.messageEvents && ep.messageEvents.length > 0) {
    text += '\\n--- Message Events ---\\n';
    ep.messageEvents.forEach(me => {
      text += me.direction.toUpperCase() + ' ' + me.pattern + ':' + me.topic;
      if (me.payloadType) text += ' (' + me.payloadType + ')';
      text += '\\n';
    });
  }

  text += '\\n' + '='.repeat(60) + '\\n';
  text += 'Generated by CrossCtx — https://github.com/nareshtammineni01/crossctx\\n';
  text += '='.repeat(60);

  return text;
}

function updateContextBuilder(ep) {
  ctxCurrentEndpoint = ep;
  const text = buildContextText(ep, ctxCurrentPurpose);
  document.getElementById('ctx-text').value = text;
  document.getElementById('context-builder').style.display = 'block';
  // Auto-open the builder when a new endpoint is selected
  document.getElementById('ctx-header').classList.add('open');
  // Reset copy button
  const copyBtn = document.getElementById('ctx-copy-btn');
  copyBtn.classList.remove('copied');
  document.getElementById('ctx-copy-label').textContent = 'Copy context';
}

// Purpose selector
document.querySelectorAll('.ctx-purpose-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ctx-purpose-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ctxCurrentPurpose = btn.dataset.purpose;
    if (ctxCurrentEndpoint) {
      document.getElementById('ctx-text').value = buildContextText(ctxCurrentEndpoint, ctxCurrentPurpose);
      // Reset copy state
      document.getElementById('ctx-copy-btn').classList.remove('copied');
      document.getElementById('ctx-copy-label').textContent = 'Copy context';
    }
  });
});

// Collapse/expand toggle
document.getElementById('ctx-header').addEventListener('click', () => {
  document.getElementById('ctx-header').classList.toggle('open');
});

// Copy button
document.getElementById('ctx-copy-btn').addEventListener('click', () => {
  const text = document.getElementById('ctx-text').value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('ctx-copy-btn');
    btn.classList.add('copied');
    document.getElementById('ctx-copy-label').textContent = 'Copied!';
    document.getElementById('ctx-copy-icon').textContent = '✓';
    setTimeout(() => {
      btn.classList.remove('copied');
      document.getElementById('ctx-copy-label').textContent = 'Copy context';
      document.getElementById('ctx-copy-icon').textContent = '⎘';
    }, 2000);
  }).catch(() => {
    // Fallback: select the textarea so user can Cmd+C manually
    const ta = document.getElementById('ctx-text');
    ta.select();
    document.getElementById('ctx-copy-label').textContent = 'Press Cmd+C to copy';
    setTimeout(() => {
      document.getElementById('ctx-copy-label').textContent = 'Copy context';
    }, 2500);
  });
});
</script>
</body>
</html>`;
}

// ─── Data builders ────────────────────────────────────────────────────────────

// ─── Controller group builder ────────────────────────────────────────────────

function deriveControllerName(sourceFile: string | undefined): string {
  if (!sourceFile) return "Other";
  // Match ClassName.java / ClassName.ts / ClassName.cs / ClassName.py
  const m = sourceFile.match(/([A-Za-z0-9_]+)(?:Controller|Router|Views?|Resource)[\w]*\.(java|ts|cs|py|kt)$/i);
  if (m) return m[1] + "Controller";
  // Fallback: just use the filename without extension
  const base = sourceFile.replace(/\\/g, "/").split("/").pop() ?? "Other";
  return base.replace(/\.\w+$/, "");
}

function buildControllerGroups(endpointsData: ReturnType<typeof buildEndpointsData>) {
  // Map: serviceId → Array<{ name: string, endpoints: string[] }>
  const result: Record<string, Array<{ name: string; endpoints: string[] }>> = {};

  for (const ep of endpointsData) {
    const svc = ep.service;
    if (!result[svc]) result[svc] = [];

    const ctrlName = (ep as { controller?: string }).controller || "Other";
    let ctrl = result[svc].find(c => c.name === ctrlName);
    if (!ctrl) {
      ctrl = { name: ctrlName, endpoints: [] };
      result[svc].push(ctrl);
    }
    ctrl.endpoints.push(ep.id);
  }

  // Sort controllers alphabetically per service
  for (const svc of Object.keys(result)) {
    result[svc].sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

function buildServiceNodes(scanResults: CodeScanResult[], output: CrossCtxOutput) {
  // Prefer code scan results; fall back to OpenAPI services
  if (scanResults.length > 0) {
    return scanResults.map((r) => ({
      id: r.serviceName,
      endpointCount: r.endpoints.length,
      language: r.language.language,
      framework: r.language.framework,
    }));
  }

  return output.services.map((s) => ({
    id: s.name,
    endpointCount: s.endpointCount,
    language: "unknown",
    framework: "unknown",
  }));
}

function buildGraphEdges(callChains: CallChain[], scanResults: CodeScanResult[], output: CrossCtxOutput) {
  const seen = new Set<string>();
  const edges: Array<{
    fromService: string;
    toService: string;
    fromEndpoint: string;
    confidence: number;
    rawUrl?: string;
    callPattern?: string;
    type?: "sync" | "async";
  }> = [];

  // From call chains
  for (const chain of callChains) {
    for (const edge of chain.edges) {
      const key = `${edge.fromService}→${edge.toService}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({
          fromService: edge.fromService,
          toService: edge.toService,
          fromEndpoint: edge.from.split(":")[1] ?? "",
          confidence: edge.confidence,
          rawUrl: edge.rawUrl,
          callPattern: (edge as unknown as Record<string, unknown>)["callPattern"] as string | undefined,
          type: "sync",
        });
      }
    }
  }

  // From message queue events (async dependencies)
  const messageMap = new Map<string, { publishers: Set<string>; subscribers: Set<string> }>();
  for (const result of scanResults) {
    const events = result.messageEvents ?? [];
    for (const event of events) {
      if (!messageMap.has(event.topic)) {
        messageMap.set(event.topic, { publishers: new Set(), subscribers: new Set() });
      }
      const entry = messageMap.get(event.topic)!;
      if (event.direction === "publish") {
        entry.publishers.add(result.serviceName);
      } else {
        entry.subscribers.add(result.serviceName);
      }
    }
  }

  // Create async edges between publishers and subscribers
  for (const [topic, { publishers, subscribers }] of messageMap) {
    for (const fromService of publishers) {
      for (const toService of subscribers) {
        const key = `${fromService}→${toService}:async`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({
            fromService,
            toService,
            fromEndpoint: `topic: ${topic}`,
            confidence: 0.8,
            rawUrl: topic,
            callPattern: "message-queue",
            type: "async",
          });
        }
      }
    }
  }

  // From legacy OpenAPI dependencies
  for (const dep of output.dependencies) {
    const key = `${dep.from}→${dep.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({
        fromService: dep.from,
        toService: dep.to,
        fromEndpoint: dep.evidence,
        confidence: 0.5,
        rawUrl: dep.evidence,
        type: "sync",
      });
    }
  }

  return edges;
}

function buildEndpointsData(scanResults: CodeScanResult[], output: CrossCtxOutput) {
  if (scanResults.length > 0) {
    let idx = 0;
    return scanResults.flatMap((r) =>
      r.endpoints.map((ep) => ({
        id: `ep${idx++}`,
        service: r.serviceName,
        method: ep.method,
        path: ep.path,
        fullPath: ep.fullPath,
        summary: ep.summary,
        sourceFile: ep.sourceFile,
        line: ep.line,
        controller: deriveControllerName(ep.sourceFile),
        requestBody: serializePayload(ep.requestBody),
        response: serializePayload(ep.response),
        hasChain: ep.outboundCalls.length > 0,
        messageEvents: ep.messageEvents?.map((me) => ({
          topic: me.topic,
          direction: me.direction,
          pattern: me.pattern,
          payloadType: me.payloadType,
        })) ?? [],
      }))
    );
  }

  // Fall back to OpenAPI endpoints
  return output.endpoints.map((ep, i) => ({
    id: `ep${i}`,
    service: ep.service,
    method: ep.method,
    path: ep.path,
    fullPath: ep.path,
    summary: ep.summary,
    sourceFile: undefined,
    line: undefined,
    requestBody: ep.requestBody
      ? {
          typeName: undefined,
          fields: Object.entries(ep.requestBody.properties ?? {}).map(([name, type]) => ({
            name,
            type,
            required: true,
          })),
          source: "openapi",
        }
      : null,
    response: ep.response
      ? {
          typeName: undefined,
          fields: Object.entries(ep.response.properties ?? {}).map(([name, type]) => ({
            name,
            type,
            required: false,
          })),
          source: "openapi",
        }
      : null,
    hasChain: false,
  }));
}

function serializePayload(payload: import("../types/index.js").PayloadShape | undefined) {
  if (!payload) return null;
  return {
    typeName: payload.typeName,
    fields: payload.fields,
    source: payload.source,
  };
}
