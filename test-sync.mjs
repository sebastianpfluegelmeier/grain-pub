import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let source = fs.readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
const start = source.indexOf('const app = document.querySelector');
const end = source.indexOf('/* ---------- Asset creation ---------- */');
assert.ok(start > 0 && end > start);
source = source.slice(0, start) + 'const app = null;\n' + source.slice(end);
const storage = new Map([
  ['grain.assets.github.token', 'test-token'],
  ['grain.assets.github.owner', 'test-owner'],
]);
const context = vm.createContext({ ArrayBuffer, DataView, Uint8Array, Date, Math, console, setTimeout,
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
});
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);
run(`render = () => {}; state.assets = [createTileset('shared'), createTileset('local_only')];
  state.assets.forEach(asset => { asset.tiles[0][0] = Pixel.White; }); saveAssets();`);
const remote = run("encodeBinaryAsset(createTileset('shared'))");
context.GrainSync = {
  listTree: async () => ({ tree: [{ path: 'asset-editor/shared.grainasset', sha: 'remote' }] }),
  getBlob: async () => remote,
  putTree: async () => {},
};

await context.syncPull();
assert.equal(run('state.assets[0].tiles[0][0]'), 2, 'pull preserves local artwork');
assert.equal(run('assetUnsynced(state.assets[1])'), true, 'local-only asset remains unsynced');
assert.match(run('state.syncMessage'), /Kept 1/);

await context.syncPush();
assert.equal(run('state.assets.some(assetUnsynced)'), false);
await context.syncPull();
assert.equal(run('state.assets[0].tiles[0][0]'), 0, 'unchanged local asset accepts remote update');
assert.equal(run('assetUnsynced(state.assets[0])'), false);

// An edit between the request and response must be compared with the uploaded version.
context.GrainSync.putTree = async () => run('state.assets[0].tiles[0][1] = Pixel.White');
await context.syncPush();
assert.equal(run('assetUnsynced(state.assets[0])'), true);
assert.equal(run('assetUnsynced(state.assets[1])'), false);

context.GrainSync.putTree = async () => {};
await context.syncPush();
context.GrainSync.getBlob = async () => {
  run('state.assets[0].tiles[0][2] = Pixel.White');
  return remote;
};
await context.syncPull();
assert.equal(run('state.assets[0].tiles[0][2]'), 2, 'edits made during pull survive');
assert.equal(run('assetUnsynced(state.assets[0])'), true);

// A complete remote listing is authoritative for sync status, not local content.
context.GrainSync.getBlob = async () => remote;
context.GrainSync.listTree = async () => ({ tree: [] });
await context.syncPush();
assert.equal(run('state.assets.some(assetUnsynced)'), false);
await context.syncPull();
assert.equal(run('state.assets.every(assetUnsynced)'), true);
assert.equal(run('state.assets.length'), 2, 'remote deletion keeps local artwork');

// Identical pulls preserve selection and object identity; changed pulls keep the local ID.
run("state.assets = [createTileset('shared')]; state.activeAssetId = state.assets[0].id");
await context.syncPush();
const selected = run('activeAsset()');
context.GrainSync.listTree = async () => ({ tree: [{path:'asset-editor/shared.grainasset',sha:'remote'}] });
await context.syncPull();
assert.equal(run('activeAsset()'), selected);
context.GrainSync.getBlob = async () => run("(() => { const asset=createTileset('shared'); asset.tiles[0][0]=Pixel.White; return encodeBinaryAsset(asset); })()");
await context.syncPull();
assert.equal(run('activeAsset().id'), selected.id);
assert.equal(run('activeAsset().tiles[0][0]'), 2);
assert.equal(run('assetUnsynced(activeAsset())'), false);

// An incomplete inventory must not erase markers or apply a partial pull.
context.GrainSync.listTree = async () => ({ tree: [], truncated: true });
await context.syncPull();
assert.match(run('state.syncMessage'), /incomplete/);
assert.equal(run('assetUnsynced(activeAsset())'), false);

// Changing repositories invalidates the previous destination's sync markers.
storage.set('grain.assets.github.owner', 'another-owner');
assert.equal(run('state.assets.every(assetUnsynced)'), true);
console.log('Asset sync conflict, per-asset status, and in-flight edit tests passed.');
