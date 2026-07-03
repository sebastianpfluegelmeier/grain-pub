# Grain Asset Editor

Static browser editor for TinyGrain assets. Open `index.html` in a browser —
no build step. Assets live in `localStorage`, with optional git sync to a
GitHub repo. The editor exports runtime assets as TinyGrain binary
`.grainasset` files.

## Asset types

- **Tileset** — square 1-bit tiles (black / white / transparent), N×N.
- **Animation** — N×M frames with looping playback (play/pause, FPS stepper,
  space bar toggles).
- **Cube** — a "wavetable" of textures: N×M slices that loop on all three
  axes. Drawing wraps toroidally on x/y; the canvas shows the tile with a
  25% wrapped margin on each side, capped at 32 cells (dimmed), so seams are visible while you
  draw. Cubes are grayscale: a 0–255 slider plus transparent. The z axis
  loops via the same playback controls as animations.
- **Blockset** — one N×M image built from layers that composite in order.
  Select a layer to edit it; toggle per-layer visibility with the eye on
  each thumbnail.

## Editing

- Pens: pen, dither pen (Bayer 4×4; click the tool again to cycle
  25/50/75% density), spray, noise, blur/smudge, and soft displace.
  Shapes: line, filled rectangle, and whole-canvas gradient. Fill bucket
  flood-fills the clicked region; the shift tool drags the whole
  tile/frame/layer by a cell offset (wrapping on cubes). Right-click
  draws transparent (erase) with any tool.
- Brush controls include size, square/round shape, active/visible/all
  target scope, hard Z frame brush, and soft Z falloff brush. Cubes add
  single/ranged grayscale and opacity controls with fixed, random,
  stroke-gradient, and radial modes.
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
- Steppers set tile/frame size (4–32 for small assets; cubes can be
  resized up to 1024×1024, with width and height independent).
- Zoom controls appear for assets larger than 64 cells on either axis,
  with scrollable canvas panning at higher zoom levels.
- Gallery cards of animations and cubes play their loop while hovered
  (cubes tiled 2×2 to show the seams).
- Undo/redo per editing session: toolbar buttons, Cmd/Ctrl+Z,
  Shift+Cmd/Ctrl+Z or Ctrl+Y. History covers strokes, shapes, resizes and
  tile/frame/layer add/duplicate/remove.
- Gallery: create (four buttons), open, rename, delete (with confirm).
- Export: the editor header downloads the active asset as a binary
  `.grainasset` file for use from TinyGrain source.

## TinyGrain runtime

- `tileset("asset.grainasset", selector)` selects binary tiles by index.
- `animation("asset.grainasset", t)` loops `floor(t * asset_fps)` over
  frames; use `animation_frame` for direct frame indices.
- `cube("asset.grainasset", x, y, z)` samples a looping grayscale field.
- `blockset("asset.grainasset", texture, threshold)` displays each block
  when the average texture value under its non-transparent pixels exceeds
  the threshold.

## Git sync

The Sync panel (gallery top right) pushes/pulls all assets as binary
`.grainasset` files under `asset-editor/` in a GitHub repo (default
`grain-userdata`, same repo the grain web app syncs to). A local checkout
of that repo can be referenced directly from Grain source, for example
`tileset("../grain-userdata/asset-editor/basic_tiles.grainasset", selector)`.
Client-side only, ported from grain's
`grain-web-app/src/github-sync.js`: supply a fine-grained personal access
token with `contents: read/write` on that one repo. Push is a single
commit (adds, updates and deletions, including removal of old synced JSON
files); pull is remote-wins by asset name.
When configured, the editor pulls once on startup, gallery cards show a
yellow dot on assets modified since the last sync, and the topbar shows
the last sync time.

## Deploying to GitHub Pages

`./deploy-gh-pages.sh` follows grain's deploy pattern: it rsyncs this
directory into the root of a sibling `grain-pub` checkout, commits and
pushes. Served at
`https://sebastianpfluegelmeier.github.io/grain-pub/`.
Requires `git clone https://github.com/sebastianpfluegelmeier/grain-pub`
next to the tinygrain repo.
