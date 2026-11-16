// The frame timeline of the animation editor (docs/animation-graph-plan.md
// 6.5): the frames of the selected edge in play order, frame edits, playback
// of the edge alone, the drawings-per-second field and the onion skin
// settings, including the ghosts that come from neighbouring edges.

import {addFrame, duplicateFrame, deleteFrame, moveFrame, setFps, neighbourEdges, onionGhosts, edgeById, nodeById, nodeLabel, isLoop, MAX_FPS} from './anim-model.js';
import {surface, toRGBA} from './anim-paint.js';
import {icon} from './icons.js';

// The longest side of a thumbnail's backing canvas; larger frames are
// scaled down when the thumbnail is drawn.
const THUMB_PIXELS = 96;
const DRAG_THRESHOLD = 4;
// A finger or a pen on a thumbnail scrolls the strip; holding it still this
// long picks the frame up for reordering instead.
export const TOUCH_HOLD_MS = 350;
export const MAX_GHOSTS = 3;
const text = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const TEXT_TARGETS = 'input,textarea,select,[contenteditable],dialog';

// `onGhostsChange()` runs when the onion skin settings change, so the canvas
// redraws; `onError(error)` reports an edit the document refused.
export function createAnimationTimeline({parent, session, onGhostsChange = () => {}, onError = () => {}}) {
  parent.classList.add('anim-timeline-part');
  parent.innerHTML = `
    <div class="anim-timeline-bar" data-bar></div>
    <div class="anim-strip" data-strip role="listbox" tabindex="0" aria-orientation="horizontal" aria-label="Frames. Arrow keys select, Alt with an arrow moves the frame, Delete removes it."></div>
    <p class="anim-timeline-empty" data-empty hidden></p>`;
  const $ = selector => parent.querySelector(selector);
  const bar = $('[data-bar]'), strip = $('[data-strip]'), emptyLine = $('[data-empty]');

  const onion = {on: false, count: 1};
  // The neighbouring edges picked for the onion skin, per edge: {before, after},
  // each an edge id, or null for none. Missing means all of them.
  const choices = new Map();
  let playing = null, playEdge = null, drag = null;
  // While the graph preview runs, frames cannot be changed and the edge does
  // not play on its own; the drawings-per-second field stays editable,
  // because the preview follows it without restarting.
  let previewing = false;
  // Thumbnails by frame id: {data, canvas}. A thumbnail is redrawn when its
  // frame's pixel array is replaced (undo, redo, reload) or an edit lists the
  // frame; strokes report their frame once, when they end.
  const thumbs = new Map(), dirty = new Set();
  const scratch = document.createElement('canvas');

  const doc = () => session.doc;
  const frame = () => session.frame;
  const activeEdge = () => frame() && edgeById(doc(), frame().edge);
  const editable = () => Boolean(doc()) && !session.readOnly && !previewing;

  function edit(change, options) {
    try {
      return session.edit(change, options);
    } catch (error) {
      onError(error);
      return undefined;
    }
  }

  // Onion skin ------------------------------------------------------------------------

  function neighbours() {
    const edge = activeEdge();
    return edge ? neighbourEdges(doc(), edge.id) : {before: [], after: []};
  }
  // The neighbours ghosted on one side, as a list: every edge at that state
  // unless the user picked one (while it still exists) or none. All of them
  // meet in the same pose, so together they show where the drawings disagree,
  // and the ghosts do not change with what was edited last.
  function chosen(side, list = neighbours()[side]) {
    const edge = activeEdge();
    if (!edge) return [];
    const stored = choices.get(edge.id)?.[side];
    if (stored === null) return [];
    const found = stored !== undefined && list.find(entry => entry.edge === stored);
    return found ? [found] : list;
  }
  function ghosts() {
    const f = frame();
    if (!onion.on || !f || !activeEdge()) return [];
    return onionGhosts(doc(), f.edge, f.index, {count: onion.count, before: chosen('before'), after: chosen('after')});
  }
  function setOnion(next) {
    Object.assign(onion, next);
    onion.count = Math.max(1, Math.min(MAX_GHOSTS, Math.round(onion.count) || 1));
    render();onGhostsChange();
  }
  function choose(side, value) {
    const edge = activeEdge();
    if (!edge) return;
    choices.set(edge.id, {...choices.get(edge.id), [side]: value});
    render();onGhostsChange();
  }

  // Playback of the edge alone ---------------------------------------------------------

  function play() {
    const edge = activeEdge();
    if (!edge || playing || previewing) return;
    playEdge = edge.id;
    const step = () => {
      const current = activeEdge();
      if (!current || current.id !== playEdge) { stop();return; }
      session.selectFrame((frame().index + 1) % current.frames.length);
      playing = setTimeout(step, 1000 / doc().fps);
    };
    playing = setTimeout(step, 1000 / doc().fps);
    render();
  }
  function stop() {
    if (!playing) return;
    clearTimeout(playing);
    playing = null;playEdge = null;
    render();
  }
  const togglePlay = () => playing ? stop() : play();

  // Frame edits -----------------------------------------------------------------------

  function addAfter() {
    const f = frame();
    if (!f || !editable()) return;
    stop();
    edit(d => addFrame(d, f.edge, f.index + 1), {edge: f.edge, frameIndex: f.index + 1});
  }
  function duplicate() {
    const f = frame();
    if (!f || !editable()) return;
    stop();
    edit(d => duplicateFrame(d, f.edge, f.index), {edge: f.edge, frameIndex: f.index + 1});
  }
  function remove() {
    const f = frame();
    if (!f || !editable()) return;
    stop();
    edit(d => deleteFrame(d, f.edge, f.index), {edge: f.edge, frameIndex: Math.max(0, f.index - 1)});
  }
  function move(from, to) {
    const f = frame();
    if (!f || !editable() || from === to) return;
    stop();
    edit(d => moveFrame(d, f.edge, from, to), {edge: f.edge, frameIndex: to});
  }
  function select(index) {
    const edge = activeEdge();
    if (!edge) return;
    session.selectFrame(Math.max(0, Math.min(edge.frames.length - 1, index)));
  }

  // Rendering ---------------------------------------------------------------------------

  function edgeLabel(entry) {
    const d = doc(), edge = edgeById(d, entry.edge), name = id => text(nodeLabel(nodeById(d, id)));
    if (!edge) return '';
    if (isLoop(edge)) return `loop on <span class="anim-name">${name(edge.from)}</span>`;
    if (entry.shares) return `<span class="anim-name">${name(edge.from)}</span> → <span class="anim-name">${name(edge.to)}</span>, its ${entry.shares}`;
    return entry.reversed ? `<span class="anim-name">${name(edge.to)}</span> → <span class="anim-name">${name(edge.from)}</span>, backwards`
      : `<span class="anim-name">${name(edge.from)}</span> → <span class="anim-name">${name(edge.to)}</span>`;
  }
  // Option labels are plain text. Parallel edges get their id to tell them apart.
  function optionLabels(list) {
    const plain = list.map(entry => edgeLabel(entry).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    return plain.map((label, index) => plain.indexOf(label) !== plain.lastIndexOf(label) ? `${label} (edge ${list[index].edge})` : label);
  }
  function menu(side, list) {
    const pick = chosen(side, list), labels = optionLabels(list);
    const title = side === 'before' ? 'The edges at the start state whose nearest frames are ghosted before the first frame' : 'The edges at the end state whose nearest frames are ghosted after the last frame';
    const one = pick.length === 1 && list.length > 1 ? pick[0].edge : null, all = pick.length > 0 && one === null;
    return `<label class="anim-onion-choice" title="${title}">${side === 'before' ? 'Before' : 'After'}<select data-onion-${side} ${list.length ? '' : 'disabled'}>
      <option value="none" ${pick.length ? '' : 'selected'}>none</option>
      ${list.length > 1 ? `<option value="all" ${all ? 'selected' : ''}>all</option>` : ''}
      ${list.map((entry, index) => `<option value="${entry.edge}" ${one === entry.edge || (all && list.length === 1) ? 'selected' : ''}>${text(labels[index])}</option>`).join('')}
    </select></label>`;
  }
  function render() {
    const d = doc(), edge = activeEdge(), f = frame();
    const focus = parent.contains(document.activeElement) && document.activeElement !== strip ? document.activeElement.dataset.focus : null;
    if (!d) { bar.innerHTML = '';strip.innerHTML = '';strip.hidden = true;emptyLine.hidden = true;return; }
    const disabled = editable() ? '' : 'disabled';
    const fps = `<label class="anim-fps" title="Drawings per second at rate 1">Drawings / s<input data-fps data-focus="fps" type="number" min="1" max="${MAX_FPS}" step="1" value="${d.fps}" ${session.readOnly ? 'disabled' : ''}></label>`;
    if (!edge) {
      bar.innerHTML = `<h3 class="anim-timeline-title">Frames</h3>${fps}`;
      strip.innerHTML = '';strip.hidden = true;
      emptyLine.hidden = false;
      emptyLine.textContent = d.edges.length ? 'Select an edge in the graph to see its frames.' : 'Frames live on edges. Add states and an edge in the graph.';
    } else {
      const {before, after} = neighbours(), count = edge.frames.length;
      bar.innerHTML = `
        <h3 class="anim-timeline-title">${edgeLabel({edge: edge.id, reversed: false})}</h3>
        <span class="anim-transport">
          <button class="anim-step" data-step-frame="-1" data-focus="previous" aria-label="Previous frame" title="Previous frame (,)" ${f.index > 0 ? '' : 'disabled'}>${icon('caret-left')}</button>
          <button class="anim-play" data-play data-focus="play" ${previewing ? 'disabled' : ''} aria-pressed="${Boolean(playing)}" aria-label="${playing ? 'Pause' : 'Play'} this edge" title="${playing ? 'Pause' : 'Play'} this edge (Space)">${icon(playing ? 'pause' : 'play')}</button>
          <button class="anim-step" data-step-frame="1" data-focus="next" aria-label="Next frame" title="Next frame (.)" ${f.index < count - 1 ? '' : 'disabled'}>${icon('caret-right')}</button>
        </span>
        <span class="anim-frame-count">frame ${f.index + 1} of ${count}</span>
        <span class="anim-timeline-actions">
          <button class="anim-icon-button" data-add-frame data-focus="add" aria-label="New frame" title="New frame after this one (N)" ${disabled}>${icon('plus')}</button>
          <button class="anim-icon-button" data-duplicate-frame data-focus="duplicate" aria-label="Duplicate frame" title="Duplicate this frame" ${disabled}>${icon('copy')}</button>
          <button class="anim-icon-button danger" data-delete-frame data-focus="delete" aria-label="Delete frame" title="${count > 1 ? 'Delete this frame' : 'An edge keeps at least one frame'}" ${count > 1 && editable() ? '' : 'disabled'}>${icon('trash')}</button>
        </span>
        ${fps}
        <span class="anim-onion">
          <button class="anim-icon-button" data-onion data-focus="onion" aria-pressed="${onion.on}" aria-label="Onion skin" title="Onion skin: show ghosts of neighbouring frames (O)">${icon('onion')}</button>
          ${onion.on ? `<label class="anim-onion-choice" title="Ghosts on each side">Ghosts<select data-onion-count>${[1, 2, 3].map(value => `<option ${value === onion.count ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
            ${menu('before', before)}${menu('after', after)}` : ''}
        </span>`;
      emptyLine.hidden = true;
      strip.hidden = false;
      renderStrip(edge, f.index);
    }
    if (focus) parent.querySelector(`[data-focus="${focus}"]`)?.focus({preventScroll: true});
  }
  function renderStrip(edge, selected) {
    const d = doc(), items = [];
    edge.frames.forEach((id, index) => {
      const item = document.createElement('div');
      item.className = 'anim-thumb';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === selected));
      item.setAttribute('aria-label', `Frame ${index + 1}`);
      item.dataset.index = String(index);
      if (drag?.dragging && drag.over === index && drag.over !== drag.from) item.classList.add(drag.over > drag.from ? 'drop-after' : 'drop-before');
      if (drag?.dragging && drag.from === index) item.classList.add('dragging');
      const image = document.createElement('span');
      image.className = 'anim-thumb-image anim-checker';
      image.style.aspectRatio = `${d.width} / ${d.height}`;
      image.append(thumbnail(id));
      const number = document.createElement('span');
      number.className = 'anim-thumb-number';number.textContent = String(index + 1);
      item.append(image, number);
      items.push(item);
    });
    strip.replaceChildren(...items);
    strip.setAttribute('aria-activedescendant', '');
    strip.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block: 'nearest', inline: 'nearest'});
  }
  function thumbnail(id) {
    const d = doc(), data = d.pixels.get(id);
    let entry = thumbs.get(id);
    const scale = Math.min(1, THUMB_PIXELS / Math.max(d.width, d.height));
    const w = Math.max(1, Math.round(d.width * scale)), h = Math.max(1, Math.round(d.height * scale));
    if (!entry || entry.data !== data || dirty.has(id) || entry.canvas.width !== w || entry.canvas.height !== h) {
      const canvas = entry?.canvas ?? document.createElement('canvas');
      canvas.width = w;canvas.height = h;
      drawThumb(canvas, d, data);
      entry = {data, canvas};
      thumbs.set(id, entry);
      dirty.delete(id);
    }
    return entry.canvas;
  }
  function drawThumb(canvas, d, data) {
    const ctx = canvas.getContext?.('2d');
    if (!ctx || !data) return;
    if (scratch.width !== d.width || scratch.height !== d.height) { scratch.width = d.width;scratch.height = d.height; }
    const scratchContext = scratch.getContext?.('2d');
    if (!scratchContext) return;
    const image = scratchContext.createImageData(d.width, d.height);
    toRGBA(surface(d.format, d.width, d.height, data), image.data);
    scratchContext.putImageData(image, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Smoothing only when shrinking, so small frames stay crisp.
    ctx.imageSmoothingEnabled = canvas.width < d.width;
    ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);
  }

  // Events ---------------------------------------------------------------------------------

  // While an edge plays, every frame rebuilds the bar, so a button is usually
  // replaced between press and release and no click reaches it. During
  // playback a press therefore acts at once and the click that may follow is
  // dropped. Keyboard clicks (detail 0) always go through.
  let pressed = false;
  bar.addEventListener('pointerdown', event => {
    pressed = false;
    const button = event.target.closest('button');
    if (!playing || event.button !== 0 || !button || button.disabled) return;
    pressed = true;
    act(button);
  });
  bar.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (pressed && event.detail) { pressed = false;return; }
    if (!button || button.disabled) return;
    act(button);
  });
  function act(button) {
    if (button.matches('[data-play]')) togglePlay();
    else if (button.matches('[data-step-frame]')) { stop();select(frame().index + Number(button.dataset.stepFrame)); }
    else if (button.matches('[data-add-frame]')) addAfter();
    else if (button.matches('[data-duplicate-frame]')) duplicate();
    else if (button.matches('[data-delete-frame]')) remove();
    else if (button.matches('[data-onion]')) setOnion({on: !onion.on});
  }
  bar.addEventListener('change', event => {
    const input = event.target;
    if (input.matches('[data-fps]')) {
      try { session.edit(d => setFps(d, Number(input.value))); } catch (error) { input.value = String(doc().fps);onError(error); }
    } else if (input.matches('[data-onion-count]')) setOnion({count: Number(input.value)});
    else if (input.matches('[data-onion-before],[data-onion-after]')) choose(input.matches('[data-onion-before]') ? 'before' : 'after', input.value === 'none' ? null : input.value === 'all' ? undefined : Number(input.value));
  });
  // A press selects; dragging past a few pixels reorders. The listeners for
  // the drag sit on the document, so leaving the strip does not end it. A
  // finger or a pen has to hold still first (`held`), because moving at once
  // scrolls the strip (touch-action: pan-x on the thumbnails).
  strip.addEventListener('pointerdown', event => {
    const item = event.target.closest('.anim-thumb');
    if (!item || event.button !== 0) return;
    const index = Number(item.dataset.index);
    select(index);
    if (!editable()) return;
    const direct = event.pointerType === 'touch' || event.pointerType === 'pen';
    drag = {pointerId: event.pointerId, from: index, over: index, x: event.clientX, y: event.clientY, dragging: false, held: !direct, timer: null};
    if (direct) {
      const pending = drag;
      pending.timer = setTimeout(() => { if (drag === pending) { pending.held = true;item.classList.add('dragging'); } }, TOUCH_HOLD_MS);
    }
    document.addEventListener('pointermove', dragMove);
    document.addEventListener('pointerup', dragEnd);
    document.addEventListener('pointercancel', dragEnd);
  });
  // Once a frame is held, moving the finger reorders instead of scrolling.
  // Safari starts a scroll unless touchmove is cancelled.
  const holdScroll = event => { if (drag?.held && drag.timer !== null) event.preventDefault(); };
  strip.addEventListener('touchmove', holdScroll, {passive: false});
  function dragMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    if (!drag.held) {
      // Moved before the hold: the strip scrolls and the frame stays put.
      if (distance >= DRAG_THRESHOLD) dragEnd({pointerId: drag.pointerId, type: 'pointercancel'});
      return;
    }
    if (!drag.dragging && distance < DRAG_THRESHOLD) return;
    if (!drag.dragging) stop();
    drag.dragging = true;
    const under = (document.elementFromPoint?.(event.clientX, event.clientY) || event.target)?.closest?.('.anim-thumb');
    if (under && strip.contains(under)) drag.over = Number(under.dataset.index);
    render();
  }
  function dragEnd(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const {from, over, dragging, timer} = drag;
    clearTimeout(timer);
    drag = null;
    document.removeEventListener('pointermove', dragMove);
    document.removeEventListener('pointerup', dragEnd);
    document.removeEventListener('pointercancel', dragEnd);
    if (dragging && event.type === 'pointerup' && over !== from) move(from, over);
    else render();
  }
  strip.addEventListener('keydown', event => {
    const f = frame(), edge = activeEdge();
    if (!f || !edge || event.metaKey || event.ctrlKey) return;
    const step = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1}[event.key];
    if (step && event.altKey) {
      event.preventDefault();event.stopPropagation();
      const to = f.index + step;
      if (to >= 0 && to < edge.frames.length) move(f.index, to);
    } else if (step) { event.preventDefault();event.stopPropagation();select(f.index + step); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault();event.stopPropagation();select(event.key === 'Home' ? 0 : edge.frames.length - 1); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && !event.altKey) { event.preventDefault();event.stopPropagation();remove(); }
  });

  // Keys of 6.9 that belong to the timeline: , and . step through the frames,
  // N adds a frame after the current one, O switches the onion skin.
  function handleKey(event) {
    if (!doc() || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.target?.closest?.(TEXT_TARGETS)) return false;
    const f = frame(), key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if ((key === ',' || key === '.') && f) { event.preventDefault();stop();select(f.index + (key === '.' ? 1 : -1));return true; }
    if (key === 'n' && f && editable()) { event.preventDefault();addAfter();return true; }
    if (key === 'o' && f) { event.preventDefault();setOnion({on: !onion.on});return true; }
    return false;
  }

  function update(event) {
    if (['open', 'close', 'reload'].includes(event.reason)) { stop();thumbs.clear();dirty.clear();choices.clear(); }
    if (event.reason === 'edit') for (const id of event.frames ?? []) dirty.add(id);
    if (playing && activeEdge()?.id !== playEdge) stop();
    render();
  }
  render();

  return {
    update,
    handleKey,
    ghosts,
    togglePlay,
    play,
    stop,
    get playing() { return Boolean(playing); },
    // The graph preview starts (true) or ends (false).
    setPreview(value) {
      previewing = Boolean(value);
      if (previewing) stop();
      render();
    },
    get onion() { return {...onion}; },
    setOnion,
    // The neighbour entries for the selected edge and the ones in use.
    get neighbours() { const list = neighbours();return {...list, before: list.before, after: list.after, chosen: {before: chosen('before', list.before), after: chosen('after', list.after)}}; },
    choose,
    destroy() {
      stop();
      clearTimeout(drag?.timer);
      strip.removeEventListener('touchmove', holdScroll);
      document.removeEventListener('pointermove', dragMove);
      document.removeEventListener('pointerup', dragEnd);
      document.removeEventListener('pointercancel', dragEnd);
      parent.replaceChildren();
    },
  };
}
