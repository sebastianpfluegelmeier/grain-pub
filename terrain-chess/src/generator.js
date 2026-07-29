// Terrain Chess — board generator.
//
// Prototype boards were pure random assignment. This is the "desired generator"
// from the design doc: model the board as a movement graph (a node per square,
// a directed edge per legal movement) and only accept boards that are
// strongly connected with reasonable average mobility. Invalid boards are
// regenerated; the best attempt is kept if the budget runs out.

import { SIZE, TERRAIN } from './rules.js';

// Deterministic PRNG (mulberry32) so a seed reproduces a board exactly.
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

// Weighted distribution (design doc "Open Questions"): high-mobility terrain is
// rare, so it becomes a strategic objective. Weights sum is arbitrary.
export const WEIGHTS = { P: 34, K: 22, N: 16, B: 14, R: 9, Q: 5 };

function pickTerrain(rng, weighted) {
  if (!weighted) return TERRAIN[Math.floor(rng() * TERRAIN.length)];
  const total = TERRAIN.reduce((s, t) => s + WEIGHTS[t], 0);
  let x = rng() * total;
  for (const t of TERRAIN) {
    x -= WEIGHTS[t];
    if (x < 0) return t;
  }
  return 'P';
}

// Edges of the movement graph: from every square, where could a piece go on an
// otherwise-empty board? Occupancy is ignored — this measures the terrain's
// raw reach. Pawns are direction-dependent per player, so for connectivity we
// use the symmetric union (one step up, one step down, and the four diagonals),
// which is what a pawn tile connects to for one colour or the other.
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ALL8 = [...ORTHO, ...DIAG];
const KNIGHT = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];
const PAWN_UNION = [[-1, 0], [1, 0], ...DIAG];

const inb = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const idx = (r, c) => r * SIZE + c;

// Build adjacency (array of arrays of node indices) for a terrain grid.
export function buildGraph(terrain) {
  const n = SIZE * SIZE;
  const adj = Array.from({ length: n }, () => []);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = terrain[idx(r, c)];
      const from = idx(r, c);
      const add = (tr, tc) => { if (inb(tr, tc)) adj[from].push(idx(tr, tc)); };
      const slide = (dirs) => {
        for (const [dr, dc] of dirs) {
          let tr = r + dr;
          let tc = c + dc;
          while (inb(tr, tc)) { adj[from].push(idx(tr, tc)); tr += dr; tc += dc; }
        }
      };
      const step = (dirs) => { for (const [dr, dc] of dirs) add(r + dr, c + dc); };
      switch (t) {
        case 'Q': slide(ALL8); break;
        case 'R': slide(ORTHO); break;
        case 'B': slide(DIAG); break;
        case 'K': step(ALL8); break;
        case 'N': step(KNIGHT); break;
        case 'P': step(PAWN_UNION); break;
        default: break;
      }
    }
  }
  return adj;
}

// Count strongly connected components (Tarjan, iterative to avoid deep
// recursion). Returns { count, compOf } where compOf[node] is its SCC id.
export function stronglyConnectedComponents(adj) {
  const n = adj.length;
  const index = new Array(n).fill(-1);
  const low = new Array(n).fill(0);
  const onStack = new Array(n).fill(false);
  const compOf = new Array(n).fill(-1);
  const stack = [];
  let counter = 0;
  let comp = 0;

  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    // Iterative DFS. Frame = [node, next-neighbour-pointer].
    const work = [[s, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame[0];
      if (frame[1] === 0) {
        index[v] = low[v] = counter++;
        stack.push(v);
        onStack[v] = true;
      }
      let recursed = false;
      while (frame[1] < adj[v].length) {
        const w = adj[v][frame[1]++];
        if (index[w] === -1) {
          work.push([w, 0]);
          recursed = true;
          break;
        } else if (onStack[w]) {
          if (low[w] < low[v]) low[v] = low[w];
        }
      }
      if (recursed) continue;
      if (low[v] === index[v]) {
        while (true) {
          const w = stack.pop();
          onStack[w] = false;
          compOf[w] = comp;
          if (w === v) break;
        }
        comp++;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        if (low[v] < low[parent]) low[parent] = low[v];
      }
    }
  }
  return { count: comp, compOf };
}

// Metrics used to grade a board.
export function analyzeGraph(terrain) {
  const adj = buildGraph(terrain);
  const { count } = stronglyConnectedComponents(adj);
  const degrees = adj.map((a) => a.length);
  const totalEdges = degrees.reduce((s, d) => s + d, 0);
  const avgMobility = totalEdges / adj.length;
  const minMobility = Math.min(...degrees);
  return {
    stronglyConnected: count === 1,
    sccCount: count,
    avgMobility,
    minMobility,
    degrees,
  };
}

// Fill a terrain grid, optionally with 180-degree rotational symmetry so both
// players face identical terrain (keeps the game fair — no first-player edge
// from the board itself).
function fillTerrain(rng, { weighted, symmetric }) {
  const terrain = new Array(SIZE * SIZE).fill('P');
  if (symmetric) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const i = idx(r, c);
        const j = idx(SIZE - 1 - r, SIZE - 1 - c);
        if (i <= j) {
          const t = pickTerrain(rng, weighted);
          terrain[i] = t;
          terrain[j] = t;
        }
      }
    }
  } else {
    for (let i = 0; i < terrain.length; i++) terrain[i] = pickTerrain(rng, weighted);
  }
  return terrain;
}

// A board is good enough if the movement graph is strongly connected (every
// tile reachable, no isolated regions) with decent average mobility.
const MIN_AVG_MOBILITY = 4.0;

function scoreBoard(metrics) {
  // Strong connectivity dominates; then reward mobility, then a full board
  // (min degree > 0 falls out of connectivity but keep it explicit).
  return (metrics.stronglyConnected ? 1e6 : 0)
    + Math.min(metrics.avgMobility, 12) * 1000
    + (36 - metrics.sccCount) * 10;
}

// Generate a board. Returns { terrain, metrics, attempts, seed, accepted }.
export function generateBoard(opts = {}) {
  const {
    weighted = true,
    symmetric = true,
    maxAttempts = 600,
  } = opts;
  const seed = opts.seed != null ? (opts.seed >>> 0) : randomSeed();
  const rng = makeRng(seed);

  let best = null;
  let bestScore = -Infinity;
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts++;
    const terrain = fillTerrain(rng, { weighted, symmetric });
    const metrics = analyzeGraph(terrain);
    const score = scoreBoard(metrics);
    if (score > bestScore) {
      bestScore = score;
      best = { terrain, metrics };
    }
    if (metrics.stronglyConnected && metrics.avgMobility >= MIN_AVG_MOBILITY) {
      return { terrain, metrics, attempts, seed, accepted: true };
    }
  }
  // Budget exhausted — return the best board found so it is still playable.
  return { ...best, attempts, seed, accepted: false };
}
