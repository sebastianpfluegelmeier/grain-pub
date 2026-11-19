// The animation document and its edits (docs/animation-graph-plan.md 6.2,
// and docs/vector-animation-design.md for vector animations). Every edit is a
// plain function on the in-memory document from anim-format.js, so it can be
// tested without a DOM. The view records edits in a history created here,
// which stores metadata before and after plus copies of only the frames an
// edit touched (6.8).

import {FORMAT_BYTES, MAX_SIDE, MAX_NODES, MAX_EDGES, MAX_NODE_ID, MAX_FRAMES, MAX_PIXEL_BYTES, MAX_EDGE_FRAMES, validNodeName} from './anim-format.js';
import {buildGraph, distance} from './anim-machine.js';
import {isBlank, tweenFrame} from './anim-paint.js';
import {SHAPE_KINDS, MIN_EDGE_LENGTH, MAX_EDGE_LENGTH, MAX_PARAMETERS, MAX_SHAPES, MIN_POINTS, MAX_POINTS, MAX_KEYFRAMES,
  RESERVED_PARAMETER_NAMES, trackNames, hasTrack, isColorTrack, pointOfTrack, pointTrack, validParameterName, parseColor,
  formatColor, validCurve, splitCurve, sampleTrack, sliderRange, checkShape} from './anim-vector.js';

// Pixel formats, as the new-animation form offers them. A vector animation
// has the format VECTOR.
export const FORMATS = ['image', 'matte', 'field'];
export const VECTOR = 'vector';
export const MAX_FPS = 60;
export const HISTORY_ENTRIES = 100;
export const HISTORY_BYTES = 64 * 1024 * 1024;
export const EXTENSION = '.grainanim';

const fail = message => { throw new Error(message); };
const wholeIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

// File names follow the node-name rule, which the host enforces for new files.
export function validAnimationName(name) {
  // A file name follows the rule for state names, but cannot be empty.
  return name !== '' && validNodeName(name);
}

export function checkAnimationName(name) {
  if (!validAnimationName(name)) fail('Animation names use 1 to 64 letters, digits, spaces, _ or -, without a leading or trailing space');
  return name;
}

// A new asset has no states yet. The format accepts that, so the empty file can
// be saved before the graph view adds the first node. A vector animation has
// no frame rate, so `fps` is ignored for it; it has parameters instead, and
// `pixels` stays empty.
export function newAnimation({format = 'image', width = 64, height = 64, fps = 12} = {}) {
  if (format !== VECTOR && !FORMATS.includes(format)) fail('Choose image, matte, field or vector as the format');
  if (!wholeIn(width, 1, MAX_SIDE) || !wholeIn(height, 1, MAX_SIDE)) fail(`Width and height are whole numbers from 1 to ${MAX_SIDE}`);
  if (format === VECTOR) {
    return {format, width, height, parameters: [], nodes: [], edges: [], nextNodeId: 0, nextEdgeId: 0, palette: [], pixels: new Map()};
  }
  checkFps(fps);
  return {format, width, height, fps, nodes: [], edges: [], nextNodeId: 0, nextEdgeId: 0, palette: [], pixels: new Map()};
}

export const isVectorDocument = doc => doc.format === VECTOR;

function checkFps(fps) {
  if (!wholeIn(fps, 1, MAX_FPS)) fail(`Drawings per second is a whole number from 1 to ${MAX_FPS}`);
}

export function setFps(doc, fps) {
  if (isVectorDocument(doc)) fail('A vector animation has no frame rate; the host decides how often it is drawn');
  checkFps(fps);
  doc.fps = fps;
}

export function framePixels(doc) {
  return doc.width * doc.height * FORMAT_BYTES[doc.format];
}

// Everything except pixels. Small enough to copy on every edit.
export function metadataOf(doc) {
  const {pixels, ...metadata} = doc;
  return structuredClone(metadata);
}

function applyMetadata(doc, metadata) {
  for (const key of Object.keys(doc)) if (key !== 'pixels' && !(key in metadata)) delete doc[key];
  Object.assign(doc, structuredClone(metadata));
}

const copyFrame = data => data ? data.slice() : null;
const sameFrame = (a, b) => a === b || (a && b && a.length === b.length && a.every((value, index) => value === b[index]));

export function createHistory({maxEntries = HISTORY_ENTRIES, maxBytes = HISTORY_BYTES} = {}) {
  return {undo: [], redo: [], bytes: 0, maxEntries, maxBytes};
}

function entryBytes(entry) {
  let bytes = 2 * JSON.stringify(entry.before).length + 2 * JSON.stringify(entry.after).length;
  for (const {before, after} of entry.frames.values()) bytes += (before?.length ?? 0) + (after?.length ?? 0);
  return bytes;
}

// The byte count covers the undo and the redo stack. The newest entry is
// always kept, even when it alone exceeds the byte limit, so the last edit can
// still be undone.
function trim(history) {
  while (history.undo.length > 1 && (history.undo.length > history.maxEntries || history.bytes > history.maxBytes)) {
    history.bytes -= history.undo.shift().bytes;
  }
}

// Runs `change(doc)` and records it. `frames` lists the frame ids the change
// may create, modify or delete; only those are copied. When the pixels were
// already changed before this call (a stroke painted as the pointer moves),
// `before` maps frame id to the copy taken when the gesture started.
// `merge` names one continuous change, such as a colour slider being dragged:
// an edit without frames whose `merge` equals that of the newest undo entry
// joins that entry, so undo takes the whole drag back at once.
// Returns the change's result, or undefined when nothing changed.
export function recordEdit(history, doc, change, {frames = [], before = new Map(), label = '', merge = null} = {}) {
  const metadataBefore = metadataOf(doc);
  const pixelsBefore = new Map(frames.map(id => [id, before.has(id) ? copyFrame(before.get(id)) : copyFrame(doc.pixels.get(id))]));
  let result;
  try {
    result = change(doc);
  } catch (error) {
    applyMetadata(doc, metadataBefore);
    for (const [id, data] of pixelsBefore) restoreFrame(doc, id, data);
    throw error;
  }
  const metadataAfter = metadataOf(doc);
  const changedFrames = new Map();
  for (const [id, data] of pixelsBefore) {
    const after = doc.pixels.get(id) ?? null;
    if (!sameFrame(data, after)) changedFrames.set(id, {before: data, after: copyFrame(after)});
  }
  if (!changedFrames.size && JSON.stringify(metadataBefore) === JSON.stringify(metadataAfter)) return undefined;
  for (const dropped of history.redo.splice(0)) history.bytes -= dropped.bytes;
  const top = history.undo.at(-1);
  if (merge !== null && !changedFrames.size && top?.merge === merge && !top.frames.size) {
    history.bytes -= top.bytes;
    top.after = metadataAfter;
    top.bytes = entryBytes(top);
    history.bytes += top.bytes;
    return result ?? true;
  }
  const entry = {label, before: metadataBefore, after: metadataAfter, frames: changedFrames, ...(merge !== null ? {merge} : {})};
  entry.bytes = entryBytes(entry);
  history.undo.push(entry);
  history.bytes += entry.bytes;
  trim(history);
  return result ?? true;
}

function restoreFrame(doc, id, data) {
  if (data) doc.pixels.set(id, data.slice());
  else doc.pixels.delete(id);
}

function step(history, doc, from, to, side) {
  const entry = history[from].pop();
  if (!entry) return null;
  applyMetadata(doc, entry[side]);
  for (const [id, frame] of entry.frames) restoreFrame(doc, id, frame[side]);
  history[to].push(entry);
  return entry;
}

// Both return the entry that was applied, or null when there is none. The
// byte count covers both stacks, so moving an entry leaves it unchanged.
export function undo(history, doc) {
  return step(history, doc, 'undo', 'redo', 'before');
}

export function redo(history, doc) {
  return step(history, doc, 'redo', 'undo', 'after');
}

// Graph edits (6.4) ----------------------------------------------------------
//
// Each edit mutates the document, throws an Error with a message for the user
// when the result would break a rule of section 3.3, and returns what it
// created or removed. A document changed only through these functions always
// encodes. Deleting edges or nodes leaves the edges' frames in `doc.pixels`:
// undo then restores the references without copying pixels, and the encoder
// drops frames no edge refers to. So frame ids must come from `newFrameId`,
// never from the size of `doc.pixels`, and code that removes entries from
// `doc.pixels` must list them in the edit's `frames` option.

export const MAX_EDGE_ID = 0xFFFFFFFF;
export const MAX_COORDINATE = 1e6;

export function nodeById(doc, id) {
  return doc.nodes.find(node => node.id === id) ?? null;
}

export function edgeById(doc, id) {
  return doc.edges.find(edge => edge.id === id) ?? null;
}

const needNode = (doc, id) => nodeById(doc, id) ?? fail(`State ${id} does not exist`);
const needEdge = (doc, id) => edgeById(doc, id) ?? fail(`Edge ${id} does not exist`);
// Frame edits apply to pixel edges only; a vector edge has keyframes instead.
function needPixelEdge(doc, id) {
  const edge = needEdge(doc, id);
  if (!Array.isArray(edge.frames)) fail('A vector edge has no frames; its shapes move between keyframes');
  return edge;
}

export const isLoop = edge => edge.from === edge.to;

export function loopsOf(doc, id) {
  return doc.edges.filter(edge => edge.from === id && edge.to === id);
}

export function edgesOf(doc, id) {
  return doc.edges.filter(edge => edge.from === id || edge.to === id);
}

export function checkNodeName(doc, name, exceptId = null) {
  if (!validNodeName(name)) fail('State names use up to 64 letters, digits, spaces, _ or -, without a leading or trailing space');
  // Names are case-sensitive in the file and in code, so `Idle` and `idle` are two states.
  // A state needs no name; any number of states can go without one.
  if (name !== '' && doc.nodes.some(node => node.name === name && node.id !== exceptId)) fail(`A state named ${name} already exists`);
  return name;
}

// How a state is called in the editor: its name, or `#id` when it has none.
export const nodeLabel = node => node ? node.name || '#' + node.id : '';

function coordinate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('State positions must be finite numbers');
  return Math.round(Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, value)));
}

// Ids are assigned in creation order and never reused (2.1), so a deleted
// state's id stays taken even when it was the last one.
export function addNode(doc, {name = '', x = 0, y = 0} = {}) {
  if (doc.nodes.length >= MAX_NODES) fail(`An animation can have at most ${MAX_NODES} states`);
  if (doc.nextNodeId > MAX_NODE_ID) fail('This animation has used all 65536 state ids; duplicate the file to start numbering again');
  checkNodeName(doc, name);
  const node = {id: doc.nextNodeId, name, x: coordinate(x), y: coordinate(y)};
  doc.nodes.push(node);
  doc.nextNodeId++;
  return node;
}

export function renameNode(doc, id, name) {
  const node = needNode(doc, id);
  checkNodeName(doc, name, id);
  node.name = name;
  return node;
}

// Positions that arrange the states in rows, as {id: {x, y}}. The state with
// the most edges goes on top; every other state goes one row below the
// nearest row it is connected to, so connected states end up next to each
// other and most edges run straight between two rows or along one. Within a
// row the states stand in the order of the states they connect to above.
// Parts of the graph that are not connected stand side by side. The
// arrangement keeps the middle of the graph where it was. `widthOf(node)` is
// the width of a state's box.
export function tidyPositions(doc, widthOf = () => 64, {rowGap = 110, columnGap = 56} = {}) {
  const nodes = doc.nodes, result = new Map();
  if (!nodes.length) return result;
  const near = new Map(nodes.map(node => [node.id, new Set()]));
  for (const edge of doc.edges) if (edge.from !== edge.to && near.has(edge.from) && near.has(edge.to)) { near.get(edge.from).add(edge.to);near.get(edge.to).add(edge.from); }
  const degree = id => doc.edges.filter(edge => edge.from === id || edge.to === id).length;
  const byWeight = [...nodes].sort((a, b) => degree(b.id) - degree(a.id) || a.id - b.id);
  const placed = new Set();
  let offset = 0;
  for (const root of byWeight) {
    if (placed.has(root.id)) continue;
    // Rows by distance from the root.
    const rows = [[root.id]];
    placed.add(root.id);
    for (;;) {
      const next = [];
      for (const id of rows.at(-1)) for (const other of [...near.get(id)].sort((a, b) => a - b)) if (!placed.has(other)) { placed.add(other);next.push(other); }
      if (!next.length) break;
      rows.push(next);
    }
    // Order each row by where its neighbours in the row above stand.
    const place = new Map([[root.id, 0]]);
    for (let index = 1; index < rows.length; index++) {
      const above = new Set(rows[index - 1]);
      const middle = id => { const list = [...near.get(id)].filter(other => above.has(other)).map(other => place.get(other));return list.reduce((sum, value) => sum + value, 0) / list.length; };
      const keys = new Map(rows[index].map(id => [id, middle(id)]));
      rows[index].sort((a, b) => keys.get(a) - keys.get(b) || a - b);
      rows[index].forEach((id, position) => place.set(id, position - (rows[index].length - 1) / 2));
    }
    const width = id => widthOf(nodes.find(node => node.id === id));
    const rowWidth = row => row.reduce((sum, id) => sum + width(id), 0) + columnGap * (row.length - 1);
    const total = Math.max(...rows.map(rowWidth));
    rows.forEach((row, index) => {
      let x = offset + (total - rowWidth(row)) / 2;
      for (const id of row) { result.set(id, {x: x + width(id) / 2, y: index * rowGap});x += width(id) + columnGap; }
    });
    offset += total + 2 * columnGap;
  }
  // Keep the middle of the graph in place, on whole tens.
  const middleOf = list => (Math.min(...list) + Math.max(...list)) / 2;
  const dx = middleOf(nodes.map(node => node.x)) - middleOf([...result.values()].map(spot => spot.x));
  const dy = middleOf(nodes.map(node => node.y)) - middleOf([...result.values()].map(spot => spot.y));
  for (const spot of result.values()) { spot.x = Math.round((spot.x + dx) / 10) * 10;spot.y = Math.round((spot.y + dy) / 10) * 10; }
  return result;
}

export function moveNode(doc, id, x, y) {
  const node = needNode(doc, id);
  node.x = coordinate(x);
  node.y = coordinate(y);
  return node;
}

// Removes the state and every edge that starts or ends at it.
export function deleteNode(doc, id) {
  const node = needNode(doc, id);
  const edges = edgesOf(doc, id);
  doc.nodes = doc.nodes.filter(other => other.id !== id);
  doc.edges = doc.edges.filter(edge => edge.from !== id && edge.to !== id);
  return {node, edges};
}

// Frames in the saved pool: every distinct frame id an edge refers to. Vector
// edges have none.
export function poolSize(doc) {
  return new Set(doc.edges.flatMap(edge => edge.frames ?? [])).size;
}

// One above every frame id in use or kept for undo.
export function newFrameId(doc) {
  let next = 0;
  for (const id of doc.pixels.keys()) next = Math.max(next, id + 1);
  for (const edge of doc.edges) for (const id of edge.frames ?? []) next = Math.max(next, id + 1);
  return next;
}

export function blankFrame(doc) {
  const Pixels = doc.format === 'image' ? Uint8ClampedArray : Uint8Array;
  return new Pixels(framePixels(doc));
}

function checkRoomForEdge(doc, frames) {
  if (doc.edges.length >= MAX_EDGES) fail(`An animation can have at most ${MAX_EDGES} edges`);
  if (doc.nextEdgeId > MAX_EDGE_ID) fail('This animation has used all edge ids; duplicate the file to start numbering again');
  const pool = poolSize(doc) + frames;
  if (pool > MAX_FRAMES) fail(`An animation can hold at most ${MAX_FRAMES} frames`);
  if (pool * framePixels(doc) > MAX_PIXEL_BYTES) fail('The frames of this animation would exceed 32 MiB');
}

// A new edge has one empty frame, plays one way and cannot be cut short
// (6.4). A new vector edge lasts DEFAULT_EDGE_LENGTH seconds and has no
// shapes. `from === to` makes a loop.
export function addEdge(doc, from, to) {
  needNode(doc, from);
  needNode(doc, to);
  const vector = isVectorDocument(doc);
  checkRoomForEdge(doc, vector ? 0 : 1);
  const edge = {id: doc.nextEdgeId, from, to, bidirectional: false, cancelable: false};
  if (vector) {
    Object.assign(edge, {length: DEFAULT_EDGE_LENGTH, shapes: []});
  } else {
    const frame = newFrameId(doc);
    doc.pixels.set(frame, blankFrame(doc));
    edge.frames = [frame];
  }
  doc.edges.push(edge);
  doc.nextEdgeId++;
  return edge;
}

// Turns the arrow around and reverses the frame order with it, so every
// drawing stays next to the state it was drawn against: the edge now shows
// what playing it backwards showed before. A vector edge reverses its
// keyframes the same way.
export function reverseEdge(doc, id) {
  const edge = needEdge(doc, id);
  if (isLoop(edge)) fail('A loop starts and ends at the same state, so it has no direction to reverse');
  [edge.from, edge.to] = [edge.to, edge.from];
  if (isVectorDocument(doc)) reverseShapes(edge);
  else edge.frames.reverse();
  return edge;
}

export function setBidirectional(doc, id, value) {
  const edge = needEdge(doc, id);
  if (typeof value !== 'boolean') fail('Bidirectional is on or off');
  // The runtime ignores the flag on loops (2.1); keeping it off avoids a
  // setting that does nothing.
  if (value && isLoop(edge)) fail('A loop cannot be bidirectional');
  edge.bidirectional = value;
  return edge;
}

export function setCancelable(doc, id, value) {
  const edge = needEdge(doc, id);
  if (typeof value !== 'boolean') fail('Cancelable is on or off');
  edge.cancelable = value;
  return edge;
}

// A copy with the same ends and flags and its own copies of the frames, added
// after the original. Parallel edges are allowed (2.1). A vector edge's copy
// has the same length and copies of its shapes.
export function duplicateEdge(doc, id) {
  const edge = needEdge(doc, id);
  if (isVectorDocument(doc)) {
    checkRoomForEdge(doc, 0);
    const copy = {id: doc.nextEdgeId, from: edge.from, to: edge.to, bidirectional: edge.bidirectional,
      cancelable: edge.cancelable, length: edge.length, shapes: structuredClone(edge.shapes)};
    doc.edges.splice(doc.edges.indexOf(edge) + 1, 0, copy);
    doc.nextEdgeId++;
    return copy;
  }
  checkRoomForEdge(doc, new Set(edge.frames).size);
  const copies = new Map();
  let next = newFrameId(doc);
  for (const frame of edge.frames) {
    if (copies.has(frame)) continue;
    const pixels = doc.pixels.get(frame);
    copies.set(frame, next);
    doc.pixels.set(next++, pixels ? pixels.slice() : blankFrame(doc));
  }
  const copy = {id: doc.nextEdgeId, from: edge.from, to: edge.to, bidirectional: edge.bidirectional,
    cancelable: edge.cancelable, frames: edge.frames.map(frame => copies.get(frame))};
  doc.edges.splice(doc.edges.indexOf(edge) + 1, 0, copy);
  doc.nextEdgeId++;
  return copy;
}

export function deleteEdge(doc, id) {
  const edge = needEdge(doc, id);
  doc.edges = doc.edges.filter(other => other.id !== id);
  return edge;
}

// Frame edits (6.5) ----------------------------------------------------------
//
// Positions are indices into an edge's play order. New frames get ids from
// `newFrameId`; a deleted frame keeps its pixels in `doc.pixels`, so undo
// restores the reference without a copy, as for deleted edges.

function checkRoomForFrame(doc, edge) {
  if (edge.frames.length >= MAX_EDGE_FRAMES) fail(`An edge can have at most ${MAX_EDGE_FRAMES} frames`);
  const pool = poolSize(doc) + 1;
  if (pool > MAX_FRAMES) fail(`An animation can hold at most ${MAX_FRAMES} frames`);
  if (pool * framePixels(doc) > MAX_PIXEL_BYTES) fail('The frames of this animation would exceed 32 MiB');
}
function checkPosition(edge, index, last = edge.frames.length - 1) {
  if (!Number.isInteger(index) || index < 0 || index > last) fail(`Edge ${edge.id} has no frame ${index + 1}`);
  return index;
}

// Inserts an empty frame at `index` (default: the end). Returns {id, index}.
export function addFrame(doc, edgeId, index = needPixelEdge(doc, edgeId).frames.length) {
  const edge = needPixelEdge(doc, edgeId);
  checkPosition(edge, index, edge.frames.length);
  checkRoomForFrame(doc, edge);
  const id = newFrameId(doc);
  doc.pixels.set(id, blankFrame(doc));
  edge.frames.splice(index, 0, id);
  return {id, index};
}

// Inserts a copy of the frame at `index` right after it. Returns {id, index}.
export function duplicateFrame(doc, edgeId, index) {
  const edge = needPixelEdge(doc, edgeId);
  checkPosition(edge, index);
  checkRoomForFrame(doc, edge);
  const id = newFrameId(doc), pixels = doc.pixels.get(edge.frames[index]);
  doc.pixels.set(id, pixels ? pixels.slice() : blankFrame(doc));
  edge.frames.splice(index + 1, 0, id);
  return {id, index: index + 1};
}

// Removes the frame at `index` from the edge. An edge keeps at least one
// frame (3.3). Returns the removed frame id.
export function deleteFrame(doc, edgeId, index) {
  const edge = needPixelEdge(doc, edgeId);
  checkPosition(edge, index);
  if (edge.frames.length <= 1) fail('An edge needs at least one frame');
  return edge.frames.splice(index, 1)[0];
}

// Moves the frame at `from` so it ends up at position `to`. Returns `to`.
export function moveFrame(doc, edgeId, from, to) {
  const edge = needPixelEdge(doc, edgeId);
  checkPosition(edge, from);
  checkPosition(edge, to);
  edge.frames.splice(to, 0, ...edge.frames.splice(from, 1));
  return to;
}

// Group edits. `indices` are positions in the edge, in any order.
function checkPositions(edge, indices) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (!sorted.length) fail('No frames are selected');
  for (const index of sorted) checkPosition(edge, index);
  return sorted;
}
// Removes the frames at `indices`. An edge keeps at least one frame.
export function deleteFrames(doc, edgeId, indices) {
  const edge = needPixelEdge(doc, edgeId), sorted = checkPositions(edge, indices);
  if (sorted.length >= edge.frames.length) fail('An edge needs at least one frame');
  const removed = new Set(sorted);
  edge.frames.splice(0, edge.frames.length, ...edge.frames.filter((id, index) => !removed.has(index)));
  return sorted.length;
}
// Takes the frames at `indices` out, keeps their order and puts them back
// together so the first of them lands at position `to` of the result.
// Returns the position used.
export function moveFrames(doc, edgeId, indices, to) {
  const edge = needPixelEdge(doc, edgeId), sorted = checkPositions(edge, indices);
  const taken = new Set(sorted), moved = sorted.map(index => edge.frames[index]);
  const rest = edge.frames.filter((id, index) => !taken.has(index));
  const at = Math.max(0, Math.min(rest.length, Math.round(to)));
  rest.splice(at, 0, ...moved);
  edge.frames.splice(0, edge.frames.length, ...rest);
  return at;
}
// The frames at `indices` as a clip that pasteFrames takes: copies of the
// pixels with the format and size they belong to.
export function copyFrames(doc, edgeId, indices) {
  const edge = needPixelEdge(doc, edgeId), sorted = checkPositions(edge, indices);
  return {format: doc.format, width: doc.width, height: doc.height,
    frames: sorted.map(index => (doc.pixels.get(edge.frames[index]) ?? blankFrame(doc)).slice())};
}
// Inserts copies of a clip's frames at `index`. Returns the new frame ids.
export function pasteFrames(doc, edgeId, index, clip) {
  const edge = needPixelEdge(doc, edgeId);
  checkPosition(edge, index, edge.frames.length);
  if (!clip?.frames?.length) fail('No frames have been copied');
  if (clip.format !== doc.format || clip.width !== doc.width || clip.height !== doc.height) {
    fail(`The copied frames are ${clip.width} × ${clip.height} ${clip.format}, this animation is ${doc.width} × ${doc.height} ${doc.format}`);
  }
  if (edge.frames.length + clip.frames.length > MAX_EDGE_FRAMES) fail(`An edge can have at most ${MAX_EDGE_FRAMES} frames`);
  const ids = [];
  for (const pixels of clip.frames) {
    checkRoomForFrame(doc, edge);
    const id = newFrameId(doc);
    doc.pixels.set(id, pixels.slice());
    // In the edge at once, so the next room check counts it.
    edge.frames.splice(index + ids.length, 0, id);
    ids.push(id);
  }
  return ids;
}

// Reverses the order of the edge's frames and leaves its direction alone, so
// the edge plays its drawings back to front. Compare reverseEdge, which also
// turns the arrow around and so keeps what is shown.
export function reverseFrames(doc, edgeId) {
  const edge = needPixelEdge(doc, edgeId);
  edge.frames.reverse();
  return edge;
}

// Tween (6.6) ----------------------------------------------------------------

// The frames a tween from the frame at `index` would fill: the blank frames
// after it, up to the next drawn frame. Returns {start, end, ids}, where
// `ids` are the frame ids to fill. Throws when there is nothing to fill.
export function tweenSpan(doc, edgeId, index) {
  const edge = needPixelEdge(doc, edgeId);
  checkPosition(edge, index);
  const drawn = position => {
    const data = doc.pixels.get(edge.frames[position]);
    return data && !isBlank(doc.format, data);
  };
  if (!drawn(index)) fail('Tween starts from a drawn frame');
  let end = -1;
  for (let position = index + 1; position < edge.frames.length; position++) if (drawn(position)) { end = position;break; }
  if (end < 0 || end === index + 1) fail('Tween needs blank frames before the next drawn frame');
  return {start: index, end, ids: edge.frames.slice(index + 1, end)};
}

// Fills the blank frames between the frame at `index` and the next drawn
// frame of the edge (mode 'dissolve' or 'blend', see tweenFrame). Callers list
// the ids from `tweenSpan` as the edit's frames. Returns the span.
export function tweenEdge(doc, edgeId, index, mode = 'dissolve') {
  const span = tweenSpan(doc, edgeId, index), edge = needPixelEdge(doc, edgeId);
  const from = doc.pixels.get(edge.frames[span.start]), to = doc.pixels.get(edge.frames[span.end]);
  for (let position = span.start + 1; position < span.end; position++) {
    const t = (position - span.start) / (span.end - span.start);
    doc.pixels.get(edge.frames[position]).set(tweenFrame(doc.format, from, to, t, mode));
  }
  return span;
}

// Resize (6.3) ---------------------------------------------------------------

export const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

// Pads or crops every frame to `width` × `height`, keeping the old content
// fixed at `anchor`: a corner, an edge midpoint or the centre. New area is
// transparent (0 in a Field). When the offset falls between two pixels, the
// extra pixel goes to the right or bottom when padding and is cropped from
// the left or top when cropping. Frames kept only for undo are resized
// too, so every frame in `doc.pixels` keeps one size. Callers list every
// frame id of `doc.pixels` as the edit's frames. Returns the new size. A
// vector animation moves the x and y keyframes of every shape instead, by
// the exact offset, so its content stays fixed at `anchor` too.
export function resizeAnimation(doc, width, height, anchor = 'center') {
  if (!wholeIn(width, 1, MAX_SIDE) || !wholeIn(height, 1, MAX_SIDE)) fail(`Width and height are whole numbers from 1 to ${MAX_SIDE}`);
  if (!ANCHORS.includes(anchor)) fail('Choose one of the nine anchors');
  if (width === doc.width && height === doc.height) return {width, height};
  const horizontal = anchor.includes('left') ? 0 : anchor.includes('right') ? 1 : 0.5;
  const vertical = anchor.includes('top') ? 0 : anchor.includes('bottom') ? 1 : 0.5;
  if (isVectorDocument(doc)) {
    const shift = {x: (width - doc.width) * horizontal, y: (height - doc.height) * vertical};
    for (const edge of doc.edges) for (const shape of edge.shapes) for (const axis of ['x', 'y']) for (const keyframe of shape.tracks[axis]) keyframe.v += shift[axis];
    doc.width = width;doc.height = height;
    return {width, height};
  }
  if (poolSize(doc) * width * height * FORMAT_BYTES[doc.format] > MAX_PIXEL_BYTES) fail('The frames of this animation would exceed 32 MiB');
  const n = FORMAT_BYTES[doc.format];
  const dx = Math.floor((width - doc.width) * horizontal), dy = Math.floor((height - doc.height) * vertical);
  const x0 = Math.max(0, dx), x1 = Math.min(width, dx + doc.width), y0 = Math.max(0, dy), y1 = Math.min(height, dy + doc.height);
  for (const [id, data] of [...doc.pixels]) {
    const next = new data.constructor(width * height * n);
    if (x1 > x0) {
      for (let y = y0; y < y1; y++) {
        const from = ((y - dy) * doc.width + (x0 - dx)) * n;
        next.set(data.subarray(from, from + (x1 - x0) * n), (y * width + x0) * n);
      }
    }
    doc.pixels.set(id, next);
  }
  doc.width = width;doc.height = height;
  return {width, height};
}

// Saved swatches (6.6) live in the file's `palette` as #rrggbbaa strings.
export const MAX_SWATCHES = 256;
const SWATCH = /^#[0-9a-f]{8}$/;

export function addSwatch(doc, colour) {
  const value = String(colour).toLowerCase();
  if (!SWATCH.test(value)) fail('Swatches are colours written as #rrggbbaa');
  if (doc.palette.includes(value)) return undefined;
  if (doc.palette.length >= MAX_SWATCHES) fail(`An animation can keep at most ${MAX_SWATCHES} swatches`);
  doc.palette.push(value);
  return value;
}

export function removeSwatch(doc, colour) {
  const value = String(colour).toLowerCase(), index = doc.palette.indexOf(value);
  if (index < 0) return undefined;
  doc.palette.splice(index, 1);
  return value;
}

// Vector edits (docs/vector-animation-design.md) --------------------------------
//
// Shapes are addressed by their edge's id and their index in the edge's
// drawing order, properties by track name, keyframes by their index in the
// track. Like the graph edits, each edit throws an Error with a message for
// the user instead of breaking a rule of section 11, so a document changed
// only through these functions always encodes. None touches `doc.pixels`, so
// recordEdit needs no `frames` option for them.

export const DEFAULT_EDGE_LENGTH = 1;
// Keyframe times snap to 1/60 second (section 11, Editor).
export const KEYFRAME_STEPS_PER_SECOND = 60;
export const DEFAULT_POLYGON_POINTS = 3;
// Two keyframe times closer than this are the same time.
const SAME_TIME = 1e-9;

const isNumber = value => typeof value === 'number' && Number.isFinite(value);

function needVectorEdge(doc, id) {
  if (!isVectorDocument(doc)) fail('Only a vector animation has shapes, keyframes and parameters');
  return needEdge(doc, id);
}

export function shapeAt(doc, edgeId, index) {
  return edgeById(doc, edgeId)?.shapes?.[index] ?? null;
}

function checkShapeIndex(edge, index, last = edge.shapes.length - 1) {
  if (!Number.isInteger(index) || index < 0 || index > last) fail(`Edge ${edge.id} has no shape ${index + 1}`);
  return index;
}

function needShape(doc, edgeId, index) {
  const edge = needVectorEdge(doc, edgeId);
  checkShapeIndex(edge, index);
  return {edge, shape: edge.shapes[index]};
}

const pointsOf = shape => shape.kind === 'polygon' ? shape.points : 0;

function needTrack(shape, property) {
  if (!hasTrack(shape.kind, pointsOf(shape), property)) fail(`A ${shape.kind} has no property ${property}`);
  return shape.tracks[property];
}

function checkValue(property, value) {
  if (isColorTrack(property)) {
    if (parseColor(value) === null) fail('Colours are written #rrggbb');
    return value.toLowerCase();
  }
  if (!isNumber(value)) fail(`The ${property.replaceAll('_', ' ')} is a finite number`);
  return value;
}

// null for a linear move.
function checkCurve(curve) {
  if (curve === null || curve === undefined) return null;
  if (!validCurve(curve)) fail('A speed curve is four numbers; the first and the third are from 0 to 1');
  return curve.slice();
}

const setCurve = (keyframe, curve) => {
  if (curve) keyframe.curve = curve;
  else delete keyframe.curve;
};

export function snapTime(t) {
  return Math.round(t * KEYFRAME_STEPS_PER_SECOND) / KEYFRAME_STEPS_PER_SECOND;
}

// A keyframe time on `edge`: snapped to 1/60 second and kept within the edge.
// The end of the edge is reachable even when its length is not on that grid.
function checkTime(edge, t) {
  if (!isNumber(t)) fail('Keyframe times are numbers of seconds');
  const snapped = Math.min(edge.length, Math.max(0, snapTime(t)));
  return Math.abs(t - edge.length) < Math.abs(t - snapped) ? edge.length : snapped;
}

// The time an edit at `t` on a vector edge reaches: the keyframe time the
// edits above would use. The editor compares the playhead with keyframes
// through it.
export function keyframeTime(edge, t) {
  return checkTime(edge, t);
}

function checkKeyframeIndex(track, index) {
  if (!Number.isInteger(index) || index < 0 || index >= track.length) fail(`This property has no keyframe ${index + 1}`);
  return index;
}

const keyframeAt = (track, t) => track.findIndex(keyframe => Math.abs(keyframe.t - t) < SAME_TIME);

// The index of the keyframe at `t`, added when there is none. A new keyframe
// takes the value the track has at `t`. Inside a move, the move's speed curve
// is split at `t`, so the movement stays as it was.
function insertKeyframe(track, t) {
  const found = keyframeAt(track, t);
  if (found >= 0) return found;
  if (track.length >= MAX_KEYFRAMES) fail(`A property can have at most ${MAX_KEYFRAMES} keyframes`);
  const next = track.findIndex(keyframe => keyframe.t > t);
  const index = next < 0 ? track.length : next;
  const value = sampleTrack(track, t);
  const keyframe = {t, v: Array.isArray(value) ? formatColor(value) : value};
  if (index > 0 && index < track.length) {
    const from = track[index - 1], to = track[index];
    const [left, right] = splitCurve(from.curve, (t - from.t) / (to.t - from.t));
    setCurve(from, left);
    setCurve(keyframe, right);
  }
  track.splice(index, 0, keyframe);
  return index;
}

// Shortening an edge drops the keyframes after its new end. A track whose
// keyframes all lie after it keeps its first one, moved to the new end, since
// every property needs a keyframe.
function fitTrack(track, length) {
  const kept = track.filter(keyframe => keyframe.t <= length);
  return kept.length ? kept : [{...track[0], t: length}];
}

// A malformed track of a pasted clip is left for checkShape to report.
function fitShape(shape, length) {
  for (const [name, track] of Object.entries(shape.tracks)) if (Array.isArray(track) && track.length) shape.tracks[name] = fitTrack(track, length);
}

// Playing a move backwards needs the speed curve turned half around: the
// curve through (1 - x, 1 - y), with its control points swapped.
const reverseCurve = ([x1, y1, x2, y2]) => [1 - x2, 1 - y2, 1 - x1, 1 - y1];

// The track as it plays backwards on an edge of `length` seconds. Each move
// keeps its curve, reversed and moved to the keyframe it now leaves from.
function reverseTrack(track, length) {
  const reversed = track.map((keyframe, index) => {
    const before = track[index - 1];
    const result = {t: Math.min(length, Math.max(0, length - keyframe.t)), v: keyframe.v};
    if (before?.curve) result.curve = reverseCurve(before.curve);
    return result;
  }).reverse();
  // Rounding can make two times equal; the file needs them increasing.
  return reversed.filter((keyframe, index) => index === 0 || keyframe.t > reversed[index - 1].t);
}

function reverseShapes(edge) {
  for (const shape of edge.shapes) {
    for (const name of Object.keys(shape.tracks)) shape.tracks[name] = reverseTrack(shape.tracks[name], edge.length);
  }
}

// Reverses the keyframes of a vector edge and leaves its direction alone, so
// the edge plays its movement back to front. Compare reverseEdge, which also
// turns the arrow around and so keeps what is shown.
export function reverseKeyframes(doc, edgeId) {
  const edge = needVectorEdge(doc, edgeId);
  reverseShapes(edge);
  return edge;
}

export function setEdgeLength(doc, edgeId, length) {
  const edge = needVectorEdge(doc, edgeId);
  if (!isNumber(length) || length < MIN_EDGE_LENGTH || length > MAX_EDGE_LENGTH) fail(`An edge lasts ${MIN_EDGE_LENGTH} to ${MAX_EDGE_LENGTH} seconds`);
  edge.length = length;
  for (const shape of edge.shapes) fitShape(shape, length);
  return edge;
}

// Shapes --------------------------------------------------------------------------

const rounded = value => Math.round(value * 1000) / 1000 || 0;

// Values for the one keyframe at 0 s of every track of a new shape: centred
// on the canvas, half as large as its shorter side, filled white with a
// 1-pixel black outline. A polygon is regular, with its first point on top
// and the others following clockwise, and straight sides.
function newShapeTracks(doc, kind, points) {
  const size = Math.max(1, Math.round(Math.min(doc.width, doc.height) / 2));
  const values = {x: doc.width / 2, y: doc.height / 2, rotation: 0, outline_thickness: 1, outline_color: '#000000',
    outline_opacity: 1, fill_color: '#ffffff', fill_opacity: 1, width: size, height: size};
  for (let index = 0; index < points; index++) {
    const angle = 2 * Math.PI * index / points - Math.PI / 2;
    values[pointTrack(index, 'x')] = rounded(size / 2 * Math.cos(angle));
    values[pointTrack(index, 'y')] = rounded(size / 2 * Math.sin(angle));
  }
  return Object.fromEntries(trackNames(kind, points).map(name => [name, [{t: 0, v: values[name] ?? 0}]]));
}

// Adds a shape at `index` of the drawing order (default: on top). `values`
// sets the value at 0 s of any of its properties by track name. Returns
// {index, shape}.
export function addShape(doc, edgeId, kind, {index, points = DEFAULT_POLYGON_POINTS, values = {}} = {}) {
  const edge = needVectorEdge(doc, edgeId);
  if (!SHAPE_KINDS.includes(kind)) fail('Choose a rectangle, an oval or a polygon');
  if (edge.shapes.length >= MAX_SHAPES) fail(`An edge can have at most ${MAX_SHAPES} shapes`);
  if (kind === 'polygon' && !wholeIn(points, MIN_POINTS, MAX_POINTS)) fail(`A polygon has ${MIN_POINTS} to ${MAX_POINTS} points`);
  const at = checkShapeIndex(edge, index ?? edge.shapes.length, edge.shapes.length);
  const shape = {kind, ...(kind === 'polygon' ? {points} : {}), tracks: newShapeTracks(doc, kind, kind === 'polygon' ? points : 0), assignments: []};
  for (const [name, value] of Object.entries(values)) needTrack(shape, name)[0].v = checkValue(name, value);
  edge.shapes.splice(at, 0, shape);
  return {index: at, shape};
}

export function deleteShape(doc, edgeId, index) {
  const {edge} = needShape(doc, edgeId, index);
  return edge.shapes.splice(index, 1)[0];
}

// A copy right above the original. Returns {index, shape}.
export function duplicateShape(doc, edgeId, index) {
  const {edge, shape} = needShape(doc, edgeId, index);
  if (edge.shapes.length >= MAX_SHAPES) fail(`An edge can have at most ${MAX_SHAPES} shapes`);
  const copy = structuredClone(shape);
  edge.shapes.splice(index + 1, 0, copy);
  return {index: index + 1, shape: copy};
}

// Moves the shape at `from` to position `to` of the drawing order; later
// shapes cover earlier ones, so `from + 1` brings it forward. Returns `to`.
export function moveShape(doc, edgeId, from, to) {
  const {edge} = needShape(doc, edgeId, from);
  checkShapeIndex(edge, to);
  edge.shapes.splice(to, 0, ...edge.shapes.splice(from, 1));
  return to;
}

// The shapes at `indices` as a clip that pasteShapes takes: copies with
// their keyframes and assignments, in drawing order, plus the definitions of
// the parameters they use, so they can be pasted into another animation.
export function copyShapes(doc, edgeId, indices) {
  const edge = needVectorEdge(doc, edgeId);
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (!sorted.length) fail('No shapes are selected');
  for (const index of sorted) checkShapeIndex(edge, index);
  const shapes = sorted.map(index => structuredClone(edge.shapes[index]));
  const used = new Set(shapes.flatMap(shape => shape.assignments.map(assignment => assignment.parameter)));
  return {format: VECTOR, shapes, parameters: structuredClone(doc.parameters.filter(parameter => used.has(parameter.name)))};
}

// Inserts copies of a clip's shapes at `index` (default: on top). Keyframes
// after the end of this edge are dropped as setEdgeLength drops them. A
// parameter the clip uses but this animation lacks is added from the clip.
// Returns the new shapes' indices.
export function pasteShapes(doc, edgeId, clip, index) {
  const edge = needVectorEdge(doc, edgeId);
  if (clip?.format !== VECTOR || !clip.shapes?.length) fail('No shapes have been copied');
  if (edge.shapes.length + clip.shapes.length > MAX_SHAPES) fail(`An edge can have at most ${MAX_SHAPES} shapes`);
  const at = checkShapeIndex(edge, index ?? edge.shapes.length, edge.shapes.length);
  const names = new Set(doc.parameters.map(parameter => parameter.name)), missing = [];
  for (const name of new Set(clip.shapes.flatMap(shape => shape.assignments?.map(assignment => assignment.parameter) ?? []))) {
    if (names.has(name)) continue;
    missing.push(clip.parameters?.find(other => other.name === name) ?? fail(`The copied shapes use the parameter ${name}, which the clip does not define`));
    names.add(name);
  }
  const shapes = clip.shapes.map(shape => {
    const copy = structuredClone(shape);
    if (copy?.tracks && typeof copy.tracks === 'object') fitShape(copy, edge.length);
    checkShape(edge.id, copy, edge.length, names);
    return copy;
  });
  for (const parameter of missing) addParameter(doc, parameter);
  edge.shapes.splice(at, 0, ...shapes);
  return shapes.map((_, offset) => at + offset);
}

// Copies shapes from one edge to another, also the same one. Returns the new
// shapes' indices on `toEdgeId`.
export function copyShapesToEdge(doc, fromEdgeId, indices, toEdgeId, index) {
  return pasteShapes(doc, toEdgeId, copyShapes(doc, fromEdgeId, indices), index);
}

// Polygon points ------------------------------------------------------------------

function needPolygon(doc, edgeId, index) {
  const found = needShape(doc, edgeId, index);
  if (found.shape.kind !== 'polygon') fail('Only a polygon has points');
  return found;
}

// Gives every point track and assignment the index `map(old)`, or drops it
// when `map` returns null, and stores the tracks in file order for `points`.
function renumberPoints(shape, points, map, added = {}) {
  const tracks = {...added};
  for (const [name, track] of Object.entries(shape.tracks)) {
    const point = pointOfTrack(name);
    const index = point ? map(point.index) : null;
    if (!point) tracks[name] = track;
    else if (index !== null) tracks[pointTrack(index, point.part)] = track;
  }
  shape.assignments = shape.assignments.flatMap(assignment => {
    const point = pointOfTrack(assignment.property);
    if (!point) return [assignment];
    const index = map(point.index);
    return index === null ? [] : [{...assignment, property: pointTrack(index, point.part)}];
  });
  shape.points = points;
  shape.tracks = Object.fromEntries(trackNames('polygon', points).map(name => [name, tracks[name]]));
}

// Adds a point in the middle of the side from point `after` to the next one
// (the last point's side leads back to point 0), with zero handles. Its
// position is the middle of the side's curve at every keyframe time of the
// tracks that shape that side. Returns the new point's index, `after + 1`.
export function addPolygonPoint(doc, edgeId, shapeIndex, after) {
  const {shape} = needPolygon(doc, edgeId, shapeIndex);
  const count = shape.points;
  if (!Number.isInteger(after) || after < 0 || after >= count) fail(`This polygon has no point ${after + 1}`);
  if (count >= MAX_POINTS) fail(`A polygon has at most ${MAX_POINTS} points`);
  const next = (after + 1) % count;
  const middle = axis => {
    const names = [pointTrack(after, axis), pointTrack(after, 'out.' + axis), pointTrack(next, 'in.' + axis), pointTrack(next, axis)];
    const times = [...new Set(names.flatMap(name => shape.tracks[name].map(keyframe => keyframe.t)))].sort((a, b) => a - b);
    return times.slice(0, MAX_KEYFRAMES).map(t => {
      const [start, out, into, end] = names.map(name => sampleTrack(shape.tracks[name], t));
      // B(1/2) of the cubic with control points start + out and end + in.
      return {t, v: (start + 3 * (start + out) + 3 * (end + into) + end) / 8};
    });
  };
  const index = after + 1;
  const added = {[pointTrack(index, 'x')]: middle('x'), [pointTrack(index, 'y')]: middle('y')};
  for (const part of ['in.x', 'in.y', 'out.x', 'out.y']) added[pointTrack(index, part)] = [{t: 0, v: 0}];
  renumberPoints(shape, count + 1, old => old > after ? old + 1 : old, added);
  return index;
}

// Removes a point from every keyframe, with its handles and the assignments
// to them. Returns the removed point's index.
export function removePolygonPoint(doc, edgeId, shapeIndex, point) {
  const {shape} = needPolygon(doc, edgeId, shapeIndex);
  if (!Number.isInteger(point) || point < 0 || point >= shape.points) fail(`This polygon has no point ${point + 1}`);
  if (shape.points <= MIN_POINTS) fail(`A polygon needs at least ${MIN_POINTS} points`);
  renumberPoints(shape, shape.points - 1, old => old === point ? null : old > point ? old - 1 : old);
  return point;
}

// Keyframes ----------------------------------------------------------------------

// Sets the value of `property` at `t`: the keyframe there changes, or a new
// one is added. `curve` (four numbers, or null for linear) sets the speed
// curve toward the next keyframe when given. Returns the keyframe's index.
export function setKeyframe(doc, edgeId, shapeIndex, property, t, value, {curve} = {}) {
  const {edge, shape} = needShape(doc, edgeId, shapeIndex);
  const track = needTrack(shape, property);
  const time = checkTime(edge, t), checked = checkValue(property, value), speed = checkCurve(curve);
  const index = insertKeyframe(track, time);
  track[index].v = checked;
  if (curve !== undefined) setCurve(track[index], speed);
  return index;
}

// An edit to a property at the playhead (section 11, Editor): the keyframe
// at `t` changes; without one there, a property with one keyframe changes
// that keyframe, and a property with several gets a new keyframe at `t`.
// Returns the changed keyframe's index.
export function setPropertyAt(doc, edgeId, shapeIndex, property, t, value) {
  const {edge, shape} = needShape(doc, edgeId, shapeIndex);
  const track = needTrack(shape, property);
  const time = checkTime(edge, t), checked = checkValue(property, value);
  let index = keyframeAt(track, time);
  if (index < 0 && track.length === 1) index = 0;
  if (index < 0) index = insertKeyframe(track, time);
  track[index].v = checked;
  return index;
}

// The Keyframe button: a keyframe at `t` on every property of the shape that
// has none there, holding the value it already has, so nothing moves
// differently. Returns how many keyframes were added.
export function keyframeShapeAt(doc, edgeId, shapeIndex, t) {
  const {edge, shape} = needShape(doc, edgeId, shapeIndex);
  const time = checkTime(edge, t);
  let added = 0;
  for (const track of Object.values(shape.tracks)) {
    if (keyframeAt(track, time) >= 0) continue;
    insertKeyframe(track, time);
    added++;
  }
  return added;
}

// Moves keyframe `index` of a property to `t`. Fails when another keyframe of
// the property is there. Returns the keyframe's new index.
export function moveKeyframe(doc, edgeId, shapeIndex, property, index, t) {
  const {edge, shape} = needShape(doc, edgeId, shapeIndex);
  const track = needTrack(shape, property);
  checkKeyframeIndex(track, index);
  const time = checkTime(edge, t);
  const other = keyframeAt(track, time);
  if (other >= 0 && other !== index) fail('This property already has a keyframe at that time');
  const [keyframe] = track.splice(index, 1);
  keyframe.t = time;
  const next = track.findIndex(other => other.t > time);
  const at = next < 0 ? track.length : next;
  track.splice(at, 0, keyframe);
  return at;
}

// Removes keyframe `index`; every property keeps at least one. Returns it.
export function deleteKeyframe(doc, edgeId, shapeIndex, property, index) {
  const {shape} = needShape(doc, edgeId, shapeIndex);
  const track = needTrack(shape, property);
  checkKeyframeIndex(track, index);
  if (track.length <= 1) fail('A property keeps at least one keyframe');
  return track.splice(index, 1)[0];
}

// Sets the speed curve from keyframe `index` toward the next one: four
// numbers as in CSS cubic-bezier, or null for constant speed.
export function setKeyframeCurve(doc, edgeId, shapeIndex, property, index, curve) {
  const {shape} = needShape(doc, edgeId, shapeIndex);
  const track = needTrack(shape, property);
  checkKeyframeIndex(track, index);
  setCurve(track[index], checkCurve(curve));
  return track[index];
}

// Parameters ---------------------------------------------------------------------

export function parameterByName(doc, name) {
  return doc.parameters?.find(parameter => parameter.name === name) ?? null;
}

const needParameter = (doc, name) => parameterByName(doc, name) ?? fail(`There is no parameter named ${name}`);

export function checkParameterName(doc, name, except = null) {
  if (!validParameterName(name)) {
    fail(`Parameter names start with a letter or _, continue with letters, digits or _, have at most 64 characters, and are not ${RESERVED_PARAMETER_NAMES.join(', ')}`);
  }
  if (name !== except && parameterByName(doc, name)) fail(`A parameter named ${name} already exists`);
  return name;
}

// The slider range: both ends finite with min < max, or both left out for
// the default range around the parameter's default.
function checkRange(value, min, max) {
  if (min === undefined && max === undefined) return sliderRange(value);
  if (!isNumber(min) || !isNumber(max) || !(min < max)) fail('A parameter slider runs from a smaller to a larger number');
  return {min, max};
}

// Adds a parameter. Without a name it is called param, param_2, ...
// Returns the parameter: {name, default, min, max}.
export function addParameter(doc, {name, default: value = 0, min, max} = {}) {
  if (!isVectorDocument(doc)) fail('Only a vector animation has parameters');
  if (doc.parameters.length >= MAX_PARAMETERS) fail(`An animation can have at most ${MAX_PARAMETERS} parameters`);
  let chosen = name;
  for (let index = 1; chosen === undefined; index++) {
    const candidate = index === 1 ? 'param' : `param_${index}`;
    if (!parameterByName(doc, candidate)) chosen = candidate;
  }
  checkParameterName(doc, chosen);
  if (!isNumber(value)) fail('A parameter default is a finite number');
  const parameter = {name: chosen, default: value, ...checkRange(value, min, max)};
  doc.parameters.push(parameter);
  return parameter;
}

// Changes the default and the slider range; fields left out keep their value.
export function setParameter(doc, name, {default: value, min, max} = {}) {
  const parameter = needParameter(doc, name);
  const next = {default: value ?? parameter.default, min: min ?? parameter.min, max: max ?? parameter.max};
  if (!isNumber(next.default)) fail('A parameter default is a finite number');
  Object.assign(parameter, next, checkRange(next.default, next.min, next.max));
  return parameter;
}

// Renames a parameter and every assignment to it.
export function renameParameter(doc, name, newName) {
  const parameter = needParameter(doc, name);
  checkParameterName(doc, newName, name);
  parameter.name = newName;
  for (const edge of doc.edges) for (const shape of edge.shapes) for (const assignment of shape.assignments) {
    if (assignment.parameter === name) assignment.parameter = newName;
  }
  return parameter;
}

// Removes a parameter and every assignment to it. Returns {parameter,
// assignments}, the number of assignments removed.
export function deleteParameter(doc, name) {
  const parameter = needParameter(doc, name);
  doc.parameters = doc.parameters.filter(other => other !== parameter);
  let assignments = 0;
  for (const edge of doc.edges) for (const shape of edge.shapes) {
    const kept = shape.assignments.filter(assignment => assignment.parameter !== name);
    assignments += shape.assignments.length - kept.length;
    shape.assignments = kept;
  }
  return {parameter, assignments};
}

function findAssignment(shape, property, parameter) {
  return shape.assignments.findIndex(assignment => assignment.property === property && assignment.parameter === parameter);
}

// Adds `factor × parameter` to a number property of a shape. Returns the
// assignment: {property, parameter, factor}.
export function addAssignment(doc, edgeId, shapeIndex, property, parameter, factor = 1) {
  const {shape} = needShape(doc, edgeId, shapeIndex);
  needTrack(shape, property);
  if (isColorTrack(property)) fail('A colour cannot take a parameter');
  needParameter(doc, parameter);
  if (!isNumber(factor)) fail('A factor is a finite number');
  if (findAssignment(shape, property, parameter) >= 0) fail(`${parameter} is already assigned to ${property}`);
  const assignment = {property, parameter, factor};
  shape.assignments.push(assignment);
  return assignment;
}

export function setAssignmentFactor(doc, edgeId, shapeIndex, property, parameter, factor) {
  const {shape} = needShape(doc, edgeId, shapeIndex);
  const index = findAssignment(shape, property, parameter);
  if (index < 0) fail(`${parameter} is not assigned to ${property}`);
  if (!isNumber(factor)) fail('A factor is a finite number');
  shape.assignments[index].factor = factor;
  return shape.assignments[index];
}

export function removeAssignment(doc, edgeId, shapeIndex, property, parameter) {
  const {shape} = needShape(doc, edgeId, shapeIndex);
  const index = findAssignment(shape, property, parameter);
  if (index < 0) fail(`${parameter} is not assigned to ${property}`);
  return shape.assignments.splice(index, 1)[0];
}

// Onion skin across edges (6.5) ------------------------------------------------
//
// Nodes hold no drawing, so the drawings next to an edge's first and last
// frame are on other edges. `before` lists the edges playback can arrive at
// the edge's start node by, `after` the edges it can leave its end node by,
// each with its frames in the order they play:
// - an edge ending at the node plays forwards into it;
// - a bidirectional edge starting at the node plays backwards into it, so it
//   arrives with its first frame, and it leaves an end node backwards, with
//   its last frame first;
// - a loop on the node both arrives and leaves. The edge itself is listed only
//   when it is a loop, where its own last frame comes before its first.
// Bidirectional is ignored on loops, as the runtime does (2.1).
//
// Playback never passes from one edge to another that shares the node the
// other way round: two edges that both start at it, or both end at it. Their
// drawings next to the node still show the same pose, so they are listed
// too, marked `shares: 'start'` or `shares: 'end'`, with their frames in the
// order they lie away from the node.
export function neighbourEdges(doc, edgeId) {
  const edge = needEdge(doc, edgeId), before = [], after = [];
  for (const other of doc.edges) {
    const apart = !isLoop(other) && other !== edge, backwards = () => other.frames.slice().reverse();
    if (other.to === edge.from) before.push({edge: other.id, reversed: false, frames: other.frames.slice()});
    else if (apart && other.from === edge.from) before.push({edge: other.id, reversed: true, frames: backwards(), ...(other.bidirectional ? {} : {shares: 'start'})});
    if (other.from === edge.to) after.push({edge: other.id, reversed: false, frames: other.frames.slice()});
    else if (apart && other.to === edge.to) after.push({edge: other.id, reversed: true, frames: backwards(), ...(other.bidirectional ? {} : {shares: 'end'})});
  }
  return {before, after};
}

// The onion ghosts around the frame at `index` of an edge: up to `count`
// previous and `count` next frame ids. Past the start of the edge the
// previous ghosts continue with the last frames of `before` (an entry of
// neighbourEdges, a list of entries, or null for none); past its end the
// next ghosts continue with the first frames of `after`. With several
// entries every one of them gives its frame at each distance. Returns
// [{id, side, distance}], where side is 'previous' or 'next' and distance
// counts from 1; a frame is listed once per side, at its nearest distance.
export function onionGhosts(doc, edgeId, index, {count = 1, before = null, after = null} = {}) {
  const frames = needEdge(doc, edgeId).frames, ghosts = [];
  const entries = value => value ? [].concat(value) : [];
  const add = (side, own, others) => {
    const seen = new Set();
    for (let distance = 1; distance <= count; distance++) {
      const ids = own(distance) !== undefined ? [own(distance)] : others(distance).filter(id => id !== undefined);
      for (const id of ids) if (!seen.has(id)) { seen.add(id);ghosts.push({id, side, distance}); }
    }
  };
  add('previous', distance => frames[index - distance], distance => entries(before).map(entry => entry.frames[entry.frames.length + index - distance]));
  add('next', distance => frames[index + distance], distance => entries(after).map(entry => entry.frames[index + distance - frames.length]));
  return ghosts;
}

// What playback cannot do well in this graph (6.4), using the machine's own
// routing table so the warning matches what the runtime does:
// - unreachable: for each state, in id order, the states it has no route to.
//   Requesting one of them from there cuts to it without a transition.
// - noLoop: states without a loop. Resting there shows nothing.
export function graphWarnings(doc) {
  const nodes = [...doc.nodes].sort((a, b) => a.id - b.id);
  const graph = buildGraph({fps: doc.fps, nodes, edges: doc.edges});
  const unreachable = [];
  nodes.forEach((node, from) => {
    const to = nodes.filter((_, index) => index !== from && distance(graph, from, index) === null).map(other => other.id);
    if (to.length) unreachable.push({from: node.id, to});
  });
  const looped = new Set(doc.edges.filter(isLoop).map(edge => edge.from));
  return {unreachable, noLoop: nodes.filter(node => !looped.has(node.id)).map(node => node.id)};
}

// List items from GET /api/animations, grouped in the order of `folders`.
// Folders without items are kept so the list can show where files would go.
export function groupByFolder(items, folders) {
  const groups = folders.map(folder => ({folder, items: []}));
  const byId = new Map(groups.map(group => [group.folder.id, group]));
  for (const item of items) {
    let group = byId.get(item.folder);
    if (!group) {
      group = {folder: {id: item.folder, name: item.library ?? item.folder}, items: []};
      byId.set(item.folder, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

// The first free name of the form `base`, `base 2`, `base 3` ... that fits
// the 64-character limit. Names compare without case, because the host's
// folders may be on case-insensitive volumes.
export function uniqueName(base, taken) {
  const used = new Set([...taken].map(name => name.toLowerCase()));
  for (let index = 1; ; index++) {
    const suffix = index === 1 ? '' : ' ' + index;
    const name = base.slice(0, 64 - suffix.length).trimEnd() + suffix;
    if (!used.has(name.toLowerCase())) return name;
  }
}
