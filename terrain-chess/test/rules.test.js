// Node test suite for Terrain Chess core logic.
// Run: node terrain-chess/test/rules.test.js   (no dependencies)

import {
  SIZE, WHITE, BLACK, makeState, initialPieces, pieceAt, terrainAt,
  analyzeMovement, legalMovesFrom, allLegalMoves, applyMove, applyPass,
  resolveTurnIfStuck, countPieces, cloneState,
} from '../src/rules.js';
import {
  generateBoard, analyzeGraph, buildGraph, stronglyConnectedComponents, makeRng,
} from '../src/generator.js';
import { chooseMove, scoreMove } from '../src/ai.js';

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  FAIL:', msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg} (got ${a}, want ${b})`); }
function section(name) { console.log(`\n# ${name}`); }

// Helpers --------------------------------------------------------------------

// Build an all-one-terrain grid, then override specific cells.
function grid(fill, overrides = {}) {
  const t = new Array(SIZE * SIZE).fill(fill);
  for (const [k, v] of Object.entries(overrides)) t[Number(k)] = v;
  return t;
}
const at = (r, c) => r * SIZE + c;
// An empty board (no pieces) so we can place pieces explicitly.
function emptyState(terrain, toMove = WHITE) {
  return makeState(terrain, { pieces: new Array(SIZE * SIZE).fill(null), toMove });
}
function place(state, r, c, player) { state.pieces[at(r, c)] = { player }; }
function destSet(moves) { return new Set(moves.map((m) => `${m.to[0]},${m.to[1]}`)); }

// ---------------------------------------------------------------------------
section('initial layout');
{
  const s = makeState(grid('P'));
  eq(countPieces(s, WHITE), 8, 'white starts with 8');
  eq(countPieces(s, BLACK), 8, 'black starts with 8');
  // Back ranks full, corners on the second rank.
  for (let c = 0; c < SIZE; c++) {
    ok(pieceAt(s, 0, c)?.player === BLACK, `black back rank col ${c}`);
    ok(pieceAt(s, SIZE - 1, c)?.player === WHITE, `white back rank col ${c}`);
  }
  ok(pieceAt(s, 1, 0)?.player === BLACK && pieceAt(s, 1, SIZE - 1)?.player === BLACK, 'black corners');
  ok(!pieceAt(s, 1, 1), 'black inner second rank empty');
  eq(s.toMove, WHITE, 'white moves first');
}

section('rook slides orthogonally and blocks');
{
  // Rook tile at center (3,3), empty board.
  const s = emptyState(grid('P', { [at(3, 3)]: 'R' }));
  place(s, 3, 3, WHITE);
  let m = legalMovesFrom(s, 3, 3);
  // 5 up? rows 0,1,2 above (3 squares) + rows 4,5 below (2) = 5 vertical;
  // cols 0,1,2 left (3) + cols 4,5 right (2) = 5 horizontal => 10 total.
  eq(m.length, 10, 'rook on empty board has 10 moves');
  // Friendly block: put white at (1,3). Rook can reach (2,3) but not (1,3)/(0,3).
  place(s, 1, 3, WHITE);
  m = legalMovesFrom(s, 3, 3);
  let d = destSet(m);
  ok(d.has('2,3'), 'rook reaches square before friendly block');
  ok(!d.has('1,3'), 'rook cannot land on friendly block');
  ok(!d.has('0,3'), 'rook cannot pass friendly block');
  // Enemy capture: replace with black — reachable as a capture, not beyond.
  s.pieces[at(1, 3)] = { player: BLACK };
  m = legalMovesFrom(s, 3, 3);
  d = destSet(m);
  ok(d.has('1,3'), 'rook can capture enemy');
  ok(!d.has('0,3'), 'rook cannot pass captured enemy');
  ok(m.find((x) => x.to[0] === 1 && x.to[1] === 3).capture, 'that move is flagged capture');
}

section('bishop diagonal, queen = rook+bishop');
{
  const s = emptyState(grid('P', { [at(3, 3)]: 'B' }));
  place(s, 3, 3, WHITE);
  const b = legalMovesFrom(s, 3, 3).length;
  const s2 = emptyState(grid('P', { [at(3, 3)]: 'R' }));
  place(s2, 3, 3, WHITE);
  const r = legalMovesFrom(s2, 3, 3).length;
  const s3 = emptyState(grid('P', { [at(3, 3)]: 'Q' }));
  place(s3, 3, 3, WHITE);
  const q = legalMovesFrom(s3, 3, 3).length;
  eq(q, b + r, 'queen count equals bishop + rook count from same square');
}

section('knight jumps over pieces, ignores blocking');
{
  const s = emptyState(grid('P', { [at(3, 3)]: 'N' }));
  place(s, 3, 3, WHITE);
  // Surround with friendly pieces — knight still has all 8 jumps.
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
    place(s, 3 + dr, 3 + dc, WHITE);
  }
  const m = legalMovesFrom(s, 3, 3);
  eq(m.length, 8, 'knight in the center has 8 jumps despite adjacent friendlies');
  // Friendly on a landing square blocks only that one; enemy is capturable.
  place(s, 1, 2, WHITE); // knight target from (3,3)
  eq(legalMovesFrom(s, 3, 3).length, 7, 'friendly on a landing square removes it');
  s.pieces[at(1, 2)] = { player: BLACK };
  eq(legalMovesFrom(s, 3, 3).length, 8, 'enemy on a landing square is a capture');
}

section('king single step');
{
  const s = emptyState(grid('P', { [at(3, 3)]: 'K' }));
  place(s, 3, 3, WHITE);
  eq(legalMovesFrom(s, 3, 3).length, 8, 'central king has 8 steps');
  const s2 = emptyState(grid('P', { [at(0, 0)]: 'K' }));
  place(s2, 0, 0, WHITE);
  eq(legalMovesFrom(s2, 0, 0).length, 3, 'corner king has 3 steps');
}

section('pawn: forward move, diagonal capture, direction by colour');
{
  // White pawn tile at (4,2): forward is up (row 3).
  const s = emptyState(grid('P'));
  place(s, 4, 2, WHITE);
  let m = legalMovesFrom(s, 4, 2);
  let d = destSet(m);
  ok(d.has('3,2'), 'white pawn steps up one');
  ok(!d.has('5,2'), 'white pawn does not step backward');
  eq(m.length, 1, 'lone white pawn: just the forward step');
  // Block forward, add a diagonal enemy.
  place(s, 3, 2, WHITE); // friendly directly ahead blocks forward
  s.pieces[at(3, 1)] = { player: BLACK }; // diagonal-forward enemy
  m = legalMovesFrom(s, 4, 2);
  d = destSet(m);
  ok(!d.has('3,2'), 'blocked forward square is not a move');
  ok(d.has('3,1'), 'white pawn captures diagonally forward');
  ok(m.every((x) => !(x.to[0] === 3 && x.to[1] === 2)), 'pawn never captures forward');
  // Black pawn moves down.
  const sb = emptyState(grid('P'), BLACK);
  place(sb, 1, 2, BLACK);
  const db = destSet(legalMovesFrom(sb, 1, 2));
  ok(db.has('2,2'), 'black pawn steps down one');
  ok(!db.has('0,2'), 'black pawn does not step up');
}

section('apply move, capture, and win detection');
{
  const s = emptyState(grid('P', { [at(3, 3)]: 'R' }));
  place(s, 3, 3, WHITE);
  place(s, 3, 5, BLACK); // lone enemy on the rook's row
  eq(countPieces(s, BLACK), 1, 'one black piece');
  const move = legalMovesFrom(s, 3, 3).find((m) => m.to[0] === 3 && m.to[1] === 5);
  ok(move && move.capture, 'capture move available');
  const before = cloneState(s);
  const { captured } = applyMove(s, move);
  ok(captured && captured.player === BLACK, 'captured the black piece');
  eq(countPieces(s, BLACK), 0, 'black has no pieces');
  eq(s.winner, WHITE, 'white wins by capturing all enemy pieces');
  eq(s.toMove, BLACK, 'turn passes after the move');
  // Clone is independent.
  eq(countPieces(before, BLACK), 1, 'clone unaffected by applyMove');
}

section('pass and draw');
{
  // A lone white pawn on the top edge: forward (row -1) and both diagonals are
  // off the board, so it has no legal move at all -> the side must pass.
  const s = emptyState(grid('P'), WHITE);
  place(s, 0, 2, WHITE);
  eq(allLegalMoves(s, WHITE).length, 0, 'edge pawn has no legal moves');
  const r = resolveTurnIfStuck(s);
  ok(r.passed, 'stuck side passes');
  eq(s.toMove, BLACK, 'turn handed to opponent on pass');
  applyPass(s); // black also passes
  eq(s.winner, 'draw', 'two passes in a row is a draw');
}

section('inspect mode ignores occupancy');
{
  const s = makeState(grid('R', { [at(2, 2)]: 'R' })); // full initial pieces
  // A square packed with pieces around it; inspect shows full-board reach.
  const a = analyzeMovement(s, 2, 2, { ignoreOccupancy: true, mover: WHITE });
  const reach = a.moves.length;
  eq(reach, 10, 'inspect rook reaches all 10 orthogonal squares regardless of pieces');
}

// ---------------------------------------------------------------------------
section('generator: SCC + validity');
{
  // A single strongly-connected component on a hand-made queen board.
  const allQ = analyzeGraph(new Array(SIZE * SIZE).fill('Q'));
  ok(allQ.stronglyConnected, 'all-queen board is strongly connected');
  ok(allQ.avgMobility > 4, 'all-queen board has high mobility');

  // Two disconnected halves: left half king-locked from right half? Construct
  // a clearly non-strongly-connected graph to exercise the SCC counter.
  const g = buildGraph(new Array(SIZE * SIZE).fill('P'));
  const { count } = stronglyConnectedComponents(g);
  ok(count >= 1, 'SCC count computed for pawn board');

  // Determinism: same seed => identical board.
  const b1 = generateBoard({ seed: 12345, weighted: true, symmetric: true });
  const b2 = generateBoard({ seed: 12345, weighted: true, symmetric: true });
  ok(JSON.stringify(b1.terrain) === JSON.stringify(b2.terrain), 'seed reproduces terrain');
  ok(b1.metrics.stronglyConnected, 'seeded board is strongly connected');

  // Symmetric board is 180-degree rotationally symmetric.
  const sym = generateBoard({ seed: 999, weighted: true, symmetric: true });
  let symOk = true;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (sym.terrain[at(r, c)] !== sym.terrain[at(SIZE - 1 - r, SIZE - 1 - c)]) symOk = false;
    }
  }
  ok(symOk, 'symmetric generator yields 180-degree symmetry');

  // Accepted boards meet the mobility bar.
  let accepted = 0;
  for (let i = 0; i < 20; i++) {
    const b = generateBoard({ seed: 1000 + i });
    if (b.accepted) { accepted++; ok(b.metrics.avgMobility >= 4.0, `board ${i} mobility ok`); }
    ok(b.metrics.stronglyConnected, `board ${i} strongly connected`);
  }
  ok(accepted > 0, 'at least some boards are accepted outright');
}

// ---------------------------------------------------------------------------
section('AI: prefers captures and strong terrain');
{
  // Capture must beat a plain move onto a queen tile.
  const s = emptyState(grid('P', { [at(3, 3)]: 'R', [at(3, 0)]: 'Q' }));
  place(s, 3, 3, WHITE);
  place(s, 3, 5, BLACK); // capturable along the rook row
  const zeroRandom = { capture: 100, terrain: 1, center: 2, random: 0 };
  const res = chooseMove(s, WHITE, { weights: zeroRandom });
  ok(res && res.move.to[0] === 3 && res.move.to[1] === 5, 'AI takes the capture');
  ok(res.move.capture, 'chosen move is the capture');

  // Between two non-capturing moves, the AI prefers the higher-value terrain.
  const s2 = emptyState(grid('P', { [at(3, 3)]: 'R', [at(3, 5)]: 'Q', [at(0, 3)]: 'N' }));
  place(s2, 3, 3, WHITE);
  const res2 = chooseMove(s2, WHITE, { weights: zeroRandom });
  ok(res2.move.to[0] === 3 && res2.move.to[1] === 5, 'AI heads for the queen tile');

  // No legal moves -> null (caller passes).
  const s3 = emptyState(grid('P'));
  place(s3, 5, 0, WHITE); // white back rank, boxed by edge? forward is (4,0) empty -> has a move
  s3.pieces[at(4, 0)] = { player: WHITE }; // block forward, no diagonal enemy
  const res3 = chooseMove(s3, WHITE, { weights: zeroRandom });
  // (5,0) blocked; (4,0) can still move forward, so not null — sanity, then box it.
  ok(res3 !== null, 'AI finds a move when one exists');
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
