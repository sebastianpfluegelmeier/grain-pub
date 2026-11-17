// The drawing canvas of the animation editor (docs/animation-graph-plan.md
// 6.6): the selected frame of the selected edge, the tools, the brush and
// colour controls, zoom and pan, and the onion skin. Pixels are changed with
// the functions in anim-paint.js and recorded through `session.edit`, one undo
// step per stroke, so a stroke is painted into the frame as the pointer moves
// and recorded at pointer up with the copy taken at pointer down.

import {surface, createStroke, resetStroke, stamp, stampBrush, BRUSH_TYPES, brushType, findCorner, findEdges, stampBlur, stampDisplace, strokeLine, strokeRect,
  drawGradient, floodFill, pick, rectFrom, clipRect, copyRect, clearRect, paste, moveRect, shift, flip, rotate, canRotate, toRGBA, addGhost,
  footprint, inside, paintTargets, MIN_BRUSH, MAX_BRUSH, VALUE_MODES, TWEEN_MODES, toHex, decodeValue} from './anim-paint.js';
import {createColourPicker} from './anim-colour.js';
import {edgeById, blankFrame, tweenSpan, tweenEdge} from './anim-model.js';
import {icon} from './icons.js';

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 64;
export const ZOOM_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
// Grid lines appear from this many screen pixels per frame pixel.
const GRID_SCALE = 8;
// One notch of a mouse wheel reports a delta of about 100, a trackpad a few
// units per event. Limiting each event keeps a notch to a modest zoom step.
const WHEEL_ZOOM_LIMIT = 30;
// The frame is drawn through an enlarged copy at fractional zooms (see
// drawPixels); the copy is skipped when it would hold more pixels than this.
const SHARP_PIXELS_MAX = 4_000_000;
// The size slider is exponential: equal travel multiplies the size by the
// same factor, so the small sizes pixel work needs take most of the track.
const SIZE_SLIDER_MAX = 1000;
const sizeFromSlider = value => Math.round(MIN_BRUSH * (MAX_BRUSH / MIN_BRUSH) ** (clamp(Number(value) || 0, 0, SIZE_SLIDER_MAX) / SIZE_SLIDER_MAX));
const sliderFromSize = size => Math.round(Math.log(size / MIN_BRUSH) / Math.log(MAX_BRUSH / MIN_BRUSH) * SIZE_SLIDER_MAX);
// Touch and pen handling, as in the asset editor.
export const TOUCH_DRAW_THRESHOLD = 6;
export const PEN_PALM_REJECTION_MS = 800;
const FIT_PADDING = 16;
// Used while the stage is hidden or measured without layout (tests).
const FALLBACK_SIZE = {width: 480, height: 360};
const ONION_TINTS = {previous: [217, 45, 32], next: [39, 90, 210]};
const ONION_STRENGTH = [0.45, 0.3, 0.2];
const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
const shortcut = key => (isMac ? '⌘' : 'Ctrl+') + key;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const TEXT_TARGETS = 'input,textarea,select,[contenteditable],dialog';

// The tools in toolbar order, in the groups the toolbar shows. `kind` decides
// how pointer input drives them:
// - stroke: stamps along the pointer path; `stamp(stroke, x, y, size,
//   strength)` defaults to the brush stamp of anim-paint.js.
// - drag: `draw(stroke, from, to)` is redrawn from the frame as it was at
//   pointer down on every move, so the shape previews in place.
// - fill, pick, select, shift and action have their own handling below.
// `paint` tools erase with the right button (unless `noErase`) and pick a
// colour with Alt. `options` lists the controls shown in the options bar:
// size, shape, opacity, pressure, density (dither), values (value modes),
// clipboard and tween. The scope control is shown for every tool that edits
// frames.
export const TOOL_GROUPS = [
  {id: 'brushes', label: 'Brushes'},
  {id: 'shapes', label: 'Shapes and fill'},
  {id: 'retouch', label: 'Retouch'},
  {id: 'frame', label: 'Selection and frames'},
];
const BRUSH_OPTIONS = ['size', 'shape', 'opacity'];
// The pen and the eraser choose a brush type instead of a shape; the type's
// own options (density) are added when it has them.
const TYPED_OPTIONS = ['type', 'size', 'opacity'];
export const TOOLS = [
  {id: 'pen', group: 'brushes', label: 'Pen', key: 'B', icon: 'pen', kind: 'stroke', paint: true, stamp: stampBrush, options: TYPED_OPTIONS},
  {id: 'eraser', group: 'brushes', label: 'Eraser', key: 'E', icon: 'eraser', kind: 'stroke', paint: true, erase: true, stamp: stampBrush, options: TYPED_OPTIONS},
  {id: 'line', group: 'shapes', label: 'Line', key: 'L', icon: 'line', kind: 'drag', paint: true, options: ['size', 'shape', 'opacity'],
    draw: (stroke, from, to) => { stroke.gradient = {from, to};strokeLine(stroke, from, to); }},
  {id: 'rectangle', group: 'shapes', label: 'Filled rectangle', key: 'R', icon: 'rectangle', kind: 'drag', paint: true, options: ['opacity'],
    draw: (stroke, from, to) => strokeRect(stroke, from, to)},
  {id: 'gradient', group: 'shapes', label: 'Gradient', icon: 'gradient', kind: 'drag', paint: true, noErase: true, options: ['opacity'],
    draw: (stroke, from, to) => drawGradient(stroke, from, to), hint: 'Drag from where the first colour starts to where the second colour ends.'},
  {id: 'fill', group: 'shapes', label: 'Fill', key: 'G', icon: 'bucket', kind: 'fill', paint: true, options: ['opacity']},
  {id: 'blur', group: 'retouch', label: 'Blur and smudge', icon: 'blur', kind: 'stroke', stamp: stampBlur, options: BRUSH_OPTIONS,
    hint: 'Softens what is under the brush; opacity sets how far each pixel moves towards its neighbours.'},
  {id: 'displace', group: 'retouch', label: 'Soft displace', icon: 'displace', kind: 'stroke', stamp: stampDisplace, options: BRUSH_OPTIONS,
    hint: 'Drag to push pixels along the stroke; the push fades towards the brush edge.'},
  {id: 'eyedropper', group: 'frame', label: 'Eyedropper', key: 'I', icon: 'eyedropper', kind: 'pick', options: []},
  {id: 'select', group: 'frame', label: 'Select', key: 'M', icon: 'selection', kind: 'select', options: ['clipboard']},
  {id: 'shift', group: 'frame', label: 'Shift the frame', icon: 'arrows-move', kind: 'shift', options: []},
  {id: 'tween', group: 'frame', label: 'Tween', icon: 'tween', kind: 'action', options: ['tween']},
];
export const SCOPES = [
  ['frame', 'This frame'],
  ['nearby', 'Nearby frames'],
  ['edge', 'Whole edge'],
];
export const MAX_SCOPE_RADIUS = 16;
// Guides: a coarse grid, centre lines and snapping for the shape tools. They
// are settings of the editor, kept in local storage and never written into
// an animation.
const GUIDES_KEY = 'studio-anim-guides', GRID_STEP_MIN = 2, GRID_STEP_MAX = 512;
export function normalizeGuides(source) {
  const input = source && typeof source === 'object' ? source : {};
  const step = value => clamp(Math.round(Number(value)) || 8, GRID_STEP_MIN, GRID_STEP_MAX);
  return {grid: input.grid === true, gridW: step(input.gridW), gridH: step(input.gridH), centre: input.centre === true, snap: input.snap === true,
    corners: input.corners === true};
}
// Snapping works per axis on pixel edges: edge 0 is the left side of pixel 0,
// edge `size` the right side of the last pixel. The targets are the grid
// lines, the frame's sides and, with centre lines on, the middle.
export function snapEdges(size, step, centre) {
  const edges = new Set([0, size]);
  for (let edge = step; edge < size; edge += step) edges.add(edge);
  if (centre) { edges.add(Math.floor(size / 2));edges.add(Math.ceil(size / 2)); }
  return [...edges].sort((a, b) => a - b);
}
const nearest = (values, position) => values.reduce((best, value) => Math.abs(value - position) < Math.abs(best - position) ? value : best);
// The end of a line snaps to the pixel right of (below) the nearest target,
// or to the last pixel at the far side. On an odd size the centre target is
// the middle pixel. Returns that pixel and where the marker goes.
export function snapPixel(position, size, step, centre) {
  let best = {pixel: size - 1, mark: size};
  const consider = (pixel, mark) => { if (Math.abs(mark - position) < Math.abs(best.mark - position)) best = {pixel, mark}; };
  for (let edge = 0; edge < size; edge += step) consider(edge, edge);
  if (centre) consider(Math.floor(size / 2), size / 2);
  return best;
}
// One axis of a snapped rectangle that starts on the edge `corner`: it ends
// on the nearest edge on the pointer's side, so it covers whole pixels up to
// a target and is never empty. Returns the first and the last pixel.
export function snapSpan(corner, position, edges) {
  const side = forward => edges.filter(edge => forward ? edge > corner : edge < corner);
  let candidates = side(position >= corner);
  if (!candidates.length) candidates = side(position < corner);
  const mark = nearest(candidates, position);
  return mark > corner ? {from: corner, to: mark - 1, mark} : {from: mark, to: corner - 1, mark};
}

const toolById = id => TOOLS.find(tool => tool.id === id) ?? TOOLS[0];

// `onInteract()` runs before the canvas changes a frame (the timeline stops
// playback); `onTogglePlay()` when Space is tapped without panning; `ghosts()`
// returns the onion ghosts to show as [{id, side, distance}].
export function createAnimationCanvas({parent, session, onInteract = () => {}, onTogglePlay = () => {}, ghosts = () => [], storage = null}) {
  parent.classList.add('anim-canvas');
  parent.innerHTML = `
    <div class="anim-tools" role="toolbar" aria-label="Tools" aria-orientation="horizontal">
      ${TOOL_GROUPS.map(group => `<div class="anim-tool-group" role="group" aria-label="${group.label}">
        ${TOOLS.filter(tool => tool.group === group.id).map(tool => `<button data-tool="${tool.id}" aria-pressed="false" aria-label="${tool.label}" title="${tool.label}${tool.key ? ` (${tool.key})` : ''}">${icon(tool.icon)}</button>`).join('')}
      </div>`).join('')}
      <div class="anim-tool-group" role="group" aria-label="Transform the frame">
        <button data-transform="flip-x" aria-label="Flip the frame horizontally" title="Flip the frame horizontally">${icon('flip-horizontal')}</button>
        <button data-transform="flip-y" aria-label="Flip the frame vertically" title="Flip the frame vertically">${icon('flip-vertical')}</button>
        <button data-transform="rotate" aria-label="Rotate the frame 90° clockwise" title="Rotate the frame 90° clockwise">${icon('rotate-clockwise')}</button>
      </div>
    </div>
    <div class="anim-settings">
      <div class="anim-tool-group anim-guides" role="group" aria-label="Guides">
        <button data-guide="grid" aria-pressed="false" aria-label="Grid" title="Show the grid">${icon('grid')}</button>
        <span class="anim-grid-step"><input type="number" data-grid-step min="${GRID_STEP_MIN}" max="${GRID_STEP_MAX}" step="1" inputmode="numeric" aria-label="Grid size in pixels" title="Grid size in pixels"></span>
        <button data-guide="centre" aria-pressed="false" aria-label="Centre lines" title="Show the centre lines">${icon('centre-lines')}</button>
        <button data-guide="snap" aria-pressed="false" aria-label="Snap line, rectangle and gradient" title="Snap line, rectangle and gradient to the grid, the sides and the centre lines">${icon('magnet')}</button>
        <button data-guide="corners" aria-pressed="false" aria-label="Snap to drawn corners" title="Snap line, rectangle and gradient to the corners of what is drawn">${icon('corner-snap')}</button>
      </div>
      <div class="anim-options" data-options></div>
    </div>
    <div class="anim-stage-column">
      <div class="anim-stage" data-stage>
        <canvas class="anim-display" tabindex="0" role="application" aria-label="Drawing canvas. B pen, E eraser, L line, R rectangle, G fill, I eyedropper, M select. Right-click erases, Alt-click takes a colour, hold Space and drag to pan."></canvas>
        <p class="anim-stage-empty" hidden></p>
      </div>
      <div class="anim-stage-footer">
        <span class="anim-history" role="group" aria-label="History">
          <button data-undo aria-label="Undo" title="Undo (${shortcut('Z')})">${icon('arrow-u-up-left')}</button>
          <button data-redo aria-label="Redo" title="Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z'})">${icon('arrow-u-up-right')}</button>
        </span>
        <span class="anim-position" data-position aria-live="off"></span>
        <p class="anim-canvas-status" role="status" aria-live="polite"></p>
        <span class="anim-zoom">
          <button data-zoom-out aria-label="Zoom out" title="Zoom out (−)">${icon('minus')}</button>
          <span data-zoom-level></span>
          <button data-zoom-in aria-label="Zoom in" title="Zoom in (+)">${icon('plus')}</button>
          <button class="anim-icon-button" data-canvas-fit aria-label="Fit frame" title="Fit the frame into view">${icon('arrows-out-simple')}</button>
        </span>
      </div>
    </div>
    <div class="anim-colour-panel" data-colour></div>`;
  const $ = selector => parent.querySelector(selector);
  const display = $('.anim-display'), stage = $('[data-stage]'), emptyLine = $('.anim-stage-empty');
  const statusLine = $('.anim-canvas-status'), positionLine = $('[data-position]');

  let toolId = 'pen', previousTool = 'pen';
  const brush = {size: 1, shape: 'square', opacity: 1, pressure: 'off', density: 50, modes: {colour: 'fixed', alpha: 'fixed'}, seed: null,
    // The brush type of the pen and of the eraser, each kept on its own.
    types: {pen: 'square', eraser: 'square'}};
  // The brush type of a tool that has one, else null, and the tip shape a tool paints with.
  const typeOf = t => t.options.includes('type') ? brushType(brush.types[t.id]) : null;
  const shapeOf = t => typeOf(t)?.shape ?? brush.shape;
  // Which frames of the edge a stroke, fill, shift or flip reaches (6.6).
  const scope = {kind: 'frame', radius: 1, fade: true};
  let tweenMode = 'dissolve';
  // The pixel selection {x, y, w, h} and the clipboard (a surface). Both are
  // kept across frames, edges and animations, so a selection can be copied
  // from one frame and pasted into another.
  let selection = null, clipboard = null;
  // The canvas transform: frame pixel (px, py) is drawn at (px * k + x, py * k + y) CSS pixels.
  let view = {x: 0, y: 0, k: 1}, autoFit = true;
  let width = FALLBACK_SIZE.width, height = FALLBACK_SIZE.height;
  let gesture = null, hover = null, preview = null, drawPending = false, drawFallback = null, destroyed = false;
  const DRAW_FALLBACK_MS = 200, SETTLE_MS = 50;
  let settlePending = false;
  let spaceHeld = false, spaceUsed = false, penUntil = 0;
  // True while the size slider is dragged: the footprint is then shown in the
  // middle of the stage, because a finger has no hover position to show it at.
  let sizing = false;
  let guides = normalizeGuides(null);
  try { guides = normalizeGuides(JSON.parse(storage?.getItem(GUIDES_KEY) ?? 'null')); } catch {}
  // Where the snap marker is shown, in pixel-edge coordinates, or null.
  let snapMark = null;
  const touch = {mode: 'idle', pointers: new Map(), primaryId: null, start: null, centroid: null, spread: null, blockDrawing: false};

  const picker = createColourPicker({parent: $('[data-colour]'), session, onChange: () => requestDraw(), onMessage: message});

  // Offscreen buffers at frame size: the frame itself and the onion ghosts.
  const frameCanvas = document.createElement('canvas'), ghostCanvas = document.createElement('canvas');
  let frameContext = null, ghostContext = null, frameImage = null, ghostImage = null, ghostKey = '', paintVersion = 0;
  const identities = new WeakMap();
  let nextIdentity = 1;
  const identity = data => { if (!identities.has(data)) identities.set(data, nextIdentity++);return identities.get(data); };

  const doc = () => session.doc;
  const tool = () => toolById(toolId);
  // The frame on show: the preview's while one runs, else the selected frame.
  // A preview frame of null is the empty output of a resting machine.
  const frameId = () => preview ? preview.frame : session.frame?.id ?? null;
  const previewEmpty = () => Boolean(preview) && (preview.frame === null || !doc()?.pixels.has(preview.frame));
  const editable = () => Boolean(doc()) && !session.readOnly && !preview && frameId() !== null && doc().pixels.has(frameId());
  const surfaceOf = id => { const d = doc(), data = d?.pixels.get(id);return data ? surface(d.format, d.width, d.height, data) : null; };
  function message(value = '') { statusLine.textContent = value; }

  // Edits ---------------------------------------------------------------------------

  // The frames an operation reaches: the selected frame first, then the
  // others of the scope, as [{id, weight}] with each id once.
  function targets() {
    const d = doc(), f = session.frame, edge = f && edgeById(d, f.edge);
    if (!edge) return [];
    const list = new Map();
    for (const {index, weight} of paintTargets(edge.frames.length, f.index, {scope: scope.kind, radius: scope.radius, fade: scope.fade})) {
      const id = edge.frames[index];
      if (d.pixels.has(id)) list.set(id, Math.max(list.get(id) ?? 0, weight));
    }
    return [...list].map(([id, weight]) => ({id, weight}));
  }

  // Records a change of one or more frames as one undo step. `change` gets a
  // surface and the frame's weight for each frame of `ids`. Errors are shown
  // in the status line, as the graph does.
  function editFrames(ids, change) {
    try {
      const weights = new Map(targets().map(t => [t.id, t.weight]));
      const result = session.edit(d => {
        let changed;
        for (const id of ids) changed = change(surface(d.format, d.width, d.height, d.pixels.get(id)), weights.get(id) ?? 1) || changed;
        return changed;
      }, {frames: ids, edge: session.frame?.edge});
      if (result !== undefined) paintVersion++;
      message('');
      return result;
    } catch (error) {
      message(error.message || String(error));
      return undefined;
    }
  }
  function editFrame(id, change) {
    return editFrames([id], change);
  }
  // A gesture that painted into its frames as the pointer moved is recorded
  // once, at its end, with the copies taken when it started.
  function commitInPlace(g) {
    const entries = g.entries.filter(entry => doc()?.pixels.get(entry.id) === entry.data);
    if (!entries.length) return;
    try {
      if (session.edit(() => {}, {frames: entries.map(entry => entry.id), before: new Map(entries.map(entry => [entry.id, entry.base])), edge: g.edge}) !== undefined) paintVersion++;
    } catch (error) {
      for (const entry of entries) entry.data.set(entry.base);
      message(error.message || String(error));
    }
  }
  function restoreInPlace(g) {
    for (const entry of g.entries) if (entry.base && doc()?.pixels.get(entry.id) === entry.data) entry.data.set(entry.base);
  }

  // Rendering -----------------------------------------------------------------------

  function measure() {
    const rect = display.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) { width = display.clientWidth || rect.width;height = display.clientHeight || rect.height; }
    else { width = FALLBACK_SIZE.width;height = FALLBACK_SIZE.height; }
  }
  function fitView() {
    const d = doc();
    if (!d) return;
    // The frame fills the stage, whatever scale that takes.
    const k = clamp(Math.min((width - 2 * FIT_PADDING) / d.width, (height - 2 * FIT_PADDING) / d.height), ZOOM_MIN, ZOOM_MAX);
    view = {k, x: Math.round((width - d.width * k) / 2), y: Math.round((height - d.height * k) / 2)};
  }
  // Pans back when the frame would leave the stage entirely, so it can
  // always be found again.
  function keepInView() {
    const d = doc(), margin = 24;
    view.x = clamp(view.x, margin - d.width * view.k, width - margin);
    view.y = clamp(view.y, margin - d.height * view.k, height - margin);
  }
  // Applies the fit as soon as the document or the stage changes, so pointer
  // input never uses a stale transform.
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

  function ensureBuffers(d) {
    if (frameCanvas.width !== d.width || frameCanvas.height !== d.height || !frameImage) {
      frameCanvas.width = ghostCanvas.width = d.width;frameCanvas.height = ghostCanvas.height = d.height;
      frameContext = frameCanvas.getContext?.('2d') ?? null;ghostContext = ghostCanvas.getContext?.('2d') ?? null;
      frameImage = frameContext?.createImageData(d.width, d.height) ?? null;
      ghostImage = ghostContext?.createImageData(d.width, d.height) ?? null;
      ghostKey = '';
    }
    return Boolean(frameImage);
  }
  // Converts the frame to RGBA. Cheap enough to run on every pointer move at
  // the largest size; the scaling is left to drawImage.
  // The runtime's empty output: transparent in Matte and Image, 0 in a Field.
  let blank = null;
  function blankSurface(d) {
    if (!blank || blank.format !== d.format || blank.width !== d.width || blank.height !== d.height) blank = surface(d.format, d.width, d.height, blankFrame(d));
    return blank;
  }
  function refreshFrame() {
    const d = doc(), s = previewEmpty() ? d && blankSurface(d) : surfaceOf(frameId());
    if (!d || !s || !ensureBuffers(d)) return;
    toRGBA(s, frameImage.data);
    frameContext.putImageData(frameImage, 0, 0);
  }
  function currentGhosts() {
    if (preview || !doc() || frameId() === null) return [];
    // A one-frame loop is its own neighbour; a ghost of the frame on show
    // would only tint it.
    const id = frameId();
    return ghosts().filter(ghost => ghost.id !== id && doc().pixels.has(ghost.id));
  }
  // The ghosts change only when the frame, the onion settings or a ghost's
  // pixels change, so they are composed once and cached.
  function refreshGhosts(list) {
    const d = doc();
    if (!list.length || !ensureBuffers(d)) return false;
    const key = d.format + d.width + 'x' + d.height + ':' + paintVersion + ':' + list.map(g => `${g.id}/${identity(d.pixels.get(g.id))}/${g.side}/${g.distance}`).join(',');
    if (key === ghostKey) return true;
    ghostKey = key;
    ghostImage.data.fill(0);
    // Farther ghosts first, so nearer ones lie on top.
    for (const ghost of [...list].sort((a, b) => b.distance - a.distance)) {
      addGhost(ghostImage.data, surfaceOf(ghost.id), ONION_TINTS[ghost.side], ONION_STRENGTH[ghost.distance - 1] ?? 0.15);
    }
    ghostContext.putImageData(ghostImage, 0, 0);
    return true;
  }
  // Draws a frame-sized canvas at the view's scale. With a whole number of
  // screen pixels per frame pixel, nearest-neighbour scaling is exact. In
  // between it would give frame pixels of unequal size, so the frame is first
  // enlarged by the next whole factor and then scaled down smoothly: every
  // pixel keeps the same size and gets a soft edge instead.
  const sharpCanvas = document.createElement('canvas');
  function drawPixels(ctx, source, x, y, w, h, scale) {
    const whole = Math.max(1, Math.ceil(scale - 1e-6));
    const sharpContext = Math.abs(scale - Math.round(scale)) < 1e-6 || source.width * whole * source.height * whole > SHARP_PIXELS_MAX ? null : sharpCanvas.getContext?.('2d') ?? null;
    if (!sharpContext) { ctx.imageSmoothingEnabled = false;ctx.drawImage(source, x, y, w, h);return; }
    let from = source;
    if (whole > 1) {
      const sharpWidth = source.width * whole, sharpHeight = source.height * whole;
      if (sharpCanvas.width !== sharpWidth || sharpCanvas.height !== sharpHeight) { sharpCanvas.width = sharpWidth;sharpCanvas.height = sharpHeight; }
      else sharpContext.clearRect(0, 0, sharpWidth, sharpHeight);
      sharpContext.imageSmoothingEnabled = false;
      sharpContext.drawImage(source, 0, 0, sharpWidth, sharpHeight);
      from = sharpCanvas;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = scale < 1 ? 'high' : 'low';
    ctx.drawImage(from, x, y, w, h);
    ctx.imageSmoothingEnabled = false;
  }
  function requestDraw() {
    if (drawPending) return;
    drawPending = true;
    (globalThis.requestAnimationFrame ?? (callback => setTimeout(callback, 16)))(() => { if (drawPending) draw(); });
    // A browser can hold animation frames back (a hidden page, a web app
    // resumed from the background). Without this timer the request would stay
    // pending and the canvas would keep its old picture.
    drawFallback = setTimeout(() => { if (drawPending) draw(); }, DRAW_FALLBACK_MS);
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
  function token(name, fallback) {
    return getComputedStyle(parent).getPropertyValue(name).trim() || fallback;
  }
  // Draws the stage: checkerboard, ghosts, frame, grid, selection and the
  // brush footprint under the pointer.
  function draw() {
    paint();
    // Safari on iOS can show the picture of the draw before: the frame goes
    // through a buffer canvas, and a copy from that canvas may still hold
    // its previous content. With a mouse the next pointer move repaints; a
    // touch screen has none, so one more paint follows each draw.
    if (destroyed || settlePending) return;
    settlePending = true;
    setTimeout(() => { settlePending = false;if (!destroyed) paint(); }, SETTLE_MS);
  }
  function paint() {
    drawPending = false;
    clearTimeout(drawFallback);
    if (destroyed) return;
    const d = doc(), id = frameId();
    renderChrome();
    measure();
    if (d && autoFit) fitView();
    else if (d) keepInView();
    $('[data-zoom-level]').textContent = Math.round(view.k * 100) + '%';
    const dpr = globalThis.devicePixelRatio || 1;
    const backingWidth = Math.max(1, Math.round(width * dpr)), backingHeight = Math.max(1, Math.round(height * dpr));
    if (display.width !== backingWidth || display.height !== backingHeight) { display.width = backingWidth;display.height = backingHeight; }
    const ctx = display.getContext?.('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!d || (!previewEmpty() && (id === null || !d.pixels.has(id)))) return;
    refreshFrame();
    const list = currentGhosts(), hasGhosts = refreshGhosts(list);
    const {x, y, k} = view, w = d.width * k, h = d.height * k;
    ctx.imageSmoothingEnabled = false;
    // A checkerboard of fixed screen size under transparent pixels, aligned
    // with the frame's corner.
    const pattern = checkerPattern(ctx, token('--anim-checker-a', '#d7d5cb'), token('--anim-checker-b', '#c8c6bb'));
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = pattern ?? token('--anim-checker-a', '#d7d5cb');
    ctx.fillRect(Math.max(0, -x), Math.max(0, -y), Math.min(w, width - x) - Math.max(0, -x), Math.min(h, height - y) - Math.max(0, -y));
    ctx.restore();
    // A Field is opaque everywhere, so its ghosts go over the frame; in the
    // other formats they show through the transparent parts, under it.
    const ghostsOnTop = d.format === 'field';
    if (hasGhosts && !ghostsOnTop) drawPixels(ctx, ghostCanvas, x, y, w, h, k * dpr);
    drawPixels(ctx, frameCanvas, x, y, w, h, k * dpr);
    if (hasGhosts && ghostsOnTop) { ctx.globalAlpha = 0.8;drawPixels(ctx, ghostCanvas, x, y, w, h, k * dpr);ctx.globalAlpha = 1; }
    const hairline = 1 / dpr;
    if (k >= GRID_SCALE) {
      ctx.fillStyle = token('--anim-grid', 'rgba(128, 128, 128, 0.35)');
      // Each line sits on a whole screen pixel, so the grid stays one crisp
      // hairline at fractional zooms.
      const snap = value => Math.round(value * dpr) / dpr;
      for (let column = 1; column < d.width; column++) { const gx = snap(x + column * k);if (gx >= 0 && gx <= width) ctx.fillRect(gx, Math.max(y, 0), hairline, Math.min(h, height)); }
      for (let row = 1; row < d.height; row++) { const gy = snap(y + row * k);if (gy >= 0 && gy <= height) ctx.fillRect(Math.max(x, 0), gy, Math.min(w, width), hairline); }
    }
    ctx.strokeStyle = token('--line', '#343a3b');ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    if (!preview) {
      const snap = value => Math.round(value * dpr) / dpr, thick = Math.max(1, Math.round(dpr)) / dpr;
      const vertical = at => ctx.fillRect(snap(x + at * k - thick / 2), y, thick, h), horizontal = at => ctx.fillRect(x, snap(y + at * k - thick / 2), w, thick);
      if (guides.grid) {
        ctx.fillStyle = token('--anim-guide', 'rgba(128, 128, 128, 0.6)');
        for (let column = guides.gridW; column < d.width; column += guides.gridW) vertical(column);
        for (let row = guides.gridH; row < d.height; row += guides.gridH) horizontal(row);
      }
      if (guides.centre) { ctx.fillStyle = token('--anim-centre', 'rgb(214, 51, 132)');vertical(d.width / 2);horizontal(d.height / 2); }
    }
    const shown = gesture?.type === 'move' ? gesture.shown : gesture?.type === 'marquee' ? gesture.rect : selection;
    if (shown) outline(ctx, [[shown.x, shown.y, shown.x + shown.w, shown.y + shown.h]], true);
    const marked = snapMark && snapActive();
    if (hover && !sizing && !gesture?.type?.match?.(/pan|marquee|move/) && editable() && !(marked && tool().id === 'rectangle')) {
      const t = tool();
      const cells = t.kind === 'stroke' || (t.kind === 'drag' && t.id === 'line') ? footprint(brushSize(), shapeOf(t)) : footprint(1);
      outline(ctx, footprintEdges(cells, hover.x, hover.y), false);
    }
    if (sizing && editable()) outline(ctx, footprintEdges(footprint(brushSize(), shapeOf(tool())), Math.floor((width / 2 - x) / k), Math.floor((height / 2 - y) / k)), false);
    if (marked && !sizing) {
      // A cross in a circle on the target the shape snaps to.
      const mx = x + snapMark.x * k, my = y + snapMark.y * k;
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.moveTo(mx - 9, my);ctx.lineTo(mx + 9, my);ctx.moveTo(mx, my - 9);ctx.lineTo(mx, my + 9);
      ctx.lineWidth = 3.5;ctx.strokeStyle = '#121210';ctx.stroke();
      ctx.lineWidth = 1.5;ctx.strokeStyle = '#f4f2e8';ctx.stroke();
    }
  }
  // Draws rectangles or edge segments (in frame pixels) as a dark and a light
  // line, visible on any colour.
  function outline(ctx, items, rectangles) {
    const {x, y, k} = view;
    ctx.save();
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of items) {
      if (rectangles) ctx.rect(x + x0 * k + 0.5, y + y0 * k + 0.5, (x1 - x0) * k - 1, (y1 - y0) * k - 1);
      else { ctx.moveTo(x + x0 * k, y + y0 * k);ctx.lineTo(x + x1 * k, y + y1 * k); }
    }
    ctx.lineWidth = 3;ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';ctx.stroke();
    ctx.lineWidth = 1;ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    if (rectangles) ctx.setLineDash?.([4, 3]);
    ctx.stroke();
    ctx.restore();
  }
  const edgeCache = new Map();
  // The outline of a brush footprint as unit edge segments, placed at (px, py).
  function footprintEdges(cells, px, py) {
    let edges = edgeCache.get(cells);
    if (!edges) {
      const set = new Set();
      for (let index = 0; index < cells.length; index += 2) set.add(cells[index] + ',' + cells[index + 1]);
      edges = [];
      for (let index = 0; index < cells.length; index += 2) {
        const cx = cells[index], cy = cells[index + 1];
        if (!set.has(cx + ',' + (cy - 1))) edges.push([cx, cy, cx + 1, cy]);
        if (!set.has(cx + ',' + (cy + 1))) edges.push([cx, cy + 1, cx + 1, cy + 1]);
        if (!set.has((cx - 1) + ',' + cy)) edges.push([cx, cy, cx, cy + 1]);
        if (!set.has((cx + 1) + ',' + cy)) edges.push([cx + 1, cy, cx + 1, cy + 1]);
      }
      edgeCache.set(cells, edges);
    }
    return edges.map(([x0, y0, x1, y1]) => [x0 + px, y0 + py, x1 + px, y1 + py]);
  }

  // Toolbar, options and the empty state ----------------------------------------------

  let renderedOptions = '';
  function renderChrome() {
    const d = doc(), id = frameId(), canEdit = editable();
    // The preview hides the tools and the colour panel; the stage takes their room.
    parent.classList.toggle('previewing', Boolean(preview));
    for (const button of parent.querySelectorAll('[data-tool]')) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === toolId));
      button.disabled = !canEdit;
    }
    for (const button of parent.querySelectorAll('[data-transform]')) button.disabled = !canEdit || (button.dataset.transform === 'rotate' && !canRotate(d));
    const rotateButton = $('[data-transform="rotate"]');
    rotateButton.title = d && !canRotate(d) ? 'Rotate needs a square canvas' : 'Rotate the frame 90° clockwise';
    for (const button of parent.querySelectorAll('[data-guide]')) button.setAttribute('aria-pressed', String(guides[button.dataset.guide]));
    // The grid size only matters while the grid is shown or snapped to.
    $('.anim-grid-step').hidden = !(guides.grid || guides.snap);
    for (const input of parent.querySelectorAll('[data-grid-step]')) if (document.activeElement !== input) input.value = String(guides.gridW);
    for (const button of parent.querySelectorAll('.anim-zoom button')) button.disabled = !d;
    $('[data-undo]').disabled = !session.canUndo;
    $('[data-redo]').disabled = !session.canRedo;
    let empty = '';
    if (!d) empty = '';
    else if (!d.edges.length) empty = 'Add states and an edge in the graph, then draw its frames here.';
    else if (id === null && !preview) empty = 'Select an edge in the graph to draw its frames.';
    emptyLine.textContent = empty;emptyLine.hidden = !empty;
    display.hidden = !d || (id === null && !preview);
    renderOptions();
  }
  // The options bar is rebuilt only when the tool, the format or the scope
  // changes, so a dragged slider keeps its pointer.
  function renderOptions() {
    const t = tool(), d = doc(), type = typeOf(t);
    const options = preview || !d ? [] : type?.density ? [...t.options, 'density'] : t.options;
    const key = [t.id, options.join(), Boolean(selection), Boolean(clipboard), editable(), d?.format, scope.kind, Boolean(preview), session.frame?.count].join(':');
    const host = $('[data-options]');
    if (key !== renderedOptions) {
      renderedOptions = key;
      // The brush settings stay usable without a frame to draw on, so a brush
      // can be set up before an edge is selected. What acts on a frame is off.
      const disabled = editable() ? '' : 'disabled';
      const parts = [];
      if (options.includes('type')) parts.push(`<label class="anim-option" title="Brush type: the shape of the tip and how it paints"><select data-brush-type aria-label="Brush type">${BRUSH_TYPES.filter(item => !(item.pen && t.erase)).map(item => `<option value="${item.id}" data-preview="${typePreview(item.id)}">${item.label}</option>`).join('')}</select><span class="anim-brush-preview" data-brush-preview aria-hidden="true"></span></label>`);
      if (options.includes('size')) parts.push(`<label class="anim-option" title="Brush size, ${MIN_BRUSH} to ${MAX_BRUSH} pixels ([ and ])"><span class="anim-option-name" data-symbol="⌀">Size</span><input type="range" data-size min="0" max="${SIZE_SLIDER_MAX}" step="1"><output data-size-value></output></label>`);
      if (options.includes('shape')) parts.push(`<span class="anim-option anim-segmented" role="group" aria-label="Brush shape"><button class="anim-icon-button" data-shape="square" aria-label="Square brush" title="Square brush">${icon('shape-square')}</button><button class="anim-icon-button" data-shape="round" aria-label="Round brush" title="Round brush">${icon('shape-round')}</button></span>`);
      if (options.includes('opacity')) parts.push(`<label class="anim-option" title="Brush opacity, multiplies the colour's alpha"><span class="anim-option-name" data-symbol="◐">Opacity</span><input type="range" data-opacity min="1" max="100" step="1"><output data-opacity-value></output></label>`);
      if (options.includes('density')) parts.push(`<label class="anim-option" title="How dense the pattern of the brush type is"><span class="anim-option-name" data-symbol="▦">Density</span><input type="range" data-density min="1" max="100" step="1"><output data-density-value></output></label>`);
      if (options.includes('clipboard')) {
        parts.push(`<span class="anim-option anim-actions">
          <button data-copy title="Copy the selection (${shortcut('C')})" ${selection && editable() ? '' : 'disabled'}>Copy</button>
          <button data-cut title="Cut the selection (${shortcut('X')})" ${selection && editable() ? '' : 'disabled'}>Cut</button>
          <button data-paste title="Paste into this frame (${shortcut('V')})" ${clipboard && editable() ? '' : 'disabled'}>Paste</button>
          <button data-clear title="Clear the selected pixels (Delete)" ${selection && editable() ? '' : 'disabled'}>Clear</button>
          <button data-deselect title="Select nothing (Escape)" ${selection ? '' : 'disabled'}>Deselect</button>
        </span>`);
      }
      if (options.includes('tween')) {
        parts.push(`<label class="anim-option" title="Dissolve flips whole pixels from one drawing to the other; blend mixes every channel">Tween<select data-tween-mode ${disabled}>${TWEEN_MODES.map(mode => `<option value="${mode}">${mode}</option>`).join('')}</select></label>
          <span class="anim-option anim-actions"><button data-tween-run title="Fill the blank frames after this frame, up to the next drawn frame" ${disabled}>Fill blank frames</button></span>`);
      }
      if (t.hint && !preview && d) parts.push(`<span class="anim-option-hint">${t.hint}</span>`);
      if (t.kind === 'shift' && !preview && d) parts.push('<span class="anim-option-hint">Drag to move the whole frame.</span>');
      if (t.kind === 'pick' && !preview && d) parts.push('<span class="anim-option-hint">Click to take a colour. Alt-click does the same with any paint tool.</span>');
      if (t.kind === 'action' && t.id === 'tween' && !preview && d) parts.push('<span class="anim-option-hint">Between this frame and the next drawn one.</span>');
      host.innerHTML = parts.join('');
    }
    const active = document.activeElement;
    // The thumb is moved only when it does not already stand for the size:
    // many positions give the same size, and a dragged thumb must stay under
    // the finger.
    const size = host.querySelector('[data-size]');
    if (size && sizeFromSlider(size.value) !== brush.size) size.value = String(sliderFromSize(brush.size));
    if (size) size.setAttribute('aria-valuetext', `${brush.size} ${brush.size === 1 ? 'pixel' : 'pixels'}`);
    const sizeValue = host.querySelector('[data-size-value]');
    if (sizeValue) sizeValue.textContent = String(brush.size);
    const typeSelect = host.querySelector('[data-brush-type]');
    if (typeSelect && type) typeSelect.value = type.id;
    const typeSample = host.querySelector('[data-brush-preview]');
    if (typeSample && type) { const url = typePreview(type.id);typeSample.hidden = !url;typeSample.style.maskImage = typeSample.style.webkitMaskImage = `url("${url}")`; }
    for (const button of host.querySelectorAll('[data-shape]')) button.setAttribute('aria-pressed', String(button.dataset.shape === brush.shape));
    const opacity = host.querySelector('[data-opacity]');
    if (opacity && opacity !== active) opacity.value = String(Math.round(brush.opacity * 100));
    const opacityValue = host.querySelector('[data-opacity-value]');
    if (opacityValue) opacityValue.textContent = Math.round(brush.opacity * 100) + '%';
    const density = host.querySelector('[data-density]');
    if (density && density !== active) density.value = String(brush.density);
    const densityValue = host.querySelector('[data-density-value]');
    if (densityValue) densityValue.textContent = brush.density + '%';
    const tweenSelect = host.querySelector('[data-tween-mode]');
    if (tweenSelect) tweenSelect.value = tweenMode;
  }
  function setTool(id) {
    const next = toolById(id);
    if (next.id === toolId) return;
    cancelGesture();
    if (next.kind === 'pick' && tool().kind !== 'pick') previousTool = toolId;
    toolId = next.id;
    requestDraw();renderChrome();
  }
  // `seed` fixes the random brushes (spray, noise, random values) so a
  // stroke can be reproduced; null seeds every stroke freshly.
  function setBrush(next) {
    if (next.size !== undefined) brush.size = clamp(Math.round(next.size), MIN_BRUSH, MAX_BRUSH);
    if (next.shape !== undefined && ['square', 'round'].includes(next.shape)) brush.shape = next.shape;
    // `type` sets the brush type of the selected tool, when it is the pen or the eraser.
    if (next.type !== undefined) setBrushType(next.type);
    if (next.opacity !== undefined) brush.opacity = clamp(next.opacity, 0.01, 1);
    if (next.pressure !== undefined && ['off', 'size', 'opacity'].includes(next.pressure)) brush.pressure = next.pressure;
    if (next.density !== undefined) brush.density = clamp(Math.round(next.density) || 1, 1, 100);
    if (next.seed !== undefined) brush.seed = next.seed === null ? null : next.seed >>> 0;
    for (const channel of ['colour', 'alpha']) if (next.modes?.[channel] && VALUE_MODES.includes(next.modes[channel])) brush.modes[channel] = next.modes[channel];
    renderOptions();requestDraw();
  }
  // A sample stroke of a brush type as an image URL: a short line drawn with
  // the real brush on a small frame. It is used as a mask, so only its alpha
  // counts and it takes the colour of the text around it.
  const previews = new Map();
  function typePreview(id) {
    if (previews.has(id)) return previews.get(id);
    const w = 40, h = 16, s = surface('image', w, h, new Uint8Array(w * h * 4));
    const stroke = createStroke(s, {colour: [255, 255, 255, 255], colour2: [255, 255, 255, 255], size: 5, type: id, seed: 7});
    stroke.gradient = {from: {x: 6, y: 10}, to: {x: 33, y: 5}};
    strokeLine(stroke, {x: 6, y: 10}, {x: 20, y: 6}, stampBrush);
    strokeLine(stroke, {x: 20, y: 6}, {x: 33, y: 9}, stampBrush);
    const canvas = document.createElement('canvas');
    canvas.width = w;canvas.height = h;
    let url = '';
    try {
      const ctx = canvas.getContext('2d');
      ctx.putImageData(new ImageData(new Uint8ClampedArray(s.data.buffer), w, h), 0, 0);
      url = canvas.toDataURL();
    } catch {}
    previews.set(id, url);
    return url;
  }
  function setBrushType(id) {
    const t = tool(), type = BRUSH_TYPES.find(item => item.id === id);
    if (!type || !t.options.includes('type') || (type.pen && t.erase)) return;
    brush.types[t.id] = type.id;
  }
  function setScope(next) {
    if (['frame', 'nearby', 'edge'].includes(next.kind)) scope.kind = next.kind;
    if (next.radius !== undefined) scope.radius = clamp(Math.round(next.radius) || 1, 1, MAX_SCOPE_RADIUS);
    if (next.fade !== undefined) scope.fade = Boolean(next.fade);
    renderOptions();requestDraw();
  }
  function setBrushSize(value) {
    brush.size = clamp(Math.round(Number(value)) || brush.size, MIN_BRUSH, MAX_BRUSH);
    renderOptions();requestDraw();
  }

  // Pointer input ----------------------------------------------------------------------

  function locate(event) {
    const rect = display.getBoundingClientRect();
    // Studio's View zoom scales the page, so client pixels are converted back to canvas pixels.
    const scale = rect.width > 0 && display.clientWidth > 0 ? display.clientWidth / rect.width : 1;
    const sx = (event.clientX - rect.left) * scale, sy = (event.clientY - rect.top) * scale;
    const fx = (sx - view.x) / view.k, fy = (sy - view.y) / view.k;
    return {sx, sy, fx, fy, x: Math.floor(fx), y: Math.floor(fy)};
  }
  function setGuides(patch) {
    guides = normalizeGuides({...guides, ...patch});
    try { storage?.setItem(GUIDES_KEY, JSON.stringify(guides)); } catch {}
    if (!guides.snap && !guides.corners) snapMark = null;
    renderChrome();requestDraw();
  }
  const snapActive = () => (guides.snap || guides.corners) && tool().kind === 'drag' && editable();
  // What is drawn near the pointer to snap to, when corner snapping is on,
  // as {x, y} on pixel edges; an axis without a target is null. A corner
  // gives both. Without one, a straight edge under the pointer gives the
  // axis across it, so a shape can end on a line anywhere along it.
  //
  // The frame being drawn is searched first, then the onion skin frames that
  // are shown. A corner of an onion frame counts for less, so it wins only
  // when the drawing has none that is about as close; its edges are used only
  // when the drawing has none in reach. During a drag the frame from before
  // the drag is searched, so the shape being drawn does not catch itself.
  // The reach is a fixed distance on screen and does not grow when zoomed out.
  const ONION_WEIGHT = 0.6;
  function drawnNear(p) {
    const d = doc();
    if (!guides.corners || !d) return null;
    const current = gesture?.type === 'drag' ? gesture.entries[0]?.base : d.pixels.get(frameId());
    const frames = [current, ...currentGhosts().map(ghost => d.pixels.get(ghost.id))].filter(Boolean).map(data => surface(d.format, d.width, d.height, data));
    const radius = clamp(14 / view.k, 1.5, 12);
    let best = null;
    frames.forEach((frame, index) => {
      const corner = findCorner(frame, p.fx, p.fy, radius), score = corner ? corner.score * (index ? ONION_WEIGHT : 1) : 0;
      if (corner && (!best || score > best.score)) best = {x: corner.x, y: corner.y, score};
    });
    // A corner close to the pointer (8 pixels on screen) always wins. One
    // further away gives way to a straight edge that is in reach, so aiming at
    // the middle of a short side does not jump to its ends.
    const corner = best && {x: best.x, y: best.y};
    if (corner && Math.hypot(corner.x - p.fx, corner.y - p.fy) * view.k <= 8) return corner;
    for (const frame of frames) {
      const edges = findEdges(frame, p.fx, p.fy, Math.max(1, radius * 0.6));
      if (edges.x !== null || edges.y !== null) return edges;
    }
    return corner;
  }
  // One axis of a rectangle between its first corner and the pointer, as the
  // first and last pixel. Each end is a pixel edge when it is snapped
  // (`anchorEdge`, `mark`) and a pixel otherwise (`anchorCell`, `cell`).
  function rectSpan(anchorEdge, anchorCell, mark, cell) {
    if (anchorEdge !== null) {
      if (mark !== null && mark !== anchorEdge) return mark > anchorEdge ? [anchorEdge, mark - 1] : [mark, anchorEdge - 1];
      return cell >= anchorEdge ? [anchorEdge, cell] : [cell, anchorEdge - 1];
    }
    if (mark !== null) return mark > anchorCell ? [anchorCell, Math.max(anchorCell, mark - 1)] : [Math.min(mark, anchorCell), anchorCell];
    return [Math.min(anchorCell, cell), Math.max(anchorCell, cell)];
  }
  // The two ends of a shape for the pointer at `p`, and the snap marker.
  // `start` is the result from the press: a line and a gradient keep their
  // first pixel, a rectangle keeps its first corner. Each axis snaps on its
  // own: to something drawn when there is a target, else to the grid when
  // the grid snap is on, else not at all.
  function shapeEnds(p, start) {
    const d = doc();
    if (!snapActive()) { const point = {x: p.x, y: p.y};return {from: start?.from ?? point, to: point, mark: null}; }
    const found = drawnNear(p) ?? {x: null, y: null};
    const axes = [['x', p.fx, p.x, d.width, guides.gridW], ['y', p.fy, p.y, d.height, guides.gridH]];
    // The marker stands on the targets; on an axis without one it follows the pointer.
    const markOf = marks => marks.x === null && marks.y === null ? null : {x: marks.x ?? p.fx, y: marks.y ?? p.fy};
    if (tool().id === 'rectangle') {
      // The first corner, per axis: a pixel edge when snapped, and the pixel under the pointer.
      const anchor = start?.anchor ?? Object.fromEntries(axes.map(([key, position, cell, size, step]) =>
        [key, {edge: found[key] ?? (guides.snap ? nearest(snapEdges(size, step, guides.centre), position) : null), cell}]));
      // Before the press the marker shows where the first corner would go.
      if (!start && !p.pressed) return {anchor, from: null, to: null, mark: markOf({x: anchor.x.edge, y: anchor.y.edge})};
      const spans = {}, marks = {};
      for (const [key, position, cell, size, step] of axes) {
        const {edge, cell: anchorCell} = anchor[key];
        let mark = found[key] !== null && found[key] !== edge ? found[key] : null;
        if (mark === null && guides.snap && edge !== null) mark = snapSpan(edge, position, snapEdges(size, step, guides.centre)).mark;
        spans[key] = rectSpan(edge, anchorCell, mark, cell);marks[key] = mark;
      }
      return {anchor, from: {x: spans.x[0], y: spans.y[0]}, to: {x: spans.x[1], y: spans.y[1]}, mark: markOf(marks)};
    }
    const point = {}, marks = {};
    for (const [key, position, cell, size, step] of axes) {
      if (found[key] !== null) {
        // Of the two pixels at the target, the one on the pointer's side.
        point[key] = clamp(position >= found[key] ? found[key] : found[key] - 1, 0, size - 1);marks[key] = found[key];
      } else if (guides.snap) {
        const snapped = snapPixel(position, size, step, guides.centre);
        point[key] = snapped.pixel;marks[key] = snapped.mark;
      } else { point[key] = cell;marks[key] = null; }
    }
    return {from: start?.from ?? point, to: point, mark: markOf(marks)};
  }
  const brushSize = () => brush.size;
  // Pen pressure changes size or opacity when the brush asks for it; a mouse
  // reports a fixed pressure and is ignored.
  function pointOf(p, event) {
    const pressure = event.pointerType === 'pen' && brush.pressure !== 'off' ? clamp(event.pressure || 0, 0, 1) : 1;
    return {x: p.x, y: p.y,
      size: brush.pressure === 'size' && event.pointerType === 'pen' ? Math.max(1, Math.round(brush.size * pressure)) : brush.size,
      strength: brush.opacity * (brush.pressure === 'opacity' && event.pointerType === 'pen' ? pressure : 1)};
  }
  function snapshot(event) {
    return {clientX: event.clientX, clientY: event.clientY, button: event.button === 2 ? 2 : event.button === 1 ? 1 : 0, pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse', altKey: event.altKey, pressure: event.pressure};
  }
  function pickAt(p) {
    const colour = pick(surfaceOf(frameId()), p.x, p.y);
    if (!colour) return false;
    picker.set(colour);picker.refresh();
    message(`Took ${doc().format === 'field' ? `value ${decodeValue(colour[0]).toFixed(3)} (byte ${colour[0]})` : toHex(colour)}`);
    return true;
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
    if (!editable()) return false;
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return false;
    const t = tool(), id = frameId(), s = surfaceOf(id), edge = session.frame?.edge;
    const base = {pointerId: event.pointerId, pointerType: event.pointerType, id, edge, data: s.data, entries: []};
    if (event.altKey && t.paint) { pickAt(p);requestDraw();return false; }
    const erase = Boolean(t.erase) || event.button === 2;
    if (erase && t.noErase) return false;
    if (t.kind === 'action') return false;
    onInteract();
    const seed = brush.seed ?? Math.floor(Math.random() * 0x100000000);
    const modes = doc().format === 'field' ? {colour: brush.modes.colour} : brush.modes;
    const options = {colour: picker.colour, colour2: picker.colour2, modes, erase, size: brush.size, shape: brush.shape, opacity: brush.opacity,
      density: brush.density, type: typeOf(t)?.id ?? null};
    // One stroke per frame of the scope, each with its own copy of the frame
    // from before the stroke and its weight; they are recorded together.
    const strokes = () => targets().map((target, index) => {
      const surf = surfaceOf(target.id), stroke = createStroke(surf, {...options, weight: target.weight, seed: seed + index * 7919});
      return {id: target.id, data: surf.data, base: stroke.base, stroke};
    });
    if (t.kind === 'stroke') {
      const entries = strokes(), point = pointOf(p, event), stampFn = t.stamp ?? stamp;
      for (const entry of entries) {
        entry.stroke.gradient = {from: point, to: point};
        stampFn(entry.stroke, p.x, p.y, point.size, point.strength);
      }
      gesture = {...base, type: 'stroke', entries, base: entries[0].base, last: point, path: [point]};
    } else if (t.kind === 'drag') {
      const entries = strokes(), ends = shapeEnds({...p, pressed: true});
      for (const entry of entries) t.draw(entry.stroke, ends.from, ends.to);
      gesture = {...base, type: 'drag', entries, base: entries[0].base, ends, from: ends.from, to: ends.to};
      snapMark = ends.mark;
    } else if (t.kind === 'fill') {
      if (inside(s, p.x, p.y)) {
        editFrames(targets().map(target => target.id), (target, weight) => floodFill(target, p.x, p.y, {colour: options.colour, erase, opacity: brush.opacity * weight}) || undefined);
      }
      requestDraw();
      return false;
    } else if (t.kind === 'pick') {
      pickAt(p);
      gesture = {...base, type: 'pick'};
    } else if (t.kind === 'select') {
      const within = selection && p.x >= selection.x && p.y >= selection.y && p.x < selection.x + selection.w && p.y < selection.y + selection.h;
      const entry = {id, data: s.data, base: s.data.slice()};
      if (within) gesture = {...base, type: 'move', entries: [entry], base: entry.base, from: p, rect: {...selection}, shown: {...selection}};
      else gesture = {...base, type: 'marquee', from: p, rect: rectFrom(s, p, p), moved: false};
    } else if (t.kind === 'shift') {
      const entries = targets().map(target => { const data = doc().pixels.get(target.id);return {id: target.id, data, base: data.slice()}; });
      gesture = {...base, type: 'shift', entries, base: entries[0].base, from: p};
    }
    requestDraw();
    return Boolean(gesture);
  }
  function move(event) {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const events = event.getCoalescedEvents?.()?.length ? event.getCoalescedEvents() : [event];
    for (const item of events) {
      const p = locate(item);
      if (g.type === 'pan') {
        view = {...g.view, x: g.view.x + p.sx - g.origin.sx, y: g.view.y + p.sy - g.origin.sy};
        autoFit = false;
      } else if (g.type === 'stroke') {
        const point = pointOf(p, item);
        if (point.x !== g.last.x || point.y !== g.last.y) {
          g.path.push(point);
          if (alongMode()) g.replay = true;
          else for (const entry of g.entries) strokeLine(entry.stroke, g.last, point, tool().stamp ?? stamp);
        }
        g.last = point;
      } else if (g.type === 'drag') {
        g.ends = shapeEnds({...p, pressed: true}, g.ends);g.from = g.ends.from;g.to = g.ends.to;snapMark = g.ends.mark;
      } else if (g.type === 'pick') {
        pickAt(p);
      } else if (g.type === 'marquee') {
        g.moved ||= p.x !== g.from.x || p.y !== g.from.y;
        g.rect = rectFrom(surfaceOf(g.id), g.from, p);
      } else if (g.type === 'move' || g.type === 'shift') {
        g.delta = {x: p.x - g.from.x, y: p.y - g.from.y};
      }
      hover = {x: p.x, y: p.y};
    }
    // Shapes, moves and shifts are redrawn once per event from the copy taken at pointer down.
    if (g.type === 'stroke' && g.replay) replayStroke(g);
    else if (g.type === 'drag') for (const entry of g.entries) { resetStroke(entry.stroke);tool().draw(entry.stroke, g.from, g.to); }
    else if (g.type === 'move' && g.delta) {
      g.data.set(g.base);
      g.shown = moveRect(surfaceOf(g.id), g.rect, g.delta.x, g.delta.y) ?? {...g.rect, w: 0, h: 0};
    } else if (g.type === 'shift' && g.delta) {
      for (const entry of g.entries) if (doc().pixels.get(entry.id) === entry.data) shift(surfaceOf(entry.id), g.delta.x, g.delta.y, entry.base);
    }
    requestDraw();
  }
  // With 'along stroke' values the colour of every pixel depends on where the
  // stroke started and where the pointer is now, so the stroke is painted
  // again from the copy taken at pointer down on every move.
  const alongMode = () => (brush.modes.colour === 'along' || (brush.modes.alpha === 'along' && doc()?.format !== 'field'));
  function replayStroke(g) {
    g.replay = false;
    const stampFn = tool().stamp ?? stamp, first = g.path[0], last = g.path.at(-1);
    for (const entry of g.entries) {
      resetStroke(entry.stroke);
      entry.stroke.gradient = {from: first, to: last};
      stampFn(entry.stroke, first.x, first.y, first.size, first.strength);
      for (let index = 1; index < g.path.length; index++) strokeLine(entry.stroke, g.path[index - 1], g.path[index], stampFn);
    }
  }
  function finish(event) {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    move(event);
    gesture = null;
    release(g.pointerId);
    if (g.type === 'stroke' || g.type === 'drag' || g.type === 'shift') commitInPlace(g);
    else if (g.type === 'move') {
      commitInPlace(g);
      selection = g.shown && g.shown.w > 0 ? g.shown : null;
    } else if (g.type === 'marquee') selection = g.moved ? g.rect : null;
    else if (g.type === 'pick' && tool().kind === 'pick') setTool(previousTool);
    requestDraw();renderOptions();
  }
  // Drops the gesture and puts the frame back as it was at pointer down.
  function cancelGesture() {
    const g = gesture;
    if (!g) return false;
    gesture = null;
    release(g.pointerId);
    if (g.type === 'pan') view = g.view;
    else restoreInPlace(g);
    requestDraw();
    return true;
  }
  // Ends a stroke early, for example when undo is pressed while drawing, so
  // the stroke becomes its own undo step first.
  function commitGesture() {
    const g = gesture;
    if (!g) return;
    gesture = null;release(g.pointerId);
    if (['stroke', 'drag', 'shift', 'move'].includes(g.type)) commitInPlace(g);
    if (g.type === 'move') selection = g.shown && g.shown.w > 0 ? g.shown : null;
    requestDraw();
  }
  const capture = id => { try { display.setPointerCapture?.(id); } catch {} };
  const release = id => { try { if (display.hasPointerCapture?.(id)) display.releasePointerCapture(id); } catch {} };

  // Touch: one finger draws once it has moved 6 pixels, a second finger
  // cancels the stroke and pans (and pinches to zoom), and touches within
  // 800 ms of pen input are palm contacts and draw nothing.
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
  function beginTouchPan() {
    touch.mode = 'panning';
    Object.assign(touch, touchShape());
  }
  function cancelTouchForPen() {
    if (touch.mode === 'drawing' || gesture?.pointerType === 'touch') cancelGesture();
    resetTouch();
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
      beginTouchPan();
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
      // A fill is a tap; it waits for release so a second finger can still pan.
      if (touch.blockDrawing || distance < TOUCH_DRAW_THRESHOLD || tool().kind === 'fill') return;
      touch.mode = 'drawing';
      begin(touch.start);
      move(event);
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
    if (touch.mode === 'drawing') { finish(event);resetTouch(); }
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
    if (event.pointerType === 'pen') { penUntil = Date.now() + PEN_PALM_REJECTION_MS;cancelTouchForPen(); }
    if (event.pointerType === 'touch' && gesture && gesture.pointerType !== 'touch') { event.preventDefault();return; }
    if (event.pointerType !== 'touch' && touch.mode !== 'idle') { event.preventDefault();return; }
    // Focus moves to the canvas, so a colour typed into a field is committed
    // and the tool keys work at once.
    if (document.activeElement !== display) display.focus({preventScroll: true});
    if (event.pointerType === 'touch') { touchDown(event);return; }
    if (begin(snapshot(event))) { event.preventDefault();capture(event.pointerId); }
  });
  display.addEventListener('pointermove', event => {
    if (event.pointerType === 'pen' && (event.pointerId === gesture?.pointerId || event.buttons > 0 || event.pressure > 0)) penUntil = Date.now() + PEN_PALM_REJECTION_MS;
    if (event.pointerType === 'touch' && touch.mode !== 'idle') { touchMove(event);return; }
    if (gesture) { move(event);return; }
    const p = locate(event), ends = snapActive() ? shapeEnds(p) : null;
    hover = ends?.to ?? {x: p.x, y: p.y};
    snapMark = ends?.mark ?? null;
    showPosition(p);
    requestDraw();
  });
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
  display.addEventListener('pointerleave', () => { if (!gesture) { hover = null;snapMark = null;positionLine.textContent = '';requestDraw(); } });
  // Right-click erases, so the context menu never opens on the canvas.
  display.addEventListener('contextmenu', event => event.preventDefault());
  // Ctrl or Cmd with the wheel (and trackpad pinch, which arrives as a
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
  // Safari and the desktop app report a trackpad pinch as gesture events
  // instead of a Ctrl-wheel. A touch screen sends them for two fingers too,
  // which are handled through their pointers above, so they are left alone there.
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
    const s = surfaceOf(frameId());
    if (!s || !inside(s, p.x, p.y)) { positionLine.textContent = '';return; }
    const colour = pick(s, p.x, p.y);
    const value = s.format === 'field' ? `value ${decodeValue(colour[0]).toFixed(3)}` : s.format === 'matte' ? `grey ${colour[0]} alpha ${colour[3]}` : toHex(colour);
    positionLine.textContent = `${p.x}, ${p.y} · ${value}`;
  }

  // Toolbar and option events -----------------------------------------------------------

  parent.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.tool) setTool(button.dataset.tool);
    else if (button.dataset.transform) transform(button.dataset.transform);
    else if (button.dataset.guide) setGuides({[button.dataset.guide]: !guides[button.dataset.guide]});
    else if (button.dataset.shape) { brush.shape = button.dataset.shape;renderOptions();requestDraw(); }
    else if (button.matches('[data-copy]')) copySelection();
    else if (button.matches('[data-cut]')) cutSelection();
    else if (button.matches('[data-paste]')) pasteClipboard();
    else if (button.matches('[data-clear]')) clearSelection();
    else if (button.matches('[data-deselect]')) deselect();
    else if (button.matches('[data-tween-run]')) tween();
    // A stroke in progress is recorded first, so undo takes it back as a whole.
    else if (button.matches('[data-undo]')) { commitGesture();session.undo(); }
    else if (button.matches('[data-redo]')) { commitGesture();session.redo(); }
    else if (button.matches('[data-zoom-in]')) zoomStep(1);
    else if (button.matches('[data-zoom-out]')) zoomStep(-1);
    else if (button.matches('[data-canvas-fit]')) fit();
  });
  // A held − or + button sends input events; the grid follows them at once.
  // A half-typed number below the limit waits for the change event.
  parent.querySelector('.anim-guides').addEventListener('input', event => {
    const input = event.target, value = Number(input.value);
    if (input.matches('[data-grid-step]') && value >= GRID_STEP_MIN && value <= GRID_STEP_MAX) setGuides({gridW: value, gridH: value});
  });
  parent.querySelector('.anim-guides').addEventListener('change', event => {
    const input = event.target;
    if (input.matches('[data-grid-step]')) { setGuides({gridW: input.value, gridH: input.value});input.value = String(guides.gridW); }
  });
  $('[data-options]').addEventListener('input', event => {
    const input = event.target;
    if (input.matches('[data-size]')) { sizing = true;setBrushSize(sizeFromSlider(input.value)); }
    else if (input.matches('[data-opacity]')) { brush.opacity = clamp(Number(input.value) / 100, 0.01, 1);renderOptions(); }
    else if (input.matches('[data-density]')) { brush.density = clamp(Math.round(Number(input.value)) || brush.density, 1, 100);renderOptions(); }
  });
  // The slider's own arrow keys would move it a thousandth of the track;
  // they step the size by one pixel instead.
  $('[data-options]').addEventListener('keydown', event => {
    const step = event.target.matches?.('[data-size]') && {ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1}[event.key];
    if (!step) return;
    event.preventDefault();
    setBrushSize(brush.size + step);
  });
  // A thumb put back where it started sends no change event, so the end of
  // the press and the loss of focus also end the size preview.
  for (const type of ['pointerup', 'pointercancel', 'focusout']) $('[data-options]').addEventListener(type, () => { if (sizing) { sizing = false;requestDraw(); } });
  $('[data-options]').addEventListener('change', event => {
    const input = event.target;
    if (input.matches('[data-size]')) { sizing = false;requestDraw(); }
    else if (input.matches('[data-brush-type]')) { setBrushType(input.value);renderOptions();requestDraw(); }
    else if (input.matches('[data-tween-mode]')) { tweenMode = TWEEN_MODES.includes(input.value) ? input.value : 'dissolve'; }
  });

  function transform(kind) {
    if (!editable()) return;
    onInteract();
    editFrames(targets().map(target => target.id), s => {
      if (kind === 'flip-x') flip(s, 'x');
      else if (kind === 'flip-y') flip(s, 'y');
      else rotate(s);
      return true;
    });
    requestDraw();
  }
  // Fills the blank frames after the selected frame, up to the next drawn
  // frame of the edge, as one undo step.
  function tween() {
    const f = session.frame;
    if (!editable() || !f) return false;
    onInteract();
    try {
      const span = tweenSpan(doc(), f.edge, f.index);
      session.edit(d => tweenEdge(d, f.edge, f.index, tweenMode), {frames: span.ids, edge: f.edge});
      paintVersion++;
      message(`Tweened ${span.ids.length} frame${span.ids.length === 1 ? '' : 's'}`);
      requestDraw();
      return true;
    } catch (error) {
      message(error.message || String(error));
      return false;
    }
  }
  function copySelection() {
    const s = surfaceOf(frameId());
    if (!s || !selection) return false;
    clipboard = copyRect(s, selection);
    message(`Copied ${clipboard.width} × ${clipboard.height}`);
    renderOptions();
    return true;
  }
  function clearSelection() {
    if (!editable() || !selection) return false;
    onInteract();
    const area = selection;
    editFrame(frameId(), s => clearRect(s, area));
    requestDraw();
    return true;
  }
  function cutSelection() {
    if (!editable() || !copySelection()) return false;
    clearSelection();
    message(`Cut ${clipboard.width} × ${clipboard.height}`);
    return true;
  }
  // Pastes at the selection's corner, or the frame's top-left, and selects
  // the pasted pixels so they can be moved at once.
  function pasteClipboard() {
    if (!editable() || !clipboard) return false;
    onInteract();
    const x = selection?.x ?? 0, y = selection?.y ?? 0, clip = clipboard;
    let pasted = null;
    editFrame(frameId(), s => { pasted = paste(s, clip, x, y); });
    if (pasted) { selection = pasted;if (toolId !== 'select') setTool('select'); }
    message('Pasted');
    requestDraw();renderOptions();
    return true;
  }
  function deselect() {
    if (!selection) return false;
    selection = null;
    requestDraw();renderOptions();
    return true;
  }

  // Keys (6.9). Space pans while held and plays or pauses when tapped.
  const keyTools = Object.fromEntries(TOOLS.filter(t => t.key).map(t => [t.key.toLowerCase(), t.id]));
  function handleKey(event) {
    if (!doc() || event.defaultPrevented) return false;
    const target = event.target;
    if (target?.closest?.(TEXT_TARGETS)) return false;
    const key = event.key, lower = key.length === 1 ? key.toLowerCase() : key, command = event.metaKey || event.ctrlKey;
    if (command && !event.altKey) {
      // Undo while drawing first records the stroke, so it is undone as a whole.
      if (lower === 'z' || lower === 'y') { commitGesture();return false; }
      if (lower === 'c' && selection) { event.preventDefault();return copySelection(); }
      if (lower === 'x' && selection && editable()) { event.preventDefault();return cutSelection(); }
      if (lower === 'v' && clipboard && editable()) { event.preventDefault();return pasteClipboard(); }
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
      if (selection) { event.preventDefault();return deselect(); }
      return false;
    }
    if ((key === 'Delete' || key === 'Backspace') && selection && editable()) { event.preventDefault();return clearSelection(); }
    if (key === '+' || key === '=') { event.preventDefault();zoomStep(1);return true; }
    if (key === '-' || key === '_' || key === '−') { event.preventDefault();zoomStep(-1);return true; }
    if (event.shiftKey) return false;
    if (key === '[' || key === ']') { event.preventDefault();setBrushSize(brush.size + (key === ']' ? 1 : -1));return true; }
    if (keyTools[lower] && editable()) { event.preventDefault();setTool(keyTools[lower]);return true; }
    return false;
  }
  function onKeyUp(event) {
    if (event.key !== ' ' || !spaceHeld) return;
    spaceHeld = false;stage.classList.remove('panning');
    if (!spaceUsed) onTogglePlay();
  }
  window.addEventListener('keyup', onKeyUp);
  // Leaving the window while Space is down would otherwise keep it held.
  const onBlur = () => { spaceHeld = false;stage.classList.remove('panning'); };
  window.addEventListener('blur', onBlur);

  function update(event) {
    if (['open', 'close', 'reload'].includes(event.reason)) {
      cancelGesture();
      selection = null;autoFit = true;preview = null;message('');
    } else if (gesture && ['undo', 'redo'].includes(event.reason) && doc()?.pixels.get(gesture.id) !== gesture.data) {
      // The frame was replaced under the stroke.
      release(gesture.pointerId);
      gesture = null;
    } else if (gesture && (event.reason === 'select' || event.reason === 'frame') && frameId() !== gesture.id) {
      commitGesture();
    }
    if (selection && doc()) selection = clipRect(surfaceOf(frameId()) ?? {width: doc().width, height: doc().height}, selection);
    picker.update();
    renderChrome();
    syncView();
    requestDraw();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => requestDraw()) : null;
  observer?.observe(stage);
  // The checkerboard and grid colours come from the theme.
  const themeObserver = typeof MutationObserver === 'function' ? new MutationObserver(() => requestDraw()) : null;
  themeObserver?.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'style', 'class']});
  draw();

  return {
    update,
    handleKey,
    fit,
    get display() { return display; },
    // {x, y, k}: frame pixel (px, py) is drawn at (px * k + x, py * k + y) inside the canvas.
    get view() { syncView();return {...view}; },
    get tool() { return toolId; },
    get guides() { return {...guides}; },
    setGuides,
    setTool,
    get brush() { return {...brush, modes: {...brush.modes}, types: {...brush.types}}; },
    setBrush,
    // Which frames of the edge strokes, fills, shifts and flips change:
    // {kind: 'frame' | 'nearby' | 'edge', radius, fade}.
    get scope() { return {...scope}; },
    setScope,
    get tweenMode() { return tweenMode; },
    setTweenMode(mode) { if (TWEEN_MODES.includes(mode)) { tweenMode = mode;renderOptions(); } },
    tween,
    get colour() { return picker.colour; },
    setColour(colour) { picker.set(colour, 'first');picker.refresh(); },
    // The second colour of the value modes, noise and the gradient.
    get colour2() { return picker.colour2; },
    setColour2(colour) { picker.set(colour, 'second');picker.refresh(); },
    get selection() { return selection && {...selection}; },
    setSelection(rect) { selection = rect && doc() ? clipRect({width: doc().width, height: doc().height}, rect) : null;renderOptions();requestDraw(); },
    get clipboard() { return clipboard; },
    copy: copySelection,
    cut: cutSelection,
    paste: pasteClipboard,
    clear: clearSelection,
    transform,
    // Shows a frame read-only, without onion skin, for the playback preview
    // (6.7): a frame id, or `{frame}` where a frame of null shows the empty
    // output. `null` returns to the selected frame.
    setPreview(frame) {
      cancelGesture();
      preview = frame === null || frame === undefined ? null : typeof frame === 'object' ? {frame: frame.frame ?? null} : {frame};
      renderedOptions = '';
      draw();
    },
    get previewing() { return Boolean(preview); },
    // True while a gesture is changing pixels that are not recorded yet.
    get drawing() { return Boolean(gesture) && gesture.type !== 'pan' && gesture.type !== 'marquee' && gesture.type !== 'pick'; },
    // The frame id on show, or null for nothing or the empty output.
    get shownFrame() { return previewEmpty() ? null : frameId(); },
    draw,
    destroy() {
      destroyed = true;
      clearTimeout(drawFallback);
      observer?.disconnect();themeObserver?.disconnect();
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      cancelGesture();
      picker.destroy();
      parent.replaceChildren();
    },
  };
}
