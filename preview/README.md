# Grain Asset Editor

Static browser editor for TinyGrain assets. Open `index.html` in a browser —
no build step. Assets live in `localStorage`, with optional git sync to a
GitHub repo. The editor exports runtime assets as TinyGrain binary
`.grainasset` files.

## Asset types

- **Tileset** — square grayscale tiles (0–255 / transparent), N×N.
- **Animation** — N×M frames with looping playback (play/pause, FPS stepper,
  space bar toggles).
- **Particles** — a collection of independent black / white / transparent
  looping animations. Every particle can have its own N×M size and frame
  count; selecting a particle opens its frames in the animation editor.
  A collapsible swarm preview exposes editor-only controls for count,
  animation speed, X/Y drift, random movement, direction-change rate, and
  the preview canvas size. Particles render at their native resolution with
  nearest-neighbor (pixel-snapped) drawing for a crisp look. Preview
  positions use subpixel motion, change heading smoothly, and wrap
  seamlessly across all four edges.
- **Cube** — a "wavetable" of textures: N×M slices that loop on all three
  axes. Drawing wraps toroidally on x/y; the canvas shows the tile with a
  25% wrapped margin on each side, capped at 32 cells (dimmed), so seams are visible while you
  draw. Cubes are grayscale: a 0–255 slider plus transparent. The z axis
  loops via the same playback controls as animations.
- **Blockset** — one N×M image built from layers that composite in order.
  Select a layer to edit it; toggle per-layer visibility with the eye on
  each thumbnail.
- **Vector** — white-on-transparent shape animations (oval, rectangle, line,
  polygon) authored on a resolution-independent canvas and rasterized 1-bit
  (no anti-aliasing — every pixel is fully white or fully transparent).
  Shapes are groupable with boolean operations (union / intersect /
  difference / xor) between grouped area shapes, and every parameter is
  keyframe-animatable. There is no Grain runtime playback or binary export
  yet — vector assets live in `localStorage` only, so git sync skips them.
  See "Vector editor" below.

## Editing

- Pens: pen, dither pen (Bayer 4×4; click the tool again to cycle
  25/50/75% density), spray, noise, blur/smudge, and soft displace.
  Shapes: line, filled rectangle, and whole-canvas gradient. Fill bucket
  flood-fills the clicked region; the shift tool drags the whole
  tile/frame/layer by a cell offset (wrapping on cubes). Right-click
  draws transparent (erase) with any tool.
- Brush controls include size, square/round shape, active/visible/all
  target scope, hard Z frame brush, and soft Z falloff brush. Tilesets and
  cubes add single/ranged grayscale and opacity controls with fixed, random,
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

## Vector editor

The **Vector** asset type is a small vector-animation authoring tool, separate
from the raster pen tools. The canvas is 512×256 by default and everything is
drawn white on transparency.

- **Shapes:** oval (circle in a bounding box), rectangle, line, and polygon.
  Area shapes (oval / rectangle / polygon) are filled by default with an
  optional white stroke; lines are strokes with an adjustable width.
- **Drawing:** pick a tool, then drag to place an oval / rectangle / line.
  For polygons, click to drop vertices and press Enter (or click the first
  vertex) to close; Escape cancels an in-progress polygon.
- **Selecting & moving:** the select tool picks the top-most shape under the
  cursor; dragging moves it (and its whole animation path) as one. A single
  selected shape shows **direct-manipulation handles** — drag a box corner or
  edge to resize an oval/rectangle, an endpoint to reshape a line, or a vertex
  to move a polygon point (all handle edits auto-key at the playhead).
  **Double-click** a polygon vertex to remove it, or an edge to add one.
- **Layers panel** is a tree: groups can be expanded to select and edit their
  children. Each row has per-shape visibility (eye), reordering within its
  siblings, rename (double-click), and delete.
- **Properties panel** edits the selected shape's parameters.
- **Grouping & booleans:** select two or more shapes and Group them; a group
  carries an animatable translate + uniform scale and a boolean operation
  applied across its area children (lines pass through and draw on top).
  **Ungroup** dissolves a group back into its parent, baking the group's base
  offset into the children. On-canvas handles apply to top-level shapes; edit
  grouped children through the timeline and Properties panel.
- **Rendering** is 1-bit: shape coverage is thresholded so edges stay crisp
  (nearest-neighbor), matching the rest of the editor's pixel-art look.
- Undo/redo (buttons or Cmd/Ctrl+Z, Shift+Z / Ctrl+Y), duplicate
  (Cmd/Ctrl+D), and delete (Delete/Backspace).

### Timeline & keyframes

Every property is a plain **constant** until you choose to animate it — so
editing a value never creates keyframes by surprise. Each property in the
Properties panel has a **stopwatch** (◇ constant, ◆ animated):

- Click the **stopwatch** to animate a property. It seeds a keyframe at the
  playhead and the property appears in the timeline below. Click it again to
  collapse the property back to a constant at its current value.
- While a property is animated, editing its value (in Properties, by dragging
  a handle, or moving the shape) sets a keyframe **at the playhead**. While it
  is constant, the same edits just change the one value everywhere.
- The **◆ keyframe navigator** next to an animated property is filled when the
  playhead is on a key (click to remove it) and hollow otherwise (click to add
  one). The **+** on a timeline track does the same.
- **Scrub** by dragging the ruler *or clicking anywhere in a track lane*;
  **play/pause** loops over the asset's duration at the set FPS.
- **Drag** keyframe diamonds to retime them (snapped to the frame grid).
- **Select** a keyframe to edit the segment leaving it: interpolation type
  (linear / ease-in / ease-out / ease-in-out) with an **ease-strength** slider
  (0 collapses to linear), and — for position and other point tracks — a
  **spatial path** toggle (linear polyline vs. a smooth spline through the
  waypoints). Temporal easing and spatial smoothing are set independently.
- **Visibility** animates as a stepped on/off track; delete a selected
  keyframe with the inspector's trash button or Delete/Backspace.

Moving a *constant* shape on the canvas moves it (and any whole path) as one.

### Arrange (center & align)

The **Arrange** panel operates on the selected top-level shapes:

- **Canvas** — center the selection horizontally (↔), vertically (↕), or both
  (＋) within the canvas.
- **Align** (two or more shapes) — left / center / right edges (L C R) and top
  / middle / bottom edges (T M B), relative to the selection's bounding box.
- **Distribute** (three or more) — even horizontal (↔) or vertical (↕) spacing.

Dragging a single shape also **snaps its center to the canvas center**, with a
magenta guide line when it locks on.

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
- `scatter("asset.grainasset", freq, t: 0, density: 1, jitter: 1, rot: "quarter",
  scale: 1, scale_jitter: 0, blend: "over", drift: 0, seed: 0)` places drawn
  stamps (particles/animation/tileset) on a deterministic hash grid — stamp
  noise, pure in (u, v, t).
- `wang("asset.grainasset", cells, variants: "rotflip", strictness: 0.85,
  mutate: 0, luma: 0.5, luma_weight: 0, seed: 0)` tiles the plane with
  edge-matched tiles; `mutate` (a field) swaps cells for other fitting
  variants over time, `luma` steers selection toward a target brightness.
- `octaves(source, octaves: 4, gain: 0.5, lacunarity: 2, blend: "avg", seed: 0)`
  (and `octaves_wrap`) sums octave-scaled copies of any spatial value — or of
  a per-octave factory `fn(o)` — with `blend` also accepting `fn(acc, layer)`.
- `blockset("asset.grainasset", texture, threshold, u: 0.5, v: 0.5, x_scale: 1, y_scale: 1)`
  draws the asset centered at `(u, v)` at native pixel size and displays each
  block when the average texture value beneath its placed non-transparent
  pixels exceeds the threshold.

Existing asset types export as TGAS v1. Particle assets export as TGAS v2
kind 5: the standard 18-byte header is followed by one 8-byte
width/height/frame-count descriptor per particle, then each particle's frames
as sequential little-endian `u16` cells. Binary import restores the artwork
and shared FPS, and intentionally resets the editor-only preview controls.

Run `node test-particles.mjs` to check ragged particle and grayscale tileset
binary round trips, validation, and continued TGAS v1 export for existing
asset kinds.

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

## Noise Lab (experimental)

The gallery topbar's **Noise Lab** opens a playground of semi-procedural
noise experiments that consume the assets you draw — authored marks,
rule-driven placement and time. Everything is preview-only: assets are
read, never written, and Lab settings persist under their own
`grain.noiselab.v1` localStorage key.

- **Scatter** — stamp noise: deterministic hash-grid placement of drawn
  stamps (particles/animation/tileset) with density maps, jitter,
  rotation, blend modes, drift, and fbm octaves.
- **Cube FBM** — a cube asset summed in octaves like fbm, with optional
  trilinear "smooth" sampling and time/perlin-driven z.
- **Wang Tiles** — edge-matched aperiodic tiling of a tileset; reports
  how much of the plane fully edge-matches.
- **Flow Field** — drawn particles advected by curl noise with fading
  trails (deliberately a simulation, for contrast with Scatter).
- **Reaction-Diffusion** — Gray-Scott chemistry seeded from a drawn
  asset, with spots/stripes/coral/worms presets and asset-modulated feed.
- **Granular Time** — granular playback of an animation: multiple read
  heads, position spray, reverse probability, grain envelopes.

These are prototypes for possible language builtins; none of them change
the exported `.grainasset` format.

`./deploy-preview.sh` publishes this directory to the `preview/`
subfolder of the grain-pub Pages site
(`https://sebastianpfluegelmeier.github.io/grain-pub/preview/`), leaving
the production root untouched.

## Deploying to GitHub Pages

`./deploy-gh-pages.sh` follows grain's deploy pattern: it rsyncs this
directory into the root of a sibling `grain-pub` checkout, commits and
pushes. Served at
`https://sebastianpfluegelmeier.github.io/grain-pub/`.
Requires `git clone https://github.com/sebastianpfluegelmeier/grain-pub`
next to the tinygrain repo.
