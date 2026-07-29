# Terrain Chess (prototype)

A chess-inspired strategy game where **all pieces are identical**. A piece has
no intrinsic movement — it moves according to the **terrain it is standing on**,
and where it lands governs its *next* move. The board, not the pieces, is the
strategic resource.

Static browser prototype — no build step. Open `index.html` in a browser, or
serve the folder over HTTP (ES modules require `http://`, not `file://`):

```sh
cd terrain-chess && python3 -m http.server 8080
# then open http://localhost:8080/
```

Deployed alongside the asset editor at
`https://sebastianpfluegelmeier.github.io/grain-pub/terrain-chess/`.

## How it plays

- **6×6 board.** Every square has a terrain: King, Queen, Rook, Bishop, Knight
  or Pawn, drawn with its chess glyph (♔ ♕ ♖ ♗ ♘ ♙). The glyph stays visible
  under the pieces (large watermark + always-visible corner badge).
- **Pieces are plain discs** — white `●`, black `○` — deliberately *not* chess
  glyphs, so terrain and units read as distinct layers.
- **Movement comes from the current tile.** Standing on a Knight tile you move
  like a knight; land on a Queen tile and next turn you move like a queen. That
  delayed effect is the core mechanic.
- **Blocking / capturing** follow normal chess: sliders are blocked by friends
  and stop on a captured enemy; knights jump; pawns step forward one and capture
  one square diagonally forward (White up, Black down; no double move, promotion
  or en passant).
- **Win by capturing every enemy piece.** No king, no check, no checkmate. A
  side with no legal move passes; two passes in a row is a draw.

### Modes

- **Single Player** — you versus the heuristic AI. Choose whether you play White
  or Black.
- **Two Players** — local hot-seat on the same device; players alternate.
- **AI vs AI** — watch the heuristic play itself (Pause / Step to inspect).

### Visualization

- **Play**: select one of your discs to see its legal destinations — green =
  move, red ring = capture, hatched = friendly block. Sliding terrain draws
  movement **rays**; knights show destination markers; pawns show a forward
  marker plus diagonal capture threats.
- **Inspect**: click *any* tile to reveal the movement pattern its terrain
  grants, ignoring occupancy — useful for learning a freshly generated board.
- **Mobility heat-map**: optional overlay tinting each tile by how far a piece
  there can reach (its movement-graph out-degree).

## Board generator

Boards are modelled as a **movement graph** (a node per square, a directed edge
per legal movement on an empty board). A board is only accepted when the graph
is **strongly connected** — every tile reachable, no isolated regions — with a
reasonable **average mobility**; otherwise another is generated (best effort is
kept if the budget runs out). Options:

- **Weighted distribution** — high-mobility terrain is rarer (pawns common,
  queens very rare), making strong terrain a strategic objective.
- **Symmetric terrain** — 180° rotational symmetry so both sides face identical
  terrain (keeps the board itself fair).
- **Seed** — reproducible boards; the current seed is always shown.

## AI

Intentionally shallow (no search / minimax / lookahead). Every legal move is
scored independently:

| Factor | Score |
| --- | --- |
| Capture an enemy | +100 |
| Land on Queen / Rook / Bishop / Knight / King / Pawn tile | +30 / 20 / 16 / 14 / 10 / 4 |
| Closer to the centre | small bonus |
| Random variation | small jitter |

The best-scoring move is played. The interesting behaviour — reaching for strong
terrain — emerges even though the AI never actually looks a move ahead.

## Code layout

- `src/rules.js` — pure game logic: terrain movement, blocking, captures, legal
  moves, movement analysis for visualization, win/pass detection.
- `src/generator.js` — terrain distribution, movement-graph construction,
  strongly-connected-components check, mobility metrics, seeded RNG.
- `src/ai.js` — the heuristic scorer.
- `src/ui.js` — DOM rendering, interaction, SVG ray overlay, controls.
- `index.html`, `styles.css` — the page.
- `test/rules.test.js` — dependency-free Node test suite.

## Tests

```sh
node test/rules.test.js
```

Covers terrain movement for each type, blocking, captures, win/pass/draw,
inspect semantics, generator connectivity and determinism, and AI move choice.
