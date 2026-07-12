# Grain Asset Editor

Static browser editor for TinyGrain assets. Open `index.html` in a browser —
no build step. Assets live in `localStorage`, with optional git sync to a
GitHub repo. The editor exports runtime assets as TinyGrain binary
`.grainasset` files.

## Asset types

- **Tileset** — square 1-bit tiles (black / white / transparent), N×N.
- **Animation** — N×M frames with looping playback (play/pause, FPS stepper,
  space bar toggles).
- **Particles** — a collection of independent black / white / transparent
  looping animations. Every particle can have its own N×M size and frame
  count; selecting a particle opens its frames in the animation editor.
  A collapsible swarm preview exposes editor-only controls for count,
  animation speed, X/Y drift, random movement, direction-change rate, and
  X/Y size. Preview positions use subpixel motion, change heading smoothly,
  and wrap seamlessly across all four edges.
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
- Frame tools (animations, selected particle animations, and cubes): all-frames toggle in the tool row
  applies any paint operation to every frame; onion skin ghosts the
  previous (red) and next (blue) frame; tween fills the blank frames
  between the active frame and the next drawn frame — pixel dissolve for
  animations, grayscale interpolation for cubes. ◂ ▸ reorder frames.
- Particle assets add a particle strip above the canvas. Particles can be
  selected, added, duplicated, and removed independently; the normal frame
  strip and animation tools apply to the selected particle. Preview settings
  are saved in local storage for convenience but are not included in the
  exported runtime asset.
- New assets start empty; the sample assets carry starter art.
- Steppers set tile/frame size (4–32 for tilesets and animations;
  blocksets can be resized up to 512×512 and cubes up to 1024×1024, with
  width and height independent).
- Zoom controls appear for assets larger than 64 cells on either axis,
  with scrollable canvas panning at higher zoom levels. Trackpad scrolling
  and two-finger touch dragging pan the canvas; one-finger touch, pen, and
  mouse input continue to draw. Apple Pencil input also operates buttons,
  steppers, and sliders throughout the editor. While drawing with Pencil,
  palm/finger contacts are rejected; a deliberate two-finger pan remains
  available between strokes.
- Gallery cards of animations and cubes play their loop while hovered
  (cubes tiled 2×2 to show the seams).
- Undo/redo per editing session: toolbar buttons, Cmd/Ctrl+Z,
  Shift+Cmd/Ctrl+Z or Ctrl+Y. History covers strokes, shapes, resizes and
  tile/frame/layer add/duplicate/remove.
- Gallery: create (five buttons), open, rename, delete (with confirm).
- Export: the editor header downloads the active asset as a binary
  `.grainasset` file for use from TinyGrain source.

## TinyGrain runtime

- `tileset("asset.grainasset", selector)` maps a normalized selector across
  all binary tiles (`0` selects the first tile and `1` the last).
- `animation("asset.grainasset", t, u: 0.5, v: 0.5, x_scale: 1, y_scale: 1)`
  loops `floor(t * asset_fps)` and draws the frame centered at `(u, v)` at
  native pixel size. Use `animation_frame` for direct frame indices.
- `cube("asset.grainasset", x, y, z)` samples a looping grayscale field.
- `particles("asset.grainasset", number, speed: 1, drift_x: 0, drift_y: 0,
  movement: 0, dir_change: 0, x_size: 1, y_size: 1)` draws persistent,
  subpixel-positioned particle animations with directional drift plus a
  smoothly changing random movement heading.
- `blockset("asset.grainasset", texture, threshold, u: 0.5, v: 0.5, x_scale: 1, y_scale: 1)`
  draws the asset centered at `(u, v)` at native pixel size and displays each
  block when the average texture value beneath its placed non-transparent
  pixels exceeds the threshold.

Existing asset types export as TGAS v1. Particle assets export as TGAS v2
kind 5: the standard 18-byte header is followed by one 8-byte
width/height/frame-count descriptor per particle, then each particle's frames
as sequential little-endian `u16` cells. Binary import restores the artwork
and shared FPS, and intentionally resets the editor-only preview controls.

Run `node test-particles.mjs` to check the ragged particle binary round trip,
strict validation, and continued TGAS v1 export for existing asset kinds.

## Git sync

The Sync panel (gallery top right) pushes/pulls all assets as binary
`.grainasset` files under `asset-editor/` in a GitHub repo (default
`grain-userdata`, same repo the grain web app syncs to). Supply a local checkout
once on the command line:

```sh
tinygrain live scene.grain --assets ../grain-userdata/asset-editor
```

Source can then omit both the directory and binary extension, for example
`tileset("basic_tiles", selector)`.
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
