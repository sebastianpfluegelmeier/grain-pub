// Pixel operations for the animation editor (docs/animation-graph-plan.md
// 6.6), on the typed arrays of the in-memory document. Nothing here touches
// the DOM, so every tool can be tested on plain buffers.
//
// A surface is `{format, width, height, data}`, where `data` is one frame:
// 1 byte per pixel for Field, grey and alpha for Matte, RGBA for Image, all
// with straight (not premultiplied) alpha. Colours are `[r, g, b, a]` arrays
// of bytes in every format; Field and Matte read the grey from `r`.

export const CHANNELS = {field: 1, matte: 2, image: 4};
export const MIN_BRUSH = 1;
export const MAX_BRUSH = 64;
export const SHAPES = ['square', 'round'];

const clampByte = value => value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function surface(format, width, height, data) {
  return {format, width, height, data};
}

// Colours ---------------------------------------------------------------------

// The colour as the format stores it: Field keeps only the grey and is always
// opaque, Matte keeps grey and alpha.
export function normalizeColour(format, colour) {
  const [r, g, b, a] = colour.map(clampByte);
  if (format === 'field') return [r, r, r, 255];
  if (format === 'matte') return [r, r, r, a];
  return [r, g, b, a];
}

export function pixelAt(s, index) {
  const d = s.data;
  if (s.format === 'field') return [d[index], d[index], d[index], 255];
  if (s.format === 'matte') return [d[2 * index], d[2 * index], d[2 * index], d[2 * index + 1]];
  const o = 4 * index;
  return [d[o], d[o + 1], d[o + 2], d[o + 3]];
}

export function setPixel(s, index, colour) {
  const d = s.data;
  if (s.format === 'field') d[index] = colour[0];
  else if (s.format === 'matte') { d[2 * index] = colour[0];d[2 * index + 1] = colour[3]; }
  else d.set(colour, 4 * index);
}

const hex2 = value => clampByte(value).toString(16).padStart(2, '0');
export function toHex(colour) {
  return '#' + colour.map(hex2).join('');
}

// Accepts #rgb, #rgba, #rrggbb and #rrggbbaa, with or without the #. Returns
// null for anything else.
export function parseHex(text) {
  let value = String(text).trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(value) || ![3, 4, 6, 8].includes(value.length)) return null;
  if (value.length <= 4) value = [...value].map(char => char + char).join('');
  if (value.length === 6) value += 'ff';
  return [0, 2, 4, 6].map(start => parseInt(value.slice(start, start + 2), 16));
}

// h in 0..360, s and v in 0..1.
export function hsvToRgb(h, s, v) {
  const f = n => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map(value => clampByte(value * 255));
}

export function rgbToHsv(r, g, b) {
  r /= 255;g /= 255;b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return {h: (h + 360) % 360, s: max ? delta / max : 0, v: max};
}

// The runtime decodes Field values and Matte grey as sRGB (plan section 10),
// so a drawn 128 reads as about 0.216. These convert between the stored byte
// and the number a program sees.
export function decodeValue(byte) {
  const x = clamp(byte, 0, 255) / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

// The byte whose decoded value is nearest to `value`.
export function encodeValue(value) {
  const x = clamp(Number(value) || 0, 0, 1);
  const guess = clampByte(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055));
  let best = guess;
  for (const candidate of [guess - 1, guess + 1]) {
    if (candidate >= 0 && candidate <= 255 && Math.abs(decodeValue(candidate) - x) < Math.abs(decodeValue(best) - x)) best = candidate;
  }
  return best;
}

// Blending --------------------------------------------------------------------

// Writes into `out` at `oo` the result of painting `colour` with `strength`
// (0..1, brush opacity times pen pressure) over the pixel in `base` at `bo`,
// using source-over on straight 8-bit alpha. With `erase` the alpha is
// lowered by `strength` instead and the colour channels are kept; a Field,
// which has no alpha, moves towards 0. The one implementation behind strokes,
// fills and `blend`.
function compose(format, base, bo, out, oo, colour, strength, erase) {
  if (format === 'field') {
    const d = base[bo];
    out[oo] = erase ? clampByte(d * (1 - strength)) : clampByte(d + (colour[0] - d) * strength * colour[3] / 255);
    return;
  }
  const n = CHANNELS[format], alpha = n - 1;
  if (erase) {
    for (let channel = 0; channel < alpha; channel++) out[oo + channel] = base[bo + channel];
    out[oo + alpha] = clampByte(base[bo + alpha] * (1 - strength));
    return;
  }
  const sa = colour[3] / 255 * strength, da = base[bo + alpha] / 255;
  if (sa <= 0) {
    for (let channel = 0; channel < n; channel++) out[oo + channel] = base[bo + channel];
    return;
  }
  const oa = sa + da * (1 - sa), keep = da * (1 - sa);
  for (let channel = 0; channel < alpha; channel++) out[oo + channel] = clampByte((colour[channel] * sa + base[bo + channel] * keep) / oa);
  out[oo + alpha] = clampByte(oa * 255);
}

// One pixel, for tests and previews: the colour that painting `colour` over
// `pixel` gives, both as [r, g, b, a].
export function blend(format, pixel, colour, strength = 1, erase = false) {
  const n = CHANNELS[format];
  const pack = value => format === 'field' ? [value[0]] : format === 'matte' ? [value[0], value[3]] : value.slice(0, 4);
  const out = new Uint8Array(n);
  compose(format, Uint8Array.from(pack(pixel)), 0, out, 0, normalizeColour(format, colour), strength, erase);
  return pixelAt({format, data: out}, 0);
}

// Brushes ---------------------------------------------------------------------

const brushes = new Map();
// The cells a brush of `size` covers around its hot spot and, for each cell,
// its distance from the centre as 0 (centre) to 1 (edge), the value the radial
// value modes read. Even sizes extend one pixel further up and left, as in the
// asset editor's forBrushCells. A round brush keeps the cells whose centres
// lie within half the size of the brush centre.
function brushOf(size, shape) {
  size = clamp(Math.round(size) || 1, MIN_BRUSH, MAX_BRUSH);
  const key = size + shape;
  if (brushes.has(key)) return brushes.get(key);
  const start = -Math.floor(size / 2), centre = (size - 1) / 2, radius = Math.max(0.5, size / 2);
  const squareRadius = Math.max(0.5, Math.floor(size / 2));
  const cells = [], distances = [];
  for (let by = 0; by < size; by++) {
    for (let bx = 0; bx < size; bx++) {
      const dx = bx - centre, dy = by - centre;
      if (shape === 'round' && dx * dx + dy * dy > radius * radius) continue;
      cells.push(start + bx, start + by);
      distances.push(shape === 'round' ? Math.min(1, Math.sqrt(dx * dx + dy * dy) / radius) : Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) / squareRadius));
    }
  }
  const result = {cells: Int16Array.from(cells), distances: Float32Array.from(distances)};
  brushes.set(key, result);
  return result;
}
// The pixel offsets a brush covers, as [dx0, dy0, dx1, dy1, ...].
export function footprint(size, shape = 'square') {
  return brushOf(size, shape).cells;
}

// Random numbers and patterns ---------------------------------------------------
//
// Brushes that scatter or pick values at random draw from a generator the
// stroke owns, seeded when the stroke starts, so a stroke can be replayed
// exactly and tests can fix its outcome.

// xorshift32 as a function returning numbers in [0, 1). A seed of 0 is
// replaced, because the generator never leaves 0.
export function createRandom(seed = 1) {
  let state = (seed >>> 0) || 0x9E3779B9;
  return () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state / 4294967296;
  };
}

// An integer from min to max, both included.
export const randomInt = (random, min, max) => min + Math.floor(random() * (max - min + 1));

// The asset editor's 4 × 4 ordered-dither matrix: a pixel is drawn when its
// entry is below the density level (0..16).
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
export const ditherPasses = (x, y, level) => BAYER4[y & 3][x & 3] < level;

// A stable hash of a pixel index in [0, 1), so a tween dissolve flips each
// pixel exactly once across the frames it fills.
export function hash01(index) {
  const s = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// Value modes ------------------------------------------------------------------
//
// A value mode decides the position t (0..1) of each painted pixel between the
// first and the second colour: fixed (always the first), random, along the
// stroke (from where it started towards where the pointer is now), and radial
// (from the brush centre outwards, or from the edge inwards).

export const VALUE_MODES = ['fixed', 'random', 'along', 'radial-out', 'radial-in'];

// How far (x, y) lies from `from` towards `to`, as 0..1.
export function gradientFraction(x, y, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, lengthSq = dx * dx + dy * dy;
  return lengthSq <= 0 ? 0 : clamp(((x - from.x) * dx + (y - from.y) * dy) / lengthSq, 0, 1);
}

// The asset editor's gradientLevelAt: the rounded level between `min` and
// `max` at (x, y). Without end points the gradient runs along the top edge.
export function gradientLevelAt(x, y, width, height, from = null, to = null, min = 0, max = 255) {
  const start = from || {x: 0, y: 0}, end = to || {x: Math.max(1, width - 1), y: 0};
  return Math.round(min + (max - min) * gradientFraction(x, y, start, end));
}

// The asset editor's rangedValue, as a number between `min` and `max` that is
// not rounded. `options`: `gradient` {from, to} for 'along', `distance` (0 at
// the brush centre, 1 at its edge) for the radial modes and `random` for
// 'random'.
export function rangedValue(mode, min, max, x, y, width, height, options = {}) {
  if (mode === 'random') return min + (max - min) * (options.random ?? Math.random)();
  if (mode === 'along' && options.gradient) return min + (max - min) * gradientFraction(x, y, options.gradient.from, options.gradient.to);
  if (mode === 'radial-out') return min + (max - min) * (options.distance ?? 0);
  if (mode === 'radial-in') return min + (max - min) * (1 - (options.distance ?? 0));
  return min;
}

const mixByte = (a, b, t) => a + (b - a) * t;
// Between two [r, g, b, a] colours: colour channels by `t`, alpha by `ta`.
export function mixColours(a, b, t, ta = t) {
  return [mixByte(a[0], b[0], t), mixByte(a[1], b[1], t), mixByte(a[2], b[2], t), mixByte(a[3], b[3], ta)];
}

// Strokes ---------------------------------------------------------------------
//
// A stroke paints into the surface as the pointer moves. It keeps a copy of
// the frame from before the stroke and the highest strength each pixel has
// received, and recomputes a pixel from that copy only when the strength
// grows. So within one stroke each pixel is blended once against its value
// from before the stroke, and overlapping stamps of a low-opacity brush do not
// darken where they overlap.
//
// Options: colour and colour2 (the second colour of the value modes, noise and
// the gradient), modes {colour, alpha} (value modes, see above), erase, size,
// shape, opacity (0..1), weight (0..1, scales every strength: the share of the
// stroke that reaches a neighbouring frame), density (percent, for the dither
// pen) and seed (for the random brushes). `base` may pass a copy taken
// earlier, which the stroke then owns.
export function createStroke(s, {colour = [0, 0, 0, 255], colour2 = [0, 0, 0, 255], modes = {}, erase = false, size = 1, shape = 'square',
  opacity = 1, weight = 1, density = 50, seed = 1} = {}, base = null) {
  const stroke = {
    s, format: s.format, width: s.width, height: s.height,
    base: base ?? s.data.slice(),
    coverage: new Float32Array(s.width * s.height),
    colour: normalizeColour(s.format, colour), colour2: normalizeColour(s.format, colour2),
    modes: {colour: modes.colour ?? 'fixed', alpha: modes.alpha ?? 'fixed'},
    erase, size, shape, opacity: clamp(opacity, 0, 1), weight: clamp(weight, 0, 1),
    level: clamp(Math.round(density / 100 * 16), 0, 16),
    seed, random: createRandom(seed),
    // The line a stroke's 'along' mode runs over: {from, to}.
    gradient: null,
    // The previous stamp and the direction of travel, for the displace brush.
    lastStamp: null, motion: null,
    // The pixels changed so far, as {x0, y0, x1, y1} inclusive, or null.
    bounds: null,
  };
  return stroke;
}

// Puts the surface back to its state before the stroke and forgets the
// coverage and the random sequence, so a shape tool can redraw its preview on
// every pointer move and a stroke can be replayed.
export function resetStroke(stroke) {
  stroke.s.data.set(stroke.base);
  stroke.coverage.fill(0);
  stroke.bounds = null;
  stroke.random = createRandom(stroke.seed);
  stroke.lastStamp = null;stroke.motion = null;
}

// The pixel offset when the stroke may paint (x, y) with `strength`, else -1.
// Keeps the highest strength per pixel and the changed bounds.
function claim(stroke, x, y, strength) {
  const index = y * stroke.width + x;
  if (strength <= stroke.coverage[index]) return -1;
  stroke.coverage[index] = strength;
  const b = stroke.bounds;
  if (!b) stroke.bounds = {x0: x, y0: y, x1: x, y1: y};
  else { if (x < b.x0) b.x0 = x;if (x > b.x1) b.x1 = x;if (y < b.y0) b.y0 = y;if (y > b.y1) b.y1 = y; }
  return index;
}

// Paints one pixel of a stroke with `strength`, keeping the highest strength
// per pixel. Exported for brushes that choose their own pixels; `colour`
// overrides the stroke's colour for this pixel.
export function coverPixel(stroke, x, y, strength, colour = stroke.colour) {
  strength *= stroke.weight;
  const index = claim(stroke, x, y, strength);
  if (index < 0) return;
  const n = CHANNELS[stroke.format];
  compose(stroke.format, stroke.base, index * n, stroke.s.data, index * n, colour, strength, stroke.erase);
}

// For brushes that compute a whole new pixel from the stroke's base. `make`
// gets the pixel index and the weighted strength and returns [r, g, b, a].
function coverWith(stroke, x, y, strength, make) {
  strength *= stroke.weight;
  const index = claim(stroke, x, y, strength);
  if (index < 0) return;
  setPixel(stroke.s, index, normalizeColour(stroke.format, make(index, strength)));
}

const inBounds = (stroke, x, y) => x >= 0 && y >= 0 && x < stroke.width && y < stroke.height;

// The colour of one pixel under the stroke's value modes. `distance` is the
// pixel's distance from the brush centre (0..1).
export function modeColour(stroke, x, y, distance = 0) {
  const {modes} = stroke;
  if (modes.colour === 'fixed' && modes.alpha === 'fixed') return stroke.colour;
  const options = {gradient: stroke.gradient, distance, random: stroke.random};
  const t = rangedValue(modes.colour, 0, 1, x, y, stroke.width, stroke.height, options);
  const ta = rangedValue(modes.alpha, 0, 1, x, y, stroke.width, stroke.height, options);
  return normalizeColour(stroke.format, mixColours(stroke.colour, stroke.colour2, t, ta));
}

// A random colour between the stroke's two colours; colour and alpha draw
// separately.
export function noiseColour(stroke) {
  const t = stroke.random(), ta = stroke.random();
  return normalizeColour(stroke.format, mixColours(stroke.colour, stroke.colour2, t, ta));
}

// One brush stamp centred on (x, y). `size` and `strength` default to the
// stroke's own and let pen pressure vary them per stamp. `dither` leaves out
// the pixels the ordered-dither matrix does not pass at the stroke's density.
// `noise` gives each pixel a random colour between the two.
function stampCells(stroke, x, y, size, strength, {dither = false, noise = false} = {}) {
  if (strength <= 0) return;
  const {cells, distances} = brushOf(size, stroke.shape), {width, height} = stroke;
  const varying = stroke.modes.colour !== 'fixed' || stroke.modes.alpha !== 'fixed';
  for (let index = 0; index < cells.length; index += 2) {
    const px = x + cells[index], py = y + cells[index + 1];
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    if (dither && !ditherPasses(px, py, stroke.level)) continue;
    const colour = noise ? noiseColour(stroke) : varying ? modeColour(stroke, px, py, distances[index / 2]) : stroke.colour;
    coverPixel(stroke, px, py, strength, colour);
  }
}

export function stamp(stroke, x, y, size = stroke.size, strength = stroke.opacity) {
  stampCells(stroke, x, y, size, strength);
}
export function stampDither(stroke, x, y, size = stroke.size, strength = stroke.opacity) {
  stampCells(stroke, x, y, size, strength, {dither: true});
}
export function stampNoise(stroke, x, y, size = stroke.size, strength = stroke.opacity) {
  stampCells(stroke, x, y, size, strength, {noise: true});
}

// The asset editor's sprayStamp: a scatter of single pixels in a square of
// twice the brush size around (x, y), about 58 % of up to 192 tries. The
// random numbers are drawn in a fixed order, so a seeded stroke is exact.
export function stampSpray(stroke, x, y, size = stroke.size, strength = stroke.opacity) {
  if (strength <= 0) return;
  const radius = Math.max(2, size * 2), count = Math.min(192, Math.max(8, size * size * 2)), random = stroke.random;
  const varying = stroke.modes.colour !== 'fixed' || stroke.modes.alpha !== 'fixed';
  for (let i = 0; i < count; i++) {
    const skip = random() > 0.58;
    if (skip) continue;
    const dx = randomInt(random, -radius, radius), dy = randomInt(random, -radius, radius);
    const px = x + dx, py = y + dy;
    if (!inBounds(stroke, px, py)) continue;
    coverPixel(stroke, px, py, strength, varying ? modeColour(stroke, px, py, Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) / radius)) : stroke.colour);
  }
}

// Mixes two pixels ([r, g, b, a]) by `t`. Matte and Image mix premultiplied,
// so a transparent pixel's colour does not tint the result.
export function mixPixels(format, a, b, t) {
  if (format === 'field') return [mixByte(a[0], b[0], t), 0, 0, 255].map(clampByte);
  const aa = a[3] / 255, ba = b[3] / 255, alpha = aa + (ba - aa) * t;
  if (alpha <= 0) return [a[0], a[1], a[2], 0];
  const channel = index => (a[index] * aa * (1 - t) + b[index] * ba * t) / alpha;
  return [channel(0), channel(1), channel(2), alpha * 255].map(clampByte);
}

// The asset editor's blurredPixel: the average of the 3 × 3 pixels around
// (x, y) read from `data` (a frame of `format` and size), per channel and
// weighted by alpha so transparent neighbours do not darken the colour. The
// alpha is the plain average. Returns [r, g, b, a], or the pixel itself when
// every neighbour is transparent.
export function blurredPixel(format, data, width, height, x, y) {
  const s = {format, width, height, data};
  let sum = [0, 0, 0], alpha = 0, count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx, py = y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const pixel = pixelAt(s, py * width + px);
      count++;
      alpha += pixel[3];
      for (let channel = 0; channel < 3; channel++) sum[channel] += pixel[channel] * pixel[3];
    }
  }
  if (format === 'field') return [clampByte(sum[0] / (alpha || 1)), 0, 0, 255];
  if (alpha <= 0) return pixelAt(s, y * width + x);
  return [...sum.map(value => clampByte(value / alpha)), clampByte(alpha / count)];
}

// Blur and smudge: each pixel under the brush moves towards the average of
// its neighbourhood in the frame as it was before the stroke.
export function stampBlur(stroke, x, y, size = stroke.size, strength = stroke.opacity) {
  if (strength <= 0) return;
  const cells = footprint(size, stroke.shape), {width, height, format} = stroke;
  for (let index = 0; index < cells.length; index += 2) {
    const px = x + cells[index], py = y + cells[index + 1];
    if (!inBounds(stroke, px, py)) continue;
    coverWith(stroke, px, py, strength, (offset, weighted) => {
      const here = pixelAt({format, data: stroke.base}, offset);
      return mixPixels(format, here, blurredPixel(format, stroke.base, width, height, px, py), weighted);
    });
  }
}

// The asset editor's displaceStamp: pixels under the brush take the value of
// the pixel behind them along the direction the pointer is moving, by up to
// size / 16 pixels, fading towards the brush edge. The first stamp of a
// stroke only learns the direction.
export function stampDisplace(stroke, x, y, size = stroke.size, strength = stroke.opacity) {
  const previous = stroke.lastStamp;
  if (!previous || previous.x !== x || previous.y !== y) {
    if (previous) {
      const dx = x - previous.x, dy = y - previous.y, length = Math.hypot(dx, dy);
      stroke.motion = {dx: dx / length, dy: dy / length};
    }
    stroke.lastStamp = {x, y};
  }
  const motion = stroke.motion;
  if (!motion || strength <= 0) return;
  const {cells, distances} = brushOf(size, stroke.shape), {width, format} = stroke;
  const maxShift = Math.max(1, Math.round(clamp(Math.round(size) || 1, MIN_BRUSH, MAX_BRUSH) / 16)), amount = strength * stroke.weight;
  for (let index = 0; index < cells.length; index += 2) {
    const px = x + cells[index], py = y + cells[index + 1];
    if (!inBounds(stroke, px, py)) continue;
    const falloff = Math.max(0, 1 - distances[index / 2]);
    const shiftX = Math.round(motion.dx * maxShift * falloff * amount), shiftY = Math.round(motion.dy * maxShift * falloff * amount);
    if (!shiftX && !shiftY) continue;
    const sx = px - shiftX, sy = py - shiftY;
    if (!inBounds(stroke, sx, sy)) continue;
    // Claimed by the size of the shift, so a stamp nearer the centre wins.
    coverWith(stroke, px, py, falloff * strength, () => pixelAt({format, data: stroke.base}, sy * width + sx));
  }
}

// The cells of a Bresenham line from (x0, y0) to (x1, y1), both included.
export function linePoints(x0, y0, x1, y1) {
  const points = [];
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return points;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy;x0 += sx; }
    if (e2 <= dx) { err += dx;y0 += sy; }
  }
}

// Stamps along a line. `from` and `to` are {x, y, size, strength}; size and
// strength are interpolated along the line, so pen pressure changes smoothly
// between two pointer events. `stampFn` lets other brush tools reuse the walk.
export function strokeLine(stroke, from, to, stampFn = stamp) {
  const points = linePoints(from.x, from.y, to.x, to.y), last = Math.max(1, points.length - 1);
  const size0 = from.size ?? stroke.size, size1 = to.size ?? size0;
  const strength0 = from.strength ?? stroke.opacity, strength1 = to.strength ?? strength0;
  points.forEach(([x, y], index) => {
    const t = index / last;
    stampFn(stroke, x, y, Math.max(1, Math.round(size0 + (size1 - size0) * t)), strength0 + (strength1 - strength0) * t);
  });
}

// A filled rectangle between two corners, both included. Like the asset
// editor's drawSquare it ignores the brush size.
export function strokeRect(stroke, from, to) {
  const x0 = clamp(Math.min(from.x, to.x), 0, stroke.width - 1), x1 = clamp(Math.max(from.x, to.x), 0, stroke.width - 1);
  const y0 = clamp(Math.min(from.y, to.y), 0, stroke.height - 1), y1 = clamp(Math.max(from.y, to.y), 0, stroke.height - 1);
  if (Math.max(from.x, to.x) < 0 || Math.min(from.x, to.x) >= stroke.width || Math.max(from.y, to.y) < 0 || Math.min(from.y, to.y) >= stroke.height) return;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) coverPixel(stroke, x, y, stroke.opacity);
}

// The asset editor's drawGradient: every pixel of the frame is painted with
// the colour at its place on the line from `from` to `to`, running from the
// stroke's first colour (colour and alpha) to its second.
export function drawGradient(stroke, from, to) {
  for (let y = 0; y < stroke.height; y++) {
    for (let x = 0; x < stroke.width; x++) {
      const colour = normalizeColour(stroke.format, mixColours(stroke.colour, stroke.colour2, gradientFraction(x, y, from, to)));
      coverPixel(stroke, x, y, stroke.opacity, colour);
    }
  }
}

// Fill and pick ---------------------------------------------------------------

export function inside(s, x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < s.width && y < s.height;
}

// Flood fill from (x, y) over the 4-connected pixels whose stored bytes equal
// the start pixel exactly. Every matched pixel gets the same result, painted
// or erased with `opacity` like a stroke. Returns the number of pixels
// changed.
export function floodFill(s, x, y, {colour = [0, 0, 0, 255], erase = false, opacity = 1} = {}) {
  if (!inside(s, x, y)) return 0;
  const n = CHANNELS[s.format], data = s.data, width = s.width, height = s.height;
  const start = y * width + x;
  const target = data.slice(start * n, start * n + n);
  const fill = new Uint8Array(n);
  compose(s.format, target, 0, fill, 0, normalizeColour(s.format, colour), clamp(opacity, 0, 1), erase);
  if (fill.every((value, channel) => value === target[channel])) return 0;
  const matches = index => {
    for (let channel = 0; channel < n; channel++) if (data[index * n + channel] !== target[channel]) return false;
    return true;
  };
  const stack = [start];
  let changed = 0;
  while (stack.length) {
    const index = stack.pop();
    if (!matches(index)) continue;
    data.set(fill, index * n);
    changed++;
    const cx = index % width, cy = (index - cx) / width;
    if (cx > 0) stack.push(index - 1);
    if (cx < width - 1) stack.push(index + 1);
    if (cy > 0) stack.push(index - width);
    if (cy < height - 1) stack.push(index + width);
  }
  return changed;
}

// The colour of one pixel, or null outside the surface.
export function pick(s, x, y) {
  return inside(s, x, y) ? pixelAt(s, y * s.width + x) : null;
}

// Selections ------------------------------------------------------------------
//
// A selection is a rectangle {x, y, w, h} inside the surface. A clip is a
// surface of its own, so it can be pasted into any frame of any edge, and
// into an animation of another format.

// The rectangle spanned by two cells, both included, clipped to the surface.
// Null when it lies entirely outside.
export function rectFrom(s, a, b) {
  const x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(s.width - 1, Math.max(a.x, b.x)), y1 = Math.min(s.height - 1, Math.max(a.y, b.y));
  if (x1 < x0 || y1 < y0) return null;
  return {x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1};
}

export function clipRect(s, rect) {
  return rect && rectFrom(s, {x: rect.x, y: rect.y}, {x: rect.x + rect.w - 1, y: rect.y + rect.h - 1});
}

export function copyRect(s, rect) {
  const r = clipRect(s, rect);
  if (!r) return null;
  const n = CHANNELS[s.format];
  const data = new Uint8Array(r.w * r.h * n);
  for (let row = 0; row < r.h; row++) {
    const from = ((r.y + row) * s.width + r.x) * n;
    data.set(s.data.subarray(from, from + r.w * n), row * r.w * n);
  }
  return surface(s.format, r.w, r.h, data);
}

// Clears to transparent, or to 0 in a Field.
export function clearRect(s, rect) {
  const r = clipRect(s, rect);
  if (!r) return;
  const n = CHANNELS[s.format];
  for (let row = 0; row < r.h; row++) {
    const from = ((r.y + row) * s.width + r.x) * n;
    s.data.fill(0, from, from + r.w * n);
  }
}

// A clip pixel as a colour of the target format. Colour turns into grey by
// its Rec. 709 luma on the bytes; that only happens when pasting between
// animations of different formats.
function clipColour(clip, index, format) {
  const colour = pixelAt(clip, index);
  if (clip.format === 'image' && format !== 'image') {
    const grey = clampByte(0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]);
    return [grey, grey, grey, colour[3]];
  }
  return colour;
}

// Pastes `clip` with its top-left corner at (x, y). In Matte and Image the
// clip is laid over the frame with source-over, so its transparent pixels
// leave the frame as it is, as in the asset editor. A Field has no
// transparency, so the clip replaces the pixels under it. Returns the pasted
// rectangle clipped to the surface, or null.
export function paste(s, clip, x, y) {
  const n = CHANNELS[s.format], one = new Uint8Array(n);
  for (let row = 0; row < clip.height; row++) {
    const ty = y + row;
    if (ty < 0 || ty >= s.height) continue;
    for (let column = 0; column < clip.width; column++) {
      const tx = x + column;
      if (tx < 0 || tx >= s.width) continue;
      const colour = normalizeColour(s.format, clipColour(clip, row * clip.width + column, s.format));
      const index = (ty * s.width + tx) * n;
      if (s.format === 'field') { s.data[index] = colour[0];continue; }
      compose(s.format, s.data, index, one, 0, colour, 1, false);
      s.data.set(one, index);
    }
  }
  return clipRect(s, {x, y, w: clip.width, h: clip.height});
}

// Moves the selected pixels by (dx, dy): the old area is cleared and the
// pixels are pasted at the new place. Returns the new selection, clipped to
// the surface (null when it left the surface entirely).
export function moveRect(s, rect, dx, dy) {
  const clip = copyRect(s, rect);
  if (!clip) return null;
  clearRect(s, rect);
  const r = clipRect(s, rect);
  return paste(s, clip, r.x + dx, r.y + dy);
}

// Whole-frame transforms ------------------------------------------------------

// Moves the whole frame by (dx, dy). Pixels that leave are dropped and the
// uncovered area is cleared; animation frames do not wrap around. `source`
// lets a drag preview shift a copy taken at pointer down.
export function shift(s, dx, dy, source = s.data.slice()) {
  const n = CHANNELS[s.format], {width, height} = s;
  s.data.fill(0);
  for (let y = 0; y < height; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= height) continue;
    const x0 = Math.max(0, dx), x1 = Math.min(width, width + dx);
    if (x1 <= x0) continue;
    s.data.set(source.subarray((sy * width + x0 - dx) * n, (sy * width + x1 - dx) * n), (y * width + x0) * n);
  }
}

function remap(s, sourceIndex) {
  const n = CHANNELS[s.format], source = s.data.slice(), {width, height} = s;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = sourceIndex(x, y) * n, to = (y * width + x) * n;
      for (let channel = 0; channel < n; channel++) s.data[to + channel] = source[from + channel];
    }
  }
}

// axis 'x' mirrors left and right, 'y' top and bottom.
export function flip(s, axis) {
  const {width, height} = s;
  remap(s, axis === 'y' ? (x, y) => (height - 1 - y) * width + x : (x, y) => y * width + (width - 1 - x));
}

export const canRotate = s => s.width === s.height;

// A quarter turn clockwise. Only square frames can turn in place.
export function rotate(s) {
  if (!canRotate(s)) throw new Error('Rotate needs a square canvas');
  const size = s.width;
  remap(s, (x, y) => (size - 1 - x) * size + y);
}

// Tween -------------------------------------------------------------------------

// True when the frame has nothing drawn: every alpha is 0 (every value, in a
// Field).
export function isBlank(format, data) {
  const n = CHANNELS[format];
  if (format === 'field') return data.every(value => value === 0);
  for (let index = n - 1; index < data.length; index += n) if (data[index] !== 0) return false;
  return true;
}

export const TWEEN_MODES = ['dissolve', 'blend'];

// The frame a fraction `t` (0..1, exclusive) of the way from frame `a` to
// frame `b`. 'dissolve' takes each whole pixel from `b` once `t` passes its
// hash, so a pixel flips from a to b exactly once across the frames in
// between. 'blend' mixes every channel, premultiplied in Matte and Image, so
// a pixel that is empty in one frame fades in or out with the other's colour.
export function tweenFrame(format, a, b, t, mode = 'dissolve', out = a.slice()) {
  const n = CHANNELS[format], count = a.length / n;
  if (mode === 'blend') {
    const sa = {format, data: a}, sb = {format, data: b};
    for (let index = 0; index < count; index++) setPixel({format, data: out}, index, mixPixels(format, pixelAt(sa, index), pixelAt(sb, index), t));
    return out;
  }
  for (let index = 0; index < count; index++) {
    const from = hash01(index) < t ? b : a;
    for (let channel = 0; channel < n; channel++) out[index * n + channel] = from[index * n + channel];
  }
  return out;
}

// Which frames a paint operation reaches (6.6). `count` is the number of
// frames of the edge and `active` the selected one. 'frame' is just the active
// frame, 'nearby' the frames within `radius` of it (without wrapping, as the
// edge's ends are not joined), 'edge' every frame. With `fade`, a nearby
// frame's weight falls off with its distance, as the asset editor's soft Z
// brush does. Returns [{index, weight}], the active frame first.
export function paintTargets(count, active, {scope = 'frame', radius = 1, fade = true} = {}) {
  active = clamp(active, 0, count - 1);
  if (scope === 'edge') {
    return [{index: active, weight: 1}, ...Array.from({length: count}, (_, index) => ({index, weight: 1})).filter(target => target.index !== active)];
  }
  if (scope !== 'nearby') return [{index: active, weight: 1}];
  radius = clamp(Math.round(radius) || 0, 0, count);
  const targets = [];
  for (let distance = 0; distance <= radius; distance++) {
    for (const index of distance ? [active - distance, active + distance] : [active]) {
      if (index >= 0 && index < count) targets.push({index, weight: fade && radius > 0 ? 1 - distance / (radius + 1) : 1});
    }
  }
  return targets;
}

// Display ---------------------------------------------------------------------

// The frame as RGBA bytes for an ImageData. Field values show as opaque grey.
export function toRGBA(s, out = new Uint8ClampedArray(s.width * s.height * 4)) {
  const d = s.data, count = s.width * s.height;
  if (s.format === 'image') { out.set(d);return out; }
  for (let index = 0, o = 0; index < count; index++, o += 4) {
    if (s.format === 'field') { out[o] = out[o + 1] = out[o + 2] = d[index];out[o + 3] = 255; }
    else { out[o] = out[o + 1] = out[o + 2] = d[2 * index];out[o + 3] = d[2 * index + 1]; }
  }
  return out;
}

// Lays a tinted ghost of the frame over `out` (RGBA, source-over), for onion
// skins. Each pixel takes the tint with the pixel's alpha times `strength`. A
// Field has no alpha, so its value is used: 0 leaves no ghost.
export function addGhost(out, s, tint, strength) {
  const d = s.data, count = s.width * s.height, n = CHANNELS[s.format];
  for (let index = 0, o = 0; index < count; index++, o += 4) {
    const coverage = (s.format === 'field' ? d[index] : d[index * n + n - 1]) / 255 * strength;
    if (coverage <= 0) continue;
    const da = out[o + 3] / 255, oa = coverage + da * (1 - coverage), keep = da * (1 - coverage);
    for (let channel = 0; channel < 3; channel++) out[o + channel] = (tint[channel] * coverage + out[o + channel] * keep) / oa;
    out[o + 3] = oa * 255;
  }
  return out;
}
