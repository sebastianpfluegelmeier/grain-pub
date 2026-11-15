// The sync engine: brings the browser's animations and the files in the root
// of a remote folder (Dropbox's app folder) to the same state. It has no DOM
// and does not know Dropbox; it works on two interfaces, so tests use fakes.
//
// local (the store's `sync` object, store.js):
// - state() -> {files: [{path, name, revision}], synced: [{path, rev, revision}]}
// - read(path) -> {bytes, revision} | null
// - replace(path, bytes, {expected, rev}) -> {path, revision} | null
//   (null: the local revision is no longer `expected`; nothing was written)
// - create(name, bytes) -> {path, revision}
// - remove(path, {expected}) -> boolean
// - markSynced(path, {rev, revision}), forget(path)
// remote (dropbox.js):
// - list() -> [{tag, name, rev}]
// - download(path) -> {bytes, rev}
// - upload(path, bytes, {rev}) -> {rev} | {conflict: true}
// - remove(path, {rev})
// Remote errors carry a `kind` (see DropboxError); 'offline', 'auth' and
// 'rate_limit' affect every request, so they end the run.
//
// Per name (compared without case), with "changed" meaning different from
// what was last synced:
//   local unchanged, remote unchanged: nothing
//   local changed or new, remote unchanged or absent: upload
//   local unchanged, remote changed: download and replace
//   local absent and never synced, remote present: download
//   both changed, or local new and remote present: keep both (the remote
//     version takes the name; the local one becomes "<name> conflict")
//   local deleted, remote unchanged: delete remotely
//   local deleted, remote changed: download again (an edit wins over a delete)
//   local unchanged, remote deleted: delete locally
//   local changed, remote deleted: upload again as a new file

import {decodeAnimation} from '../anim-format.js';
import {validAnimationName, uniqueName, EXTENSION} from '../anim-model.js';

const STOPPING = new Set(['offline', 'auth', 'rate_limit']);
const CHANGED_DURING_SYNC = 'Changed here during the sync; tried again next time';

const stemOf = name => name.slice(0, -EXTENSION.length);
const remotePath = name => '/' + name;
const sameBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

// Only `.grainanim` files whose name the animation-name rule accepts take part.
export function inScope(name) {
  return typeof name === 'string' && name.toLowerCase().endsWith(EXTENSION) && validAnimationName(stemOf(name));
}

export function createSync({local, remote, decode = decodeAnimation}) {
  // Remote files that failed to decode, by key, with the rev that failed: the
  // same version is not downloaded again on every run.
  const invalid = new Map();
  let running = null;

  async function runOnce() {
    const result = {uploaded: [], downloaded: [], deletedLocal: [], deletedRemote: [], conflicts: [], skipped: [], errors: [], ignored: 0, error: null};
    let entries, state;
    try {
      entries = await remote.list();
      state = await local.state();
    } catch (error) {
      result.error = error;
      return result;
    }
    const remoteFiles = new Map(), localFiles = new Map(), synced = new Map();
    for (const entry of entries) {
      if (entry.tag === 'file' && inScope(entry.name)) remoteFiles.set(entry.name.toLowerCase(), entry);
      else result.ignored++;
    }
    for (const file of state.files) localFiles.set(file.path.toLowerCase(), file);
    for (const entry of state.synced) synced.set(entry.path.toLowerCase(), entry);
    // Names a conflict copy must not take, on either side.
    const taken = new Set([...localFiles.values()].map(file => stemOf(file.path)));
    for (const entry of remoteFiles.values()) taken.add(stemOf(entry.name));
    for (const entry of synced.values()) taken.add(stemOf(entry.path));

    const keys = [...new Set([...localFiles.keys(), ...remoteFiles.keys(), ...synced.keys()])].sort();
    for (const key of keys) {
      const mine = localFiles.get(key), theirs = remoteFiles.get(key), last = synced.get(key);
      try {
        await reconcile(mine, theirs, last);
      } catch (error) {
        if (STOPPING.has(error?.kind)) { result.error = error; break; }
        result.errors.push({path: mine?.path ?? theirs?.name ?? last?.path, message: error?.message || String(error), kind: error?.kind ?? 'error'});
      }
    }
    return result;

    async function reconcile(mine, theirs, last) {
      const localChanged = Boolean(mine) && mine.revision !== last?.revision;
      const remoteChanged = Boolean(theirs) && theirs.rev !== last?.rev;
      if (mine && theirs) {
        if (!localChanged && !remoteChanged) return;
        if (!remoteChanged) return upload(mine, last.rev);
        if (!localChanged) return download(theirs, mine);
        return keepBoth(mine, theirs);
      }
      if (mine) return last && !localChanged ? deleteLocal(mine) : upload(mine, null);
      if (theirs) return last && !remoteChanged ? deleteRemote(theirs, last) : download(theirs, null);
      // Gone on both sides: the entry has nothing left to track.
      await local.forget(last.path);
    }

    // Downloads a remote file, or answers null after reporting it skipped
    // when it is not an animation.
    async function fetchValid(theirs) {
      const key = theirs.name.toLowerCase();
      if (invalid.get(key) === theirs.rev) { result.skipped.push({path: theirs.name, reason: 'Not an animation file'});return null; }
      const file = await remote.download(remotePath(theirs.name));
      try {
        decode(file.bytes);
      } catch (error) {
        invalid.set(key, file.rev);
        result.skipped.push({path: theirs.name, reason: `Not an animation file: ${error.message}`});
        return null;
      }
      invalid.delete(key);
      return file;
    }

    async function upload(mine, rev) {
      const record = await local.read(mine.path);
      if (!record) { result.skipped.push({path: mine.path, reason: CHANGED_DURING_SYNC});return; }
      const answer = await remote.upload(remotePath(mine.path), record.bytes, {rev});
      // Handled as "both changed" on the next run, when the list shows the new rev.
      if (answer.conflict) { result.skipped.push({path: mine.path, reason: 'Changed in Dropbox during the sync; tried again next time'});return; }
      await local.markSynced(mine.path, {rev: answer.rev, revision: record.revision});
      result.uploaded.push(mine.path);
    }

    async function download(theirs, mine) {
      const file = await fetchValid(theirs);
      if (!file) return;
      const written = await local.replace(mine?.path ?? theirs.name, file.bytes, {expected: mine?.revision ?? null, rev: file.rev});
      if (!written) { result.skipped.push({path: mine?.path ?? theirs.name, reason: CHANGED_DURING_SYNC});return; }
      result.downloaded.push(written.path);
    }

    async function keepBoth(mine, theirs) {
      const file = await fetchValid(theirs);
      if (!file) return;
      const record = await local.read(mine.path);
      if (!record) { result.skipped.push({path: mine.path, reason: CHANGED_DURING_SYNC});return; }
      // The same drawing on both sides (an exported file imported on the
      // other side, say) needs no second copy.
      if (sameBytes(record.bytes, file.bytes)) { await local.markSynced(mine.path, {rev: file.rev, revision: record.revision});return; }
      const name = uniqueName(stemOf(mine.path) + ' conflict', taken);
      taken.add(name);
      const copy = await local.create(name, record.bytes);
      const written = await local.replace(mine.path, file.bytes, {expected: record.revision, rev: file.rev});
      if (!written) {
        // A save landed in between: the copy is out of date, and the name is
        // tried again next time with the newer local version.
        await local.remove(copy.path, {expected: copy.revision});
        result.skipped.push({path: mine.path, reason: CHANGED_DURING_SYNC});
        return;
      }
      result.conflicts.push({path: written.path, copy: copy.path});
      result.downloaded.push(written.path);
      try {
        await upload({path: copy.path}, null);
      } catch (error) {
        if (STOPPING.has(error?.kind)) throw error;
        result.errors.push({path: copy.path, message: error?.message || String(error), kind: error?.kind ?? 'error'});
      }
    }

    async function deleteLocal(mine) {
      if (!await local.remove(mine.path, {expected: mine.revision})) { result.skipped.push({path: mine.path, reason: CHANGED_DURING_SYNC});return; }
      result.deletedLocal.push(mine.path);
    }

    async function deleteRemote(theirs, last) {
      try {
        await remote.remove(remotePath(theirs.name), {rev: last.rev});
      } catch (error) {
        if (error?.kind !== 'not_found') throw error;
      }
      await local.forget(last.path);
      result.deletedRemote.push(theirs.name);
    }
  }

  return {
    // One run at a time: a call while a run is in progress gets that run.
    run() {
      running ??= runOnce().finally(() => { running = null; });
      return running;
    },
    get running() { return Boolean(running); },
  };
}
