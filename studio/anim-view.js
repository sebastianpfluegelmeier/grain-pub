// The animation view (docs/animation-graph-plan.md section 6): the list of
// .grainanim files, the open document, autosave, conflicts and undo. The
// canvas, graph and frame timeline are separate components mounted into the
// regions created here; they read the document through `session` and change
// it only through `session.edit`, which records undo and schedules the save.

import {decodeAnimation, encodeAnimation, MAX_SIDE} from './anim-format.js';
import {newAnimation, createHistory, recordEdit, undo, redo, groupByFolder, uniqueName,
  checkAnimationName, nodeById, edgeById, resizeAnimation, ANCHORS, FORMATS, MAX_FPS, EXTENSION} from './anim-model.js';
import {createAnimationGraph} from './anim-graph.js';
import {createAnimationCanvas} from './anim-canvas.js';
import {createAnimationTimeline} from './anim-timeline.js';
import {createAnimationPreview} from './anim-preview.js';
import {icon} from './icons.js';

// Matches source editing (6.8).
export const AUTOSAVE_DELAY = 750;
// Browsers refuse keepalive request bodies above 64 KiB in total.
const KEEPALIVE_LIMIT = 60 * 1024;
const FORMAT_LABELS = {image: 'Image · colour with alpha', matte: 'Matte · grey with alpha', field: 'Field · one value per pixel'};
const text = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const keyOf = item => JSON.stringify([item.folder, item.path]);
const query = values => new URLSearchParams(values).toString();

// Studio's host moves a deleted file into the project's trash folder.
export const STUDIO_DELETE_NOTE = "Studio keeps a copy in the project's .cache/deleted-animations folder for 48 hours.";

// `onUseInTimeline(item)` and `onExport(item)` each add an action to the
// selected list item when given. `deleteNote` is added to the delete
// confirmation. `collapsible` adds buttons that hide the list and the graph
// column while an animation is open, for small screens.
export function createAnimationView({parent, api, onError = () => {}, onSaved = () => {}, onStatus = () => {},
  onUseInTimeline = null, onExport = null, deleteNote = STUDIO_DELETE_NOTE, collapsible = false,
  storage = globalThis.localStorage, clock}) {
  parent.classList.add('animation-view');
  parent.innerHTML = `
    <aside class="anim-list" aria-label="Animations">
      <header class="anim-list-header"><h2>Animations</h2><button data-new aria-label="New animation" title="New animation">${icon('plus')}</button></header>
      <div class="anim-list-items" data-items></div>
    </aside>
    <section class="anim-canvas-area" aria-label="Drawing">
      <header class="anim-document" data-document></header>
      <div id="anim-canvas" class="anim-region"></div>
    </section>
    <div class="divider anim-divider" data-resize="graph" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize drawing and graph"></div>
    <section class="anim-graph-area" aria-label="Graph">
      <div id="anim-graph" class="anim-region"></div>
      <div id="anim-details" class="anim-details"></div>
    </section>
    <div class="vertical-divider anim-divider" data-resize="timeline" role="separator" tabindex="0" aria-orientation="horizontal" aria-label="Resize frame timeline"></div>
    <section id="anim-timeline" class="anim-region anim-timeline" aria-label="Frame timeline"></section>
    <dialog class="anim-dialog" data-new-dialog>
      <form method="dialog" data-new-form>
        <h2>New animation</h2>
        <label>Name<input name="name" required maxlength="64" autocomplete="off"></label>
        <label data-folder-field>Folder<select name="folder"></select></label>
        <label>Pixel format<select name="format">${FORMATS.map(format => `<option value="${format}">${FORMAT_LABELS[format]}</option>`).join('')}</select></label>
        <div class="field-grid">
          <label>Width · px<input name="width" type="number" min="1" max="${MAX_SIDE}" step="1" value="64" required></label>
          <label>Height · px<input name="height" type="number" min="1" max="${MAX_SIDE}" step="1" value="64" required></label>
          <label>Drawings / s<input name="fps" type="number" min="1" max="${MAX_FPS}" step="1" value="12" required></label>
        </div>
        <p class="field-error" role="alert" data-new-error></p>
        <div class="dialog-actions"><button type="button" value="cancel" data-cancel>Cancel</button><button class="primary" value="create">Create</button></div>
      </form>
    </dialog>
    <dialog class="anim-dialog" data-resize-dialog>
      <form method="dialog" data-resize-form>
        <h2>Resize canvas</h2>
        <p class="anim-dialog-note">Pads or crops every frame. The drawings stay at the anchor.</p>
        <div class="field-grid">
          <label>Width · px<input name="width" type="number" min="1" max="${MAX_SIDE}" step="1" required></label>
          <label>Height · px<input name="height" type="number" min="1" max="${MAX_SIDE}" step="1" required></label>
        </div>
        <fieldset class="anim-anchors">
          <legend>Anchor</legend>
          <div class="anim-anchor-grid" role="radiogroup" aria-label="Anchor">
            ${ANCHORS.map(anchor => `<label title="${anchor.replace('-', ' ')}"><input type="radio" name="anchor" value="${anchor}" ${anchor === 'center' ? 'checked' : ''} aria-label="Anchor ${anchor.replace('-', ' ')}"><span></span></label>`).join('')}
          </div>
        </fieldset>
        <p class="field-error" role="alert" data-resize-error></p>
        <div class="dialog-actions"><button type="button" value="cancel" data-resize-cancel>Cancel</button><button class="primary" value="resize">Resize</button></div>
      </form>
    </dialog>`;
  const $ = selector => parent.querySelector(selector);
  const regions = {list: $('.anim-list'), canvas: $('#anim-canvas'), graph: $('#anim-graph'), details: $('#anim-details'), timeline: $('#anim-timeline')};

  let items = [], folders = [], selectedKey = null, listVersion = 0, openVersion = 0, visible = false;
  // Hidden panels (collapsible only). The list starts hidden: it is needed
  // to pick an animation, and is always shown while none is open.
  const hidden = {list: true, graph: false};
  for (const kind of Object.keys(hidden)) {
    try { const stored = storage?.getItem(`studio-anim-${kind}-hidden`);if (stored === 'true' || stored === 'false') hidden[kind] = stored === 'true'; } catch {}
  }
  // The open asset: {folder, path, name, revision, doc, history}.
  let open = null;
  // The selected state or edge, {kind: 'node' | 'edge', id}, or null. It is
  // view state, not part of the document or the undo history.
  let selection = null;
  // The edge shown in the canvas and the timeline, and the position of the
  // selected frame in its play order. Selecting an edge makes it active;
  // selecting a state keeps the active edge, so drawing is not interrupted.
  let activeEdge = null, frameIndex = 0;
  let dirty = false, editVersion = 0, saveTimer = null, savePromise = null, saveAgain = false, saveError = null, conflict = null;
  const listeners = new Set();

  // The document interface for the canvas, graph and timeline components.
  const session = {
    get doc() { return open?.doc ?? null; },
    get asset() { return open && {folder: open.folder, path: open.path, name: open.name}; },
    get readOnly() { return !open || Boolean(conflict); },
    // Runs an edit from anim-model.js, records it for undo and schedules the
    // autosave. See recordEdit for `options`. Returns the edit's result.
    //
    // Beyond recordEdit's options, `edge` names the edge the edit worked on
    // (edges holding one of `frames` count too), and `frameIndex` selects a
    // frame of the active edge once the edit is recorded.
    edit(change, options = {}) {
      if (!open) throw new Error('Open an animation first.');
      if (conflict) throw new Error('Reload or overwrite the animation before editing it.');
      const result = recordEdit(open.history, open.doc, change, options);
      if (result !== undefined) {
        const frames = new Set(options.frames ?? []);
        if (Number.isInteger(options.frameIndex)) frameIndex = options.frameIndex;
        changed('edit', {frames: [...frames]});
      }
      return result;
    },
    undo: () => historyStep(undo, 'undo'),
    redo: () => historyStep(redo, 'redo'),
    get canUndo() { return Boolean(open && !conflict && open.history.undo.length); },
    get canRedo() { return Boolean(open && !conflict && open.history.redo.length); },
    get selection() { return selection && {...selection}; },
    // Selects a state ({kind: 'node', id}), an edge ({kind: 'edge', id}) or
    // nothing (null). Sends a `select` event when the selection changes.
    // Selecting is never an undo step.
    select(next) {
      const value = next && exists(next) ? {kind: next.kind, id: next.id} : null;
      if (value?.kind === selection?.kind && value?.id === selection?.id) return;
      selection = value;
      notify('select');
    },
    // The selected frame: {edge, index, id, count} for the active edge, or
    // null when no edge is active.
    get frame() {
      const edge = activeEdge === null || !open ? null : edgeById(open.doc, activeEdge);
      if (!edge) return null;
      const index = Math.max(0, Math.min(edge.frames.length - 1, frameIndex));
      return {edge: edge.id, index, id: edge.frames[index], count: edge.frames.length};
    },
    // Selects the frame at `index` of the active edge. Sends a `frame` event
    // when it changes. Never an undo step.
    selectFrame(index) {
      const current = session.frame;
      if (!current || !Number.isInteger(index)) return;
      const next = Math.max(0, Math.min(current.count - 1, index));
      if (next === current.index) return;
      frameIndex = next;
      notify('frame');
    },
    // `listener({reason, doc, asset, selection, frame})` runs after open,
    // close, edit, undo, redo, reload, rename, select and frame. Edit events
    // also carry `frames`, the frame ids the edit listed. Returns a function
    // that removes the listener.
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  // The open asset's path as code names it, as the host's import writes it:
  // "<folder name>/<path>", without .grainanim when the name has no other dot.
  function assetReference() {
    if (!open) return null;
    const item = items.find(entry => keyOf(entry) === keyOf(open));
    const library = item?.library ?? folders.find(folder => folder.id === open.folder)?.name ?? open.folder;
    let path = open.path;
    const file = path.split('/').at(-1);
    if (file.endsWith(EXTENSION) && !file.slice(0, -EXTENSION.length).includes('.')) path = path.slice(0, -EXTENSION.length);
    return library + '/' + path;
  }
  function exists({kind, id} = {}) {
    if (!open) return false;
    return kind === 'node' ? Boolean(nodeById(open.doc, id)) : kind === 'edge' ? Boolean(edgeById(open.doc, id)) : false;
  }
  // Components mounted into `regions`; each may implement update(event),
  // handleKey(event) and destroy().
  const parts = [];
  const graph = createAnimationGraph({parent: regions.graph, details: regions.details, session, onPlayGraph: () => preview.toggle()});
  // The timeline asks before the canvas, so its keys (, . N O) are not tool keys.
  const timeline = createAnimationTimeline({parent: regions.timeline, session, onGhostsChange: () => canvas.draw(), onError});
  // A tap on Space pauses the graph preview while it runs, otherwise it plays
  // the selected edge.
  const canvas = createAnimationCanvas({parent: regions.canvas, session, onInteract: () => timeline.stop(),
    onTogglePlay: () => preview.active ? preview.togglePause() : timeline.togglePlay(), ghosts: () => timeline.ghosts(), storage});
  const preview = createAnimationPreview({session, graph, canvas, timeline, clock, reference: assetReference});
  // The preview comes right after the graph, so its Escape is seen before the
  // canvas would use Escape to drop its pixel selection.
  parts.push(graph, preview, timeline, canvas);

  function notify(reason, extra = {}) {
    // An edit, undo or reload can remove the selected item.
    if (selection && !exists(selection)) selection = null;
    if (selection?.kind === 'edge' && selection.id !== activeEdge) { activeEdge = selection.id;frameIndex = 0; }
    if (activeEdge !== null && !(open && edgeById(open.doc, activeEdge))) { activeEdge = null;frameIndex = 0; }
    const event = {reason, doc: session.doc, asset: session.asset, selection: session.selection, frame: session.frame, ...extra};
    for (const part of parts) part.update?.(event);
    for (const listener of listeners) listener(event);
  }
  function status() {
    onStatus({dirty, saving: Boolean(savePromise), conflict: Boolean(conflict), error: conflict || saveError?.message || null});
  }
  function changed(reason, extra) {
    editVersion++;dirty = true;
    renderDocument();notify(reason, extra);status();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), AUTOSAVE_DELAY);
  }
  function historyStep(apply, reason) {
    if (!open || conflict) return false;
    if (!apply(open.history, open.doc)) return false;
    changed(reason);
    return true;
  }

  // Saving -----------------------------------------------------------------

  // Posts the whole file with the last known revision. Only one request runs
  // at a time; an edit made while it runs is saved by a second request.
  function save({keepalive = false} = {}) {
    clearTimeout(saveTimer);saveTimer = null;
    // A stroke paints into the frame before it is recorded. Saving now would
    // write pixels that Escape can still take back, so the save waits for the
    // gesture to end. An unload cannot wait.
    if (!keepalive && canvas.drawing) { saveTimer = setTimeout(() => save(), AUTOSAVE_DELAY); return savePromise ?? Promise.resolve(); }
    if (savePromise) { saveAgain = true; return savePromise; }
    if (!open || !dirty || conflict) return Promise.resolve();
    const target = open, version = editVersion;
    savePromise = (async () => {
      try {
        const bytes = encodeAnimation(target.doc);
        const init = keepalive && bytes.length <= KEEPALIVE_LIMIT ? {keepalive: true} : {};
        const result = await api('animation?' + query({folder: target.folder, path: target.path, revision: target.revision}), bytes, true, init);
        target.revision = result.revision;
        if (open === target && editVersion === version) dirty = false;
        saveError = null;
        const item = items.find(entry => keyOf(entry) === keyOf(target));
        if (item) item.revision = result.revision;
        onSaved({folder: target.folder, path: target.path, revision: result.revision});
      } catch (error) {
        if (error.status === 409) conflict = error.message;
        else { saveError = error; onError(error); }
      }
    })().finally(() => {
      savePromise = null;
      renderDocument();status();
      if (saveAgain) { saveAgain = false; if (dirty && !conflict && !saveError) return save(); }
    });
    status();
    return savePromise;
  }
  // Saves now and waits for every request in flight.
  async function flush(options) {
    await save(options);
    while (savePromise) await savePromise;
  }
  // Before the open document is replaced. Returns false when the user keeps a
  // document that could not be saved.
  async function leaveOpen() {
    if (!open) return true;
    await flush();
    if (!dirty) return true;
    const reason = conflict ? 'changed on disk' : 'could not be saved';
    return confirm(`${open.name} ${reason}. Discard its unsaved changes?`);
  }
  function setOpen(next, reason = next ? 'open' : 'close') {
    clearTimeout(saveTimer);saveTimer = null;
    open = next;dirty = false;conflict = null;saveError = null;editVersion++;selection = null;
    activeEdge = null;frameIndex = 0;
    if (next) selectedKey = keyOf(next);
    renderList();renderDocument();notify(reason);status();
  }
  async function load(item) {
    const result = await api('animation?' + query({folder: item.folder, path: item.path}));
    return {doc: decodeAnimation(result.bytes), revision: result.revision};
  }
  async function reload() {
    if (!open) return;
    const target = open, {doc, revision} = await load(target);
    if (open !== target) return;
    setOpen({...target, doc, revision, history: createHistory()}, 'reload');
  }
  // Writes the open document over whatever is on disk now, or as a new file
  // when it was deleted.
  async function overwrite() {
    if (!open) return;
    const target = open;
    let revision = 'new';
    try { revision = (await api('animation?' + query({folder: target.folder, path: target.path}))).revision; } catch {}
    if (open !== target) return;
    target.revision = revision;conflict = null;dirty = true;
    await flush();
  }

  // The list -----------------------------------------------------------------

  async function refresh() {
    const version = ++listVersion;
    const result = await api('animations');
    if (version !== listVersion) return;
    items = result.items;folders = result.folders?.length ? result.folders : [{id: 'project', name: 'project'}];
    renderList();if (!open) renderDocument();
  }
  function selectedItem() {
    return items.find(item => keyOf(item) === selectedKey) ?? null;
  }
  async function openItem(item) {
    selectedKey = keyOf(item);renderList();
    if (item.error || (open && keyOf(open) === keyOf(item))) return;
    if (!await leaveOpen()) { selectedKey = open && keyOf(open);renderList();return; }
    const version = ++openVersion;
    const {doc, revision} = await load(item);
    if (version !== openVersion) return;
    // The old document stayed editable while the file loaded.
    if (dirty && !await leaveOpen()) { selectedKey = open && keyOf(open);renderList();return; }
    if (version !== openVersion) return;
    setOpen({folder: item.folder, path: item.path, name: item.name, revision, doc, history: createHistory()});
  }
  async function create({name, folder, format, width, height, fps}) {
    checkAnimationName(name);
    const doc = newAnimation({format, width, height, fps});
    if (!await leaveOpen()) return false;
    const path = name + EXTENSION;
    const result = await api('animation?' + query({folder, path, revision: 'new'}), encodeAnimation(doc), true);
    setOpen({folder, path, name, revision: result.revision, doc, history: createHistory()});
    await refresh();
    return true;
  }
  async function rename(item, name) {
    if (name === item.name) return;
    const isOpen = open && keyOf(open) === keyOf(item);
    if (isOpen) await flush();
    const renamed = await api('animation-rename', {folder: item.folder, path: item.path, name});
    if (isOpen && open && keyOf(open) === keyOf(item)) Object.assign(open, {path: renamed.path, name: renamed.name});
    if (selectedKey === keyOf(item)) selectedKey = keyOf(renamed);
    await refresh();renderDocument();notify('rename');
  }
  async function duplicate(item) {
    if (open && keyOf(open) === keyOf(item)) await flush();
    const directory = item.path.slice(0, item.path.lastIndexOf('/') + 1);
    const siblings = items.filter(entry => entry.folder === item.folder && entry.path.startsWith(directory) && !entry.path.slice(directory.length).includes('/'));
    const name = uniqueName(item.name + ' copy', siblings.map(entry => entry.name));
    const copy = await api('animation-duplicate', {folder: item.folder, path: item.path, name});
    await refresh();
    await openItem(items.find(entry => keyOf(entry) === keyOf(copy)) ?? copy);
  }
  async function remove(item) {
    if (!confirm([`Delete ${item.name}?`, deleteNote].filter(Boolean).join(' '))) return;
    const isOpen = open && keyOf(open) === keyOf(item);
    if (isOpen) {
      // The file is going away, so pending edits are not saved first.
      clearTimeout(saveTimer);saveTimer = null;
      while (savePromise) await savePromise;
    }
    try {
      await api('animation-delete', {folder: item.folder, path: item.path});
    } catch (error) {
      // The file is still there, so its pending edits are saved after all.
      if (isOpen && open && keyOf(open) === keyOf(item) && dirty) saveTimer = setTimeout(() => save(), AUTOSAVE_DELAY);
      throw error;
    }
    if (isOpen && open && keyOf(open) === keyOf(item)) setOpen(null);
    if (selectedKey === keyOf(item)) selectedKey = null;
    await refresh();
  }
  async function useInTimeline(item) {
    if (open && keyOf(open) === keyOf(item)) await flush();
    await onUseInTimeline?.(item);
  }
  // The file is saved first, so the export has the latest edits.
  async function exportItem(item) {
    if (open && keyOf(open) === keyOf(item)) await flush();
    await onExport?.(item);
  }

  function renderList() {
    const host = $('[data-items]'), focused = host.contains(document.activeElement);
    const groups = groupByFolder(items, folders);
    const headings = groups.length > 1;
    host.innerHTML = groups.map(({folder, items: entries}) => `<section class="anim-folder">
      ${headings ? `<h3>${text(folder.name)}</h3>` : ''}
      ${entries.map(item => {
        const selected = keyOf(item) === selectedKey;
        return `<div class="anim-item" data-key="${text(keyOf(item))}">
          <button class="anim-item-name" data-open aria-pressed="${selected}" title="${text(item.library + '/' + item.path)}">${text(item.name)}</button>
          ${item.error ? `<p class="anim-item-error">${text(item.error)}</p>` : ''}
          ${selected ? `<div class="anim-item-actions"><button class="anim-icon-button" data-rename aria-label="Rename" title="Rename">${icon('pen')}</button><button class="anim-icon-button" data-duplicate aria-label="Duplicate" title="Duplicate">${icon('copy')}</button>${onExport ? `<button class="anim-icon-button" data-export aria-label="Export" title="Export as a .grainanim file">${icon('upload-simple')}</button>` : ''}<button class="anim-icon-button danger" data-delete aria-label="Delete" title="Delete">${icon('trash')}</button>${onUseInTimeline ? `<button data-use ${item.error ? 'disabled' : ''}>Use in timeline</button>` : ''}</div>` : ''}
        </div>`;
      }).join('')}
    </section>`).join('') || '';
    if (!items.length) host.insertAdjacentHTML('beforeend', '<p class="anim-empty">No animations yet.</p>');
    if (focused) host.querySelector('.anim-item-name[aria-pressed="true"]')?.focus({preventScroll: true});
  }
  function renderDocument() {
    const host = $('[data-document]');
    applyPanels();
    if (!open) {
      host.innerHTML = `<p class="anim-empty">${items.length ? 'Select an animation to open it.' : 'Create an animation to start drawing.'}</p>`;
      return;
    }
    const {doc} = open;
    const toggle = (kind, label) => `<button class="anim-icon-button anim-panel-toggle" data-toggle-panel="${kind}" aria-pressed="${!hidden[kind]}" aria-label="${label}" title="${hidden[kind] ? 'Show' : 'Hide'} the ${label.toLowerCase()}">${icon(kind === 'list' ? 'list' : 'animation-graph')}</button>`;
    host.innerHTML = `${collapsible ? toggle('list', 'Animations') : ''}<div class="anim-document-title"><h2>${text(open.name)}</h2><span class="anim-document-size">${doc.width} × ${doc.height} ${doc.format}</span>
      <button data-resize-canvas title="Pad or crop every frame around an anchor" ${conflict ? 'disabled' : ''}>Resize canvas…</button></div>
      ${collapsible ? toggle('graph', 'Graph') : ''}
      ${conflict ? `<div class="anim-conflict" role="alert"><p>${text(conflict)}</p><button data-reload>Reload</button><button data-overwrite>Overwrite</button></div>` : ''}`;
  }
  function applyPanels() {
    parent.classList.toggle('anim-list-hidden', collapsible && Boolean(open) && hidden.list);
    parent.classList.toggle('anim-graph-hidden', collapsible && Boolean(open) && hidden.graph);
  }
  function togglePanel(kind) {
    hidden[kind] = !hidden[kind];
    try { storage?.setItem(`studio-anim-${kind}-hidden`, String(hidden[kind])); } catch {}
    renderDocument();
    // The canvas and the graph measure their regions on the next frame.
    canvas.draw();
  }

  // Events -------------------------------------------------------------------

  const guard = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(error => onError(error));
  function startRename(item, node) {
    const button = node.querySelector('[data-open]');
    const input = document.createElement('input');
    input.className = 'anim-rename';input.value = item.name;input.maxLength = 64;input.setAttribute('aria-label', 'Animation name');
    button.replaceWith(input);input.focus();input.select();
    let finished = false;
    const finish = guard(async cancel => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      try {
        if (!cancel && name && name !== item.name) await rename(item, name);
      } finally { renderList();parent.querySelector('.anim-item-name[aria-pressed="true"]')?.focus({preventScroll: true}); }
    });
    input.onkeydown = event => {
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault();finish(event.key === 'Escape'); }
    };
    input.onblur = () => finish(false);
  }
  $('[data-items]').onclick = guard(async event => {
    const node = event.target.closest('.anim-item');
    const item = node && items.find(entry => keyOf(entry) === node.dataset.key);
    if (!item) return;
    if (event.target.closest('[data-open]')) {
      await openItem(item);
      // Where the list lies over the drawing (stacked layouts), picking an
      // animation puts it away again.
      if (collapsible && open && !hidden.list && globalThis.getComputedStyle?.(regions.list).position === 'absolute') togglePanel('list');
    }
    else if (event.target.closest('[data-rename]')) startRename(item, node);
    else if (event.target.closest('[data-duplicate]')) await duplicate(item);
    else if (event.target.closest('[data-use]')) await useInTimeline(item);
    else if (event.target.closest('[data-export]')) await exportItem(item);
    else if (event.target.closest('[data-delete]')) await remove(item);
  });
  $('[data-document]').onclick = guard(async event => {
    const panel = event.target.closest('[data-toggle-panel]');
    if (panel) togglePanel(panel.dataset.togglePanel);
    else if (event.target.closest('[data-resize-canvas]')) openResizeDialog();
    else if (event.target.closest('[data-reload]')) await reload();
    else if (event.target.closest('[data-overwrite]')) await overwrite();
  });

  const dialog = $('[data-new-dialog]'), form = $('[data-new-form]');
  function openNewDialog() {
    const select = form.elements.folder;
    select.innerHTML = folders.map(folder => `<option value="${text(folder.id)}">${text(folder.name)}</option>`).join('');
    select.value = open?.folder ?? folders[0]?.id ?? 'project';
    // A single folder needs no choice.
    $('[data-folder-field]').hidden = folders.length <= 1;
    const taken = items.filter(item => item.folder === select.value).map(item => item.name);
    form.elements.name.value = uniqueName('animation', taken);
    $('[data-new-error]').textContent = '';
    dialog.showModal?.();
    form.elements.name.focus();form.elements.name.select();
  }
  $('[data-new]').onclick = guard(async () => { if (!items.length && !folders.length) await refresh();openNewDialog(); });
  $('[data-cancel]').onclick = () => dialog.close?.();
  // preventDefault must run during dispatch, or the method="dialog" form closes the dialog itself.
  form.onsubmit = event => { event.preventDefault();submitNew(); };
  const submitNew = guard(async () => {
    const values = form.elements, error = $('[data-new-error]');
    error.textContent = '';
    try {
      const created = await create({name: values.name.value.trim(), folder: values.folder.value, format: values.format.value,
        width: Number(values.width.value), height: Number(values.height.value), fps: Number(values.fps.value)});
      if (created) dialog.close?.();
    } catch (failure) {
      error.textContent = failure.message || String(failure);
    }
  });

  // Resize (6.3): every frame is padded or cropped around an anchor, as one
  // undo step. Frames kept only for undo are resized too.
  function resizeCanvas({width, height, anchor = 'center'}) {
    if (!open) throw new Error('Open an animation first.');
    return session.edit(d => resizeAnimation(d, width, height, anchor), {frames: [...open.doc.pixels.keys()]});
  }
  const resizeDialog = $('[data-resize-dialog]'), resizeForm = $('[data-resize-form]');
  function openResizeDialog() {
    if (!open || conflict) return;
    resizeForm.elements.width.value = String(open.doc.width);
    resizeForm.elements.height.value = String(open.doc.height);
    resizeForm.elements.anchor.value = 'center';
    $('[data-resize-error]').textContent = '';
    resizeDialog.showModal?.();
    resizeForm.elements.width.focus();resizeForm.elements.width.select();
  }
  $('[data-resize-cancel]').onclick = () => resizeDialog.close?.();
  resizeForm.onsubmit = event => {
    event.preventDefault();
    const values = resizeForm.elements, error = $('[data-resize-error]');
    error.textContent = '';
    try {
      resizeCanvas({width: Number(values.width.value), height: Number(values.height.value), anchor: values.anchor.value});
      resizeDialog.close?.();
    } catch (failure) {
      error.textContent = failure.message || String(failure);
    }
  };

  // Undo and redo while focus is outside text fields. Returns true when the
  // key was handled.
  function handleKey(event) {
    if (event.defaultPrevented) return false;
    for (const part of parts) if (part.handleKey?.(event)) return true;
    if (event.target?.closest?.('input,textarea,select,[contenteditable],dialog')) return false;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && !event.altKey && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (event.shiftKey || key === 'y') session.redo();else session.undo();
      return true;
    }
    return false;
  }
  // Keys typed inside the view never reach the timeline's global handler.
  parent.addEventListener('keydown', event => { handleKey(event);event.stopPropagation(); });

  // Draggable borders, as in the workspace dividers. Sizes are kept per browser.
  // Each is [custom property, smallest size, room left for the rest].
  const sizes = {graph: ['--anim-graph-width', 220, 480], graphHeight: ['--anim-graph-height', 140, 420], timeline: ['--anim-timeline-height', 96, 200]};
  function setSize(kind, value) {
    const [property, minimum, rest] = sizes[kind], box = parent.getBoundingClientRect();
    const maximum = (kind === 'graph' ? box.width : box.height) - rest;
    const size = Math.round(Math.max(minimum, Math.min(Math.max(minimum, maximum), value)));
    parent.style.setProperty(property, size + 'px');
    try { storage?.setItem('studio-' + property.slice(2), String(size)); } catch {}
  }
  for (const [property] of Object.values(sizes)) {
    try { const stored = Number(storage?.getItem('studio-' + property.slice(2)));if (stored > 0) parent.style.setProperty(property, stored + 'px'); } catch {}
  }
  for (const handle of parent.querySelectorAll('[data-resize]')) {
    // A stacked layout (portrait) puts the graph below the frames; its border
    // then lies flat and sets the graph's height instead of its width.
    const target = () => {
      if (handle.dataset.resize !== 'graph') return 'timeline';
      const rect = handle.getBoundingClientRect();
      return rect.width > rect.height ? 'graphHeight' : 'graph';
    };
    const measure = kind => kind === 'timeline' ? regions.timeline.getBoundingClientRect().height
      : $('.anim-graph-area').getBoundingClientRect()[kind === 'graph' ? 'width' : 'height'];
    handle.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const kind = target(), box = parent.getBoundingClientRect();
      // The frames do not reach the view's bottom edge in a stacked layout.
      const timelineBottom = regions.timeline.getBoundingClientRect().bottom;
      const move = e => setSize(kind, kind === 'graph' ? box.right - e.clientX : kind === 'graphHeight' ? box.bottom - e.clientY : timelineBottom - e.clientY);
      const end = () => { document.removeEventListener('pointermove', move);document.removeEventListener('pointerup', end);document.removeEventListener('pointercancel', end); };
      document.addEventListener('pointermove', move);document.addEventListener('pointerup', end);document.addEventListener('pointercancel', end);
    };
    handle.onkeydown = event => {
      const kind = target(), keys = kind === 'graph' ? {ArrowLeft: 20, ArrowRight: -20} : {ArrowUp: 20, ArrowDown: -20};
      if (!(event.key in keys)) return;
      event.preventDefault();setSize(kind, measure(kind) + keys[event.key]);
    };
  }

  // Quitting the desktop app does not ask the page about unsaved work, so the
  // view saves whenever it might be closed.
  const saveOnBlur = () => { flush().catch(() => {}); };
  const saveOnUnload = () => { save({keepalive: true}).catch(() => {}); };
  window.addEventListener('blur', saveOnBlur);
  window.addEventListener('beforeunload', saveOnUnload);
  window.addEventListener('pagehide', saveOnUnload);

  renderList();renderDocument();status();

  return {
    session,
    regions,
    parts,
    graph,
    canvas,
    timeline,
    preview,
    handleKey,
    refresh,
    flush,
    async show() { visible = true;preview.setVisible(true);await refresh(); },
    async hide() { visible = false;timeline.stop();preview.setVisible(false);await flush(); },
    get visible() { return visible; },
    get items() { return items; },
    get selected() { return selectedItem(); },
    open: openItem,
    create,
    resize: resizeCanvas,
    rename,
    duplicate,
    remove,
    reload,
    overwrite,
    // Closes the open animation, saving it first; false when the user keeps
    // edits that could not be saved. Used when the file was deleted elsewhere.
    async close() {
      if (!await leaveOpen()) return false;
      setOpen(null);
      return true;
    },
    status: () => ({dirty, saving: Boolean(savePromise), conflict, error: saveError}),
    destroy() {
      clearTimeout(saveTimer);
      window.removeEventListener('blur', saveOnBlur);
      window.removeEventListener('beforeunload', saveOnUnload);
      window.removeEventListener('pagehide', saveOnUnload);
      for (const part of parts) part.destroy?.();
      parent.replaceChildren();
    },
  };
}

