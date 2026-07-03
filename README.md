# Grain Asset Editor

Static browser editor for TinyGrain assets. Open `index.html` in a browser —
no build step. Assets live in `localStorage`, with optional git sync to a
GitHub repo.

## Asset types

- **Tileset** — square 1-bit tiles (black / white / transparent), N×N.
- **Animation** — N×M frames with looping playback (play/pause, FPS stepper,
  space bar toggles).
- **Cube** — a "wavetable" of textures: N×M slices that loop on all three
  axes. Drawing wraps toroidally on x/y; the canvas shows the tile with a
  25% wrapped margin on each side (dimmed) so seams are visible while you
  draw. Cubes are grayscale: a 0–255 slider plus transparent. The z axis
  loops via the same playback controls as animations.
- **Blockset** — one N×M image built from layers that composite in order.
  Select a layer to edit it; toggle per-layer visibility with the eye on
  each thumbnail.

## Editing

- Pens: pen, dither pen (Bayer 4×4; click the tool again to cycle
  25/50/75% density), noise spray, mirror pen (4-way symmetry). Shapes:
  line, filled rectangle. Fill bucket flood-fills the clicked region; the
  shift tool drags the whole tile/frame/layer by a cell offset (wrapping
  on cubes). Right-click draws transparent (erase) with any tool.
- Select tool: drag a rectangle, drag inside it to move the pixels,
  Cmd/Ctrl+C/X/V to copy/cut/paste (paste lands at the selection origin,
  also across frames and assets), Delete clears, Escape deselects.
- Flip horizontal/vertical and rotate 90° (square grids) act on the
  current tile/frame/layer — or on all frames with the all-frames toggle.
- Frame tools (animations and cubes): all-frames toggle in the tool row
  applies any paint operation to every frame; onion skin ghosts the
  previous (red) and next (blue) frame; tween fills the blank frames
  between the active frame and the next drawn frame — pixel dissolve for
  animations, grayscale interpolation for cubes. ◂ ▸ reorder frames.
- New assets start empty; the sample assets carry starter art.
- Steppers set tile/frame size (4–32, width and height independent for
  non-tilesets).
- Gallery cards of animations and cubes play their loop while hovered
  (cubes tiled 2×2 to show the seams).
- Undo/redo per editing session: toolbar buttons, Cmd/Ctrl+Z,
  Shift+Cmd/Ctrl+Z or Ctrl+Y. History covers strokes, shapes, resizes and
  tile/frame/layer add/duplicate/remove.
- Gallery: create (four buttons), open, rename, delete (with confirm).

## Git sync

The Sync panel (gallery top right) pushes/pulls all assets as JSON files
under `asset-editor/` in a GitHub repo (default `grain-userdata`, same repo
the grain web app syncs to). Client-side only, ported from grain's
`grain-web-app/src/github-sync.js`: supply a fine-grained personal access
token with `contents: read/write` on that one repo. Push is a single
commit (adds, updates and deletions); pull is remote-wins by asset name.
When configured, the editor pulls once on startup, gallery cards show a
yellow dot on assets modified since the last sync, and the topbar shows
the last sync time.

## Deploying to GitHub Pages

`./deploy-gh-pages.sh` follows grain's deploy pattern: it rsyncs this
directory into a sibling `grain-pub` checkout under `asset-editor/`,
commits and pushes. Served at
`https://sebastianpfluegelmeier.github.io/grain-pub/asset-editor/`.
Requires `git clone https://github.com/sebastianpfluegelmeier/grain-pub`
next to the tinygrain repo.
