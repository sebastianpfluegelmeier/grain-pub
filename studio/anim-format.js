// Encode and decode .grainanim files (docs/animation-graph-plan.md section 3).
// Validation matches parse_header and parse_metadata in src/animgraph.rs; the
// shared cases in tests/fixtures/animgraph/validation keep the two in step.

export const MAGIC = 'TGAG';
export const VERSION = 1;
export const HEADER_LEN = 20;
export const MAX_SIDE = 512;
export const MAX_FRAMES = 4096;
export const MAX_PIXEL_BYTES = 32 * 1024 * 1024;
export const MAX_METADATA_BYTES = 1024 * 1024;
export const MAX_NODES = 256;
export const MAX_EDGES = 1024;
export const MAX_NODE_ID = 65535;
export const MAX_EDGE_FRAMES = 1024;
export const MAX_NAME_LEN = 64;
export const FORMAT_BYTES = {field: 1, matte: 2, image: 4};
const FORMAT_NAMES = {1: 'field', 2: 'matte', 4: 'image'};
const NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;

const fail = message => { throw new Error(message); };
// Any integral number is accepted, so 12 and 12.0 read the same here and in
// Rust, where serde_json keeps them apart.
const integerIn = (value, min, max) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validNodeName(name) {
  return typeof name === 'string' && name.length >= 1 && name.length <= MAX_NAME_LEN
    && NAME_PATTERN.test(name) && !name.startsWith(' ') && !name.endsWith(' ');
}

// Reads the fixed header. The total length is checked by decodeAnimation.
export function parseHeader(bytes) {
  if (bytes.length < HEADER_LEN) fail('animation file is shorter than its 20-byte header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC) fail('not an animation graph file (magic is not TGAG)');
  const version = view.getUint16(4, true);
  if (version !== VERSION) fail(`unsupported animation format version ${version}`);
  const format = FORMAT_NAMES[bytes[6]] ?? fail(`unknown animation pixel format ${bytes[6]}`);
  if (bytes[7] !== 0) fail('animation header reserved byte is not 0');
  const header = {
    format,
    width: view.getUint16(8, true),
    height: view.getUint16(10, true),
    frameCount: view.getUint32(12, true),
    metadataLength: view.getUint32(16, true),
  };
  for (const label of ['width', 'height']) {
    if (header[label] < 1 || header[label] > MAX_SIDE) fail(`animation ${label} ${header[label]} is outside 1..${MAX_SIDE}`);
  }
  if (header.frameCount > MAX_FRAMES) fail(`animation has ${header.frameCount} frames, more than ${MAX_FRAMES}`);
  if (frameBytes(header) * header.frameCount > MAX_PIXEL_BYTES) fail('animation pixels exceed 32 MiB');
  if (header.metadataLength > MAX_METADATA_BYTES) fail('animation metadata exceeds 1 MiB');
  return header;
}

export function frameBytes({format, width, height}) {
  return width * height * FORMAT_BYTES[format];
}

// Checks parsed metadata against section 3.3. `frameCount` is the pool size.
export function validateMetadata(meta, frameCount) {
  if (!isObject(meta)) fail('animation metadata must be a JSON object');
  for (const key of ['fps', 'nodes', 'edges']) if (!(key in meta)) fail(`animation metadata is missing \`${key}\``);
  if (!integerIn(meta.fps, 1, 60)) fail('animation fps must be an integer from 1 to 60');
  if (!Array.isArray(meta.nodes)) fail('animation metadata `nodes` must be an array');
  if (!Array.isArray(meta.edges)) fail('animation metadata `edges` must be an array');
  for (const node of meta.nodes) {
    if (!isObject(node)) fail('animation node must be an object');
    if (!('id' in node)) fail('animation metadata is missing `id`');
    if (!integerIn(node.id, 0, MAX_NODE_ID)) fail('animation node id must be an integer from 0 to 65535');
    if (!('name' in node)) fail('animation metadata is missing `name`');
    if (typeof node.name !== 'string') fail('animation node name must be a string');
  }
  for (const edge of meta.edges) {
    if (!isObject(edge)) fail('animation edge must be an object');
    for (const key of ['id', 'from', 'to', 'frames', 'bidirectional', 'cancelable']) {
      if (!(key in edge)) fail(`animation metadata is missing \`${key}\``);
    }
    if (!integerIn(edge.id, 0, 0xFFFFFFFF)) fail('animation edge id must be a non-negative 32-bit integer');
    for (const key of ['from', 'to']) {
      if (!integerIn(edge[key], 0, MAX_NODE_ID)) fail(`animation edge ${edge.id} \`${key}\` is not a node id`);
    }
    if (!Array.isArray(edge.frames)) fail(`animation edge ${edge.id} \`frames\` must be an array`);
    for (const frame of edge.frames) {
      if (!integerIn(frame, 0, frameCount - 1)) fail(`animation edge ${edge.id} refers to a frame outside the ${frameCount}-frame pool`);
    }
    for (const key of ['bidirectional', 'cancelable']) {
      if (typeof edge[key] !== 'boolean') fail(`animation edge \`${key}\` must be true or false`);
    }
  }
  if (meta.nodes.length > MAX_NODES) fail(`animation has more than ${MAX_NODES} nodes`);
  if (meta.edges.length > MAX_EDGES) fail(`animation has more than ${MAX_EDGES} edges`);
  const ids = new Set(), names = new Set();
  for (const node of meta.nodes) {
    if (!validNodeName(node.name)) fail(`animation node name \`${node.name}\` is not allowed`);
    if (ids.has(node.id)) fail(`animation node id ${node.id} is used twice`);
    if (names.has(node.name)) fail(`animation node name \`${node.name}\` is used twice`);
    ids.add(node.id); names.add(node.name);
  }
  const edgeIds = new Set();
  for (const edge of meta.edges) {
    if (edgeIds.has(edge.id)) fail(`animation edge id ${edge.id} is used twice`);
    edgeIds.add(edge.id);
    if (edge.frames.length < 1 || edge.frames.length > MAX_EDGE_FRAMES) fail(`animation edge ${edge.id} must have 1 to ${MAX_EDGE_FRAMES} frames`);
    if (!ids.has(edge.from)) fail(`animation edge ${edge.id} starts at a missing node`);
    if (!ids.has(edge.to)) fail(`animation edge ${edge.id} ends at a missing node`);
  }
}

// Decodes a file into the editor document of section 6.2. Frame ids are the
// pool indices; every pool frame is kept, referenced or not. Image frames are
// Uint8ClampedArray so they can back an ImageData directly.
export function decodeAnimation(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const header = parseHeader(bytes);
  const size = frameBytes(header);
  const expected = HEADER_LEN + header.metadataLength + size * header.frameCount;
  if (bytes.length !== expected) fail(`animation file is ${bytes.length} bytes, expected ${expected}`);
  let meta;
  try {
    // ignoreBOM keeps a leading byte order mark in the text so JSON.parse
    // rejects it, as serde_json does.
    const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes.subarray(HEADER_LEN, HEADER_LEN + header.metadataLength));
    meta = JSON.parse(text);
  } catch (error) {
    fail(`animation metadata is not valid JSON: ${error.message}`);
  }
  validateMetadata(meta, header.frameCount);
  // Editor-only fields are ignored by the runtime, so missing or malformed
  // values get defaults here instead of rejecting a file Rust accepts.
  const coordinate = value => typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const nodes = meta.nodes.map(node => ({id: node.id, name: node.name, x: coordinate(node.x), y: coordinate(node.y)}));
  const edges = meta.edges.map(edge => ({
    id: edge.id, from: edge.from, to: edge.to,
    bidirectional: edge.bidirectional, cancelable: edge.cancelable,
    frames: edge.frames.slice(),
  }));
  const nextId = (value, items) => Math.max(Number.isInteger(value) ? value : 0, ...items.map(item => item.id + 1));
  const Pixels = header.format === 'image' ? Uint8ClampedArray : Uint8Array;
  const pixels = new Map();
  const start = HEADER_LEN + header.metadataLength;
  for (let index = 0; index < header.frameCount; index++) {
    pixels.set(index, new Pixels(bytes.slice(start + index * size, start + (index + 1) * size).buffer));
  }
  return {
    format: header.format,
    width: header.width,
    height: header.height,
    fps: meta.fps,
    nodes,
    edges,
    nextNodeId: nextId(meta.next_node_id, nodes),
    nextEdgeId: nextId(meta.next_edge_id, edges),
    palette: Array.isArray(meta.palette) ? meta.palette.filter(color => typeof color === 'string') : [],
    pixels,
  };
}

// Encodes an editor document. Pool indices follow first use in edge order and
// frame order, so a frame id used twice is stored once; unreferenced frames
// are dropped.
export function encodeAnimation(doc) {
  const formatByte = FORMAT_BYTES[doc.format] ?? fail(`unknown animation pixel format ${doc.format}`);
  for (const label of ['width', 'height']) {
    if (!integerIn(doc[label], 1, MAX_SIDE)) fail(`animation ${label} ${doc[label]} is outside 1..${MAX_SIDE}`);
  }
  const pool = new Map();
  for (const edge of doc.edges) {
    for (const frame of edge.frames) if (!pool.has(frame)) pool.set(frame, pool.size);
  }
  const meta = {
    fps: doc.fps,
    nodes: doc.nodes.map(node => ({id: node.id, name: node.name, x: node.x ?? 0, y: node.y ?? 0})),
    edges: doc.edges.map(edge => ({
      id: edge.id, from: edge.from, to: edge.to,
      bidirectional: edge.bidirectional, cancelable: edge.cancelable,
      frames: edge.frames.map(frame => pool.get(frame)),
    })),
    next_node_id: doc.nextNodeId,
    next_edge_id: doc.nextEdgeId,
    palette: doc.palette ?? [],
  };
  if (pool.size > MAX_FRAMES) fail(`animation has ${pool.size} frames, more than ${MAX_FRAMES}`);
  validateMetadata(meta, pool.size);
  const size = frameBytes(doc);
  if (size * pool.size > MAX_PIXEL_BYTES) fail('animation pixels exceed 32 MiB');
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  if (metaBytes.length > MAX_METADATA_BYTES) fail('animation metadata exceeds 1 MiB');
  const out = new Uint8Array(HEADER_LEN + metaBytes.length + size * pool.size);
  const view = new DataView(out.buffer);
  out.set([...MAGIC].map(char => char.charCodeAt(0)), 0);
  view.setUint16(4, VERSION, true);
  out[6] = formatByte;
  out[7] = 0;
  view.setUint16(8, doc.width, true);
  view.setUint16(10, doc.height, true);
  view.setUint32(12, pool.size, true);
  view.setUint32(16, metaBytes.length, true);
  out.set(metaBytes, HEADER_LEN);
  const start = HEADER_LEN + metaBytes.length;
  for (const [frame, index] of pool) {
    const data = doc.pixels.get(frame);
    if (!data) fail(`animation frame ${frame} has no pixels`);
    if (data.length !== size) fail(`animation frame ${frame} has ${data.length} bytes, expected ${size}`);
    out.set(data, start + index * size);
  }
  return out;
}
