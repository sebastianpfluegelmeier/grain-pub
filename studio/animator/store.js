// The standalone animator keeps its animations in the browser. `createStore`
// answers the animation editor's `api(path, body, raw, init)` calls with the
// request and response shapes, errors and 409 conflicts of the Studio host
// (/api/animation* in studio/server.py), over a backend that holds records.
//
// A backend has four operations, so the contract can be tested without a
// browser (`createMemoryBackend`) and run on IndexedDB in one
// (`createIndexedDbBackend`):
// - list() -> [meta]
// - read(path) -> {meta, bytes} | undefined
// - listSync() -> [sync entry]
// - apply(paths, decide, syncKeys = []): reads the records of `paths` and
//   the sync entries of `syncKeys`, calls `decide(current: Map<path,
//   {meta, bytes} | undefined>, synced: Map<key, entry | undefined>)`
//   synchronously, which returns {writes: [{path, record | null}],
//   syncWrites: [{key, entry | null}], result} or throws, and applies the
//   writes atomically. Two tabs share the IndexedDB database, so the
//   revision check and the write must happen in one transaction.
//
// `meta` is {path, name, revision, info, modified}; `info` holds the details
// the list shows, from decoding the file when it was saved.
//
// A sync entry, {key, path, rev, revision}, records what was last synced
// with Dropbox for one name: the Dropbox `rev` and the local revision that
// matched it. `key` is the path in lower case, because Dropbox and the store
// both compare names without case. Entries are kept apart from the records,
// so deleting or renaming an animation leaves its entry behind as a
// tombstone, and the editor's requests never touch them.

import {decodeAnimation} from '../anim-format.js';
import {checkAnimationName, validAnimationName, uniqueName, EXTENSION} from '../anim-model.js';

// One fixed folder.
export const FOLDER = {id: 'browser', name: 'this browser'};
const DB_NAME = 'tinygrain-animator', DB_VERSION = 2;

const failure = (status, message) => Object.assign(new Error(message), {status});
const stemOf = path => path.slice(0, -EXTENSION.length);

// A revision only has to change with every write. crypto.subtle (for a hash)
// is missing on plain-http origins such as a Mac's LAN address, so it is a
// random id; getRandomValues works on any origin.
export function newRevision() {
  const words = new Uint32Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(words);
  else for (let index = 0; index < words.length; index++) words[index] = Math.floor(Math.random() * 0x100000000);
  return [...words].map(word => word.toString(16).padStart(8, '0')).join('');
}

function infoOf(doc) {
  return {format: doc.format, width: doc.width, height: doc.height, frames: doc.pixels.size, fps: doc.fps,
    nodes: doc.nodes.map(({id, name}) => ({id, name}))};
}
function itemOf(meta) {
  return {folder: FOLDER.id, library: FOLDER.name, path: meta.path, name: meta.name, revision: meta.revision, ...meta.info};
}

export function createStore(backend, {now = () => Date.now()} = {}) {
  function checkFolder(folder) {
    if (folder !== FOLDER.id) throw failure(400, `Unknown folder ${folder}`);
  }
  // Animations live in one flat folder; a path is "<name>.grainanim".
  function checkPath(path) {
    if (typeof path !== 'string' || !path.toLowerCase().endsWith(EXTENSION) || path.includes('/')) {
      throw failure(400, 'Animation files must end in .grainanim');
    }
  }
  function checkName(name) {
    try { return checkAnimationName(name); } catch (error) { throw failure(400, error.message); }
  }
  // Names are compared without case, as on the Mac's file system, so an
  // export never clashes when it lands in a folder there.
  const clash = (current, path) => [...current.keys()].some(key => key !== path && key.toLowerCase() === path.toLowerCase() && current.get(key));
  const missing = () => failure(400, 'Media file is outside the selected folder or no longer exists');

  async function list() {
    const metas = await backend.list();
    metas.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return {items: metas.map(itemOf), folders: [{...FOLDER}]};
  }
  async function read(folder, path) {
    checkFolder(folder);checkPath(path);
    const record = await backend.read(path);
    if (!record) throw missing();
    return {bytes: record.bytes.slice(), revision: record.meta.revision};
  }
  async function write(folder, path, expected, body) {
    if (typeof expected !== 'string' || !expected) throw failure(400, 'Saving an animation needs the revision it was loaded at, or new');
    checkFolder(folder);checkPath(path);
    if (!(body instanceof Uint8Array)) throw failure(400, 'Expected the file as bytes');
    let doc;
    try { doc = decodeAnimation(body); } catch (error) { throw failure(400, error.message); }
    if (expected === 'new') checkName(stemOf(path));
    const bytes = body.slice(), revision = newRevision();
    // Every key the case-insensitive check needs is read in the transaction.
    const keys = (await backend.list()).map(meta => meta.path).filter(key => key.toLowerCase() === path.toLowerCase());
    return backend.apply([...new Set([path, ...keys])], current => {
      const existing = current.get(path);
      if (expected === 'new') {
        if (existing || clash(current, path)) throw failure(409, `An animation named ${stemOf(path)} already exists in this folder`);
      } else if (!existing) {
        throw failure(409, 'Animation was deleted or moved on disk; save it as a new file or reload the list.');
      } else if (existing.meta.revision !== expected) {
        throw failure(409, 'Animation changed on disk; reload it or overwrite it.');
      }
      const name = existing?.meta.name ?? stemOf(path);
      return {writes: [{path, record: {meta: {path, name, revision, info: infoOf(doc), modified: now()}, bytes}}], result: {revision}};
    });
  }
  // Rename and duplicate: the target is "<name>.grainanim" next to the source.
  async function copy(body, {keep}) {
    const {folder, path, name} = body ?? {};
    checkFolder(folder);checkPath(path);
    if (typeof name !== 'string') throw failure(400, 'Expected an animation name');
    const stem = name.endsWith(EXTENSION) ? stemOf(name) : name;
    checkName(stem);
    const target = stem + EXTENSION;
    const keys = (await backend.list()).map(meta => meta.path).filter(key => key.toLowerCase() === target.toLowerCase());
    return backend.apply([...new Set([path, target, ...keys])], current => {
      const source = current.get(path);
      if (!source) throw missing();
      // A rename that only changes case names the same file and is allowed.
      const sameFile = !keep && target.toLowerCase() === path.toLowerCase();
      if (!sameFile && (current.get(target) || clash(current, target))) throw failure(400, `An animation named ${stem} already exists in this folder`);
      if (!keep && target === path) return {writes: [], result: itemOf(source.meta)};
      // A rename keeps the revision, as the host's does (the bytes are unchanged);
      // a copy is a new file.
      const meta = {...source.meta, path: target, name: stem, revision: keep ? newRevision() : source.meta.revision, modified: now()};
      const writes = [{path: target, record: {meta, bytes: source.bytes.slice()}}];
      if (!keep) writes.push({path, record: null});
      return {writes, result: itemOf(meta)};
    });
  }
  // Deleted outright: there is no trash to restore from. The confirmation
  // says so, and Export keeps a copy outside the browser.
  async function remove(body) {
    const {folder, path} = body ?? {};
    checkFolder(folder);checkPath(path);
    return backend.apply([path], current => {
      if (!current.get(path)) throw missing();
      return {writes: [{path, record: null}], result: {deleted: null}};
    });
  }

  // The animation editor's api(): see createAnimationView in anim-view.js.
  async function api(request, body, raw = false) {
    const [endpoint, search = ''] = String(request).split('?');
    const params = Object.fromEntries(new URLSearchParams(search));
    if (endpoint === 'animations' && body === undefined) return list();
    if (endpoint === 'animation') {
      for (const name of body === undefined ? ['folder', 'path'] : ['folder', 'path', 'revision']) {
        if (!(name in params)) throw failure(400, `Missing ${name} parameter`);
      }
      if (body === undefined) return read(params.folder, params.path);
      if (!raw) throw failure(400, 'Expected the file as bytes');
      return write(params.folder, params.path, params.revision, body);
    }
    if (endpoint === 'animation-rename' && body !== undefined) return copy(body, {keep: false});
    if (endpoint === 'animation-duplicate' && body !== undefined) return copy(body, {keep: true});
    if (endpoint === 'animation-delete' && body !== undefined) return remove(body);
    throw failure(404, `Unknown request ${endpoint}`);
  }

  // The local side of the sync engine (sync.js). Replace and remove are
  // compare-and-swap operations on the local revision, so a save that lands
  // while a sync runs is never overwritten; they answer null or false
  // instead of writing.
  const syncKey = path => path.toLowerCase();
  const casePaths = async path => (await backend.list()).map(meta => meta.path).filter(key => key.toLowerCase() === syncKey(path));
  const sync = {
    async state() {
      const [metas, entries] = await Promise.all([backend.list(), backend.listSync()]);
      return {files: metas.map(({path, name, revision}) => ({path, name, revision})),
        synced: entries.map(({path, rev, revision}) => ({path, rev, revision}))};
    },
    async read(path) {
      const record = await backend.read(path);
      return record ? {bytes: record.bytes.slice(), revision: record.meta.revision} : null;
    },
    // Writes `bytes` as the animation of this name (in whatever case it has
    // here, or as `path` when it is new) if its revision is still `expected`
    // (null: the name must be free), and records `rev` as synced.
    async replace(path, bytes, {expected, rev}) {
      checkPath(path);
      let doc;
      try { doc = decodeAnimation(bytes); } catch (error) { throw failure(400, error.message); }
      if (expected === null) checkName(stemOf(path));
      const copy = bytes.slice(), revision = newRevision(), key = syncKey(path);
      return backend.apply([...new Set([path, ...await casePaths(path)])], current => {
        const found = [...current.keys()].find(candidate => current.get(candidate));
        const existing = found && current.get(found);
        if ((existing?.meta.revision ?? null) !== expected) return {result: null};
        const target = found ?? path, name = existing?.meta.name ?? stemOf(path);
        return {
          writes: [{path: target, record: {meta: {path: target, name, revision, info: infoOf(doc), modified: now()}, bytes: copy}}],
          syncWrites: [{key, entry: {key, path: target, rev, revision}}],
          result: {path: target, revision},
        };
      }, [key]);
    },
    // A new animation (a conflict copy). Fails with 409 when the name is taken.
    async create(name, bytes) {
      const path = name + EXTENSION;
      const {revision} = await write(FOLDER.id, path, 'new', bytes);
      return {path, revision};
    },
    // Deletes the animation if its revision is still `expected`, with its entry.
    async remove(path, {expected}) {
      checkPath(path);
      return backend.apply([path], current => {
        if (current.get(path)?.meta.revision !== expected) return {result: false};
        return {writes: [{path, record: null}], syncWrites: [{key: syncKey(path), entry: null}], result: true};
      }, [syncKey(path)]);
    },
    async markSynced(path, {rev, revision}) {
      const key = syncKey(path);
      await backend.apply([], () => ({syncWrites: [{key, entry: {key, path, rev, revision}}]}), [key]);
    },
    async forget(path) {
      const key = syncKey(path);
      await backend.apply([], () => ({syncWrites: [{key, entry: null}]}), [key]);
    },
    // Disconnecting forgets every entry: another account, or the same one
    // later, starts from "never synced", which keeps both sides' files.
    async forgetAll() {
      const keys = (await backend.listSync()).map(entry => entry.key);
      await backend.apply([], () => ({syncWrites: keys.map(key => ({key, entry: null}))}), keys);
    },
  };
  return {api, sync};
}

// A .grainanim file from outside: checked with decodeAnimation, saved under
// its own name or, when that is taken or not a valid name, a free one.
// Returns the new item.
export async function importAnimation(api, fileName, bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try { decodeAnimation(data); } catch (error) { throw new Error(`${fileName} is not an animation file: ${error.message}`); }
  const base = importName(fileName);
  for (let attempt = 0; attempt < 8; attempt++) {
    const {items} = await api('animations');
    const name = uniqueName(base, items.map(item => item.name));
    const path = name + EXTENSION;
    try {
      await api('animation?' + new URLSearchParams({folder: FOLDER.id, path, revision: 'new'}), data, true);
    } catch (error) {
      // Another tab took the name in the meantime.
      if (error.status === 409) continue;
      throw error;
    }
    return (await api('animations')).items.find(item => item.path === path);
  }
  throw new Error(`Could not find a free name for ${fileName}`);
}

// The file name without its extension, with the characters a name cannot
// hold replaced by spaces.
export function importName(fileName) {
  let name = String(fileName).split(/[\\/]/).at(-1);
  if (name.toLowerCase().endsWith(EXTENSION)) name = name.slice(0, -EXTENSION.length);
  name = name.replace(/[^A-Za-z0-9 _-]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 64).trim();
  return validAnimationName(name) ? name : 'animation';
}

// Copies on the way in and out, as IndexedDB's structured clone does.
export function createMemoryBackend() {
  const records = new Map(), synced = new Map();
  const clone = record => record && {meta: structuredClone(record.meta), bytes: record.bytes.slice()};
  return {
    records,
    synced,
    async list() { return [...records.values()].map(record => structuredClone(record.meta)); },
    async read(path) { return clone(records.get(path)); },
    async listSync() { return [...synced.values()].map(entry => structuredClone(entry)); },
    async apply(paths, decide, syncKeys = []) {
      const current = new Map(paths.map(path => [path, clone(records.get(path))]));
      const entries = new Map(syncKeys.map(key => [key, synced.has(key) ? structuredClone(synced.get(key)) : undefined]));
      const {writes = [], syncWrites = [], result} = decide(current, entries);
      for (const {path, record} of writes) {
        if (record) records.set(path, clone(record));else records.delete(path);
      }
      for (const {key, entry} of syncWrites) {
        if (entry) synced.set(key, structuredClone(entry));else synced.delete(key);
      }
      return result;
    },
  };
}

// Two object stores keyed by path: `meta` for the list, `files` for the
// bytes, so listing never loads the drawings. A third, `sync`, holds the
// sync entries by key (version 2 adds it to a version 1 database).
export function createIndexedDbBackend({name = DB_NAME, indexedDB = globalThis.indexedDB} = {}) {
  let opening = null;
  function open() {
    opening ??= new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new Error('This browser cannot store animations (IndexedDB is not available).'));return; }
      const request = indexedDB.open(name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', {keyPath: 'path'});
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if (!db.objectStoreNames.contains('sync')) db.createObjectStore('sync', {keyPath: 'key'});
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab upgrading the database closes this connection.
        db.onversionchange = () => { db.close();opening = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close the animator in other tabs and reload.'));
    });
    opening.catch(() => { opening = null; });
    return opening;
  }
  const done = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
  return {
    async list() {
      const db = await open();
      return done(db.transaction('meta', 'readonly').objectStore('meta').getAll());
    },
    async read(path) {
      const db = await open(), transaction = db.transaction(['meta', 'files'], 'readonly');
      const [meta, bytes] = await Promise.all([done(transaction.objectStore('meta').get(path)), done(transaction.objectStore('files').get(path))]);
      return meta && bytes ? {meta, bytes} : undefined;
    },
    async listSync() {
      const db = await open();
      return done(db.transaction('sync', 'readonly').objectStore('sync').getAll());
    },
    async apply(paths, decide, syncKeys = []) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['meta', 'files', 'sync'], 'readwrite');
        const metas = transaction.objectStore('meta'), files = transaction.objectStore('files'), sync = transaction.objectStore('sync');
        const current = new Map(), entries = new Map();
        let pending = paths.length * 2 + syncKeys.length, outcome = null, refused = null;
        // `decide` runs inside a request callback, so the transaction is
        // still active for the writes.
        const decideNow = () => {
          try {
            outcome = decide(current, entries);
          } catch (error) {
            refused = error;
            transaction.abort();
            return;
          }
          for (const {path, record} of outcome.writes ?? []) {
            if (record) { metas.put(record.meta);files.put(record.bytes, path); } else { metas.delete(path);files.delete(path); }
          }
          for (const {key, entry} of outcome.syncWrites ?? []) {
            if (entry) sync.put(entry);else sync.delete(key);
          }
        };
        const found = {};
        for (const path of paths) {
          found[path] = {};
          for (const [store, key] of [[metas, 'meta'], [files, 'bytes']]) {
            const request = store.get(path);
            request.onsuccess = () => {
              found[path][key] = request.result;
              if (found[path].meta !== undefined && found[path].bytes !== undefined) current.set(path, {meta: found[path].meta, bytes: found[path].bytes});
              if (--pending === 0) decideNow();
            };
          }
        }
        for (const key of syncKeys) {
          const request = sync.get(key);
          request.onsuccess = () => {
            entries.set(key, request.result);
            if (--pending === 0) decideNow();
          };
        }
        if (pending === 0) decideNow();
        transaction.oncomplete = () => resolve(outcome.result);
        transaction.onabort = () => reject(refused ?? transaction.error ?? new Error('Saving in this browser failed.'));
      });
    },
  };
}
