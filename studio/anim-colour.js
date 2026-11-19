// The colour controls of the drawing canvas (docs/animation-graph-plan.md
// 6.6): hue, saturation and value with hex entry and alpha for Image, grey
// and alpha for Matte, one value for Field, and the swatches saved in the
// file's `palette`. The paint colour is view state, kept per pixel format, so
// switching between animations keeps a sensible colour for each. A second
// colour sits next to it for the tools that run between two colours (noise,
// gradient, value modes); the controls edit whichever of the two is selected.
//
// A vector animation uses the same controls for the fill and the outline of a
// shape: its colours are solid, so it has the hue, saturation and value of an
// Image, and the alpha control can be left out, since opacity is a property of
// its own there.

import {normalizeColour, toHex, parseHex, hsvToRgb, rgbToHsv, decodeValue, encodeValue} from './anim-paint.js';
import {addSwatch, removeSwatch} from './anim-model.js';
import {icon} from './icons.js';

const DEFAULT_COLOUR = [255, 255, 255, 255];
const DEFAULT_SECOND = [0, 0, 0, 255];
const DEFAULT_SLOTS = {
  first: {label: 'First colour, the paint colour', title: 'First colour: the paint colour'},
  second: {label: 'Second colour, for noise, gradients and value modes', title: 'Second colour: for noise, gradients and value modes'},
};
const css = ([r, g, b, a]) => `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
const text = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const byte = value => clamp(Math.round(Number(value) || 0), 0, 255);
// The controls a format gets: a vector animation's colours are those of an Image.
const controlsOf = format => format === 'matte' || format === 'field' ? format : 'image';

// `onChange(colour, which)` runs after every change of a colour; `which` is
// 'first', 'second', or 'both' after a swap. `slots` names the two colours
// ({first, second}, each {label, title}); `alpha: false` leaves out the alpha
// control and keeps both colours opaque.
export function createColourPicker({parent, session, onChange = () => {}, onMessage = () => {}, slots = DEFAULT_SLOTS, alpha = true}) {
  parent.classList.add('anim-colour');
  const fresh = () => ({first: DEFAULT_COLOUR.slice(), second: DEFAULT_SECOND.slice()});
  const colours = {image: fresh(), matte: fresh(), field: fresh(), vector: fresh()};
  // The colour the controls edit: 'first' (the paint colour) or 'second'.
  let slot = 'first';
  // Hue and saturation survive black and grey, which have neither.
  let hsv = rgbToHsv(...DEFAULT_COLOUR), renderedFormat = null, svDrag = null;

  const format = () => session.doc?.format in colours ? session.doc.format : 'image';
  const current = () => colours[format()][slot];
  const colour = () => colours[format()].first.slice();
  const colour2 = () => colours[format()].second.slice();
  const $ = selector => parent.querySelector(selector);
  const opaque = value => alpha ? value : [value[0], value[1], value[2], 255];

  // Sets the colour the controls edit; `which` ('first' or 'second') selects
  // the other one first.
  function set(next, which = slot, {keepHsv = false} = {}) {
    if (which !== slot) { slot = which;keepHsv = false; }
    const value = opaque(normalizeColour(format(), next));
    colours[format()][slot] = value;
    if (!keepHsv) syncHsv(value);
    sync();
    onChange(value.slice(), slot);
  }
  // Sets both colours without reporting a change, for colours that come from
  // the document, such as the fill and outline of the selected shape.
  function load({first, second}) {
    const pair = colours[format()];
    if (first) pair.first = opaque(normalizeColour(format(), first));
    if (second) pair.second = opaque(normalizeColour(format(), second));
    syncHsv(current());
    sync(true);
  }
  function syncHsv(value) {
    const next = rgbToHsv(value[0], value[1], value[2]);
    hsv = {h: next.s && next.v ? next.h : hsv.h, s: next.v ? next.s : hsv.s, v: next.v};
  }
  function setHsv(next) {
    hsv = {...hsv, ...next};
    const [r, g, b] = hsvToRgb(hsv.h, hsv.s, hsv.v);
    set([r, g, b, current()[3]], slot, {keepHsv: true});
  }
  function select(which) {
    if (which === slot) return;
    slot = which;
    syncHsv(current());
    sync(true);
  }
  function swap() {
    const pair = colours[format()];
    [pair.first, pair.second] = [pair.second, pair.first];
    syncHsv(current());
    sync(true);
    onChange(colour(), 'both');
  }

  function build() {
    renderedFormat = format();
    const kind = controlsOf(renderedFormat);
    const range = (data, label, max, title) => `<input type="range" ${data} min="0" max="${max}" step="1" aria-label="${label}" title="${title}">`;
    const number = (data, label, max, step = 1) => `<input type="number" ${data} min="0" max="${max}" step="${step}" aria-label="${label}">`;
    let controls = '';
    if (kind === 'image') {
      controls = `
        <div class="anim-sv" data-sv tabindex="0" role="slider" aria-label="Saturation and value" title="Saturation across, value up and down. Arrow keys adjust."><span class="anim-sv-marker"></span></div>
        <label class="anim-colour-control">Hue${range('data-hue', 'Hue', 359, 'Hue')}</label>
        ${alpha ? `<label class="anim-colour-control">Alpha<span class="anim-colour-pair">${range('data-alpha class="anim-alpha"', 'Alpha', 255, 'Alpha, 0 is transparent')}${number('data-alpha-number', 'Alpha value', 255)}</span></label>` : ''}`;
    } else if (kind === 'matte') {
      controls = `
        <label class="anim-colour-control">Grey<span class="anim-colour-pair">${range('data-grey class="anim-grey"', 'Grey', 255, 'Grey, stored as sRGB')}${number('data-grey-number', 'Grey value', 255)}</span></label>
        <label class="anim-colour-control">Alpha<span class="anim-colour-pair">${range('data-alpha class="anim-alpha"', 'Alpha', 255, 'Alpha, 0 is transparent')}${number('data-alpha-number', 'Alpha value', 255)}</span></label>`;
    } else {
      controls = `
        <label class="anim-colour-control">Value${range('data-byte class="anim-grey"', 'Stored byte', 255, 'The stored byte, 0 to 255')}</label>
        <div class="anim-colour-pair anim-field-values">
          <label title="The number the program reads: the byte decoded as sRGB, like Matte grey">Reads as${number('data-value', 'Value the program reads', 1, 0.001)}</label>
          <label title="The byte stored in the file">Byte${number('data-byte-number', 'Stored byte', 255)}</label>
        </div>`;
    }
    parent.innerHTML = `
      <div class="anim-colour-head">
        <span class="anim-colour-slots" role="group" aria-label="Colours">
          <button class="anim-colour-current anim-checker" data-slot="first" aria-pressed="true" aria-label="${text(slots.first.label)}" title="${text(slots.first.title)}"><span data-current></span></button>
          <button class="anim-colour-current anim-colour-second anim-checker" data-slot="second" aria-pressed="false" aria-label="${text(slots.second.label)}" title="${text(slots.second.title)}"><span data-current-second></span></button>
        </span>
        <button class="anim-icon-button anim-colour-swap" data-swap aria-label="Swap the two colours" title="Swap the two colours">${icon('swap')}</button>
        ${kind === 'image' ? `<label class="anim-hex">Hex<input data-hex maxlength="9" spellcheck="false" autocomplete="off" aria-label="Colour as hex, ${alpha ? '#rrggbbaa' : '#rrggbb'}"></label>` : ''}
      </div>
      ${controls}
      <section class="anim-swatches-section" aria-label="Swatches">
        <div class="anim-swatches-head"><h3>Swatches</h3><button class="anim-icon-button" data-swatch-toggle></button></div>
        <div class="anim-swatches" data-swatches role="list"></div>
      </section>`;
  }

  // Writes the colour into every control without rebuilding them, so a
  // dragged slider keeps its pointer.
  function sync(force = false) {
    if (renderedFormat !== format()) build();
    const value = current(), active = document.activeElement;
    const put = (selector, next) => { const input = $(selector);if (input && (force || input !== active)) input.value = String(next); };
    $('[data-current]').style.background = css(colours[format()].first);
    $('[data-current-second]').style.background = css(colours[format()].second);
    for (const button of parent.querySelectorAll('[data-slot]')) button.setAttribute('aria-pressed', String(button.dataset.slot === slot));
    const kind = controlsOf(renderedFormat);
    if (kind === 'image') {
      put('[data-hex]', alpha ? toHex(value) : toHex(value).slice(0, 7));
      put('[data-hue]', Math.round(hsv.h));
      const sv = $('[data-sv]');
      sv.style.setProperty('--anim-hue', `hsl(${Math.round(hsv.h)} 100% 50%)`);
      sv.setAttribute('aria-valuetext', `saturation ${Math.round(hsv.s * 100)}%, value ${Math.round(hsv.v * 100)}%`);
      Object.assign($('.anim-sv-marker').style, {left: hsv.s * 100 + '%', top: (1 - hsv.v) * 100 + '%'});
    }
    if (kind === 'matte') { put('[data-grey]', value[0]);put('[data-grey-number]', value[0]); }
    if (kind !== 'field') {
      put('[data-alpha]', value[3]);put('[data-alpha-number]', value[3]);
      parent.style.setProperty('--anim-alpha-colour', css([...value.slice(0, 3), 255]));
    } else {
      put('[data-byte]', value[0]);put('[data-byte-number]', value[0]);put('[data-value]', decodeValue(value[0]).toFixed(3));
    }
    renderSwatches();
  }

  function renderSwatches() {
    const doc = session.doc, palette = doc?.palette ?? [], now = toHex(current());
    const host = $('[data-swatches]'), focused = host.contains(document.activeElement) ? document.activeElement.dataset.swatch : null;
    const label = hex => format() === 'field' ? `value ${decodeValue(parseHex(hex)?.[0] ?? 0).toFixed(3)} (byte ${parseHex(hex)?.[0] ?? 0})`
      : format() === 'matte' ? `grey ${parseHex(hex)?.[0] ?? 0}, alpha ${parseHex(hex)?.[3] ?? 0}` : hex;
    host.innerHTML = palette.map(hex => {
      const shown = opaque(normalizeColour(format(), parseHex(hex) ?? [0, 0, 0, 0]));
      return `<button class="anim-swatch anim-checker" role="listitem" data-swatch="${text(hex)}" aria-pressed="${toHex(shown) === now}" aria-label="Use ${text(label(hex))}" title="${text(label(hex))}"><span style="background:${css(shown)}"></span></button>`;
    }).join('') || '<p class="anim-swatches-empty">No swatches saved.</p>';
    if (focused) host.querySelector(`[data-swatch="${focused}"]`)?.focus({preventScroll: true});
    const saved = palette.includes(now), toggle = $('[data-swatch-toggle]');
    const action = saved ? 'Remove swatch' : 'Save swatch';
    // Rebuilt only on a change, so a press in progress keeps its target.
    if (toggle.getAttribute('aria-label') !== action) { toggle.innerHTML = icon(saved ? 'minus' : 'plus');toggle.setAttribute('aria-label', action); }
    toggle.title = saved ? 'Remove the paint colour from the swatches' : 'Save the paint colour as a swatch in this animation';
    toggle.disabled = !doc || session.readOnly;
  }

  function edit(change) {
    try { session.edit(change); } catch (error) { onMessage(error.message || String(error)); }
  }

  parent.addEventListener('input', event => {
    const input = event.target, value = current();
    if (input.matches('[data-hue]')) setHsv({h: Number(input.value)});
    else if (input.matches('[data-alpha],[data-alpha-number]')) set([value[0], value[1], value[2], byte(input.value)], slot, {keepHsv: true});
    else if (input.matches('[data-grey],[data-grey-number]')) set([byte(input.value), 0, 0, value[3]]);
    else if (input.matches('[data-byte],[data-byte-number]')) set([byte(input.value), 0, 0, 255]);
    else if (input.matches('[data-value]') && input.value !== '') set([encodeValue(Number(input.value)), 0, 0, 255]);
    // A complete #rrggbb or #rrggbbaa applies while typing, so drawing right
    // after typing uses it; shorter forms apply when the field is left.
    else if (input.matches('[data-hex]') && /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.test(input.value.trim())) set(parseHex(input.value));
  });
  // Hex is applied when it parses, and put back when the field is left.
  parent.addEventListener('change', event => {
    const input = event.target;
    if (input.matches('[data-hex]')) {
      const parsed = parseHex(input.value);
      if (parsed) set(parsed);
      input.value = toHex(current());
    } else if (input.matches('[data-value],[data-alpha-number],[data-grey-number],[data-byte-number]')) {
      // Shows the stored result, such as the decoded value of the nearest byte.
      sync(true);
    }
  });
  parent.addEventListener('focusout', event => { if (event.target.matches?.('input')) queueMicrotask(() => sync()); });
  parent.addEventListener('keydown', event => {
    if (event.target.matches('[data-hex]') && event.key === 'Enter') { event.preventDefault();event.target.dispatchEvent(new Event('change', {bubbles: true})); }
    if (!event.target.matches('[data-sv]')) return;
    const steps = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]}[event.key];
    if (!steps) return;
    event.preventDefault();event.stopPropagation();
    const step = event.shiftKey ? 0.1 : 0.01;
    setHsv({s: clamp(hsv.s + steps[0] * step, 0, 1), v: clamp(hsv.v + steps[1] * step, 0, 1)});
  });
  parent.addEventListener('click', event => {
    const swatch = event.target.closest('[data-swatch]');
    if (swatch) { const parsed = parseHex(swatch.dataset.swatch);if (parsed) set(parsed);return; }
    const slotButton = event.target.closest('[data-slot]');
    if (slotButton) { select(slotButton.dataset.slot);return; }
    if (event.target.closest('[data-swap]')) { swap();return; }
    if (event.target.closest('[data-swatch-toggle]')) {
      const hex = toHex(current());
      edit(doc => (doc.palette.includes(hex) ? removeSwatch : addSwatch)(doc, hex));
    }
  });
  function svAt(event) {
    const box = $('[data-sv]').getBoundingClientRect();
    if (!box.width || !box.height) return;
    setHsv({s: clamp((event.clientX - box.left) / box.width, 0, 1), v: clamp(1 - (event.clientY - box.top) / box.height, 0, 1)});
  }
  parent.addEventListener('pointerdown', event => {
    if (!event.target.closest('[data-sv]') || event.button !== 0) return;
    event.preventDefault();
    const sv = $('[data-sv]');
    sv.focus({preventScroll: true});
    try { sv.setPointerCapture(event.pointerId); } catch {}
    svDrag = event.pointerId;
    svAt(event);
  });
  parent.addEventListener('pointermove', event => { if (svDrag === event.pointerId) svAt(event); });
  const endSv = event => { if (svDrag === event.pointerId) svDrag = null; };
  parent.addEventListener('pointerup', endSv);
  parent.addEventListener('pointercancel', endSv);

  build();sync();

  return {
    // The paint colour of the open animation's format, as [r, g, b, a].
    get colour() { return colour(); },
    // The second colour, as [r, g, b, a].
    get colour2() { return colour2(); },
    // Sets a colour: `which` is 'first' or 'second' and defaults to the
    // colour the controls edit; the controls then edit that colour.
    set(next, which = slot) { set(next, which); },
    load,
    // The colour the controls edit: 'first' or 'second'.
    get slot() { return slot; },
    select,
    swap,
    update() { sync(); },
    // Rewrites the controls after an outside change, such as the eyedropper.
    refresh() { sync(true); },
    destroy() { parent.replaceChildren(); },
  };
}
