// Playback machine for animation graphs, ported line by line from
// src/animgraph.rs (docs/animation-graph-plan.md section 2.3, and section 11
// of docs/vector-animation-design.md for vector animations). The editor
// preview must show what the renderer shows, so both ports run the vectors in
// tests/fixtures/animgraph; change them together.

export const MAX_STEPS_PER_TICK = 4096;
// Vector edges advance by time, so one long rendered frame can pass the end of
// many short edges; at most this many start per rendered frame.
export const MAX_EDGE_STARTS_PER_TICK = 4096;
// Frame times computed as frame / fps make dt × fps × rate come out a few
// rounding steps below the whole number it stands for. An accumulator within
// this distance below a whole number counts as that whole number, as in
// src/animgraph.rs.
export const ACCUMULATOR_TOLERANCE = 1e-9;
export const MAX_RATE = 64;
export const MAX_NODE_ID = 65535;
// xorshift32 never leaves 0, so a zero seed is replaced by this constant.
export const ZERO_SEED_REPLACEMENT = 0x9E3779B9;
const UNREACHABLE = 0xFFFFFFFF;

// Builds the lookups the machine needs from metadata or an editor document
// (both have fps, nodes and edges with the same field names). Vector metadata
// and documents have no fps, and their edges a length instead of frames; the
// graph's fps is then null. The input is assumed valid; anim-format.js
// validates files.
export function buildGraph({fps, nodes, edges}) {
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]));
  const edgeEnds = edges.map(edge => [indexOf.get(edge.from), indexOf.get(edge.to)]);
  return {fps: typeof fps === 'number' ? fps : null, nodes, edges, edgeEnds, distances: buildDistances(nodes.length, edges, edgeEnds)};
}

export const isVector = graph => graph.fps === null;

// What urgency classes and route ties compare (rules 7 and 8): the number of
// drawings of a pixel edge, the length of a vector edge.
const span = (graph, edge) => isVector(graph) ? graph.edges[edge].length : graph.edges[edge].frames.length;

export function nodeIndex(graph, id) {
  const index = graph.nodes.findIndex(node => node.id === id);
  return index < 0 ? null : index;
}

// Fewest edges between nodes, by node index; bidirectional edges count both
// ways and loops are skipped.
function buildDistances(count, edges, edgeEnds) {
  const neighbours = Array.from({length: count}, () => []);
  edges.forEach((edge, index) => {
    const [from, to] = edgeEnds[index];
    if (from === to) return;
    neighbours[from].push(to);
    if (edge.bidirectional) neighbours[to].push(from);
  });
  const table = new Uint32Array(count * count).fill(UNREACHABLE);
  for (let source = 0; source < count; source++) {
    const row = source * count;
    table[row + source] = 0;
    const queue = [source];
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head];
      for (const next of neighbours[node]) {
        if (table[row + next] === UNREACHABLE) {
          table[row + next] = table[row + node] + 1;
          queue.push(next);
        }
      }
    }
  }
  return {count, table};
}

export function distance(graph, from, to) {
  const value = graph.distances.table[from * graph.distances.count + to];
  return value === UNREACHABLE ? null : value;
}

// FNV-1a 64 over the same bytes as Graph::structure_hash in Rust: a vector
// edge contributes the bits of its length in place of the frame count.
// Returns a 16-digit hex string.
export function structureHash(graph) {
  let hash = 0xcbf29ce484222325n;
  const mask = (1n << 64n) - 1n;
  const byte = value => { hash = ((hash ^ BigInt(value)) * 0x100000001b3n) & mask; };
  const u32 = value => { for (let i = 0; i < 4; i++) byte((value >>> (8 * i)) & 0xff); };
  const bits = new DataView(new ArrayBuffer(8));
  const f64 = value => { bits.setFloat64(0, value, true); for (let i = 0; i < 8; i++) byte(bits.getUint8(i)); };
  u32(graph.nodes.length);
  for (const node of graph.nodes) u32(node.id);
  u32(graph.edges.length);
  for (const edge of graph.edges) {
    u32(edge.id); u32(edge.from); u32(edge.to);
    byte((edge.bidirectional ? 1 : 0) | (edge.cancelable ? 2 : 0));
    if (isVector(graph)) f64(edge.length);
    else u32(edge.frames.length);
  }
  return hash.toString(16).padStart(16, '0');
}

export function xorshift32(x) {
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

// Fisher-Yates from the last index down, drawing next % (i + 1). Shuffles
// items in place and returns the advanced generator state.
export function shuffle(items, rng) {
  for (let i = items.length - 1; i >= 1; i--) {
    rng = xorshift32(rng);
    const j = rng % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return rng;
}

// position: {kind: 'unplaced'} | {kind: 'resting', node} |
// {kind: 'edge', edge, step, reversed, time}, with node and edge as indices.
// `step` (pixel edges) and `time` (vector edges, in seconds) count in play
// order: a reversed edge shows its frames from the last one back and its
// keyframes from the end. The other one stays 0.
export function createMachineState(seed) {
  return {
    position: {kind: 'unplaced'},
    accumulator: 0,
    request: null,
    loop: true,
    rng: (seed >>> 0) === 0 ? ZERO_SEED_REPLACEMENT : seed >>> 0,
    rotations: new Map(),
  };
}

function cloneState(state) {
  const rotations = new Map();
  for (const [key, rotation] of state.rotations) rotations.set(key, {last: rotation.last, bag: rotation.bag.slice()});
  return {...state, position: {...state.position}, rotations};
}

const clampInput = (value, min, max) => Number.isNaN(value) ? min : Math.min(max, Math.max(min, value));
const isLoop = (graph, edge) => graph.edgeEnds[edge][0] === graph.edgeEnds[edge][1];

// Rule 1: a string must match a name exactly; a number is rounded half away
// from zero, matching Rust's f64::round, and must match a node id.
function resolve(graph, request) {
  if (typeof request === 'string') {
    // The empty string is no name, so it never matches an unnamed state.
    const index = request === '' ? -1 : graph.nodes.findIndex(node => node.name === request);
    return index < 0 ? null : index;
  }
  if (typeof request !== 'number' || !Number.isFinite(request)) return null;
  const rounded = Math.sign(request) * Math.round(Math.abs(request));
  if (!(rounded >= 0 && rounded <= MAX_NODE_ID)) return null;
  return nodeIndex(graph, rounded);
}

// Advances the machine by one rendered frame. inputs: {state, urgency, rate,
// loop, randomize}; missing optional fields take the builtin's defaults.
// Returns {state, frame, time}: frame is a pool index (or frame id for an
// editor document), or null for empty output and on vector edges; time is
// currentTime on vector edges, otherwise null. The input state is not
// modified.
export function tick(graph, state, inputs, dt) {
  const looping = inputs.loop ?? true;
  const next = cloneState(state);
  const target = resolve(graph, inputs.state) ?? state.request;
  if (target === null) {
    next.loop = looping;
    return {state: next, frame: null, time: null};
  }
  const machine = {
    graph, state: next, target,
    urgency: clampInput(inputs.urgency ?? 1, 0, 1),
    loop: looping,
    randomize: inputs.randomize ?? false,
  };
  const position = next.position;
  if (position.kind === 'unplaced') {
    // Rule 2: place without a transition; the placing frame does not advance
    // time, like any other interruption (rule 5).
    decide(machine, target);
    next.accumulator = 0;
  } else {
    const nodeChanged = state.request !== target;
    const loopChanged = state.loop !== looping;
    let interruptAt = null;
    if (position.kind === 'edge' && graph.edges[position.edge].cancelable) {
      const cut = nodeChanged || (isLoop(graph, position.edge) && loopChanged && !looping);
      if (cut) interruptAt = arrival(graph, position.edge, position.reversed);
    } else if (position.kind === 'resting' && (nodeChanged || loopChanged)) {
      interruptAt = position.node;
    }
    if (interruptAt !== null) {
      decide(machine, interruptAt);
      next.accumulator = 0;
    } else {
      advance(machine, dt, clampInput(inputs.rate ?? 1, 0, MAX_RATE));
    }
  }
  next.request = target;
  next.loop = looping;
  return {state: next, frame: currentFrame(graph, next), time: currentTime(graph, next)};
}

// The time on the playing vector edge in seconds, measured in the edge's own
// direction, so a reversed edge counts down from its length. null while
// nothing plays and for pixel animations.
export function currentTime(graph, state) {
  const position = state.position;
  if (position.kind !== 'edge' || !isVector(graph)) return null;
  return position.reversed ? graph.edges[position.edge].length - position.time : position.time;
}

// Rule 3: whole units of dt × fps × rate become steps, at most 4096 per
// rendered frame; the excess whole units are dropped, the fraction kept.
function advance(machine, dt, rate) {
  const {graph, state} = machine;
  dt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (isVector(graph)) {
    advanceSeconds(machine, dt * rate);
    return;
  }
  let accumulator = state.accumulator + dt * graph.fps * rate;
  let steps;
  if (Number.isFinite(accumulator)) {
    const whole = Math.floor(accumulator + ACCUMULATOR_TOLERANCE);
    // Not negative when the tolerance rounded up.
    accumulator = Math.max(0, accumulator - whole);
    steps = whole >= MAX_STEPS_PER_TICK ? MAX_STEPS_PER_TICK : whole;
  } else {
    accumulator = 0;
    steps = MAX_STEPS_PER_TICK;
  }
  state.accumulator = accumulator;
  for (let i = 0; i < steps; i++) {
    // Resting is only left through a request change, never by time.
    if (state.position.kind !== 'edge') break;
    step(machine);
  }
}

// Vector edges: `seconds` move along the playing edge. Time left at the end of
// an edge carries into the next one, and at most 4096 edges start per
// rendered frame; the time left after that is dropped.
function advanceSeconds(machine, seconds) {
  let started = 0;
  while (machine.state.position.kind === 'edge') {
    const position = machine.state.position;
    const left = machine.graph.edges[position.edge].length - position.time;
    if (seconds < left) {
      machine.state.position = {...position, time: position.time + seconds};
      return;
    }
    if (started === MAX_EDGE_STARTS_PER_TICK) return;
    seconds -= left;
    decide(machine, arrival(machine.graph, position.edge, position.reversed));
    started++;
  }
}

// Rule 4: one drawing forward; past the last frame, arrive and decide.
function step(machine) {
  const position = machine.state.position;
  if (position.kind !== 'edge') return;
  if (position.step + 1 < machine.graph.edges[position.edge].frames.length) {
    machine.state.position = {...position, step: position.step + 1};
  } else {
    decide(machine, arrival(machine.graph, position.edge, position.reversed));
  }
}

// The node an edge arrives at in its travel direction.
function arrival(graph, edge, reversed) {
  const [from, to] = graph.edgeEnds[edge];
  return reversed ? from : to;
}

// Rule 6 at node `node`.
function decide(machine, node) {
  if (node !== machine.target) {
    const hop = nextHop(machine, node);
    if (hop) {
      start(machine, hop.edge, hop.reversed);
      return;
    }
    // No route: cut to the requested node.
    node = machine.target;
  }
  if (machine.loop) {
    const edge = pickLoop(machine, node);
    if (edge !== null) {
      start(machine, edge, false);
      return;
    }
  }
  machine.state.position = {kind: 'resting', node};
}

function start(machine, edge, reversed) {
  machine.state.position = {kind: 'edge', edge, step: 0, reversed, time: 0};
}

// Rule 7: among neighbours one edge closer to the target, prefer the one whose
// picked length class is shortest, then the lowest node id.
function nextHop(machine, node) {
  const {graph, target} = machine;
  const remaining = distance(graph, node, target);
  if (remaining === null) return null;
  let best = null;
  for (let neighbour = 0; neighbour < graph.nodes.length; neighbour++) {
    if (neighbour === node || distance(graph, neighbour, target) !== remaining - 1) continue;
    const found = transitionClass(machine, node, neighbour);
    if (!found) continue;
    const id = graph.nodes[neighbour].id;
    if (!best || found.span < best.span || (found.span === best.span && id < best.id)) {
      best = {span: found.span, id, neighbour, members: found.members};
    }
  }
  if (!best) return null;
  const key = `T:${node}:${best.neighbour}:${best.span}`;
  const edge = rotate(machine, key, best.members);
  const [from, to] = graph.edgeEnds[edge];
  return {edge, reversed: !(from === node && to === best.neighbour)};
}

// Rule 8: the length class urgency selects among the edges that can be
// travelled from `from` to `to`. Returns the class's span (frame count or
// length) and its members sorted by edge id.
function transitionClass(machine, from, to) {
  const {graph} = machine;
  const edges = [];
  graph.edges.forEach((edge, index) => {
    const [a, b] = graph.edgeEnds[index];
    if ((a === from && b === to) || (edge.bidirectional && a === to && b === from)) edges.push(index);
  });
  const lengths = [...new Set(edges.map(edge => span(graph, edge)))].sort((a, b) => a - b);
  if (lengths.length === 0) return null;
  // Halves round toward the shorter class: ceil(x - 0.5).
  const position = (1 - machine.urgency) * (lengths.length - 1);
  const index = Math.min(Math.max(Math.ceil(position - 0.5), 0), lengths.length - 1);
  const length = lengths[index];
  const members = edges
    .filter(edge => span(graph, edge) === length)
    .sort((a, b) => graph.edges[a].id - graph.edges[b].id);
  return {span: length, members};
}

// Rule 9: rotate among all loops of `node`; urgency does not apply.
function pickLoop(machine, node) {
  const {graph} = machine;
  const loops = [];
  graph.edgeEnds.forEach(([from, to], index) => { if (from === node && to === node) loops.push(index); });
  if (loops.length === 0) return null;
  loops.sort((a, b) => graph.edges[a].id - graph.edges[b].id);
  return rotate(machine, `L:${node}`, loops);
}

// Rule 10. `members` is non-empty and sorted by edge id.
function rotate(machine, key, members) {
  const {graph, state} = machine;
  let rotation = state.rotations.get(key);
  if (!rotation) state.rotations.set(key, rotation = {last: null, bag: []});
  let edge;
  if (machine.randomize) {
    if (rotation.bag.length === 0) {
      rotation.bag = members.slice();
      state.rng = shuffle(rotation.bag, state.rng);
      const last = rotation.bag.length - 1;
      if (last > 0 && rotation.bag[0] === rotation.last) {
        [rotation.bag[0], rotation.bag[last]] = [rotation.bag[last], rotation.bag[0]];
      }
    }
    edge = rotation.bag.shift();
  } else if (rotation.last === null) {
    edge = members[0];
  } else {
    const lastId = graph.edges[rotation.last].id;
    edge = members.find(member => graph.edges[member].id > lastId) ?? members[0];
  }
  rotation.last = edge;
  return edge;
}

export function currentFrame(graph, state) {
  const position = state.position;
  if (position.kind !== 'edge' || isVector(graph)) return null;
  const frames = graph.edges[position.edge].frames;
  return frames[position.reversed ? frames.length - 1 - position.step : position.step];
}
