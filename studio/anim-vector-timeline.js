// The keyframe timeline of the vector editor (docs/vector-animation-design.md,
// sections 4, 7 and 11): a time ruler over the active edge with the playhead,
// a row per shape with its keyframe times, which opens into a row per
// property, and playback of the edge alone, looping at real time. The
// playhead lives in the session (session.time), so the canvas and the shapes
// panel show and edit the shapes at the time it marks.
//
// A keyframe marker stands for the keyframes of its row at one time: on a
// shape's row that is every property keyed there, on a point's row its six
// tracks. Selecting, moving and deleting a marker acts on all of them, and
// its speed curve is edited below the rows (beside them on a wide screen).
//
// While the graph preview runs, the timeline shows the edge it plays at the
// time it has reached, read-only.

import {trackNames, pointOfTrack} from './anim-vector.js';
import {edgeById, nodeById, nodeLabel, isLoop, isVectorDocument, moveKeyframe, deleteKeyframe, setKeyframeCurve, snapTime, keyframeTime, KEYFRAME_STEPS_PER_SECOND} from './anim-model.js';
import {shapeName, propertyName} from './anim-vector-panel.js';
import {createCurveEditor} from './anim-vector-curve.js';
import {icon} from './icons.js';

const text = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const TEXT_TARGETS = 'input,textarea,select,[contenteditable],dialog';
const SAME_TIME = 1e-9;
const STEP = 1 / KEYFRAME_STEPS_PER_SECOND;
const DRAG_THRESHOLD = 3;
// Ruler steps in seconds; the ruler takes the first that gives at most ten marks.
const RULER_STEPS = [STEP, 1 / 30, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
const seconds = value => String(Math.round(value * 1000) / 1000);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sameTime = (a, b) => Math.abs(a - b) < SAME_TIME;

const defaultClock = () => ({
  now: () => globalThis.performance?.now?.() ?? Date.now(),
  frame: callback => (globalThis.requestAnimationFrame ?? (cb => setTimeout(() => cb(Date.now()), 16)))(callback),
  cancel: handle => (globalThis.cancelAnimationFrame ?? clearTimeout)(handle),
});

// The rows of a shape: its own row with every keyframe time, and while it is
// open one row per property, where the six tracks of a polygon point share a
// row. Row ids are `<shape>` and `<shape>:<property>` or `<shape>:point.<n>`.
export function shapeRows(shape, index, open) {
  const rows = [{id: String(index), shape: index, label: shapeName(shape), tracks: Object.keys(shape.tracks), own: true}];
  if (!open) return rows;
  const points = new Map();
  for (const name of trackNames(shape.kind, shape.kind === 'polygon' ? shape.points : 0)) {
    const point = pointOfTrack(name);
    if (!point) { rows.push({id: `${index}:${name}`, shape: index, label: propertyName(name), tracks: [name]});continue; }
    if (!points.has(point.index)) {
      const row = {id: `${index}:point.${point.index}`, shape: index, label: `Point ${point.index + 1}`, tracks: []};
      points.set(point.index, row);rows.push(row);
    }
    points.get(point.index).tracks.push(name);
  }
  return rows;
}

// The keyframe times of a row, in order, each once.
export function rowTimes(shape, tracks) {
  const times = [];
  for (const name of tracks) for (const keyframe of shape.tracks[name] ?? []) if (!times.some(t => sameTime(t, keyframe.t))) times.push(keyframe.t);
  return times.sort((a, b) => a - b);
}

// The keyframe times of an edge right before and right after `t`, over every
// track of every shape: {previous, next}, each a time or null.
export function ghostTimes(edge, t) {
  let previous = null, next = null;
  for (const shape of edge.shapes) for (const track of Object.values(shape.tracks)) for (const {t: at} of track) {
    if (at < t - SAME_TIME && (previous === null || at > previous)) previous = at;
    if (at > t + SAME_TIME && (next === null || at < next)) next = at;
  }
  return {previous, next};
}
const GHOST_ALPHA = 0.3;

// `onMessage(text)` shows why an edit was refused; `onGhostsChange()` runs
// when the keyframe ghosts are switched on or off, so the canvas redraws.
// `clock` is {now() in ms, frame(callback) -> handle, cancel(handle)}; tests
// pass one they control.
export function createVectorTimeline({parent, session, onMessage = () => {}, onGhostsChange = () => {}, clock = defaultClock()}) {
  parent.classList.add('anim-timeline-part', 'anim-vector-timeline');
  parent.innerHTML = `
    <div class="anim-timeline-bar" data-bar></div>
    <div class="anim-key-scroll" data-scroll tabindex="0" role="group" aria-label="Keyframes. Left and right move the playhead, Alt with them moves the selected keyframe, Delete removes it."></div>
    <section class="anim-key-curve" data-curve aria-label="Speed curve of the selected keyframe" hidden></section>
    <p class="anim-timeline-empty" data-empty hidden></p>`;
  const $ = selector => parent.querySelector(selector);
  const bar = $('[data-bar]'), scroll = $('[data-scroll]'), emptyLine = $('[data-empty]'), curveHost = $('[data-curve]');
  const curveEditor = createCurveEditor({parent: curveHost, onChange: curve => setCurve(curve), onClose: () => select(null)});

  // The open property rows and the selected marker belong to shape objects,
  // not to positions: edits change a shape in place and reordering moves the
  // same object, so both follow the shape. Undo and redo put a copy in place
  // of every shape; `follow` finds the copy of each.
  const open = new Set();
  const opened = (e, index) => open.has(e.shapes[index]);
  function setOpened(e, index, value) {
    if (value) open.add(e.shapes[index]);else open.delete(e.shapes[index]);
  }
  // The selected marker: {shape (object), part, time}, where `part` is what
  // follows the shape index in its row id ('' for the shape's own row).
  let selected = null;
  // The shapes of every edge as last seen, by edge id, for `follow`.
  let known = new Map();
  // Keyframe ghosts: an editor setting, kept while other animations open.
  let ghostsOn = false;
  // Playback: the frame handle, the edge and where the clock started.
  let playing = false, handle = null, playEdge = null, started = null;
  // While the graph preview runs, the timeline neither plays nor edits; it
  // shows `previewAt`, {edge, time}, the edge the preview plays (null while
  // it rests) and the time on it.
  let previewing = false, previewAt = null;
  let drag = null;

  const doc = () => session.doc && isVectorDocument(session.doc) ? session.doc : null;
  // The edge that edits go to: the session's active edge.
  const edge = () => doc() && session.edge !== null ? edgeById(doc(), session.edge) : null;
  // The edge on show: the preview's while one runs.
  const shownEdge = () => !previewing ? edge() : doc() && previewAt && previewAt.edge !== null ? edgeById(doc(), previewAt.edge) : null;
  const editable = () => Boolean(edge()) && !session.readOnly && !previewing;
  const playhead = () => previewing ? previewAt?.time ?? 0 : session.time ?? 0;
  const partOf = id => id.includes(':') ? id.slice(id.indexOf(':') + 1) : '';
  const rowId = (index, part) => part ? `${index}:${part}` : String(index);

  function edit(change, options) {
    try {
      const result = session.edit(change, options);
      onMessage('');
      return result;
    } catch (error) {
      onMessage(error.message || String(error));
      return undefined;
    }
  }

  // Rows and markers --------------------------------------------------------------------

  function rows(e = edge()) {
    if (!e) return [];
    return e.shapes.map((shape, index) => ({shape, index})).reverse().flatMap(({shape, index}) => shapeRows(shape, index, opened(e, index)));
  }
  function rowById(id, e = edge()) {
    const index = Number(id.split(':')[0]), shape = e?.shapes[index];
    if (!shape) return null;
    return shapeRows(shape, index, true).find(row => row.id === id) ?? null;
  }
  // The tracks of a row that have a keyframe at `t`, with its index in each.
  function keysAt(shape, row, t) {
    return row.tracks.map(name => ({name, index: shape.tracks[name].findIndex(keyframe => sameTime(keyframe.t, t))})).filter(entry => entry.index >= 0);
  }
  // The selected marker as {shape (index), row (id), time}, or null when it
  // no longer stands for a keyframe of the active edge.
  function validSelection() {
    const e = edge(), index = selected && e ? e.shapes.indexOf(selected.shape) : -1;
    const row = index >= 0 ? rowById(rowId(index, selected.part), e) : null;
    if (!row) return null;
    return keysAt(e.shapes[index], row, selected.time).length ? {shape: index, row: row.id, time: selected.time} : null;
  }
  // `next` is {shape (index), row (id), time} or null.
  function select(next, {seek = false} = {}) {
    const e = edge();
    selected = next && e?.shapes[next.shape] ? {shape: e.shapes[next.shape], part: partOf(next.row), time: next.time} : null;
    if (selected) session.selectShape(next.shape);
    if (selected && seek) session.setTime(next.time);
    render();
  }
  // Moves the selected marker's keyframes to `t`, snapped to 1/60 second.
  function moveSelected(t) {
    const e = edge(), current = validSelection();
    if (!editable() || !current) return false;
    const row = rowById(current.row, e), to = keyframeTime(e, t);
    if (sameTime(to, current.time)) return false;
    // The edit renders before it returns, and that render drops the marker,
    // which no longer has keyframes at its old time.
    const from = current.time, marker = selected;
    const done = edit(d => {
      const shape = edgeById(d, e.id).shapes[row.shape];
      for (const {name} of keysAt(shape, row, from)) {
        const index = shape.tracks[name].findIndex(keyframe => sameTime(keyframe.t, from));
        moveKeyframe(d, e.id, row.shape, name, index, to);
      }
      return true;
    });
    if (done === undefined) return false;
    selected = {...marker, time: to};
    render();
    return true;
  }
  // Sets the speed curve of the selected marker's keyframes, as one undo step.
  function setCurve(curve) {
    const e = edge(), current = validSelection();
    if (!editable() || !current) return false;
    const row = rowById(current.row, e);
    return edit(d => {
      const shape = edgeById(d, e.id).shapes[row.shape];
      for (const {name, index} of keysAt(shape, row, current.time)) setKeyframeCurve(d, e.id, row.shape, name, index, curve);
      return true;
    }) !== undefined;
  }

  // Keyframe ghosts ------------------------------------------------------------------------

  // The shapes of the active edge at its keyframe times right before and
  // right after the playhead, as the canvas takes them. None while the
  // preview runs.
  function ghosts() {
    const e = edge();
    if (!ghostsOn || previewing || !e) return [];
    const {previous, next} = ghostTimes(e, playhead());
    return [previous, next].filter(t => t !== null).map(time => ({edge: e.id, time, alpha: GHOST_ALPHA}));
  }
  function setGhosts(value) {
    ghostsOn = Boolean(value);
    renderBar();onGhostsChange();
  }

  // Following the shapes ------------------------------------------------------------------

  // After undo or redo the shapes are copies. Each shape that had
  // open rows or the selected marker is matched to a copy with the same
  // content, else to the copy at its old position.
  function follow() {
    const d = doc(), next = new Map();
    if (d) for (const e of d.edges) if (Array.isArray(e.shapes)) {
      next.set(e.id, e.shapes.slice());
      const before = known.get(e.id);
      if (!before) continue;
      const present = new Set(e.shapes);
      const lost = before.filter(shape => !present.has(shape) && (open.has(shape) || selected?.shape === shape));
      if (!lost.length) continue;
      const earlier = new Set(before), fresh = e.shapes.filter(shape => !earlier.has(shape));
      const content = new Map(fresh.map(shape => [shape, JSON.stringify(shape)])), taken = new Set(), matched = new Map();
      for (const shape of lost) {
        const json = JSON.stringify(shape), match = fresh.find(other => !taken.has(other) && content.get(other) === json);
        if (match) { taken.add(match);matched.set(shape, match); }
      }
      for (const shape of lost) {
        const at = e.shapes[before.indexOf(shape)];
        if (!matched.has(shape) && content.has(at) && !taken.has(at)) { taken.add(at);matched.set(shape, at); }
      }
      for (const [from, to] of matched) {
        if (open.delete(from)) open.add(to);
        if (selected?.shape === from) selected = {...selected, shape: to};
      }
    }
    known = next;
    // Rows of shapes that are gone stay closed.
    const all = new Set([...next.values()].flat());
    for (const shape of [...open]) if (!all.has(shape)) open.delete(shape);
  }
  // Removes the selected marker's keyframes. A property with no other
  // keyframe keeps its one.
  function deleteSelected() {
    const e = edge(), current = validSelection();
    if (!editable() || !current) return false;
    const row = rowById(current.row, e), shape = e.shapes[row.shape];
    const removable = keysAt(shape, row, current.time).filter(({name}) => shape.tracks[name].length > 1);
    if (!removable.length) { onMessage('A property keeps at least one keyframe');return false; }
    const done = edit(d => {
      const target = edgeById(d, e.id).shapes[row.shape];
      for (const {name} of removable) deleteKeyframe(d, e.id, row.shape, name, target.tracks[name].findIndex(keyframe => sameTime(keyframe.t, current.time)));
      return true;
    });
    if (done === undefined) return false;
    selected = null;
    render();
    return true;
  }
  // The previous or next keyframe time of the selected shape (all shapes
  // when none is selected), or null.
  function neighbourTime(direction) {
    const e = edge();
    if (!e) return null;
    const shapes = session.shape !== null ? [e.shapes[session.shape]] : e.shapes;
    const times = [...new Set(shapes.flatMap(shape => rowTimes(shape, Object.keys(shape.tracks))))].sort((a, b) => a - b);
    const now = playhead();
    return direction < 0 ? [...times].reverse().find(t => t < now - SAME_TIME) ?? null : times.find(t => t > now + SAME_TIME) ?? null;
  }

  // Playback of the edge alone -----------------------------------------------------------

  function play() {
    const e = edge();
    if (!e || playing || previewing) return;
    playing = true;playEdge = e.id;
    // From the end, playback starts over.
    started = {time: playhead() >= e.length - SAME_TIME ? 0 : playhead(), now: clock.now()};
    handle = clock.frame(step);
    renderBar();
  }
  function step() {
    handle = null;
    const e = edge();
    if (!playing) return;
    if (!e || e.id !== playEdge) { stop();return; }
    const elapsed = Math.max(0, (clock.now() - started.now) / 1000);
    session.setTime((started.time + elapsed) % e.length);
    if (playing) handle = clock.frame(step);
  }
  // Stopping leaves the playhead on the 1/60 s grid, so an edit there changes
  // the keyframe the panel shows.
  function stop() {
    if (!playing) return;
    playing = false;playEdge = null;started = null;
    if (handle !== null) clock.cancel(handle);
    handle = null;
    const e = edge();
    if (e) session.setTime(keyframeTime(e, playhead()));
    renderBar();
  }
  const togglePlay = () => playing ? stop() : play();

  // Rendering -----------------------------------------------------------------------------

  function edgeTitle(e) {
    const d = doc(), name = id => `<span class="anim-name">${text(nodeLabel(nodeById(d, id)))}</span>`;
    return isLoop(e) ? `loop on ${name(e.from)}` : `${name(e.from)} → ${name(e.to)}`;
  }
  function timeLabel(e, t = playhead()) {
    return `${t.toFixed(2)} s of ${seconds(e.length)} s`;
  }
  function renderBar() {
    const e = shownEdge();
    const focus = bar.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const ghostsButton = `<span class="anim-onion"><button class="anim-icon-button" data-key-ghosts data-focus="ghosts" aria-pressed="${ghostsOn}" aria-label="Keyframe ghosts" title="Keyframe ghosts: show the shapes faintly as they are at the previous and the next keyframe (O)">${icon('onion')}</button></span>`;
    if (!e) { bar.innerHTML = doc() ? `<h3 class="anim-timeline-title">Keyframes</h3>${ghostsButton}` : '';return; }
    const current = validSelection();
    const step = direction => !previewing && neighbourTime(direction) !== null;
    bar.innerHTML = `
      <h3 class="anim-timeline-title">${edgeTitle(e)}</h3>
      <span class="anim-transport">
        <button class="anim-step" data-key-previous data-focus="previous" aria-label="Previous keyframe" title="Go to the previous keyframe${session.shape !== null ? ' of the selected shape' : ''}" ${step(-1) ? '' : 'disabled'}>${icon('caret-left')}</button>
        <button class="anim-play" data-key-play data-focus="play" ${previewing ? 'disabled' : ''} aria-pressed="${playing}" aria-label="${playing ? 'Pause' : 'Play'} this edge" title="${playing ? 'Pause' : 'Play'} this edge, looping (Space)">${icon(playing ? 'pause' : 'play')}</button>
        <button class="anim-step" data-key-next data-focus="next" aria-label="Next keyframe" title="Go to the next keyframe${session.shape !== null ? ' of the selected shape' : ''}" ${step(1) ? '' : 'disabled'}>${icon('caret-right')}</button>
      </span>
      <span class="anim-frame-count" data-key-time>${timeLabel(e)}</span>
      <span class="anim-timeline-actions">
        <button class="anim-icon-button danger" data-key-delete data-focus="delete" aria-label="Delete keyframe" title="${current ? 'Delete the selected keyframe (Delete)' : 'Select a keyframe to delete it'}" ${current && editable() ? '' : 'disabled'}>${icon('trash')}</button>
      </span>
      ${ghostsButton}`;
    if (focus) bar.querySelector(`[data-focus="${focus}"]`)?.focus({preventScroll: true});
  }
  function ruler(e) {
    const stepSize = RULER_STEPS.find(size => e.length / size <= 10) ?? RULER_STEPS.at(-1), marks = [];
    for (let index = 0; index * stepSize <= e.length + SAME_TIME; index++) {
      const t = index * stepSize;
      // A label near the end of the edge stands left of its mark, so it stays in view.
      marks.push(`<span class="anim-key-mark${t > e.length * 0.9 && t > 0 ? ' end' : ''}" style="left: ${t / e.length * 100}%"><span>${seconds(t)}</span></span>`);
    }
    return marks.join('');
  }
  function markers(e, row) {
    const shape = e.shapes[row.shape], current = previewing ? null : validSelection();
    const dragged = drag?.dragging && drag.row === row.id ? drag : null;
    return rowTimes(shape, row.tracks).map(t => {
      const on = current?.row === row.id && sameTime(current.time, t), at = dragged && sameTime(dragged.time, t) ? dragged.to : t;
      return `<button class="anim-key${on ? ' selected' : ''}${dragged && sameTime(dragged.time, t) ? ' dragging' : ''}" data-key-row="${row.id}" data-key-time="${t}" style="left: ${at / e.length * 100}%" aria-pressed="${on}" aria-label="${text(row.label)} keyframe at ${seconds(t)} s" title="${text(row.label)} at ${seconds(t)} s"></button>`;
    }).join('');
  }
  function render() {
    const d = doc(), e = shownEdge();
    // The selection belongs to the active edge, which the preview leaves alone.
    if (!previewing && !validSelection()) selected = null;
    renderBar();
    renderCurve();
    if (!d || !e) {
      scroll.innerHTML = '';scroll.hidden = true;
      emptyLine.hidden = !d;
      emptyLine.textContent = previewing ? 'The preview rests at a state, so nothing is shown.'
        : d && d.edges.length ? 'Select an edge in the graph to see its keyframes.' : 'Shapes live on edges. Add states and an edge in the graph.';
      return;
    }
    scroll.hidden = false;
    const scrollTop = scroll.scrollTop, chosen = previewing ? null : session.shape;
    const list = rows(e);
    scroll.innerHTML = `
      <div class="anim-key-row anim-key-ruler"><span class="anim-key-label"></span><div class="anim-key-track"><div class="anim-key-lane" data-lane="ruler">${ruler(e)}<span class="anim-key-playhead"></span></div></div></div>
      ${list.map(row => `<div class="anim-key-row${row.own ? ' anim-key-shape' : ' anim-key-property'}${row.shape === chosen ? ' chosen' : ''}" data-row="${row.id}">
        <span class="anim-key-label">${row.own
          ? `<button class="anim-key-expand" data-key-expand="${row.shape}" aria-expanded="${opened(e, row.shape)}" aria-label="${opened(e, row.shape) ? 'Hide' : 'Show'} the properties of ${text(row.label)} ${row.shape + 1}" title="${opened(e, row.shape) ? 'Hide' : 'Show'} the properties">${icon('caret-right')}</button><button class="anim-key-name" data-key-shape="${row.shape}" title="Select this shape">${text(row.label)} <span class="anim-shape-number">${row.shape + 1}</span></button>`
          : `<span class="anim-key-property-name">${text(row.label)}</span>`}</span>
        <div class="anim-key-track"><div class="anim-key-lane" data-lane="${row.id}">${markers(e, row)}<span class="anim-key-playhead"></span></div></div>
      </div>`).join('')}`;
    scroll.scrollTop = scrollTop;
    // An edge without shapes shows the ruler alone; the shapes panel says how to add one.
    emptyLine.hidden = true;
    renderPlayhead();
  }
  // The playhead lines of every row follow one custom property, so moving the
  // playhead writes one style and one line of text.
  function renderPlayhead() {
    const e = shownEdge();
    if (!e) return;
    scroll.style.setProperty('--anim-playhead', String(clamp(playhead() / e.length, 0, 1)));
    const label = bar.querySelector('[data-key-time]');
    if (label && !drag?.dragging) label.textContent = timeLabel(e);
    if (playing || previewing) return;
    for (const [selector, direction] of [['[data-key-previous]', -1], ['[data-key-next]', 1]]) {
      const button = bar.querySelector(selector);
      if (button) button.disabled = neighbourTime(direction) === null;
    }
  }
  // The speed curve of the selected marker. Its keyframes may each have a
  // curve; the editor shows the first one that starts a move, and a change
  // sets all of them.
  function renderCurve() {
    const e = edge(), current = previewing ? null : validSelection();
    curveHost.hidden = !current;
    if (!current) return;
    const row = rowById(current.row, e), shape = e.shapes[row.shape], keys = keysAt(shape, row, current.time);
    const curveOf = ({name, index}) => shape.tracks[name][index].curve ?? null;
    const moving = keys.filter(({name, index}) => index < shape.tracks[name].length - 1);
    const curve = curveOf(moving[0] ?? keys[0]);
    const differ = keys.some(key => JSON.stringify(curveOf(key)) !== JSON.stringify(curve));
    const what = `${row.own ? `${row.label} ${row.shape + 1}` : row.label}${keys.length > 1 ? `, ${keys.length} properties,` : ''} from ${seconds(current.time)} s`;
    const note = !moving.length ? `${what}. No keyframe follows yet, so the curve has no effect.`
      : differ ? `${what}. Their curves differ; a change sets all of them.` : `${what} to the next keyframe.`;
    curveEditor.show({curve, enabled: editable(), note});
  }

  // Pointer input -----------------------------------------------------------------------------

  // The time under the pointer on a lane, snapped to 1/60 second.
  function timeAt(lane, clientX) {
    const e = edge(), rect = lane.getBoundingClientRect();
    if (!e || !(rect.width > 0)) return null;
    return keyframeTime(e, clamp((clientX - rect.left) / rect.width, 0, 1) * e.length);
  }
  scroll.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !edge() || previewing) return;
    const marker = event.target.closest('.anim-key[data-key-row]'), lane = event.target.closest('[data-lane]');
    if (marker) {
      const row = rowById(marker.dataset.keyRow), time = Number(marker.dataset.keyTime);
      if (!row) return;
      stop();
      selected = {shape: edge().shapes[row.shape], part: partOf(row.id), time};
      session.selectShape(row.shape);
      render();
      drag = {kind: 'key', pointerId: event.pointerId, row: row.id, time, to: time, x: event.clientX, dragging: false, lane: scroll.querySelector(`[data-lane="${row.id}"]`)};
    } else if (lane) {
      // A press on a lane or the ruler moves the playhead there, and on a
      // shape's row selects the shape.
      stop();
      const id = lane.dataset.lane, row = id === 'ruler' ? null : rowById(id);
      if (row) session.selectShape(row.shape);
      const t = timeAt(lane, event.clientX);
      if (t !== null) session.setTime(t);
      drag = {kind: 'scrub', pointerId: event.pointerId, lane};
    } else return;
    event.preventDefault();
    document.addEventListener('pointermove', dragMove);
    document.addEventListener('pointerup', dragEnd);
    document.addEventListener('pointercancel', dragEnd);
  });
  function dragMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.kind === 'scrub') {
      const t = timeAt(drag.lane, event.clientX);
      if (t !== null) session.setTime(t);
      return;
    }
    if (!drag.dragging && Math.abs(event.clientX - drag.x) < DRAG_THRESHOLD) return;
    if (!editable()) return;
    drag.dragging = true;
    const e = edge(), rect = drag.lane?.getBoundingClientRect();
    if (!e || !(rect?.width > 0)) return;
    drag.to = keyframeTime(e, drag.time + (event.clientX - drag.x) / rect.width * e.length);
    const marker = scroll.querySelector(`.anim-key.dragging`) ?? [...scroll.querySelectorAll('.anim-key')].find(item => item.dataset.keyRow === drag.row && sameTime(Number(item.dataset.keyTime), drag.time));
    if (marker) { marker.classList.add('dragging');marker.style.left = drag.to / e.length * 100 + '%'; }
    const label = bar.querySelector('[data-key-time]');
    if (label) label.textContent = `${drag.to.toFixed(2)} s`;
  }
  function dragEnd(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const ended = drag;
    drag = null;
    document.removeEventListener('pointermove', dragMove);
    document.removeEventListener('pointerup', dragEnd);
    document.removeEventListener('pointercancel', dragEnd);
    if (ended.kind !== 'key') return;
    if (ended.dragging && event.type === 'pointerup') { if (!moveSelected(ended.to)) render(); }
    else if (!ended.dragging && event.type === 'pointerup') session.setTime(ended.time);
    else render();
  }
  bar.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.matches('[data-key-play]')) togglePlay();
    else if (button.matches('[data-key-previous],[data-key-next]')) {
      stop();
      const t = neighbourTime(button.matches('[data-key-next]') ? 1 : -1);
      if (t !== null) session.setTime(t);
    } else if (button.matches('[data-key-delete]')) deleteSelected();
    else if (button.matches('[data-key-ghosts]')) setGhosts(!ghostsOn);
  });
  // Rows open and close during the preview too; selecting waits until it ends.
  scroll.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const e = shownEdge();
    if (button.matches('[data-key-expand]')) {
      const index = Number(button.dataset.keyExpand);
      if (!e?.shapes[index]) return;
      setOpened(e, index, !opened(e, index));
      render();
    } else if (button.matches('[data-key-shape]') && !previewing) session.selectShape(Number(button.dataset.keyShape));
  });
  scroll.addEventListener('keydown', event => {
    const e = edge();
    if (!e || previewing || event.metaKey || event.ctrlKey) return;
    const direction = {ArrowLeft: -1, ArrowRight: 1}[event.key];
    const handled = () => { event.preventDefault();event.stopPropagation(); };
    if (direction && event.altKey) {
      handled();
      const current = validSelection();
      if (current) moveSelected(current.time + direction * STEP * (event.shiftKey ? 10 : 1));
    } else if (direction) {
      handled();stop();
      session.setTime(keyframeTime(e, playhead() + direction * STEP * (event.shiftKey ? 10 : 1)));
    } else if (event.key === 'Home' || event.key === 'End') { handled();stop();session.setTime(event.key === 'Home' ? 0 : e.length); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && validSelection()) { handled();deleteSelected(); }
  });

  // , and . step the playhead by 1/60 second wherever focus is outside text;
  // O switches the keyframe ghosts, as it does the pixel editor's onion skin.
  function handleKey(event) {
    if (!doc() || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.target?.closest?.(TEXT_TARGETS)) return false;
    if (event.key.toLowerCase() === 'o') { event.preventDefault();setGhosts(!ghostsOn);return true; }
    if ((event.key === ',' || event.key === '.') && edge() && !previewing) {
      event.preventDefault();stop();
      session.setTime(keyframeTime(edge(), snapTime(playhead()) + (event.key === '.' ? STEP : -STEP)));
      return true;
    }
    return false;
  }

  function update(event) {
    if (['open', 'close', 'reload'].includes(event.reason)) { stop();selected = null;open.clear();known = new Map();drag = null; }
    // The sliders change what the canvas draws, not the keyframes.
    if (event.reason === 'parameters') return;
    if (playing && edge()?.id !== playEdge) stop();
    if (event.reason === 'time') { renderPlayhead();return; }
    follow();
    if (event.reason === 'shape' && drag?.kind === 'key') return;
    render();
  }
  render();

  return {
    update,
    handleKey,
    play,
    stop,
    togglePlay,
    get playing() { return playing; },
    // The graph preview starts (true), reports what it plays ({edge, time},
    // with edge null while it rests) or ends (false).
    setPreview(value) {
      const at = value && typeof value === 'object' ? {edge: value.edge ?? null, time: value.time ?? null} : null;
      if (previewing && value && at) {
        const sameEdge = previewAt?.edge === at.edge;
        previewAt = at;
        if (sameEdge) renderPlayhead();else render();
        return;
      }
      previewing = Boolean(value);previewAt = at;
      if (previewing) stop();
      render();
    },
    // The keyframe ghosts for the canvas: [{edge, time, alpha}].
    ghosts,
    get ghostsOn() { return ghostsOn; },
    setGhosts,
    // Sets the speed curve of the selected keyframes: four numbers or null.
    setCurve,
    get curveEditor() { return curveEditor; },
    // The selected marker, {shape, row, tracks, time}, or null. `row` is a
    // row id of shapeRows; `tracks` are the track names it stands for.
    get selectedKeyframe() {
      const current = validSelection(), row = current && rowById(current.row);
      return current && row ? {...current, tracks: row.tracks.slice()} : null;
    },
    selectKeyframe(value, options) { select(value ? {shape: value.shape, row: value.row ?? String(value.shape), time: value.time} : null, options); },
    moveKeyframe: moveSelected,
    deleteKeyframe: deleteSelected,
    // Opens or closes the property rows of shape `index`.
    setOpen(index, value) {
      const e = edge();
      if (!e?.shapes[index]) return;
      setOpened(e, index, Boolean(value));
      render();
    },
    // The property rows open, by shape index on the active edge.
    get openRows() { const e = edge();return e ? e.shapes.map((shape, index) => open.has(shape) ? index : -1).filter(index => index >= 0) : []; },
    // Where the speed curve of the selected keyframe is edited, below or beside the rows.
    get curveHost() { return curveHost; },
    destroy() {
      playing = false;
      if (handle !== null) clock.cancel(handle);
      curveEditor.destroy();
      document.removeEventListener('pointermove', dragMove);
      document.removeEventListener('pointerup', dragEnd);
      document.removeEventListener('pointercancel', dragEnd);
      parent.replaceChildren();
    },
  };
}
