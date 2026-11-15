// The standalone animator: TinyGrain Studio's animation editor on a page of
// its own, for drawing on an iPad. The editor (../anim-view.js and the
// modules it loads) is used as it is; this module adds the header, the
// browser store, import and export of .grainanim files, the note about
// Safari's storage rules and, when config.js names a Dropbox app, sync with
// that app's Dropbox folder. Without an app key nothing is sent over the
// network.

import {createAnimationView} from '../anim-view.js';
import {EXTENSION} from '../anim-model.js';
import {setupTheme} from '../appearance.js';
import {icon} from '../icons.js';
import {createStore, importAnimation} from './store.js';
import {DROPBOX_APP_KEY, DROPBOX_APP_NAME} from './config.js';
import {createDropboxClient} from './dropbox.js';
import {createSync} from './sync.js';

const NOTE_KEY = 'animator-storage-note-dismissed';
const LAST_KEY = 'animator-last-opened';
const DELETE_NOTE = 'It is removed from this browser and cannot be restored.';
// A save is synced after this pause, so a burst of autosaves is one upload.
const SYNC_AFTER_SAVE = 2000;
const SYNC_INTERVAL = 60_000;
const SYNC_MAX_BACKOFF = 15 * 60_000;
const query = values => new URLSearchParams(values).toString();
const text = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const nameOf = path => path.toLowerCase().endsWith(EXTENSION) ? path.slice(0, -EXTENSION.length) : path;

// `root` receives the page (the body in index.html). `backend` is a store
// backend from store.js. `appKey` turns Dropbox sync on (config.js). The
// other arguments stand in for browser objects in tests.
export async function createAnimator({root, backend, storage = globalThis.localStorage, navigator: nav = globalThis.navigator,
  window: win = globalThis.window, clock, appKey = DROPBOX_APP_KEY, appName = DROPBOX_APP_NAME,
  fetch: fetchFn = globalThis.fetch?.bind(globalThis), crypto = globalThis.crypto, now = () => Date.now()} = {}) {
  const doc = root.ownerDocument;
  root.innerHTML = `
    <header class="app-header animator-header">
      <div class="brand">tinygrain <span>animator</span></div>
      <span id="save-status" role="status" data-state="saved" title="Saved in this browser">Saved in this browser</span>
      <button class="animator-import" data-import title="Add .grainanim files from this device">Import</button>
      <input type="file" data-import-file multiple hidden aria-hidden="true" tabindex="-1">
      ${appKey ? `<button class="animator-sync" data-sync data-state="off" aria-haspopup="dialog">${icon('repeat')}<span data-sync-status>Sync off</span></button>` : ''}
      <button id="theme-toggle" aria-label="Light mode" aria-pressed="false" title="Switch to light mode">${icon('sun').replace('class="ui-icon"', 'class="ui-icon sun-icon"')}${icon('moon').replace('class="ui-icon"', 'class="ui-icon moon-icon"')}</button>
    </header>
    <main class="animator-main">
      <section id="animation-view" aria-label="Animations"></section>
      <div id="error" role="alert" hidden><span></span><button aria-label="Dismiss error" data-dismiss-error>${icon('x')}</button></div>
    </main>
    ${appKey ? `<dialog class="animator-sync-dialog" data-sync-dialog aria-labelledby="animator-sync-title">
      <div class="animator-sync-head"><h2 id="animator-sync-title">Dropbox sync</h2><button data-sync-close aria-label="Close" title="Close">${icon('x')}</button></div>
      <p>Animations are copied to ${appName ? `<span class="animator-sync-value">Apps/${text(appName)}</span>` : 'this app\u2019s own folder under <span class="animator-sync-value">Apps</span>'} in your Dropbox and kept the same as this browser's while this page is open. Studio on a Mac reads them from that folder.</p>
      <div data-sync-connected>
        <p data-sync-detail></p>
        <ul class="animator-sync-notes" data-sync-notes></ul>
      </div>
      <div data-sync-signin>
        <p>Connect opens Dropbox in a new tab. Allow access there, then paste the code Dropbox shows.</p>
        <a class="animator-sync-connect" data-sync-connect target="_blank" rel="noopener" aria-disabled="true">Connect</a>
        <form class="animator-sync-code" data-sync-code-form>
          <label>Code from Dropbox<input name="code" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" required></label>
          <button class="primary">Sign in</button>
        </form>
      </div>
      <p class="field-error" role="alert" data-sync-error></p>
      <div class="dialog-actions" data-sync-actions><button data-sync-disconnect>Disconnect</button><button class="primary" data-sync-now>Sync now</button></div>
    </dialog>` : ''}`;
  const $ = selector => root.querySelector(selector);
  const store = createStore(backend);
  let sync = null;
  // Every change the editor makes goes through `api`; a successful one
  // schedules a sync.
  const api = (request, body, raw, init) => {
    const answer = store.api(request, body, raw, init);
    if (body !== undefined) answer.then(() => sync?.changed(), () => {});
    return answer;
  };

  function showError(error) {
    $('#error span').textContent = error?.message || String(error);
    $('#error').hidden = false;
  }
  $('[data-dismiss-error]').onclick = () => { $('#error').hidden = true; };
  function showStatus({dirty, saving, error}) {
    const status = $('#save-status'), state = error ? 'error' : dirty || saving ? 'saving' : 'saved';
    const label = error ? `Not saved: ${error}` : state === 'saving' ? 'Saving' : 'Saved in this browser';
    status.dataset.state = state;status.title = label;status.textContent = label;
  }

  // Export: the share sheet on a touch screen (Save to Files, AirDrop), a
  // download elsewhere and wherever sharing files is not available (it
  // needs https).
  async function exportItem(item) {
    const {bytes} = await store.api('animation?' + query({folder: item.folder, path: item.path}));
    const file = new File([bytes], item.name + EXTENSION, {type: 'application/octet-stream'});
    const touch = win?.matchMedia?.('(pointer: coarse)').matches;
    if (touch && nav?.canShare?.({files: [file]})) {
      try {
        await nav.share({files: [file]});
        return 'shared';
      } catch (error) {
        if (error?.name === 'AbortError') return 'cancelled';
        // Safari refuses a share that is no longer close to the tap; the download still works.
      }
    }
    const url = URL.createObjectURL(file), link = doc.createElement('a');
    link.href = url;link.download = file.name;link.hidden = true;
    root.append(link);link.click();link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'downloaded';
  }

  const view = createAnimationView({parent: $('#animation-view'), api, onError: showError, onStatus: showStatus,
    onExport: exportItem, deleteNote: DELETE_NOTE, collapsible: true, storage, clock});

  // Import: any file can be picked, because iOS greys out files whose
  // extension it does not know when `accept` names one. Each file is checked
  // with decodeAnimation, and the last one is opened.
  async function importFiles(files) {
    let last = null;
    const failures = [];
    for (const file of files) {
      try {
        last = await importAnimation(api, file.name, new Uint8Array(await file.arrayBuffer()));
      } catch (error) {
        failures.push(error.message || String(error));
      }
    }
    await view.refresh();
    const item = last && view.items.find(entry => entry.path === last.path);
    if (item) await view.open(item);
    if (failures.length) throw new Error(failures.join('\n'));
    return last;
  }
  const picker = $('[data-import-file]');
  $('[data-import]').onclick = () => picker.click();
  picker.onchange = () => {
    const files = [...picker.files];
    picker.value = '';
    importFiles(files).catch(showError);
  };

  // The open animation comes back after a reload or a relaunch.
  view.session.subscribe(({reason, asset}) => {
    if (!['open', 'close', 'rename'].includes(reason)) return;
    try { if (asset) storage?.setItem(LAST_KEY, asset.path);else storage?.removeItem(LAST_KEY); } catch {}
  });

  // Keys pressed while focus is outside the view (on the page itself) still
  // reach the editor, as Studio's global handler passes them on.
  const onKey = event => { if (!$('#animation-view').contains(event.target)) view.handleKey(event); };
  doc.addEventListener('keydown', onKey);
  // Safari zooms the page with a pinch even where touch-action forbids it;
  // the canvas and the graph handle their own pinches through pointer events.
  const noPageZoom = event => event.preventDefault();
  doc.addEventListener('gesturestart', noPageZoom);
  // Switching apps on an iPad hides the page and may end it without an unload.
  const onVisibility = () => { if (doc.visibilityState === 'hidden') view.flush().catch(() => {}); };
  doc.addEventListener('visibilitychange', onVisibility);

  setupTheme(doc, storage ?? {getItem: () => null, setItem() {}}, null, showError);
  if (appKey) sync = setupSync();
  try {
    await view.show();
    const last = storage?.getItem(LAST_KEY), item = last && view.items.find(entry => entry.path === last);
    if (item) await view.open(item);
  } catch (error) { showError(error); }
  await storageNote();
  sync?.start();

  // Safari may delete a site's storage after 7 days without a visit; an app
  // added to the Home Screen is exempt, and persist() asks for the same.
  // The note shows until it is dismissed, unless the page runs as an app or
  // the storage is already persistent.
  async function storageNote() {
    let persisted = false;
    try { persisted = Boolean(await nav?.storage?.persist?.()); } catch {}
    const installed = Boolean(win?.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone);
    let dismissed = false;
    try { dismissed = storage?.getItem(NOTE_KEY) === 'true'; } catch {}
    if (persisted || installed || dismissed) return;
    const note = doc.createElement('aside');
    note.className = 'animator-note';
    note.setAttribute('aria-label', 'Storage');
    note.innerHTML = sync?.connected
      ? `<p>Animations are kept in this browser and copied to Dropbox. Safari deletes this browser's copy after 7 days without a visit unless the page is added to the Home Screen.</p>`
      : `<p>Animations are kept in this browser only. Safari deletes them after 7 days without a visit unless the page is added to the Home Screen; export the ones that matter.</p>`;
    note.innerHTML += `
      <button data-dismiss-note>Got it</button>`;
    note.querySelector('[data-dismiss-note]').onclick = () => {
      note.remove();
      try { storage?.setItem(NOTE_KEY, 'true'); } catch {}
    };
    view.regions.list.append(note);
  }

  // Dropbox sync: the header control, its dialog and when runs happen. The
  // engine (sync.js) runs on the store and the client; this part decides
  // when, shows the outcome and keeps the open animation in step.
  function setupSync() {
    const client = createDropboxClient({appKey, fetch: fetchFn, storage, crypto, now});
    const button = $('[data-sync]'), label = $('[data-sync-status]'), dialog = $('[data-sync-dialog]');
    const link = $('[data-sync-connect]'), codeForm = $('[data-sync-code-form]'), errorLine = $('[data-sync-error]');
    // The open animation is left alone while it has edits that are not in
    // the store yet (or a stroke in progress): the engine sees the refusal
    // as a save landing during the run and tries again next time, when the
    // edits are saved and the conflict rule keeps both versions.
    const busy = path => {
      const asset = view.session.asset;
      if (!asset || asset.path.toLowerCase() !== path.toLowerCase()) return false;
      const status = view.status();
      return status.dirty || status.saving || Boolean(status.conflict) || Boolean(view.canvas.drawing);
    };
    const local = {
      ...store.sync,
      replace: async (path, bytes, options) => busy(path) ? null : store.sync.replace(path, bytes, options),
      remove: async (path, options) => busy(path) ? false : store.sync.remove(path, options),
    };
    const engine = createSync({local, remote: client});
    let state = client.connected ? 'syncing' : 'off', message = '', lastSynced = null, failures = 0, signInNeeded = false;
    let timer = null, timerAt = Infinity, blockedUntil = 0, running = null, again = false, started = false, destroyed = false;
    let notes = [], conflicts = [];

    const hidden = () => doc.visibilityState === 'hidden';
    const timeOf = time => { const date = new Date(time);return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; };
    function statusText() {
      if (state === 'synced' && conflicts.length) {
        return conflicts.length === 1 ? `Kept both: ${nameOf(conflicts[0].path)} and ${nameOf(conflicts[0].copy)}` : `Kept both versions of ${conflicts.length} animations`;
      }
      return {off: 'Sync off', syncing: 'Syncing', synced: `Synced ${lastSynced === null ? '' : timeOf(lastSynced)}`.trim(), offline: 'Offline',
        auth: 'Sign in again', problem: 'Sync problem'}[state];
    }
    function render() {
      const status = statusText();
      button.dataset.state = state;
      label.textContent = status;
      button.setAttribute('aria-label', `Dropbox sync: ${status}`);
      button.title = message || status;
      const connected = client.connected;
      $('[data-sync-signin]').hidden = connected && !signInNeeded;
      $('[data-sync-connected]').hidden = !connected;
      $('[data-sync-actions]').hidden = !connected;
      $('[data-sync-now]').hidden = signInNeeded;
      const detail = {
        syncing: 'Syncing now.',
        synced: lastSynced === null ? '' : `Last synced at <span class="animator-sync-value">${timeOf(lastSynced)}</span>.`,
        offline: 'Offline. Sync starts again when the connection is back.',
        auth: 'Dropbox no longer accepts the sign-in. Connect again, or disconnect.',
        problem: text(message || 'Some files could not be synced.'),
        off: '',
      }[state];
      $('[data-sync-detail]').innerHTML = detail;
      $('[data-sync-detail]').hidden = !detail;
      const lines = [
        ...conflicts.map(({path, copy}) => `<li><span class="animator-sync-value">${text(nameOf(path))}</span> changed here and in Dropbox. The Dropbox version keeps the name; this browser's version is now <span class="animator-sync-value">${text(nameOf(copy))}</span>.</li>`),
        ...notes.map(({path, reason}) => `<li><span class="animator-sync-value">${text(path)}</span>: ${text(reason)}</li>`),
      ];
      $('[data-sync-notes]').innerHTML = lines.join('');
      $('[data-sync-notes]').hidden = !lines.length;
    }
    const setError = value => { errorLine.textContent = value ? value.message || String(value) : ''; };

    function schedule(delay) {
      if (destroyed || !started || !client.connected || signInNeeded) return;
      const at = Math.max(now() + delay, blockedUntil);
      if (timer !== null && timerAt <= at) return;
      clearTimeout(timer);
      timerAt = at;
      timer = setTimeout(() => {
        timer = null;timerAt = Infinity;
        // A hidden page waits; becoming visible starts a run.
        if (hidden()) return;
        if (running) { again = true;return; }
        run({quiet: true}).catch(showError);
      }, Math.max(0, at - now()));
    }
    function nextDelay() {
      return failures ? Math.min(SYNC_INTERVAL * 2 ** failures, SYNC_MAX_BACKOFF) : SYNC_INTERVAL;
    }

    // Runs now, after any run in progress. Answers the engine's result, or
    // null when not connected. A quiet run (from the timer) keeps the status
    // as it is until it ends, so the header does not flicker every minute.
    async function run({quiet = false} = {}) {
      while (running) await running.catch(() => {});
      if (destroyed || !client.connected || signInNeeded) return null;
      clearTimeout(timer);timer = null;timerAt = Infinity;
      if (!quiet && !(state === 'synced' && conflicts.length)) state = 'syncing';
      render();
      running = (async () => {
        // Edits waiting for the autosave go into the store first, so the
        // engine sees them as local changes.
        try { await view.flush(); } catch {}
        const result = await engine.run();
        await apply(result);
        return result;
      })();
      try {
        return await running;
      } finally {
        running = null;
        render();
        if (again) { again = false;schedule(0); } else schedule(nextDelay());
      }
    }

    async function apply(result) {
      const error = result.error;
      if (error?.kind === 'auth') { signInNeeded = true;state = 'auth';message = error.message; }
      else if (error?.kind === 'offline') { failures++;state = 'offline';message = error.message; }
      else if (error) {
        failures++;state = 'problem';message = error.message;
        if (error.kind === 'rate_limit') blockedUntil = now() + (error.retryAfter ?? 60) * 1000;
      } else if (result.errors.length) {
        failures++;state = 'problem';
        message = result.errors.length === 1 ? `${result.errors[0].path} could not be synced.` : `${result.errors.length} files could not be synced.`;
      } else { failures = 0;state = 'synced';message = '';lastSynced = now(); }
      notes = [...result.skipped.filter(entry => !/tried again/.test(entry.reason)), ...result.errors.map(({path, message: reason}) => ({path, reason}))];
      conflicts.push(...result.conflicts);
      if (!(result.downloaded.length || result.deletedLocal.length || result.conflicts.length)) return;
      try {
        await view.refresh();
        const asset = view.session.asset;
        if (!asset) return;
        const isOpen = list => list.some(path => path.toLowerCase() === asset.path.toLowerCase());
        if (busy(asset.path)) return;
        // In a conflict the drawing on screen is this browser's version,
        // which now lives in the copy: the copy is opened, so what the user
        // sees does not change, only its name.
        const conflict = result.conflicts.find(({path}) => isOpen([path]));
        const copy = conflict && view.items.find(item => item.path === conflict.copy);
        if (copy) await view.open(copy);
        else if (isOpen(result.deletedLocal)) await view.close();
        else if (isOpen(result.downloaded)) await view.reload();
      } catch (failure) { showError(failure); }
    }

    async function prepareLink() {
      link.removeAttribute('href');link.setAttribute('aria-disabled', 'true');
      try {
        link.href = await client.prepareSignIn();
        link.removeAttribute('aria-disabled');
      } catch (error) { setError(error); }
    }
    function openPanel() {
      setError(null);render();
      if (dialog.showModal && !dialog.open) dialog.showModal();else dialog.setAttribute('open', '');
      if (!client.connected || signInNeeded) prepareLink();
    }
    function closePanel() {
      // The conflict note has been seen.
      conflicts = [];
      dialog.close?.();dialog.removeAttribute('open');
      render();
    }
    button.onclick = openPanel;
    $('[data-sync-close]').onclick = closePanel;
    dialog.addEventListener('close', () => { if (conflicts.length) { conflicts = [];render(); } });
    codeForm.onsubmit = async event => {
      event.preventDefault();
      setError(null);
      try {
        await client.finishSignIn(codeForm.elements.code.value);
      } catch (error) { setError(error);return; }
      codeForm.elements.code.value = '';
      signInNeeded = false;failures = 0;blockedUntil = 0;state = 'syncing';
      render();
      run().catch(setError);
    };
    $('[data-sync-now]').onclick = () => { setError(null);run().catch(setError); };
    $('[data-sync-disconnect]').onclick = async () => {
      setError(null);
      clearTimeout(timer);timer = null;timerAt = Infinity;
      while (running) await running.catch(() => {});
      await client.disconnect();
      // A later connection starts from "never synced" (store.js, forgetAll).
      await store.sync.forgetAll();
      signInNeeded = false;state = 'off';message = '';notes = [];conflicts = [];lastSynced = null;failures = 0;
      render();
      prepareLink();
    };

    const onOnline = () => schedule(0);
    const onVisible = () => {
      if (hidden()) { clearTimeout(timer);timer = null;timerAt = Infinity; } else schedule(0);
    };
    win?.addEventListener?.('online', onOnline);
    doc.addEventListener('visibilitychange', onVisible);
    render();

    return {
      client,
      get connected() { return client.connected; },
      get state() { return state; },
      get statusText() { return statusText(); },
      run,
      // Called once the page is up: the first run, when connected.
      start() { started = true;schedule(0); },
      changed() { schedule(SYNC_AFTER_SAVE); },
      destroy() {
        destroyed = true;clearTimeout(timer);
        win?.removeEventListener?.('online', onOnline);
        doc.removeEventListener('visibilitychange', onVisible);
      },
    };
  }

  return {
    view,
    api,
    sync,
    importFiles,
    exportItem,
    destroy() {
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('gesturestart', noPageZoom);
      doc.removeEventListener('visibilitychange', onVisibility);
      sync?.destroy();
      view.destroy();
      root.replaceChildren();
    },
  };
}
