// The graph view of the animation editor (docs/animation-graph-plan.md 6.4):
// states and edges drawn in SVG, the details panel for the selection and the
// playback warnings. The document is read through `session.doc` and changed
// only through `session.edit` with the edits in anim-model.js, so every change
// is one undo step. The selection lives in the session, so the canvas and the
// frame timeline can follow the selected edge.

import {icon} from './icons.js';
import {addNode, renameNode, moveNode, deleteNode, addEdge, reverseEdge, setBidirectional, setCancelable,
  duplicateEdge, deleteEdge, graphWarnings, nodeById, edgeById, loopsOf, edgesOf, isLoop} from './anim-model.js';

// States are drawn like patcher objects: a box with inlets along its top
// edge and outlets along its bottom edge. An edge leaves its start state
// through an outlet and enters its end state through an inlet, so every edge
// has its own place on both boxes. All sizes are in graph units.
const NODE_HEIGHT = 26, NODE_MIN_WIDTH = 48, NODE_PAD = 8, ID_GAP = 10, ID_CHAR = 6.1;
const PORT_WIDTH = 8, PORT_HEIGHT = 3, PORT_STEP = 14;
// The straight piece an edge runs before its first and after its last bend,
// the distance kept between parallel pieces of different edges, and the bend
// radius.
const STUB = 10, LANE = 7, CORNER = 5, SIDE_GAP = 14, MARGIN = 20, CLEARANCE = 4;
const MIN_SCALE = 0.2, MAX_SCALE = 3, FIT_MAX_SCALE = 1.5, FIT_PADDING = 32;
// Used while the graph is hidden or measured without layout (tests).
const FALLBACK_SIZE = {width: 400, height: 300};
const DRAG_THRESHOLD = 3;
// A finger or pen wobbles more than a mouse, so it has to travel further
// before a press on a state counts as moving it.
const TOUCH_DRAG_THRESHOLD = 10;
// Safari on iPad sends no dblclick for touch, so a double-tap is recognised
// from the pointer events: two short presses that stay in place, close
// together in time and space. Distances are in screen pixels, times in ms.
const TAP_SLOP = 10, TAP_TIME = 350, DOUBLE_TAP_TIME = 400, DOUBLE_TAP_REACH = 36;
// One notch of a mouse wheel reports a delta of about 100, a trackpad a few
// units per event. Limiting each event keeps a notch to a modest zoom step.
const WHEEL_ZOOM_LIMIT = 30;
// Touches this long after pen contact are a resting hand (as on the canvas).
const PEN_PALM_REJECTION_MS = 800;
const text = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
let instances = 0;

// `onPlayGraph()` runs when the Play graph toggle is pressed; the preview
// (anim-preview.js) answers with setPreview.
export function createAnimationGraph({parent, details, session, confirm: ask = message => globalThis.confirm(message), onPlayGraph = () => {}}) {
  const uid = 'anim-graph-' + ++instances;
  parent.classList.add('anim-graph');
  parent.innerHTML = `
    <div class="anim-graph-toolbar">
      <button class="anim-icon-button" data-add-node aria-label="Add state" title="Add a state in the middle of the graph">${icon('plus')}</button>
      <button class="anim-icon-button" data-fit aria-label="Fit graph" title="Fit the whole graph into view">${icon('arrows-out-simple')}</button>
      <button class="anim-icon-button anim-icon-toggle" data-play-graph aria-pressed="false" aria-label="Play graph" title="Play graph: click a state to request it (Escape leaves)">${icon('play')}${icon('stop')}</button>
      <p class="anim-graph-status" role="status" aria-live="polite"></p>
    </div>
    <svg class="anim-graph-canvas" tabindex="0" role="application" aria-label="Animation graph. Double-click empty space to add a state, double-click a state to rename it, drag a state to move it. Drag from the open outlet on a state's bottom edge to another state to add an edge, or away and back onto the same state for a loop. Arrow keys select states and edges, Enter renames the selected state, Delete removes the selection.">
      <defs>
        <marker id="${uid}-arrow" class="anim-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z"/></marker>
        <marker id="${uid}-arrow-active" class="anim-arrow active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z"/></marker>
      </defs>
      <g data-viewport></g>
      <text class="anim-graph-measure" aria-hidden="true" x="-10000" y="-10000"></text>
    </svg>
    <p class="anim-graph-empty" hidden></p>`;
  const $ = selector => parent.querySelector(selector);
  const svg = $('.anim-graph-canvas'), viewport = $('[data-viewport]'), measureText = $('.anim-graph-measure');
  const statusLine = $('.anim-graph-status'), emptyLine = $('.anim-graph-empty');

  // view maps graph units to SVG pixels: screen = graph * k + (x, y).
  let view = {x: FALLBACK_SIZE.width / 2, y: FALLBACK_SIZE.height / 2, k: 1};
  let width = FALLBACK_SIZE.width, height = FALLBACK_SIZE.height, measured = false;
  // An opened document is fitted, and stays fitted while the region changes
  // size (the view being shown, the details panel growing) until the user
  // pans, zooms or edits. The Fit button turns this on again.
  let autoFit = true;
  let gesture = null, renaming = null;
  // Play mode of the preview (6.7): {onRequest(nodeId), panel} while
  // previewing, else null. `panel` takes the place of the details.
  let preview = null, highlight = null;
  const textWidths = new Map();

  const doc = () => session.doc;
  const selection = () => session.selection;
  const editable = () => Boolean(doc()) && !session.readOnly && !preview;
  function message(value = '') { statusLine.textContent = value; }
  // Runs a model edit through the session. Errors are rules of the format
  // ("A state named idle already exists"), so they are shown, not thrown.
  function run(change) {
    try {
      const result = session.edit(change);
      message('');
      return result;
    } catch (error) {
      message(error.message || String(error));
      return undefined;
    }
  }

  // Geometry ------------------------------------------------------------------

  function nameWidth(name) {
    if (textWidths.has(name)) return textWidths.get(name);
    measureText.textContent = name;
    const measuredWidth = typeof measureText.getComputedTextLength === 'function' ? measureText.getComputedTextLength() : 0;
    // Only real measurements are kept; a hidden SVG reports 0.
    if (measuredWidth > 0) { textWidths.set(name, measuredWidth); return measuredWidth; }
    return name.length * 7;
  }
  function box(node, positions, outlets, inlets) {
    const position = positions.get(node.id) ?? node;
    // One more outlet than there are edges: the open one that starts a new edge.
    const slots = Math.max(outlets + 1, inlets);
    const w = Math.max(NODE_MIN_WIDTH, nameWidth(node.name) + String(node.id).length * ID_CHAR + ID_GAP + 2 * NODE_PAD,
      (slots - 1) * PORT_STEP + PORT_WIDTH);
    return {id: node.id, x: position.x, y: position.y, hw: w / 2, hh: NODE_HEIGHT / 2};
  }
  // The middle of the port in slot `index`, counted from the box's left edge.
  const portX = (b, index) => b.x - b.hw + index * PORT_STEP + PORT_WIDTH / 2;

  // The two shapes an edge can take, before lanes are assigned. An end state
  // far enough below the start is reached with one pair of bends ("down").
  // Anything else leaves downwards, runs to a free column beside the boxes
  // and comes back in from above ("wrap"); a loop wraps around its own box.
  function downRoute(a, b, x1, x2) {
    const y1 = a.y + a.hh, y2 = b.y - b.hh - 1;
    return y2 - y1 >= 2 * STUB ? {kind: 'down', x1, y1, x2, y2, mid: (y1 + y2) / 2} : null;
  }
  function wrapRoute(a, b, x1, x2, loop, drop = STUB) {
    const y1 = a.y + a.hh, y2 = b.y - b.hh - 1;
    const aLeft = a.x - a.hw, aRight = a.x + a.hw, bLeft = b.x - b.hw, bRight = b.x + b.hw;
    let side, dir = 1;
    if (loop) side = aRight + SIDE_GAP;
    else if (bLeft - aRight >= 2 * STUB) side = (aRight + bLeft) / 2;
    else if (aLeft - bRight >= 2 * STUB) { side = (bRight + aLeft) / 2;dir = -1; }
    else if (b.x >= a.x) side = Math.max(aRight, bRight) + SIDE_GAP;
    else { side = Math.min(aLeft, bLeft) - SIDE_GAP;dir = -1; }
    return {kind: 'wrap', x1, y1, x2, y2, below: y1 + drop, above: y2 - STUB, side, dir, loop, drop};
  }
  const route = (a, b, x1, x2, loop, drop) => (!loop && downRoute(a, b, x1, x2)) || wrapRoute(a, b, x1, x2, loop, drop);
  function corners(r) {
    if (r.kind === 'down') {
      return Math.abs(r.x1 - r.x2) < 0.5 ? [[r.x1, r.y1], [r.x2, r.y2]] : [[r.x1, r.y1], [r.x1, r.mid], [r.x2, r.mid], [r.x2, r.y2]];
    }
    return [[r.x1, r.y1], [r.x1, r.below], [r.side, r.below], [r.side, r.above], [r.x2, r.above], [r.x2, r.y2]];
  }
  // A path through the corner points with every bend rounded.
  function roundedPath(points) {
    let d = `M${points[0][0]} ${points[0][1]}`;
    for (let index = 1; index < points.length - 1; index++) {
      const [px, py] = points[index - 1], [x, y] = points[index], [nx, ny] = points[index + 1];
      const before = Math.hypot(x - px, y - py), after = Math.hypot(nx - x, ny - y);
      const radius = Math.min(CORNER, before / 2, after / 2);
      if (radius < 0.5) { d += `L${x} ${y}`;continue; }
      d += `L${x + (px - x) / before * radius} ${y + (py - y) / before * radius}Q${x} ${y} ${x + (nx - x) / after * radius} ${y + (ny - y) / after * radius}`;
    }
    const last = points.at(-1);
    return d + `L${last[0]} ${last[1]}`;
  }
  // The length of that path. Every bend is a right angle, and a rounded one
  // is shorter than its two straight ends by a fixed share of the radius.
  function pathLength(points) {
    let total = 0;
    for (let index = 1; index < points.length; index++) total += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
    for (let index = 1; index < points.length - 1; index++) {
      const before = Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
      const after = Math.hypot(points[index + 1][0] - points[index][0], points[index + 1][1] - points[index][1]);
      const radius = Math.min(CORNER, before / 2, after / 2);
      if (radius >= 0.5) total -= radius * (2 - 1.6232);
    }
    return total;
  }
  // The frame count sits on the edge's longest inner piece, moved along it
  // when another edge's count is already there.
  function labelPoint(points, placed) {
    let a = points[0], b = points.at(-1), length = -1;
    const inner = points.length > 2 ? [1, points.length - 2] : [0, 1];
    for (let index = inner[0]; index < inner[1]; index++) {
      const piece = Math.hypot(points[index + 1][0] - points[index][0], points[index + 1][1] - points[index][1]);
      if (piece > length) { length = piece;a = points[index];b = points[index + 1]; }
    }
    if (length < 20) { a = points[0];b = points.at(-1); }
    const at = t => ({x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t});
    const free = point => !placed.some(other => Math.abs(other.x - point.x) < 18 && Math.abs(other.y - point.y) < 14);
    const point = [0.5, 0.3, 0.7, 0.18, 0.82].map(at).find(free) ?? at(0.5);
    placed.push(point);
    return point;
  }

  // Positions of every drawn element. Each state lists its outlets and
  // inlets from left to right in the order of the states they lead to, which
  // keeps edges from crossing right at the box. Pieces of different edges
  // that would run along the same line are moved one lane apart.
  //
  // Edges of the same kind into the same state form a bundle: they share one
  // inlet and may run along the same line, so they join on the way there.
  // Many loops on a state then take one lane around it instead of one each.
  // The kinds are loop, one-way and bidirectional, each plain or cancelable.
  const bundleKey = edge => `${edge.to}:${isLoop(edge) ? 'loop' : edge.bidirectional ? 'both' : 'one'}${edge.cancelable ? ':cancelable' : ''}`;
  function layout() {
    const d = doc();
    const positions = new Map();
    if (gesture?.type === 'move' && gesture.moved) positions.set(gesture.id, gesture.position);
    const outs = new Map(d.nodes.map(node => [node.id, []])), ins = new Map(d.nodes.map(node => [node.id, []]));
    for (const edge of d.edges) { outs.get(edge.from)?.push(edge);ins.get(edge.to)?.push(edge); }
    const inCount = new Map([...ins].map(([id, list]) => [id, new Set(list.map(bundleKey)).size]));
    const boxes = new Map(d.nodes.map(node => [node.id, box(node, positions, outs.get(node.id).length, inCount.get(node.id))]));
    const centre = id => boxes.get(id)?.x ?? 0;
    // Loops go last: they leave and return on the box's right.
    for (const list of outs.values()) list.sort((a, b) => isLoop(a) - isLoop(b) || centre(a.to) - centre(b.to) || a.id - b.id);
    for (const list of ins.values()) list.sort((a, b) => isLoop(a) - isLoop(b) || centre(a.from) - centre(b.from) || a.id - b.id);

    // The inlet of each edge: one per bundle, in the order the bundles first appear.
    const slot = new Map(), members = new Map();
    for (const list of ins.values()) {
      const seen = new Map();
      for (const edge of list) {
        const key = bundleKey(edge);
        if (!seen.has(key)) seen.set(key, seen.size);
        slot.set(edge, seen.get(key));
        members.set(key, (members.get(key) ?? 0) + 1);
      }
    }
    // In a bundle the frame count sits under the edge's own outlet, the one
    // place that is not shared. Edges of a bundle that leave the same state
    // have neighbouring outlets, so their counts alternate between two rows.
    const routes = [...d.edges].sort((a, b) => a.id - b.id).filter(edge => boxes.has(edge.from) && boxes.has(edge.to)).map(edge => {
      const a = boxes.get(edge.from), b = boxes.get(edge.to), key = bundleKey(edge), bundled = members.get(key) > 1;
      const siblings = bundled ? outs.get(edge.from).filter(other => bundleKey(other) === key) : [edge];
      const x1 = portX(a, outs.get(edge.from).indexOf(edge)), rows = Math.min(2, siblings.length);
      const drop = bundled ? 9 + 13 * rows : STUB, r = route(a, b, x1, portX(b, slot.get(edge)), isLoop(edge), drop);
      return {edge, a, b, key, ...r, drop, own: bundled ? {x: x1, y: r.y1 + 10 + (siblings.indexOf(edge) % 2) * 13} : null};
    });
    // Occupied lines: horizontal pieces by their y, vertical pieces by their x.
    const taken = {h: [], v: []};
    const clash = (list, c, lo, hi, key) => list.some(piece => piece.key !== key && Math.abs(piece.c - c) < LANE - 0.5 && piece.lo < hi - 0.5 && lo < piece.hi - 0.5);
    // Whether a piece would run through a state's box. A line behind a box
    // looks connected to it, so pieces keep clear of every box but their own.
    const boxList = [...boxes.values()];
    const blocked = (vertical, c, from, to, skip = []) => {
      const lo = Math.min(from, to), hi = Math.max(from, to);
      return boxList.some(b => !skip.includes(b.id) && (vertical
        ? Math.abs(c - b.x) < b.hw + CLEARANCE && lo < b.y + b.hh + CLEARANCE && hi > b.y - b.hh - CLEARANCE
        : Math.abs(c - b.y) < b.hh + CLEARANCE && lo < b.x + b.hw + CLEARANCE && hi > b.x - b.hw - CLEARANCE));
    };
    const take = (list, c, from, to, key) => { list.push({c, lo: Math.min(from, to), hi: Math.max(from, to), key});return c; };
    // The first of the candidate lines that is free; `fallback` when none is.
    const pick = (candidates, free, fallback) => candidates.find(free) ?? fallback;
    const outward = Array.from({length: 40}, (_, index) => index * LANE);
    const around = outward.flatMap(offset => offset ? [offset, -offset] : [0]);
    // The pieces at the ports cannot move, so they are entered first.
    for (const r of routes) {
      const from = r.kind === 'down' ? r.mid : r.below, to = r.kind === 'down' ? r.mid : r.above;
      taken.v.push({c: r.x1, lo: r.y1, hi: from, key: r.key}, {c: r.x2, lo: to, hi: r.y2, key: r.key});
    }
    const shapes = [], labels = [];
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (let r of routes) {
      const {edge, a, b, key, own} = r, rewrap = () => ({edge, a, b, key, own, ...wrapRoute(a, b, r.x1, r.x2, false, r.drop)});
      if (r.kind === 'down') {
        const lo = Math.min(r.x1, r.x2), hi = Math.max(r.x1, r.x2), straight = hi - lo < 0.5;
        const clear = mid => !blocked(true, r.x1, r.y1, mid, [a.id]) && !blocked(true, r.x2, mid, r.y2, [b.id]);
        if (straight) {
          if (!clear(r.mid)) r = rewrap();
        } else {
          const mids = around.map(offset => r.mid + offset).filter(mid => mid > r.y1 + CORNER && mid < r.y2 - CORNER);
          const mid = pick(mids, mid => clear(mid) && !blocked(false, mid, lo, hi) && !clash(taken.h, mid, lo, hi, key), null);
          if (mid === null) r = rewrap();
          else r.mid = take(taken.h, mid, lo, hi, key);
        }
      }
      if (r.kind === 'wrap') {
        // A loop only moves outwards, so its lanes nest around the box.
        const sides = (r.loop ? outward : around).map(offset => r.side + offset * r.dir);
        r.side = take(taken.v, pick(sides, side => !blocked(true, side, r.above, r.below) && !clash(taken.v, side, r.above, r.below, key), r.side), r.above, r.below, key);
        const lanes = (base, sign, x) => pick(outward.map(offset => base + sign * offset),
          y => !blocked(false, y, x, r.side) && !clash(taken.h, y, Math.min(x, r.side), Math.max(x, r.side), key), base);
        r.below = take(taken.h, lanes(r.below, 1, r.x1), r.x1, r.side, key);
        r.above = take(taken.h, lanes(r.above, -1, r.x2), r.x2, r.side, key);
      }
      const points = corners(r);
      for (const [x, y] of points) { left = Math.min(left, x);right = Math.max(right, x);top = Math.min(top, y);bottom = Math.max(bottom, y); }
      if (own) labels.push(own);
      // Dashes are counted from the end of the line, so the dashed edges of a
      // bundle lie exactly on each other where they share it.
      shapes.push({edge, d: roundedPath(points), label: own ?? labelPoint(points, labels), loop: isLoop(edge), dash: (7 - pathLength(points) % 7) % 7});
    }
    for (const b of boxes.values()) {
      left = Math.min(left, b.x - b.hw);right = Math.max(right, b.x + b.hw);
      top = Math.min(top, b.y - b.hh);bottom = Math.max(bottom, b.y + b.hh + PORT_HEIGHT + 2);
    }
    const outlet = (id, index) => { const b = boxes.get(id);return {x: portX(b, index), y: b.y + b.hh}; };
    const inlet = (id, index) => { const b = boxes.get(id);return {x: portX(b, index), y: b.y - b.hh}; };
    return {boxes, shapes, outs, inCount, outlet, inlet, bounds: {left, right, top, bottom}};
  }
  function nodeAt(point, boxes) {
    const list = [...boxes.values()].reverse();
    return list.find(b => Math.abs(point.x - b.x) <= b.hw + 2 && Math.abs(point.y - b.y) <= b.hh + PORT_HEIGHT + 2) ?? null;
  }

  // View ------------------------------------------------------------------------

  function measure() {
    const rect = svg.getBoundingClientRect();
    measured = rect.width > 0 && rect.height > 0;
    if (measured) { width = svg.clientWidth || rect.width;height = svg.clientHeight || rect.height; }
    else { width = FALLBACK_SIZE.width;height = FALLBACK_SIZE.height; }
  }
  function pointer(event) {
    const rect = svg.getBoundingClientRect();
    // Studio's View zoom scales the page, so client pixels are converted back to SVG pixels.
    const scale = rect.width > 0 && svg.clientWidth > 0 ? svg.clientWidth / rect.width : 1;
    const sx = (event.clientX - rect.left) * scale, sy = (event.clientY - rect.top) * scale;
    return {sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k};
  }
  function fit() {
    autoFit = true;
    render();
  }
  function computeFit() {
    const d = doc();
    if (!d || !d.nodes.length) { view = {x: width / 2, y: height / 2, k: 1};return; }
    // The bounds cover the states and every edge, with room for a new edge.
    let {left, right, top, bottom} = layout().bounds;
    left -= MARGIN;right += MARGIN;top -= MARGIN;bottom += MARGIN;
    const k = clamp(Math.min((width - 2 * FIT_PADDING) / (right - left), (height - 2 * FIT_PADDING) / (bottom - top), FIT_MAX_SCALE), MIN_SCALE, MAX_SCALE);
    view = {k, x: width / 2 - (left + right) / 2 * k, y: height / 2 - (top + bottom) / 2 * k};
  }
  // Panning and zooming change only the transform; the drawing inside stays as it is.
  function applyView() {
    viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
    placeRename();
  }
  function zoomAt(sx, sy, factor) {
    const k = clamp(view.k * factor, MIN_SCALE, MAX_SCALE);
    view = {k, x: sx - (sx - view.x) * k / view.k, y: sy - (sy - view.y) * k / view.k};
    autoFit = false;
    applyView();
  }
  // A free spot near the middle of the visible area for a new state.
  function freeSpot() {
    const d = doc(), centre = {x: (width / 2 - view.x) / view.k, y: (height / 2 - view.y) / view.k};
    for (let ring = 0; ring < 40; ring++) {
      const spot = {x: centre.x + (ring % 2 ? 1 : -1) * Math.ceil(ring / 2) * 40, y: centre.y + Math.floor(ring / 2) * 64};
      if (!d.nodes.some(node => Math.abs(node.x - spot.x) < 90 && Math.abs(node.y - spot.y) < 56)) return spot;
    }
    return centre;
  }

  // Drawing ---------------------------------------------------------------------

  function render() {
    const d = doc();
    measure();
    if (d && autoFit) computeFit();
    $('[data-add-node]').disabled = !editable();
    $('[data-add-node]').hidden = Boolean(preview);
    $('[data-fit]').disabled = !d?.nodes.length;
    const play = $('[data-play-graph]');
    play.setAttribute('aria-pressed', String(Boolean(preview)));
    // Leaving must stay possible after an undo removed every state.
    play.disabled = !preview && !d?.nodes.length;
    svg.classList.toggle('previewing', Boolean(preview));
    if (!d) { viewport.innerHTML = '';emptyLine.hidden = true;placeRename();return; }
    emptyLine.hidden = d.nodes.length > 0;
    const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches;
    emptyLine.textContent = session.readOnly ? 'This animation has no states.' : `${coarse ? 'Double-tap' : 'Double-click'} to add a state.`;
    const {boxes, shapes, outs, inCount, outlet, inlet} = layout();
    const selected = selection();
    // The selection is kept through the preview but not drawn, because its
    // accent colour would read as the playing edge.
    const isSelected = (kind, id) => !preview && selected?.kind === kind && selected.id === id;
    const name = id => nodeById(d, id)?.name ?? '';
    let markup = '';
    // The selected and the playing edge are drawn last, on top of the lines
    // they share with others.
    const front = shape => Number(isSelected('edge', shape.edge.id) || highlight?.edge === shape.edge.id);
    for (const {edge, d: path, label, loop, dash} of [...shapes].sort((a, b) => front(a) - front(b))) {
      const playing = highlight?.edge === edge.id, reversed = playing && Boolean(highlight.reversed);
      const both = !loop && edge.bidirectional;
      const classes = ['anim-edge', edge.cancelable && 'cancelable', isSelected('edge', edge.id) && 'selected', playing && 'playing', reversed && 'reversed'].filter(Boolean).join(' ');
      const arrow = on => `url(#${uid}-arrow${on ? '-active' : ''})`;
      // A played bidirectional edge lights only the arrowhead it travels
      // towards, so its direction shows.
      const endMarker = arrow(isSelected('edge', edge.id) || (playing && !reversed));
      const startMarker = arrow(isSelected('edge', edge.id) || reversed);
      const frames = edge.frames.length;
      const description = loop ? `Loop on ${name(edge.from)}` : `Edge from ${name(edge.from)} to ${name(edge.to)}`;
      const flags = [plural(frames, 'frame'), !loop && edge.bidirectional && 'bidirectional', edge.cancelable && 'cancelable'].filter(Boolean).join(', ');
      const labelWidth = String(frames).length * 6.2 + 8;
      markup += `<g class="${classes}" data-edge="${edge.id}" role="button" aria-label="${text(description + ', ' + flags)}">
        <title>${text(description + ', ' + flags)}</title>
        <path class="anim-edge-hit" d="${path}"/>
        <path class="anim-edge-line" d="${path}" marker-end="${endMarker}" ${both ? `marker-start="${startMarker}"` : ''} ${edge.cancelable ? `stroke-dashoffset="${dash.toFixed(2)}"` : ''}/>
        <rect class="anim-edge-label-bg" x="${label.x - labelWidth / 2}" y="${label.y - 7}" width="${labelWidth}" height="14"/>
        <text class="anim-edge-label" x="${label.x}" y="${label.y + 3.5}" text-anchor="middle">${frames}</text>
      </g>`;
    }
    const target = gesture?.type === 'edge' ? gesture.target : null;
    for (const node of d.nodes) {
      const b = boxes.get(node.id);
      const classes = ['anim-node', isSelected('node', node.id) && 'selected', target === node.id && 'target',
        highlight?.node === node.id && 'current', highlight?.requested === node.id && 'requested'].filter(Boolean).join(' ');
      const left = b.x - b.hw, top = b.y - b.hh, bottom = b.y + b.hh;
      const ports = (count, y) => Array.from({length: count}, (_, index) => `<rect class="anim-port" x="${left + index * PORT_STEP}" y="${y}" width="${PORT_WIDTH}" height="${PORT_HEIGHT}"/>`).join('');
      markup += `<g class="${classes}" data-node="${node.id}" role="button" aria-label="${text(`State ${node.name}, id ${node.id}`)}">
        <rect class="anim-node-box" x="${left}" y="${top}" width="${b.hw * 2}" height="${b.hh * 2}"/>
        ${ports(inCount.get(node.id), top)}${ports(outs.get(node.id).length, bottom - PORT_HEIGHT)}
        <text class="anim-node-name" x="${left + NODE_PAD}" y="${b.y + 4}">${text(node.name)}</text>
        <text class="anim-node-id" x="${b.x + b.hw - NODE_PAD}" y="${b.y + 4}" text-anchor="end">${node.id}</text>
      </g>`;
      if (!preview) {
        // The open outlet: the next free slot on the bottom edge. The larger
        // transparent shape around it is what the pointer grabs.
        const open = outlet(node.id, outs.get(node.id).length);
        markup += `<g class="anim-handle" data-handle="${node.id}"><title>${text(`Drag to add an edge from ${node.name}`)}</title>
          <rect class="anim-handle-hit" x="${open.x - PORT_WIDTH / 2 - 3}" y="${open.y - 5}" width="${PORT_WIDTH + 6}" height="14"/>
          <rect class="anim-handle-port" x="${open.x - PORT_WIDTH / 2 + 0.5}" y="${open.y - PORT_HEIGHT + 0.5}" width="${PORT_WIDTH - 1}" height="${PORT_HEIGHT + 3}"/>
        </g>`;
      }
    }
    if (gesture?.type === 'edge') {
      // The edge as it would be drawn: from the open outlet to the next free
      // inlet of the state under the pointer, or to the pointer itself.
      const from = boxes.get(gesture.from), start = outlet(gesture.from, outs.get(gesture.from).length);
      let points;
      if (target !== null) {
        const to = boxes.get(target), end = inlet(target, inCount.get(target));
        points = corners(route(from, to, start.x, end.x, target === gesture.from));
      } else {
        const {x, y} = gesture.point;
        points = y - start.y >= 2 * STUB ? [[start.x, start.y], [start.x, (start.y + y) / 2], [x, (start.y + y) / 2], [x, y]]
          : [[start.x, start.y], [start.x, start.y + STUB], [x, start.y + STUB], [x, y]];
      }
      markup += `<path class="anim-edge-draft" d="${roundedPath(points)}" marker-end="url(#${uid}-arrow-active)"/>`;
    }
    viewport.innerHTML = markup;
    applyView();
  }

  // Details panel and warnings ----------------------------------------------------

  function renderDetails() {
    const d = doc();
    const focused = details.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    if (!d) { details.replaceChildren();return; }
    if (preview?.panel) {
      // The preview's controls replace the selection's details; the panel
      // element is kept in place, so focus and a dragged slider survive.
      for (const child of [...details.children]) if (child !== preview.panel) child.remove();
      if (preview.panel.parentNode !== details) details.prepend(preview.panel);
      details.insertAdjacentHTML('beforeend', warningsMarkup(d));
      return;
    }
    const selected = selection(), locked = !editable();
    const disabled = locked ? 'disabled' : '';
    let markup = '';
    const nameOf = id => text(nodeById(d, id)?.name ?? '');
    const stateButton = (id, focus) => `<button class="anim-name" data-select-node="${id}" data-focus="${focus}" title="Select this state">${nameOf(id)}</button>`;
    if (selected?.kind === 'node') {
      const node = nodeById(d, selected.id), loops = loopsOf(d, node.id);
      const others = [...d.nodes].sort((a, b) => a.id - b.id);
      markup += `<section class="anim-details-selection" aria-label="Selected state">
        <label class="anim-detail-name">Name<input data-node-name data-focus="name" value="${text(node.name)}" maxlength="64" autocomplete="off" spellcheck="false" ${disabled}></label>
        <p class="anim-detail-id">id <code>${node.id}</code><button class="anim-icon-button" data-copy-id data-focus="copy" aria-label="Copy id ${node.id}" title="Copy the id for use as state: ${node.id} in code">${icon('copy')}</button></p>
        <h3>Loops</h3>
        ${loops.length ? `<ul class="anim-detail-loops">${loops.map(edge => `<li><button data-select-edge="${edge.id}" data-focus="loop-${edge.id}">${plural(edge.frames.length, 'frame')}${edge.cancelable ? ', cancelable' : ''}</button></li>`).join('')}</ul>`
          : '<p class="anim-detail-note">No loop. Resting here shows nothing.</p>'}
        <div class="anim-detail-new-edge">
          <label>New edge to<select data-edge-target data-focus="target" ${disabled}>${others.map(other => `<option value="${other.id}" ${other.id === node.id ? 'selected' : ''}>${text(other.id === node.id ? other.name + ' (loop)' : other.name)}</option>`).join('')}</select></label>
          <button class="anim-icon-button" data-add-edge data-focus="add-edge" aria-label="Add edge" title="Add this edge" ${disabled}>${icon('plus')}</button>
        </div>
        <div class="anim-detail-actions"><button class="anim-icon-button danger" data-delete data-focus="delete" aria-label="Delete state" title="Delete this state and its edges" ${disabled}>${icon('trash')}</button></div>
      </section>`;
    } else if (selected?.kind === 'edge') {
      const edge = edgeById(d, selected.id), loop = isLoop(edge);
      // The heading names both ends; each name selects its state.
      markup += `<section class="anim-details-selection" aria-label="Selected edge">
        <h3>${loop ? `Loop on ${stateButton(edge.from, 'from')}` : `${stateButton(edge.from, 'from')} ${edge.bidirectional ? '⇄' : '→'} ${stateButton(edge.to, 'to')}`}</h3>
        <p class="anim-detail-note" data-frame-count>${plural(edge.frames.length, 'frame')}</p>
        ${loop ? '' : `<label class="anim-detail-toggle"><input type="checkbox" data-bidirectional data-focus="bidirectional" ${edge.bidirectional ? 'checked' : ''} ${disabled}>Bidirectional<span>also plays backwards, from end to start</span></label>`}
        <label class="anim-detail-toggle"><input type="checkbox" data-cancelable data-focus="cancelable" ${edge.cancelable ? 'checked' : ''} ${disabled}>Cancelable<span>a new request cuts it short</span></label>
        <div class="anim-detail-actions">
          ${loop ? '' : `<button class="anim-icon-button" data-reverse data-focus="reverse" aria-label="Reverse" title="Reverse: swap start and end, and reverse the frame order" ${disabled}>${icon('swap')}</button>`}
          <button class="anim-icon-button" data-duplicate data-focus="duplicate" aria-label="Duplicate" title="Duplicate: add a parallel edge with copies of these frames" ${disabled}>${icon('copy')}</button>
          <button class="anim-icon-button danger" data-delete data-focus="delete" aria-label="Delete edge" title="Delete this edge" ${disabled}>${icon('trash')}</button>
        </div>
      </section>`;
    } else {
      markup += `<p class="anim-details-hint">${d.nodes.length ? 'Select a state or an edge to see its details.' : 'Add a state to start the graph.'}</p>`;
    }
    markup += warningsMarkup(d);
    details.innerHTML = markup;
    if (focused) details.querySelector(`[data-focus="${focused}"]`)?.focus({preventScroll: true});
  }
  function warningsMarkup(d) {
    const nameOf = id => text(nodeById(d, id)?.name ?? '');
    const warnings = graphWarnings(d), lines = [];
    for (const {from, to} of warnings.unreachable) {
      lines.push(`No route from <span class="anim-name">${nameOf(from)}</span> to ${to.map(id => `<span class="anim-name">${nameOf(id)}</span>`).join(', ')}. Requesting ${to.length === 1 ? 'it' : 'them'} there cuts without a transition.`);
    }
    if (warnings.noLoop.length) {
      lines.push(`No loop on ${warnings.noLoop.map(id => `<span class="anim-name">${nameOf(id)}</span>`).join(', ')}. Resting there shows nothing.`);
    }
    return lines.length ? `<section class="anim-warnings" aria-label="Warnings"><h3>Warnings</h3><ul>${lines.map(line => `<li>${line}</li>`).join('')}</ul></section>` : '';
  }

  function deleteSelection() {
    const d = doc(), selected = selection();
    if (!editable() || !selected) return;
    if (selected.kind === 'node') {
      const node = nodeById(d, selected.id), count = edgesOf(d, node.id).length;
      if (count && !ask(`Delete ${node.name} and its ${plural(count, 'edge')}?`)) return;
      if (run(doc => deleteNode(doc, node.id))) session.select(null);
    } else if (run(doc => deleteEdge(doc, selected.id))) session.select(null);
  }
  function addEdgeBetween(from, to) {
    // A loop is the resting animation of its state, and a request should be
    // able to leave it at once, so a new loop starts out cancelable.
    const edge = run(doc => { const added = addEdge(doc, from, to);if (from === to) added.cancelable = true;return added; });
    if (edge) session.select({kind: 'edge', id: edge.id});
  }
  function addNodeAt(point) {
    const node = run(doc => addNode(doc, {x: point.x, y: point.y}));
    if (!node) return;
    session.select({kind: 'node', id: node.id});
    startRename(node.id);
  }

  details.addEventListener('click', event => {
    const target = event.target.closest('button');
    const selected = selection();
    // In play mode the region holds the preview's own controls.
    if (!target || !selected || !doc() || preview) return;
    if (target.matches('[data-select-edge]')) session.select({kind: 'edge', id: Number(target.dataset.selectEdge)});
    else if (target.matches('[data-select-node]')) session.select({kind: 'node', id: Number(target.dataset.selectNode)});
    else if (target.matches('[data-copy-id]')) copyId(selected.id);
    else if (target.matches('[data-add-edge]')) addEdgeBetween(selected.id, Number(details.querySelector('[data-edge-target]').value));
    else if (target.matches('[data-reverse]')) run(doc => reverseEdge(doc, selected.id));
    else if (target.matches('[data-duplicate]')) {
      const copy = run(doc => duplicateEdge(doc, selected.id));
      if (copy) session.select({kind: 'edge', id: copy.id});
    } else if (target.matches('[data-delete]')) deleteSelection();
  });
  details.addEventListener('change', event => {
    const selected = selection();
    if (!selected || preview) return;
    const input = event.target;
    if (input.matches('[data-node-name]')) {
      const name = input.value.trim();
      if (name === nodeById(doc(), selected.id)?.name) { input.value = name;return; }
      if (run(doc => renameNode(doc, selected.id, name)) === undefined) input.value = nodeById(doc(), selected.id)?.name ?? '';
    } else if (input.matches('[data-bidirectional]')) {
      if (run(doc => setBidirectional(doc, selected.id, input.checked)) === undefined) input.checked = !input.checked;
    } else if (input.matches('[data-cancelable]')) {
      if (run(doc => setCancelable(doc, selected.id, input.checked)) === undefined) input.checked = !input.checked;
    }
  });
  details.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('[data-node-name]')) { event.preventDefault();event.target.blur(); }
    else if (event.key === 'Escape' && event.target.matches('[data-node-name]')) {
      event.preventDefault();event.stopPropagation();
      event.target.value = nodeById(doc(), selection()?.id)?.name ?? '';event.target.blur();
    }
  });
  async function copyId(id) {
    try {
      await globalThis.navigator.clipboard.writeText(String(id));
      message(`Copied id ${id}`);
    } catch {
      message(`Copying is not available here; the id is ${id}`);
    }
  }

  // Renaming on the canvas ----------------------------------------------------------

  function startRename(id) {
    const node = nodeById(doc(), id);
    if (!node || !editable()) return;
    cancelRename();
    const input = document.createElement('input');
    input.className = 'anim-graph-rename';input.value = node.name;input.maxLength = 64;
    input.autocomplete = 'off';input.spellcheck = false;input.setAttribute('aria-label', 'State name');
    renaming = {id, input};
    parent.append(input);
    placeRename();
    input.focus();input.select();
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault();event.stopPropagation();
      if (event.key === 'Enter') commitRename(false);else { cancelRename();message('');svg.focus({preventScroll: true}); }
    });
    input.addEventListener('blur', () => { if (renaming?.input === input) commitRename(true); });
  }
  // On Enter an invalid name keeps the field open with the reason; leaving
  // the field gives up and keeps the old name.
  function commitRename(leaving) {
    if (!renaming) return;
    const {id, input} = renaming, name = input.value.trim();
    if (name !== nodeById(doc(), id)?.name && run(doc => renameNode(doc, id, name)) === undefined) {
      if (!leaving) { input.focus();input.select();return; }
    }
    renaming = null;input.remove();
    if (!leaving) svg.focus({preventScroll: true});
  }
  function cancelRename() {
    if (!renaming) return false;
    const {input} = renaming;
    renaming = null;input.remove();
    return true;
  }
  function placeRename() {
    if (!renaming) return;
    const node = doc() && nodeById(doc(), renaming.id);
    if (!node) { cancelRename();return; }
    const b = layout().boxes.get(node.id);
    const svgRect = svg.getBoundingClientRect(), parentRect = parent.getBoundingClientRect();
    const scale = svgRect.width > 0 && svg.clientWidth > 0 ? svg.clientWidth / svgRect.width : 1;
    const left = (svgRect.left - parentRect.left) * scale + view.x + (b.x - b.hw) * view.k;
    const top = (svgRect.top - parentRect.top) * scale + view.y + (b.y - b.hh) * view.k;
    Object.assign(renaming.input.style, {left: left + 'px', top: top + 'px', width: Math.max(120, b.hw * 2 * view.k) + 'px', height: b.hh * 2 * view.k + 'px'});
  }

  // Pointer input ---------------------------------------------------------------------

  const capture = id => { try { svg.setPointerCapture?.(id); } catch {} };
  const release = id => { try { if (svg.hasPointerCapture?.(id)) svg.releasePointerCapture(id); } catch {} };
  // Two fingers pinch and pan the graph. A second finger ends what the first
  // one started (a pan, a move or a new edge) without applying it. A finger
  // stays captured until it lifts: the shape it first touched is redrawn
  // away under it, and without the capture its pointerup would never reach
  // the graph.
  const touches = new Map();
  // The view before the fingers now on the graph touched it, and the time
  // until which new touches count as a resting hand.
  let beforeTouch = null, penUntil = 0;
  // The press in progress and the last finished tap of a finger or pen, for
  // recognising double-taps: {time, sx, sy, what}, where `what` is 'empty',
  // 'node:<id>' or 'other'.
  let press = null, lastTap = null, doubleTapAt = -Infinity;
  function pinchShape() {
    const [a, b] = [...touches.values()];
    return {sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2, spread: Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy))};
  }
  // Forgets the fingers on the graph and ends what they were doing without
  // applying it. `restore` also takes back their panning and zooming.
  function dropTouches(restore) {
    touches.clear();press = null;lastTap = null;
    if (gesture?.pointerType === 'touch') gesture = null;
    if (restore && beforeTouch) { view = beforeTouch.view;autoFit = beforeTouch.autoFit; }
    beforeTouch = null;
    render();
  }
  // A hand resting on the graph while the pen draws must not pan or zoom it.
  // Pen contact anywhere on the page takes back what the fingers on the graph
  // have done, and touches shortly after it are ignored.
  function onPen(event) {
    if (event.pointerType !== 'pen' || (event.type === 'pointermove' && !(event.buttons > 0 || event.pressure > 0))) return;
    penUntil = Date.now() + PEN_PALM_REJECTION_MS;
    if (touches.size) dropTouches(true);
  }
  const penEvents = ['pointerdown', 'pointermove', 'pointerup'];
  for (const type of penEvents) globalThis.addEventListener?.(type, onPen, true);
  svg.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' && doc()) {
      if (Date.now() < penUntil) return;
      // A primary touch is the only finger on the screen, so a finger still
      // recorded here has lost its pointerup. It must not turn this press
      // into a pinch.
      if (event.isPrimary && touches.size) dropTouches(false);
      if (!touches.size) beforeTouch = {view: {...view}, autoFit};
      touches.set(event.pointerId, pointer(event));
      capture(event.pointerId);
      if (touches.size === 2) {
        if (gesture?.type === 'pan') gesture = null;
        else cancelGesture();
        if (renaming) commitRename(true);
        press = null;lastTap = null;
        gesture = {type: 'pinch', pointerType: 'touch', shape: pinchShape()};
        autoFit = false;
        render();
        return;
      }
      if (touches.size > 2) return;
    }
    if (!doc() || event.button !== 0 || gesture) return;
    // The browser focuses the SVG itself on a click, which shows no focus
    // ring; focusing it from script here would show one after keyboard use.
    if (renaming) commitRename(true);
    const p = pointer(event);
    const handle = event.target.closest?.('[data-handle]'), nodeElement = event.target.closest?.('[data-node]'), edgeElement = event.target.closest?.('[data-edge]');
    const fingerOrPen = event.pointerType === 'touch' || event.pointerType === 'pen';
    // The pointer is captured below, so pointerup no longer says what was pressed.
    press = fingerOrPen ? {pointerId: event.pointerId, time: event.timeStamp, sx: p.sx, sy: p.sy,
      what: handle || edgeElement ? 'other' : nodeElement ? 'node:' + nodeElement.dataset.node : 'empty'} : null;
    const slop = fingerOrPen ? TOUCH_DRAG_THRESHOLD : DRAG_THRESHOLD;
    // A press on empty space pans once it has moved, so a tap leaves the view
    // alone. Only a press that stays in place clears the selection: the
    // selected edge is what the canvas shows, and looking around the graph
    // must not take it away.
    const pan = deselect => ({type: 'pan', pointerId: event.pointerId, origin: p, view: {...view}, moved: false, slop, deselect});
    if (preview) {
      if (nodeElement) preview.onRequest?.(Number(nodeElement.dataset.node));
      else gesture = pan(false);
    } else if (handle && editable()) {
      const from = Number(handle.dataset.handle);
      gesture = {type: 'edge', pointerId: event.pointerId, from, point: p, target: null, left: false};
    } else if (nodeElement) {
      const id = Number(nodeElement.dataset.node), node = nodeById(doc(), id);
      session.select({kind: 'node', id});
      if (editable()) gesture = {type: 'move', pointerId: event.pointerId, id, origin: p, start: {x: node.x, y: node.y}, position: {x: node.x, y: node.y}, moved: false, slop};
    } else if (edgeElement) {
      session.select({kind: 'edge', id: edgeAt(event, edgeElement)});
    } else gesture = pan(true);
    // Refitting while a state or an edge is dragged would move the drawing under the pointer.
    if (gesture && gesture.type !== 'pan') autoFit = false;
    if (gesture) { gesture.pointerType = event.pointerType;capture(event.pointerId);render(); }
  });
  svg.addEventListener('pointermove', event => {
    if (touches.has(event.pointerId)) touches.set(event.pointerId, pointer(event));
    if (gesture?.type === 'pinch') {
      if (!touches.has(event.pointerId) || touches.size < 2) return;
      // The graph point under the fingers' midpoint stays under it, and the
      // scale follows their distance. Each step starts from the one before,
      // so a finger that joins or leaves causes no jump.
      const from = gesture.shape, now = pinchShape();
      const k = clamp(view.k * now.spread / from.spread, MIN_SCALE, MAX_SCALE);
      view = {k, x: now.sx - (from.sx - view.x) * k / view.k, y: now.sy - (from.sy - view.y) * k / view.k};
      gesture.shape = now;
      applyView();
      return;
    }
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const p = pointer(event), g = gesture;
    if (g.type === 'pan') {
      g.moved ||= Math.hypot(p.sx - g.origin.sx, p.sy - g.origin.sy) > g.slop;
      if (!g.moved) return;
      view = {...g.view, x: g.view.x + p.sx - g.origin.sx, y: g.view.y + p.sy - g.origin.sy};
      autoFit = false;
      applyView();
      return;
    } else if (g.type === 'move') {
      g.moved ||= Math.hypot(p.sx - g.origin.sx, p.sy - g.origin.sy) > g.slop;
      g.position = {x: g.start.x + p.x - g.origin.x, y: g.start.y + p.y - g.origin.y};
    } else if (g.type === 'edge') {
      g.point = p;
      g.target = nodeAt(p, layout().boxes)?.id ?? null;
      // A loop needs the pointer to leave the state and come back, so a
      // click on the handle adds nothing.
      g.left ||= g.target !== g.from;
      if (g.target === g.from && !g.left) g.target = null;
    }
    render();
  });
  // The edge a press on `element` selects. Edges of a bundle lie on each
  // other where they share a line; a press there on the selected edge moves
  // on to the next one, so repeated presses go through all of them. A frame
  // count belongs to one edge and always selects that one.
  function edgeAt(event, element) {
    const id = Number(element.dataset.edge), selected = selection();
    if (!event.target.matches?.('.anim-edge-hit') || selected?.kind !== 'edge') return id;
    const under = document.elementsFromPoint?.(event.clientX, event.clientY) ?? [];
    const ids = [...new Set(under.map(item => item.closest?.('[data-edge]')).filter(Boolean).map(item => Number(item.dataset.edge)))].sort((a, b) => a - b);
    const index = ids.indexOf(selected.id);
    return index < 0 ? id : ids[(index + 1) % ids.length];
  }
  function finish(event) {
    touches.delete(event.pointerId);
    if (!touches.size) beforeTouch = null;
    if (gesture?.type === 'pinch') {
      release(event.pointerId);
      // The fingers still down carry on: two keep pinching, one pans.
      if (touches.size >= 2) gesture.shape = pinchShape();
      else if (touches.size === 1) {
        const [[pointerId, origin]] = touches;
        gesture = {type: 'pan', pointerType: 'touch', pointerId, origin, view: {...view}, moved: true, slop: 0, deselect: false};
      } else gesture = null;
      return;
    }
    const tap = tapOf(event);
    if (gesture && event.pointerId === gesture.pointerId) {
      if (event.type === 'pointercancel') { cancelGesture();return; }
      const g = gesture;
      gesture = null;release(event.pointerId);
      if (g.type === 'move' && g.moved) run(doc => moveNode(doc, g.id, g.position.x, g.position.y));
      else if (g.type === 'pan' && g.deselect && !g.moved) session.select(null);
      else if (g.type === 'edge') {
        const target = nodeAt(pointer(event), layout().boxes);
        if (target && (target.id !== g.from || g.left)) addEdgeBetween(g.from, target.id);
      }
      render();
    }
    if (tap) handleTap(tap);
  }
  // The finished press as a tap, or null when it took too long, travelled
  // too far or was cancelled.
  function tapOf(event) {
    const down = press;
    if (!down || down.pointerId !== event.pointerId) return null;
    press = null;
    if (event.type !== 'pointerup') return null;
    const p = pointer(event);
    if (event.timeStamp - down.time > TAP_TIME || Math.hypot(p.sx - down.sx, p.sy - down.sy) > TAP_SLOP) return null;
    return {time: event.timeStamp, p, what: down.what};
  }
  function handleTap(tap) {
    const previous = lastTap;
    lastTap = tap;
    if (!previous || previous.what !== tap.what || tap.time - previous.time > DOUBLE_TAP_TIME
      || Math.hypot(tap.p.sx - previous.p.sx, tap.p.sy - previous.p.sy) > DOUBLE_TAP_REACH) return;
    lastTap = null;
    if (activate(tap.what, tap.p)) doubleTapAt = tap.time;
  }
  // What a double-click or a double-tap does: on a state it opens the name
  // for editing, on empty space it adds a state there.
  function activate(what, point) {
    if (!editable() || gesture) return false;
    if (what.startsWith('node:')) {
      const id = Number(what.slice(5));
      if (!nodeById(doc(), id)) return false;
      session.select({kind: 'node', id});
      startRename(id);
      return true;
    }
    if (what !== 'empty') return false;
    addNodeAt(point);
    return true;
  }
  function cancelGesture() {
    if (!gesture) return false;
    const g = gesture;
    gesture = null;
    if (g.pointerType !== 'touch') release(g.pointerId);
    if (g.type === 'pan') view = g.view;
    render();
    return true;
  }
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
  svg.addEventListener('lostpointercapture', event => { if (gesture?.pointerId === event.pointerId) cancelGesture(); });
  svg.addEventListener('dblclick', event => {
    event.preventDefault();
    // A browser that does send dblclick for touch must not repeat a double-tap
    // that the pointer events already handled.
    if (event.timeStamp - doubleTapAt < 700) return;
    const nodeElement = event.target.closest?.('[data-node]');
    activate(nodeElement ? 'node:' + nodeElement.dataset.node : event.target.closest?.('[data-edge],[data-handle]') ? 'other' : 'empty', pointer(event));
  });
  // Ctrl or Cmd with the wheel (and trackpad pinch, which arrives as a
  // Ctrl-wheel) zooms at the pointer; plain scrolling pans.
  svg.addEventListener('wheel', event => {
    if (!doc()) return;
    event.preventDefault();
    const p = pointer(event);
    autoFit = false;
    if (event.ctrlKey || event.metaKey) zoomAt(p.sx, p.sy, Math.exp(-clamp(event.deltaY, -WHEEL_ZOOM_LIMIT, WHEEL_ZOOM_LIMIT) * 0.01));
    else { view = {...view, x: view.x - event.deltaX, y: view.y - event.deltaY};applyView(); }
  }, {passive: false});
  // Safari and the desktop app report a trackpad pinch as gesture events
  // instead of a Ctrl-wheel. A touch screen sends them for two fingers too,
  // which are handled through their pointers above, so they are left alone there.
  let pinchFrom = null;
  svg.addEventListener('gesturestart', event => { event.preventDefault();pinchFrom = doc() && !(globalThis.navigator?.maxTouchPoints > 0) ? view.k : null; }, {passive: false});
  svg.addEventListener('gesturechange', event => {
    event.preventDefault();
    if (pinchFrom === null || !(event.scale > 0)) return;
    const p = Number.isFinite(event.clientX) ? pointer(event) : {sx: width / 2, sy: height / 2};
    zoomAt(p.sx, p.sy, pinchFrom * event.scale / view.k);
  }, {passive: false});
  svg.addEventListener('gestureend', event => { event.preventDefault();pinchFrom = null; }, {passive: false});
  $('[data-add-node]').addEventListener('click', () => { if (editable()) { measure();addNodeAt(freeSpot()); } });
  $('[data-fit]').addEventListener('click', () => fit());
  $('[data-play-graph]').addEventListener('click', () => onPlayGraph());

  // Keys: Escape cancels an edge drag, a move or a rename anywhere in the view;
  // Delete and Backspace remove the selection only while the graph has focus,
  // because the canvas uses Delete for its own selection (6.9).
  function handleKey(event) {
    if (event.key === 'Escape' && (gesture || renaming)) {
      event.preventDefault();
      if (!cancelGesture()) cancelRename();
      message('');svg.focus({preventScroll: true});
      return true;
    }
    if (event.target !== svg || event.metaKey || event.ctrlKey || event.altKey || !doc()) return false;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!selection()) return false;
      event.preventDefault();
      deleteSelection();
      return true;
    }
    // Arrow keys step through the states in id order, then the edges, so
    // everything can be selected without a pointer.
    if (event.key.startsWith('Arrow') && !preview) {
      const d = doc(), items = [...[...d.nodes].sort((a, b) => a.id - b.id).map(node => ({kind: 'node', id: node.id})),
        ...d.edges.map(edge => ({kind: 'edge', id: edge.id}))];
      if (!items.length) return false;
      event.preventDefault();
      const current = items.findIndex(item => item.kind === selection()?.kind && item.id === selection()?.id);
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      session.select(items[current < 0 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length]);
      return true;
    }
    if (event.key === 'Enter' && selection()?.kind === 'node' && editable()) {
      event.preventDefault();
      startRename(selection().id);
      return true;
    }
    return false;
  }

  function update(event) {
    if (event.reason === 'open' || event.reason === 'close' || event.reason === 'reload') {
      cancelGesture();cancelRename();message('');autoFit = true;highlight = null;
    } else if (event.reason !== 'select') autoFit = false;
    // Details first: their height decides the graph's size for the fit.
    renderDetails();render();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!gesture) render(); }) : null;
  observer?.observe(svg);
  render();

  return {
    update,
    handleKey,
    fit,
    // The graph's SVG transform, {x, y, k}: a state at (nx, ny) is drawn at
    // (nx * k + x, ny * k + y) inside the SVG.
    get view() { return {...view}; },
    get svg() { return svg; },
    // Play mode for the preview (6.7). With `{onRequest(nodeId), panel}` the
    // graph stops editing, clicking a state calls onRequest, dragging pans,
    // and the details region shows `panel` and the warnings. `null` returns
    // to editing.
    setPreview(options) {
      cancelGesture();cancelRename();
      preview = options || null;
      if (!preview) highlight = null;
      render();renderDetails();
    },
    // What the preview is playing: {node, edge, requested, reversed}, ids or
    // null. The edge gets the `playing` class (and `reversed` while a
    // bidirectional edge plays backwards, which lights only its start
    // arrowhead), the node `current` and the requested state `requested`.
    setHighlight(value) {
      highlight = value || null;
      render();
    },
    destroy() {
      observer?.disconnect();
      for (const type of penEvents) globalThis.removeEventListener?.(type, onPen, true);
      cancelGesture();cancelRename();
      parent.replaceChildren();details.replaceChildren();
    },
  };
}
