// The vector canvas of the animation editor (docs/vector-animation-design.md,
// sections 3, 7 and 11): the shapes of the selected edge at the playhead,
// drawn with Canvas 2D from the outline the runtime draws (shapeOutline in
// anim-vector.js), and the tools that make and change them: select,
// rectangle, oval, polygon and points.
//
// A gesture leaves the document alone while the pointer moves. It keeps the
// values it would set and is drawn from a copy of the shape with those values
// applied; at pointer up the same values go through `session.edit` with
// setPropertyAt, so a drag is one undo step and follows the keyframe rule.
// Values are keyframed values: a drag adds what the pointer moved to the
// keyframed value, so a parameter assigned to the property keeps its share.

import {resolveShapes, shapeOutline, sampleTrack, pointTrack, MIN_POINTS} from './anim-vector.js';
import {addShape, setPropertyAt, addPolygonPoint, removePolygonPoint, edgeById, isVectorDocument, VECTOR} from './anim-model.js';
import {ZOOM_MIN, ZOOM_MAX, ZOOM_STEPS, TOUCH_DRAW_THRESHOLD, PEN_PALM_REJECTION_MS} from './anim-canvas.js';
import {icon} from './icons.js';

// The stage keeps room around the canvas for the handles of shapes at its border.
const FIT_PADDING = 32;
// Used while the stage is hidden or measured without layout (tests).
const FALLBACK_SIZE = {width: 480, height: 360};
const WHEEL_ZOOM_LIMIT = 30;
const DRAW_FALLBACK_MS = 200;
// How close a press has to come to a point, a handle or an outline, in
// screen pixels. A fingertip covers far more than a mouse pointer.
const HIT_RADIUS = {mouse: 6, pen: 10, touch: 22};
// A mouse has to move this far before a press on a shape moves it.
const MOUSE_SLOP = 2;
// The rotation handle stands this far above the selection box, in screen pixels.
const ROTATE_OFFSET = 28;
// Shapes outside the canvas are cut off by the runtime; the editor shows them faintly.
const OUTSIDE_ALPHA = 0.25;
const GHOST_ALPHA = 0.3;
const ROTATE_SNAP = 15;
const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
const shortcut = key => (isMac ? '⌘' : 'Ctrl+') + key;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const TEXT_TARGETS = 'input,textarea,select,[contenteditable],dialog';
// Geometry from the pointer is kept to hundredths of a canvas pixel.
const round = value => Math.round(value * 100) / 100 || 0;
const rgba = ([r, g, b], alpha) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
const radians = degrees => degrees * Math.PI / 180;

export const VECTOR_TOOLS = [
  {id: 'select', group: 'edit', label: 'Select, move, resize and rotate', key: 'V', icon: 'cursor'},
  {id: 'points', group: 'edit', label: 'Points of a polygon', key: 'A', icon: 'points'},
  {id: 'rectangle', group: 'shapes', label: 'Rectangle', key: 'R', icon: 'rectangle'},
  {id: 'oval', group: 'shapes', label: 'Oval', key: 'E', icon: 'oval'},
  {id: 'polygon', group: 'shapes', label: 'Polygon', key: 'P', icon: 'polygon'},
];
const TOOL_GROUPS = [{id: 'edit', label: 'Select and edit'}, {id: 'shapes', label: 'New shapes'}];
const toolById = id => VECTOR_TOOLS.find(tool => tool.id === id) ?? VECTOR_TOOLS[0];

// Geometry ------------------------------------------------------------------------
//
// A resolved shape (resolveShape in anim-vector.js) has its own frame: the
// origin at (x, y), turned by `rotation`. Rectangle and oval extents and
// polygon points are measured in that frame, which the functions below call
// local.

export function toLocal(shape, x, y) {
  const angle = radians(shape.rotation), cos = Math.cos(angle), sin = Math.sin(angle), dx = x - shape.x, dy = y - shape.y;
  return {x: dx * cos + dy * sin, y: -dx * sin + dy * cos};
}

export function toCanvas(shape, x, y) {
  const angle = radians(shape.rotation), cos = Math.cos(angle), sin = Math.sin(angle);
  return {x: shape.x + x * cos - y * sin, y: shape.y + x * sin + y * cos};
}

// The smallest and largest value a cubic Bézier takes along one axis.
function cubicExtent(p0, p1, p2, p3) {
  let low = Math.min(p0, p3), high = Math.max(p0, p3);
  // The derivative over 3 is a s² + b s + c; its roots in 0..1 are the turns.
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  const roots = [];
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) roots.push(-c / b); }
  else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) { const root = Math.sqrt(discriminant);roots.push((-b + root) / (2 * a), (-b - root) / (2 * a)); }
  }
  for (const s of roots) {
    if (!(s > 0 && s < 1)) continue;
    const u = 1 - s, value = u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
    low = Math.min(low, value);high = Math.max(high, value);
  }
  return [low, high];
}

// The box around a shape in its local frame: {x0, y0, x1, y1}. A polygon's
// box follows its curved sides, not only its points.
export function localBounds(shape) {
  if (shape.kind !== 'polygon') return {x0: -shape.width / 2, y0: -shape.height / 2, x1: shape.width / 2, y1: shape.height / 2};
  const points = shape.points;
  if (!points.length) return {x0: 0, y0: 0, x1: 0, y1: 0};
  const box = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity};
  points.forEach((from, index) => {
    const to = points[(index + 1) % points.length];
    const [x0, x1] = cubicExtent(from.x, from.x + from.outX, to.x + to.inX, to.x);
    const [y0, y1] = cubicExtent(from.y, from.y + from.outY, to.y + to.inY, to.y);
    box.x0 = Math.min(box.x0, x0);box.x1 = Math.max(box.x1, x1);box.y0 = Math.min(box.y0, y0);box.y1 = Math.max(box.y1, y1);
  });
  return box;
}

// The outline as a closed line through `steps` samples of every segment,
// close enough to the curve for hit tests at screen resolution.
export function flattenOutline({start, segments}, steps = 16) {
  const points = [start.slice()];
  let [x0, y0] = start;
  for (const [c1x, c1y, c2x, c2y, x, y] of segments) {
    for (let step = 1; step <= steps; step++) {
      const s = step / steps, u = 1 - s;
      points.push([u * u * u * x0 + 3 * u * u * s * c1x + 3 * u * s * s * c2x + s * s * s * x,
        u * u * u * y0 + 3 * u * u * s * c1y + 3 * u * s * s * c2y + s * s * s * y]);
    }
    x0 = x;y0 = y;
  }
  return points;
}

// Whether (x, y) lies inside the closed line, by the nonzero winding rule
// that Canvas 2D fills with.
export function insideOutline(points, x, y) {
  let winding = 0;
  for (let index = 0; index < points.length; index++) {
    const [ax, ay] = points[index], [bx, by] = points[(index + 1) % points.length];
    const side = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
    if (ay <= y) { if (by > y && side > 0) winding++; }
    else if (by <= y && side < 0) winding--;
  }
  return winding !== 0;
}

export function distanceToOutline(points, x, y) {
  let best = Infinity;
  for (let index = 0; index < points.length; index++) {
    const [ax, ay] = points[index], [bx, by] = points[(index + 1) % points.length];
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const s = length ? clamp(((x - ax) * dx + (y - ay) * dy) / length, 0, 1) : 0;
    best = Math.min(best, Math.hypot(x - (ax + s * dx), y - (ay + s * dy)));
  }
  return best;
}

// Whether a press at (x, y) lands on the resolved shape: inside its outline,
// on its line, or within `reach` canvas pixels of it.
export function hitsShape(shape, x, y, reach = 0) {
  const points = flattenOutline(shapeOutline(shape));
  return insideOutline(points, x, y) || distanceToOutline(points, x, y) <= reach + shape.outlineThickness / 2;
}

// The keyframed values of a drag by `delta` per axis, for the axes that
// moved only: an edit at a time without a keyframe adds one, so an axis
// that did not move must not be written.
function movedValues(delta, track, keyed) {
  const values = {};
  for (const axis of ['x', 'y']) {
    if (Math.abs(delta[axis]) > 1e-9) values[track(axis)] = round(keyed(track(axis)) + delta[axis]);
  }
  return values;
}

// The handles of the selection box, by name, as fractions of the box.
const HANDLES = {nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5]};
const LEFT = new Set(['nw', 'w', 'sw']), RIGHT = new Set(['ne', 'e', 'se']), TOP = new Set(['nw', 'n', 'ne']), BOTTOM = new Set(['sw', 's', 'se']);

// The values that turn shape `before` (resolved) into a box `box` in its own
// local frame, as keyframed values: `keyed(name)` gives the keyframed value
// of a track at the playhead. Only the properties that change are listed.
export function resizeValues(before, box, keyed) {
  const from = localBounds(before), values = {};
  if (before.kind !== 'polygon') {
    const centre = toCanvas(before, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
    const width = Math.abs(box.x1 - box.x0), height = Math.abs(box.y1 - box.y0);
    if (Math.abs(centre.x - before.x) > 1e-9) values.x = round(keyed('x') + centre.x - before.x);
    if (Math.abs(centre.y - before.y) > 1e-9) values.y = round(keyed('y') + centre.y - before.y);
    if (Math.abs(width - before.width) > 1e-9) values.width = round(keyed('width') + width - before.width);
    if (Math.abs(height - before.height) > 1e-9) values.height = round(keyed('height') + height - before.height);
    return values;
  }
  // A polygon keeps its origin; its points and handles are scaled about the
  // side or corner that stays where it is. A box that turned over mirrors them.
  const axes = [['x', from.x0, from.x1, box.x0, box.x1], ['y', from.y0, from.y1, box.y0, box.y1]];
  for (const [axis, low, high, nextLow, nextHigh] of axes) {
    const scale = high - low > 1e-9 ? (nextHigh - nextLow) / (high - low) : 1;
    if (Math.abs(scale - 1) < 1e-9 && Math.abs(nextLow - low) < 1e-9) continue;
    before.points.forEach((point, index) => {
      const field = {x: ['x', 'inX', 'outX'], y: ['y', 'inY', 'outY']}[axis];
      const moved = nextLow + (point[field[0]] - low) * scale;
      const set = (part, now, next) => { if (Math.abs(next - now) > 1e-9) values[pointTrack(index, part)] = round(keyed(pointTrack(index, part)) + next - now); };
      set(axis, point[field[0]], moved);
      set('in.' + axis, point[field[1]], point[field[1]] * scale);
      set('out.' + axis, point[field[2]], point[field[2]] * scale);
    });
  }
  return values;
}

// `onInteract()` runs before a gesture or a button may change the document
// (the keyframe timeline stops playing); `onTogglePlay()` when Space is
// tapped without panning. `ghosts()` returns the edges and times whose
// shapes show faintly over the edge's own while editing, [{edge, time,
// alpha}], for keyframe ghosts.
export function createVectorCanvas({parent, session, onInteract = () => {}, onTogglePlay = () => {}, ghosts = () => []}) {
  parent.classList.add('anim-canvas', 'anim-vector-canvas');
  parent.innerHTML = `
    <div class="anim-tools" role="toolbar" aria-label="Shape tools" aria-orientation="horizontal">
      ${TOOL_GROUPS.map(group => `<div class="anim-tool-group" role="group" aria-label="${group.label}">
        ${VECTOR_TOOLS.filter(tool => tool.group === group.id).map(tool => `<button data-v-tool="${tool.id}" aria-pressed="false" aria-label="${tool.label}" title="${tool.label} (${tool.key})">${icon(tool.icon)}</button>`).join('')}
      </div>`).join('')}
    </div>
    <div class="anim-settings"><div class="anim-options" data-v-options></div></div>
    <div class="anim-stage-column">
      <div class="anim-stage" data-v-stage>
        <canvas class="anim-display" tabindex="0" role="application" aria-label="Vector canvas. V select, A points, R rectangle, E oval, P polygon. Hold Space and drag to pan."></canvas>
        <p class="anim-stage-empty" hidden></p>
      </div>
      <div class="anim-stage-footer">
        <span class="anim-history" role="group" aria-label="History">
          <button data-v-undo aria-label="Undo" title="Undo (${shortcut('Z')})">${icon('arrow-u-up-left')}</button>
          <button data-v-redo aria-label="Redo" title="Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z'})">${icon('arrow-u-up-right')}</button>
        </span>
        <span class="anim-position" data-v-position aria-live="off"></span>
        <p class="anim-canvas-status" role="status" aria-live="polite"></p>
        <span class="anim-zoom">
          <button data-v-zoom-out aria-label="Zoom out" title="Zoom out (−)">${icon('minus')}</button>
          <span data-v-zoom-level></span>
          <button data-v-zoom-in aria-label="Zoom in" title="Zoom in (+)">${icon('plus')}</button>
          <button class="anim-icon-button" data-canvas-fit aria-label="Fit canvas" title="Fit the canvas into view">${icon('arrows-out-simple')}</button>
        </span>
      </div>
    </div>
    <div class="anim-vector-panel" data-v-panel></div>`;
  const $ = selector => parent.querySelector(selector);
  const display = $('.anim-display'), stage = $('[data-v-stage]'), emptyLine = $('.anim-stage-empty');
  const statusLine = $('.anim-canvas-status'), positionLine = $('[data-v-position]');

  let toolId = 'select';
  // The canvas transform: canvas point (cx, cy) is drawn at (cx * k + x, cy * k + y) CSS pixels.
  let view = {x: 0, y: 0, k: 1}, autoFit = true;
  let width = FALLBACK_SIZE.width, height = FALLBACK_SIZE.height;
  let gesture = null, hover = null, drawPending = false, drawFallback = null, destroyed = false;
  // A polygon being placed: {edge, points: [{x, y}], next: {x, y} | null},
  // where `next` is where the next point would go.
  let draft = null;
  // The selected point of the selected polygon (points tool), or null.
  let pointIndex = null, pointShape = null;
  // The graph preview: {edge, time, parameters} draws that edge read-only;
  // any other object shows the empty output.
  let preview = null;
  let spaceHeld = false, spaceUsed = false, penUntil = 0;
  const touch = {mode: 'idle', pointers: new Map(), primaryId: null, start: null, centroid: null, spread: null, blockDrawing: false};

  const doc = () => session.doc && isVectorDocument(session.doc) ? session.doc : null;
  // The edge that edits go to: the session's active edge.
  const editEdge = () => doc() && session.edge !== null ? edgeById(doc(), session.edge) : null;
  // The edge on show: the preview's while one runs, else the active edge.
  const activeEdge = () => preview ? (doc() && preview.edge !== null ? edgeById(doc(), preview.edge) : null) : editEdge();
  const time = () => preview ? preview.time ?? 0 : session.time ?? 0;
  const tool = () => toolById(toolId);
  const editable = () => Boolean(doc()) && !session.readOnly && !preview && Boolean(editEdge());
  const coarse = () => Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches);
  const reach = pointerType => (HIT_RADIUS[pointerType] ?? HIT_RADIUS.mouse) / view.k;
  function message(value = '') { statusLine.textContent = value; }

  // The document's shapes and the values a gesture would set ----------------------

  // The keyframed value of a number track at the gesture's time.
  const keyedOf = (shape, t) => name => sampleTrack(shape.tracks[name], t);
  function applyValues(d, edgeId, index, t, values) {
    for (const [property, value] of Object.entries(values)) setPropertyAt(d, edgeId, index, property, t, value);
  }
  // The edge's shapes with `values` applied to shape `index` on a copy, as
  // the edit at the end of the gesture will apply them.
  function withValues(edge, index, t, values) {
    const copy = structuredClone(edge.shapes[index]);
    const scratch = {format: VECTOR, parameters: [], edges: [{id: edge.id, length: edge.length, shapes: edge.shapes.map((shape, at) => at === index ? copy : shape)}]};
    try { applyValues(scratch, edge.id, index, t, values); } catch {}
    return scratch.edges[0].shapes;
  }
  // The shape a rectangle or oval gesture would add.
  function newShape(edge, kind, values) {
    const d = doc(), scratch = {format: VECTOR, width: d.width, height: d.height, parameters: [], edges: [{id: edge.id, length: edge.length, shapes: []}]};
    try { return addShape(scratch, edge.id, kind, {values}).shape; } catch { return null; }
  }
  function createValues(g) {
    if (!g.moved) return {x: round(g.from.x), y: round(g.from.y)};
    return {x: round((g.from.x + g.to.x) / 2), y: round((g.from.y + g.to.y) / 2), width: round(Math.abs(g.to.x - g.from.x)), height: round(Math.abs(g.to.y - g.from.y))};
  }
  // What is drawn: the edge's shapes as the gesture in progress would leave them.
  function shownShapes(edge) {
    const g = gesture;
    if (g?.values && g.moved && g.edge === edge.id && edge.shapes[g.index]) return withValues(edge, g.index, g.time, g.values);
    if (g?.type === 'create' && g.edge === edge.id) {
      const added = newShape(edge, g.kind, createValues(g));
      return added ? [...edge.shapes, added] : edge.shapes;
    }
    return edge.shapes;
  }
  // The parameter sliders' values, also while editing, so a parameter's share
  // shows where the shapes are drawn, hit and handled.
  function resolved(edge, shapes = edge.shapes, t = time()) {
    const d = doc();
    return resolveShapes(shapes, t, d.parameters ?? [], preview?.parameters ?? session.parameterValues ?? {});
  }
  // Indices of the shapes under canvas point p, topmost first.
  function shapesAt(edge, p, pointerType) {
    const list = resolved(edge), hits = [];
    for (let index = list.length - 1; index >= 0; index--) if (hitsShape(list[index], p.x, p.y, reach(pointerType))) hits.push(index);
    return hits;
  }

  function edit(change, options) {
    try {
      const result = session.edit(change, options);
      message('');
      return result;
    } catch (error) {
      message(error.message || String(error));
      return undefined;
    }
  }

  // View ------------------------------------------------------------------------------

  function measure() {
    const rect = display.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) { width = display.clientWidth || rect.width;height = display.clientHeight || rect.height; }
    else { width = FALLBACK_SIZE.width;height = FALLBACK_SIZE.height; }
  }
  function fitView() {
    const d = doc();
    if (!d) return;
    const k = clamp(Math.min((width - 2 * FIT_PADDING) / d.width, (height - 2 * FIT_PADDING) / d.height), ZOOM_MIN, ZOOM_MAX);
    view = {k, x: Math.round((width - d.width * k) / 2), y: Math.round((height - d.height * k) / 2)};
  }
  function keepInView() {
    const d = doc(), margin = 24;
    view.x = clamp(view.x, margin - d.width * view.k, width - margin);
    view.y = clamp(view.y, margin - d.height * view.k, height - margin);
  }
  function syncView() {
    if (!doc() || !autoFit) return;
    measure();
    fitView();
  }
  function zoomAt(sx, sy, k) {
    k = clamp(k, ZOOM_MIN, ZOOM_MAX);
    view = {k, x: sx - (sx - view.x) * k / view.k, y: sy - (sy - view.y) * k / view.k};
    autoFit = false;
    requestDraw();
  }
  function zoomStep(direction) {
    measure();
    const next = direction > 0 ? ZOOM_STEPS.find(step => step > view.k * 1.001) ?? ZOOM_MAX : [...ZOOM_STEPS].reverse().find(step => step < view.k / 1.001) ?? ZOOM_MIN;
    zoomAt(width / 2, height / 2, next);
  }
  function fit() { autoFit = true;requestDraw(); }
  const screen = (x, y) => [view.x + x * view.k, view.y + y * view.k];

  // Rendering -------------------------------------------------------------------------

  function requestDraw() {
    if (drawPending) return;
    drawPending = true;
    (globalThis.requestAnimationFrame ?? (callback => setTimeout(callback, 16)))(() => { if (drawPending) draw(); });
    // A browser can hold animation frames back (a hidden page, a web app
    // resumed from the background); the timer makes sure the canvas follows.
    drawFallback = setTimeout(() => { if (drawPending) draw(); }, DRAW_FALLBACK_MS);
  }
  function token(name, fallback) {
    return getComputedStyle(parent).getPropertyValue(name).trim() || fallback;
  }
  let checker = {key: '', pattern: null};
  function checkerPattern(ctx, light, dark) {
    const key = light + dark;
    if (checker.key === key) return checker.pattern;
    const tile = document.createElement('canvas');
    tile.width = tile.height = 16;
    const tileContext = tile.getContext?.('2d');
    if (!tileContext) return null;
    tileContext.fillStyle = light;tileContext.fillRect(0, 0, 16, 16);
    tileContext.fillStyle = dark;tileContext.fillRect(8, 0, 8, 8);tileContext.fillRect(0, 8, 8, 8);
    checker = {key, pattern: ctx.createPattern?.(tile, 'repeat') ?? null};
    return checker.pattern;
  }
  function trace(ctx, outline) {
    ctx.moveTo(...screen(...outline.start));
    for (const [c1x, c1y, c2x, c2y, x, y] of outline.segments) ctx.bezierCurveTo(...screen(c1x, c1y), ...screen(c2x, c2y), ...screen(x, y));
    ctx.closePath();
  }
  // Fill first, then the outline centred on the path, as the runtime draws.
  // The runtime strokes with Canvas 2D's defaults, mitred joins with a miter
  // limit of 10, so corners are cut off at the same angle here.
  function drawShapes(ctx, list, alpha = 1) {
    ctx.save();
    ctx.lineJoin = 'miter';ctx.miterLimit = 10;
    for (const shape of list) {
      const outline = shapeOutline(shape);
      ctx.beginPath();
      trace(ctx, outline);
      if (shape.fillOpacity > 0) { ctx.fillStyle = rgba(shape.fillColor, shape.fillOpacity * alpha);ctx.fill(); }
      if (shape.outlineThickness > 0 && shape.outlineOpacity > 0) {
        ctx.lineWidth = shape.outlineThickness * view.k;
        ctx.strokeStyle = rgba(shape.outlineColor, shape.outlineOpacity * alpha);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // A dark and a light line, visible on any colour.
  function strokeTwice(ctx, dashed = false) {
    ctx.lineWidth = 3;ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';ctx.setLineDash?.([]);ctx.stroke();
    ctx.lineWidth = 1;ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    if (dashed) ctx.setLineDash?.([4, 3]);
    ctx.stroke();
    ctx.setLineDash?.([]);
  }
  const handleSize = () => coarse() ? 12 : 8;
  function square(ctx, x, y, size, fill, stroke = 'rgba(0, 0, 0, 0.75)') {
    ctx.beginPath();
    ctx.rect(x - size / 2, y - size / 2, size, size);
    ctx.fillStyle = fill;ctx.fill();
    ctx.lineWidth = 1;ctx.strokeStyle = stroke;ctx.stroke();
  }
  function dot(ctx, x, y, radius, fill, stroke = 'rgba(0, 0, 0, 0.75)') {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;ctx.fill();
    ctx.lineWidth = 1;ctx.strokeStyle = stroke;ctx.stroke();
  }

  function draw() {
    drawPending = false;
    clearTimeout(drawFallback);
    if (destroyed) return;
    renderChrome();
    measure();
    const d = doc(), edge = activeEdge();
    if (d && autoFit) fitView();
    else if (d) keepInView();
    $('[data-v-zoom-level]').textContent = Math.round(view.k * 100) + '%';
    const dpr = globalThis.devicePixelRatio || 1;
    const backingWidth = Math.max(1, Math.round(width * dpr)), backingHeight = Math.max(1, Math.round(height * dpr));
    if (display.width !== backingWidth || display.height !== backingHeight) { display.width = backingWidth;display.height = backingHeight; }
    const ctx = display.getContext?.('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!d || (!edge && !preview)) return;
    const {x, y, k} = view, w = d.width * k, h = d.height * k;
    ctx.fillStyle = checkerPattern(ctx, token('--anim-checker-a', '#d7d5cb'), token('--anim-checker-b', '#c8c6bb')) ?? token('--anim-checker-a', '#d7d5cb');
    ctx.save();ctx.translate(x, y);ctx.fillRect(0, 0, w, h);ctx.restore();
    if (edge) {
      const list = resolved(edge, shownShapes(edge));
      // Outside the canvas, faintly: clipped to everything but the canvas.
      ctx.save();
      ctx.beginPath();ctx.rect(0, 0, width, height);ctx.rect(x, y, w, h);
      ctx.clip('evenodd');
      drawShapes(ctx, list, OUTSIDE_ALPHA);
      ctx.restore();
      ctx.save();
      ctx.beginPath();ctx.rect(x, y, w, h);ctx.clip();
      drawShapes(ctx, list);
      if (!preview) drawGhosts(ctx, edge, list);
      ctx.restore();
    }
    ctx.strokeStyle = token('--line', '#343a3b');ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    if (!preview && edge) drawOverlays(ctx, edge);
  }

  // Ghosts go over the shapes on show: under them, an opaque shape such as a
  // background would hide them. A ghost shape that looks the same as the
  // shape on show is left out, so what stands still is not veiled.
  function drawGhosts(ctx, edge, list) {
    const d = doc(), same = (a, b) => Boolean(a && b) && JSON.stringify(a) === JSON.stringify(b);
    for (const ghost of ghosts()) {
      const other = edgeById(d, ghost.edge);
      if (!other) continue;
      const shapes = resolved(other, other.shapes, ghost.time);
      drawShapes(ctx, other === edge ? shapes.filter((shape, index) => !same(shape, list[index])) : shapes, ghost.alpha ?? GHOST_ALPHA);
    }
  }

  // The shape the overlays show, as the gesture would leave it.
  function overlayShape(edge, index) {
    const list = resolved(edge, shownShapes(edge));
    return list[index] ?? null;
  }
  function boxCorners(shape) {
    const box = localBounds(shape);
    return [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map(([lx, ly]) => {
      const p = toCanvas(shape, lx, ly);
      return screen(p.x, p.y);
    });
  }
  // Screen positions of the selection box's handles and of the rotation handle.
  function handlePositions(shape) {
    const box = localBounds(shape), list = {};
    for (const [name, [fx, fy]] of Object.entries(HANDLES)) {
      const p = toCanvas(shape, box.x0 + fx * (box.x1 - box.x0), box.y0 + fy * (box.y1 - box.y0));
      list[name] = screen(p.x, p.y);
    }
    const middle = (box.x0 + box.x1) / 2, top = toCanvas(shape, middle, box.y0), end = toCanvas(shape, middle, box.y0 - ROTATE_OFFSET / view.k);
    list.rotateFrom = screen(top.x, top.y);
    list.rotate = screen(end.x, end.y);
    return list;
  }
  // The handles of a polygon on show in the points tool: those of the
  // selected point, and the ones of its neighbours that shape its two sides.
  // Handles of zero length lie on their point and are left out.
  function visibleHandles(shape) {
    if (shape.kind !== 'polygon' || pointIndex === null || pointIndex >= shape.points.length) return [];
    const count = shape.points.length, list = [];
    const add = (index, side) => {
      const point = shape.points[index], hx = side === 'in' ? point.inX : point.outX, hy = side === 'in' ? point.inY : point.outY;
      if (Math.hypot(hx, hy) * view.k < 0.5) return;
      const from = toCanvas(shape, point.x, point.y), to = toCanvas(shape, point.x + hx, point.y + hy);
      list.push({index, side, from: screen(from.x, from.y), at: screen(to.x, to.y)});
    };
    add(pointIndex, 'in');add(pointIndex, 'out');
    if (count > 1) { add((pointIndex - 1 + count) % count, 'out');add((pointIndex + 1) % count, 'in'); }
    return list;
  }
  function pointPositions(shape) {
    return shape.points.map(point => { const p = toCanvas(shape, point.x, point.y);return screen(p.x, p.y); });
  }
  function drawOverlays(ctx, edge) {
    const accent = token('--accent', '#d63384'), index = session.shape, size = handleSize();
    // Points and handles are hollow, and the selected point filled, which
    // tells them apart in any theme, also where the accent is near white.
    const hollow = token('--bg', '#000000'), ink = token('--text', '#ffffff');
    ctx.save();
    // Hovering a shape with the select tool outlines it.
    if (toolId === 'select' && hover?.shape !== undefined && hover.shape !== null && hover.shape !== index && !gesture) {
      const shape = resolved(edge)[hover.shape];
      if (shape) { ctx.beginPath();trace(ctx, shapeOutline(shape));ctx.lineWidth = 1;ctx.strokeStyle = accent;ctx.stroke(); }
    }
    if (gesture?.type === 'create') {
      const shape = overlayShape(edge, edge.shapes.length);
      if (shape) { ctx.beginPath();boxCorners(shape).forEach(([px, py], at) => at ? ctx.lineTo(px, py) : ctx.moveTo(px, py));ctx.closePath();strokeTwice(ctx, true); }
    }
    const shape = index === null ? null : overlayShape(edge, index);
    if (shape && toolId !== 'points') {
      ctx.beginPath();
      boxCorners(shape).forEach(([px, py], at) => at ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
      ctx.closePath();
      strokeTwice(ctx, true);
      if (toolId === 'select') {
        const handles = handlePositions(shape);
        ctx.beginPath();ctx.moveTo(...handles.rotateFrom);ctx.lineTo(...handles.rotate);strokeTwice(ctx);
        dot(ctx, ...handles.rotate, size / 2 + 1, '#ffffff');
        for (const name of Object.keys(HANDLES)) square(ctx, ...handles[name], size, '#ffffff');
      }
    }
    if (shape && toolId === 'points' && shape.kind === 'polygon') {
      ctx.beginPath();trace(ctx, shapeOutline(shape));ctx.lineWidth = 1;ctx.strokeStyle = accent;ctx.stroke();
      for (const handle of visibleHandles(shape)) {
        ctx.beginPath();ctx.moveTo(...handle.from);ctx.lineTo(...handle.at);ctx.lineWidth = 1;ctx.strokeStyle = accent;ctx.stroke();
        dot(ctx, ...handle.at, size / 2, hollow, ink);
      }
      pointPositions(shape).forEach(([px, py], at) => at === pointIndex ? square(ctx, px, py, size + 2, accent, hollow) : square(ctx, px, py, size, hollow, ink));
    }
    if (draft && draft.edge === edge.id) {
      const points = [...draft.points, ...(draft.next ? [draft.next] : [])].map(p => screen(p.x, p.y));
      if (points.length > 1) { ctx.beginPath();points.forEach(([px, py], at) => at ? ctx.lineTo(px, py) : ctx.moveTo(px, py));strokeTwice(ctx); }
      draft.points.forEach((p, at) => {
        const [px, py] = screen(p.x, p.y);
        // The first point closes the polygon once there are enough points.
        if (at === 0 && draft.points.length >= MIN_POINTS) dot(ctx, px, py, size, accent, hollow);
        else square(ctx, px, py, size, hollow, ink);
      });
    }
    ctx.restore();
  }

  // Toolbar, options and the empty state --------------------------------------------------

  let renderedOptions = '';
  function renderChrome() {
    const d = doc(), canEdit = editable();
    parent.classList.toggle('previewing', Boolean(preview));
    for (const button of parent.querySelectorAll('[data-v-tool]')) {
      button.setAttribute('aria-pressed', String(button.dataset.vTool === toolId));
      button.disabled = !canEdit;
    }
    for (const button of parent.querySelectorAll('.anim-zoom button')) button.disabled = !d;
    $('[data-v-undo]').disabled = !session.canUndo;
    $('[data-v-redo]').disabled = !session.canRedo;
    let empty = '';
    if (!d || preview) empty = '';
    else if (!d.edges.length) empty = 'Add states and an edge in the graph, then draw its shapes here.';
    else if (!editEdge()) empty = 'Select an edge in the graph to draw its shapes.';
    emptyLine.textContent = empty;emptyLine.hidden = !empty;
    display.hidden = !d || (!editEdge() && !preview);
    display.style.cursor = !canEdit ? 'default' : toolId === 'select' || toolId === 'points' ? (hover?.cursor ?? 'default') : 'crosshair';
    renderOptions();
  }
  function selectedShape() {
    const edge = editEdge(), index = session.shape;
    return edge && index !== null ? edge.shapes[index] ?? null : null;
  }
  function renderOptions() {
    const shape = selectedShape(), polygon = shape?.kind === 'polygon' ? shape : null;
    const point = polygon && pointIndex !== null && pointIndex < polygon.points ? pointIndex : null;
    const key = [toolId, editable(), Boolean(preview), Boolean(doc()), draft?.points.length ?? -1, polygon ? polygon.points : -1, point].join(':');
    if (key === renderedOptions) return;
    renderedOptions = key;
    const host = $('[data-v-options]'), parts = [], disabled = editable() ? '' : 'disabled';
    if (!doc() || preview) { host.innerHTML = '';return; }
    if (toolId === 'select') parts.push('<span class="anim-option-hint">Tap a shape to select it, drag it to move it. The square handles resize it, the round one turns it.</span>');
    else if (toolId === 'rectangle' || toolId === 'oval') parts.push(`<span class="anim-option-hint">Drag to draw ${toolId === 'oval' ? 'an oval' : 'a rectangle'}; a tap places one of the default size.</span>`);
    else if (toolId === 'polygon') {
      const count = draft?.points.length ?? 0;
      parts.push(`<span class="anim-option anim-actions">
        <button data-v-finish title="Close the polygon (Enter)" ${count >= MIN_POINTS && editable() ? '' : 'disabled'}>Done</button>
        <button data-v-cancel title="Drop the points placed so far (Escape)" ${count ? '' : 'disabled'}>Cancel</button>
      </span>`);
      parts.push(`<span class="anim-option-hint">${count ? `${count} ${count === 1 ? 'point' : 'points'}. Tap the first point or Done to close the polygon.` : 'Tap to place the points of a polygon.'}</span>`);
    } else if (toolId === 'points') {
      if (!polygon) parts.push('<span class="anim-option-hint">Select a polygon to change its points.</span>');
      else {
        const none = point === null ? 'disabled' : '';
        parts.push(`<span class="anim-option anim-actions">
          <button data-v-add-point title="Add a point in the middle of the side after the selected point" ${none} ${disabled}>Add point</button>
          <button data-v-remove-point title="${polygon.points > MIN_POINTS ? 'Remove the selected point' : `A polygon keeps at least ${MIN_POINTS} points`}" ${none} ${polygon.points > MIN_POINTS ? '' : 'disabled'} ${disabled}>Remove point</button>
          <button data-v-smooth title="Pull curve handles out of the selected point, so its sides curve through it" ${none} ${disabled}>Smooth</button>
          <button data-v-corner title="Take the curve handles of the selected point back into it" ${none} ${disabled}>Corner</button>
          <button data-v-straight title="Make the side after the selected point straight" ${none} ${disabled}>Straight side</button>
        </span>`);
        if (point === null) parts.push('<span class="anim-option-hint">Tap a point to select it; drag points and their handles.</span>');
      }
    }
    host.innerHTML = parts.join('');
  }
  function setTool(id) {
    const next = toolById(id);
    if (next.id === toolId) return;
    cancelGesture();
    if (next.id !== 'polygon') draft = null;
    toolId = next.id;
    hover = null;
    renderChrome();requestDraw();
  }

  // Pointer input --------------------------------------------------------------------------

  function locate(event) {
    const rect = display.getBoundingClientRect();
    // Studio's View zoom scales the page, so client pixels are converted back to canvas pixels.
    const scale = rect.width > 0 && display.clientWidth > 0 ? display.clientWidth / rect.width : 1;
    const sx = (event.clientX - rect.left) * scale, sy = (event.clientY - rect.top) * scale;
    return {sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k};
  }
  function snapshot(event) {
    return {clientX: event.clientX, clientY: event.clientY, button: event.button === 2 ? 2 : event.button === 1 ? 1 : 0, pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse', shiftKey: event.shiftKey, altKey: event.altKey};
  }
  // The handle of the selection box under a screen point: a name of HANDLES,
  // 'rotate', or null.
  function handleAt(shape, p, pointerType) {
    const handles = handlePositions(shape), radius = Math.max(HIT_RADIUS[pointerType] ?? HIT_RADIUS.mouse, handleSize());
    const near = name => Math.hypot(handles[name][0] - p.sx, handles[name][1] - p.sy) <= radius;
    if (near('rotate')) return 'rotate';
    let best = null, distance = Infinity;
    for (const name of Object.keys(HANDLES)) {
      const gap = Math.hypot(handles[name][0] - p.sx, handles[name][1] - p.sy);
      if (gap <= radius && gap < distance) { best = name;distance = gap; }
    }
    return best;
  }
  function insideBox(shape, p) {
    const local = toLocal(shape, p.x, p.y), box = localBounds(shape);
    return local.x >= box.x0 && local.x <= box.x1 && local.y >= box.y0 && local.y <= box.y1;
  }

  // Starts a gesture. Returns true when the pointer should be captured.
  function begin(event) {
    if (gesture) return false;
    const p = locate(event);
    if (spaceHeld || event.button === 1) {
      if (spaceHeld) spaceUsed = true;
      gesture = {type: 'pan', pointerId: event.pointerId, pointerType: event.pointerType, origin: p, view: {...view}};
      return true;
    }
    if (!editable() || event.button !== 0) return false;
    const edge = editEdge(), t = session.time ?? 0, index = session.shape;
    const base = {pointerId: event.pointerId, pointerType: event.pointerType, edge: edge.id, time: t, from: p, to: p, moved: false};
    onInteract();
    if (toolId === 'select') {
      const shape = index !== null ? resolved(edge)[index] : null;
      const handle = shape ? handleAt(shape, p, event.pointerType) : null;
      if (handle === 'rotate') {
        const angle = Math.atan2(p.y - shape.y, p.x - shape.x);
        gesture = {...base, type: 'rotate', index, shape, keyed: keyedOf(edge.shapes[index], t), angle, turned: 0};
      } else if (handle) {
        gesture = {...base, type: 'resize', index, shape, keyed: keyedOf(edge.shapes[index], t), handle};
      } else {
        const hits = shapesAt(edge, p, event.pointerType);
        const target = index !== null && (hits.includes(index) || insideBox(shape, p)) ? index : hits[0] ?? null;
        if (target === null) { session.selectShape(null);requestDraw();return false; }
        if (target !== index) session.selectShape(target);
        // A tap on the selected shape where others lie under it selects the next one down.
        gesture = {...base, type: 'move', index: target, keyed: keyedOf(edge.shapes[target], t), cycle: target === index ? hits : null};
      }
    } else if (toolId === 'rectangle' || toolId === 'oval') {
      gesture = {...base, type: 'create', kind: toolId};
    } else if (toolId === 'polygon') {
      if (!draft || draft.edge !== edge.id) draft = {edge: edge.id, points: [], next: null};
      draft.next = {x: p.x, y: p.y};
      gesture = {...base, type: 'place'};
    } else if (toolId === 'points') {
      const shape = index !== null ? resolved(edge)[index] : null;
      if (shape?.kind === 'polygon') {
        const radius = Math.max(HIT_RADIUS[event.pointerType] ?? HIT_RADIUS.mouse, handleSize());
        const nearest = list => list.reduce((best, item) => {
          const gap = Math.hypot(item.at[0] - p.sx, item.at[1] - p.sy);
          return gap <= radius && (!best || gap < best.gap) ? {...item, gap} : best;
        }, null);
        const point = nearest(pointPositions(shape).map((at, number) => ({index: number, at})));
        const handle = point ? null : nearest(visibleHandles(shape));
        if (point || handle) {
          if (point) setPoint(point.index);
          gesture = {...base, type: point ? 'point' : 'handle', index, shape, keyed: keyedOf(edge.shapes[index], t), point: point?.index ?? handle.index, side: handle?.side ?? null};
          requestDraw();
          return true;
        }
      }
      const hits = shapesAt(edge, p, event.pointerType);
      if (hits.length && hits[0] !== index) session.selectShape(hits[0]);
      else if (!hits.length) setPoint(null);
      requestDraw();
      return false;
    }
    requestDraw();
    return Boolean(gesture);
  }
  function setPoint(index) {
    pointIndex = index;
    pointShape = session.shape;
    renderOptions();
  }
  function move(event) {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const p = locate(event);
    if (g.type === 'pan') {
      view = {...g.view, x: g.view.x + p.sx - g.origin.sx, y: g.view.y + p.sy - g.origin.sy};
      autoFit = false;
      requestDraw();
      return;
    }
    g.to = p;
    g.moved ||= Math.hypot(p.sx - g.from.sx, p.sy - g.from.sy) > (g.pointerType === 'mouse' ? MOUSE_SLOP : 0);
    if (g.moved) g.values = valuesOf(g, p, event);
    if (g.type === 'place' && draft) draft.next = {x: p.x, y: p.y};
    showPosition(p);
    requestDraw();
  }
  // The values a gesture sets for the pointer at `p`.
  function valuesOf(g, p, event) {
    const keyed = g.keyed;
    if (g.type === 'move') return movedValues({x: p.x - g.from.x, y: p.y - g.from.y}, name => name, keyed);
    if (g.type === 'rotate') {
      const angle = Math.atan2(p.y - g.shape.y, p.x - g.shape.x);
      // Unwrapped, so turning past half a turn keeps counting.
      let step = angle - g.angle;
      step -= Math.round(step / (2 * Math.PI)) * 2 * Math.PI;
      g.turned += step;g.angle = angle;
      let turned = g.turned * 180 / Math.PI;
      if (event.shiftKey) turned = Math.round((g.shape.rotation + turned) / ROTATE_SNAP) * ROTATE_SNAP - g.shape.rotation;
      return {rotation: Math.round((keyed('rotation') + turned) * 10) / 10};
    }
    if (g.type === 'resize') {
      const box = localBounds(g.shape), local = toLocal(g.shape, p.x, p.y);
      if (LEFT.has(g.handle)) box.x0 = local.x;
      if (RIGHT.has(g.handle)) box.x1 = local.x;
      if (TOP.has(g.handle)) box.y0 = local.y;
      if (BOTTOM.has(g.handle)) box.y1 = local.y;
      return resizeValues(g.shape, box, keyed);
    }
    if (g.type === 'point' || g.type === 'handle') {
      const local = toLocal(g.shape, p.x, p.y), start = toLocal(g.shape, g.from.x, g.from.y), point = g.shape.points[g.point];
      const dx = local.x - start.x, dy = local.y - start.y;
      if (g.type === 'point') return movedValues({x: dx, y: dy}, axis => pointTrack(g.point, axis), keyed);
      const side = g.side, other = side === 'in' ? 'out' : 'in';
      const [hx, hy] = side === 'in' ? [point.inX, point.inY] : [point.outX, point.outY];
      const [ox, oy] = other === 'in' ? [point.inX, point.inY] : [point.outX, point.outY];
      const nx = hx + dx, ny = hy + dy;
      const values = {[pointTrack(g.point, side + '.x')]: round(keyed(pointTrack(g.point, side + '.x')) + nx - hx),
        [pointTrack(g.point, side + '.y')]: round(keyed(pointTrack(g.point, side + '.y')) + ny - hy)};
      // A smooth point keeps its two handles in line: the other one turns
      // with the dragged one and keeps its length. Alt moves one alone.
      const length = Math.hypot(ox, oy), dragged = Math.hypot(hx, hy), next = Math.hypot(nx, ny);
      const inLine = length > 1e-9 && dragged > 1e-9 && (hx * ox + hy * oy) / (length * dragged) < -0.999;
      if (inLine && next > 1e-9 && !event.altKey) {
        const tx = -nx / next * length, ty = -ny / next * length;
        values[pointTrack(g.point, other + '.x')] = round(keyed(pointTrack(g.point, other + '.x')) + tx - ox);
        values[pointTrack(g.point, other + '.y')] = round(keyed(pointTrack(g.point, other + '.y')) + ty - oy);
      }
      return values;
    }
    return undefined;
  }
  function finish(event) {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    move(event);
    gesture = null;
    release(g.pointerId);
    if (g.type === 'create') {
      const values = createValues(g);
      if (edit(d => addShape(d, g.edge, g.kind, {values, t: time()}), {shape: result => result.index}) !== undefined) setTool('select');
    } else if (g.type === 'place') {
      placePoint(g);
    } else if (g.type === 'move' && !g.moved && g.cycle?.length > 1) {
      session.selectShape(g.cycle[(g.cycle.indexOf(g.index) + 1) % g.cycle.length]);
    } else if (g.values && g.moved && Object.keys(g.values).length) {
      edit(d => applyValues(d, g.edge, g.index, g.time, g.values));
    }
    requestDraw();renderOptions();
  }
  // Ends a gesture early and records it, for example when undo is pressed
  // while dragging, so the drag becomes its own undo step first.
  function commitGesture() {
    const g = gesture;
    if (!g || g.type === 'pan' || g.type === 'place' || g.type === 'create') return cancelGesture();
    gesture = null;release(g.pointerId);
    if (g.values && g.moved && Object.keys(g.values).length) edit(d => applyValues(d, g.edge, g.index, g.time, g.values));
    requestDraw();
    return true;
  }
  function cancelGesture() {
    const g = gesture;
    if (!g) return false;
    gesture = null;
    release(g.pointerId);
    if (g.type === 'pan') view = g.view;
    if (g.type === 'place' && draft) draft.next = null;
    requestDraw();
    return true;
  }
  const capture = id => { try { display.setPointerCapture?.(id); } catch {} };
  const release = id => { try { if (display.hasPointerCapture?.(id)) display.releasePointerCapture(id); } catch {} };

  // Polygons ------------------------------------------------------------------------------

  // Adds the point of a finished press to the polygon being placed, or closes
  // it when the press ended on its first point.
  function placePoint(g) {
    if (!draft || draft.edge !== g.edge) return;
    const p = g.to, first = draft.points[0];
    draft.next = null;
    if (first && draft.points.length >= MIN_POINTS) {
      const [fx, fy] = screen(first.x, first.y);
      if (Math.hypot(fx - p.sx, fy - p.sy) <= Math.max(HIT_RADIUS[g.pointerType] ?? HIT_RADIUS.mouse, handleSize())) { finishPolygon();return; }
    }
    draft.points.push({x: p.x, y: p.y});
    renderOptions();
  }
  // Adds the polygon placed so far as a shape with straight sides. Its origin
  // is the middle of its points' box.
  function finishPolygon() {
    const placed = draft;
    if (!placed || placed.points.length < MIN_POINTS || !editable()) return false;
    const xs = placed.points.map(p => p.x), ys = placed.points.map(p => p.y);
    const cx = round((Math.min(...xs) + Math.max(...xs)) / 2), cy = round((Math.min(...ys) + Math.max(...ys)) / 2);
    const values = {x: cx, y: cy};
    placed.points.forEach((p, index) => { values[pointTrack(index, 'x')] = round(p.x - cx);values[pointTrack(index, 'y')] = round(p.y - cy); });
    onInteract();
    const result = edit(d => addShape(d, placed.edge, 'polygon', {points: placed.points.length, values, t: time()}), {shape: added => added.index});
    if (result === undefined) return false;
    draft = null;
    setTool('select');
    return true;
  }
  function dropDraft() {
    if (!draft) return false;
    draft = null;
    renderOptions();requestDraw();
    return true;
  }

  // Point buttons ---------------------------------------------------------------------------

  function pointAction(kind) {
    const edge = editEdge(), index = session.shape, shape = selectedShape();
    if (!editable() || shape?.kind !== 'polygon' || pointIndex === null || pointIndex >= shape.points) return false;
    onInteract();
    const t = session.time ?? 0, at = pointIndex, count = shape.points;
    if (kind === 'add') {
      const added = edit(d => addPolygonPoint(d, edge.id, index, at));
      if (added !== undefined) setPoint(added);
      return added !== undefined;
    }
    if (kind === 'remove') {
      const removed = edit(d => removePolygonPoint(d, edge.id, index, at));
      if (removed !== undefined) setPoint(Math.min(at, count - 2));
      return removed !== undefined;
    }
    const resolvedShape = resolved(edge)[index], keyed = keyedOf(shape, t), values = {};
    // Handle values are keyframed: what a parameter adds stays on top.
    const setHandle = (point, side, x, y) => {
      const now = resolvedShape.points[point], [hx, hy] = side === 'in' ? [now.inX, now.inY] : [now.outX, now.outY];
      values[pointTrack(point, side + '.x')] = round(keyed(pointTrack(point, side + '.x')) + x - hx);
      values[pointTrack(point, side + '.y')] = round(keyed(pointTrack(point, side + '.y')) + y - hy);
    };
    if (kind === 'smooth') {
      // The handles run parallel to the line from the previous to the next
      // point, a sixth of its length each way, as a Catmull-Rom curve does.
      const previous = resolvedShape.points[(at - 1 + count) % count], next = resolvedShape.points[(at + 1) % count];
      const dx = (next.x - previous.x) / 6, dy = (next.y - previous.y) / 6;
      setHandle(at, 'in', -dx, -dy);setHandle(at, 'out', dx, dy);
    } else if (kind === 'corner') {
      setHandle(at, 'in', 0, 0);setHandle(at, 'out', 0, 0);
    } else if (kind === 'straight') {
      setHandle(at, 'out', 0, 0);setHandle((at + 1) % count, 'in', 0, 0);
    }
    return edit(d => applyValues(d, edge.id, index, t, values)) !== undefined;
  }

  // Touch: one finger edits once it has moved a few pixels, a second finger
  // cancels the gesture and pans (and pinches to zoom), and touches shortly
  // after pen input are a resting palm and do nothing, as on the pixel canvas.
  function resetTouch() {
    Object.assign(touch, {mode: 'idle', primaryId: null, start: null, centroid: null, spread: null, blockDrawing: false});
    touch.pointers.clear();
  }
  function touchShape() {
    const points = [...touch.pointers.values()];
    if (!points.length) return {centroid: null, spread: null};
    const centroid = {x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length};
    const spread = points.length >= 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : null;
    return {centroid, spread};
  }
  function touchDown(event) {
    event.preventDefault();
    capture(event.pointerId);
    touch.pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (touch.mode === 'panning') { Object.assign(touch, touchShape());return; }
    if (touch.mode === 'idle') {
      Object.assign(touch, {mode: 'pending', primaryId: event.pointerId, start: snapshot(event), blockDrawing: Date.now() < penUntil});
      return;
    }
    if (touch.pointers.size >= 2) {
      if (touch.mode === 'drawing') cancelGesture();
      touch.mode = 'panning';
      Object.assign(touch, touchShape());
    }
  }
  function touchMove(event) {
    const point = touch.pointers.get(event.pointerId);
    if (!point) return;
    event.preventDefault();
    point.x = event.clientX;point.y = event.clientY;
    if (touch.mode === 'panning') {
      const {centroid, spread} = touchShape();
      if (centroid && touch.centroid) {
        const rect = display.getBoundingClientRect();
        const scale = rect.width > 0 && display.clientWidth > 0 ? display.clientWidth / rect.width : 1;
        view = {...view, x: view.x + (centroid.x - touch.centroid.x) * scale, y: view.y + (centroid.y - touch.centroid.y) * scale};
        if (spread && touch.spread) {
          const p = locate({clientX: centroid.x, clientY: centroid.y});
          zoomAt(p.sx, p.sy, view.k * spread / touch.spread);
        }
        autoFit = false;
      }
      Object.assign(touch, {centroid, spread});
      requestDraw();
      return;
    }
    if (event.pointerId !== touch.primaryId) return;
    if (touch.mode === 'pending') {
      const distance = Math.hypot(event.clientX - touch.start.clientX, event.clientY - touch.start.clientY);
      if (touch.blockDrawing || distance < TOUCH_DRAW_THRESHOLD) return;
      touch.mode = 'drawing';
      if (begin(touch.start)) move(event);
      else touch.mode = 'done';
      return;
    }
    if (touch.mode === 'drawing') move(event);
  }
  function touchUp(event) {
    event.preventDefault();
    if (touch.mode === 'panning') {
      touch.pointers.delete(event.pointerId);
      if (!touch.pointers.size) resetTouch();else Object.assign(touch, touchShape());
      return;
    }
    if (event.pointerId !== touch.primaryId) { touch.pointers.delete(event.pointerId);return; }
    if (touch.mode === 'pending') {
      const start = touch.start, blocked = touch.blockDrawing;
      resetTouch();
      if (blocked) return;
      if (begin(start)) finish(event);
      return;
    }
    if (touch.mode === 'drawing') finish(event);
    resetTouch();
  }
  function touchCancel(event) {
    event.preventDefault();
    if (touch.mode === 'drawing') cancelGesture();
    touch.pointers.delete(event.pointerId);
    if (!touch.pointers.size || (touch.mode !== 'panning' && event.pointerId === touch.primaryId)) resetTouch();
    else {
      if (event.pointerId === touch.primaryId) touch.primaryId = touch.pointers.keys().next().value;
      Object.assign(touch, touchShape());
    }
  }

  display.addEventListener('pointerdown', event => {
    if (event.pointerType === 'pen') {
      penUntil = Date.now() + PEN_PALM_REJECTION_MS;
      if (touch.mode === 'drawing' || gesture?.pointerType === 'touch') cancelGesture();
      resetTouch();
    }
    if (event.pointerType === 'touch' && gesture && gesture.pointerType !== 'touch') { event.preventDefault();return; }
    if (event.pointerType !== 'touch' && touch.mode !== 'idle') { event.preventDefault();return; }
    if (document.activeElement !== display) display.focus({preventScroll: true});
    if (event.pointerType === 'touch') { touchDown(event);return; }
    if (begin(snapshot(event))) { event.preventDefault();capture(event.pointerId); }
  });
  display.addEventListener('pointermove', event => {
    if (event.pointerType === 'pen' && (event.pointerId === gesture?.pointerId || event.buttons > 0 || event.pressure > 0)) penUntil = Date.now() + PEN_PALM_REJECTION_MS;
    if (event.pointerType === 'touch' && touch.mode !== 'idle') { touchMove(event);return; }
    if (gesture) { move(event);return; }
    const p = locate(event);
    showPosition(p);
    hover = hoverAt(p, event.pointerType || 'mouse');
    if (draft && toolId === 'polygon') draft.next = {x: p.x, y: p.y};
    renderChrome();requestDraw();
  });
  // What the pointer is over, for the hover outline and the cursor.
  function hoverAt(p, pointerType) {
    const edge = editEdge();
    if (!edge || !editable() || (toolId !== 'select' && toolId !== 'points')) return null;
    const index = session.shape, shape = index !== null ? resolved(edge)[index] : null;
    if (toolId === 'select' && shape) {
      const handle = handleAt(shape, p, pointerType);
      if (handle) return {shape: index, cursor: handle === 'rotate' ? 'grab' : 'move'};
    }
    const hits = shapesAt(edge, p, pointerType);
    return {shape: hits[0] ?? null, cursor: hits.length ? (toolId === 'select' ? 'move' : 'pointer') : 'default'};
  }
  display.addEventListener('pointerup', event => {
    if (event.pointerType === 'pen') penUntil = Date.now() + PEN_PALM_REJECTION_MS;
    if (event.pointerType === 'touch' && touch.mode !== 'idle') { touchUp(event);return; }
    finish(event);
  });
  display.addEventListener('pointercancel', event => {
    if (event.pointerType === 'pen') penUntil = Date.now() + PEN_PALM_REJECTION_MS;
    if (event.pointerType === 'touch' && touch.mode !== 'idle') { touchCancel(event);return; }
    if (gesture?.pointerId === event.pointerId) cancelGesture();
  });
  display.addEventListener('lostpointercapture', event => {
    if (gesture?.pointerId === event.pointerId && gesture.pointerType !== 'touch') finish(event);
  });
  display.addEventListener('pointerleave', () => {
    if (gesture) return;
    hover = null;positionLine.textContent = '';
    if (draft) draft.next = null;
    requestDraw();
  });
  display.addEventListener('contextmenu', event => event.preventDefault());
  // Ctrl or Cmd with the wheel (and a trackpad pinch, which arrives as a
  // Ctrl-wheel) zooms at the pointer; plain scrolling pans.
  display.addEventListener('wheel', event => {
    if (!doc()) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    const p = locate(event);
    if (event.ctrlKey || event.metaKey) zoomAt(p.sx, p.sy, view.k * Math.exp(-clamp(event.deltaY * unit, -WHEEL_ZOOM_LIMIT, WHEEL_ZOOM_LIMIT) * 0.01));
    else {
      let dx = event.deltaX * unit, dy = event.deltaY * unit;
      if (event.shiftKey && !dx) { dx = dy;dy = 0; }
      view = {...view, x: view.x - dx, y: view.y - dy};
      autoFit = false;
      requestDraw();
    }
  }, {passive: false});
  // Safari and the desktop app report a trackpad pinch as gesture events. A
  // touch screen sends them for two fingers too, which the pointer events
  // above already handle.
  let pinchFrom = null;
  const trackpadPinch = () => Boolean(doc()) && !(globalThis.navigator?.maxTouchPoints > 0);
  display.addEventListener('gesturestart', event => { event.preventDefault();pinchFrom = trackpadPinch() ? view.k : null; }, {passive: false});
  display.addEventListener('gesturechange', event => {
    event.preventDefault();
    if (pinchFrom === null || !(event.scale > 0)) return;
    const p = locate(event);
    zoomAt(p.sx, p.sy, pinchFrom * event.scale);
  }, {passive: false});
  display.addEventListener('gestureend', event => { event.preventDefault();pinchFrom = null; }, {passive: false});
  function showPosition(p) {
    const d = doc();
    positionLine.textContent = d ? `${Math.round(p.x * 10) / 10}, ${Math.round(p.y * 10) / 10}` : '';
  }

  // Buttons ---------------------------------------------------------------------------------

  parent.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled || !parent.contains(button) || button.closest('[data-v-panel]')) return;
    if (button.dataset.vTool) setTool(button.dataset.vTool);
    else if (button.matches('[data-v-finish]')) finishPolygon();
    else if (button.matches('[data-v-cancel]')) dropDraft();
    else if (button.matches('[data-v-add-point]')) pointAction('add');
    else if (button.matches('[data-v-remove-point]')) pointAction('remove');
    else if (button.matches('[data-v-smooth]')) pointAction('smooth');
    else if (button.matches('[data-v-corner]')) pointAction('corner');
    else if (button.matches('[data-v-straight]')) pointAction('straight');
    // A drag in progress is recorded first, so undo takes it back as a whole.
    else if (button.matches('[data-v-undo]')) { commitGesture();session.undo(); }
    else if (button.matches('[data-v-redo]')) { commitGesture();session.redo(); }
    else if (button.matches('[data-v-zoom-in]')) zoomStep(1);
    else if (button.matches('[data-v-zoom-out]')) zoomStep(-1);
    else if (button.matches('[data-canvas-fit]')) fit();
  });

  // Keys. Space pans while held and plays or pauses when tapped. The arrow
  // keys nudge the selected shape, one canvas pixel or ten with Shift.
  const keyTools = Object.fromEntries(VECTOR_TOOLS.map(t => [t.key.toLowerCase(), t.id]));
  function handleKey(event) {
    if (!doc() || event.defaultPrevented) return false;
    const target = event.target;
    if (target?.closest?.(TEXT_TARGETS)) return false;
    const key = event.key, lower = key.length === 1 ? key.toLowerCase() : key, command = event.metaKey || event.ctrlKey;
    if (command) {
      if (lower === 'z' || lower === 'y') commitGesture();
      return false;
    }
    if (event.altKey) return false;
    if (key === ' ') {
      if (target?.closest?.('button,a,summary,[role="separator"]')) return false;
      event.preventDefault();
      if (!event.repeat && !spaceHeld) { spaceHeld = true;spaceUsed = false;stage.classList.add('panning'); }
      return true;
    }
    if (key === 'Escape') {
      if (gesture) { event.preventDefault();cancelGesture();return true; }
      if (draft) { event.preventDefault();return dropDraft(); }
      if (pointIndex !== null && toolId === 'points') { event.preventDefault();setPoint(null);requestDraw();return true; }
      if (session.shape !== null) { event.preventDefault();session.selectShape(null);return true; }
      return false;
    }
    if (key === 'Enter' && draft) { event.preventDefault();finishPolygon();return true; }
    if ((key === 'Delete' || key === 'Backspace') && toolId === 'points' && pointIndex !== null && editable()) {
      event.preventDefault();
      pointAction('remove');
      return true;
    }
    if (key === '+' || key === '=') { event.preventDefault();zoomStep(1);return true; }
    if (key === '-' || key === '_' || key === '−') { event.preventDefault();zoomStep(-1);return true; }
    const nudge = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[key];
    if (nudge && session.shape !== null && editable() && !gesture) {
      const edge = editEdge(), index = session.shape, t = session.time ?? 0, keyed = keyedOf(edge.shapes[index], t), step = event.shiftKey ? 10 : 1;
      event.preventDefault();
      onInteract();
      edit(d => applyValues(d, edge.id, index, t, {x: round(keyed('x') + nudge[0] * step), y: round(keyed('y') + nudge[1] * step)}));
      return true;
    }
    if (event.shiftKey) return false;
    if (keyTools[lower] && editable()) { event.preventDefault();setTool(keyTools[lower]);return true; }
    return false;
  }
  function onKeyUp(event) {
    if (event.key !== ' ' || !spaceHeld) return;
    spaceHeld = false;stage.classList.remove('panning');
    if (!spaceUsed && doc()) onTogglePlay();
  }
  window.addEventListener('keyup', onKeyUp);
  const onBlur = () => { spaceHeld = false;stage.classList.remove('panning'); };
  window.addEventListener('blur', onBlur);

  function update(event) {
    // The playhead moves on every frame while an edge plays, and a parameter
    // slider on every move; only the picture changes.
    if (event.reason === 'time' || event.reason === 'parameters') { requestDraw();return; }
    if (['open', 'close', 'reload'].includes(event.reason)) {
      cancelGesture();
      draft = null;pointIndex = null;pointShape = null;autoFit = true;preview = null;hover = null;message('');
    }
    const edge = editEdge();
    // An edit, undo or redo may have removed or moved the shape under a gesture.
    if (gesture && gesture.type !== 'pan' && (!edge || edge.id !== gesture.edge || (gesture.index !== undefined && !edge.shapes[gesture.index]))) cancelGesture();
    if (gesture && ['undo', 'redo'].includes(event.reason)) cancelGesture();
    if (draft && (!edge || draft.edge !== edge.id)) draft = null;
    if (pointShape !== session.shape || selectedShape()?.kind !== 'polygon' || pointIndex >= selectedShape().points) { pointIndex = null;pointShape = session.shape; }
    if (!doc()) { renderChrome();return; }
    renderChrome();
    syncView();
    requestDraw();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => requestDraw()) : null;
  observer?.observe(stage);
  const themeObserver = typeof MutationObserver === 'function' ? new MutationObserver(() => requestDraw()) : null;
  themeObserver?.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'style', 'class']});
  draw();

  return {
    update,
    handleKey,
    fit,
    draw,
    get display() { return display; },
    // Where the shapes panel is mounted, beside the stage.
    get panelHost() { return $('[data-v-panel]'); },
    // Shows a line in the status bar under the stage, such as why an edit
    // was refused.
    message,
    // {x, y, k}: canvas point (cx, cy) is drawn at (cx * k + x, cy * k + y) inside the display.
    get view() { syncView();return {...view}; },
    get tool() { return toolId; },
    setTool,
    // The polygon being placed: its points so far, or null.
    get draft() { return draft && draft.points.map(p => ({...p})); },
    finishPolygon,
    cancelPolygon: dropDraft,
    // The selected point of the selected polygon (points tool), or null.
    get point() { return pointIndex; },
    selectPoint(index) { setPoint(Number.isInteger(index) ? index : null);requestDraw(); },
    pointAction,
    // Shows an edge read-only for the graph preview: {edge, time, parameters}
    // draws edge `edge` at `time` seconds with the parameter values given by
    // name (the rest take their defaults); any other object shows the empty
    // output, as a resting machine does; null returns to editing.
    setPreview(value) {
      cancelGesture();
      preview = value === null || value === undefined ? null : typeof value === 'object' && value.edge !== undefined && value.edge !== null ? {...value} : {edge: null};
      renderedOptions = '';
      draw();
    },
    get previewing() { return Boolean(preview); },
    // Pointer gestures leave the document alone until they end.
    get drawing() { return false; },
    destroy() {
      destroyed = true;
      clearTimeout(drawFallback);
      observer?.disconnect();themeObserver?.disconnect();
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      cancelGesture();
      parent.replaceChildren();
    },
  };
}
