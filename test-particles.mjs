import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// app.js is a dependency-free browser script rather than a module. Load its
// pure asset helpers in a small VM context and omit only the DOM startup block.
let source = fs.readFileSync(new URL("./src/app.js", import.meta.url), "utf8");
const startupStart = source.indexOf("const app = document.querySelector");
const startupEnd = source.indexOf("/* ---------- Asset creation ---------- */");
assert.ok(startupStart > 0 && startupEnd > startupStart, "app startup markers changed");
source = `${source.slice(0, startupStart)}const app = null;\n${source.slice(startupEnd)}`;

const storage = new Map();
const context = vm.createContext({
  ArrayBuffer,
  DataView,
  Date,
  Math,
  Uint8Array,
  console,
  localStorage: {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
  },
  setTimeout,
});
vm.runInContext(source, context, { filename: "asset-editor/src/app.js" });
const plain = (value) => JSON.parse(JSON.stringify(value));

const particles = context.createParticles("roundtrip", true);
assert.deepEqual(
  plain(particles.particles.map(({ width, height, frames }) => [width, height, frames.length])),
  [[9, 9, 4], [13, 7, 6]],
);

const encoded = context.encodeBinaryAsset(particles);
const encodedView = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
assert.equal(encodedView.getUint16(4, true), 2);
assert.equal(encodedView.getUint8(6), 5);
assert.equal(encodedView.getUint16(8, true), 0);
assert.equal(encodedView.getUint16(10, true), 0);
assert.equal(encodedView.getUint16(12, true), 2);
assert.deepEqual(
  [
    encodedView.getUint16(18, true),
    encodedView.getUint16(20, true),
    encodedView.getUint16(22, true),
    encodedView.getUint16(26, true),
    encodedView.getUint16(28, true),
    encodedView.getUint16(30, true),
  ],
  [9, 9, 4, 13, 7, 6],
);

const decoded = context.decodeBinaryAsset(encoded, "imported");
assert.equal(decoded.type, "particles");
assert.equal(decoded.name, "imported");
assert.deepEqual(
  plain(decoded.particles.map(({ width, height, frames }) => [width, height, frames.length])),
  [[9, 9, 4], [13, 7, 6]],
);
assert.equal(decoded.preview.number, 40, "binary import resets editor-only preview settings");

const invalidPixel = new Uint8Array(encoded);
new DataView(invalidPixel.buffer).setUint16(18 + 2 * 8, 10, true);
assert.throws(() => context.decodeBinaryAsset(invalidPixel, "invalid"), /invalid particle pixel/);

const oversized = new Uint8Array(encoded);
new DataView(oversized.buffer).setUint16(18, 33, true);
assert.throws(() => context.decodeBinaryAsset(oversized, "oversized"), /invalid particle descriptor/);

const animation = context.createAnimation("legacy", true);
const legacy = context.encodeBinaryAsset(animation);
assert.equal(new DataView(legacy.buffer).getUint16(4, true), 1, "existing assets stay TGAS v1");

const tileset = context.createTileset("gray_tiles");
tileset.tiles[0].splice(0, 10, 0, 1, 2, 10, 137, 265, 3, 9, 266, 10.5);
const normalizedTileset = context.normalizeAsset(tileset);
assert.deepEqual(
  plain(normalizedTileset.tiles[0].slice(0, 10)),
  [0, 1, 2, 10, 137, 265, 0, 0, 0, 0],
  "tilesets preserve grayscale cells and clear unsupported values",
);

const encodedTileset = context.encodeBinaryAsset(tileset);
const tilesetView = new DataView(encodedTileset.buffer, encodedTileset.byteOffset, encodedTileset.byteLength);
assert.equal(tilesetView.getUint16(4, true), 1, "grayscale tilesets stay TGAS v1");
assert.equal(tilesetView.getUint8(6), 1);
const decodedTileset = context.decodeBinaryAsset(encodedTileset, "gray_tiles_imported");
assert.deepEqual(
  plain(decodedTileset.tiles[0].slice(0, 10)),
  [0, 1, 2, 10, 137, 265, 0, 0, 0, 0],
  "grayscale tileset cells survive binary round-trip",
);

const invalidTileset = new Uint8Array(encodedTileset);
new DataView(invalidTileset.buffer).setUint16(18 + 1 + 4 * 2, 266, true);
assert.equal(
  context.decodeBinaryAsset(invalidTileset, "invalid_gray").tiles[0][4],
  0,
  "invalid imported grayscale cells normalize to transparent",
);

const paintedGray = vm.runInContext(`
  state.grayMin = 127;
  state.grayMax = 127;
  state.grayScale = "single";
  state.opacityMin = 100;
  state.opacityMax = 100;
  state.opacityScale = "single";
  state.color = grayPixel(127);
  strokePixelForCell({ type: "tileset" }, 0, 0, 1, 1, {}, Pixel.Transparent);
`, context);
assert.equal(paintedGray, 137, "tileset painting uses the grayscale brush path");

console.log("editor asset tests passed");
