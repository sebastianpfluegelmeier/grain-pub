// Terrain Chess — UI / interaction layer. Drives the DOM from the pure rules,
// generator, and AI modules. No framework, no build step.

import {
  SIZE, WHITE, BLACK, TERRAIN, TERRAIN_NAME, TERRAIN_GLYPH, TERRAIN_DESC,
  makeState, pieceAt, terrainAt, analyzeMovement, allLegalMoves, applyMove,
  applyPass, countPieces, cloneState,
} from './rules.js';
import { generateBoard } from './generator.js';
import { chooseMove } from './ai.js';

const NS = 'http://www.w3.org/2000/svg';

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ALL8 = [...ORTHO, ...DIAG];
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const inb = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

// ---- App state -------------------------------------------------------------
const S = {
  state: null,
  meta: null,
  mode: '1p',            // '1p' | '2p' | 'ai'
  humanSide: WHITE,      // relevant in '1p'
  interaction: 'play',   // 'play' | 'inspect'
  selected: null,        // { r, c, analysis }
  inspect: null,         // { r, c }
  lastMove: null,        // { from, to, capture }
  history: [],
  log: [],
  moveNo: 0,
  paused: false,
  aiTimer: null,
  settings: { symmetric: true, weighted: true, heat: false },
  _cellMarks: new Map(),
};

// ---- DOM refs --------------------------------------------------------------
const el = (id) => document.getElementById(id);
const boardEl = el('board');
const raysEl = el('rays');
const turnbarEl = el('turnbar');
const statusEl = el('status');
const genInfoEl = el('genInfo');
const legendEl = el('legend');
const logEl = el('log');
const hintEl = el('hint');
const seedInput = el('seedInput');
const inspectPanel = el('inspectPanel');
const inspectInfo = el('inspectInfo');
const aiControls = el('aiControls');
const sideField = el('sideField');
const pauseBtn = el('pauseBtn');

// ---- Small helpers ---------------------------------------------------------
const nameOf = (p) => (p === WHITE ? 'White' : 'Black');
const symbolOf = (p) => (p === WHITE ? '●' : '○');
const sqLabel = ([r, c]) => String.fromCharCode(97 + c) + (SIZE - r);
const clearAiTimer = () => { if (S.aiTimer) { clearTimeout(S.aiTimer); S.aiTimer = null; } };

function controllerOf(player) {
  if (S.mode === '2p') return 'human';
  if (S.mode === 'ai') return 'ai';
  return player === S.humanSide ? 'human' : 'ai';
}

function pushLog(msg, strong = false) { S.log.push({ msg, strong }); }

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startBoard(seed) {
  clearAiTimer();
  const res = generateBoard({
    seed,
    weighted: S.settings.weighted,
    symmetric: S.settings.symmetric,
  });
  S.meta = res;
  S.state = makeState(res.terrain);
  S.selected = null;
  S.inspect = null;
  S.lastMove = null;
  S.history = [];
  S.log = [];
  S.moveNo = 0;
  S.paused = false;
  seedInput.value = res.seed;
  const m = res.metrics;
  pushLog(
    `New board · seed ${res.seed} · ${res.accepted ? 'accepted' : 'best of ' + res.attempts + ' tries'} · `
    + `${m.stronglyConnected ? 'strongly connected' : 'NOT fully connected'} · avg mobility ${m.avgMobility.toFixed(2)}`,
    true,
  );
  render();
  advance();
}

function restartBoard() {
  clearAiTimer();
  const terrain = S.state.terrain;
  S.state = makeState(terrain);
  S.selected = null;
  S.inspect = null;
  S.lastMove = null;
  S.history = [];
  S.moveNo = 0;
  S.paused = false;
  pushLog('Board restarted — same terrain.', true);
  render();
  advance();
}

// Drive turns: auto-pass stuck sides, schedule AI, or wait for a human click.
function advance() {
  clearAiTimer();
  if (!S.state || S.state.winner) { render(); return; }
  const player = S.state.toMove;
  if (allLegalMoves(S.state, player).length === 0) {
    applyPass(S.state);
    pushLog(`${nameOf(player)} has no legal move — passes.`);
    render();
    if (!S.state.winner) S.aiTimer = setTimeout(advance, 550);
    return;
  }
  if (controllerOf(player) === 'ai' && !S.paused) {
    S.aiTimer = setTimeout(aiStep, S.mode === 'ai' ? 650 : 430);
  }
  render();
}

function aiStep() {
  S.aiTimer = null;
  if (!S.state || S.state.winner) return;
  const player = S.state.toMove;
  if (controllerOf(player) !== 'ai') { render(); return; }
  const res = chooseMove(S.state, player);
  if (!res) { advance(); return; }
  performMove(res.move, true, res.score);
}

function pushHistory() {
  S.history.push({
    state: cloneState(S.state),
    lastMove: S.lastMove ? { ...S.lastMove } : null,
    logLen: S.log.length,
    moveNo: S.moveNo,
  });
  if (S.history.length > 300) S.history.shift();
}

function performMove(move, byAI, score) {
  pushHistory();
  const mover = S.state.toMove;
  const { captured } = applyMove(S.state, move);
  S.lastMove = { from: move.from.slice(), to: move.to.slice(), capture: move.capture };
  S.selected = null;
  S.moveNo += 1;

  const destTerrain = terrainAt(S.state, move.to[0], move.to[1]);
  let msg = `${S.moveNo}. ${symbolOf(mover)} ${sqLabel(move.from)}→${sqLabel(move.to)}`;
  if (captured) msg += ` × ${symbolOf(captured.player)}`;
  msg += ` · lands on ${TERRAIN_NAME[destTerrain]}`;
  if (byAI && score != null) msg += ` · ai ${Math.round(score)}`;
  pushLog(msg, !!captured);

  if (S.state.winner) {
    pushLog(`${nameOf(mover)} wins — all enemy pieces captured!`, true);
    render();
    return;
  }
  render();
  advance();
}

function undo() {
  clearAiTimer();
  if (!S.history.length) return;
  const restore = (snap) => {
    S.state = snap.state;
    S.lastMove = snap.lastMove;
    S.moveNo = snap.moveNo;
    S.log.length = snap.logLen;
  };
  restore(S.history.pop());
  // In AI-involving modes, roll back through AI plies so a human regains control.
  while (S.history.length && S.mode !== 'ai' && controllerOf(S.state.toMove) === 'ai') {
    restore(S.history.pop());
  }
  S.selected = null;
  if (S.mode === 'ai') S.paused = true; // don't let the demo run away after an undo
  render();
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function onCell(r, c) {
  if (!S.state) return;
  if (S.interaction === 'inspect') {
    S.inspect = { r, c };
    render();
    return;
  }
  // Play mode
  if (S.state.winner) return;
  const player = S.state.toMove;
  if (controllerOf(player) !== 'human') return; // AI's turn

  if (S.selected) {
    const mv = S.selected.analysis.moves.find((m) => m.to[0] === r && m.to[1] === c);
    if (mv) { performMove(mv, false); return; }
  }
  const clicked = pieceAt(S.state, r, c);
  if (clicked && clicked.player === player) {
    S.selected = { r, c, analysis: analyzeMovement(S.state, r, c, { mover: player }) };
    render();
    return;
  }
  S.selected = null;
  render();
}

// ---------------------------------------------------------------------------
// Movement -> visual markers
// ---------------------------------------------------------------------------

// Play mode: derive markers/rays from a computed analysis.
function playVisual(analysis, r0, c0) {
  const markers = [];
  const rays = [];
  const addMark = (r, c, kind) => markers.push({ r, c, kind });
  const addLine = (r, c, kind) => rays.push({ x1: c0 + 0.5, y1: r0 + 0.5, x2: c + 0.5, y2: r + 0.5, kind });

  for (const ray of analysis.rays) {
    let end = null;
    for (const s of ray.squares) {
      addMark(s.r, s.c, s.kind);
      if (s.kind === 'move' || s.kind === 'capture') end = s;
    }
    if (end) addLine(end.r, end.c, 'move');
  }
  for (const st of analysis.steps) {
    addMark(st.r, st.c, st.kind);
    if (st.kind === 'move' || st.kind === 'capture') addLine(st.r, st.c, 'move');
  }
  for (const jp of analysis.jumps) addMark(jp.r, jp.c, jp.kind); // knight: markers only
  if (analysis.pawn) {
    if (analysis.pawn.forward) {
      addMark(analysis.pawn.forward.r, analysis.pawn.forward.c, 'move');
      addLine(analysis.pawn.forward.r, analysis.pawn.forward.c, 'move');
    }
    for (const cap of analysis.pawn.captures) addMark(cap.r, cap.c, cap.kind);
  }
  return { markers, rays, isInspect: false };
}

// Inspect mode: raw terrain pattern, occupancy ignored, rays to the edge.
// Pawn shows BOTH colours' directions since inspect is about learning terrain.
function inspectVisual(r0, c0, terrain) {
  const markers = [];
  const rays = [];
  const add = (r, c) => markers.push({ r, c, kind: 'inspect' });
  const line = (r, c) => rays.push({ x1: c0 + 0.5, y1: r0 + 0.5, x2: c + 0.5, y2: r + 0.5, kind: 'inspect' });
  const slide = (dirs) => {
    for (const [dr, dc] of dirs) {
      let r = r0 + dr; let c = c0 + dc; let last = null;
      while (inb(r, c)) { add(r, c); last = [r, c]; r += dr; c += dc; }
      if (last) line(last[0], last[1]);
    }
  };
  const step = (dirs, drawLine) => {
    for (const [dr, dc] of dirs) {
      const r = r0 + dr; const c = c0 + dc;
      if (inb(r, c)) { add(r, c); if (drawLine) line(r, c); }
    }
  };
  switch (terrain) {
    case 'Q': slide(ALL8); break;
    case 'R': slide(ORTHO); break;
    case 'B': slide(DIAG); break;
    case 'K': step(ALL8, true); break;
    case 'N': step(KNIGHT, false); break;
    case 'P': step([[-1, 0], [1, 0]], true); step(DIAG, false); break;
    default: break;
  }
  return { markers, rays, isInspect: true };
}

function activeVisual() {
  if (S.interaction === 'inspect' && S.inspect) {
    const { r, c } = S.inspect;
    return { r, c, ...inspectVisual(r, c, terrainAt(S.state, r, c)) };
  }
  if (S.interaction === 'play' && S.selected) {
    const { r, c, analysis } = S.selected;
    return { r, c, ...playVisual(analysis, r, c) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const vis = activeVisual();
  computeCellMarks(vis);
  renderBoard();
  renderRays(vis);
  renderTurnbar();
  renderStatus();
  renderGenInfo();
  renderInspect();
  renderLegend();
  renderLog();
  renderControls();
  renderHint();
}

function computeCellMarks(vis) {
  S._cellMarks = new Map();
  if (!vis) return;
  const rank = { capture: 3, inspect: 2, move: 2, blocked: 1, threat: 0 };
  for (const m of vis.markers) {
    const key = `${m.r},${m.c}`;
    const r = rank[m.kind] ?? 0;
    const prev = S._cellMarks.get(key);
    if (!prev || r > prev.rank) S._cellMarks.set(key, { kind: m.kind, rank: r });
  }
}

function highlightClass(r, c) {
  const mk = S._cellMarks.get(`${r},${c}`);
  if (!mk) return '';
  switch (mk.kind) {
    case 'capture': return 'hl-capture';
    case 'move': return 'hl-move';
    case 'inspect': return 'hl-inspect';
    case 'blocked': return 'hl-blocked';
    default: return '';
  }
}

function heatStyle(r, c) {
  const degs = S.meta?.metrics?.degrees;
  if (!degs) return '';
  const maxd = Math.max(1, ...degs);
  const t = degs[r * SIZE + c] / maxd;
  const hue = 210 - 198 * t; // low mobility = blue, high = red
  return `background:hsl(${hue.toFixed(0)} 82% 50%)`;
}

function renderBoard() {
  const showHeat = S.settings.heat;
  const parts = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = terrainAt(S.state, r, c);
      const p = pieceAt(S.state, r, c);
      const cls = ['cell', (r + c) % 2 ? 'dark' : 'light'];
      const hl = highlightClass(r, c);
      if (hl) cls.push(hl);
      if (S.lastMove && ((S.lastMove.from[0] === r && S.lastMove.from[1] === c)
        || (S.lastMove.to[0] === r && S.lastMove.to[1] === c))) cls.push('hl-last');
      if (S.selected && S.selected.r === r && S.selected.c === c) cls.push('selected');
      if (S.interaction === 'inspect' && S.inspect && S.inspect.r === r && S.inspect.c === c) cls.push('selected');
      const heat = showHeat ? ` style="${heatStyle(r, c)}"` : '';
      parts.push(
        `<div class="${cls.join(' ')}" data-r="${r}" data-c="${c}">`
        + `<div class="heat"${heat}></div>`
        + `<span class="terrain">${TERRAIN_GLYPH[t]}</span>`
        + `<span class="badge">${TERRAIN_GLYPH[t]}</span>`
        + `<span class="coord">${sqLabel([r, c])}</span>`
        + (p ? `<div class="piece ${p.player}"></div>` : '')
        + '</div>',
      );
    }
  }
  boardEl.innerHTML = parts.join('');
  boardEl.classList.toggle('show-heat', showHeat);
}

function renderRays(vis) {
  raysEl.innerHTML = '';
  if (!vis) return;
  for (const ry of vis.rays) {
    const ln = document.createElementNS(NS, 'line');
    ln.setAttribute('x1', ry.x1);
    ln.setAttribute('y1', ry.y1);
    ln.setAttribute('x2', ry.x2);
    ln.setAttribute('y2', ry.y2);
    ln.setAttribute('stroke-width', vis.isInspect ? 0.05 : 0.06);
    ln.setAttribute('class', `ray-${ry.kind}`);
    raysEl.appendChild(ln);
  }
  // Source ring around the selected/inspected tile.
  const src = document.createElementNS(NS, 'circle');
  src.setAttribute('cx', vis.c + 0.5);
  src.setAttribute('cy', vis.r + 0.5);
  src.setAttribute('r', 0.42);
  src.setAttribute('class', 'mk-source');
  raysEl.appendChild(src);

  for (const m of vis.markers) {
    const el2 = document.createElementNS(NS, 'circle');
    el2.setAttribute('cx', m.c + 0.5);
    el2.setAttribute('cy', m.r + 0.5);
    let r = 0.13;
    let cls = 'mk-move';
    if (m.kind === 'capture') { r = 0.30; cls = 'mk-capture'; }
    else if (m.kind === 'blocked') { r = 0.10; cls = 'mk-blocked'; }
    else if (m.kind === 'threat') { r = 0.16; cls = 'mk-threat'; }
    else if (m.kind === 'inspect') { r = 0.13; cls = 'mk-inspect'; }
    el2.setAttribute('r', r);
    el2.setAttribute('class', cls);
    raysEl.appendChild(el2);
  }
}

function renderTurnbar() {
  const st = S.state;
  let dotClass = st.toMove;
  let who;
  if (st.winner) {
    if (st.winner === 'draw') { who = 'Draw — neither side can move.'; dotClass = ''; }
    else { who = `${nameOf(st.winner)} wins!`; dotClass = st.winner; }
  } else if (controllerOf(st.toMove) === 'ai') {
    who = `${nameOf(st.toMove)} · AI to move`;
  } else if (S.mode === '2p') {
    who = `${nameOf(st.toMove)} to move`;
  } else {
    who = `Your move (${nameOf(st.toMove)})`;
  }
  const dot = dotClass ? `<span class="dot ${dotClass}"></span>` : '';
  turnbarEl.innerHTML = `${dot}<span class="who">${who}</span>`;
}

function renderStatus() {
  const st = S.state;
  const w = countPieces(st, WHITE);
  const b = countPieces(st, BLACK);
  const modeName = { '1p': 'Single player vs AI', '2p': 'Two players (local)', ai: 'AI vs AI' }[S.mode];
  let banner = '';
  if (st.winner === 'draw') banner = '<div class="banner draw">Draw</div>';
  else if (st.winner) banner = `<div class="banner win">${nameOf(st.winner)} wins — all enemy pieces captured</div>`;
  else banner = `<div class="banner turn">${controllerOf(st.toMove) === 'ai' ? nameOf(st.toMove) + ' (AI) is thinking…' : nameOf(st.toMove) + ' to move'}</div>`;

  statusEl.innerHTML = `
    <div class="line"><span>Mode</span><span>${modeName}</span></div>
    <div class="line"><span>Pieces</span><span class="count-pair">
      <span class="c"><span class="disc W"></span>${w}</span>
      <span class="c"><span class="disc B"></span>${b}</span>
    </span></div>
    <div class="line"><span>Moves played</span><span>${S.moveNo}</span></div>
    ${banner}`;
}

function renderGenInfo() {
  const m = S.meta?.metrics;
  if (!m) { genInfoEl.innerHTML = ''; return; }
  genInfoEl.innerHTML = `
    <div class="line"><span>Seed</span><span>${S.meta.seed}</span></div>
    <div class="line"><span>Attempts</span><span>${S.meta.attempts}${S.meta.accepted ? '' : ' (best effort)'}</span></div>
    <div class="line"><span>Connectivity</span><span>${m.stronglyConnected ? 'strongly connected ✓' : m.sccCount + ' regions ✗'}</span></div>
    <div class="line"><span>Avg mobility</span><span>${m.avgMobility.toFixed(2)}</span></div>
    <div class="line"><span>Min mobility</span><span>${m.minMobility}</span></div>`;
}

function renderInspect() {
  if (S.interaction !== 'inspect') { inspectPanel.hidden = true; return; }
  inspectPanel.hidden = false;
  if (!S.inspect) {
    inspectInfo.innerHTML = '<p class="hint">Click any square to see the movement pattern its terrain grants — occupancy ignored.</p>';
    return;
  }
  const { r, c } = S.inspect;
  const t = terrainAt(S.state, r, c);
  const deg = S.meta?.metrics?.degrees?.[r * SIZE + c];
  inspectInfo.innerHTML = `
    <div class="row" style="gap:12px;align-items:center;">
      <span class="g">${TERRAIN_GLYPH[t]}</span>
      <span><span class="name">${TERRAIN_NAME[t]}</span> · ${sqLabel([r, c])}</span>
    </div>
    <p class="desc" style="margin:8px 0 4px;">${TERRAIN_DESC[t]}</p>
    ${deg != null ? `<div class="line"><span>Tile mobility (graph out-degree)</span><span>${deg}</span></div>` : ''}
    <p class="hint">A piece landing here would use this pattern on its <em>next</em> turn.</p>`;
}

function renderLegend() {
  legendEl.innerHTML = TERRAIN.map((t) => `
    <div class="item">
      <span class="g">${TERRAIN_GLYPH[t]}</span>
      <span class="t"><strong>${TERRAIN_NAME[t]}</strong><small>${TERRAIN_DESC[t]}</small></span>
    </div>`).join('');
}

function renderLog() {
  logEl.innerHTML = S.log.map((e) => `<div class="entry">${e.strong ? `<b>${e.msg}</b>` : e.msg}</div>`).join('');
  logEl.scrollTop = logEl.scrollHeight;
}

function renderControls() {
  document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
  document.querySelectorAll('#humanSide button').forEach((b) => b.classList.toggle('on', b.dataset.side === S.humanSide));
  document.querySelectorAll('#interact button').forEach((b) => b.classList.toggle('on', b.dataset.int === S.interaction));
  sideField.hidden = S.mode !== '1p';
  aiControls.hidden = S.mode !== 'ai';
  pauseBtn.textContent = S.paused ? 'Resume ▸' : 'Pause';
  el('undoBtn').disabled = S.history.length === 0;
}

function renderHint() {
  let h;
  if (S.interaction === 'inspect') {
    h = 'Inspect mode: click any tile to reveal its terrain’s movement pattern (pieces ignored).';
  } else if (S.state.winner) {
    h = S.state.winner === 'draw' ? 'Game over — draw.' : `Game over — ${nameOf(S.state.winner)} wins.`;
  } else if (controllerOf(S.state.toMove) === 'ai') {
    h = 'The AI is choosing a move…';
  } else if (S.selected) {
    h = 'Green = move, red ring = capture, hatched = blocked. Click a highlight to move, or pick another piece.';
  } else {
    h = 'Select one of your discs to see where its current terrain lets it move.';
  }
  hintEl.textContent = h;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function setMode(mode) {
  S.mode = mode;
  S.selected = null;
  S.paused = false;
  render();
  advance();
}

function setSide(side) {
  S.humanSide = side;
  S.selected = null;
  render();
  advance();
}

function setInteraction(mode) {
  S.interaction = mode;
  S.selected = null;
  S.inspect = null;
  render();
}

function wire() {
  boardEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    onCell(Number(cell.dataset.r), Number(cell.dataset.c));
  });

  el('mode').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (b) setMode(b.dataset.mode);
  });
  el('humanSide').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (b) setSide(b.dataset.side);
  });
  el('interact').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (b) setInteraction(b.dataset.int);
  });

  pauseBtn.addEventListener('click', () => {
    S.paused = !S.paused;
    if (!S.paused) advance(); else { clearAiTimer(); render(); }
  });
  el('stepBtn').addEventListener('click', () => {
    if (!S.state || S.state.winner) return;
    const p = S.state.toMove;
    if (controllerOf(p) !== 'ai') return;
    S.paused = true;
    clearAiTimer();
    if (allLegalMoves(S.state, p).length === 0) { applyPass(S.state); pushLog(`${nameOf(p)} passes.`); render(); }
    else aiStep();
    S.paused = true;
    render();
  });

  el('undoBtn').addEventListener('click', undo);
  el('restartBtn').addEventListener('click', restartBoard);
  el('randomBtn').addEventListener('click', () => startBoard(undefined));
  el('newSeedBtn').addEventListener('click', () => {
    const v = parseInt(seedInput.value, 10);
    startBoard(Number.isFinite(v) ? v : 0);
  });

  el('optSymmetric').addEventListener('change', (e) => { S.settings.symmetric = e.target.checked; });
  el('optWeighted').addEventListener('change', (e) => { S.settings.weighted = e.target.checked; });
  el('optHeat').addEventListener('change', (e) => { S.settings.heat = e.target.checked; render(); });
}

wire();
startBoard(undefined);
