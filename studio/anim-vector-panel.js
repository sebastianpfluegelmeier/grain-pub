// The shapes panel of the vector canvas (docs/vector-animation-design.md,
// sections 3, 4 and 7): the shapes of the active edge, front to back, with
// the drawing order, duplicate, copy, paste and delete; and the properties of
// the selected shape at the playhead. Edits use setPropertyAt, so they follow
// the keyframe rule of section 11; the Keyframe button keyframes every
// property of the shape at the playhead. Below them, the parameters and the
// selected shape's assignments (anim-vector-parameters.js).

import {sampleTrack, formatColor, pointOfTrack} from './anim-vector.js';
import {edgeById, isVectorDocument, setPropertyAt, setKeyframe, deleteKeyframe, keyframeShapeAt, keyframeTime, deleteShape, duplicateShape,
  moveShape, copyShapes, pasteShapes} from './anim-model.js';
import {createColourPicker} from './anim-colour.js';
import {createParameterPanel} from './anim-vector-parameters.js';
import {icon} from './icons.js';

const text = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
const shortcut = key => (isMac ? '⌘' : 'Ctrl+') + key;
const TEXT_TARGETS = 'input,textarea,select,[contenteditable],dialog';
const SAME_TIME = 1e-9;
// Field values are shown to hundredths.
const shown = value => String(Math.round(value * 100) / 100 || 0);

export const SHAPE_NAMES = Object.freeze({rectangle: 'Rectangle', oval: 'Oval', polygon: 'Polygon'});
export const shapeName = shape => SHAPE_NAMES[shape.kind] ?? shape.kind;
const PROPERTY_NAMES = {x: 'X', y: 'Y', width: 'Width', height: 'Height', rotation: 'Rotation', outline_thickness: 'Outline thickness',
  outline_color: 'Outline colour', outline_opacity: 'Outline opacity', fill_color: 'Fill colour', fill_opacity: 'Fill opacity'};
const POINT_PARTS = {'x': 'x', 'y': 'y', 'in.x': 'handle in x', 'in.y': 'handle in y', 'out.x': 'handle out x', 'out.y': 'handle out y'};
// The name of a property for people: "Fill opacity", "Point 2 handle in x".
export function propertyName(track) {
  const point = pointOfTrack(track);
  return point ? `Point ${point.index + 1} ${POINT_PARTS[point.part]}` : PROPERTY_NAMES[track] ?? track;
}

// The number fields, in order, by group. `scale` turns the stored value into
// the shown one: opacity is shown in percent.
const GEOMETRY = [
  {track: 'x', label: 'X', step: 1},
  {track: 'y', label: 'Y', step: 1},
  {track: 'width', label: 'Width', step: 1, min: 0, box: true},
  {track: 'height', label: 'Height', step: 1, min: 0, box: true},
  {track: 'rotation', label: 'Rotation', unit: '°', step: 1},
];
const OUTLINE = [
  {track: 'outline_thickness', label: 'Thickness', step: 0.5, min: 0},
  {track: 'outline_opacity', label: 'Opacity', unit: '%', step: 1, min: 0, max: 100, scale: 100},
  {track: 'outline_color', label: 'Colour', colour: 'second'},
];
const FILL = [
  {track: 'fill_opacity', label: 'Opacity', unit: '%', step: 1, min: 0, max: 100, scale: 100},
  {track: 'fill_color', label: 'Colour', colour: 'first'},
];
const FIELDS = [...GEOMETRY, ...OUTLINE, ...FILL];

// `onInteract()` runs before the panel changes the document (the keyframe
// timeline stops playing); `onMessage(text)` shows why an edit was refused.
export function createVectorPanel({parent, session, onInteract = () => {}, onMessage = () => {}}) {
  parent.classList.add('anim-vector-panel');
  parent.innerHTML = `
    <section class="anim-vector-section" aria-label="Shapes" data-shapes hidden>
      <h3>Shapes</h3>
      <div class="anim-vector-actions" role="toolbar" aria-label="Shape actions">
        <button class="anim-icon-button" data-shape-forward aria-label="Move forward" title="Move the shape forward, over the next one (${shortcut(']')})">${icon('move-up')}</button>
        <button class="anim-icon-button" data-shape-backward aria-label="Move backward" title="Move the shape backward, under the one before (${shortcut('[')})">${icon('move-down')}</button>
        <button class="anim-icon-button" data-shape-duplicate aria-label="Duplicate shape" title="Duplicate the shape with its keyframes">${icon('copy')}</button>
        <button class="anim-icon-button" data-shape-copy aria-label="Copy shape" title="Copy the shape, to paste it on this or another edge">${icon('copy-frames')}</button>
        <button class="anim-icon-button" data-shape-paste aria-label="Paste shape" title="Paste the copied shape on top of this edge">${icon('paste-frames')}</button>
        <button class="anim-icon-button danger" data-shape-delete aria-label="Delete shape" title="Delete the shape (Delete)">${icon('trash')}</button>
      </div>
      <ul class="anim-shape-list" role="listbox" aria-label="Shapes, front to back" data-shape-list></ul>
      <p class="anim-vector-note" data-shapes-empty hidden></p>
    </section>
    <section class="anim-vector-section anim-vector-properties" aria-label="Selected shape" data-properties hidden>
      <div class="anim-vector-head"><h3 data-shape-heading></h3>
        <button class="anim-vector-keyframe" data-keyframe-shape title="Add a keyframe at the playhead to every property of this shape">${icon('keyframe')}<span>Keyframe</span></button></div>
      <div class="anim-property-group" data-fields="geometry"></div>
      <h4>Outline</h4>
      <div class="anim-property-group" data-fields="outline"></div>
      <h4>Fill</h4>
      <div class="anim-property-group" data-fields="fill"></div>
      <div class="anim-vector-colour" data-shape-colour></div>
      <div class="anim-assignments" data-assignments></div>
    </section>
    <section class="anim-vector-section anim-parameters" aria-label="Parameters" data-parameters hidden></section>`;
  const $ = selector => parent.querySelector(selector);
  const list = $('[data-shape-list]'), properties = $('[data-properties]');
  // While the graph preview runs only the parameter sliders are shown.
  let previewing = false;

  // The copied shapes, kept across edges and animations, so they can be
  // pasted on another edge or into another vector animation.
  let clip = null;
  // A drag in the colour controls is one undo step: its edits share a key.
  let colourDrag = null, drags = 0;
  let builtKind = null;

  const doc = () => session.doc && isVectorDocument(session.doc) ? session.doc : null;
  const edge = () => doc() && session.edge !== null ? edgeById(doc(), session.edge) : null;
  const shape = () => { const e = edge(), index = session.shape;return e && index !== null ? e.shapes[index] ?? null : null; };
  const editable = () => Boolean(edge()) && !session.readOnly;
  const playhead = () => session.time ?? 0;

  function edit(change, options) {
    try {
      onInteract();
      const result = session.edit(change, options);
      onMessage('');
      return result;
    } catch (error) {
      onMessage(error.message || String(error));
      return undefined;
    }
  }

  const colour = createColourPicker({parent: $('[data-shape-colour]'), session, alpha: false,
    slots: {first: {label: 'Fill colour', title: 'Fill colour'}, second: {label: 'Outline colour', title: 'Outline colour'}},
    onChange: (value, which) => setColours(value, which), onMessage});
  const parameters = createParameterPanel({parameters: $('[data-parameters]'), assignments: $('[data-assignments]'), session, propertyName, onInteract, onMessage});

  // Shapes -----------------------------------------------------------------------------

  function forward(step) {
    const e = edge(), index = session.shape;
    if (!editable() || index === null) return;
    const to = index + step;
    if (to < 0 || to >= e.shapes.length) return;
    edit(d => moveShape(d, e.id, index, to), {shape: to});
  }
  function duplicate() {
    const e = edge(), index = session.shape;
    if (!editable() || index === null) return;
    edit(d => duplicateShape(d, e.id, index), {shape: result => result.index});
  }
  function remove() {
    const e = edge(), index = session.shape;
    if (!editable() || index === null) return false;
    return edit(d => deleteShape(d, e.id, index), {shape: e.shapes.length > 1 ? Math.max(0, index - 1) : null}) !== undefined;
  }
  function copy() {
    const e = edge(), index = session.shape;
    if (!e || index === null) return false;
    clip = copyShapes(doc(), e.id, [index]);
    render();
    return true;
  }
  function paste() {
    const e = edge();
    if (!editable() || !clip) return false;
    const pasted = clip;
    return edit(d => pasteShapes(d, e.id, pasted), {shape: indices => indices.at(-1)}) !== undefined;
  }
  function keyframeShape() {
    const e = edge(), index = session.shape;
    if (!editable() || index === null) return;
    edit(d => keyframeShapeAt(d, e.id, index, playhead()));
  }

  // Properties ------------------------------------------------------------------------------

  // The keyframe of `track` that an edit at the playhead would change, or -1.
  function keyAt(track) {
    const e = edge(), t = keyframeTime(e, playhead());
    return track.findIndex(keyframe => Math.abs(keyframe.t - t) < SAME_TIME);
  }
  function setProperty(track, value) {
    const e = edge(), index = session.shape;
    if (!editable() || index === null) return undefined;
    return edit(d => setPropertyAt(d, e.id, index, track, playhead(), value), colourDrag ? {merge: colourDrag} : undefined);
  }
  // Adds a keyframe holding the current value, or removes the keyframe at
  // the playhead; every property keeps at least one.
  function toggleKey(name) {
    const e = edge(), index = session.shape, s = shape();
    if (!editable() || !s) return;
    const track = s.tracks[name], at = keyAt(track);
    if (at >= 0) { edit(d => deleteKeyframe(d, e.id, index, name, at));return; }
    const value = sampleTrack(track, playhead());
    edit(d => setKeyframe(d, e.id, index, name, playhead(), Array.isArray(value) ? formatColor(value) : value));
  }
  function setColours(value, which) {
    const s = shape();
    if (!s || !editable()) return;
    const hex = formatColor(value.slice(0, 3));
    const changes = [];
    if (which === 'first' || which === 'both') changes.push(['fill_color', which === 'both' ? formatColor(colour.colour.slice(0, 3)) : hex]);
    if (which === 'second' || which === 'both') changes.push(['outline_color', formatColor(colour.colour2.slice(0, 3))]);
    const e = edge(), index = session.shape, t = playhead();
    const needed = changes.filter(([name, next]) => formatColor(sampleTrack(s.tracks[name], t)) !== next);
    if (!needed.length) return;
    edit(d => { for (const [name, next] of needed) setPropertyAt(d, e.id, index, name, t, next); }, colourDrag ? {merge: colourDrag} : undefined);
  }

  // Rendering -------------------------------------------------------------------------------

  function fieldMarkup(field) {
    const key = `<button class="anim-key-toggle" data-key-toggle="${field.track}" aria-pressed="false" aria-label="${text(propertyName(field.track))} keyframe" title=""></button>`;
    if (field.colour) return `<div class="anim-property anim-property-colour" data-row="${field.track}"><span class="anim-property-name">${field.label}</span>${key}<button class="anim-property-chip anim-checker" data-colour-slot="${field.colour}" aria-label="Edit the ${field.track === 'fill_color' ? 'fill' : 'outline'} colour"><span></span></button></div>`;
    const limits = `${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''}`;
    return `<div class="anim-property" data-row="${field.track}"><span class="anim-property-name">${field.label}${field.unit ? ` <span class="anim-property-unit">${field.unit}</span>` : ''}</span>${key}<input type="number" data-property="${field.track}" step="${field.step}" ${limits} aria-label="${text(propertyName(field.track))}${field.unit === '%' ? ' in percent' : field.unit === '°' ? ' in degrees' : ''}"></div>`;
  }
  // The fields are built once per kind of shape and then only refilled, so a
  // field keeps its focus and its − and + buttons while values change.
  function build(kind) {
    builtKind = kind;
    $('[data-fields="geometry"]').innerHTML = GEOMETRY.filter(field => !field.box || kind !== 'polygon').map(fieldMarkup).join('');
    $('[data-fields="outline"]').innerHTML = OUTLINE.map(fieldMarkup).join('');
    $('[data-fields="fill"]').innerHTML = FILL.map(fieldMarkup).join('');
  }
  function renderList() {
    const e = edge(), focused = list.contains(document.activeElement) ? document.activeElement.dataset.shapeIndex : null;
    const empty = $('[data-shapes-empty]');
    // Without an active edge there are no shapes to act on; the stage says how to pick one.
    $('[data-shapes]').hidden = !e;
    if (!e) { list.innerHTML = '';empty.hidden = true;return; }
    const selected = session.shape;
    const items = e.shapes.map((item, index) => ({item, index})).reverse();
    list.innerHTML = items.map(({item, index}) => `<li role="option" aria-selected="${index === selected}">
      <button class="anim-shape-item" data-shape-index="${index}" title="Select this shape">${icon(item.kind)}<span class="anim-shape-name">${shapeName(item)}${item.kind === 'polygon' ? `<span class="anim-shape-detail">, ${item.points} points</span>` : ''}</span><span class="anim-shape-number">${index + 1}</span></button>
    </li>`).join('');
    empty.hidden = e.shapes.length > 0;
    if (!e.shapes.length) empty.textContent = 'No shapes on this edge yet. Draw one with the rectangle, oval or polygon tool.';
    if (focused !== null) list.querySelector(`[data-shape-index="${focused}"]`)?.focus({preventScroll: true});
    const index = selected, count = e.shapes.length, can = editable() && index !== null;
    $('[data-shape-forward]').disabled = !can || index >= count - 1;
    $('[data-shape-backward]').disabled = !can || index <= 0;
    $('[data-shape-duplicate]').disabled = !can;
    $('[data-shape-copy]').disabled = index === null;
    $('[data-shape-delete]').disabled = !can;
    const paste = $('[data-shape-paste]');
    paste.disabled = !editable() || !clip;
    paste.title = clip ? 'Paste the copied shape on top of this edge' : 'Paste: nothing copied yet';
  }
  function renderProperties() {
    const s = shape();
    properties.hidden = !s;
    if (!s) return;
    if (builtKind !== s.kind) build(s.kind);
    $('[data-shape-heading]').textContent = `${shapeName(s)} ${session.shape + 1}`;
    $('[data-keyframe-shape]').disabled = !editable();
    renderValues();
  }
  // Writes the values at the playhead into the fields, leaving the field
  // being typed in alone.
  function renderValues() {
    const s = shape();
    if (!s) return;
    const t = playhead(), active = document.activeElement;
    for (const field of FIELDS) {
      const track = s.tracks[field.track];
      if (!track) continue;
      const row = properties.querySelector(`[data-row="${field.track}"]`);
      if (!row) continue;
      const at = keyAt(track), animated = track.length > 1;
      const toggle = row.querySelector('[data-key-toggle]');
      toggle.dataset.state = at >= 0 ? 'key' : animated ? 'animated' : 'still';
      toggle.setAttribute('aria-pressed', String(at >= 0));
      toggle.disabled = !editable() || (at >= 0 && track.length === 1);
      toggle.title = at >= 0 ? (track.length === 1 ? 'The only keyframe of this property' : 'Remove the keyframe at the playhead')
        : animated ? 'Changes between keyframes. Add a keyframe at the playhead' : 'Add a keyframe at the playhead, so this property can change over time';
      if (field.colour) {
        row.querySelector('[data-colour-slot] span').style.background = formatColor(sampleTrack(track, t));
        continue;
      }
      const input = row.querySelector('input');
      input.disabled = !editable();
      if (input !== active) input.value = shown(sampleTrack(track, t) * (field.scale ?? 1));
    }
    // The colour controls follow the shape, unless they already show its
    // colours, so a colour being dragged keeps its hue and marker.
    const fill = [...sampleTrack(s.tracks.fill_color, t).map(Math.round), 255], outline = [...sampleTrack(s.tracks.outline_color, t).map(Math.round), 255];
    const same = (a, b) => a.every((value, index) => value === b[index]);
    if (!same(colour.colour, fill) || !same(colour.colour2, outline)) colour.load({first: fill, second: outline});
  }
  function render() {
    renderList();
    renderProperties();
    // The swatches follow the palette and the read-only state.
    if (shape()) colour.update();
  }

  // Events -------------------------------------------------------------------------------------

  parent.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled || button.closest('[data-shape-colour]')) return;
    if (button.matches('[data-shape-index]')) session.selectShape(Number(button.dataset.shapeIndex));
    else if (button.matches('[data-shape-forward]')) forward(1);
    else if (button.matches('[data-shape-backward]')) forward(-1);
    else if (button.matches('[data-shape-duplicate]')) duplicate();
    else if (button.matches('[data-shape-copy]')) copy();
    else if (button.matches('[data-shape-paste]')) paste();
    else if (button.matches('[data-shape-delete]')) remove();
    else if (button.matches('[data-keyframe-shape]')) keyframeShape();
    else if (button.matches('[data-key-toggle]')) toggleKey(button.dataset.keyToggle);
    else if (button.matches('[data-colour-slot]')) colour.select(button.dataset.colourSlot);
  });
  // A number is applied when the field reports a change: when it is left,
  // on Enter, or when a held − or + button is let go.
  properties.addEventListener('change', event => {
    const input = event.target;
    if (!input.matches?.('[data-property]')) return;
    const field = FIELDS.find(item => item.track === input.dataset.property), value = Number(input.value);
    if (input.value === '' || !Number.isFinite(value) || setProperty(field.track, value / (field.scale ?? 1)) === undefined) renderValues();
  });
  properties.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches?.('[data-property]')) { event.preventDefault();event.target.dispatchEvent(new Event('change', {bubbles: true})); }
  });
  // Seen before the colour controls' own listeners, so their first edit
  // already carries the key. A press anywhere else ends the drag too.
  parent.addEventListener('pointerdown', event => { colourDrag = event.target.closest?.('[data-shape-colour]') ? `colour:${++drags}` : null; }, true);
  // The pointerup of a drag that ends outside the window may never arrive;
  // the browser then cancels the pointer or takes its capture away, and the
  // next colour edit must not join the drag's undo step.
  const endColourDrag = () => { colourDrag = null; };
  for (const type of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(type, endColourDrag);
  for (const type of ['pointercancel', 'lostpointercapture']) parent.addEventListener(type, endColourDrag, true);

  // Keys: Delete removes the selected shape, Cmd or Ctrl with C, V and D
  // copies, pastes and duplicates it, with ] and [ it moves forward and back.
  function handleKey(event) {
    if (!doc() || event.defaultPrevented || event.altKey) return false;
    if (event.target?.closest?.(TEXT_TARGETS)) return false;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key, command = event.metaKey || event.ctrlKey;
    const has = session.shape !== null;
    if (!command && (key === 'Delete' || key === 'Backspace') && has && editable()) { event.preventDefault();return remove(); }
    if (!command) return false;
    if (key === 'c' && has) { event.preventDefault();return copy(); }
    if (key === 'v' && clip && editable()) { event.preventDefault();return paste(); }
    if (key === 'd' && has && editable()) { event.preventDefault();duplicate();return true; }
    if ((key === ']' || key === '[') && has && editable()) { event.preventDefault();forward(key === ']' ? 1 : -1);return true; }
    return false;
  }

  function update(event) {
    parameters.update(event);
    if (!doc()) { list.innerHTML = '';properties.hidden = true;$('[data-shapes]').hidden = true;return; }
    // The playhead moves on every frame while an edge plays: only the values change.
    if (event.reason === 'time') { renderValues();return; }
    if (event.reason === 'parameters') return;
    render();
  }
  render();

  return {
    update,
    handleKey,
    // The graph preview starts (true) or ends (false). It hides the shapes
    // and their properties and keeps the parameter sliders.
    setPreview(value) {
      if (previewing === Boolean(value)) return;
      previewing = Boolean(value);
      parent.classList.toggle('previewing', previewing);
      parameters.setPreview(previewing);
    },
    get previewing() { return previewing; },
    // The parameter list and the selected shape's assignments.
    get parameters() { return parameters; },
    // The copied shapes as a clip of anim-model.js, or null.
    get clipboard() { return clip; },
    copy,
    paste,
    duplicate,
    remove,
    forward: () => forward(1),
    backward: () => forward(-1),
    keyframe: keyframeShape,
    toggleKey,
    // Where the parameters and their assignments go, below the properties.
    get parametersHost() { return $('[data-parameters]'); },
    get colour() { return colour; },
    destroy() {
      for (const type of ['pointerup', 'pointercancel', 'blur']) window.removeEventListener(type, endColourDrag);
      for (const type of ['pointercancel', 'lostpointercapture']) parent.removeEventListener(type, endColourDrag, true);
      colour.destroy();parameters.destroy();
      parent.replaceChildren();
    },
  };
}
