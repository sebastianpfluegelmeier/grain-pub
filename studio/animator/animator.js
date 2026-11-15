// The standalone animator: TinyGrain Studio's animation editor on a page of
// its own, for drawing on an iPad. The editor (../anim-view.js and the
// modules it loads) is used as it is; this module adds the header, the
// browser store, import and export of .grainanim files, and the note about
// Safari's storage rules. Nothing is sent over the network.

import {createAnimationView} from '../anim-view.js';
import {EXTENSION} from '../anim-model.js';
import {setupTheme} from '../appearance.js';
import {icon} from '../icons.js';
import {createStore, importAnimation} from './store.js';

const NOTE_KEY = 'animator-storage-note-dismissed';
const LAST_KEY = 'animator-last-opened';
const DELETE_NOTE = 'It is removed from this browser and cannot be restored.';
const query = values => new URLSearchParams(values).toString();

// `root` receives the page (the body in index.html). `backend` is a store
// backend from store.js. The other arguments stand in for browser objects in
// tests.
export async function createAnimator({root, backend, storage = globalThis.localStorage, navigator: nav = globalThis.navigator,
  window: win = globalThis.window, clock} = {}) {
  const doc = root.ownerDocument;
  root.innerHTML = `
    <header class="app-header animator-header">
      <div class="brand">tinygrain <span>animator</span></div>
      <span id="save-status" role="status" data-state="saved" title="Saved in this browser">Saved in this browser</span>
      <button class="animator-import" data-import title="Add .grainanim files from this device">Import</button>
      <input type="file" data-import-file multiple hidden aria-hidden="true" tabindex="-1">
      <button id="theme-toggle" aria-label="Light mode" aria-pressed="false" title="Switch to light mode">${icon('sun').replace('class="ui-icon"', 'class="ui-icon sun-icon"')}${icon('moon').replace('class="ui-icon"', 'class="ui-icon moon-icon"')}</button>
    </header>
    <main class="animator-main">
      <section id="animation-view" aria-label="Animations"></section>
      <div id="error" role="alert" hidden><span></span><button aria-label="Dismiss error" data-dismiss-error>${icon('x')}</button></div>
    </main>`;
  const $ = selector => root.querySelector(selector);
  const store = createStore(backend);

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

  const view = createAnimationView({parent: $('#animation-view'), api: store.api, onError: showError, onStatus: showStatus,
    onExport: exportItem, deleteNote: DELETE_NOTE, collapsible: true, storage, clock});

  // Import: any file can be picked, because iOS greys out files whose
  // extension it does not know when `accept` names one. Each file is checked
  // with decodeAnimation, and the last one is opened.
  async function importFiles(files) {
    let last = null;
    const failures = [];
    for (const file of files) {
      try {
        last = await importAnimation(store.api, file.name, new Uint8Array(await file.arrayBuffer()));
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
  try {
    await view.show();
    const last = storage?.getItem(LAST_KEY), item = last && view.items.find(entry => entry.path === last);
    if (item) await view.open(item);
  } catch (error) { showError(error); }
  await storageNote();

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
    note.innerHTML = `<p>Animations are kept in this browser only. Safari deletes them after 7 days without a visit unless the page is added to the Home Screen; export the ones that matter.</p>
      <button data-dismiss-note>Got it</button>`;
    note.querySelector('[data-dismiss-note]').onclick = () => {
      note.remove();
      try { storage?.setItem(NOTE_KEY, 'true'); } catch {}
    };
    view.regions.list.append(note);
  }

  return {
    view,
    api: store.api,
    importFiles,
    exportItem,
    destroy() {
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('gesturestart', noPageZoom);
      doc.removeEventListener('visibilitychange', onVisibility);
      view.destroy();
      root.replaceChildren();
    },
  };
}
