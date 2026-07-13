// Noise Lab — editor-only playground for semi-procedural noise experiments.
//
// Each experiment turns hand-drawn assets from the gallery into procedural
// texture: authored marks, rule-driven placement/time. Everything here is
// preview-only. Assets are read but never written; Lab settings persist under
// their own localStorage key so the asset store format is untouched.
//
// Loaded before app.js as a classic script: every top-level binding is
// prefixed nl/noiseLab to keep the shared global lexical scope clean. App
// globals (state, ICONS, iconTextButton, ...) resolve at call time.

const NOISELAB_STORE_KEY = "grain.noiselab.v1";
const NL_CHECKER_A = "#d7d5cb";
const NL_CHECKER_B = "#c8c6bb";

let nlStore = null;
let nlRt = null; // runtime: {canvas, ctx, exp, scratch, t, raf, ...}

// ---------- persistence ----------

function nlLoadStore() {
  if (nlStore) return nlStore;
  let parsed = null;
  try {
    parsed = JSON.parse(localStorage.getItem(NOISELAB_STORE_KEY) || "null");
  } catch (error) {
    parsed = null;
  }
  nlStore = parsed && typeof parsed === "object" ? parsed : {};
  if (typeof nlStore.tab !== "string") nlStore.tab = "scatter";
  if (!nlStore.settings || typeof nlStore.settings !== "object") nlStore.settings = {};
  if (!nlStore.assets || typeof nlStore.assets !== "object") nlStore.assets = {};
  if (typeof nlStore.playing !== "boolean") nlStore.playing = true;
  return nlStore;
}

function nlSaveStore() {
  try {
    localStorage.setItem(NOISELAB_STORE_KEY, JSON.stringify(nlStore));
  } catch (error) {
    // Storage full or blocked: the Lab still works, settings just don't stick.
  }
}

function nlSettings(exp) {
  const store = nlLoadStore();
  const current = store.settings[exp.id];
  const merged = { ...exp.defaults, ...(current && typeof current === "object" ? current : {}) };
  store.settings[exp.id] = merged;
  return merged;
}

// ---------- hashing, noise ----------

function nlHash(a, b, c, d) {
  let h = (a | 0) * 0x9e3779b1;
  h = Math.imul(h ^ ((b | 0) + 0x7f4a7c15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ ((c | 0) * 0xc2b2ae35 | 0), 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16) ^ ((d | 0) + 0x165667b1), 0x9e3779b1);
  h ^= h >>> 15;
  return h >>> 0;
}

function nlRand(h) {
  return h / 4294967296;
}

// Gradient noise in 3D, hash-based (no permutation table so any seed works).
function nlGrad(h, x, y, z) {
  switch (h & 15) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x + z;
    case 5: return -x + z;
    case 6: return x - z;
    case 7: return -x - z;
    case 8: return y + z;
    case 9: return -y + z;
    case 10: return y - z;
    case 11: return -y - z;
    case 12: return x + y;
    case 13: return -y + z;
    case 14: return -x + y;
    default: return -y - z;
  }
}

function nlFade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function nlLerp(a, b, t) {
  return a + (b - a) * t;
}

function nlPerlin3(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = nlFade(xf);
  const v = nlFade(yf);
  const w = nlFade(zf);
  const g = (ix, iy, iz, dx, dy, dz) => nlGrad(nlHash(ix, iy, iz, seed), dx, dy, dz);
  const x00 = nlLerp(g(xi, yi, zi, xf, yf, zf), g(xi + 1, yi, zi, xf - 1, yf, zf), u);
  const x10 = nlLerp(g(xi, yi + 1, zi, xf, yf - 1, zf), g(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf), u);
  const x01 = nlLerp(g(xi, yi, zi + 1, xf, yf, zf - 1), g(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), u);
  const x11 = nlLerp(g(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1), g(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1), u);
  return nlLerp(nlLerp(x00, x10, v), nlLerp(x01, x11, v), w); // roughly -1..1
}

function nlFbm3(x, y, z, seed, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += nlPerlin3(x, y, z, seed + o * 131) * amp;
    norm += amp;
    x *= 2;
    y *= 2;
    z *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

// ---------- asset access ----------

function nlCellValue(cell) {
  if (cell === 1) return 0;
  if (cell === 2) return 1;
  if (cell >= 10) return (cell - 10) / 255;
  return 0;
}

function nlCellAlpha(cell) {
  return cell === 0 ? 0 : 1;
}

function nlAssetsOfTypes(types) {
  // Order by the experiment's type preference (first listed type first),
  // keeping gallery order within a type.
  return state.assets
    .filter((asset) => types.includes(asset.type))
    .sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type));
}

function nlPickedAsset(exp) {
  const store = nlLoadStore();
  const candidates = nlAssetsOfTypes(exp.assetTypes);
  if (!candidates.length) return null;
  const picked = candidates.find((asset) => asset.id === store.assets[exp.id]);
  return picked || candidates[0];
}

// A stamp bank: uniform view over particle animations, animation frames, and
// tiles, so scatter/flow can consume any drawable asset.
function nlStampBank(asset) {
  if (!asset) return [];
  if (asset.type === "particles") {
    return asset.particles.map((particle) => ({
      width: particle.width,
      height: particle.height,
      frames: particle.frames,
      fps: asset.fps || 8,
    }));
  }
  if (asset.type === "animation" || asset.type === "cube") {
    return [{ width: asset.width, height: asset.height, frames: asset.frames, fps: asset.fps || 8 }];
  }
  if (asset.type === "tileset") {
    return asset.tiles.map((tile) => ({
      width: asset.tileSize,
      height: asset.tileSize,
      frames: [tile],
      fps: 1,
    }));
  }
  if (asset.type === "blockset") {
    return asset.layers.map((layer) => ({
      width: asset.width,
      height: asset.height,
      frames: [layer],
      fps: 1,
    }));
  }
  return [];
}

// ---------- float compositing buffer (premultiplied gray + alpha) ----------

function nlMakeBuffer(width, height) {
  return {
    width,
    height,
    val: new Float32Array(width * height),
    alpha: new Float32Array(width * height),
  };
}

function nlClearBuffer(buf) {
  buf.val.fill(0);
  buf.alpha.fill(0);
}

function nlFadeBuffer(buf, keep) {
  const { val, alpha } = buf;
  for (let i = 0; i < val.length; i += 1) {
    val[i] *= keep;
    alpha[i] *= keep;
  }
}

function nlBlendPixel(buf, index, v, a, blend) {
  if (a <= 0) return;
  const pv = v * a; // premultiply
  if (blend === "add") {
    buf.val[index] = Math.min(1, buf.val[index] + pv);
    buf.alpha[index] = Math.min(1, buf.alpha[index] + a);
  } else if (blend === "max") {
    if (a >= buf.alpha[index]) {
      buf.val[index] = Math.max(buf.val[index], pv);
      buf.alpha[index] = Math.max(buf.alpha[index], a);
    }
  } else {
    // source-over
    const inv = 1 - a;
    buf.val[index] = pv + buf.val[index] * inv;
    buf.alpha[index] = a + buf.alpha[index] * inv;
  }
}

// Stamp one frame grid into the buffer, rotated/scaled, toroidally wrapped.
function nlDrawStamp(buf, cells, gw, gh, centerX, centerY, scale, rot, blend, opacity) {
  if (scale <= 0) return;
  const halfW = (gw * scale) / 2;
  const halfH = (gh * scale) / 2;
  const radius = Math.ceil(Math.hypot(halfW, halfH));
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  const x0 = Math.floor(centerX - radius);
  const y0 = Math.floor(centerY - radius);
  const x1 = Math.ceil(centerX + radius);
  const y1 = Math.ceil(centerY + radius);
  for (let y = y0; y <= y1; y += 1) {
    const wy = ((y % buf.height) + buf.height) % buf.height;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      const sx = (dx * cos - dy * sin) / scale + gw / 2;
      const sy = (dx * sin + dy * cos) / scale + gh / 2;
      const cx = Math.floor(sx);
      const cy = Math.floor(sy);
      if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
      const cell = cells[cy * gw + cx];
      const a = nlCellAlpha(cell) * opacity;
      if (a <= 0) continue;
      const wx = ((x % buf.width) + buf.width) % buf.width;
      nlBlendPixel(buf, wy * buf.width + wx, nlCellValue(cell), a, blend);
    }
  }
}

function nlBufferToCanvas(buf, ctx) {
  const image = ctx.createImageData(buf.width, buf.height);
  const data = image.data;
  for (let i = 0; i < buf.val.length; i += 1) {
    const a = buf.alpha[i];
    const v = a > 0.0001 ? buf.val[i] / a : 0;
    const level = Math.max(0, Math.min(255, Math.round(v * 255)));
    data[i * 4] = level;
    data[i * 4 + 1] = level;
    data[i * 4 + 2] = level;
    data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
  }
  ctx.putImageData(image, 0, 0);
}

function nlGrayToCanvas(values, alphas, width, height, ctx) {
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < values.length; i += 1) {
    const level = Math.max(0, Math.min(255, Math.round(values[i] * 255)));
    data[i * 4] = level;
    data[i * 4 + 1] = level;
    data[i * 4 + 2] = level;
    data[i * 4 + 3] = alphas ? Math.max(0, Math.min(255, Math.round(alphas[i] * 255))) : 255;
  }
  ctx.putImageData(image, 0, 0);
}

// ---------- experiment: scatter (stamp noise) ----------

const nlScatter = {
  id: "scatter",
  name: "Scatter",
  assetTypes: ["particles", "animation", "tileset"],
  blurb: "Stamp noise: your drawings placed by a deterministic hash grid — density, jitter and octaves like a noise, marks like your hand. Pure rule: same seed, same field, forever.",
  width: 320,
  height: 180,
  defaults: {
    freq: 6,
    perCell: 2,
    jitter: 1,
    rotMode: "quarter",
    scaleJitter: 0.4,
    baseScale: 1,
    blend: "add",
    density: "uniform",
    densityAmount: 0.8,
    octaves: 1,
    gain: 0.55,
    animate: true,
    drift: 0,
    seed: 1,
  },
  controls: (s) => [
    ["slider", "freq", "Grid frequency", 2, 24, 1],
    ["slider", "perCell", "Stamps per cell", 0, 5, 0.25],
    ["slider", "jitter", "Position jitter", 0, 1.5, 0.05],
    ["select", "rotMode", "Rotation", [["none", "none"], ["quarter", "90° steps"], ["free", "free"]]],
    ["slider", "scaleJitter", "Scale jitter", 0, 1, 0.05],
    ["slider", "baseScale", "Stamp scale", 0.25, 3, 0.05],
    ["select", "blend", "Blend", [["add", "add"], ["over", "over"], ["max", "max"]]],
    ["select", "density", "Density map", [["uniform", "uniform"], ["radial", "radial"], ["perlin", "perlin"]]],
    ["slider", "densityAmount", "Density contrast", 0, 1, 0.05],
    ["slider", "octaves", "Octaves (fbm)", 1, 4, 1],
    ["slider", "gain", "Octave gain", 0.2, 0.9, 0.05],
    ["slider", "drift", "Drift", 0, 2, 0.05],
    ["toggle", "animate", "Animate frames"],
    ["seed", "seed", "Seed"],
  ],
  init(rt) {
    rt.buf = nlMakeBuffer(this.width, this.height);
  },
  frame(rt) {
    const s = rt.settings;
    const bank = nlStampBank(rt.asset);
    nlClearBuffer(rt.buf);
    if (!bank.length) return;
    const W = this.width;
    const H = this.height;
    let placed = 0;
    for (let o = 0; o < s.octaves; o += 1) {
      const freq = s.freq * 2 ** o;
      const amp = s.gain ** o;
      const cell = W / freq;
      const rows = Math.ceil(H / cell) + 1;
      for (let gy = -1; gy <= rows; gy += 1) {
        for (let gx = -1; gx <= freq; gx += 1) {
          const centerU = ((gx + 0.5) * cell) / W;
          const centerV = ((gy + 0.5) * cell) / H;
          const d = nlScatterDensity(s, centerU, centerV, rt.t, s.seed + o);
          const expected = s.perCell * d;
          const baseHash = nlHash(s.seed, o + 1, gx, gy);
          const count = Math.floor(expected) + (nlRand(nlHash(baseHash, 7, gx, gy)) < expected % 1 ? 1 : 0);
          for (let i = 0; i < count; i += 1) {
            const h1 = nlHash(baseHash, i * 4 + 1, gx, gy);
            const h2 = nlHash(baseHash, i * 4 + 2, gy, gx);
            const h3 = nlHash(baseHash, i * 4 + 3, gx + 11, gy);
            const h4 = nlHash(baseHash, i * 4 + 4, gx, gy + 11);
            const stamp = bank[nlHash(h1, h2, 5, 9) % bank.length];
            let px = (gx + 0.5 + (nlRand(h1) - 0.5) * s.jitter) * cell;
            let py = (gy + 0.5 + (nlRand(h2) - 0.5) * s.jitter) * cell;
            if (s.drift > 0) {
              const angle = nlRand(h4) * Math.PI * 2;
              const dist = rt.t * s.drift * cell * 0.4;
              px += Math.cos(angle) * dist;
              py += Math.sin(angle) * dist;
            }
            const rot = s.rotMode === "none"
              ? 0
              : s.rotMode === "quarter"
                ? (nlHash(h3, 3, 1, 1) % 4) * (Math.PI / 2)
                : nlRand(h3) * Math.PI * 2;
            const jitterScale = 1 + (nlRand(nlHash(h4, 13, 1, 1)) - 0.5) * 2 * s.scaleJitter;
            const scale = Math.max(0.05, (s.baseScale * jitterScale) / 2 ** o);
            const frames = stamp.frames.length;
            const phase = nlRand(nlHash(h2, h3, 1, 1)) * frames;
            const frameIndex = s.animate
              ? Math.floor(rt.t * stamp.fps + phase) % frames
              : Math.floor(phase) % frames;
            nlDrawStamp(
              rt.buf,
              stamp.frames[frameIndex],
              stamp.width,
              stamp.height,
              px,
              py,
              scale,
              rot,
              s.blend,
              amp,
            );
            placed += 1;
          }
        }
      }
    }
    nlBufferToCanvas(rt.buf, rt.ctx);
    rt.info = `${placed} stamps · deterministic in (u, v, t)`;
  },
};

function nlScatterDensity(s, u, v, t, seed) {
  let d = 1;
  if (s.density === "radial") {
    const dist = Math.hypot(u - 0.5, (v - 0.5) * 0.75) * 2;
    d = Math.max(0, 1 - dist);
  } else if (s.density === "perlin") {
    d = nlFbm3(u * 3, v * 3, t * 0.15, seed + 977, 2) * 0.5 + 0.5;
  }
  return 1 + (d - 1) * s.densityAmount;
}

// ---------- experiment: cube fbm ----------

const nlCubeFbm = {
  id: "cubefbm",
  name: "Cube FBM",
  assetTypes: ["cube"],
  blurb: "Your hand-drawn cube summed in octaves, like fbm does with perlin: big shapes carry smaller copies of themselves. Smooth mode interpolates cells and slices (wavetable-style).",
  width: 256,
  height: 144,
  defaults: {
    scale: 1,
    octaves: 3,
    gain: 0.5,
    lacunarity: 2,
    smooth: true,
    zMode: "time",
    zSpeed: 0.4,
    warp: 0,
    seed: 1,
  },
  controls: () => [
    ["slider", "scale", "Scale", 0.25, 4, 0.05],
    ["slider", "octaves", "Octaves", 1, 5, 1],
    ["slider", "gain", "Gain", 0.2, 0.9, 0.05],
    ["slider", "lacunarity", "Lacunarity", 1.5, 3, 0.1],
    ["toggle", "smooth", "Smooth (trilinear)"],
    ["select", "zMode", "Z drive", [["time", "time (loop)"], ["perlin", "perlin field"], ["still", "still"]]],
    ["slider", "zSpeed", "Z speed", 0, 2, 0.05],
    ["slider", "warp", "Domain warp", 0, 1.5, 0.05],
    ["seed", "seed", "Seed"],
  ],
  init(rt) {
    rt.values = new Float32Array(this.width * this.height);
    rt.alphas = new Float32Array(this.width * this.height);
  },
  frame(rt) {
    const s = rt.settings;
    const asset = rt.asset;
    if (!asset) return;
    const W = this.width;
    const H = this.height;
    const frames = asset.frames;
    const fw = asset.width;
    const fh = asset.height;
    const fc = frames.length;
    const aspect = W / H;
    const zBase = s.zMode === "time" ? rt.t * s.zSpeed : 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let u = (x / W) * s.scale * aspect;
        let v = (y / H) * s.scale;
        if (s.warp > 0) {
          u += nlPerlin3(u * 1.7, v * 1.7, rt.t * 0.2, s.seed + 31) * s.warp * 0.4;
          v += nlPerlin3(u * 1.7 + 51, v * 1.7, rt.t * 0.2, s.seed + 67) * s.warp * 0.4;
        }
        const z = s.zMode === "perlin"
          ? nlFbm3(u * 1.3, v * 1.3, rt.t * 0.12, s.seed + 5, 2) * 0.5 + 0.5 + rt.t * s.zSpeed * 0.05
          : zBase;
        let sum = 0;
        let alphaSum = 0;
        let norm = 0;
        let amp = 1;
        let fu = u;
        let fv = v;
        let fz = z;
        for (let o = 0; o < s.octaves; o += 1) {
          const sample = nlCubeSample(frames, fw, fh, fc, fu, fv, fz, s.smooth);
          sum += sample[0] * amp;
          alphaSum += sample[1] * amp;
          norm += amp;
          fu *= s.lacunarity;
          fv *= s.lacunarity;
          fz = fz * s.lacunarity + o * 0.37;
          amp *= s.gain;
        }
        const index = y * W + x;
        rt.values[index] = sum / norm;
        rt.alphas[index] = alphaSum / norm;
      }
    }
    nlGrayToCanvas(rt.values, rt.alphas, W, H, rt.ctx);
    rt.info = `${fc} slices · ${fw}×${fh} · ${s.octaves} octave${s.octaves > 1 ? "s" : ""}`;
  },
};

function nlWrapIndex(value, size) {
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

function nlCubeCell(frames, fw, fh, fc, x, y, z) {
  const cell = frames[nlWrapIndex(z, fc)][nlWrapIndex(y, fh) * fw + nlWrapIndex(x, fw)];
  return [nlCellValue(cell) * nlCellAlpha(cell), nlCellAlpha(cell)];
}

// Sample the cube volume at fractional looping coordinates. Returns
// [premultiplied value, alpha] so trilinear blending is halo-free.
function nlCubeSample(frames, fw, fh, fc, u, v, w, smooth) {
  const x = (u - Math.floor(u)) * fw;
  const y = (v - Math.floor(v)) * fh;
  const z = (w - Math.floor(w)) * fc;
  if (!smooth) {
    const sample = nlCubeCell(frames, fw, fh, fc, Math.floor(x), Math.floor(y), Math.floor(z));
    return [sample[1] > 0 ? sample[0] / sample[1] : 0, sample[1]];
  }
  const x0 = Math.floor(x - 0.5);
  const y0 = Math.floor(y - 0.5);
  const z0 = Math.floor(z - 0.5);
  const tx = x - 0.5 - x0;
  const ty = y - 0.5 - y0;
  const tz = z - 0.5 - z0;
  let value = 0;
  let alpha = 0;
  for (let dz = 0; dz <= 1; dz += 1) {
    const wz = dz ? tz : 1 - tz;
    for (let dy = 0; dy <= 1; dy += 1) {
      const wy = dy ? ty : 1 - ty;
      for (let dx = 0; dx <= 1; dx += 1) {
        const wx = dx ? tx : 1 - tx;
        const weight = wx * wy * wz;
        if (weight <= 0) continue;
        const sample = nlCubeCell(frames, fw, fh, fc, x0 + dx, y0 + dy, z0 + dz);
        value += sample[0] * weight;
        alpha += sample[1] * weight;
      }
    }
  }
  return [alpha > 0.0001 ? value / alpha : 0, alpha];
}

// ---------- experiment: wang tiles ----------

const nlWang = {
  id: "wang",
  name: "Wang Tiles",
  assetTypes: ["tileset"],
  blurb: "Dominoes for pictures: tiles are placed so touching edges match exactly, giving an endless non-repeating plane from a handful of drawings. Draw tiles whose edges agree and the seams disappear.",
  width: 320,
  height: 180,
  defaults: {
    cellsAcross: 10,
    scroll: 0.5,
    seed: 1,
  },
  controls: () => [
    ["slider", "cellsAcross", "Tiles across", 4, 24, 1],
    ["slider", "scroll", "Scroll speed", 0, 2, 0.05],
    ["seed", "seed", "Seed"],
  ],
  init(rt) {
    const s = rt.settings;
    const asset = rt.asset;
    rt.grid = null;
    rt.matchRate = 0;
    if (!asset || !asset.tiles.length) return;
    const size = asset.tileSize;
    const edge = (tile, side) => {
      const cells = [];
      for (let i = 0; i < size; i += 1) {
        if (side === "top") cells.push(tile[i]);
        else if (side === "bottom") cells.push(tile[(size - 1) * size + i]);
        else if (side === "left") cells.push(tile[i * size]);
        else cells.push(tile[i * size + size - 1]);
      }
      return cells.join(",");
    };
    const edges = asset.tiles.map((tile) => ({
      top: edge(tile, "top"),
      bottom: edge(tile, "bottom"),
      left: edge(tile, "left"),
      right: edge(tile, "right"),
    }));
    // Grid is a torus 3x the visible width so scrolling loops seamlessly.
    const gw = Math.max(8, s.cellsAcross * 3);
    const gh = Math.max(6, Math.ceil((s.cellsAcross * this.height) / this.width) * 3);
    const grid = new Array(gw * gh);
    let matched = 0;
    for (let y = 0; y < gh; y += 1) {
      for (let x = 0; x < gw; x += 1) {
        const leftTile = x > 0 ? grid[y * gw + x - 1] : null;
        const topTile = y > 0 ? grid[(y - 1) * gw + x] : null;
        const fits = (index) =>
          (leftTile === null || edges[index].left === edges[leftTile].right)
          && (topTile === null || edges[index].top === edges[topTile].bottom);
        let candidates = [];
        for (let i = 0; i < asset.tiles.length; i += 1) if (fits(i)) candidates.push(i);
        let full = true;
        if (!candidates.length) {
          full = false;
          for (let i = 0; i < asset.tiles.length; i += 1) {
            if (leftTile === null || edges[i].left === edges[leftTile].right) candidates.push(i);
          }
          if (!candidates.length) candidates = asset.tiles.map((_, i) => i);
        }
        if (full) matched += 1;
        grid[y * gw + x] = candidates[nlHash(s.seed, x, y, 71) % candidates.length];
      }
    }
    rt.grid = { cells: grid, gw, gh, size };
    rt.matchRate = Math.round((matched / (gw * gh)) * 100);
  },
  frame(rt) {
    const s = rt.settings;
    const asset = rt.asset;
    const ctx = rt.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!asset || !rt.grid) return;
    const { cells, gw, gh, size } = rt.grid;
    const cellPx = this.width / s.cellsAcross;
    const offset = rt.t * s.scroll * cellPx;
    const cols = Math.ceil(this.width / cellPx) + 1;
    const rows = Math.ceil(this.height / cellPx) + 1;
    const startCol = Math.floor(offset / cellPx);
    const subOffset = offset % cellPx;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const gx = nlWrapIndex(startCol + x, gw);
        const gy = nlWrapIndex(y, gh);
        const tile = asset.tiles[cells[gy * gw + gx]];
        nlDrawTileScaled(ctx, tile, size, Math.round(x * cellPx - subOffset), Math.round(y * cellPx), Math.ceil(cellPx));
      }
    }
    rt.info = `${rt.matchRate}% of cells fully edge-matched — draw tiles with agreeing edges to raise it`;
  },
};

function nlDrawTileScaled(ctx, tile, size, dx, dy, drawSize) {
  const cellPx = drawSize / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cell = tile[y * size + x];
      if (cell === 0) continue;
      const level = Math.round(nlCellValue(cell) * 255);
      ctx.fillStyle = `rgb(${level}, ${level}, ${level})`;
      ctx.fillRect(dx + Math.floor(x * cellPx), dy + Math.floor(y * cellPx), Math.ceil(cellPx), Math.ceil(cellPx));
    }
  }
}

// ---------- experiment: flow field particles ----------

const nlFlow = {
  id: "flow",
  name: "Flow Field",
  assetTypes: ["particles", "animation"],
  blurb: "A curl-noise wind advects your drawn particles: the flow only ever swirls (nothing bunches up), and fading trails give the swarm a memory. This one is deliberately a simulation — contrast it with Scatter.",
  width: 320,
  height: 180,
  defaults: {
    count: 160,
    noiseScale: 1.6,
    speed: 1,
    evolve: 0.25,
    fade: 0.9,
    blend: "add",
    headingFrames: false,
    size: 1,
    seed: 1,
  },
  controls: () => [
    ["slider", "count", "Particles", 10, 600, 10],
    ["slider", "noiseScale", "Field scale", 0.5, 5, 0.1],
    ["slider", "speed", "Speed", 0, 3, 0.05],
    ["slider", "evolve", "Field evolution", 0, 1, 0.05],
    ["slider", "fade", "Trail fade", 0.5, 0.995, 0.005],
    ["select", "blend", "Blend", [["add", "add"], ["over", "over"], ["max", "max"]]],
    ["slider", "size", "Stamp scale", 0.25, 3, 0.05],
    ["toggle", "headingFrames", "Frame from heading"],
    ["seed", "seed", "Seed"],
  ],
  reinitKeys: ["count", "seed"],
  init(rt) {
    const s = rt.settings;
    rt.buf = nlMakeBuffer(this.width, this.height);
    rt.particlesSim = [];
    for (let i = 0; i < s.count; i += 1) {
      rt.particlesSim.push({
        x: nlRand(nlHash(s.seed, i, 1, 1)) * this.width,
        y: nlRand(nlHash(s.seed, i, 2, 1)) * this.height,
        phase: nlRand(nlHash(s.seed, i, 3, 1)) * 64,
        bankIndex: nlHash(s.seed, i, 4, 1),
      });
    }
  },
  frame(rt, dt) {
    const s = rt.settings;
    const bank = nlStampBank(rt.asset);
    nlFadeBuffer(rt.buf, rt.playing ? s.fade : 1);
    if (bank.length && rt.playing) {
      const eps = 2;
      const ns = s.noiseScale / 100;
      for (const particle of rt.particlesSim) {
        const tz = rt.t * s.evolve;
        // Curl of the scalar field: rotate the gradient 90° — divergence-free.
        const dx = (nlPerlin3(particle.x * ns, (particle.y + eps) * ns, tz, s.seed)
          - nlPerlin3(particle.x * ns, (particle.y - eps) * ns, tz, s.seed)) / (2 * eps);
        const dy = (nlPerlin3((particle.x + eps) * ns, particle.y * ns, tz, s.seed)
          - nlPerlin3((particle.x - eps) * ns, particle.y * ns, tz, s.seed)) / (2 * eps);
        const vx = dx * 4000 * s.speed;
        const vy = -dy * 4000 * s.speed;
        particle.x = ((particle.x + vx * dt) % this.width + this.width) % this.width;
        particle.y = ((particle.y + vy * dt) % this.height + this.height) % this.height;
        const stamp = bank[particle.bankIndex % bank.length];
        const frames = stamp.frames.length;
        let frameIndex;
        if (s.headingFrames && frames > 1) {
          const heading = (Math.atan2(vy, vx) + Math.PI * 2) % (Math.PI * 2);
          frameIndex = Math.floor((heading / (Math.PI * 2)) * frames) % frames;
        } else {
          particle.phase += dt * stamp.fps;
          frameIndex = Math.floor(particle.phase) % frames;
        }
        nlDrawStamp(rt.buf, stamp.frames[frameIndex], stamp.width, stamp.height, particle.x, particle.y, s.size, 0, s.blend, 1);
      }
    }
    nlBufferToCanvas(rt.buf, rt.ctx);
    rt.info = `${s.count} particles riding curl noise`;
  },
};

// ---------- experiment: reaction-diffusion ----------

const NL_RD_PRESETS = {
  spots: { feed: 0.035, kill: 0.065 },
  stripes: { feed: 0.06, kill: 0.062 },
  coral: { feed: 0.0545, kill: 0.062 },
  worms: { feed: 0.046, kill: 0.063 },
};

const nlRd = {
  id: "rd",
  name: "Reaction-Diffusion",
  assetTypes: ["tileset", "animation", "particles", "cube", "blockset"],
  blurb: "Two chemicals feed and eat each other (Gray–Scott): spots, stripes and coral grow on their own — the math behind animal markings. Your drawing is the seed the pattern grows from.",
  width: 200,
  height: 112,
  defaults: {
    preset: "coral",
    feed: 0.0545,
    kill: 0.062,
    iters: 6,
    modAmount: 0,
    seed: 1,
  },
  controls: () => [
    ["select", "preset", "Preset", [["spots", "spots"], ["stripes", "stripes"], ["coral", "coral"], ["worms", "worms"], ["custom", "custom"]]],
    ["slider", "feed", "Feed", 0.01, 0.09, 0.0005],
    ["slider", "kill", "Kill", 0.04, 0.075, 0.0005],
    ["slider", "iters", "Speed (steps/frame)", 1, 12, 1],
    ["slider", "modAmount", "Asset modulates feed", 0, 1, 0.05],
    ["button", "reseed", "Reseed from asset"],
  ],
  init(rt) {
    const W = this.width;
    const H = this.height;
    rt.A = new Float32Array(W * H).fill(1);
    rt.B = new Float32Array(W * H);
    rt.A2 = new Float32Array(W * H);
    rt.B2 = new Float32Array(W * H);
    rt.mod = new Float32Array(W * H).fill(0.5);
    const bank = nlStampBank(rt.asset);
    if (bank.length) {
      const stamp = bank[0];
      const cells = stamp.frames[0];
      const scale = Math.max(1, Math.floor(Math.min(W / (stamp.width * 2), H / (stamp.height * 2))));
      const originX = Math.floor(W / 2 - (stamp.width * scale) / 2);
      const originY = Math.floor(H / 2 - (stamp.height * scale) / 2);
      for (let y = 0; y < stamp.height; y += 1) {
        for (let x = 0; x < stamp.width; x += 1) {
          const cell = cells[y * stamp.width + x];
          if (nlCellAlpha(cell) === 0) continue;
          for (let sy = 0; sy < scale; sy += 1) {
            for (let sx = 0; sx < scale; sx += 1) {
              const px = originX + x * scale + sx;
              const py = originY + y * scale + sy;
              if (px >= 0 && py >= 0 && px < W && py < H) rt.B[py * W + px] = 1;
            }
          }
        }
      }
      // The full drawing (tiled) becomes the feed-modulation map.
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const cell = cells[(y % stamp.height) * stamp.width + (x % stamp.width)];
          rt.mod[y * W + x] = nlCellAlpha(cell) ? nlCellValue(cell) : 0.5;
        }
      }
    } else {
      // No asset: a small central square so the chemistry still runs.
      for (let y = H / 2 - 4; y < H / 2 + 4; y += 1) {
        for (let x = W / 2 - 4; x < W / 2 + 4; x += 1) {
          rt.B[Math.floor(y) * W + Math.floor(x)] = 1;
        }
      }
    }
  },
  frame(rt) {
    const s = rt.settings;
    const W = this.width;
    const H = this.height;
    if (rt.playing) {
      for (let iter = 0; iter < s.iters; iter += 1) {
        nlRdStep(rt, W, H, s);
      }
    }
    const values = rt.A2; // reuse as scratch for display
    for (let i = 0; i < values.length; i += 1) {
      values[i] = Math.max(0, Math.min(1, rt.A[i] - rt.B[i]));
    }
    nlGrayToCanvas(values, null, W, H, rt.ctx);
    rt.info = `feed ${s.feed.toFixed(4)} · kill ${s.kill.toFixed(4)}`;
  },
};

function nlRdStep(rt, W, H, s) {
  const { A, B, A2, B2, mod } = rt;
  const dA = 1.0;
  const dB = 0.5;
  for (let y = 0; y < H; y += 1) {
    const up = nlWrapIndex(y - 1, H) * W;
    const down = nlWrapIndex(y + 1, H) * W;
    const row = y * W;
    for (let x = 0; x < W; x += 1) {
      const left = nlWrapIndex(x - 1, W);
      const right = nlWrapIndex(x + 1, W);
      const index = row + x;
      const lapA = A[up + x] + A[down + x] + A[row + left] + A[row + right]
        + 0.25 * (A[up + left] + A[up + right] + A[down + left] + A[down + right])
        - 5 * A[index];
      const lapB = B[up + x] + B[down + x] + B[row + left] + B[row + right]
        + 0.25 * (B[up + left] + B[up + right] + B[down + left] + B[down + right])
        - 5 * B[index];
      const a = A[index];
      const b = B[index];
      const reaction = a * b * b;
      const feed = s.feed * (1 + s.modAmount * (mod[index] - 0.5));
      A2[index] = a + (dA * lapA * 0.2 - reaction + feed * (1 - a));
      B2[index] = b + (dB * lapB * 0.2 + reaction - (s.kill + feed) * b);
    }
  }
  rt.A = A2;
  rt.B = B2;
  rt.A2 = A;
  rt.B2 = B;
}

// ---------- experiment: granular time ----------

const nlGrain = {
  id: "grain",
  name: "Granular Time",
  assetTypes: ["animation", "cube"],
  blurb: "Granular synthesis on the time axis: several read heads replay short grains of your animation with jittered position, length and direction. The frames are yours; the rhythm of time is procedural.",
  width: 256,
  height: 144,
  defaults: {
    voices: 3,
    grainLen: 4,
    spray: 4,
    speed: 1,
    reverseProb: 0.3,
    blend: "over",
    seed: 1,
  },
  controls: () => [
    ["slider", "voices", "Voices", 1, 4, 1],
    ["slider", "grainLen", "Grain length (frames)", 1, 16, 1],
    ["slider", "spray", "Position spray", 0, 16, 0.5],
    ["slider", "speed", "Head speed", 0, 3, 0.05],
    ["slider", "reverseProb", "Reverse probability", 0, 1, 0.05],
    ["select", "blend", "Blend", [["over", "over"], ["add", "add"], ["max", "max"]]],
    ["seed", "seed", "Seed"],
  ],
  reinitKeys: ["voices", "seed"],
  init(rt) {
    const s = rt.settings;
    rt.buf = nlMakeBuffer(this.width, this.height);
    rt.voicesSim = [];
    rt.grainCounter = 0;
    for (let i = 0; i < s.voices; i += 1) {
      rt.voicesSim.push({ pos: 0, dir: 1, remaining: 0 });
    }
  },
  frame(rt, dt) {
    const s = rt.settings;
    const asset = rt.asset;
    nlClearBuffer(rt.buf);
    if (!asset || !asset.frames.length) return;
    const frames = asset.frames;
    const fps = asset.fps || 8;
    const head = rt.t * fps * s.speed;
    for (let i = 0; i < rt.voicesSim.length; i += 1) {
      const voice = rt.voicesSim[i];
      if (rt.playing) {
        voice.remaining -= dt * fps * s.speed;
        if (voice.remaining <= 0) {
          rt.grainCounter += 1;
          const h = nlHash(s.seed, i, rt.grainCounter, 29);
          voice.pos = head + (nlRand(h) - 0.5) * 2 * s.spray;
          voice.dir = nlRand(nlHash(h, 3, i, 5)) < s.reverseProb ? -1 : 1;
          voice.remaining = s.grainLen * (0.5 + nlRand(nlHash(h, 9, i, 7)));
        }
        voice.pos += voice.dir * dt * fps * s.speed;
      }
      const frameIndex = nlWrapIndex(Math.floor(voice.pos), frames.length);
      const scale = Math.max(1, Math.floor(Math.min(
        this.width / asset.width,
        (this.height - 14) / asset.height,
      )));
      const envelope = Math.min(1, voice.remaining / Math.max(1, s.grainLen * 0.35));
      nlDrawStamp(
        rt.buf,
        frames[frameIndex],
        asset.width,
        asset.height,
        this.width / 2,
        (this.height - 14) / 2,
        scale,
        0,
        s.blend,
        s.blend === "over" ? 0.4 + 0.6 * envelope : (0.35 + 0.65 * envelope) / Math.max(1, rt.voicesSim.length - 1),
      );
    }
    nlBufferToCanvas(rt.buf, rt.ctx);
    nlGrainTimeline(rt, frames.length, head);
    rt.info = `${rt.voicesSim.length} voices over ${frames.length} frames`;
  },
};

function nlGrainTimeline(rt, frameCount, head) {
  const ctx = rt.ctx;
  const W = nlGrain.width;
  const H = nlGrain.height;
  const barY = H - 10;
  ctx.fillStyle = "rgba(18, 18, 16, 0.85)";
  ctx.fillRect(0, barY - 2, W, 12);
  for (let i = 0; i <= frameCount; i += 1) {
    const x = Math.round((i / frameCount) * (W - 2)) + 1;
    ctx.fillStyle = "rgba(246, 246, 241, 0.35)";
    ctx.fillRect(x, barY, 1, 8);
  }
  const headX = Math.round(((head / frameCount) % 1) * (W - 2)) + 1;
  ctx.fillStyle = "#f2c40f";
  ctx.fillRect(headX - 1, barY - 2, 3, 12);
  ctx.fillStyle = "#fff";
  for (const voice of rt.voicesSim) {
    const pos = ((voice.pos / frameCount) % 1 + 1) % 1;
    ctx.fillRect(Math.round(pos * (W - 2)) + 1, barY + 2, 2, 5);
  }
}

// ---------- registry, runtime loop ----------

const NL_EXPERIMENTS = [nlScatter, nlCubeFbm, nlWang, nlFlow, nlRd, nlGrain];

function nlExperiment(id) {
  return NL_EXPERIMENTS.find((exp) => exp.id === id) || NL_EXPERIMENTS[0];
}

function noiseLabStop() {
  if (nlRt?.raf) cancelAnimationFrame(nlRt.raf);
  nlRt = null;
}

function nlStart(exp, canvas, infoEl) {
  noiseLabStop();
  const store = nlLoadStore();
  const rt = {
    exp,
    canvas,
    ctx: canvas.getContext("2d"),
    infoEl,
    settings: nlSettings(exp),
    asset: nlPickedAsset(exp),
    t: 0,
    playing: store.playing,
    dirty: true,
    lastTs: performance.now(),
    raf: null,
    info: "",
  };
  nlRt = rt;
  exp.init(rt);
  const tick = (ts) => {
    if (nlRt !== rt) return;
    const dt = Math.min(0.1, Math.max(0, (ts - rt.lastTs) / 1000));
    rt.lastTs = ts;
    if (rt.playing || rt.dirty) {
      if (rt.playing) rt.t += dt;
      rt.dirty = false;
      exp.frame(rt, dt);
      if (rt.infoEl) rt.infoEl.textContent = rt.info;
    }
    rt.raf = requestAnimationFrame(tick);
  };
  rt.raf = requestAnimationFrame(tick);
}

// ---------- UI ----------

function noiseLabScreen() {
  const store = nlLoadStore();
  const exp = nlExperiment(store.tab);
  const wrap = document.createElement("div");
  wrap.className = "noiselab";

  const tabs = document.createElement("div");
  tabs.className = "noiselab-tabs";
  for (const candidate of NL_EXPERIMENTS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn noiselab-tab${candidate.id === exp.id ? " active" : ""}`;
    button.textContent = candidate.name;
    button.addEventListener("click", () => {
      store.tab = candidate.id;
      nlSaveStore();
      render();
    });
    tabs.append(button);
  }
  wrap.append(tabs);

  const blurb = document.createElement("p");
  blurb.className = "noiselab-blurb";
  blurb.textContent = exp.blurb;
  wrap.append(blurb);

  const body = document.createElement("div");
  body.className = "noiselab-body";

  const controls = document.createElement("aside");
  controls.className = "noiselab-controls";

  const stage = document.createElement("div");
  stage.className = "noiselab-stage";
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "noiselab-canvas-wrap";
  const canvas = document.createElement("canvas");
  canvas.width = exp.width;
  canvas.height = exp.height;
  canvasWrap.append(canvas);
  const info = document.createElement("p");
  info.className = "noiselab-info";
  stage.append(canvasWrap, info);

  body.append(controls, stage);
  wrap.append(body);

  nlStart(exp, canvas, info);
  nlBuildControls(controls, exp);
  return wrap;
}

function nlBuildControls(container, exp) {
  const store = nlLoadStore();
  const settings = nlSettings(exp);
  container.innerHTML = "";

  // Asset picker.
  const candidates = nlAssetsOfTypes(exp.assetTypes);
  const assetRow = document.createElement("label");
  assetRow.className = "noiselab-control";
  const assetTitle = document.createElement("span");
  assetTitle.textContent = "Asset";
  assetRow.append(assetTitle);
  if (candidates.length) {
    const select = document.createElement("select");
    for (const asset of candidates) {
      const option = document.createElement("option");
      option.value = asset.id;
      option.textContent = `${asset.name} (${asset.type})`;
      if (nlRt?.asset?.id === asset.id) option.selected = true;
      select.append(option);
    }
    select.addEventListener("change", () => {
      store.assets[exp.id] = select.value;
      nlSaveStore();
      if (nlRt) {
        nlRt.asset = nlPickedAsset(exp);
        exp.init(nlRt);
        nlRt.dirty = true;
      }
    });
    assetRow.append(select);
  } else {
    const hint = document.createElement("em");
    hint.textContent = `none — draw a ${exp.assetTypes.join(" / ")} asset first`;
    assetRow.append(hint);
  }
  container.append(assetRow);

  for (const spec of exp.controls(settings)) {
    container.append(nlControl(exp, settings, spec));
  }

  // Transport row.
  const transport = document.createElement("div");
  transport.className = "noiselab-transport";
  const playButton = document.createElement("button");
  playButton.type = "button";
  playButton.className = "btn";
  playButton.textContent = store.playing ? "Pause" : "Play";
  playButton.addEventListener("click", () => {
    store.playing = !store.playing;
    nlSaveStore();
    if (nlRt) {
      nlRt.playing = store.playing;
      nlRt.lastTs = performance.now();
      nlRt.dirty = true;
    }
    playButton.textContent = store.playing ? "Pause" : "Play";
  });
  transport.append(playButton);
  container.append(transport);
}

function nlControl(exp, settings, spec) {
  const [kind, key, label, ...rest] = spec;
  const row = document.createElement("label");
  row.className = "noiselab-control";
  const title = document.createElement("span");
  title.textContent = label;
  row.append(title);

  const commit = (value, forceInit) => {
    settings[key] = value;
    nlSaveStore();
    if (!nlRt) return;
    nlRt.settings = settings;
    if (forceInit || exp.reinitKeys?.includes(key) || exp.id === "wang" || exp.id === "rd" && key === "preset") {
      exp.init(nlRt);
    }
    nlRt.dirty = true;
  };

  if (kind === "slider") {
    const [min, max, step] = rest;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(settings[key]);
    const value = document.createElement("code");
    value.textContent = String(settings[key]);
    input.addEventListener("input", () => {
      const next = Number(input.value);
      value.textContent = String(next);
      if (exp.id === "rd" && (key === "feed" || key === "kill")) settings.preset = "custom";
      commit(next, false);
    });
    row.append(input, value);
  } else if (kind === "select") {
    const [options] = rest;
    const select = document.createElement("select");
    for (const [optionValue, optionLabel] of options) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionLabel;
      if (settings[key] === optionValue) option.selected = true;
      select.append(option);
    }
    select.addEventListener("change", () => {
      const next = select.value;
      if (exp.id === "rd" && key === "preset" && NL_RD_PRESETS[next]) {
        settings.feed = NL_RD_PRESETS[next].feed;
        settings.kill = NL_RD_PRESETS[next].kill;
        nlSaveStore();
        commit(next, false);
        render();
        return;
      }
      commit(next, false);
    });
    row.append(select);
  } else if (kind === "toggle") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(settings[key]);
    input.addEventListener("change", () => commit(input.checked, false));
    row.append(input);
  } else if (kind === "seed") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = `Reseed (#${settings[key]})`;
    button.addEventListener("click", () => {
      const next = (settings[key] % 9973) + 1 + (nlHash(Date.now() | 0, 1, 2, 3) % 97);
      button.textContent = `Reseed (#${next})`;
      commit(next, true);
    });
    row.append(button);
  } else if (kind === "button") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = label;
    button.addEventListener("click", () => commit(settings[key], true));
    title.textContent = "";
    row.append(button);
  }
  return row;
}
