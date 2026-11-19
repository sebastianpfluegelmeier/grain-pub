// The speed curve editor of the keyframe timeline (docs/vector-animation-design.md,
// sections 4, 7 and 11): the cubic Bézier from (0, 0) to (1, 1) that a
// keyframe's move follows, as in CSS cubic-bezier, with its two control
// points and four presets. Across the square is the share of the move's time,
// up the share of the way from one value to the next; a control point may
// leave the square up or down, so the value overshoots.
//
// A drag keeps a draft and reports the curve once, when the pointer is let
// go, so the owner records one undo step per drag.

import {icon} from './icons.js';

export const CURVE_PRESETS = Object.freeze([
  {id: 'linear', label: 'Linear', curve: null},
  {id: 'ease-in', label: 'Ease in', curve: Object.freeze([0.42, 0, 1, 1])},
  {id: 'ease-out', label: 'Ease out', curve: Object.freeze([0, 0, 0.58, 1])},
  {id: 'ease-in-out', label: 'Ease in and out', curve: Object.freeze([0.42, 0, 0.58, 1])},
]);
// The heights a control point can take: half the square above and below it.
export const CURVE_Y_MIN = -0.5;
export const CURVE_Y_MAX = 1.5;
// A linear move is drawn with its control points a third of the way along
// the diagonal (the same straight curve), where a finger can take them.
const LINEAR_POINTS = [1 / 3, 1 / 3, 2 / 3, 2 / 3];
// The square is UNIT viewBox units wide, with PAD around the whole range.
const UNIT = 100, PAD = 12;
const WIDTH = UNIT + 2 * PAD, HEIGHT = (CURVE_Y_MAX - CURVE_Y_MIN) * UNIT + 2 * PAD;
// How close a press has to come to a control point, in screen pixels.
const HIT_RADIUS = {mouse: 10, pen: 16, touch: 30};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
// Curve values are kept to thousandths, as CSS easings are written.
const round = value => Math.round(value * 1000) / 1000 || 0;
const same = (a, b) => Math.abs(a - b) < 1e-9;
const number = value => String(round(value));

// The id of the preset a curve equals, or null. A curve whose control points
// both lie on the diagonal moves at constant speed, so it counts as linear.
export function presetOf(curve) {
  if (!curve || (same(curve[0], curve[1]) && same(curve[2], curve[3]))) return 'linear';
  return CURVE_PRESETS.find(preset => preset.curve && preset.curve.every((value, index) => same(value, curve[index])))?.id ?? null;
}

// `onChange(curve)` gets the new curve, four numbers or null for linear, once
// per drag and per preset; `onClose()` runs when the close button is pressed.
export function createCurveEditor({parent, onChange = () => {}, onClose = () => {}}) {
  parent.classList.add('anim-curve');
  const x = value => PAD + value * UNIT, y = value => PAD + (CURVE_Y_MAX - value) * UNIT;
  parent.innerHTML = `
    <svg class="anim-curve-graph" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="group" aria-label="Speed curve. Drag the two round handles to shape it.">
      <rect class="anim-curve-square" x="${x(0)}" y="${y(1)}" width="${UNIT}" height="${UNIT}"/>
      <path class="anim-curve-diagonal" d="M${x(0)} ${y(0)}L${x(1)} ${y(1)}"/>
      <path class="anim-curve-arm" data-arm="1"/>
      <path class="anim-curve-arm" data-arm="2"/>
      <path class="anim-curve-line" data-line/>
      <circle class="anim-curve-end" cx="${x(0)}" cy="${y(0)}" r="3"/>
      <circle class="anim-curve-end" cx="${x(1)}" cy="${y(1)}" r="3"/>
      <circle class="anim-curve-handle" data-handle="1"/>
      <circle class="anim-curve-handle" data-handle="2"/>
    </svg>
    <div class="anim-curve-side">
      <div class="anim-curve-head"><h4>Speed curve</h4>
        <button class="anim-icon-button" data-curve-close aria-label="Close the speed curve" title="Close the speed curve and deselect the keyframe">${icon('x')}</button></div>
      <div class="anim-curve-presets" role="group" aria-label="Presets">
        ${CURVE_PRESETS.map(preset => `<button data-curve-preset="${preset.id}" aria-pressed="false">${preset.label}</button>`).join('')}
      </div>
      <p class="anim-curve-values" data-curve-values></p>
      <p class="anim-curve-note" data-curve-note></p>
    </div>`;
  const $ = selector => parent.querySelector(selector);
  const svg = $('svg');

  // The curve on show, the one the owner gave or a drag's draft.
  let curve = null, enabled = true, drag = null;
  const coarse = () => Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches);
  const points = () => curve ?? LINEAR_POINTS;

  function render() {
    const [x1, y1, x2, y2] = points();
    $('[data-line]').setAttribute('d', `M${x(0)} ${y(0)}C${x(x1)} ${y(y1)} ${x(x2)} ${y(y2)} ${x(1)} ${y(1)}`);
    $('[data-arm="1"]').setAttribute('d', `M${x(0)} ${y(0)}L${x(x1)} ${y(y1)}`);
    $('[data-arm="2"]').setAttribute('d', `M${x(1)} ${y(1)}L${x(x2)} ${y(y2)}`);
    const radius = coarse() ? 8 : 6;
    for (const [which, hx, hy] of [[1, x1, y1], [2, x2, y2]]) {
      const handle = $(`[data-handle="${which}"]`);
      handle.setAttribute('cx', String(x(hx)));handle.setAttribute('cy', String(y(hy)));handle.setAttribute('r', String(radius));
      handle.classList.toggle('active', drag?.handle === which);
    }
    const preset = presetOf(curve);
    for (const button of parent.querySelectorAll('[data-curve-preset]')) {
      button.setAttribute('aria-pressed', String(button.dataset.curvePreset === preset));
      button.disabled = !enabled;
    }
    $('[data-curve-values]').textContent = curve ? curve.map(number).join(', ') : 'linear';
    parent.classList.toggle('disabled', !enabled);
  }

  // The curve point under a client position, and the screen size of one unit.
  function locate(event) {
    const rect = svg.getBoundingClientRect();
    const scale = rect.width > 0 ? rect.width / WIDTH : 1;
    const px = (event.clientX - rect.left) / scale, py = (event.clientY - rect.top) / scale;
    return {x: (px - PAD) / UNIT, y: CURVE_Y_MAX - (py - PAD) / UNIT, pixels: UNIT * scale};
  }
  svg.addEventListener('pointerdown', event => {
    if (!enabled || drag || event.button !== 0) return;
    const p = locate(event), [x1, y1, x2, y2] = points();
    const reach = (HIT_RADIUS[event.pointerType] ?? HIT_RADIUS.mouse) / p.pixels;
    const gap = (hx, hy) => Math.hypot(hx - p.x, hy - p.y);
    const first = gap(x1, y1), second = gap(x2, y2);
    if (Math.min(first, second) > reach) return;
    // The nearer point; where they lie on each other, the one that can still
    // move apart from the other.
    const handle = first < second || (first === second && p.x < (x1 + x2) / 2) ? 1 : 2;
    event.preventDefault();
    try { svg.setPointerCapture(event.pointerId); } catch {}
    const [hx, hy] = handle === 1 ? [x1, y1] : [x2, y2];
    drag = {pointerId: event.pointerId, handle, start: curve, offsetX: hx - p.x, offsetY: hy - p.y, moved: false};
    curve = points().map(round);
    render();
  });
  svg.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const p = locate(event), at = drag.handle === 1 ? 0 : 2;
    const next = curve.slice();
    next[at] = round(clamp(p.x + drag.offsetX, 0, 1));
    next[at + 1] = round(clamp(p.y + drag.offsetY, CURVE_Y_MIN, CURVE_Y_MAX));
    drag.moved ||= next.some((value, index) => value !== curve[index]);
    curve = next;
    render();
  });
  // Letting go reports the curve; a cancelled pointer puts the curve back.
  function finish(event, keep) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const ended = drag;
    drag = null;
    try { if (svg.hasPointerCapture?.(ended.pointerId)) svg.releasePointerCapture(ended.pointerId); } catch {}
    if (!keep || !ended.moved) { curve = ended.start;render();return; }
    const result = presetOf(curve) === 'linear' ? null : curve.slice();
    curve = result;
    render();
    onChange(result);
  }
  svg.addEventListener('pointerup', event => finish(event, true));
  svg.addEventListener('pointercancel', event => finish(event, false));
  // Capture lost without a pointerup (the window lost the pointer) ends the
  // drag where it got to.
  svg.addEventListener('lostpointercapture', event => finish(event, true));
  // Safari starts a scroll from a touch drag unless touchmove is cancelled.
  svg.addEventListener('touchmove', event => { if (drag) event.preventDefault(); }, {passive: false});

  parent.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.matches('[data-curve-close]')) onClose();
    else if (button.matches('[data-curve-preset]')) {
      const preset = CURVE_PRESETS.find(item => item.id === button.dataset.curvePreset);
      curve = preset.curve && preset.curve.slice();
      render();
      onChange(curve && curve.slice());
    }
  });

  render();
  return {
    // Shows `curve` (four numbers or null) unless a drag is under way, which
    // keeps its draft. `enabled` false shows it without taking input; `note`
    // is a line under the presets.
    show({curve: value = null, enabled: on = true, note = ''} = {}) {
      enabled = Boolean(on);
      $('[data-curve-note]').textContent = note;
      if (drag) return;
      curve = value ? value.slice() : null;
      render();
    },
    get curve() { return curve && curve.slice(); },
    get dragging() { return Boolean(drag); },
    destroy() { drag = null;parent.replaceChildren(); },
  };
}
