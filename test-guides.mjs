import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Same loading approach as test-particles.mjs: run app.js in a VM context
// without its DOM startup block and exercise the pure helpers.
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
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

/* ---------- Snap targets ---------- */

const axis = (size, step, extra = {}) => ({ size, step, margin: 0, centre: false, ...extra });

assert.deepEqual(plain(context.snapEdges(axis(32, 8))), [0, 8, 16, 24, 32]);
// The tile edge is a target even when the size is not a multiple of the grid.
assert.deepEqual(plain(context.snapEdges(axis(20, 8))), [0, 8, 16, 20]);
// Even size: the centre is one edge. Odd size: both sides of the middle pixel.
assert.deepEqual(plain(context.snapEdges(axis(20, 8, { centre: true }))), [0, 8, 10, 16, 20]);
assert.deepEqual(plain(context.snapEdges(axis(21, 8, { centre: true }))), [0, 8, 10, 11, 16, 21]);
// A wrap margin extends the grid, still counted from the tile origin.
assert.deepEqual(plain(context.snapEdges(axis(16, 8, { margin: 4 }))), [0, 8, 16]);
assert.deepEqual(plain(context.snapEdges(axis(16, 4, { margin: 4 }))), [-4, 0, 4, 8, 12, 16, 20]);

/* ---------- Rectangle ---------- */

const edges = context.snapEdges(axis(32, 8));
const snappedCorner = (edge) => ({ lo: edge, hi: edge });
const freeCorner = (cell) => ({ lo: cell, hi: cell + 1 });

// Start near edge 0, pointer at 6.2: exactly one grid cell, pixels 0..7.
assert.deepEqual(plain(context.snapRectAxis(snappedCorner(0), 6.2, 6, edges)), { from: 0, to: 7, mark: 8 });
// A click without a drag still fills a whole cell on the pointer's side.
assert.deepEqual(plain(context.snapRectAxis(snappedCorner(8), 8.4, 8, edges)), { from: 8, to: 15, mark: 16 });
assert.deepEqual(plain(context.snapRectAxis(snappedCorner(8), 7.6, 7, edges)), { from: 7, to: 0, mark: 0 });
// Dragging backwards covers the same cells with from and to swapped.
assert.deepEqual(plain(context.snapRectAxis(snappedCorner(24), 9.1, 9, edges)), { from: 23, to: 8, mark: 8 });
// Alt during the drag: the end follows the pointer cell, the start stays snapped.
assert.deepEqual(plain(context.snapRectAxis(snappedCorner(8), 13.4, 13, null)), { from: 8, to: 13, mark: null });
assert.deepEqual(plain(context.snapRectAxis(snappedCorner(8), 5.4, 5, null)), { from: 7, to: 5, mark: null });
// Alt at the start: a free start cell is always included.
assert.deepEqual(plain(context.snapRectAxis(freeCorner(5), 14.9, 14, edges)), { from: 5, to: 15, mark: 16 });
assert.deepEqual(plain(context.snapRectAxis(freeCorner(5), 1.2, 1, edges)), { from: 5, to: 0, mark: 0 });
assert.deepEqual(plain(context.snapRectAxis(freeCorner(5), 5.2, 5, null)), { from: 5, to: 5, mark: null });

/* ---------- Line ---------- */

assert.deepEqual(plain(context.snapLinePixel(7.2, axis(32, 8))), { pixel: 8, mark: 8 });
assert.deepEqual(plain(context.snapLinePixel(2.1, axis(32, 8))), { pixel: 0, mark: 0 });
// The far tile edge maps to the last pixel.
assert.deepEqual(plain(context.snapLinePixel(31.5, axis(32, 8))), { pixel: 31, mark: 32 });
// Odd size with centre lines: the middle pixel, marked at its centre.
assert.deepEqual(plain(context.snapLinePixel(10.3, axis(21, 8, { centre: true }))), { pixel: 10, mark: 10.5 });
assert.deepEqual(plain(context.snapLinePixel(10.3, axis(20, 8, { centre: true }))), { pixel: 10, mark: 10 });

const min = { x: 0, y: 0 };
const max = { x: 31, y: 31 };
const start = { x: 8, y: 8 };
// Mostly horizontal and mostly vertical drags lose the minor axis.
assert.deepEqual(plain(context.constrainLineEnd(start, { x: 24, y: 10 }, 16, 2, min, max)), { x: 24, y: 8 });
assert.deepEqual(plain(context.constrainLineEnd(start, { x: 9, y: 0 }, 1, -8, min, max)), { x: 8, y: 0 });
// Diagonals take the longer snapped side, in all four directions.
assert.deepEqual(plain(context.constrainLineEnd(start, { x: 24, y: 16 }, 14, 11, min, max)), { x: 24, y: 24 });
assert.deepEqual(plain(context.constrainLineEnd(start, { x: 0, y: 16 }, -7, 9, min, max)), { x: 0, y: 16 });
assert.deepEqual(plain(context.constrainLineEnd({ x: 16, y: 16 }, { x: 8, y: 8 }, -8, -7, min, max)), { x: 8, y: 8 });
// A diagonal stops at the canvas bounds.
assert.deepEqual(plain(context.constrainLineEnd({ x: 24, y: 8 }, { x: 31, y: 0 }, 9, -9, min, max)), { x: 31, y: 1 });

/* ---------- Settings and export ---------- */

assert.deepEqual(plain(context.normalizeGuides(null)), {
  grid: false,
  gridW: 8,
  gridH: 8,
  centre: false,
  snap: false,
  pin: null,
  pinOn: true,
  pinOpacity: 35,
});
assert.deepEqual(
  plain(context.normalizeGuides({ gridW: 0, gridH: 9999, pin: { frame: 2 }, pinOpacity: 400 })),
  { grid: false, gridW: 2, gridH: 256, centre: false, snap: false, pin: null, pinOn: true, pinOpacity: 90 },
);

run(`
  state.assets = [createAnimation("walk", true), createParticles("sparks", true)];
  state.activeAssetId = state.assets[0].id;
  state.activeTile = 1;
`);
const before = {
  anim: [...run("encodeBinaryAsset(state.assets[0])")],
  particles: [...run("encodeBinaryAsset(state.assets[1])")],
  stored: run("saveAssets(); localStorage.getItem(STORAGE_KEY)"),
};
run(`
  setGuides({ grid: true, gridW: 4, gridH: 12, centre: true, snap: true, pinOpacity: 60 });
  setGuides({ pin: activePinRef(state.assets[0]) });
`);
assert.deepEqual([...run("encodeBinaryAsset(state.assets[0])")], before.anim, "guides changed exported bytes");
assert.deepEqual([...run("encodeBinaryAsset(state.assets[1])")], before.particles, "guides changed exported bytes");
assert.equal(run("saveAssets(); localStorage.getItem(STORAGE_KEY)"), before.stored, "guides leaked into stored assets");

// Settings survive a reload through their own storage key.
assert.deepEqual(plain(run("loadGuides()")), plain(run("state.guides")));
assert.equal(run("state.guides.pin.frame"), 1);

/* ---------- Pinned frame ---------- */

// The pin is a reference: it resolves to the live frame array.
assert.equal(run("pinnedFrame().cells === state.assets[0].frames[1]"), true);
assert.equal(run("pinIsActiveFrame(state.assets[0])"), true);

// Frame list edits keep the pin on the same frame.
run("movePinnedFrame(state.assets[0], (frame) => (frame > 0 ? frame + 1 : frame))");
assert.equal(run("state.guides.pin.frame"), 2);
run("movePinnedFrame(state.assets[0], (frame) => (frame === 2 ? null : frame))");
assert.equal(run("state.guides.pin"), null);

// A pin into another asset is untouched by edits to the active one.
run(`
  state.activeAssetId = state.assets[1].id;
  state.activeParticle = 1;
  state.activeTile = 3;
  setGuides({ pin: activePinRef(state.assets[1]) });
  state.activeAssetId = state.assets[0].id;
  state.activeTile = 0;
  movePinnedFrame(state.assets[0], () => null);
`);
assert.deepEqual(plain(run("state.guides.pin")), {
  assetId: run("state.assets[1].id"),
  particleId: run("state.assets[1].particles[1].id"),
  frame: 3,
});
assert.deepEqual(
  plain(run("(({ width, height, particleIndex }) => ({ width, height, particleIndex }))(pinnedFrame())")),
  { width: 13, height: 7, particleIndex: 1 },
);

// Deleting the particle, the frame or the asset clears the pin.
run("state.assets[1].particles[1].frames.length = 3; prunePinnedFrame();");
assert.equal(run("state.guides.pin"), null);
run(`
  state.activeAssetId = state.assets[1].id;
  state.activeParticle = 1;
  state.activeTile = 0;
  setGuides({ pin: activePinRef(state.assets[1]) });
  state.assets[1].particles.splice(1, 1);
  prunePinnedFrame();
`);
assert.equal(run("state.guides.pin"), null);
run(`
  state.activeAssetId = state.assets[0].id;
  setGuides({ pin: activePinRef(state.assets[0]) });
  state.assets = state.assets.filter((asset) => asset.id !== state.activeAssetId);
  prunePinnedFrame();
`);
assert.equal(run("state.guides.pin"), null);
assert.equal(JSON.parse(storage.get("grain.assets.guides.v1")).pin, null);

console.log("guide, snapping and pinned frame tests passed");
