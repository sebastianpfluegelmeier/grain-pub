// Terrain Chess — heuristic AI.
//
// Deliberately shallow, per the design doc: no search, no minimax, no future
// planning. Every legal move is scored independently and the best is played.
// The interesting behaviour comes from valuing the terrain a piece lands on —
// the AI reaches for strong terrain because that governs its NEXT move, even
// though it never actually looks a move ahead.

import { allLegalMoves, terrainAt, SIZE } from './rules.js';

// Value of landing on each terrain (its future movement potential).
export const TERRAIN_VALUE = { Q: 30, R: 20, B: 16, N: 14, K: 10, P: 4 };

export const DEFAULT_WEIGHTS = {
  capture: 100,   // taking an enemy piece
  terrain: 1,     // multiplier on TERRAIN_VALUE of the destination
  center: 2,      // per ring closer to the centre
  random: 3,      // magnitude of random jitter
};

// Chebyshev distance from the destination to the nearest central square.
function centerCloseness(r, c) {
  const lo = (SIZE - 1) / 2 - 0.5; // e.g. 2 for size 6
  const hi = (SIZE - 1) / 2 + 0.5; // e.g. 3 for size 6
  const dr = r < lo ? lo - r : r > hi ? r - hi : 0;
  const dc = c < lo ? lo - c : c > hi ? c - hi : 0;
  const dist = Math.max(dr, dc);
  const maxDist = Math.max(lo, SIZE - 1 - hi);
  return maxDist - dist; // higher = closer to centre
}

// Score a single move in isolation.
export function scoreMove(state, move, weights = DEFAULT_WEIGHTS, rng = Math.random) {
  const [tr, tc] = move.to;
  let score = 0;
  if (move.capture) score += weights.capture;
  score += weights.terrain * (TERRAIN_VALUE[terrainAt(state, tr, tc)] || 0);
  score += weights.center * centerCloseness(tr, tc);
  score += weights.random * rng();
  return score;
}

// Choose a move for `player`. Returns { move, score, evaluated } or null when
// there are no legal moves (the caller should pass).
export function chooseMove(state, player, opts = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const rng = opts.rng || Math.random;
  const moves = allLegalMoves(state, player);
  if (moves.length === 0) return null;

  let best = null;
  let bestScore = -Infinity;
  const evaluated = [];
  for (const move of moves) {
    const score = scoreMove(state, move, weights, rng);
    evaluated.push({ move, score });
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return { move: best, score: bestScore, evaluated };
}
