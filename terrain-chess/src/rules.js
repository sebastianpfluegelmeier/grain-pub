// Terrain Chess — core rules (framework-free, runs in browser and Node).
//
// The defining rule: a piece has NO intrinsic movement. It moves according to
// the terrain of the square it is CURRENTLY standing on. Where it lands may be
// different terrain, which governs its NEXT move. That delayed effect is the
// whole game.
//
// Coordinates: [row, col], row 0 at the top (Black home), row SIZE-1 at the
// bottom (White home). White pawns move up (toward row 0), Black pawns down.

export const SIZE = 6;

// Terrain / movement kinds. Single letters follow chess convention (N = knight).
export const TERRAIN = ['K', 'Q', 'R', 'B', 'N', 'P'];

export const TERRAIN_NAME = {
  K: 'King',
  Q: 'Queen',
  R: 'Rook',
  B: 'Bishop',
  N: 'Knight',
  P: 'Pawn',
};

// Chess glyphs used to paint terrain (never reused for the pieces themselves).
export const TERRAIN_GLYPH = {
  K: '♔', // ♔
  Q: '♕', // ♕
  R: '♖', // ♖
  B: '♗', // ♗
  N: '♘', // ♘
  P: '♙', // ♙
};

export const TERRAIN_DESC = {
  K: 'One square in any direction.',
  Q: 'Slides any distance in all eight directions.',
  R: 'Slides any distance orthogonally.',
  B: 'Slides any distance diagonally.',
  N: 'Jumps in an L; ignores blocking pieces.',
  P: 'Steps one square forward; captures one square diagonally forward.',
};

export const WHITE = 'W';
export const BLACK = 'B';

export const other = (player) => (player === WHITE ? BLACK : WHITE);

// Direction vectors.
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ALL8 = [...ORTHO, ...DIAG];
const KNIGHT = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];

const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

// Pawn forward is "up" (negative row) for White, "down" (positive) for Black.
export const pawnDir = (player) => (player === WHITE ? -1 : 1);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// A game state is a plain, JSON-serializable object so it is trivial to clone
// for history / undo.
//   terrain: SIZE*SIZE array of terrain letters
//   pieces:  SIZE*SIZE array of null | { player }
//   toMove:  WHITE | BLACK
//   winner:  null | WHITE | BLACK | 'draw'
//   passes:  count of consecutive passes (two in a row => draw)

export function pieceAt(state, r, c) {
  return state.pieces[r * SIZE + c];
}
export function terrainAt(state, r, c) {
  return state.terrain[r * SIZE + c];
}
function setPiece(state, r, c, v) {
  state.pieces[r * SIZE + c] = v;
}

export function cloneState(state) {
  return {
    terrain: state.terrain.slice(),
    pieces: state.pieces.map((p) => (p ? { player: p.player } : null)),
    toMove: state.toMove,
    winner: state.winner,
    passes: state.passes,
  };
}

export function countPieces(state, player) {
  let n = 0;
  for (const p of state.pieces) if (p && p.player === player) n++;
  return n;
}

// Initial 6x6 layout from the design doc:
//   BBBBBB
//   B....B
//   ......
//   ......
//   W....W
//   WWWWWW
// Eight pieces per side, symmetric.
export function initialPieces() {
  const pieces = new Array(SIZE * SIZE).fill(null);
  const put = (r, c, player) => { pieces[r * SIZE + c] = { player }; };
  for (let c = 0; c < SIZE; c++) put(0, c, BLACK);       // black back rank
  put(1, 0, BLACK); put(1, SIZE - 1, BLACK);             // black corners
  put(SIZE - 2, 0, WHITE); put(SIZE - 2, SIZE - 1, WHITE); // white corners
  for (let c = 0; c < SIZE; c++) put(SIZE - 1, c, WHITE);  // white back rank
  return pieces;
}

export function makeState(terrain, { pieces, toMove = WHITE } = {}) {
  return {
    terrain: terrain.slice(),
    pieces: pieces ? pieces.slice() : initialPieces(),
    toMove,
    winner: null,
    passes: 0,
  };
}

// ---------------------------------------------------------------------------
// Movement analysis
// ---------------------------------------------------------------------------
//
// analyzeMovement returns a rich description of everything a piece standing on
// (r, c) can do, driven by the terrain there. It powers both legal-move
// generation and the visualization (rays, capture/blocked markers).
//
// options:
//   mover           — the player the moves belong to (defaults to piece owner).
//   ignoreOccupancy — inspect mode: describe the raw terrain pattern as if the
//                     board were empty (destinations are only bounded by edges).
//
// Result:
//   { terrain, mover, rays, jumps, steps, pawn, moves }
//     rays  — sliding directions: [{ dir, squares:[{r,c,kind}] }]
//     steps — king single steps: [{ r, c, kind }]
//     jumps — knight destinations: [{ r, c, kind }]
//     pawn  — { forward:{r,c}|null, forwardBlocked, captures:[{r,c,kind}] }
//     moves — flat list of legal { from, to, capture } for this mover
//   kind is 'move' (empty destination) | 'capture' (enemy) | 'blocked'
//   (friendly piece that stops a ray; not a legal move).

export function analyzeMovement(state, r, c, opts = {}) {
  const terrain = terrainAt(state, r, c);
  const occupant = pieceAt(state, r, c);
  const ignore = !!opts.ignoreOccupancy;
  const mover = opts.mover || (occupant ? occupant.player : WHITE);

  const result = {
    terrain,
    mover,
    rays: [],
    jumps: [],
    steps: [],
    pawn: null,
    moves: [],
  };

  const addMove = (tr, tc, capture) => {
    result.moves.push({ from: [r, c], to: [tr, tc], capture });
  };

  // Classify a target square for `mover`. In inspect mode occupancy is ignored,
  // so every in-bounds square is a plain 'move'.
  const classify = (tr, tc) => {
    if (ignore) return 'move';
    const p = pieceAt(state, tr, tc);
    if (!p) return 'move';
    return p.player === mover ? 'blocked' : 'capture';
  };

  const slide = (dirs) => {
    for (const [dr, dc] of dirs) {
      const squares = [];
      let tr = r + dr;
      let tc = c + dc;
      while (inBounds(tr, tc)) {
        const kind = classify(tr, tc);
        squares.push({ r: tr, c: tc, kind });
        if (kind === 'move') {
          addMove(tr, tc, false);
          tr += dr; tc += dc;
          continue;
        }
        if (kind === 'capture') addMove(tr, tc, true);
        break; // captured piece or friendly block ends the ray
      }
      if (squares.length) result.rays.push({ dir: [dr, dc], squares });
    }
  };

  const single = (dirs, into) => {
    for (const [dr, dc] of dirs) {
      const tr = r + dr;
      const tc = c + dc;
      if (!inBounds(tr, tc)) continue;
      const kind = classify(tr, tc);
      if (kind !== 'blocked') addMove(tr, tc, kind === 'capture');
      into.push({ r: tr, c: tc, kind });
    }
  };

  switch (terrain) {
    case 'Q': slide(ALL8); break;
    case 'R': slide(ORTHO); break;
    case 'B': slide(DIAG); break;
    case 'K': single(ALL8, result.steps); break;
    case 'N': {
      // Knights jump: blocking is irrelevant, only the destination matters.
      for (const [dr, dc] of KNIGHT) {
        const tr = r + dr;
        const tc = c + dc;
        if (!inBounds(tr, tc)) continue;
        const kind = classify(tr, tc);
        if (kind !== 'blocked') addMove(tr, tc, kind === 'capture');
        result.jumps.push({ r: tr, c: tc, kind });
      }
      break;
    }
    case 'P': result.pawn = pawnMoves(state, r, c, mover, ignore, addMove); break;
    default: break;
  }

  return result;
}

function pawnMoves(state, r, c, mover, ignore, addMove) {
  const dir = pawnDir(mover);
  const pawn = { forward: null, forwardBlocked: false, captures: [] };

  // Forward one: only onto an empty square (never a capture).
  const fr = r + dir;
  if (inBounds(fr, c)) {
    const blocked = !ignore && pieceAt(state, fr, c);
    if (blocked) {
      pawn.forwardBlocked = true;
    } else {
      pawn.forward = { r: fr, c };
      addMove(fr, c, false);
    }
  }

  // Diagonal forward: capture only.
  for (const dc of [-1, 1]) {
    const tr = r + dir;
    const tc = c + dc;
    if (!inBounds(tr, tc)) continue;
    if (ignore) {
      pawn.captures.push({ r: tr, c: tc, kind: 'move' });
      continue;
    }
    const p = pieceAt(state, tr, tc);
    if (p && p.player !== mover) {
      pawn.captures.push({ r: tr, c: tc, kind: 'capture' });
      addMove(tr, tc, true);
    } else {
      // Show the (currently empty / friendly) diagonal as a potential capture
      // square so the player can read the pawn's threat pattern.
      pawn.captures.push({ r: tr, c: tc, kind: p ? 'blocked' : 'threat' });
    }
  }
  return pawn;
}

// Legal moves for the piece at (r, c), or [] if none / not a piece.
export function legalMovesFrom(state, r, c) {
  const p = pieceAt(state, r, c);
  if (!p) return [];
  return analyzeMovement(state, r, c, { mover: p.player }).moves;
}

// All legal moves for `player`.
export function allLegalMoves(state, player) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = state.pieces[r * SIZE + c];
      if (p && p.player === player) {
        for (const m of analyzeMovement(state, r, c, { mover: player }).moves) {
          moves.push(m);
        }
      }
    }
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Applying moves
// ---------------------------------------------------------------------------

// Apply a move in place. Returns { captured } describing the removed piece (or
// null). Does not validate legality — callers pass moves from legalMoves*.
export function applyMove(state, move) {
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const mover = pieceAt(state, fr, fc);
  const captured = pieceAt(state, tr, tc);
  setPiece(state, tr, tc, mover);
  setPiece(state, fr, fc, null);
  state.passes = 0;

  // Win: opponent has no pieces left.
  if (captured && countPieces(state, other(mover.player)) === 0) {
    state.winner = mover.player;
  }
  state.toMove = other(mover.player);
  return { captured };
}

// The side to move passes (only legal when it has no moves). Two passes in a
// row is a draw — neither side can make progress.
export function applyPass(state) {
  state.passes = (state.passes || 0) + 1;
  if (state.passes >= 2) state.winner = 'draw';
  state.toMove = other(state.toMove);
}

// Advance the game: if the side to move has no legal moves, pass for them and
// report it. Returns { passed:boolean, player } for the side that just acted.
export function resolveTurnIfStuck(state) {
  if (state.winner) return { passed: false, player: null };
  const player = state.toMove;
  if (allLegalMoves(state, player).length === 0) {
    applyPass(state);
    return { passed: true, player };
  }
  return { passed: false, player };
}
