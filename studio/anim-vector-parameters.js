// The parameters of a vector animation in the shapes panel
// (docs/vector-animation-design.md, sections 6, 7 and 11): the animation's
// parameters, each with a slider for its preview value, its default and the
// slider's range; and, for the selected shape, the parameters assigned to its
// number properties with their factors.
//
// A slider sets the parameter's preview value, which the session keeps
// (session.parameterValues): editor state that the canvas, its keyframe
// ghosts and the graph preview draw with. It is not saved and never an undo
// step. While the graph preview runs only the sliders are shown.

import {sliderRange, trackNames, isColorTrack} from './anim-vector.js';
import {edgeById, isVectorDocument, addParameter, setParameter, renameParameter, deleteParameter, checkParameterName,
  addAssignment, setAssignmentFactor, removeAssignment} from './anim-model.js';
import {icon} from './icons.js';

const text = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// Parameter values and factors are shown to thousandths.
const decimal = value => String(Math.round(value * 1000) / 1000 || 0);
// The slider moves in hundredths of its range, rounded down to a power of ten.
export const sliderStep = (min, max) => 10 ** Math.floor(Math.log10((max - min) / 100));
// Every number property of a shape can take a parameter; colours cannot.
export const assignableTracks = shape => trackNames(shape.kind, shape.kind === 'polygon' ? shape.points : 0).filter(name => !isColorTrack(name));
// How many assignments use parameter `name`, over every shape of every edge.
export function assignmentCount(doc, name) {
  let count = 0;
  for (const edge of doc.edges) for (const shape of edge.shapes ?? []) for (const assignment of shape.assignments) if (assignment.parameter === name) count++;
  return count;
}

// `parameters` is the panel section for the list, `assignments` the element
// in the selected shape's properties for its assignments. `propertyName(track)`
// names a property for people. `onInteract()` runs before an edit;
// `onMessage(text)` shows why an edit was refused.
export function createParameterPanel({parameters, assignments, session, propertyName = name => name, onInteract = () => {}, onMessage = () => {}}) {
  parameters.innerHTML = `
    <div class="anim-vector-head"><h3>Parameters</h3>
      <button class="anim-vector-keyframe" data-parameter-add title="Add a parameter">${icon('plus')}<span>Add</span></button></div>
    <p class="anim-vector-note" data-parameters-empty hidden>A parameter is a number the program passes when it plays the animation. Assign it to properties of shapes, then move its slider here to see what it does.</p>
    <ul class="anim-parameter-list" data-parameter-list></ul>`;
  assignments.innerHTML = `
    <h4>Assigned parameters</h4>
    <ul class="anim-assignment-list" data-assignment-list></ul>
    <div class="anim-assignment-add" data-assignment-add></div>`;
  const list = parameters.querySelector('[data-parameter-list]'), assignmentList = assignments.querySelector('[data-assignment-list]');
  const adder = assignments.querySelector('[data-assignment-add]');

  // Parameters whose settings are open, by name.
  const expanded = new Set();
  // A name being typed that is not applied yet, by parameter name: {text, error}.
  const drafts = new Map();
  // Why the last change of a default or range was refused, by parameter name.
  const errors = new Map();
  // What the assignment row offers next: a property and a parameter name.
  const choice = {property: null, parameter: null};
  let previewing = false, builtList = '', builtAssignments = '';

  const doc = () => session.doc && isVectorDocument(session.doc) ? session.doc : null;
  const editable = () => Boolean(doc()) && !session.readOnly;
  const edge = () => doc() && session.edge !== null ? edgeById(doc(), session.edge) : null;
  const shape = () => { const e = edge(), index = session.shape;return e && index !== null ? e.shapes[index] ?? null : null; };
  const byName = name => doc()?.parameters.find(parameter => parameter.name === name) ?? null;
  const rangeOf = parameter => sliderRange(parameter.default, parameter.min, parameter.max);
  const coarse = () => Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches);

  function edit(change) {
    try {
      onInteract();
      const result = session.edit(change);
      onMessage('');
      return result;
    } catch (error) {
      onMessage(error.message || String(error));
      return undefined;
    }
  }

  // Parameters ---------------------------------------------------------------------------

  // Adds `param`, `param_2`, ... and opens its settings, so it can be named.
  function add() {
    if (!editable()) return null;
    const parameter = edit(d => addParameter(d));
    if (!parameter) return null;
    expanded.add(parameter.name);
    render();
    const field = list.querySelector(`[data-parameter="${parameter.name}"] [data-parameter-name]`);
    // On a touch screen focusing the field would bring up the keyboard.
    if (field && !coarse()) { field.focus();field.select(); }
    return parameter.name;
  }
  // Renames parameter `name` and every assignment to it. A refused name stays
  // in the field with the reason under it. Returns true when renamed.
  function rename(name, next) {
    const d = doc();
    if (!editable() || !byName(name)) return false;
    if (next === name) { drafts.delete(name);render();return false; }
    try { checkParameterName(d, next, name); } catch (error) {
      drafts.set(name, {text: next, error: error.message});
      render();
      return false;
    }
    // The slider keeps its value and the settings stay open under the new
    // name; the edit's own update already dropped the old name's.
    const value = session.parameterValues?.[name], moved = value !== undefined && value !== byName(name).default, wasOpen = expanded.has(name);
    if (edit(change => renameParameter(change, name, next)) === undefined) return false;
    drafts.delete(name);expanded.delete(name);
    if (wasOpen) expanded.add(next);
    if (moved) session.setParameterValue?.(next, value);
    render();
    return true;
  }
  // Removes a parameter and its assignments; asks first when it has any.
  function remove(name) {
    const d = doc();
    if (!editable() || !byName(name)) return false;
    const count = assignmentCount(d, name);
    if (count && !globalThis.confirm?.(`Delete ${name}? It is assigned to ${count === 1 ? 'one property' : `${count} properties`}, and ${count === 1 ? 'that assignment is' : 'those assignments are'} removed with it.`)) return false;
    if (edit(change => deleteParameter(change, name)) === undefined) return false;
    expanded.delete(name);drafts.delete(name);errors.delete(name);
    render();
    return true;
  }
  // Sets the default ('default') or one end of the slider ('min', 'max').
  function setField(name, key, value) {
    const parameter = byName(name);
    if (!editable() || !parameter || !Number.isFinite(value)) { renderValues();return false; }
    const {min, max} = rangeOf(parameter);
    const changes = key === 'default' ? {default: value} : key === 'min' ? {min: value, max} : {min, max: value};
    let done;
    try {
      onInteract();
      done = session.edit(d => setParameter(d, name, changes));
      errors.delete(name);
    } catch (error) {
      errors.set(name, error.message || String(error));
    }
    render();
    return done !== undefined;
  }

  // Assignments --------------------------------------------------------------------------

  function assign(property, parameter, factor = 1) {
    const e = edge(), index = session.shape;
    if (!editable() || !shape()) return false;
    return edit(d => addAssignment(d, e.id, index, property, parameter, factor)) !== undefined;
  }
  function setFactor(property, parameter, factor) {
    const e = edge(), index = session.shape;
    if (!editable() || !shape() || !Number.isFinite(factor)) { renderValues();return false; }
    return edit(d => setAssignmentFactor(d, e.id, index, property, parameter, factor)) !== undefined;
  }
  function unassign(property, parameter) {
    const e = edge(), index = session.shape;
    if (!editable() || !shape()) return false;
    return edit(d => removeAssignment(d, e.id, index, property, parameter)) !== undefined;
  }

  // Rendering ----------------------------------------------------------------------------

  function parameterMarkup(parameter) {
    const name = text(parameter.name), open = expanded.has(parameter.name) && !previewing, disabled = editable() ? '' : 'disabled';
    return `<li class="anim-parameter" data-parameter="${name}">
      <div class="anim-parameter-head">
        <span class="anim-parameter-name">${name}</span>
        <output class="anim-parameter-value" data-parameter-value></output>
        <button class="anim-parameter-reset" data-parameter-reset title="Put the slider back to the default">Reset</button>
        ${previewing ? '' : `<button class="anim-icon-button" data-parameter-edit aria-expanded="${open}" aria-label="Settings of ${name}" title="${open ? 'Close the settings' : 'Name, default and slider range'}">${icon('sliders-horizontal')}</button>`}
      </div>
      <input type="range" class="anim-parameter-slider" data-parameter-slider aria-label="Preview value of ${name}">
      ${open ? `<div class="anim-parameter-settings">
        <label class="anim-property"><span class="anim-property-name">Name</span><input class="anim-parameter-rename" data-parameter-name maxlength="64" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" ${disabled}></label>
        <p class="anim-parameter-error" role="alert" data-parameter-error></p>
        <div class="anim-property" title="The value the program gets when it does not pass this parameter"><span class="anim-property-name">Default</span><input type="number" data-parameter-field="default" aria-label="Default of ${name}" ${disabled}></div>
        <div class="anim-property" title="Where the slider starts. The program may pass any number."><span class="anim-property-name">Slider from</span><input type="number" data-parameter-field="min" aria-label="Slider start of ${name}" ${disabled}></div>
        <div class="anim-property" title="Where the slider ends. The program may pass any number."><span class="anim-property-name">Slider to</span><input type="number" data-parameter-field="max" aria-label="Slider end of ${name}" ${disabled}></div>
        <div class="anim-parameter-actions"><button class="anim-icon-button danger" data-parameter-delete aria-label="Delete ${name}" title="Delete this parameter and its assignments" ${disabled}>${icon('trash')}</button></div>
      </div>` : ''}
    </li>`;
  }
  // The list is built when parameters come or go or a settings block opens,
  // and otherwise only refilled, so a dragged slider and a focused field stay.
  function renderList() {
    const d = doc();
    parameters.hidden = !d;
    if (!d) { list.innerHTML = '';builtList = '';return; }
    const key = JSON.stringify([d.parameters.map(parameter => [parameter.name, expanded.has(parameter.name)]), editable(), previewing]);
    if (key !== builtList) {
      const focused = list.contains(document.activeElement) ? [document.activeElement.closest('[data-parameter]')?.dataset.parameter, focusKey(document.activeElement)] : null;
      builtList = key;
      list.innerHTML = d.parameters.map(parameterMarkup).join('');
      if (focused?.[0]) list.querySelector(`[data-parameter="${focused[0]}"] ${focused[1]}`)?.focus({preventScroll: true});
    }
    parameters.querySelector('[data-parameters-empty]').hidden = d.parameters.length > 0;
    const addButton = parameters.querySelector('[data-parameter-add]');
    addButton.disabled = !editable();
    addButton.hidden = previewing;
  }
  const focusKey = element => ['data-parameter-slider', 'data-parameter-name', 'data-parameter-edit', 'data-parameter-reset', 'data-parameter-delete']
    .map(attribute => `[${attribute}]`).find(selector => element.matches(selector))
    ?? (element.dataset.parameterField ? `[data-parameter-field="${element.dataset.parameterField}"]` : '[data-parameter-slider]');
  function renderValues() {
    const d = doc();
    if (!d) return;
    const values = session.parameterValues ?? {}, active = document.activeElement;
    for (const parameter of d.parameters) {
      const item = list.querySelector(`[data-parameter="${parameter.name}"]`);
      if (!item) continue;
      const value = values[parameter.name] ?? parameter.default, {min, max} = rangeOf(parameter), step = sliderStep(min, max);
      const slider = item.querySelector('[data-parameter-slider]');
      slider.min = String(min);slider.max = String(max);slider.step = String(step);
      if (Number(slider.value) !== value) slider.value = String(value);
      item.querySelector('[data-parameter-value]').textContent = decimal(value);
      item.querySelector('[data-parameter-reset]').disabled = value === parameter.default;
      const nameField = item.querySelector('[data-parameter-name]');
      if (!nameField) continue;
      const draft = drafts.get(parameter.name);
      if (nameField !== active) nameField.value = draft?.text ?? parameter.name;
      const error = draft?.error ?? errors.get(parameter.name) ?? '';
      item.querySelector('[data-parameter-error]').textContent = error;
      nameField.setAttribute('aria-invalid', String(Boolean(draft?.error)));
      for (const [key, shown] of [['default', parameter.default], ['min', min], ['max', max]]) {
        const field = item.querySelector(`[data-parameter-field="${key}"]`);
        field.step = String(step);
        if (field !== active) field.value = decimal(shown);
      }
    }
  }

  function renderAssignments() {
    const d = doc(), s = shape();
    assignments.hidden = !s;
    if (!d || !s) { builtAssignments = '';return; }
    const tracks = assignableTracks(s), names = d.parameters.map(parameter => parameter.name);
    if (!tracks.includes(choice.property)) choice.property = tracks[0];
    if (!names.includes(choice.parameter)) choice.parameter = names[0] ?? null;
    const key = JSON.stringify([s.assignments.map(({property, parameter}) => [property, parameter]), tracks.length, names, editable(), choice]);
    if (key !== builtAssignments) {
      const focused = assignments.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
      builtAssignments = key;
      const disabled = editable() ? '' : 'disabled';
      assignmentList.innerHTML = s.assignments.map(({property, parameter}) => {
        const what = `${text(propertyName(property))} <span class="anim-assignment-sum">+ factor ×</span> <span class="anim-parameter-ref">${text(parameter)}</span>`;
        const focus = text(`${property}:${parameter}`);
        return `<li class="anim-assignment" data-property="${text(property)}" data-parameter-ref="${text(parameter)}">
          <div class="anim-assignment-head"><span class="anim-assignment-text">${what}</span>
            <button class="anim-icon-button" data-assignment-remove data-focus="remove ${focus}" aria-label="Remove ${text(parameter)} from ${text(propertyName(property))}" title="Remove this assignment" ${disabled}>${icon('x')}</button></div>
          <div class="anim-property"><span class="anim-property-name">Factor</span><input type="number" step="0.1" data-assignment-factor data-focus="factor ${focus}" aria-label="Factor of ${text(parameter)} on ${text(propertyName(property))}" ${disabled}></div>
        </li>`;
      }).join('');
      const taken = s.assignments.some(item => item.property === choice.property && item.parameter === choice.parameter);
      adder.innerHTML = !names.length ? '<p class="anim-vector-note">Add a parameter under Parameters to assign it to a property of this shape.</p>' : `
        <label class="anim-property"><span class="anim-property-name">Property</span><select data-assign-property data-focus="property" ${disabled}>${tracks.map(name => `<option value="${text(name)}" ${name === choice.property ? 'selected' : ''}>${text(propertyName(name))}</option>`).join('')}</select></label>
        <label class="anim-property"><span class="anim-property-name">Parameter</span><select data-assign-parameter data-focus="parameter" ${disabled}>${names.map(name => `<option value="${text(name)}" ${name === choice.parameter ? 'selected' : ''}>${text(name)}</option>`).join('')}</select></label>
        <button class="anim-vector-keyframe" data-assign-add data-focus="assign" title="${taken ? 'This parameter is already assigned to this property' : 'Add factor × parameter to the property, with factor 1'}" ${taken || !editable() ? 'disabled' : ''}>${icon('plus')}<span>Assign</span></button>`;
      // Track and parameter names hold letters, digits, _ and . only.
      if (focused) assignments.querySelector(`[data-focus="${focused}"]`)?.focus({preventScroll: true});
    }
    const active = document.activeElement;
    for (const item of assignmentList.querySelectorAll('.anim-assignment')) {
      const found = s.assignments.find(assignment => assignment.property === item.dataset.property && assignment.parameter === item.dataset.parameterRef);
      const field = item.querySelector('[data-assignment-factor]');
      if (found && field !== active) field.value = decimal(found.factor);
    }
  }

  function render() {
    parameters.classList.toggle('previewing', previewing);
    renderList();
    renderValues();
    renderAssignments();
  }

  // Events -------------------------------------------------------------------------------------

  const nameOf = element => element.closest('[data-parameter]')?.dataset.parameter ?? null;
  parameters.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const name = nameOf(button);
    if (button.matches('[data-parameter-add]')) add();
    else if (button.matches('[data-parameter-edit]')) {
      if (expanded.has(name)) { expanded.delete(name);drafts.delete(name);errors.delete(name); }
      else expanded.add(name);
      render();
    } else if (button.matches('[data-parameter-reset]')) session.setParameterValue?.(name, null);
    else if (button.matches('[data-parameter-delete]')) remove(name);
  });
  parameters.addEventListener('input', event => {
    const target = event.target, name = nameOf(target);
    if (target.matches('[data-parameter-slider]')) session.setParameterValue?.(name, Number(target.value));
    else if (target.matches('[data-parameter-name]')) {
      // The name is checked as it is typed and applied when the field is left.
      let error = '';
      if (target.value !== name) try { checkParameterName(doc(), target.value, name); } catch (failure) { error = failure.message; }
      drafts.set(name, {text: target.value, error});
      const line = target.closest('[data-parameter]').querySelector('[data-parameter-error]');
      line.textContent = error;
      target.setAttribute('aria-invalid', String(Boolean(error)));
    }
  });
  // Numbers are applied when the field reports a change: when it is left, on
  // Enter, or when a held − or + button is let go.
  parameters.addEventListener('change', event => {
    const target = event.target, name = nameOf(target);
    if (target.matches('[data-parameter-name]')) rename(name, target.value.trim());
    else if (target.matches('[data-parameter-field]')) setField(name, target.dataset.parameterField, target.value === '' ? NaN : Number(target.value));
  });
  parameters.addEventListener('keydown', event => {
    const target = event.target;
    if (event.key === 'Enter' && target.matches?.('input:not([type=range])')) { event.preventDefault();target.dispatchEvent(new Event('change', {bubbles: true})); }
    else if (event.key === 'Escape' && target.matches?.('[data-parameter-name]')) {
      event.preventDefault();event.stopPropagation();
      const name = nameOf(target);
      drafts.delete(name);target.value = name;
      renderValues();
    }
  });
  assignments.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const item = button.closest('.anim-assignment');
    if (button.matches('[data-assignment-remove]')) unassign(item.dataset.property, item.dataset.parameterRef);
    else if (button.matches('[data-assign-add]')) assign(choice.property, choice.parameter);
  });
  assignments.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('[data-assign-property]')) { choice.property = target.value;renderAssignments(); }
    else if (target.matches('[data-assign-parameter]')) { choice.parameter = target.value;renderAssignments(); }
    else if (target.matches('[data-assignment-factor]')) {
      const item = target.closest('.anim-assignment');
      if (target.value === '' || !setFactor(item.dataset.property, item.dataset.parameterRef, Number(target.value))) renderAssignments();
    }
  });
  assignments.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches?.('[data-assignment-factor]')) { event.preventDefault();event.target.dispatchEvent(new Event('change', {bubbles: true})); }
  });

  function update(event) {
    if (['open', 'close'].includes(event.reason)) { expanded.clear();drafts.clear();errors.clear(); }
    // A slider moves on every pointer move: only the values change. The
    // playhead changes nothing here.
    if (event.reason === 'parameters') { renderValues();return; }
    if (event.reason === 'time') return;
    // Settings of parameters that are gone close.
    const names = new Set(doc()?.parameters.map(parameter => parameter.name) ?? []);
    for (const store of [expanded, drafts, errors]) for (const name of [...store.keys()]) if (!names.has(name)) store.delete(name);
    render();
  }
  render();

  return {
    update,
    // The graph preview starts (true) or ends (false): only the sliders stay.
    setPreview(value) {
      if (previewing === Boolean(value)) return;
      previewing = Boolean(value);
      render();
    },
    add,
    rename,
    remove,
    setField,
    assign,
    setFactor,
    unassign,
    get expanded() { return [...expanded]; },
    destroy() { parameters.replaceChildren();assignments.replaceChildren(); },
  };
}
