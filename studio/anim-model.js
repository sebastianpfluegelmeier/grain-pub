// The animation document and its edits (docs/animation-graph-plan.md 6.2).
// Every edit is a plain function on the in-memory document from
// anim-format.js, so it can be tested without a DOM. The view records edits
// in a history created here, which stores metadata before and after plus
// copies of only the frames an edit touched (6.8).

import {FORMAT_BYTES, MAX_SIDE, MAX_NODES, MAX_EDGES, MAX_NODE_ID, MAX_FRAMES, MAX_PIXEL_BYTES, MAX_EDGE_FRAMES, validNodeName} from './anim-format.js';
import {buildGraph, distance} from './anim-machine.js';
import {isBlank, tweenFrame} from './anim-paint.js';

export const FORMATS = ['image', 'matte', 'field'];
export const MAX_FPS = 60;
export const HISTORY_ENTRIES = 100;
export const HISTORY_BYTES = 64 * 1024 * 1024;
export const EXTENSION = '.grainanim';

const fail = message => { throw new Error(message); };
const wholeIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

// File names follow the node-name rule, which the host enforces for new files.
export function validAnimationName(name) {
  return validNodeName(name);
}

export function checkAnimationName(name) {
  if (!validAnimationName(name)) fail('Animation names use 1 to 64 letters, digits, spaces, _ or -, without a leading or trailing space');
  return name;
}

// A new asset has no states yet. The format accepts that, so the empty file can
// be saved before the graph view adds the first node.
export function newAnimation({format = 'image', width = 64, height = 64, fps = 12} = {}) {
  if (!FORMATS.includes(format)) fail('Choose image, matte or field as the pixel format');
  if (!wholeIn(width, 1, MAX_SIDE) || !wholeIn(height, 1, MAX_SIDE)) fail(`Width and height are whole numbers from 1 to ${MAX_SIDE}`);
  checkFps(fps);
  return {format, width, height, fps, nodes: [], edges: [], nextNodeId: 0, nextEdgeId: 0, palette: [], pixels: new Map()};
}

function checkFps(fps) {
  if (!wholeIn(fps, 1, MAX_FPS)) fail(`Drawings per second is a whole number from 1 to ${MAX_FPS}`);
}

export function setFps(doc, fps) {
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
// Returns the change's result, or undefined when nothing changed.
export function recordEdit(history, doc, change, {frames = [], before = new Map(), label = ''} = {}) {
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
  const entry = {label, before: metadataBefore, after: metadataAfter, frames: changedFrames};
  entry.bytes = entryBytes(entry);
  for (const dropped of history.redo.splice(0)) history.bytes -= dropped.bytes;
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

export const isLoop = edge => edge.from === edge.to;

export function loopsOf(doc, id) {
  return doc.edges.filter(edge => edge.from === id && edge.to === id);
}

export function edgesOf(doc, id) {
  return doc.edges.filter(edge => edge.from === id || edge.to === id);
}

export function checkNodeName(doc, name, exceptId = null) {
  if (!validNodeName(name)) fail('State names use 1 to 64 letters, digits, spaces, _ or -, without a leading or trailing space');
  // Names are case-sensitive in the file and in code, so `Idle` and `idle` are two states.
  if (doc.nodes.some(node => node.name === name && node.id !== exceptId)) fail(`A state named ${name} already exists`);
  return name;
}

// The first free `state`, `state 2`, ... name.
export function defaultNodeName(doc) {
  return uniqueName('state', doc.nodes.map(node => node.name));
}

function coordinate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('State positions must be finite numbers');
  return Math.round(Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, value)));
}

// Ids are assigned in creation order and never reused (2.1), so a deleted
// state's id stays taken even when it was the last one.
export function addNode(doc, {name = defaultNodeName(doc), x = 0, y = 0} = {}) {
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

// Frames in the saved pool: every distinct frame id an edge refers to.
export function poolSize(doc) {
  return new Set(doc.edges.flatMap(edge => edge.frames)).size;
}

// One above every frame id in use or kept for undo.
export function newFrameId(doc) {
  let next = 0;
  for (const id of doc.pixels.keys()) next = Math.max(next, id + 1);
  for (const edge of doc.edges) for (const id of edge.frames) next = Math.max(next, id + 1);
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
// (6.4). `from === to` makes a loop.
export function addEdge(doc, from, to) {
  needNode(doc, from);
  needNode(doc, to);
  checkRoomForEdge(doc, 1);
  const frame = newFrameId(doc);
  doc.pixels.set(frame, blankFrame(doc));
  const edge = {id: doc.nextEdgeId, from, to, bidirectional: false, cancelable: false, frames: [frame]};
  doc.edges.push(edge);
  doc.nextEdgeId++;
  return edge;
}

// Turns the arrow around and reverses the frame order with it, so every
// drawing stays next to the state it was drawn against: the edge now shows
// what playing it backwards showed before.
export function reverseEdge(doc, id) {
  const edge = needEdge(doc, id);
  if (isLoop(edge)) fail('A loop starts and ends at the same state, so it has no direction to reverse');
  [edge.from, edge.to] = [edge.to, edge.from];
  edge.frames.reverse();
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
// after the original. Parallel edges are allowed (2.1).
export function duplicateEdge(doc, id) {
  const edge = needEdge(doc, id);
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
export function addFrame(doc, edgeId, index = needEdge(doc, edgeId).frames.length) {
  const edge = needEdge(doc, edgeId);
  checkPosition(edge, index, edge.frames.length);
  checkRoomForFrame(doc, edge);
  const id = newFrameId(doc);
  doc.pixels.set(id, blankFrame(doc));
  edge.frames.splice(index, 0, id);
  return {id, index};
}

// Inserts a copy of the frame at `index` right after it. Returns {id, index}.
export function duplicateFrame(doc, edgeId, index) {
  const edge = needEdge(doc, edgeId);
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
  const edge = needEdge(doc, edgeId);
  checkPosition(edge, index);
  if (edge.frames.length <= 1) fail('An edge needs at least one frame');
  return edge.frames.splice(index, 1)[0];
}

// Moves the frame at `from` so it ends up at position `to`. Returns `to`.
export function moveFrame(doc, edgeId, from, to) {
  const edge = needEdge(doc, edgeId);
  checkPosition(edge, from);
  checkPosition(edge, to);
  edge.frames.splice(to, 0, ...edge.frames.splice(from, 1));
  return to;
}

// Tween (6.6) ----------------------------------------------------------------

// The frames a tween from the frame at `index` would fill: the blank frames
// after it, up to the next drawn frame. Returns {start, end, ids}, where
// `ids` are the frame ids to fill. Throws when there is nothing to fill.
export function tweenSpan(doc, edgeId, index) {
  const edge = needEdge(doc, edgeId);
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
  const span = tweenSpan(doc, edgeId, index), edge = needEdge(doc, edgeId);
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
// frame id of `doc.pixels` as the edit's frames. Returns the new size.
export function resizeAnimation(doc, width, height, anchor = 'center') {
  if (!wholeIn(width, 1, MAX_SIDE) || !wholeIn(height, 1, MAX_SIDE)) fail(`Width and height are whole numbers from 1 to ${MAX_SIDE}`);
  if (!ANCHORS.includes(anchor)) fail('Choose one of the nine anchors');
  if (width === doc.width && height === doc.height) return {width, height};
  if (poolSize(doc) * width * height * FORMAT_BYTES[doc.format] > MAX_PIXEL_BYTES) fail('The frames of this animation would exceed 32 MiB');
  const n = FORMAT_BYTES[doc.format];
  const horizontal = anchor.includes('left') ? 0 : anchor.includes('right') ? 1 : 0.5;
  const vertical = anchor.includes('top') ? 0 : anchor.includes('bottom') ? 1 : 0.5;
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
