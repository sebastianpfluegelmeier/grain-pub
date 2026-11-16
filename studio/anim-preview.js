// The playback preview of the animation editor (docs/animation-graph-plan.md
// 6.7). It runs the open document through anim-machine.js on a real clock,
// not through the renderer: Studio has one renderer process, shared with the
// timeline, and a one-off render would recompile and reset the timeline
// program. The rules all live in anim-machine.js; this file only feeds it
// inputs and time and shows the result in the graph and the canvas.

import {buildGraph, createMachineState, tick, structureHash, distance, MAX_RATE} from './anim-machine.js';
import {nodeById, nodeLabel} from './anim-model.js';
import {icon} from './icons.js';

// The defaults of the animation_graph call (section 2.2).
export const CALL_DEFAULTS = Object.freeze({urgency: 1, rate: 1, loop: true, randomize: false});
// The runtime seeds each machine from its call site, which the editor cannot
// know, so the preview uses a fixed seed: a restart repeats the same shuffle.
// Where the call puts the frame: its centre in 0..1 and a factor on its
// native pixel size. The preview draws in the editor canvas, so these only
// go into the copied call.
export const PLACEMENT_DEFAULTS = Object.freeze({u: 0.5, v: 0.5, scale: 1});
const MAX_SCALE = 64;
export const PREVIEW_SEED = 0;

const text = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
// Control values as Grain literals: at most three decimals, no trailing zeros.
const literal = value => String(Math.round(value * 1000) / 1000);

// The stepping core, without the DOM: the machine state, the call's inputs
// and the graph built from the document. `step(dt)` is one rendered frame.
export function createPlayer({seed = PREVIEW_SEED} = {}) {
  let graph = buildGraph({fps: 1, nodes: [], edges: []}), hash = structureHash(graph);
  let state = createMachineState(seed);
  const inputs = {state: null, ...CALL_DEFAULTS};
  return {
    inputs,
    get graph() { return graph; },
    get state() { return state; },
    // Takes a new graph (metadata or an editor document). As in the runtime
    // (rule 11), a change of structure restarts the machine and a change of
    // pixels, names, positions or fps keeps it. Returns true on a restart.
    setGraph(source) {
      const next = buildGraph(source), nextHash = structureHash(next);
      const restarted = nextHash !== hash;
      graph = next;hash = nextHash;
      if (restarted) state = createMachineState(seed);
      return restarted;
    },
    // Back to "not placed", as a rewind does in the runtime.
    restart() { state = createMachineState(seed); },
    // Advances one rendered frame of `dt` seconds and returns the frame id to
    // show, or null for the empty output.
    step(dt) {
      const result = tick(graph, state, inputs, dt);
      state = result.state;
      return result.frame;
    },
  };
}

// What the machine is doing, in the graph's ids: {node, edge, reversed,
// requested, arrival, resting}. `node` is the state it rests at or the one
// the playing edge left from.
export function machinePosition(graph, state) {
  const id = index => index === null || index === undefined ? null : graph.nodes[index]?.id ?? null;
  const position = state.position, requested = id(state.request);
  if (position.kind === 'resting') return {node: id(position.node), edge: null, reversed: false, requested, arrival: id(position.node), resting: true};
  if (position.kind !== 'edge') return {node: null, edge: null, reversed: false, requested, arrival: null, resting: false};
  const [from, to] = graph.edgeEnds[position.edge];
  const loop = from === to;
  return {node: id(position.reversed ? to : from), edge: graph.edges[position.edge].id, reversed: position.reversed && !loop,
    requested, arrival: id(position.reversed ? from : to), resting: false};
}

const defaultClock = () => ({
  now: () => globalThis.performance?.now?.() ?? Date.now(),
  frame: callback => (globalThis.requestAnimationFrame ?? (cb => setTimeout(() => cb(Date.now()), 16)))(callback),
  cancel: handle => (globalThis.cancelAnimationFrame ?? clearTimeout)(handle),
});

// `graph`, `canvas` and `timeline` are the view's components. `reference()`
// returns the asset path as code writes it ("<folder>/<name>"), or null.
// `clock` is {now() in ms, frame(callback) -> handle, cancel(handle)}; tests
// pass one they control.
export function createAnimationPreview({session, graph, canvas, timeline, reference = () => null, clock = defaultClock(),
  seed = PREVIEW_SEED}) {
  const panel = document.createElement('section');
  panel.className = 'anim-preview';
  panel.setAttribute('aria-label', 'Graph preview');
  panel.innerHTML = `
    <div class="anim-preview-actions">
      <button class="anim-icon-button" data-preview-pause aria-pressed="false" aria-label="Pause" title="Pause or resume the preview (Space)">${icon('pause')}</button>
      <button class="anim-icon-button" data-preview-restart aria-label="Restart" title="Restart: start again at the requested state, as a rewind does">${icon('skip-back')}</button>
      <button data-preview-copy title="Copy the animation_graph call for these settings">Copy call</button>
    </div>
    <div class="anim-preview-state">
      <p data-preview-where></p>
      <p data-preview-heading role="status" aria-live="polite"></p>
      <p class="anim-preview-message" data-preview-message role="status" aria-live="polite"></p>
    </div>
    <div class="anim-preview-controls">
      <label class="anim-preview-range" title="Picks between parallel transitions of different lengths: 1 plays the shortest, 0 the longest. Loops ignore it.">Urgency
        <input type="range" data-preview-urgency min="0" max="1" step="0.05" value="${CALL_DEFAULTS.urgency}"><output data-preview-urgency-value>${literal(CALL_DEFAULTS.urgency)}</output></label>
      <label class="anim-preview-rate" title="Multiplies the drawings per second; 0 holds the current drawing">Rate
        <input type="number" data-preview-rate min="0" max="${MAX_RATE}" step="0.25" value="${CALL_DEFAULTS.rate}"></label>
      <label class="anim-detail-toggle" title="Play the requested state's loops while resting there"><input type="checkbox" data-preview-loop ${CALL_DEFAULTS.loop ? 'checked' : ''}>Loop</label>
      <label class="anim-detail-toggle" title="Shuffle between alternatives instead of taking them in turn"><input type="checkbox" data-preview-randomize ${CALL_DEFAULTS.randomize ? 'checked' : ''}>Randomize</label>
      <label class="anim-preview-range" title="Horizontal centre of the frame in the copied call: 0 is the left edge, 1 the right">X
        <input type="range" data-preview-place="u" min="0" max="1" step="0.05" value="${PLACEMENT_DEFAULTS.u}"><output data-preview-place-value="u">${PLACEMENT_DEFAULTS.u.toFixed(2)}</output></label>
      <label class="anim-preview-range" title="Vertical centre of the frame in the copied call: 0 is the top edge, 1 the bottom">Y
        <input type="range" data-preview-place="v" min="0" max="1" step="0.05" value="${PLACEMENT_DEFAULTS.v}"><output data-preview-place-value="v">${PLACEMENT_DEFAULTS.v.toFixed(2)}</output></label>
      <label class="anim-preview-rate" title="Size in the copied call: multiplies the animation's own pixel size">Scale
        <input type="number" data-preview-scale min="0.25" max="${MAX_SCALE}" step="0.25" value="${PLACEMENT_DEFAULTS.scale}"></label>
    </div>`;
  const $ = selector => panel.querySelector(selector);

  let active = false, paused = false, visible = true, handle = null, lastTime = null;
  // The state the user asked for, by id, so a rename keeps the request. It
  // may name a state that an undo removed; the machine then ignores it, like
  // the runtime ignores an unknown state.
  let requested = null;
  const placement = {...PLACEMENT_DEFAULTS};
  let player = createPlayer({seed});
  let shown = {frame: undefined, highlight: '', where: '', heading: ''};

  const doc = () => session.doc;
  const pageHidden = () => globalThis.document?.visibilityState === 'hidden';
  const running = () => active && !paused && visible && !pageHidden();
  function message(value = '') { $('[data-preview-message]').textContent = value; }

  // The clock ---------------------------------------------------------------------------

  function schedule() {
    if (handle !== null || !running()) return;
    handle = clock.frame(onFrame);
  }
  function unschedule() {
    if (handle !== null) clock.cancel(handle);
    handle = null;
  }
  function onFrame() {
    handle = null;
    if (!running()) return;
    const now = clock.now();
    // dt is the measured time since the previous frame, or since the clock
    // was last resumed, so a pause never turns into a jump.
    const dt = lastTime === null ? 0 : Math.max(0, (now - lastTime) / 1000);
    lastTime = now;
    show(player.step(dt));
    schedule();
  }
  // Starts or stops the frame loop after a change of `paused`, `visible` or
  // page visibility.
  function syncClock() {
    if (running()) {
      if (handle === null) lastTime = clock.now();
      schedule();
    } else {
      unschedule();lastTime = null;
    }
    renderControls();
  }
  // A tick that advances no time, for changes that should show at once:
  // starting, a request, a control, a restart, or a document change. In the
  // runtime this is a rendered frame at the same timeline time.
  function stepNow() {
    show(player.step(0));
  }

  // Mode ----------------------------------------------------------------------------------

  // The state to request on entering: the selected state, otherwise the one a
  // new clip requests (the lowest id with a loop, otherwise the lowest id).
  function initialRequest(d) {
    const selected = session.selection;
    if (selected?.kind === 'node' && nodeById(d, selected.id)) return selected.id;
    const ids = d.nodes.map(node => node.id).sort((a, b) => a - b);
    const looped = new Set(d.edges.filter(edge => edge.from === edge.to).map(edge => edge.from));
    return ids.find(id => looped.has(id)) ?? ids[0] ?? null;
  }
  function start() {
    const d = doc();
    if (active || !d) return false;
    active = true;paused = false;
    timeline.stop();timeline.setPreview(true);
    // A fresh machine, but the controls keep the values set last time.
    const inputs = {...player.inputs};
    player = createPlayer({seed});
    Object.assign(player.inputs, inputs);
    player.setGraph(d);
    request(initialRequest(d), false);
    shown = {frame: undefined, highlight: '', where: '', heading: ''};
    message('');
    graph.setPreview({onRequest: id => request(id), panel});
    stepNow();
    syncClock();
    return true;
  }
  function stop() {
    if (!active) return false;
    active = false;paused = false;
    unschedule();lastTime = null;
    graph.setPreview(null);
    canvas.setPreview(null);
    timeline.setPreview(false);
    return true;
  }
  const toggle = () => active ? stop() : start();

  // Inputs -------------------------------------------------------------------------------

  function request(id, apply = true) {
    requested = id ?? null;
    player.inputs.state = requested;
    if (apply && active) stepNow();
  }
  function setInputs(values) {
    const inputs = player.inputs;
    if (values.urgency !== undefined && Number.isFinite(Number(values.urgency))) inputs.urgency = clamp(Number(values.urgency), 0, 1);
    if (values.rate !== undefined && Number.isFinite(Number(values.rate))) inputs.rate = clamp(Number(values.rate), 0, MAX_RATE);
    if (values.loop !== undefined) inputs.loop = Boolean(values.loop);
    if (values.randomize !== undefined) inputs.randomize = Boolean(values.randomize);
    renderControls();
    if (active) stepNow();
  }
  function restart() {
    if (!active) return;
    player.restart();
    stepNow();
    if (running()) lastTime = clock.now();
  }
  function setPaused(value) {
    if (!active) return;
    paused = Boolean(value);
    syncClock();
    renderStatus(true);
  }

  // Output -------------------------------------------------------------------------------

  function show(frame) {
    const d = doc();
    if (!active || !d) return;
    // A frame the document no longer holds cannot be drawn; it shows as empty.
    const value = frame !== null && d.pixels.has(frame) ? frame : null;
    if (value !== shown.frame) {
      shown.frame = value;
      canvas.setPreview({frame: value});
    }
    const position = machinePosition(player.graph, player.state);
    const highlight = {node: position.node, edge: position.edge, requested: position.requested, reversed: position.reversed};
    const key = JSON.stringify(highlight);
    if (key !== shown.highlight) {
      shown.highlight = key;
      graph.setHighlight(highlight);
    }
    renderStatus();
  }
  // Plain sentences for where the machine is, what it plays and where it is
  // heading. Names are wrapped so they keep their case.
  function describe() {
    const d = doc(), g = player.graph, state = player.state;
    const name = index => `<span class="anim-name">${text(nodeLabel(g.nodes[index]))}</span>`;
    if (!d.nodes.length) return {where: 'This animation has no states yet. Add one to preview it.', heading: ''};
    const position = state.position;
    if (position.kind === 'unplaced') {
      return {where: requested !== null && !nodeById(d, requested) ? 'The requested state no longer exists. Click a state to request another.' : 'Click a state to request it.', heading: ''};
    }
    let where, arrival;
    if (position.kind === 'resting') {
      arrival = position.node;
      const hasLoop = g.edgeEnds.some(([from, to]) => from === position.node && to === position.node);
      where = `Resting at ${name(position.node)}. ${hasLoop ? 'Loop is off' : 'It has no loop'}, so the output is empty.`;
    } else {
      const edge = g.edges[position.edge], [from, to] = g.edgeEnds[position.edge];
      const drawing = `drawing ${position.step + 1} of ${edge.frames.length}`;
      arrival = position.reversed ? from : to;
      if (from === to) where = `Playing the loop on ${name(from)}, ${drawing}.`;
      else where = `Playing the edge from ${name(from)} to ${name(to)}${position.reversed ? ' backwards' : ''}, ${drawing}.`;
    }
    const target = state.request;
    let heading = '';
    if (target !== null && target !== arrival) {
      const left = distance(g, arrival, target);
      heading = left === null ? `Heading to ${name(target)}. There is no route from ${name(arrival)}, so it cuts there.`
        : `Heading to ${name(target)}, ${left} more ${left === 1 ? 'edge' : 'edges'} after this one.`;
    } else if (position.kind === 'edge' && g.edgeEnds[position.edge][0] !== g.edgeEnds[position.edge][1]) {
      heading = `Heading to ${name(target)}, arriving after this edge.`;
    }
    if (requested !== null && !nodeById(d, requested)) heading = 'The requested state no longer exists. Click a state to request another.';
    return {where, heading};
  }
  function renderStatus(force = false) {
    if (!active || !doc()) return;
    const {where, heading} = describe();
    const full = (paused ? 'Paused. ' : '') + where;
    if (force || full !== shown.where) { shown.where = full;$('[data-preview-where]').innerHTML = full; }
    if (force || heading !== shown.heading) { shown.heading = heading;$('[data-preview-heading]').innerHTML = heading; }
  }
  function place(key, raw) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    placement[key] = key === 'scale' ? clamp(value, 0.25, MAX_SCALE) : clamp(value, 0, 1);
    renderControls();
  }
  function renderControls() {
    const inputs = player.inputs, focused = document.activeElement;
    const pause = $('[data-preview-pause]');
    const label = paused ? 'Resume' : 'Pause';
    if (pause.getAttribute('aria-label') !== label || !pause.firstChild) { pause.innerHTML = icon(paused ? 'play' : 'pause');pause.setAttribute('aria-label', label); }
    pause.setAttribute('aria-pressed', String(paused));
    const urgency = $('[data-preview-urgency]');
    if (urgency !== focused) urgency.value = String(inputs.urgency);
    $('[data-preview-urgency-value]').textContent = inputs.urgency.toFixed(2);
    const rate = $('[data-preview-rate]');
    if (rate !== focused) rate.value = literal(inputs.rate);
    for (const key of ['u', 'v']) {
      const slider = $(`[data-preview-place="${key}"]`);
      if (slider !== focused) slider.value = String(placement[key]);
      $(`[data-preview-place-value="${key}"]`).textContent = placement[key].toFixed(2);
    }
    const scale = $('[data-preview-scale]');
    if (scale !== focused) scale.value = literal(placement.scale);
    $('[data-preview-loop]').checked = inputs.loop;
    $('[data-preview-randomize]').checked = inputs.randomize;
    $('[data-preview-copy]').disabled = !callText();
  }

  // The matching Grain call ------------------------------------------------------------------

  // `animation_graph("<folder>/<name>", state: "<state>", ...)` with the
  // arguments at their defaults left out, or null without an asset or a state.
  function callText() {
    const d = doc(), path = reference();
    if (!d || !path) return null;
    const machineRequest = player.state.request;
    const state = (requested !== null && nodeById(d, requested)) || (machineRequest !== null ? player.graph.nodes[machineRequest] : null);
    if (!state) return null;
    const inputs = player.inputs, args = [JSON.stringify(path), `state: ${state.name ? JSON.stringify(state.name) : state.id}`];
    if (inputs.urgency !== CALL_DEFAULTS.urgency) args.push(`urgency: ${literal(inputs.urgency)}`);
    if (inputs.rate !== CALL_DEFAULTS.rate) args.push(`rate: ${literal(inputs.rate)}`);
    if (inputs.loop !== CALL_DEFAULTS.loop) args.push(`loop: ${inputs.loop}`);
    if (inputs.randomize !== CALL_DEFAULTS.randomize) args.push(`randomize: ${inputs.randomize}`);
    for (const key of ['u', 'v', 'scale']) if (placement[key] !== PLACEMENT_DEFAULTS[key]) args.push(`${key}: ${literal(placement[key])}`);
    return `animation_graph(${args.join(', ')})`;
  }
  async function copyCall() {
    const call = callText();
    if (!call) return;
    try {
      await globalThis.navigator.clipboard.writeText(call);
      message('Copied the call.');
    } catch {
      message(`Copying is not available here; the call is ${call}`);
    }
  }

  // Events ---------------------------------------------------------------------------------------

  panel.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.matches('[data-preview-pause]')) setPaused(!paused);
    else if (button.matches('[data-preview-restart]')) restart();
    else if (button.matches('[data-preview-copy]')) copyCall();
  });
  panel.addEventListener('input', event => {
    if (event.target.matches('[data-preview-urgency]')) setInputs({urgency: Number(event.target.value)});
    else if (event.target.matches('[data-preview-place]')) place(event.target.dataset.previewPlace, event.target.value);
  });
  panel.addEventListener('change', event => {
    const input = event.target;
    if (input.matches('[data-preview-urgency]')) setInputs({urgency: Number(input.value)});
    else if (input.matches('[data-preview-rate]')) {
      // An empty or invalid field goes back to the value in force.
      if (input.value === '' || !Number.isFinite(Number(input.value))) { input.value = literal(player.inputs.rate);return; }
      setInputs({rate: Number(input.value)});
      input.value = literal(player.inputs.rate);
    } else if (input.matches('[data-preview-place]')) place(input.dataset.previewPlace, input.value);
    else if (input.matches('[data-preview-scale]')) {
      if (input.value !== '') place('scale', input.value);
      input.value = literal(placement.scale);
    } else if (input.matches('[data-preview-loop]')) setInputs({loop: input.checked});
    else if (input.matches('[data-preview-randomize]')) setInputs({randomize: input.checked});
  });
  const onVisibility = () => syncClock();
  globalThis.document?.addEventListener('visibilitychange', onVisibility);

  // Escape leaves the preview. Space reaches the preview through the canvas's
  // play toggle, so Space-drag still pans the canvas.
  function handleKey(event) {
    if (!active || event.defaultPrevented || event.key !== 'Escape') return false;
    if (event.target?.closest?.('textarea,[contenteditable],dialog')) return false;
    event.preventDefault();
    stop();
    graph.svg?.focus?.({preventScroll: true});
    return true;
  }

  // The document changed under the preview. Opening, closing or reloading a
  // file ends it. An edit, undo or redo rebuilds the graph and keeps playing:
  // a change of structure restarts the machine, other changes keep it, as in
  // the runtime (rule 11).
  function update(event) {
    if (!active) return;
    if (['open', 'close', 'reload'].includes(event.reason) || !doc()) { stop();return; }
    if (!['edit', 'undo', 'redo', 'rename'].includes(event.reason)) return;
    player.setGraph(doc());
    shown.frame = undefined;
    stepNow();
    renderControls();
  }

  return {
    panel,
    update,
    handleKey,
    start,
    stop,
    toggle,
    request,
    restart,
    setInputs,
    pause: () => setPaused(true),
    resume: () => setPaused(false),
    togglePause: () => setPaused(!paused),
    // The animation view is shown or hidden; the clock runs only while shown.
    setVisible(value) { visible = Boolean(value);if (active) syncClock(); },
    get active() { return active; },
    get paused() { return paused; },
    get running() { return running(); },
    get requested() { return requested; },
    get inputs() { return {...player.inputs}; },
    get player() { return player; },
    get frame() { return active ? shown.frame ?? null : null; },
    get call() { return callText(); },
    // The graph and the canvas may already be gone, so they are left alone.
    destroy() {
      active = false;unschedule();
      globalThis.document?.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
