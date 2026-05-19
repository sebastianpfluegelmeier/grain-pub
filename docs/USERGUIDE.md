# Grain — User Guide

A declarative language for GPU-accelerated video synthesis.

---

## 1. CLI

```text
cargo run -- [OPTIONS]
# or: grain [OPTIONS]
```

| Option | Default | Description |
|--------|--------|-------------|
| `-f, --file <FILE>` | — | Read program from file (e.g. `examples/01_basics.grain`). |
| `-i, --input <FILE>` | — | Video/image input; repeat for `in(0)`, `in(1)`, … |
| `-o, --output <FILE>` | — | Output path (PNG or MP4). Required unless `--live`. |
| `-W, --width <N>` | 1920 | Output width. |
| `-H, --height <N>` | 1080 | Output height. |
| `--fps <N>` | 60 | Frames per second (live preview and video export). |
| `--frame <N>` | 0 | Frame index (single-frame export). |
| `-t, --time <F>` | 0.0 | Time value in seconds (single-frame export). |
| `-d, --duration <F>` | — | Duration in seconds; triggers video export. |
| `-k, --knobs <CSV>` | — | Knob values, comma-separated (e.g. `0.5,0.3,1.0`). |
| `--live` | — | Live preview: show animation in a window (no file output). |
| `--bpm <F>` | 120.0 | BPM for tempo-synced rhythm functions (`beat`, `euclidean`). In live mode, also controllable from the Push encoder. |
| `--dump-wgsl` | — | Print generated WGSL shaders to stderr. |
| `--midi-debug` | — | Print all incoming MIDI messages (live mode). |
| `--midi-in <NAME>` | — | Connect to the first MIDI input port whose name contains this substring (case-insensitive). Enables `midi_gate`, `midi_vel`, `midi_pitch`, `midi_cc`, `midi_clock` in the program. See §6.15. |
| `--midi-out <NAME>` | — | Route `note` / `cc` output to the first MIDI port whose name contains this substring (case-insensitive). See §6.14. |
| `--ui` | — | Open the live web UI in a chromeless window (live mode). The UI is also reachable from any browser at `http://127.0.0.1:<port>/`. |
| `--port <N>` | 3000 | HTTP/WebSocket port for the live-mode UI server. Use a different port to run multiple `--live` sessions side by side. |
| `--selectors <CSV>` | — | Pre-set selector branches at compile time, e.g. `--selectors "shape=2,noise=4"`. Applies to ALL selectors with the matching user-facing label (so `shape=2` sets every `selector("shape", …)` to its 3rd branch). Useful for offline rendering and to seed the live-mode shader cache. |
| `--list-selectors` | — | Parse + lower the program, print every selector found on the surface (internal name, label, options, default selection), then exit. Combine with `--selectors` to scout valid labels. |
| `--metronome` | — | Start the metronome audio click on by default in live mode. Without this flag the click is off until you toggle it from the UI. |
| `--laser-only` | — | Skip the raster render pipeline and show only the laser vector preview on a black background. Use for programs whose only output is `vout(_)` — saves GPU work and gives a clean glow without the raster blit underneath. |
| `--ilda` | — | Enable ILDA laser output via Ether Dream DAC (live mode). |
| `--helios <DEVICE>` | — | Enable ILDA laser output via Helios DAC (device index, build with `helios` feature). |
| `--helios-pps <PPS>` | 30000 | Points per second for Helios DAC output. |
| `--helios-fps <FPS>` | 30 | Target laser framerate for Helios DAC; frames are subsampled to fit. |
| `--laser-sim <ADDR>` | — | Send laser output to a running `laser-sim` instance (e.g. `127.0.0.1:9999`). Runs the same Helios optimizer as the real DAC, so what you see in the simulator matches the hardware. |
| `--laser-sim-pps <PPS>` | 30000 | Points per second for laser-sim output. |
| `--laser-sim-fps <FPS>` | 30 | Target framerate for laser-sim output. |
| `--ild-output <FILE>` | — | Export vector output to an ILDA `.ild` file. |
| `--oversize <F>` | 1.0 | Render-buffer oversize factor (e.g. `1.2` = 20% larger than the display window). |
| `--warmup <N>` | 0 | Render N extra throwaway frames before capture (PNG and video export only) so feedback chains have time to converge. No effect on `--live`. |
| `--profile <N>` | — | Render N frames as a wall-clock microbenchmark and print per-frame timings (min/median/mean/p95/p99/max) plus implied FPS. Writes no output file. |
| `--population <N>` | — | Render N variations of `<>` placeholders into a folder. See §10. |
| `--seed <S>` | — | Render once with seed `S` for `<>` placeholders. See §10. |
| `--mutate <S>` | — | With `--population N`, render N children near parent seed `S`. See §10. |
| `--resolve <S>` | — | Rewrite the source file in place with seed `S`'s placeholder values. See §10. |
| `-v, --verbose` | — | Print diagnostic / debug logs to stderr. Without it, only errors and headline progress are shown; live-mode logs are still available at `/logs`. |
| `--watchdog-secs <N>` | 0 | Live-mode stall watchdog threshold in seconds. Appends diagnostic stall lines to `/logs`; `0` disables it. |

**Examples**

```bash
# Single frame to PNG
cargo run -- -f examples/01_basics.grain --frame 0 -o out.png

# Video to MP4 (2 seconds at 60 fps)
cargo run -- -f examples/07_time.grain --duration 2 --fps 60 -o out.mp4

# With input video (in(0))
cargo run -- -i input.mp4 -f examples/08_input.grain --duration 2 -o out.mp4

# Live preview (window; close window to exit)
cargo run -- --live -f examples/07_time.grain
```

**Live preview (`--live`)** — Renders the program in a window and advances `time` / `frame` each frame. No file is written; close the window to exit. Input images/video are supported the same way as for file output. A web UI auto-generates controls for every surface element (`knob`, `toggle`, `button`, `seq`, `radio`, `vseq`, `pressure`) used in the program. Hot-reload is supported when using `-f`: save the file and the shader recompiles automatically.

---

## 2. Signal Types

| Type | Description |
|------|-------------|
| **video** | Per-pixel RGBA (4 floats per pixel). |
| **number** | Scalar. Where a video is expected, it broadcasts to all pixels. |

---

## 3. Syntax

### 3.1 Comments

```text
// This is a comment
```

### 3.2 Literals

```text
0.3                              // number
rgb(0.1, 0.5, 0.3)               // RGB (alpha = 1)
rgba(0.1, 0.5, 0.3, 0.6)         // RGBA
rgb(#ff8800)                     // 6-digit hex → RGB (alpha = 1)
rgba(#ff8800c0)                  // 8-digit hex → RGBA
rgb(knob(0,0), 0.5, uv_x)        // channels can be any expression
```

Bare `#hex` literals are not allowed — hex colors only appear inside `rgb(...)` or `rgba(...)`.

#### Coordinate units

Distances and positions can be expressed in several units. A bare number like
`0.5` means "0.5 of the natural axis" (UV-x for `cx` / `dx`, UV-y for `cy` /
`dy`, etc.) — current behavior. Add a suffix to switch units:

| Suffix | Meaning                              |
|--------|--------------------------------------|
| `px`   | pixels                               |
| `vw`   | fraction of viewport **width**       |
| `vh`   | fraction of viewport **height**      |
| `vmin` | fraction of the **shorter** edge     |
| `vmax` | fraction of the **longer** edge      |

Conversion happens at the call site against the destination param's axis,
so cross-axis units work too:

```text
shift(100px, 0)              // 100 pixels right
shift(0.5vh, 0)              // half a screen-height to the right
                              //   (uses height to displace horizontally)
circle(0, 0, 1vmin, ...)     // diameter = shorter edge → touches 2 edges
circle(0, 0, 1vmax, ...)     // diameter = longer edge → fills the screen
rect(0, 0, 100px, 100px, ...)// exactly 100×100 pixels, aspect-aware
```

Unit-suffixed literals are only valid inside builtin call arguments — they
can't be stored in `let` bindings.

#### Anchors (`from=`)

By default `cx`/`cy` are top-left coordinates: `cx=0` is the left edge,
`cx=1` is the right edge. The optional `from=` named arg picks a different
anchor:

| Anchor          | Origin            | cx range | cy range |
|-----------------|-------------------|----------|----------|
| `tl` (default)  | top-left          | 0..1     | 0..1     |
| `tr`            | top-right         | 0..1     | 0..1     |
| `bl`            | bottom-left       | 0..1     | 0..1     |
| `br`            | bottom-right      | 0..1     | 0..1     |
| `c` / `center`  | screen center     | -1..1    | -1..1    |

```text
circle(0, 0, 0.3, from: center)        // dead center
circle(1, 0, 0.2, from: center)        // right edge, vertically centered
circle(-1, -1, 0.3, from: center)      // top-left corner
circle(0.1, 0.1, 0.15, from: br)       // 0.1 from the bottom-right corner
```

At `from=center` the unit for **plain numbers** is half the screen — `1`
reaches the nearest edge. Unit-suffixed values like `0.5vh` are *not*
doubled; they always mean exactly what the suffix says, just offset from
the chosen anchor:

```text
circle(0.5vh, 0, 0.2, from: center)   // 0.5 screen-height right of center
circle(100px, -100px, 0.1, from: br)  // 100 px up-left from bottom-right
```

`from=` is supported on shapes (`circle`, `rect`, `vcircle`, `vrect`,
`vpoly`, `gradient_rad`) and any other builtin with absolute position
params (`zoom`, `rotate`, `repeat`, `vline`).

#### Diameter / radius aliases

Both `circle` (raster) and `vcircle` / `vpoly` (vector) natively take
**diameter** (`d`). `r` and `radius` are accepted aliases that double the
value before storage. So all of these are equivalent:

```text
circle(0.5, 0.5, 0.4)        // d = 0.4 (positional)
circle(0.5, 0.5, d: 0.4)
circle(0.5, 0.5, r: 0.2)     // r = 0.2 → d = 0.4
circle().r(0.2)              // builder chain

vcircle(0.5, 0.5, 0.4)       // same physical size as the raster circle
vcircle(0.5, 0.5, d: 0.4)
vcircle(0.5, 0.5, r: 0.2)
```

### 3.3 Functional and pipeline style

```text
add(white, perlin(0.5))
white >> add(_, perlin(0.5))
white >> tanh
```

`>>` pipes the left value into the right; `_` is the placeholder.

**Unary-chain shorthand**: when a pipeline stage starts with a binary operator (`+`, `-`, `*`, `/`), the left-hand side is implicitly the pipeline value. So `>> + noise` is the same as `>> _ + noise`, and `>> * 0.95` is the same as `>> _ * 0.95`. This makes long pipelines that arithmetically tweak a running value much less noisy:

```text
fin(0)
>> + perlin(0.5) * 0.05
>> * 0.95
>> blur(_, 3)
>> fout(0)
```

**`tap as <name>`** binds the current pipeline value to a local name and passes it through unchanged. The name is visible to every downstream stage in the same pipeline, so you can compute something once and reference it later without re-running it:

```text
fin(0)
>> blur(_, 5)
>> tap as blurred
>> sharpen(_, 2)
>> + blurred * 0.3
>> fout(0)
```

Multiple taps in one pipeline are fine; each binding is in scope from its tap onward. `tap as` is syntactic sugar for a `let ... in ...` form, so the named value is computed once and reused — not re-evaluated at each reference.

### 3.3a Infix operators

You can use `+`, `-`, `*`, and `/` with the usual precedence (`*` and `/` bind tighter than `+` and `-`):

```text
uv_x + 0.5
uv_x * uv_y
(uv_x - 0.5) / 0.5
uv_x + 0.5 >> tanh
```

These are equivalent to `add`, `sub`, `mul` and (for `/`) component-wise division. Number and video operands broadcast as with the block forms.

### 3.4 Let bindings

```text
let n = perlin(0.5)
add(n, mul(white, 0.1))
```

The last expression is the program output.

### 3.5 Function definitions

```text
fn invert(x) = sub(1.0, x)
invert(uv_x)
```

Function bodies can contain local `let` bindings before the final expression:

```text
fn signal(seq1, seq2) =
  let decay = 0.9
  let shape = seq2 * circle(0.5, 0.5, 0.5)
  fin(0)
  >> mul(_, decay)
  >> add(_, shape)
  >> fout(0)
```

Local bindings are scoped to the function — they don't leak to the outer scope. They are inlined at compile time, so using a binding multiple times computes the expression multiple times.

### 3.6 Imports

Two forms:

```text
use "lib.grain"              // flat merge: defs are in the current scope
use "lib.grain" as lib       // namespaced: access as `lib::name`
```

The flat-merge form pulls every `let` and `fn` from the imported file directly into the current scope. The namespaced form prefixes every imported top-level name with `<alias>::` and rewrites internal references inside the imported file the same way, so you call its definitions as `lib::donut(...)` and the file's own internal references are isolated from name collisions in your program.

Paths are relative to the current file (when using `-f`) or the current working directory. Both forms can be used in the same program. Circular use is an error.

---

## 4. I/O

### 4.1 Video inputs

| Syntax | Notes |
|--------|--------|
| `in(0)` | First `-i` file (video decoded frame-by-frame or image). |
| `in(1)`, `in(2)`, … | Second, third, … `-i` file. Pass one `-i` per source. |
| `image("name")` | Named user-uploaded bitmap, sampled as a texture in the shader. The runtime resolves `"name"` against the image registry — on native this is a path under the program's directory; on the web wasm app it's a key in the IndexedDB asset store (uploaded via the UI's image picker). Useful for static reference textures (logos, gradients, lookup tables) that don't need video decoding. |

### 4.2 Feedback buffers

| Syntax | Notes |
|--------|--------|
| `fin(0)`, `fin(1)`, … | Read from previous frame (one-frame latency). |
| `fout(0)`, `fout(1)`, … | Write to next frame. Multiple writes to same `fout(N)` are summed. |

Use `expr >> fout(N)` as a top-level line. You can have a main expression and/or feedback lines. If there is no main, output is `fout(0)`. Supported for PNG (single frame: no previous frame), MP4, and live preview (`--live`).

**Idiomatic feedback wrapper.** Most non-trivial programs wrap the loop in
a function so the inner pipeline is visible and the slot is local:

```text
fn fb(in, n) =
  fin(0)
  >> _ + in              // mix in the new frame's signal
  >> _ + n               // add noise / modulation
  >> dist(_)             // distortion stage
  >> fb_clip(_)          // wrap or saturate so the buffer doesn't blow up
  >> fout(0)

// Call it like any other block in main:
input + shape >> fb(_, noise) >> renderer(_)
```

`fb_clip` is typically a `selector` that switches between wrapping
strategies (`mod 1`, `tanh`, `clip`, `clamp`, identity) — feedback chains
diverge fast without one. See §5.3 for the selector DSL.

---

## 5. Built-in signals

| Name | Type | Description |
|------|------|-------------|
| `uv_x` | video | Normalized x [0, 1]. |
| `uv_y` | video | Normalized y [0, 1]. |
| `time` | number | Time in seconds (frame/fps). |
| `frame` | number | Frame index. |
| `beats()` | number | Continuous beat counter — `time * bpm / 60`. Use for tempo-synced phase math. |
| `knob()` | number | Auto-positioned, auto-named knob, output 0–1. See §5.0a. |
| `knob(0..0.5)` | number | Auto-positioned with a custom range. |
| `knob("label")` / `knob(0..10, "label")` | number | Auto-positioned with an explicit label (overrides the `let` binding name). |
| `knob(col, row)` | number | Manually-positioned, output 0–1. |
| `knob(col, row, "label")` | number | Manually-positioned with label. |
| `knob(col, row, min, max)` | number | Manually-positioned with custom range. |
| `knob(col, row, min, max, "label")` | number | Manually-positioned with range and label. |
| `toggle()` / `toggle(col, row)` / `toggle(col, row, "label")` | number | 0.0 or 1.0; click to flip. Auto-positionable. |
| `button()` / `button(col, row)` / `button(col, row, "label")` | number | 1.0 while held, else 0.0. Auto-positionable. |
| `pressure()` / `pressure(col, row)` / `pressure(0..1)` | number | Pressure pad: reads poly aftertouch from a MIDI controller. Auto-positionable. |
| `audio_env(low: 40, high: 120, attack: 5, release: 100)` | number | Audio envelope follower over the system default audio input. Runs a 2nd-order Butterworth bandpass over `[low, high]` Hz then an attack/release one-pole follower. All args are named and optional (`low`, `high`, `attack`/`attack_ms`, `release`/`release_ms`, `min`, `max`, `col`, `row`, plus an optional string label). Auto-positionable; label defaults to `"{low}-{high}Hz"`. Read-only. The cpal stream lives on a dedicated `grain-audio` supervisor thread: device opens and POLLERR-driven restarts happen there, never on the render thread, so a flaky PipeWire setup can't stall the loop. Force a specific device with `GRAIN_AUDIO_DEVICE=<substring>`; log per-attempt failures with `GRAIN_AUDIO_DEBUG=1`. After 5 consecutive failed restart attempts the supervisor gives up and the program runs without `audio_env` (rather than retrying forever). |
| `seq(col, row, steps)` | number | Step sequencer gate: 0.0 (off) or 1.0 (on). Steps advance every **16th note** at `--bpm`. Manual position only (multi-cell). |
| `seq(col, row, steps, division)` | number | Step sequencer with custom division (e.g. 8 = 8th notes, 32 = 32nd notes). Default division is 16. |
| `seq(..., step: <expr>, reset: <expr>, active: <expr>)` | number | Named-arg overrides for any `seq`. `step:` advances by one cell on each rising edge of the signal (replaces the global clock); `reset:` snaps `playback_pos` back to 0 on each rising edge; `active:` is evaluated each frame and clamped to `[1, steps]` to set the runtime wrap count — cells beyond it are dimmed in the UI and skipped during playback. Same args apply to `vseq`. |
| `radio(col, row, options)` | number | Radio button group. Returns the selected index as a float (0, 1, 2, …). Laid out 4-wide on the grid. Manual only. |
| `vseq(col, row, steps)` | number | Value sequencer: each step holds a float 0–1. Advances like `seq`. Output is the current step's value. Manual only. |
| `vseq(col, row, steps, division)` | number | Value sequencer with custom division. Default division is 16. |
| `tempo()` | number | Current BPM as a number (controlled by `--bpm`). |

### 5.0a Auto-layout for knobs / toggles / buttons / pressure

`knob`, `toggle`, `button`, and `pressure` accept an empty arg list and inherit their position and label from context:

```text
let cutoff    = knob()           // labelled "cutoff", auto-positioned
let resonance = knob(0..10)      // auto-positioned, range 0..10
let mute      = toggle()         // labelled "mute", auto-positioned
```

**Auto-positioning** fills row 0 left-to-right, then row 1, etc. The auto strip is 8 cells wide unless any *manually-positioned* element sits at column ≥ 8 — in that case the auto strip expands to that column so the two strips never overlap. Cells occupied by manually-positioned elements are skipped.

**Auto-naming** triggers when a `let` binding contains exactly one unlabelled surface element in its sub-tree. The label is derived from the binding name with underscores replaced by spaces — `let cutoff_freq = knob()` displays as "cutoff freq". If there are zero or multiple unlabelled surface elements in the tree, no auto-label is applied (use a string label explicitly).

You can mix manual and auto freely: any element with explicit `(col, row)` is manual, any without is auto.

**Multi-cell elements** (`seq`, `vseq`, `radio`) always require manual `(col, row)` — they span 4 grid cells and the layout is semantically meaningful (you see step indices in a known order), so auto-positioning doesn't make sense for them.

### 5.1 Live Controls panel

When running with `--live`, a web UI (and optional Push controller) shows all surface elements placed on a grid by their `(col, row)` coordinates:

- **Knobs** — vertical fill bar, drag to adjust. Shows the mapped value when `min`/`max` are set.
- **Toggles** — click to flip between 0.0 and 1.0.
- **Buttons** — held = 1.0, released = 0.0.
- **Sequencers (`seq`)** — row of clickable pads; the current step is highlighted. Click pads to toggle on/off.
- **Radio buttons (`radio`)** — grid of selectable options (4-wide). Click to select; output is the selected index.
- **Value sequencers (`vseq`)** — grid of vertical fill bars (4-wide). Drag each step to set its value 0–1. Current step is highlighted during playback.
- **Pressure (`pressure`)** — read-only fill bar showing live aftertouch value from a MIDI controller.
- **Audio envelope (`audio_env`)** — read-only level meter showing the band-passed envelope of the live audio input. The label defaults to the bandpass corners (e.g. `40-120Hz`) so multiple `audio_env` elements stay distinguishable at a glance. When an `audio_env` is piped directly into `mod_out` (e.g. `audio_env(20, 400) >> mod_out("audio lf", _)`), the audio_env's redundant cell is automatically hidden — the routable `mod_out` is the user-facing face of the signal. Stand-alone `audio_env` (without a `mod_out` wrapper) still shows its level meter.
- **Mod source (`mod_out`)** — read-only bipolar bar (centre line, grows up for positive, down for negative). Indicates a CPU-evaluated signal that other surface elements can be modulated from via routes. See §11.
- **Video mod source (`texture_out`)** — same as `mod_out` but the signal is a per-pixel video texture. Routes to a target apply the texture sample at the target's UV. Shows a thumbnail preview of the texture in the cell. See §11.
- **Selector (`selector`)** — picks one of N labeled "branch" expressions. Only the selected branch reaches the GPU shader; the unselected branches are dropped at compile time, so each option can be as expensive as you want. Switching triggers a hot recompile. See §5.3 for the DSL and UI.

All surface elements accept an optional string label as the last argument: `knob(0, 0, "volume")`, `seq(0, 0, 16, "kick")`.

**Push controller** — Elements map to Push pads and encoders. Knob values are adjusted with encoders; pressing a `vseq` pad routes the encoders to its step values. Pressure elements read poly aftertouch from pad pressure.

- **Hold-to-edit** — hold one or more knob/selector/toggle/radio/pressure pads on the grid; each held element shows up on the LCD under one of the eight encoders, and turning that encoder edits it (toggle: direction-set, radio/selector: stepping, knob/pressure: continuous). Buttons are momentary and don't capture the encoder, so neighbouring encoders still edit their column-aligned elements.
- **Selector encoder commit is deferred** until the encoder cap is released. Each detent doesn't re-fire `SetSelector` (which would force a structural recompile per detent and overwhelm the worker); the candidate is buffered, the LCD and the web popup show it live, and the commit fires once when the cap lifts. Falls back to per-detent commits when the cap isn't being touched (so a touch-sensor failure doesn't strand the candidate).
- **Selector LCD list view** — while a selector is the active edit target, the LCD takes over with a vertical list: previous option on line 0, the current option marked `> name <` on line 1, the next option on line 2, and `label  i/n` on line 3. Encoder turns scroll the list so the current always sits centered.
- **Tap-tempo / metronome LED** — pulses on every beat regardless of click on/off. Click ON → bright pulse; click OFF → dim pulse so you can still see the tempo without hearing the click.

**Sections** — Group surface elements into named horizontal sections with `section("name", body)`. The section name appears as a header above the controls in the web UI (and on the Push display). Sections are laid out left-to-right with a 1-column gap between them; element `(col, row)` coordinates are relative to the section.

```text
// two named sections side by side
section("osc", perlin(knob(0, 0, "scale")))
  >> mul(_, section("color", mix(rgb(1, 0, 0), rgb(0, 0, 1), knob(0, 0, "tint"))))
```

Sections can also wrap entire pipeline expressions. Any surface element (`knob`, `toggle`, `seq`, etc.) inside a `section(...)` call belongs to that section. Elements outside any section are placed at absolute grid coordinates. Note: top-level `let` and `fn` definitions are always unsectioned — sections propagate through feedback blocks but not through block/function references.

**Stage mode** — Edits made while Stage is active accumulate into a pending batch instead of mutating the live render, so you can audition a change (or a coordinated set of changes) before it goes out. Knobs, toggles, seq/vseq steps, pressure values, radios, selectors, and modulation route depths all stage. Stage applies to whichever surface the edit comes from: web UI, Push, or `/action` curl.

In the web UI:

- Click the **STAGE** toggle in the header for persistent stage mode, or click-and-hold for a transient peek (auto-exits on release after >250 ms).
- Edited elements show a soft accent border and the staged value as an overlay; the underlying live value is preserved.
- Modulation routes work the same way — staged depth changes show their pending value with an accent border, staged clears hide the row, and brand-new staged routes appear at the end of the route list.
- **Apply Now** commits the batch instantly. **Schedule…** opens an inline timing picker (seconds, or bar/beat/16th) so the batch lands at a future grid point. **Cancel** reverts every staged edit.

On the Push 1 (only when stage is active):

| Button | Action |
|--------|--------|
| Automation (CC 89) | Tap = toggle persistent stage; hold = transient peek |
| Duplicate (CC 88)  | Apply Now |
| Undo (CC 119)      | Cancel staged edits |
| Quantize (CC 116)  | Open the timing submenu (encoder 0 = seconds/bar, 1 = beat, 2 = sixteenth; scene-row 0 = Back, 1 = mode toggle, 7 = Confirm) |

The schedule submenu mirrors live to the web UI's stage panel — the duration inputs, the seconds/bar.beat toggle, and a "Push is editing" indicator all show what's happening on the device. When **Confirm** fires (Push CC 27 or the web button), Grain immediately leaves stage mode — the schedule queues the events to fire at the chosen time, and knob/pressure values ramp toward their targets through `schedule.tick`'s interpolation, so the live render shows the fade rather than freezing on the pre-stage state.

Push and web stay in sync — edits made on either surface broadcast as `staged_batch` / `staged_route_ops` so the other side renders the same overlay. Selector swaps in stage only affect the preview output; the live `kind=0` render stays on the pre-stage selection until commit.

Snapshot save while stage is active captures the staged-applied state, letting you clip a "what would be" without committing it.

### 5.2 Envelopes

Envelopes shape any gate or trigger signal. All time values are in **seconds**. Each envelope node is CPU-evaluated once per frame; output is fed into the shader as a uniform.

| Block | Description |
|-------|-------------|
| `ar(gate, attack, release)` | One-shot: rising edge fires the attack, which always completes regardless of how briefly the gate stayed high; release runs after attack. Right for short trigger pulses (`ar(beat(4), …)`). |
| `ar_gate(gate, attack, release)` | Gated variant — release begins as soon as `gate` falls, even mid-attack. Use when you want gate-on/gate-off tracking instead of one-shot behavior. |
| `ad(gate, attack, decay)` | One-shot: fires on the rising edge of `gate`; ignores subsequent state. |
| `adsr(gate, attack, decay, sustain, release)` | Full ADSR; `sustain` is a level (0–1), not a time. |

**Example:**

```text
// Sequencer gate smoothed into a pulse
ar(seq(0, 16), 0.02, 0.2) >> mul(_, perlin(0.4))

// Button triggers a flash
ad(button(0), 0.01, 0.3) >> mul(_, rgba(1, 1, 1, 1))

// Toggle gates a feedback decay
ar(toggle(0), 0.2, 1.0) >> mul(_, fin(0)) >> fout(0)
```

### 5.3 Selectors (path-switching)

A `selector` is a control element that picks one of N **homogeneously-typed
branch expressions**. The compile-time `lower_selectors` pass replaces the
node with the single selected branch — unselected branches are dropped from
the AST and never reach codegen, so each option can be arbitrarily expensive.
Switching the selection bumps `selector_version` and the live loop
hot-recompiles to swap the branch.

**Syntax**

```text
selector("name",
  "label1", expr1,
  "label2", expr2,
  ...)
```

The first argument is a name string used to identify the selector across hot
reloads (the compiler appends `#NN` to disambiguate multiple call sites with
the same name — `shape#10`, `shape#14`, etc.). Then alternating
`("label", expression)` pairs define each branch. Optional placement
`(col, row)` may appear right after the name:

```text
selector("dist", 4, 0,           // explicit (col, row)
  "through",  in,
  "rotozoom", rotozoom(in),
  "tear",     tear(in))
```

Without explicit placement the auto-layout pass positions the selector — the
typical pattern is to wrap it in `col(...)` / `row(...)` / `section(...)`.

**Common patterns**

- *Picking a noise source:* one selector that swaps between several noise
  generators, all returning a `vec4`.
- *Distortion stages:* a `selector("dist", "through", in, "rotozoom",
  rotozoom(in), …)` per stage in a feedback chain — `"through"` returns the
  input unchanged, useful as a no-op default.
- *Mod-source choice:* swap between `0`, `knob("value")`, an LFO, an
  envelope, etc. inside a `mod_unit() + mod_unit() + mod_unit()` sum.

**UI behaviour**

| Surface | Interaction |
|---------|-------------|
| Web UI / native UI | Each branch label is a button under the selector cell; tap to switch. |
| Push controller    | Selectors live next to other surface elements on the pad grid. Hold the selector pad to enter selector mode (top-row encoders scroll through branches), tap to commit. |

Switching is **synchronous on first touch**: the live loop blocks until the
new branch's shader has compiled, but the selector cache pre-warms every
one-flip-away neighbour after each compile, so a freshly-loaded program
hangs only on the *first* unique selection of each selector. Switches
between cached variants are near-instant.

**Sectioning** — selectors take their section from the surrounding
`section(...)` wrapper. Selectors at the AST root (post-inlining) — e.g. a
`fn fb_clip(in) = selector(...)` called mid-pipeline — land in an implicit
"ungrouped" track at the rightmost edge of the surface.

### 5.4 Snapshots (save / recall)

The native `--ui` server exposes **eight snapshot slots** (header strip, top
right). Each slot persists every element value, every selector index, and
every modulation route — the complete operator state minus the source code.

| Action            | Trigger                                |
|-------------------|----------------------------------------|
| Save to slot N    | Shift-click the empty Nth slot dot     |
| Recall slot N     | Click an occupied slot dot             |
| Clear slot N      | Alt-click the slot dot                 |

Slots survive program hot reload. The snapshot replays its values by
matching elements first on their **structural path** (`section[mod]/v0/p0/sel[mode=a]/knob[cutoff]`,
emitted by the compiler and stable across column/row drift), then falling
back to `(label, kind, col, row)` and finally `(kind, label)` order — so
moving a widget on the grid no longer loses its value, and duplicate-label
selectors no longer collide. Anything that genuinely no longer exists is
silently skipped. Slots DO NOT survive an `--ui` server restart, unless
you've also enabled the auto-save state file (see hot-reload below).

**On the Push controller**, the eight Scene buttons mirror slot 1-8 with the
same shift / alt modifiers via the encoders.

**Hot reload + state persistence** — When you save a `.grain` file under
`--live`, the loop:

1. Recompiles the program.
2. Builds a new surface.
3. Carries every operator value across — matching by structural path first
   (stable across (col, row) drift), then `(label, kind, col, row)`, then
   `(kind, label)` order. Knobs keep their values, toggles their state,
   sequencers their patterns, selectors their branch index (when the option
   list still matches), modulation routes their depth.
4. Preserves stable element ids so any in-flight WS click still targets the
   right element after the swap.

This means safe edits (renaming a label, changing arithmetic, adding/removing
elements outside your edit area) DO NOT reset operator state — only
elements that genuinely changed shape get reset to their defaults.

---

## 6. Built-in blocks

### 6.1 Arithmetic

| Block |
|-------|
| `add(a, b, ...)` |
| `mul(a, b, ...)` |
| `sub(a, b)` |
| `max(a, b, ...)` |
| `min(a, b, ...)` |
| `avg(a, b, ...)` |

### 6.2 Math

| Block | Notes |
|-------|-------|
| `sin(a)`, `cos(a)`, `tan(a)`, `tanh(a)` | Trig / hyperbolic. |
| `abs(a)`, `sign(a)` | Absolute value, sign. |
| `sqrt(a)`, `pow(a, b)`, `log(a)`, `exp(a)` | Power / log / exp. |
| `floor(a)`, `ceil(a)`, `round(a)`, `fract(a)` | Rounding ops. |
| `mod(a, b)` | Modulo / remainder. |
| `step(edge, x)` | 1 if `x ≥ edge` else 0 (component-wise). |
| `smoothstep(e0, e1, x)` | Hermite interpolation between edges. |
| `mix(a, b, t)` | Linear interpolation. |
| `clamp(a, lo, hi)` | Clamp to range. |

### 6.3 Noise

The bare names (`perlin`, `voronoi`, `white`, `fbm`, `curl`, `domain_warp`) are
the **3D animated** versions — they automatically use `time` as the third axis
so the field evolves over time. Bare `perlin` (no parens) is valid.

Each family has four shapes:

| Suffix | Meaning |
|---|---|
| *(none)* | 3D, animated automatically via `time` |
| `_static` | Pure 2D — frozen in time |
| `_z` | 3D with an explicit `z` you supply (replaces auto time) |
| `_xyz` | All three axes supplied explicitly (UV is not used) |

#### Perlin (smooth gradient noise)

| Block |
|-------|
| `perlin(scale, octaves, time_scale, seed)` |
| `perlin_static(scale, octaves, seed)` |
| `perlin_z(z, scale, octaves, seed)` |
| `perlin_xyz(x, y, z, scale, octaves, seed)` |

#### Voronoi (cellular / F1 distance)

| Block |
|-------|
| `voronoi(scale, time_scale, seed)` |
| `voronoi_static(scale, seed)` |
| `voronoi_z(z, scale, seed)` |
| `voronoi_xyz(x, y, z, scale, seed)` |

#### White (per-pixel hash)

| Block |
|-------|
| `white(seed)` |
| `white_static(seed)` |
| `white_z(z, seed)` |
| `white_xyz(x, y, z, seed)` |

#### FBM (fractal Brownian motion — stacked perlin octaves)

| Block |
|-------|
| `fbm(scale, octaves, time_scale, seed)` |
| `fbm_static(scale, octaves, seed)` |
| `fbm_z(z, scale, octaves, seed)` |
| `fbm_xyz(x, y, z, scale, octaves, seed)` |

#### Curl (divergence-free 2D vector field as RGB)

| Block |
|-------|
| `curl(scale, time_scale)` |
| `curl_static(scale)` |
| `curl_z(z, scale)` |
| `curl_xyz(x, y, z, scale)` |

#### Domain warp (perlin warped by another perlin)

| Block |
|-------|
| `domain_warp(scale, amount, octaves, time_scale, seed)` |
| `domain_warp_static(scale, amount, octaves)` |
| `domain_warp_z(z, scale, amount, octaves)` |
| `domain_warp_xyz(x, y, z, scale, amount, octaves)` |

Examples:

```
perlin(2.0)                              // animated by time
perlin_z(sin(time * 0.5), 2.0)           // custom z driven by a sine
perlin_xyz(uv_x * 2.0, uv_y, time, 1.0)  // stretch x, animate with time
perlin_xyz(uv_x + knob(0), uv_y + knob(1), time, 3.0)  // pan with knobs
```

### 6.3a LFO

Global (same for all pixels), driven by `time`. Return a number in [0, 1]; usable in pipelines (broadcast). Optional args have defaults.

| Block | Args | Description |
|-------|------|-------------|
| `sine(rate, phase)` | rate=1, phase=0 | Sine LFO, 0..1. |
| `tri(rate)` | rate=1 | Triangle wave 0..1. |
| `saw(rate)` | rate=1 | Sawtooth (ramp) 0..1. |
| `square(rate, duty)` | rate=1, duty=0.5 | Square wave 0/1; duty = fraction high. |

### 6.3b Shapes

Per-pixel masks in normalized UV (0..1). Return video (same value in R,G,B; alpha 1). Use with `mix`, `mul`, etc.

| Block | Args | Description |
|-------|------|-------------|
| `circle(cx, cy, d)` | center (0..1), diameter (0..1) | 1 inside circle, 0 outside. **d** is aspect-corrected: "fraction of the smaller side", so the shape is round on screen. `d=1` spans the full short side. |
| `rect(cx, cy, width, height)` | center, size (0..1) | 1 inside axis-aligned rectangle, 0 outside. **width/height** are aspect-corrected (fraction of smaller dimension), so equal w and h give a **square** on screen. |

### 6.3c Repeat grid

Repeat a shape (or any video expression) in a grid. For each pixel, the shader computes the grid cell and evaluates the body once. The body is a **lambda** `|i, j, cx, cy, u, v| body_expression` where the parameters are:

| Name | Description |
|------|-------------|
| `i`, `j` | Cell indices (0 .. nx−1, 0 .. ny−1). |
| `cx`, `cy` | Cell center in global UV (0..1). |
| `u`, `v` | Position within the cell (0..1). |

You can name the parameters anything — only their position matters.

**Syntax:** `repeat_grid(|i, j, cx, cy, u, v| body, nx, ny)` — the lambda must return video; `nx`, `ny` are numbers (columns and rows).

**Example:** grid of rectangles, larger toward the center (using L1 distance from center):

```text
repeat_grid(
    |i, j, cx, cy, u, v|
        rect(cx, cy,
             0.02 + 0.06 * (1 - (abs(cx - 0.5) + abs(cy - 0.5))),
             0.02 + 0.06 * (1 - (abs(cx - 0.5) + abs(cy - 0.5)))),
    10, 10)
```

You can make grid conditions depend on **video** by sampling at the cell center with `sample_at` (see 6.3d). For example: tint each cell by the input color at its center.

### 6.3d Sample at UV

Evaluate a video signal at a specific normalized (u, v) instead of the current pixel. Useful inside `repeat_grid` so each cell can use the value at its center.

| Block | Args | Description |
|-------|------|-------------|
| `sample_at(video, u, v)` | video = any video expression, including `in(0)`, `fin(0)`, or `render_at(expr, xres, yres)`; u,v in 0..1 | Sample the given video at normalized (u, v). Returns vec4. |

**Example (inside repeat_grid):**

- **Grid tinted by input at cell center** — each cell's color from input at that cell's center:
  `repeat_grid(|i, j, cx, cy, u, v| mul(rect(cx, cy, 0.1, 0.1), sample_at(in(0), cx, cy)), 10, 10)`

### 6.3e Low-resolution video for grid modulation

When you only need a coarse version of a video (e.g. for grid cell modulation), use **`render_at(video, xres, yres)`** so the video is rendered at low resolution (e.g. 10×10) and then sampled. This is cheaper than sampling the full-resolution input at every cell.

| Block | Args | Description |
|-------|------|-------------|
| `render_at(video, xres, yres)` | video = any video expression; xres, yres = number literals (1..1024) | Renders / quantizes the video at xres×yres and returns a video that can be sampled or used directly. |

**Usage:** use it inside `sample_at` at the cell center, e.g. in a grid:

- **Grid tinted by low-res input** — input is downscaled to 12×8, then each cell samples one "pixel" of that low-res buffer at the cell center:
  `repeat_grid(|i, j, cx, cy, u, v| mul(rect(cx, cy, 0.08, 0.08), sample_at(render_at(in(0), 12, 8), cx, cy)), 12, 8)`

**Limitations:** `xres` and `yres` must be number literals.

### 6.4 Gradients

| Block | Notes |
|-------|-------|
| `gradient_lin(angle)` | Angle in radians; 0 at one edge, 1 at opposite. |
| `gradient_rad(cx, cy, radius)` | 0 at center (cx, cy), 1 at radius; **circular** on non-square output (aspect-corrected). |

### 6.5 Color

Constructors:

| Block | Notes |
|-------|-------|
| `rgb(r, g, b)` / `rgb(#rrggbb)` | Compose / parse RGB. Alpha = 1. |
| `rgba(r, g, b, a)` / `rgba(#rrggbbaa)` | Compose / parse RGBA. |
| `hsv(h, s, v)` | Compose from HSV. h ∈ [0, 1]; equivalent to `hsv_to_rgb(rgb(h, s, v))`. |

Channel / space conversions:

| Block | Notes |
|-------|-------|
| `channel_r/g/b/a(video)` | Grayscale from one channel |
| `rgb_to_hsv(video)`, `hsv_to_rgb(video)` | H in [0,1]; alpha unchanged |

Adjustments (all take a video and a scalar amount):

| Block | Notes |
|-------|-------|
| `hue_shift(video, amount)` | Shift hue by `amount` (0–1 wraps). Example: `in(0) >> hue_shift(_, 0.5)`. |
| `saturate(video, amount)` | Scale saturation. 1.0 = unchanged, 0.0 = grayscale, 2.0 = double. |
| `brightness(video, amount)` | Add `amount` (signed) to every channel, clamped to 0..1. |
| `contrast(video, amount)` | Scale contrast around 0.5. 1.0 = unchanged, 0.0 = flat grey, 2.0 = double. |
| `level(video, amount)` | Multiply brightness by `amount`. Short-circuits to black when `amount ≤ 0.01`, so this is cheaper than `mul(_, amount)` when used with a knob that can fully mute a signal. |

Matrix / blend / palette:

| Block | Notes |
|-------|-------|
| `color_matrix(video, r0, r1, r2, r3)` | 4×4 matrix (rows = vec4); output = matrix × input. Each `rN` is a vec4 column / row. |
| `blend_add`, `blend_screen`, `blend_multiply`, `blend_overlay`, `blend_difference`, `blend_divide` | Component-wise blend modes. Two-argument form: `blend_add(a, b)`. |
| `procedural_palette(video, base_hue, hue_angle, colors, saturation)` | Map each pixel to its nearest HSL stop in a procedurally-generated palette. `colors` controls the number of stops; `hue_angle` the rotation between them. See also §6.8. |

### 6.6 Spatial transforms

Most spatial transforms require the first argument to be an input (`in(0)`, `in(1)`, …) or feedback (`fin(0)`, …). Out-of-bounds pixels are black by default. Add `_wrap` suffix for tiling behaviour.

| Block | Notes |
|-------|-------|
| `shift(video, dx, dy)` | Translate by `(dx, dy)` in UV. Black outside bounds. |
| `shift_wrap(video, dx, dy)` | Wraps (tiles) at edges. |
| `zoom(video, factor)` | Black outside bounds. |
| `zoom(video, factor, cx, cy)` | Zoom around point; default cx=cy=0.5. |
| `zoom_x(video, factor)` | Zoom horizontally only. |
| `zoom_y(video, factor)` | Zoom vertically only. |
| `zoom_wrap(video, factor)` | Wraps at edges. |
| `rotate(video, angle)` | Angle in radians. Black outside bounds. |
| `rotate(video, angle, cx, cy)` | |
| `rotate_wrap(video, angle)` | Wraps at edges. |
| `flip_h(video)`, `flip_v(video)` | |
| `tile(video, nx, ny)` | |
| `repeat(video, x, y, w, h)` | Repeat the region at `(x, y)` with size `(w, h)` across the screen at the same scale. |
| `repeat(\|i\| body, n)` | Index-based repeat: evaluate `body` once per `i` in `0..n-1` and combine the N results with `add` (summed). The lambda's parameter is bound to the integer index, so the user can position each iteration manually — e.g. `repeat(\|i\| circle(0.1 + i * 0.2, 0.5, 0.1), 5)`. `n` must be a constant integer literal (the body is unrolled at compile time). |
| `repeat(\|i\| body, n, combiner)` | Same as above but with an explicit 2-arg combiner — typically `add`, `max`, `min`, `mul`, or `avg`. Use `max` for OR-style shape masks, `add` for additive blending. |
| `shear(video, sx, sy)` | Black outside bounds. |
| `shear_wrap(video, sx, sy)` | Wraps at edges. |
| `warp(video, fx, fy)` | Displace pixels by two video displacement maps (`fx`/`fy` = flow fields). Black outside bounds. |
| `warp_wrap(video, fx, fy)` | Like `warp` but wraps at edges (tiles). |
| `mirror(video)` | Four-way mirror: tile with reflection so seams meet at centre. |
| `perspective(video, tl, tr, bl, br)` | Bilinear warp. Black outside bounds. `tl`/`tr`/`bl`/`br` are corner UVs passed as `rgb(u, v, 0)` (only `.x` and `.y` of each are read). Example: `in(0) >> perspective(_, rgb(0.1, 0.1, 0), rgb(0.9, 0.1, 0), rgb(0, 1, 0), rgb(1, 1, 0))`. |
| `perspective_wrap(video, tl, tr, bl, br)` | Like `perspective` but wraps at edges. |
| `pixelate(video, factor)` | Snap UV to a grid where each "virtual pixel" is `factor` screen pixels wide. Example: `in(0) >> pixelate(_, 8)` gives chunky 8×8 blocks. Pair with `dither_bayer`: `in(0) >> dither_bayer(_) >> pixelate(_, 8)`. A second argument overrides the vertical factor: `pixelate(video, fx, fy)`. |

### 6.7 Filters

| Block | Notes |
|-------|-------|
| `blur(video, radius)`, `blur_h(video, radius)`, `blur_v(video, radius)` | |
| `sharpen(video, amount)` | |
| `bloom(video, threshold, radius, strength)` | Extract bright pixels (luminance > threshold), Gaussian-blur them with given radius, add back at given strength. |

### 6.7a Conditional execution

| Block | Args | Description |
|-------|------|-------------|
| `switch(value, path0, path1, ...)` | value: number; paths: video | Selects path at index `floor(value) % N`. When `value` is uniform across all pixels (e.g. `seq`, `knob`, `toggle`), only the selected path executes on the GPU; all others are skipped. |
| `if(cond, then, else)` | cond, then, else: any | Per-channel ternary: returns `then` where `cond > 0.5`, else `else`. Works on scalars and per-pixel signals. |
| `gt(a, b)` | a, b: any | 1 where `a > b`, else 0 (per channel). |
| `lt(a, b)` | a, b: any | 1 where `a < b`, else 0 (per channel). |
| `eq(a, b[, eps])` | a, b: any; eps default `0.001` | 1 where `\|a − b\| < eps`. Use a wider `eps` for stable matches on noisy inputs. |
| `between(x, lo, hi)` | x, lo, hi: any | 1 where `lo ≤ x ≤ hi`, else 0. |
| `mask_and(a, b)` | a, b: any | Fuzzy AND: `min(a, b)`. Reduces to plain AND on strict 0/1 inputs. |
| `mask_or(a, b)` | a, b: any | Fuzzy OR: `max(a, b)`. |
| `mask_not(a)` | a: any | Invert a 0/1 mask: `1 − a` clamped to `[0, 1]`. |

`if`, `gt`, `lt`, `eq`, `between`, and the `mask_*` family all act per channel — apply them to RGB videos and the result is a per-channel mask. To collapse to a single luma-style mask first, pipe through `channel_r` / `avg(_)` etc.

**Infix shorthand.** Comparisons can also be written as infix operators, which lower to the function-call forms above:

| Infix | Lowers to |
|-------|-----------|
| `a < b`  | `lt(a, b)` |
| `a > b`  | `gt(a, b)` |
| `a <= b` | `mask_not(gt(a, b))` |
| `a >= b` | `mask_not(lt(a, b))` |
| `a == b` | `eq(a, b, 0.001)` (default tolerance) |
| `a != b` | `mask_not(eq(a, b, 0.001))` |

Precedence sits between `>>` and `+`/`-`: `a + b > c + d` parses as `gt(a + b, c + d)`. Use `eq(a, b, eps)` directly when you need a non-default tolerance.

**Examples:**
```text
// scene select driven by a sequencer (only active scene executes)
switch(seq(0, 4), perlin(2.0), voronoi(3.0), white, fbm(1.5))

// knob crossfades between effects
switch(floor(knob(0) * 3.0), in(0) >> blur(_, 5), in(0) >> sharpen(_, 2.0), in(0) >> pixelate(_, 8))

// cycle scenes with frame counter
switch(mod(floor(frame / 30.0), 3.0), scene_a, scene_b, scene_c)

// pick between two looks based on a knob
if(gt(knob(0), 0.5), in(0) >> blur(_, 4), in(0) >> sharpen(_, 1.5))

// brightness mask: keep only pixels in a mid-band
let g = in(0) >> channel_r
mul(in(0), between(g, 0.3, 0.7))

// combined condition: bright AND high noise → red, else passthrough
let n = perlin(0.5)
let mask = mask_and(gt(in(0), 0.6), gt(n, 0.4))
if(mask, rgb(1, 0, 0), in(0))

// ring at value 0.5 ± 0.05 — narrow tolerance on a continuous signal
if(eq(gradient_rad(0.5, 0.5, 0.5), 0.5, 0.05), rgb(1, 1, 1), rgb(0, 0, 0))

// same conditions, infix form
let g = gradient_rad(0.5, 0.5, 0.5)
if(g > 0.85, rgb(1, 1, 1),
  if(g < 0.15, rgb(0, 0, 0), mul(g, 0.5)))
```

### 6.7b Value operations

These operate on pixel values directly and work on any video expression (no texture binding required).

| Block | Args | Description |
|-------|------|-------------|
| `threshold(video, lo, hi)` | lo, hi scalars | Remap each channel: 0 where ≤ lo, 1 where ≥ hi, linear in between. Alpha = 1. |
| `abs_diff(a, b)` | two videos | `abs(a − b)` per channel. Useful for motion detection: `abs_diff(in(0), fin(0))`. |
| `motion_blur(a, b, t)` | a, b videos, `t` 0–1 | `mix(a, b, t)` — blend current (`a`) and previous/feedback (`b`) frame. `t=0` = no blur, `t=0.9` = heavy smear. Example: `in(0) >> motion_blur(_, fin(0), 0.5)`. |

### 6.8 Dithering and palette

| Block | Description |
|-------|-------------|
| `dither_bayer(video[, scale])` | Ordered (4×4 Bayer) dither: threshold luminance against a Bayer matrix. Optional `scale` enlarges the dither pattern (e.g. `dither_bayer(_, 4)` = 4× chunkier). Use in pipeline: `in(0) >> dither_bayer(_)`. |
| `dither_threshold(video)` | Binary threshold at 0.5 luminance. Use in pipeline: `in(0) >> dither_threshold(_)`. |
| `palette_n(video, n)` | Reduce to **n levels per channel** (2 ⇒ 8 colors, 3 ⇒ 27, 4 ⇒ 64). Example: `gradient_rad(0.5, 0.5, 0.5) >> palette_n(_, 4)`. |
| `palette(video, c1, c2, ...)` | Map each pixel to the nearest color from a custom palette (Euclidean RGB distance). Example: `in(0) >> palette(_, rgb(#ff0000), rgb(#00ff00), rgb(#0000ff), rgb(#000000), rgb(#ffffff))`. |
| `hold_every(value, n)` | **Reduce framerate**: output `value` only when `frame % n == 0`, else hold the previous value. Works on both scalar numbers and videos. |

### 6.8a Media playback (`play` / `stream`)

Load an image, image folder, or video file from disk and render it into the frame. Two flavours:

- **`play("path", ...)`** preloads the whole file into a GPU texture array and supports random-access controls (`frame`, `time`, `progress`). Use for short clips and image sequences where you want to scrub around.
- **`stream("path", ...)`** opens the file with ffmpeg and decodes one frame per render, forward-only. Use for long videos where preloading would be too much memory.

Both take the path as the first positional argument, followed by named args only:

| Arg | Applies to | Default | Description |
|-----|------------|---------|-------------|
| `loop` | `play`, `stream` | 0 | 1 = loop at end, 0 = freeze on last frame |
| `x`, `y` | `play`, `stream` | 0, 0 | UV position of the top-left corner |
| `scale_x`, `scale_y` | `play`, `stream` | 1, 1 | Size in UV (1 = full screen) |
| `frame` | `play` only | — | Force the displayed frame index. Exclusive with `time`/`progress`. |
| `time` | `play` only | — | Force the displayed time in seconds. Exclusive with `frame`/`progress`. |
| `progress` | `play` only | — | Force the displayed position as a 0..1 fraction of total length. Exclusive with `frame`/`time`. |

`stream()` rejects `frame`/`time`/`progress` outright — streaming is realtime forward playback only.

Both forms also accept the builder-chain postfix: `play("clip.mp4").frame(5).x(0.1)` is equivalent to `play("clip.mp4", frame: 5, x: 0.1)`.

**Examples:**

```text
// Loop a video full-screen
play("intro.mp4", loop: 1)

// Scrub a clip with a knob
let t = knob()
play("logo.mp4").progress(t)

// Picture-in-picture: stream at the top-right corner, quarter-size
stream("camera.mp4", x: 0.75, y: 0.0, scale_x: 0.25, scale_y: 0.25)

// Image sequence in a folder
play("frames/")
```

### 6.9 Tilesets

| Block | Description |
|-------|-------------|
| `tileset("path.png", input)` | Divide a tileset image into an N×N grid of tiles and select which tile to show per cell based on `floor(input.r * N²)`. The input signal is sampled with a 2×2 box filter per cell for smoother selection. |
| `tileset("path.png", input, scale)` | Same, with a custom `scale` factor for the tile grid (default 1). |
| `tileset_px("path.png", input)` | Per-pixel tileset: tile selection happens at tile-pixel resolution instead of per-cell. Each pixel within a tile can select a different tile layer, giving more detail than `tileset`. |
| `tileset_px("path.png", input, scale)` | Per-pixel tileset with custom scale. |
| `autotile("path.png", input)` | Rule-based tileset: each cell's tile is chosen from the neighbourhood configuration (8 neighbours above/below a threshold). Useful for cellular-automaton looks and "walls that connect" effects. |
| `autotile("path.png", grid_x, grid_y, input)` | Same, with an explicit grid size override. |
| `autotile("path.png", grid_x, grid_y, input, threshold)` | Same, with a custom on/off threshold (default 0.5). |

#### Asset layout

The tileset path argument is the name of a **directory**, not a single
image. Each frame is a separate PNG/JPG inside that directory; loading
sorts the file list lexicographically and stacks them as texture layers.

```
tilesets/
  tileset1/
    01.png         ← layer 0
    02.png         ← layer 1
    …
    16.png         ← layer 15
  tileset2/
    __0001.png     ← any naming works as long as sort order is correct
    __0002.png
    …
```

Path resolution walks ancestor directories of the source `.grain` file: the
loader looks for `<ancestor>/tileset1/` and `<ancestor>/tilesets/tileset1/`
at every level up to the filesystem root. The conventional layout is a
`tilesets/` directory next to the source.

**Browser (wasm) loading.** The browser can't read local directories by path.
Use the web app's asset manager to upload tileset folders; uploads are stored
in IndexedDB and registered with the wasm session before compile. For local
development only, the Vite dev server also serves the repo's `tilesets/`
directory and generates `/tilesets/<name>/manifest.json` on the fly:

```json
{ "kind": "normal", "files": ["01.png", "02.png", ...] }
```

`kind` is `"normal"` for `tileset` / `tileset_px` and `"auto"` for
`autotile`. Production builds do not ship the repo's tilesets; users bring
their own through the upload UI.

GitHub Pages requires a `.nojekyll` marker at the deploy root so files
beginning with `_` (e.g. `__0001.png` from video-extracted frames) aren't
silently dropped by the Pages Jekyll build. The deploy script handles this
automatically.

### 6.10 Feedback utilities

| Block | Description |
|-------|-------------|
| `acc(delta)` | Accumulator: adds `delta` to a feedback buffer each frame. Equivalent to `fin(N) + delta >> fout(N)` with an automatically allocated feedback slot. |
| `counter(delta)` | Scalar accumulator: adds `delta` to a CPU-side running total each frame. Like `acc` but for numbers, evaluated on the CPU and fed in as a uniform. |
| `impulse(trigger)` | Rising-edge detector: outputs 1.0 for exactly one frame when `trigger` crosses from ≤ 0 to > 0, then 0.0. Uses an implicit feedback slot to track the previous value. Works on both scalar and video signals (edge detection is per-pixel on `.x`). |
| `lpf(input, coeff)` | One-pole low-pass filter on a scalar signal. `coeff` in 0..1 controls smoothing (lower = smoother). Useful for taming noisy knob/CC inputs. |
| `delay_frames(input, frames)` | Scalar ring-buffer delay. Each frame writes `input` into a per-call-site buffer and returns the value from `frames` frames ago. Read-before-write, so `frames=0` is identity; pre-roll (before the buffer has filled) reads as `0`. `frames` may vary at runtime; the buffer caps at 4096 frames (≈68 s at 60 fps). |

**Examples:**
```text
// accumulate noise over time
acc(perlin(0.5) * 0.01)

// flash white for one frame on each sequencer hit
impulse(seq(0, 0, 8)) >> mul(_, rgb(1, 1, 1))

// combine: accumulate only on trigger
impulse(button(0, 0)) >> mul(_, perlin(2.0)) >> acc

// per-ring outside-to-inside animation: shift each ring's LFO by frames
repeat(|i|
    let phase = delay_frames(counter(0.02), i * 6)
    rect.w(1 / (i + 1)).h(1 / (i + 1))
        >> rotate(_, phase)
, 6)
```

### 6.11 Rhythm functions

Tempo-synced gates and clock utilities. All use the current BPM (set via `--bpm` or the Push encoder in live mode). Division is in **steps per bar**: 4 = quarter notes, 8 = eighth notes, 16 = sixteenth notes.

| Block | Description |
|-------|-------------|
| `beat(division)` | Tempo-synced gate: 1.0 for the first half of each step, 0.0 for the second. `beat(4)` = quarter notes, `beat(16)` = sixteenths. |
| `euclidean(hits, steps)` | Euclidean rhythm (Bjorklund algorithm): distribute `hits` evenly across `steps` within one bar. `euclidean(3, 8)` = tresillo. |
| `euclidean(hits, steps, offset)` | Euclidean rhythm with rotation offset. |
| `nth(input, n)` | Clock divider: passes every nth rising edge of `input`. `nth(beat(16), 4)` divides sixteenths to quarter notes. |
| `prob(input, prob)` | Probabilistic gate: each rising edge of `input` passes through with probability `prob` (0–1). |
| `hold_frames(input, frames)` | Retriggerable one-shot: outputs 1.0 for `frames` frames after each rising edge of `input`. |
| `hold_ms(input, ms)` | Retriggerable one-shot: outputs 1.0 for `ms` milliseconds after each rising edge of `input`. |
| `tempo()` | Returns the current BPM as a number. |

**Examples:**
```text
// quarter-note flash
beat(4) >> mul(_, rgb(1, 1, 1))

// euclidean 3-over-8 pattern
euclidean(3, 8)

// divide sixteenths to quarter notes
nth(beat(16), 4)

// randomly drop half the beats
prob(beat(4), 0.5)

// extend gate to 200ms
hold_ms(beat(4), 200)

// extend gate to 30 frames
hold_frames(beat(16), 30)
```

---

### 6.12 Rhythm type

A richer alternative to `beat`/`euclidean`: composable **rhythm values** with operators for union, intersection, and difference. Periods use bar fractions (`1/4` = quarter, `1/8` = eighth, `1/16` = sixteenth), which reads like musical notation and composes cleanly under math.

A rhythm used in any numeric context auto-casts to its gate value, so `shape * rhythm` works the same way `shape * beat(4)` does.

**Constructors**

| Block | Description |
|-------|-------------|
| `every(period)` | Rhythm with hits every `period` of a bar. `every(1/4)` = quarter, `every(1/8)` = eighth, `every(3/8)` = dotted quarter, `every(1/3)` = triplet half. |
| `euclid(hits, steps)` | Euclidean rhythm — same distribution as `euclidean`, but rhythm-typed. `euclid(3, 8)` = tresillo. |
| `euclid(hits, steps, offset)` | Euclidean rhythm with rotation offset. |
| `pattern(v1, v2, ...)` | Explicit step velocities. Numbers allowed for per-step accent; 0 = rest. Step count sets the period (each step = `1/16` of a bar). |
| `pattern("x-xx-x-x-")` | String form. `x` / `X` = hit, `-` / `.` / `_` = rest. Whitespace ignored. 16 chars = 1 bar. |

**Combinators**

The `+` / `*` / `-` operators overload **only when both sides are rhythm-typed**. Mixed rhythm/number expressions are left alone — the rhythm auto-casts to its gate value.

| Block | Sugar | Description |
|-------|-------|-------------|
| `rhythm_or(a, b)` | `a + b` | Union — hits on either. |
| `rhythm_and(a, b)` | `a * b` | Intersection — hits only where both fire. |
| `rhythm_diff(a, b)` | `a - b` | Difference — hits of `a` that are not in `b`. |
| `delay(r, beats)` | | Shift by `beats` (fraction of a bar). `delay(r, 1/32)` nudges for swing. |
| `stretch(r, factor)` | | Stretch the period. `stretch(r, 2/3)` = triplet feel. |
| `every_nth(r, n)` | | Pass every Nth hit of `r`. |
| `invert(r)` | | Flip hits and rests. |
| `gate(r)` | | Explicit 0/1 extraction (usually implicit). |
| `velocity(r)` | | Per-hit velocity in `[0,1]`. |

**Examples:**
```text
// pattern math: union, intersection, difference
let kick  = every(1/4)
let hats  = every(1/8)
let snare = euclid(3, 8)
let drums = kick + hats + snare
gradient_rad(0.5, 0.5, 0.4) * drums

// swing: eighths plus delayed eighths
let straight = every(1/8)
let swung = straight + delay(straight, 1/32)
circle(0.5, 0.5, 0.3) * swung

// 3-over-8 intersected with 5-over-8
let a = euclid(3, 8)
let b = euclid(5, 8)
rect(0.5, 0.5, 0.6, 0.3) * (a * b)

// son clave via string pattern (16 sixteenths = 1 bar)
let clave = pattern("x--x--x---x-x---")
circle(0.5, 0.5, 0.3) * clave
```

---

### 6.13 Sample-and-hold

`sh(value, rhythm)` samples `value` on each rising edge of `rhythm` and holds the sampled value flat between hits. The classic random-step pad: feed a smooth LFO through `sh`, and every hit teleports the output to a new level that stays until the next trigger.

| Block | Description |
|-------|-------------|
| `sh(value, rhythm)` | Samples `value` on each hit of `rhythm`, holds it until the next hit. Both arguments must be CPU-scalar (LFOs, `knob`, arithmetic). UV-varying inputs like `perlin` aren't supported. |

```text
let trigger = every(1/8)
let noise   = sine(0.37) * 0.4 + sine(1.13) * 0.3 + sine(2.71) * 0.3
let stepped = sh(noise, trigger)
circle(0.5, 0.5, stepped * 0.6 + 0.25)
```

---

### 6.14 MIDI output

Grain can emit MIDI notes and CC messages alongside the visual output. MIDI sinks are CPU-evaluated side effects — they don't contribute to the rendered image, but returning 0 from each call lets them be added into a pipeline (`note(...) + circle(...)`) so they sit inside the program without branching.

Enable MIDI output in `--live` mode with `--midi-out <substring>`. The first port whose name contains the substring (case-insensitive) is opened — e.g. `--midi-out iac` targets the macOS IAC bus. MIDI output is ignored in PNG / MP4 export modes.

| Block | Description |
|-------|-------------|
| `note(rhythm, pitch, velocity=1, length=1/8, channel=1)` | Fires a MIDI note-on at each hit of `rhythm`, with automatic note-off after `length` (bar fraction, converted to seconds via BPM). `velocity` is clamped to 0–1 and quantised to 0–127. |
| `cc(cc_num, value, channel=1)` | Continuous CC output. Emitted every frame, but the runtime dedups on the quantised 0–127 byte, so a smooth LFO only sends when the byte actually changes. |
| `cc(rhythm, cc_num, value, channel=1)` | Rhythm-gated CC. Fires once on each hit of `rhythm`, force-sent even if the byte is unchanged so the target always receives the event. |

```text
// Kick on every quarter, snare on 1/2 — run with `--midi-out iac`
let kick  = every(1/4)
let snare = every(1/2)
note(kick,  36, velocity: 0.9, length: 1/16)
  + note(snare, 38, velocity: 0.7, length: 1/16)
  + gradient_rad(0.5, 0.5, 0.4) * (kick + snare)

// Continuous CC 1 (mod wheel) + per-hit CC 2 snapshot
let lfo    = sine(0.5) * 0.5 + 0.5
let pulses = every(1/4)
cc(1, lfo) + cc(pulses, 2, lfo) + circle(0.5, 0.5, lfo)
```

---

### 6.15 MIDI input

Grain can read notes, CC values, and external clock from any connected MIDI device or software port.

Enable with `--midi-in <substring>` in `--live` mode. The first input port whose name contains the substring (case-insensitive) is opened — e.g. `--midi-in keystep`. All readers return 0.0 when no device is connected.

| Reader | Returns |
|--------|---------|
| `midi_gate(channel: N, pitch: P)` | 1.0 while note P on channel N is held, else 0.0. |
| `midi_gate(channel: N, pitch_low: A, pitch_high: B)` | 1.0 if any note in the pitch range [A, B] is held on channel N. |
| `midi_vel(channel: N, pitch_low: A, pitch_high: B)` | Latched velocity (0..1) of the most recent note-on in the pitch range. Holds its value after note-off until the next hit. |
| `midi_pitch(channel: N, pitch_low: A, pitch_high: B)` | Latched pitch (0..1, normalised against 0..127) of the most recent note-on in range. |
| `midi_cc(channel: N, cc: K)` | CC K on channel N, as 0..1. |
| `midi_clock` | External BPM derived from incoming MIDI clock pulses (averaged over the last 24 pulses). Returns 0.0 when no clock is active. When non-zero, also overrides the global tempo. |

**Channel 0** is omni — any channel matches.

```text
// Drum flash + mod-wheel hue shift — run with `--midi-in keystep`
let drum_hit = midi_gate(channel: 10, pitch_low: 36, pitch_high: 51)
let drum_vel = midi_vel(channel: 10, pitch_low: 36, pitch_high: 51)
let flash     = ar(drum_hit, 1/1000, 1/8) * drum_vel
let mod_wheel = midi_cc(channel: 1, cc: 1)
hue_shift(gradient_rad(0.5, 0.5, 0.5), mod_wheel) * (0.3 + flash)
```

---

## 7. Block performance

Numbers below are per-block GPU times measured by `--profile 200` at 1920×1080 on an Apple M1. Use them as relative cost guidance — actual cost on your GPU scales roughly linearly with pixel count, since per-pixel fragment shader work dominates per-pass overhead (see `perf/report.md` for the full scaling analysis).

**Methodology.** Each block is wrapped in a minimal program of the form `let op = <expression>; mix(op, rgb(0,0,0), knob(0,0))` and run with `--profile 200 -W 1920 -H 1080`. The reference baseline is the simplest dynamic program (`rgb(uv_x, uv_y, fract(time))`), which renders in **~0.4 ms GPU / ~1.45 ms wall-clock**. The wall-clock floor is fixed CPU dispatch + pipeline poll overhead and doesn't change between programs; the per-block GPU time is the moving part. The "Op cost" column is the GPU time of the block under test (or, for blocks the compiler fuses into the output pass, the output block's GPU time minus the baseline).

For filters, the input source materializes as its own render pass and the filter pass reads it as a texture, so the filter's per-block GPU time is isolated. For most other ops, the compiler fuses everything into one fragment shader pass and the cost is whatever the output pass measures.

### 7.1 At a glance

| Cost class | Per-block GPU @ 1920×1080 | Examples |
|---|---|---|
| **Negligible** (< 0.2 ms) | barely above baseline | All spatial transforms (`shift`, `rotate`, `zoom`, `flip_h`, `mirror`, `shear`, `tile`, `perspective`, `pixelate`), most color ops (`brightness`, `contrast`, `color_matrix`, `palette`, `palette_n`, `hsv_to_rgb`, `rgb_to_hsv`), `sample_at`, `repeat_grid`, `white` noise, all builtins (`uv_x`, `time`, `tempo`, …), `sharpen`, shapes / gradients |
| **Cheap** (0.2 – 1 ms) | small but measurable | `hue_shift`, `saturate`, `dither_bayer`, `blur_h(r=4)`, `blur_v(r=4)` |
| **Moderate** (1 – 4 ms) | adds up if you stack a few | `procedural_palette`, `perlin(1 oct)`, `voronoi_static`, `blur(r=2)` |
| **Heavy** (4 – 8 ms) | budget-eating | `voronoi`, `perlin / fbm / curl (4 oct)`, `perlin_xyz (4 oct)`, `blur(r=4)`, `bloom` |
| **Very heavy** (> 8 ms) | use sparingly or at low res | `perlin / fbm (8 oct)`, `blur(r=8)`, `domain_warp (4 oct)` |

### 7.2 Sources

These produce a video signal from scratch. Cost scales linearly with `octaves` for the noise families.

| Block | Op cost (ms) |
|---|---:|
| `white(seed)` | < 0.2 |
| `circle`, `rect`, `gradient_lin`, `gradient_rad` | < 0.1 |
| `perlin(scale, 1, time_scale, seed)` | 1.6 |
| `voronoi_static(scale, seed)` | 2.0 |
| `perlin_static(scale, 4, seed)` | 2.2 |
| `voronoi(scale, time_scale, seed)` | 4.2 |
| `curl(scale, time_scale)` | 5.7 |
| `perlin_xyz(x, y, z, scale, 4, seed)` | 5.8 |
| `fbm(scale, 4, time_scale, seed)` | 5.8 |
| `perlin(scale, 4, time_scale, seed)` | 6.0 |
| `fbm(scale, 8, time_scale, seed)` | 12.5 |
| `perlin(scale, 8, time_scale, seed)` | 14.0 |
| `domain_warp(scale, 0.5, 4, time_scale, seed)` | 20.7 |

`fbm` and `perlin` at the same octave count cost roughly the same — `fbm` *is* stacked perlin octaves. `domain_warp` is ~3.5× more expensive than plain `perlin(4 oct)` because each output pixel runs perlin twice (once to compute the warp offset, once on the warped coordinates).

**Static variants benefit only when materialized as their own pass.** A bare `perlin_static(...)` inlined into a dynamic output pass (e.g. wrapped through any expression that uses `time` / `knob`) re-runs every frame and pays the full cost. To get the cache benefit, give the static expression its own `let` binding *and* feed it through a filter, `sample_at`, or other consumer that forces texture materialization.

### 7.3 Filters

Multi-tap convolution. Cost is dominated by sample count. Input is read from a real texture so the filter pass cost is isolated from input compute.

| Block | Op cost (ms) | Sample count per pixel |
|---|---:|---:|
| `sharpen(input, amount)` | 0.7 | 5 |
| `blur_v(input, 4.0)` | 1.6 | 9 |
| `blur_h(input, 4.0)` | 1.8 | 9 |
| `blur(input, 2.0)` | 2.6 | 25 |
| `bloom(input, 0.7, 3.0, 0.5)` | 3.6 | 49 |
| `blur(input, 4.0)` | 4.2 | 81 |
| `blur(input, 8.0)` | 14.0 | 289 |

`blur(r=N)` costs roughly `(2N+1)²` texture samples per pixel. For large radii prefer the **separable form** `blur_h(_, N) >> blur_v(_, N)`, which costs `2 × (2N+1)` samples — for `r=4` that's two 1.7 ms passes (~3.5 ms) versus one 4.2 ms full pass, and the gap widens fast: at `r=8`, separable would be ~6 ms versus 14 ms for full.

### 7.4 Spatial transforms

These reshape UV before sampling the input. All are essentially free because the compiler fuses them into the consumer's fragment shader as inline UV math.

| Block | Op cost (ms) |
|---|---:|
| `shift`, `zoom`, `rotate`, `flip_h`, `mirror`, `shear`, `tile`, `perspective`, `pixelate` | < 0.05 (within baseline noise) |
| `warp(input, fx, fy)` | 0.1 + an extra ~0.3 ms auto-allocated displacement-map block |

`warp` is the only outlier — it auto-allocates an offscreen pass for the displacement map. Everything else is free.

### 7.5 Color operations

| Block | Op cost (ms) |
|---|---:|
| `brightness`, `contrast`, `color_matrix`, `palette`, `palette_n` | < 0.05 |
| `hsv_to_rgb`, `rgb_to_hsv` | ~0.1 |
| `dither_bayer` | ~0.2 |
| `saturate`, `hue_shift` | ~0.2 – 0.3 |
| `procedural_palette(input, base_hue, hue_angle, colors, sat)` | ~1.3 |

`palette` and `palette_n` are nearly free even with many stops because the lookup is an unrolled `mix` chain. `procedural_palette` is the only color op that hurts — it does a full HSV→RGB conversion plus per-step trig per pixel.

### 7.6 Sampling

| Block | Op cost (ms) |
|---|---:|
| `sample_at(input, u, v)` | < 0.05 |
| `repeat_grid(input, nx, ny)` | < 0.1 |
| `render_at(input, xres, yres)` | depends on `xres × yres`, not output res |

`render_at` allocates a separate offscreen pass at `xres × yres`. The cost shown by the per-block report is the fragment shader at the **target** resolution, not 1920×1080, so it's the right tool for cheap low-res lookups: pattern `sample_at(render_at(expensive_op, 256, 256), uv_x, uv_y)` lets you do expensive per-pixel work at 256×256 (1/30th the pixels) and upsample for free. `render_at` only materializes the low-res pass when consumed via `sample_at` or another texture-reading op — by itself, the compiler may fuse it back into the output pass.

### 7.7 Pipeline overhead

Cheap ops chain for free: a 5-stage pipeline (`brightness >> flip_h >> zoom >> rotate >> shift`) measures the same as a single `brightness`, because the compiler fuses the entire chain into one fragment shader. A pipeline only adds a render pass when the consumer needs to *sample* from a texture (filters, `sample_at`, `render_at`, multi-use `let` bindings). This means: stack as many cheap UV transforms and color ops as you want; the cost knobs that matter are noise sources, filter radii, and the number of materialized passes.

---

## 8. Example programs

See the `examples/` directory:

| File | Shows |
|------|--------|
| `01_basics.grain` | Literals, `uv_x`/`uv_y`, arithmetic |
| `02_noise.grain` | `let`, Perlin + white noise |
| `03_math.grain` | `fract` |
| `04_pipeline.grain` | `>>`, `_` |
| `05_let_and_fn.grain` | `fn` |
| `06_color_and_mix.grain` | Color literals, `mix` |
| `07_time.grain` | `time` (animation) |
| `08_input.grain` | `in(0)` (use with `-i`) |
| `09_feedback.grain` | `fin(0)` / `fout(0)` (MP4) |
| `10_gradients.grain` | `gradient_lin`, `gradient_rad` |
| `11_multi_input.grain` | `in(0)`, `in(1)` (multiple `-i` sources) |
| `12_import.grain` | `use "lib.grain"` (shared fn from another file) |
| `13_spatial.grain` | `shift`, pipeline with input (use with `-i`) |
| `14_color.grain` | `color_matrix` (swap R/G) |
| `15_color_ops.grain` | `rgb_to_hsv`, `hsv_to_rgb`, `blend_add` |
| `16_spatial_more.grain` | `zoom`, `rotate` on `in(0)` (use with `-i`) |
| `17_filters.grain` | `blur` (use with `-i`) |
| `18_knobs.grain` | `knob(0)` … (use with `--live`) |
| `20_lfo.grain` | `sine`, `tri`, `saw`, `square` |
| `21_shapes.grain` | `circle`, `rect` |
| `22_repeat_grid.grain` | `repeat_grid`, `cell_cx`/`cell_cy`, size by position |
| `24_render_at.grain` | `render_at` + `sample_at` for low-res grid modulation |
| `25_sequencer.grain` | `seq`, `toggle`, `button`, `ar` envelopes (use with `--live --bpm 120`) |
| `26_noise_combo.grain` … `75_full_combo.grain` | Complex combos: noise, gradients, shapes, LFOs, blends, input, feedback. Also includes rhythm-type demos (`30_rhythm_math`, `31_rhythm_swing`, `32_rhythm_polyrhythm`, `33_clave`), MIDI output (`34_midi_note`, `35_midi_cc`), sample-and-hold (`36_sample_hold`), and infix operators (`41_infix_ops`). The full set numbers ~180 files; high-numbered ones (200+ vector, 300+ language features) are listed individually below. |
| `76_dither_palette.grain` | `palette_n`, dither (uncomment lines for `dither_bayer` / `dither_threshold` / `palette`) |
| `77_floor_fract.grain` … `126_mega_combo.grain` | 50 more: medium simple → super complex (math, noise, shapes, LFOs, blends, input, feedback, render_at, palette) |
| `127_mirror.grain` | `mirror` — four-way reflected tiling (use with `-i`) |
| `128_perspective.grain` | `perspective` — bilinear corner warp (use with `-i`) |
| `129_quantize_threshold.grain` | `palette_n`, `threshold` — posterize and remap on noise |
| `130_abs_diff.grain` | `abs_diff` — absolute difference between two noise signals |
| `131_fbm.grain` | `fbm` — fractal Brownian motion |
| `132_curl_noise.grain` | `curl` — divergence-free flow field |
| `133_domain_warp.grain` | `domain_warp` — warped perlin |
| `134_tileset_basic.grain` … `137_autotile_basic.grain` | `tileset`, `tileset_px`, `autotile` variants |
| `138_shift_isolated.grain` … `154_bloom_isolated.grain` | One transform / filter per file for isolated testing |
| `155_blend_add.grain` … `159_blend_difference.grain` | Each blend mode in isolation |
| `160_smoothstep.grain` | `smoothstep` |
| `161_switch.grain` | `switch` |
| `162_hold_every.grain` | `hold_every` |
| `163_render_at_basic.grain` | Minimal `render_at` + `sample_at` demo |
| `164_fn_def.grain` | Function definitions |
| `165_color_literal.grain` | `rgb` / `rgba` literals |
| `166_feedback_simple.grain`, `167_feedback_shift.grain` | Feedback basics |
| `168_two_input_blend.grain` | Two-input blending (`in(0)`, `in(1)`) |
| `169_voronoi_2d.grain`, `170_simplex_2d.grain` | Voronoi and simplex noise |
| `171_dither_bayer.grain`, `172_hsv_roundtrip.grain` | Dither + HSV round-trip |
| `173_pipeline_chain.grain`, `174_math_ops.grain` | Long pipeline chains and math op sampler |
| `200_vsvg_inline.grain`, `201_vsvg_curves.grain` | `vsvg` — inline SVG path-data and curves |
| `202_raster_fill.grain`, `203_raster_outline.grain` | `raster_fill` / `raster_outline` — vector → raster bridge |
| `300_placeholders.grain` | `<>` / `<lo..hi>` placeholders — drives `--population` / `--mutate` / `--resolve` |
| `301_conditions.grain` | `if` / `gt` / `lt` / `eq` / `between` / `mask_and` / `mask_not` |
| `302_lambdas.grain` | `\|param\| body` lambda expressions and higher-order use |
| `302_video_modulation.grain` | `texture_out` end-to-end — per-pixel modulation of a knob via a noise field |

**Run the example test suite:** `cargo test --workspace` runs a parse-check over every `.grain` file in `examples/` as part of the standard test suite.

---

## 9. Vector / ILDA output

When built with the `live` feature and run with `--ilda` (Ether Dream DAC), `--helios <DEVICE>` (Helios DAC, requires the `helios` build feature), or `--ild-output <FILE>` (offline `.ild` export), Grain can also draw line art for vector displays. The vector primitives below are CPU-evaluated and produce vector paths instead of pixels — they don't compose with the raster pipeline.

**Primitives** — all coordinates are in UV space (0..1):

| Block | Description |
|-------|-------------|
| `vcircle(cx, cy, d)` | Vector circle outline. `d` is diameter (matches raster `circle`); aliases `r=` / `radius=` accept half-values. |
| `vrect(cx, cy, w, h)` | Vector rectangle outline. |
| `vline(x1, y1, x2, y2)` | Vector line segment. |
| `vpoly(cx, cy, radius, sides)` | Regular polygon outline with `sides` vertices. |
| `vsvg(source, cx?, cy?, scale?, index?)` | Vector path from an SVG file, inline path-data string, or folder of SVGs. See below. (`time` is an alias for `index` — `.time(t)` reads naturally for animated playback.) |
| `vrepeat(\|i\| body, n)` | Repeat a vector body `n` times. The lambda's parameter is bound to the integer index `0..n-1` each iteration; use it to position copies manually. Iterations are joined with blanking so disjoint shapes stay disjoint. |
| `vparam(\|t\| body, n)` | Sample a parametric curve. Evaluates `body` at `n` evenly-spaced `t` in `[0, 1)` and emits the results as one connected polyline (so the laser draws a continuous path, not `n` jumps). Body is typically `vdot(x(t), y(t))`. Unlocks Lissajous, rose curves, spirographs, traveling waves, etc. as one-liners. |
| `vresample(input, n)` | Redistribute the input polyline's vertices to `n` evenly-spaced points along its arc length. Auto-detects open vs closed paths via first/last point proximity. Use to cap point budget on over-sampled `vparam` output, make laser dwell uniform, or normalise point counts before `vmorph`. |
| `vsimplify(input, tolerance)` | Douglas-Peucker decimation: drops vertices whose perpendicular distance to the chord between their kept neighbours is below `tolerance` (in UV units). Silhouette preserved within `tolerance`. Pair with `vresample` if a fixed count is needed afterwards. |
| `vsmooth(input, tension, subdivisions)` | Catmull-Rom spline smoothing. Each input segment becomes `subdivisions` samples along a curve blending linear (`tension=0`) ↔ full cardinal spline (`tension=1`). Open/closed inputs handled automatically. Output count is roughly `subdivisions × segments`. |
| `vsampled(input, trigger, dx, dy)` | Sample-and-hold with per-vertex drift. While `trigger > 0.5`, re-samples live `input` and passes through (cumulative drift resets). While `trigger ≤ 0.5`, keeps the stored polyline and displaces each vertex per frame by `(dx, dy)` evaluated at *that* vertex's position (same per-vertex contract as `warp`). Drop a curl/perlin/`domain_warp` field into `dx`/`dy` for vector flow; a constant for uniform drift. Pair with `impulse()` for rising-edge one-shot capture. Pre-arm output falls through to live input (never empty). |
| `vfb(\|prev\| body, init)` | Vector feedback loop. Frame 0 outputs the evaluated `init`; subsequent frames output `body` with `prev` bound to last frame's output. Point count is preserved as long as the body doesn't grow it (avoid `+ shape` inside the loop). Typical idioms: `vfb(\|p\| rotate(p, 0.01), liss(3, 2))` for a slow spiral, `vfb(\|p\| warp(p, cx*j, cy*j), seed_circle)` for flow-field motion. |
| `vmorph(a, b, t)` | Smoothly blend between two vector shapes. Both shapes are resampled along their arc length (capped at 512 points) and the cyclic shift that minimises pairwise distance is picked, so corresponding points line up before interpolation. `t` in `[0, 1]` mixes from `a` to `b`. |
| `vslice(input, start, end)` | Emit only the arc-length subrange `[start, end]` of a vector path (`0` = start of path, `1` = end). When `start > end` the slice wraps across the seam, useful for animated path reveals. |
| `vwindow(input, mid, fraction)` | Emit a window of `fraction` of the input path's arc length centered on `mid` (both in `[0, 1]`). Wraps across the seam when the window crosses 0/1, so animating `mid` slides a smooth scrolling head along a closed loop. `fraction=0` emits nothing; `fraction>=1` passes the full path through. |
| `vswitch(value, vbranch0, vbranch1, …)` | Vector-side `switch`: picks branch `⌊value⌋ mod N` and evaluates only that one. The selector is scalar; every other arg is a vector expression. Same lazy semantics as scalar `switch` — unselected branches don't pay any point cost. |
| `voverlay(under, cover)` | Concatenate `under` and `cover` while blanking any of `under`'s points that fall inside `cover`'s polygon (point-in-polygon ray cast). Lets `cover` "punch through" `under` for occlusion-style compositions. |
| `vunion(a, b)` | Outline of `a ∪ b` — the merged silhouette via polygon clipping. Internal edges where the two shapes overlap are dropped; only the outer boundary is traced. Subject's color is preserved. |
| `vintersect(a, b)` | Outline of the overlap region only (`a ∩ b`). Empty when the shapes are disjoint. |
| `vdifference(a, b)` | `a − b`: a's outline with b's interior cut out. Where `b` cuts into `a`, `b`'s boundary is exposed (so a hole-in-shape pattern is one cell of `vdifference`). |
| `vxor(a, b)` | Symmetric difference: regions covered by exactly one of `a`, `b` (i.e. `(a∪b) − (a∩b)`). The overlap is dropped, both crescents remain. |

**Type checking** — vector ops produce no output silently when fed a non-vector first arg (a knob, a number, or a raster builtin like `rect`). The compiler now catches the obvious cases at compile time:

```text
in `output`: 'vout' expects a vector expression, got raster/scalar builtin `rect` — did you mean `vrect`?
in `output`: 'vwindow' expects a vector expression as its first arg, got a `knob` — vector ops produce no output silently when fed a non-vector. Wrap a vector source like `vcircle`, `vrect`, `vline`, `vpath`, or `vrepeat` in front.
```

The check fires for every vector builtin (`vmorph`, `vslice`, `vwindow`, `voverlay`) and every spatial transform that requires a vector input, plus the `vout` sink itself. NameRefs and unknown calls are skipped — they could resolve either way.

**`vsvg` — SVG vector input.** `source` is one of three forms, detected in this order:

1. **Single file** — the string ends in `.svg` (case-insensitive). Resolved relative to the program file, same convention as `play()`.
2. **Folder of SVGs** — the string resolves to an existing directory. All `*.svg` files inside are loaded once and sorted lexically, then `index` picks one per frame — `floor(index) % count` (wraps on negative values). Files that fail to parse are skipped with a warning instead of failing the whole batch.
3. **Inline path data** — the string is treated as the raw contents of a `<path d="...">` attribute (e.g. `"M 0 0 L 10 0 …"`).

Supported SVG shape elements inside each file: `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`. The first matching element in source order is used; non-path shapes are converted to equivalent path data internally. All standard path commands are supported (`M L H V C S Q T A Z`, absolute and relative); curves (`C S Q T A`) are flattened by adaptive subdivision.

`cx`/`cy` (default `0.5`) place the center in UV space. `scale` (default `1vmin`) sizes the path so the longer bbox axis matches `scale` units of the shorter display axis — so a circle drawn via `vsvg` stays round on non-square outputs (same aspect compensation as `vcircle`). `index` (default `0`) is ignored for single-file and inline sources. Multiple subpaths inside one SVG are emitted with blanking between them, so disjoint shapes stay disjoint on the laser.

**Folder playback — using `vsvg` like a video.** When `source` is a folder, each SVG inside is one "frame" and `index` (alias: `time`) is the frame selector. Drive it with any scalar signal to animate. The named-arg method-chain form `vsvg(path).time(t)` is the most readable for animation; `index:` and positional forms work too.

```text
// 12 fps continuous playback, loops over the folder forever
vsvg("anim/").time(time * 12) >> vout

// Step on every beat — one frame per beat, counter wraps via `% count` internally
vsvg("anim/").time(counter(beat(1))) >> vout

// Step sequencer picks explicit frames (0-indexed, length-16 pattern)
vsvg("anim/").time(seq(0, 16)) >> vout

// Scrub with a knob over a 16-frame folder: `knob() * 16` covers 0..15
vsvg("anim/").time(knob() * 16) >> vout

// Equivalent named-arg form
vsvg("anim/", time: time * 12) >> vout
```

The folder is read and every file parsed on first use, then cached — playback is just index lookup on each frame, so it's cheap even with hundreds of files. Lexical sort means naming files `01.svg`, `02.svg`, … keeps them in order; use zero-padded names if the count ever crosses a power of ten.

```text
// File path, default center and size
vsvg("shapes/01.svg") >> vout

// Inline path-data, repositioned and scaled
vsvg("M 0 0 L 10 0 L 10 10 L 0 10 Z", 0.3, 0.7, 0.4) >> vout

// Combine with transforms — `vsvg` composes like any other vector primitive
rotate(vsvg("logo.svg", scale: 0.6vmin), time) >> vout

// Rasterize for the video pipeline
raster_outline(vsvg("logo.svg"), 0.005)
```

Loaded SVGs are cached by source string, so reusing the same file (or folder) across frames or across multiple `vsvg(...)` calls only parses once.

**`vrepeat` — manual repetition.** `vrepeat(|i| body, n)` evaluates `body` once per `i` in `0..n-1`, with `i` available as a scalar inside the body so you can drive position, size, color, or any other parameter from the index.

```text
// Five circles spaced across the canvas
vrepeat(|i| vcircle(0.1 + i * 0.2, 0.5, 0.05), 5) >> vout

// Animated phyllotaxis-style scatter
vrepeat(|i| vcircle(0.5 + cos(i * 2.4 + time) * i * 0.02,
                    0.5 + sin(i * 2.4 + time) * i * 0.02,
                    0.01),
        50) >> vout
```

**`vparam` — parametric curves.** Where `vrepeat` emits `n` separate shapes joined by blanking, `vparam` emits one connected polyline sampled along a continuous curve — exactly what a laser wants for smooth path tracing. `t` is normalised to `[0, 1)` (not inclusive of 1) so closed curves wrap cleanly with no seam-duplicate point. The lambda's first output point is what's kept per sample, so `vdot(x(t), y(t))` is the canonical body.

```text
// Lissajous: 3-vs-2 frequencies, 200 samples
vparam(|t| vdot(0.5 + 0.4 * cos(t * 3 * pi2),
                0.5 + 0.4 * sin(t * 2 * pi2)), 200) >> vout

// Rose curve r = cos(k·θ)
vparam(|t| vdot(0.5 + 0.4 * cos(5 * t * pi2) * cos(t * pi2),
                0.5 + 0.4 * cos(5 * t * pi2) * sin(t * pi2)), 256) >> vout
```

`vresample`, `vsimplify`, `vsmooth` are stateless pipeline operators — they take a vector input and return a transformed vector. They compose freely:

```text
// Cap an over-sampled curve at 128 points
vparam(|t| ..., 1000) >> vresample(_, 128) >> vout

// Smooth out an SVG, then decimate noise
vsvg("logo.svg") >> vsmooth(_, 0.5, 8) >> vsimplify(_, 0.002) >> vout
```

**`vsampled` — sample-and-hold with drift.** Holds a snapshot of `input` and drifts each vertex per frame. The `trigger` gate decides whether to re-sample (gate high → live passthrough + reset drift) or hold (gate low → frozen polyline drifts each frame). Combine with `impulse(...)` for one-shot capture on a button press:

```text
// On button "snap": capture live input, then let curl noise drift it
vsampled(vparam(|t| vdot(cos(t*pi2)*0.4+0.5, sin(t*pi2)*0.4+0.5), 200),
         impulse(button("snap")),
         curl_x * 0.005,
         curl_y * 0.005) >> vout
```

**`vfb` — vector feedback.** Mirror of scalar `fb` for polylines: the lambda's `prev` argument is bound to the previous frame's output. Frame 0 outputs `init`. Hot-reloading a program that reorders stateful primitives produces one wrong frame before re-stabilising — same caveat as scalar feedback.

```text
// Slow spiral: rotate the previous frame's curve a hair each frame
vfb(|p| rotate(p, 0.01), liss(3, 2)) >> vout

// Flow-field motion: warp the previous frame by a curl field
vfb(|p| warp(p, curl_x * 0.003, curl_y * 0.003), seed_circle) >> vout
```

**`vout` — vector output sink**: every vector primitive has to flow into `vout` to be sent to the DAC / ILDA file. Two forms:

```text
// Explicit sink with optional points-per-shape
vout(vcircle(0.5, 0.5, 0.3))
vout(vcircle(0.5, 0.5, 0.3), 200)    // 200 points along the circumference

// Pipeline form (bare `vout`)
vcircle(0.5, 0.5, 0.3) >> vout
```

Multiple vector expressions can be summed or wrapped in `add(...)` before reaching `vout`. The sink treats its input as a collection of shapes and emits their concatenated point list.

**Vector → raster bridge** — vector graphics aren't laser-only. Two builtins convert a vector expression into a raster signal that flows through the rest of the raster pipeline (blur, blend, feedback, …):

| Block | Description |
|-------|-------------|
| `raster_fill(vec)` | Rasterize a vector expression as filled polygons (triangle-fan from the first vertex of each subpath). Returns a video. |
| `raster_outline(vec, thickness)` | Rasterize a vector expression as a stroked outline. `thickness` is aspect-corrected (default `0.01vmin`). Returns a video. |

The `vec` argument accepts any vector primitive (`vcircle`, `vrect`, `vline`, `vpoly`, `vsvg`) including transformed forms like `rotate(vpoly(...), time)`. The rasterizer runs each frame on the GPU and is only spun up when the program uses one of these builtins.

```text
// Soft white hexagon
blur(raster_fill(vpoly(0.5, 0.5, 0.3, 6)), 8)

// Stroked rotating pentagon mixed with a background
mix(rgb(0.05, 0.05, 0.1), raster_outline(rotate(vpoly(0.5, 0.5, 0.3, 5), time), 0.01), 0.8)
```

---

## 10. Placeholders & population sweeps

Write `<>` (or `<lo..hi>`) anywhere a scalar literal would go. Each
placeholder is a hole the renderer fills with a random value. Combined with
the `--population` flag, the same program renders many variations in one
shot — a fast way to explore a parameter space before committing to numbers.

### Syntax

| Form              | Meaning                                                         |
|-------------------|-----------------------------------------------------------------|
| `<>`              | uniform sample in `[0, 1]`                                      |
| `<lo..hi>`        | uniform sample in `[lo, hi]` — negative bounds OK               |
| `<lo..hi>vmin`    | range with a unit suffix (`px`, `vw`, `vh`, `vmin`, `vmax`)     |

```text
let n = perlin(<0.1..0.6>, 2, <>, 0)
let g = gradient_rad(<>, <>, <0.2..0.8>)
mix(n, g, <0.2..0.8>) >> tanh
```

A bare `grain -f program.grain ...` (no `--population`/`--seed`) substitutes
each placeholder with its **range midpoint**, so a placeholder-bearing
program is always renderable on its own.

### CLI

| Flag                       | Behaviour                                                                                  |
|----------------------------|--------------------------------------------------------------------------------------------|
| `--population N`           | Render N variations with seeds `1..N`. `-o` is treated as a folder.                        |
| `--seed S`                 | Render exactly one variation with seed `S` (works with image, video, or `--live`).        |
| `--mutate S --population N`| Render N variations *near* parent seed `S` using adaptive jitter (5–25% of each range).   |
| `--resolve S`              | Rewrite the source file in place, replacing each placeholder with seed `S`'s value. No render. |

Per-seed files land at `<folder>/seed_NNNN.<ext>` for an initial population
and `<folder>/pop_p<S>/seed_NNNN.<ext>` for a mutation around parent `S`.
Each folder also gets a `manifest.txt` listing the values used.

Sampling is deterministic: seed `S` always produces the same values for the
same source, so seeds are reproducible across machines.

### Workflow

```bash
# 1. Render an initial population to compare looks.
grain -f program.grain --population 16 --duration 2 -o out/

# 2. Spot a favourite (say seed_0007.mp4). Mutate around it.
grain -f program.grain --mutate 7 --population 16 --duration 2 -o out/

# 3. Iterate — the mutation outputs land in out/pop_p0007/.
#    When happy with seed_0003 from that batch, mutate around it next:
grain -f program.grain --mutate 3 --population 16 --duration 2 -o out/

# 4. Bake the winning seed into the source file (in place).
grain -f program.grain --resolve 3
```

The resolved file no longer contains any `<>` placeholders, so it renders
identically to a `--seed 3` run and is safe to commit.

---

## 11. Modulation routing

Modulation lets a signal computed inside the program drive a control element
(knob, toggle, button, radio, pressure) live, without touching the program
source. You **expose** a signal as a routable source with `mod_out(...)`
(scalar) or `texture_out(...)` (per-pixel video) and then **route** it to one
or more targets from the web UI or the Push.

### Exposing a scalar signal

Wrap any scalar expression with `mod_out`. The runtime evaluates it once per
frame on the CPU, pushes the result into a corresponding `mod_source`
surface element (so it can be routed), AND **substitutes the value back
into the surrounding expression** so signal flow can use it directly. The
return value is **always 0** — `mod_out` is a pure side channel, not a
value-passing wrapper. Adding `mod_out(...)` into a signal chain leaves
the chain unchanged. The signal is only available via routing onto a
target knob through the surface UI.

```text
fn lfo()  = mod_out("lfo", sin(time * 2))
fn env()  = mod_out("env", audio_env(low: 40, high: 120) * 0.8)
fn beat() = mod_out("beat", ar(beat(1), 0.05, 0.05))

// Declare three routable mod sources. The `+` sums of zeros — visible
// effect comes from routing each source to a target knob in the surface.
section("mod", lfo() + env() + beat()) + shape >> ...
```

Each `mod_out(...)` call (a) evaluates `signal` CPU-side every frame,
(b) registers it as a `ModSource` on the surface with the given label,
and (c) collapses the call expression to `0` so it doesn't contribute
to the surrounding arithmetic. To make a modulator visibly affect
output, drag the source onto a target knob in the surface UI.

Forms (canonical label-first form recommended):

| Form                                          | Layout                                              |
|-----------------------------------------------|-----------------------------------------------------|
| `mod_out("label", signal)`                    | auto-positioned (canonical)                         |
| `mod_out("label", signal, col, row)`          | placed at `(col, row)` (canonical)                  |
| `mod_out(signal)`                             | auto-positioned, label defaults to `M{N}` (legacy)  |
| `mod_out(signal, "label")`                    | auto-positioned, explicit label (legacy)            |
| `mod_out(signal, col, row)`                   | placed, default label (legacy)                      |
| `mod_out(signal, col, row, "label")`          | placed, explicit label (legacy)                     |

(The same forms apply to `texture_out` — see §11.4. `vmod_out` is the
deprecated name for `texture_out` and still parses.)

Mod sources are **bipolar** — no clamping at the source. The web UI shows a
center-line bar that grows up for positive values and down for negative ones.

### Step modulation banks (`mod_seq`)

`mod_seq(steps, division, [cols, rows,] [label,] [|trig, gate| body])`
declares N adjacent mod sources at once — a "modulation sequencer" where
each step is its own routable `mod_out`. The cluster cycles one cell per
beat division (or one cell per rising edge of `step:`); when cell `k` is
active its source emits the gate value (or the lambda's per-step output),
and every other cell sits at 0.

Forms:

```text
// 8-step bank, default 16-division clock, 4-wide grid footprint
mod_seq(8, 16, "kick")

// Explicit cluster shape (cols × rows = 8) and label
mod_seq(8, 16, 4, 2, "hat")

// With a per-step envelope: `trig` is the rising-edge pulse, `gate`
// is the level for the duration of the step.
mod_seq(4, 16, "lead", |trig, gate| ar(trig, 0.05, 0.2))

// Signal-driven: advance on a custom step gate, optionally reset.
mod_seq(8, 16, "kick", step: button(0), reset: button(1))

// Active-length: the cluster cycles only the first N cells. Cells with
// index >= active are silent (and dimmed in the UI). Same semantics as
// `seq.active` / `vseq.active`.
mod_seq(8, 16, "v", active: knob("steps"))
```

Each cell registers as an independent `mod_source` with the label
`name[k]`, so you can route them individually to any target. Without a
lambda body, each cell emits a 0/1 gate while its step is active —
useful for triggering envelopes or stepping selector indices via a route.

### Attaching a route

Routes live entirely on the runtime side; they're not written back to the
`.grain` source. They survive hot reloads as long as both endpoints still
exist with the same `(label, kind, col, row)`.

**In the web UI**

1. Click the magenta **ROUTE** button in the header.
2. Click a `mod_source` cell to select it as the source (highlighted magenta).
3. Click any candidate target cell — the route attaches at depth `0` (neutral — turn it up in the panel).
4. The "Routes" panel below the grid lists every route from the selected
   source with a `[-1, +1]` depth slider and a remove button.
5. Click "Change source" to pick a different mod source; click **EXIT ROUTE**
   to leave routing mode (existing routes remain active).

A small magenta dot on a cell means at least one mod source is routed into
it (visible in any mode).

**On the Push**

1. Press and hold a `mod_source` pad to **latch** routing on that source.
   The source pad lights bright magenta; routable targets light faint magenta.
2. While held, tap any routable pad to attach a route at depth `0` (neutral — turn it up in the panel).
   Tapping a routed pad again detaches.
3. The eight top-row encoders adjust route depths in `[-1, +1]` for whichever
   targets are pinned in their column. A target is auto-pinned by tapping it,
   and any pre-existing routes from the source are pinned at latch time.
4. Routed pads light **magenta** (positive depth) or **orange** (negative
   depth), with brightness scaled by `|depth|`.
5. Release the source pad to exit routing.

### Depth and target mapping

Depth is an **attenuverter**: source value × depth is summed into the
target's base value each frame, then mapped per kind:

| Target kind   | Mapping                                                    |
|---------------|------------------------------------------------------------|
| Knob, Pressure| `(base + Σ src·depth)` clamped to `[0, 1]`                |
| Toggle, Button| on if `(base + Σ src·depth) > 0.5`, off otherwise          |
| Radio         | `round(base + Σ src·depth)` clamped to `[0, options-1]`   |

Multiple sources can route into the same target — their contributions are
summed before the per-kind mapping is applied.

### 11.4 Video modulation (`texture_out`)

`texture_out(signal, …)` is the per-pixel cousin of `mod_out`. The signal is
evaluated **per pixel in its own fragment pass** and stored in a
full-resolution texture. When a surface target has a *video route* pointing
at a `texture_out` source, the target's shader use sites expand to:

```text
base + depth * sample(vmod_tex, uv)
```

— spatially varying modulation, instead of a single scalar applied
everywhere. The route plumbing (UI selection, depth slider, Push pads) is
identical to scalar routes; the runtime infers `Scalar` vs `Video` from the
source kind when you call `set_route`.

Use cases:
- Drive a `knob` value differently across the frame with a noise field —
  e.g. a "brightness" knob that varies according to perlin noise.
- Treat a feedback buffer as the modulator so the past frame shapes the
  control surface.

```text
fn brightness_field() =
  texture_out(perlin(uv_x, uv_y, time, 4) * 0.5, "field")
```

`texture_out` differs from `mod_out` in two ways: the return value is the
texture (not a scalar), and the value flows through the GPU rather than
being CPU-evaluated every frame.

---

## 12. Audio synthesis

Grain compiles to a CPU audio engine alongside the GPU video pipeline.
Audio is opt-in: programs that don't declare an `audio { ... }` block
run video-only and the audio device isn't touched.

### 12.1 The `audio { ... }` block

A single top-level block, parallel to the video expression. Has the
same shape as a function body: `let` bindings followed by `out = <expr>`.

```text
audio {
  let env = ar(midi_gate(0, 0, 127), 0.005, 0.2)
  out = saw(midi_pitch(0, 0, 127)) * env * 0.2
}
```

- All audio runs at **48 kHz f32**, regardless of the audio device's
  native rate (native: cpal opens a 48 kHz output; web: the
  AudioWorklet adapts via the AudioContext's sample rate).
- Master out is **mono by default**. For explicit stereo write
  `out = stereo(left_expr, right_expr)`.
- Hot reload of the `.grain` file rebuilds the audio graph with a
  5 ms crossfade — no clicks.

### 12.2 Scalars inside the audio block

The audio engine reads control-rate scalars (MIDI inputs, knobs,
LFOs, sequencers) through a shared snapshot updated by the scalar
driver. Two ways to wire a scalar into audio:

1. **Inline.** Most scalar primitives can be written directly inside
   the audio block; a pre-pass hoists them into synthetic top-level
   bindings:

   ```text
   audio { out = sin(midi_pitch(0, 0, 127)) * 0.2 }
   ```

   Inline UI elements like `knob(...)` and `toggle(...)` auto-place
   into the surface — no need to wrap them in `row(...)` / `col(...)`
   yourself.

2. **Named.** Bind the scalar at the top level and reference it by
   name from inside the block:

   ```text
   let cutoff = knob(200..3000)
   row(cutoff)
   audio { out = saw(220) >> lpf(_, cutoff) * 0.3 }
   ```

### 12.3 Ramp vs sample-and-hold

Scalars arrive 1000× per second; audio runs 48 000× per second. The
engine bridges the rate gap per-input:

- **Oscillator frequencies, filter cutoffs, delay times, envelope
  attack/release, mixer gains** → **Ramped** (1 ms one-pole smoothing).
  Knob jumps never zipper.
- **Envelope gates** (`ar` / `ad` / `adsr`) → **Sample-and-hold**.
  Rising-edge detection needs sharp transitions.

`audio_rate(scalar)` overrides the default to force ramping anywhere.

### 12.4 Primitives

**Oscillators** — phase ∈ [0, 1); freq input is audio-rate (FM and
audio-rate sync are free):

- `sin(freq_hz)`, `saw(freq_hz)`, `square(freq_hz)`, `tri(freq_hz)`

**Noise**:

- `white()` — uniform xorshift, flat spectrum
- `pink()` — Voss-McCartney 7-stage, -3 dB / octave
- `brown()` — leaky integrator of white, -6 dB / octave

**Filters** (state-variable, Q ≈ 0.707):

- `lpf(input, cutoff_hz)`, `hpf(input, cutoff_hz)`, `bpf(input, cutoff_hz)`

**Envelopes** (ported from the scalar evaluators, units in seconds):

- `ar(gate, attack_s, release_s)` — one-shot; latches on rising edge,
  runs attack-then-release to completion regardless of subsequent
  gate transitions
- `ar_gate(gate, attack_s, release_s)` — gated; releases immediately
  on gate-off, even mid-attack
- `ad(gate, attack_s, decay_s)` — attack to 1.0 while gated, decay
  toward 0 otherwise
- `adsr(gate, attack_s, decay_s, sustain, release_s)` — full ADSR

**Delay**:

- `delay_ms(input, time_ms)` — no feedback
- `delay_ms(input, time_ms, feedback)` — circular buffer, max 2 s,
  feedback clamped to ±0.99

**Dynamics**:

- `compress(input, threshold_db, ratio, attack_ms, release_ms)` —
  feedforward; no makeup gain (apply yourself with `* X`)

**Reverb** (Freeverb halves; canonical use is inside a `stereo(...)`):

- `reverb_l(input, room, damp)`, `reverb_r(input, room, damp)`
- `room` ∈ [0, 1] → feedback 0.28..0.98
- `damp` ∈ [0, 1] → in-loop LP coefficient 0..0.4

**k→a conversion**:

- `audio_rate(scalar)` — force the smoothed (ramped) read at sites
  that would default to sample-and-hold.

**Master out**:

- `out = mono_expr` — duplicates to every device channel
- `out = stereo(left, right)` — explicit L/R; ch0 = L, ch1 = R,
  extras get L

### 12.5 Hot reload + debug

On native (live mode), the audio engine starts the first time a
program declares an `audio { ... }` block. Subsequent edits hot-swap
the plan with a 5 ms crossfade. The HTTP debug endpoint `/audio_metrics`
returns:

```bash
curl -s http://127.0.0.1:3000/audio_metrics | jq
# { "sample_rate_hz": 48000, "peak": 0.21, "master_gain": 0.8,
#   "is_open": true, "channels": 2 }
```

Returns 503 until the device opens.

### 12.6 Worked examples

See `examples/40*.grain`:

- `400_audio_sine.grain` — minimum viable tone
- `401_audio_monosynth.grain` — MIDI keyboard → saw + LPF + AR envelope
- `402_audio_reverb.grain` — stereo Freeverb on the monosynth
- `403_audio_fm.grain` — carrier + modulator FM
- `404_audio_drone.grain` — three detuned saws + LPF + stereo reverb
- `405_audio_filter_sweep.grain` — pink noise through an LFO-swept LPF
- `406_audio_pump.grain` — beat-pumped saw bass + compressor

---

## 13. Not yet implemented

- `delay` — frame-level ring-buffer video delay (the rhythm `delay(rhythm, n)` exists, but a per-frame video delay does not)
- `edge:` keyword — wrap / black / clamp edge modes for spatial transforms and filters
- `conv3` — 3×3 convolution kernel
- `emboss`, `edge` — convolution-based filters

`noise_at` was removed in favour of `perlin_xyz(u, v, time, scale)` (or `voronoi_xyz`, `fbm_xyz`, …) to sample any noise family at arbitrary coordinates.

---

## 14. Browser / wasm web app

Grain ships as a self-contained web application that runs entirely in the
browser via `wasm-bindgen` + WebGPU. It's hosted at
<https://sebastianpfluegelmeier.github.io/grain-pub/> and installable as a
PWA on iOS / Android / desktop.

### What it does

- **Editor panel** — Codemirror-based editor for `.grain` source with LSP
  diagnostics (compile errors highlighted inline).
- **Surface panel** — auto-generated controls for every surface element
  in the program (knobs / toggles / buttons / selectors / sequencers /
  pressure / audio_env). Same protocol as the native `--ui` server.
- **Inputs panel** — file pickers for `in(0)` and `in(1)` (still images
  only on the web app; videos play via native `--input` only).
- **Render panel** — output dimensions, fps, recording start/stop. The
  recorder captures the live preview to a WebM blob.
- **Guide panel** — renders this `USERGUIDE.md` from the deployed assets.
- **Status panel** — wasm load state, render frame count, compile errors,
  startup log, generated WGSL blocks.

### Mobile layout

Below 900 px viewport width, the panels become **bottom sheets**:
single-select (one panel at a time covers ~62 % of the viewport), with the
canvas always visible above. Each sheet supports finger drag-to-dismiss:
swipe down past 30 % of the sheet height (or a > 250 px flick) closes it,
otherwise it springs back to position. Drag only initiates from the top
~50 px of the sheet (header / pill area), so taps inside scrollable content
still scroll. Animations use the native iOS sheet curve
(`cubic-bezier(0.32, 0.72, 0, 1)`, 220 ms) for the snap-close / spring-back
phases, while the live finger-tracking phase has no transition.

### State persistence

Every panel toggle, source edit, and surface element value is persisted to
`localStorage` under `grain.*` keys. Reloading the tab restores the editor
contents, panel layout, and surface state — anything the live server
exposes via `state_json()`.

### Browser-only caveats

- WebGPU is required (Chrome 113+, Edge 113+, Safari 17+, Firefox Nightly).
  The status panel reports `BrowserWebGpu (Vendor, Backend)` on success
  and shows the wasm error otherwise.
- Audio input (`audio_env`) requires `getUserMedia` permission; granted on
  the first surface element that needs it.
- Tilesets are user uploads in production (stored in IndexedDB). The dev
  server can also serve the repo's `tilesets/` directory with generated
  manifests for local testing.
- WebM recording works in Chrome / Edge; Safari and Firefox have partial
  codec support and the recorder may produce a fixed-rate MP4 fallback.
- Push controllers and native MIDI are not exposed to the browser app; use
  the native `grain --live` runtime for MIDI input/output and Push control.

### Selector swaps in the browser

When you tap a selector branch in the web app, the wasm session schedules
a **deferred recompile** for the next render tick. The synchronous compile
would otherwise block the JavaScript thread and freeze the UI for several
seconds on cold-cache shaders; the deferred path keeps the UI responsive
and lets the spinner update while the worker compiles.

### Running locally

```bash
cd grain-web-app
npm install
npm run dev          # vite dev server with hot reload + LSP

# Full static build from the repo root (wasm-pack + optional tree-sitter + Vite):
../scripts/build-web.sh

# Or build + deploy to ../grain-pub:
../scripts/deploy-gh-pages.sh
```

The deploy script also writes the `.nojekyll` marker into `grain-pub/` so
GitHub Pages doesn't strip files starting with `_`.
