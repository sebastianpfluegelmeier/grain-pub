// The standalone animator keeps its animations in the browser. `createStore`
// answers the animation editor's `api(path, body, raw, init)` calls with the
// request and response shapes, errors and 409 conflicts of the Studio host
// (/api/animation* in studio/server.py), over a backend that holds records.
//
// A backend has three operations, so the contract can be tested without a
// browser (`createMemoryBackend`) and run on IndexedDB in one
// (`createIndexedDbBackend`):
// - list() -> [meta]
// - read(path) -> {meta, bytes} | undefined
// - apply(paths, decide): reads the records of `paths`, calls
//   `decide(current: Map<path, {meta, bytes} | undefined>)` synchronously,
//   which returns {writes: [{path, record | null}], result} or throws, and
//   applies the writes atomically. Two tabs share the IndexedDB database, so
//   the revision check and the write must happen in one transaction.
//
// `meta` is {path, name, revision, info, modified}; `info` holds the details
// the list shows, from decoding the file when it was saved.

import {decodeAnimation} from '../anim-format.js';
import {checkAnimationName, validAnimationName, uniqueName, EXTENSION} from '../anim-model.js';

// One fixed folder.
export const FOLDER = {id: 'browser', name: 'this browser'};
const DB_NAME = 'tinygrain-animator', DB_VERSION = 1;

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
  return {api};
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
  const records = new Map();
  const clone = record => record && {meta: structuredClone(record.meta), bytes: record.bytes.slice()};
  return {
    records,
    async list() { return [...records.values()].map(record => structuredClone(record.meta)); },
    async read(path) { return clone(records.get(path)); },
    async apply(paths, decide) {
      const current = new Map(paths.map(path => [path, clone(records.get(path))]));
      const {writes = [], result} = decide(current);
      for (const {path, record} of writes) {
        if (record) records.set(path, clone(record));else records.delete(path);
      }
      return result;
    },
  };
}

// Two object stores keyed by path: `meta` for the list, `files` for the
// bytes, so listing never loads the drawings.
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
    async apply(paths, decide) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['meta', 'files'], 'readwrite');
        const metas = transaction.objectStore('meta'), files = transaction.objectStore('files');
        const current = new Map();
        let pending = paths.length * 2, outcome = null, refused = null;
        // `decide` runs inside a request callback, so the transaction is
        // still active for the writes.
        const decideNow = () => {
          try {
            outcome = decide(current);
          } catch (error) {
            refused = error;
            transaction.abort();
            return;
          }
          for (const {path, record} of outcome.writes ?? []) {
            if (record) { metas.put(record.meta);files.put(record.bytes, path); } else { metas.delete(path);files.delete(path); }
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
        if (!paths.length) decideNow();
        transaction.oncomplete = () => resolve(outcome.result);
        transaction.onabort = () => reject(refused ?? transaction.error ?? new Error('Saving in this browser failed.'));
      });
    },
  };
}
