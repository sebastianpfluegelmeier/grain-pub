// Vector animations (docs/vector-animation-design.md): track names, the rules
// for shapes and parameters, and the value of every shape at one time on an
// edge. A port of src/animvector.rs: the editor draws what the runtime draws,
// so both ports run the cases in tests/fixtures/animgraph/keyframes; change
// them together.
//
// A shape has the form of the file and of the editor document:
// {kind, points (polygons only), tracks: {name: [{t, v, curve?}]},
// assignments: [{property, parameter, factor}]}. Colour values are '#rrggbb'.

export const SHAPE_KINDS = Object.freeze(['rectangle', 'oval', 'polygon']);
export const MIN_EDGE_LENGTH = 0.05;
export const MAX_EDGE_LENGTH = 600;
export const MAX_PARAMETERS = 64;
export const MAX_SHAPES = 256;
// Two points with curved sides still enclose an area, so a polygon needs no
// more than two.
export const MIN_POINTS = 2;
export const MAX_POINTS = 256;
export const MAX_KEYFRAMES = 1024;
export const MAX_PARAMETER_NAME_LEN = 64;
// The builtin arguments of animation_graph. Parameters are passed as named
// arguments of the same call, so they cannot use these names.
export const RESERVED_PARAMETER_NAMES = Object.freeze(['state', 'urgency', 'rate', 'loop', 'randomize', 'u', 'v', 'scale', 'seed']);
// Control-point distance of a quarter ellipse drawn as one cubic Bézier, as a
// fraction of the radius: 4/3 × (√2 − 1).
export const KAPPA = 0.5522847498307936;
export const COMMON_TRACKS = Object.freeze(['x', 'y', 'rotation', 'outline_thickness', 'outline_color', 'outline_opacity', 'fill_color', 'fill_opacity']);
export const BOX_TRACKS = Object.freeze(['width', 'height']);
export const POINT_PARTS = Object.freeze(['x', 'y', 'in.x', 'in.y', 'out.x', 'out.y']);
// Newton steps on a speed curve stop once x(s) is this close to the progress.
const CURVE_EPSILON = 1e-12;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Point indices are decimal without leading zeros, so every track has one name.
const POINT_TRACK = /^point\.(0|[1-9][0-9]*)\.(x|y|in\.x|in\.y|out\.x|out\.y)$/;

const fail = message => { throw new Error(message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const pointTrack = (index, part) => `point.${index}.${part}`;

// Every track name of a shape, in the order the file lists them.
export function trackNames(kind, points = 0) {
  if (kind !== 'polygon') return [...COMMON_TRACKS, ...BOX_TRACKS];
  const names = [...COMMON_TRACKS];
  for (let index = 0; index < points; index++) for (const part of POINT_PARTS) names.push(pointTrack(index, part));
  return names;
}

// {index, part} for a polygon point track name, otherwise null.
export function pointOfTrack(name) {
  const match = POINT_TRACK.exec(name);
  return match ? {index: Number(match[1]), part: match[2]} : null;
}

// Whether a shape of `kind` with `points` points has the track `name`.
export function hasTrack(kind, points, name) {
  if (COMMON_TRACKS.includes(name)) return true;
  if (BOX_TRACKS.includes(name)) return kind !== 'polygon';
  const point = pointOfTrack(name);
  return kind === 'polygon' && point !== null && point.index < points;
}

// Colour tracks hold '#rrggbb' values and cannot take a parameter.
export const isColorTrack = name => name === 'outline_color' || name === 'fill_color';

// Grain's identifier rule, ASCII only, as node names are.
export function validParameterName(name) {
  return typeof name === 'string' && name.length <= MAX_PARAMETER_NAME_LEN && PARAMETER_NAME.test(name)
    && !RESERVED_PARAMETER_NAMES.includes(name);
}

// '#rrggbb' in either case to [r, g, b], or null.
export function parseColor(text) {
  if (typeof text !== 'string' || !COLOR.test(text)) return null;
  return [1, 3, 5].map(at => parseInt(text.slice(at, at + 2), 16));
}

// [r, g, b] with channels in 0..255 to lowercase '#rrggbb'.
export function formatColor(rgb) {
  return '#' + rgb.map(channel => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('');
}

// The editor's slider range for a parameter: `min` and `max` when they are
// finite and min < max, otherwise 0 to 100 widened to include the default.
// The runtime ignores the range.
export const DEFAULT_SLIDER_RANGE = Object.freeze([0, 100]);
export function sliderRange(value, min, max) {
  if (isNumber(min) && isNumber(max) && min < max) return {min, max};
  return {min: Math.min(DEFAULT_SLIDER_RANGE[0], value), max: Math.max(DEFAULT_SLIDER_RANGE[1], value)};
}

// `x1` and `x2` stay in 0..1 so x(s) never turns back; `y1` and `y2` may
// leave it, so a value can overshoot.
export function validCurve(curve) {
  return Array.isArray(curve) && curve.length === 4 && curve.every(isNumber)
    && curve[0] >= 0 && curve[0] <= 1 && curve[2] >= 0 && curve[2] <= 1;
}

// Rules ----------------------------------------------------------------------
//
// Both throw an Error on the first broken rule of section 11. They accept
// exactly what parse_vector_metadata in src/animgraph.rs accepts; the shared
// cases in tests/fixtures/animgraph/validation keep them in step.

export function checkParameters(parameters) {
  if (!Array.isArray(parameters)) fail('animation metadata `parameters` must be an array');
  if (parameters.length > MAX_PARAMETERS) fail(`animation has more than ${MAX_PARAMETERS} parameters`);
  const names = new Set();
  for (const parameter of parameters) {
    if (!isObject(parameter)) fail('animation parameter must be an object');
    if (!own(parameter, 'name')) fail('animation metadata is missing `name`');
    if (typeof parameter.name !== 'string') fail('animation parameter name must be a string');
    if (!own(parameter, 'default')) fail('animation metadata is missing `default`');
    if (!isNumber(parameter.default)) fail(`animation parameter \`${parameter.name}\` default must be a finite number`);
    if (!validParameterName(parameter.name)) fail(`animation parameter name \`${parameter.name}\` is not allowed`);
    if (names.has(parameter.name)) fail(`animation parameter name \`${parameter.name}\` is used twice`);
    names.add(parameter.name);
  }
}

// `parameters` is the set of parameter names of the animation.
export function checkShape(edgeId, shape, length, parameters) {
  const where = `animation edge ${edgeId}`;
  if (!isObject(shape)) fail(`${where} has a shape that is not an object`);
  if (!own(shape, 'kind')) fail('animation metadata is missing `kind`');
  if (!SHAPE_KINDS.includes(shape.kind)) fail(`${where} has a shape whose kind is not rectangle, oval or polygon`);
  const kind = shape.kind;
  let points = 0;
  if (kind === 'polygon') {
    if (!own(shape, 'points')) fail('animation metadata is missing `points`');
    points = shape.points;
    if (!Number.isInteger(points) || points < MIN_POINTS || points > MAX_POINTS) {
      fail(`${where} has a polygon whose \`points\` is not a whole number from ${MIN_POINTS} to ${MAX_POINTS}`);
    }
  }
  if (!own(shape, 'tracks')) fail('animation metadata is missing `tracks`');
  if (!isObject(shape.tracks)) fail(`${where} has a ${kind} whose \`tracks\` is not an object`);
  for (const name of Object.keys(shape.tracks)) if (!hasTrack(kind, points, name)) fail(`${where} has a ${kind} with the unknown track \`${name}\``);
  for (const name of trackNames(kind, points)) {
    if (!own(shape.tracks, name)) fail(`${where} has a ${kind} without the track \`${name}\``);
    const track = shape.tracks[name], color = isColorTrack(name);
    if (!Array.isArray(track)) fail(`${where} track \`${name}\` must be an array`);
    if (track.length < 1 || track.length > MAX_KEYFRAMES) fail(`${where} track \`${name}\` must have 1 to ${MAX_KEYFRAMES} keyframes`);
    let previous = null;
    for (const keyframe of track) {
      if (!isObject(keyframe)) fail(`${where} track \`${name}\` has a keyframe that is not an object`);
      if (!own(keyframe, 't')) fail('animation metadata is missing `t`');
      if (!isNumber(keyframe.t)) fail(`${where} track \`${name}\` has a keyframe time that is not a number`);
      if (!(keyframe.t >= 0 && keyframe.t <= length)) fail(`${where} track \`${name}\` has a keyframe outside the edge's 0 to ${length} seconds`);
      if (previous !== null && keyframe.t <= previous) fail(`${where} track \`${name}\` has keyframe times that do not increase`);
      previous = keyframe.t;
      if (!own(keyframe, 'v')) fail('animation metadata is missing `v`');
      if (color ? parseColor(keyframe.v) === null : !isNumber(keyframe.v)) {
        fail(`${where} track \`${name}\` has a value that is not ${color ? 'a #rrggbb colour' : 'a finite number'}`);
      }
      if (own(keyframe, 'curve')) {
        const curve = keyframe.curve;
        if (!Array.isArray(curve) || curve.length !== 4 || !curve.every(isNumber)) fail(`${where} track \`${name}\` has a curve that is not four numbers`);
        if (!validCurve(curve)) fail(`${where} track \`${name}\` has a curve whose x values are outside 0 to 1`);
      }
    }
  }
  if (!own(shape, 'assignments')) fail('animation metadata is missing `assignments`');
  if (!Array.isArray(shape.assignments)) fail(`${where} has a ${kind} whose \`assignments\` is not an array`);
  const seen = new Set();
  for (const assignment of shape.assignments) {
    if (!isObject(assignment)) fail(`${where} has an assignment that is not an object`);
    for (const key of ['property', 'parameter', 'factor']) if (!own(assignment, key)) fail(`animation metadata is missing \`${key}\``);
    const {property, parameter, factor} = assignment;
    if (typeof property !== 'string') fail(`${where} has an assignment whose property is not a string`);
    if (!hasTrack(kind, points, property)) fail(`${where} assigns a parameter to \`${property}\`, which is not a track of its ${kind}`);
    if (typeof parameter !== 'string') fail(`${where} has an assignment whose parameter is not a string`);
    if (!parameters.has(parameter)) fail(`${where} assigns the unknown parameter \`${parameter}\``);
    if (!isNumber(factor)) fail(`${where} has an assignment to \`${property}\` whose factor is not a finite number`);
    if (isColorTrack(property)) fail(`${where} assigns a parameter to the colour \`${property}\``);
    const key = `${property}\n${parameter}`;
    if (seen.has(key)) fail(`${where} assigns the same parameter to \`${property}\` twice`);
    seen.add(key);
  }
}

// Evaluation -----------------------------------------------------------------

// One coordinate of the speed curve: a cubic Bézier from 0 to 1 with inner
// control values p1 and p2, at curve parameter s.
function bezier(p1, p2, s) {
  const c = 3 * p1;
  const b = 3 * (p2 - p1) - c;
  const a = 1 - c - b;
  return ((a * s + b) * s + c) * s;
}

function bezierSlope(p1, p2, s) {
  const c = 3 * p1;
  const b = 3 * (p2 - p1) - c;
  const a = 1 - c - b;
  return (3 * a * s + 2 * b) * s + c;
}

// The curve parameter s where x(s) equals x, for x in 0..1. Newton's method
// from s = x usually converges in a few steps; where the curve is flat it can
// stall or jump out of 0..1, and bisection finishes the job, which always
// works because x(s) never decreases for x1, x2 in 0..1.
function solveCurve(x1, x2, x) {
  let s = x;
  for (let i = 0; i < 8; i++) {
    const error = bezier(x1, x2, s) - x;
    if (Math.abs(error) < CURVE_EPSILON) return s;
    const slope = bezierSlope(x1, x2, s);
    if (Math.abs(slope) < 1e-6) break;
    s -= error / slope;
    if (!(s >= 0 && s <= 1)) break;
  }
  let low = 0, high = 1;
  s = x;
  for (let i = 0; i < 64; i++) {
    const value = bezier(x1, x2, s);
    if (Math.abs(value - x) < CURVE_EPSILON) return s;
    if (value < x) low = s;
    else high = s;
    s = (low + high) / 2;
  }
  return s;
}

// The eased progress of a speed curve, with CSS cubic-bezier semantics: solve
// x(s) = progress for s and return y(s). A missing curve is linear.
export function ease(curve, progress) {
  if (!curve) return progress;
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const [x1, y1, x2, y2] = curve;
  return bezier(y1, y2, solveCurve(x1, x2, progress));
}

// Splits a speed curve where it reaches `progress` (0..1, exclusive), so a
// keyframe added there keeps the movement: returns the curves of the two
// halves, each scaled back to run from (0, 0) to (1, 1). A half whose values
// do not change (it starts and ends at the same y) cannot be scaled and comes
// back null, as does every half of a linear curve.
export function splitCurve(curve, progress) {
  if (!curve) return [null, null];
  const [x1, y1, x2, y2] = curve;
  const s = solveCurve(x1, x2, progress);
  const lerp = (a, b) => a + (b - a) * s;
  const [ax, ay, bx, by, cx, cy] = [lerp(0, x1), lerp(0, y1), lerp(x1, x2), lerp(y1, y2), lerp(x2, 1), lerp(y2, 1)];
  const [dx, dy, ex, ey] = [lerp(ax, bx), lerp(ay, by), lerp(bx, cx), lerp(by, cy)];
  const [fx, fy] = [lerp(dx, ex), lerp(dy, ey)];
  const unit = value => Math.min(1, Math.max(0, value));
  const checked = curve => curve.every(isNumber) ? curve : null;
  const left = fx > 0 && fy !== 0 ? checked([unit(ax / fx), ay / fy, unit(dx / fx), dy / fy]) : null;
  const right = fx < 1 && fy !== 1
    ? checked([unit((ex - fx) / (1 - fx)), (ey - fy) / (1 - fy), unit((cx - fx) / (1 - fx)), (cy - fy) / (1 - fy)])
    : null;
  return [left, right];
}

// Index of the first keyframe later than t; NaN finds none before the first.
function nextKeyframe(keyframes, t) {
  let low = 0, high = keyframes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (keyframes[middle].t <= t) low = middle + 1;
    else high = middle;
  }
  return low;
}

const sampleValue = value => typeof value === 'string' ? parseColor(value) : value;

// A track's keyframed value at t seconds: the first keyframe's value before
// it, the last one's after it, and in between a move from one keyframe to the
// next along the earlier keyframe's speed curve. Colours come back as
// [r, g, b] with fractional channels, moved one sRGB channel at a time.
export function sampleTrack(keyframes, t) {
  const next = nextKeyframe(keyframes, t);
  if (next === 0) return sampleValue(keyframes[0].v);
  if (next === keyframes.length) return sampleValue(keyframes[next - 1].v);
  const from = keyframes[next - 1], to = keyframes[next];
  const eased = ease(from.curve, (t - from.t) / (to.t - from.t));
  const mix = (a, b) => a + (b - a) * eased;
  if (typeof from.v === 'string') {
    const a = parseColor(from.v), b = parseColor(to.v);
    return [0, 1, 2].map(channel => mix(a[channel], b[channel]));
  }
  return mix(from.v, to.v);
}

// Parameter values by name, as resolveShape takes them: the finite value
// `given` (a Map or a plain object) has for a name, otherwise the default.
// The result has no prototype, so a parameter may be called `constructor`.
export function parameterValues(parameters, given = {}) {
  const values = Object.create(null);
  for (const parameter of parameters) {
    const value = given instanceof Map ? given.get(parameter.name) : given && own(given, parameter.name) ? given[parameter.name] : undefined;
    values[parameter.name] = isNumber(value) ? value : parameter.default;
  }
  return values;
}

// Every property of a shape at t seconds, measured in the edge's own
// direction, with `values` from parameterValues added and the clamps of
// section 11 applied: {kind, x, y, rotation, width, height,
// outlineThickness, outlineColor, outlineOpacity, fillColor, fillOpacity,
// points: [{x, y, inX, inY, outX, outY}]}. Colours are [r, g, b] in 0..255;
// a polygon's width and height are 0, a rectangle's or oval's points empty.
export function resolveShape(shape, t, values) {
  const kind = shape.kind, boxed = kind !== 'polygon', points = boxed ? 0 : shape.points;
  const keyframed = new Map(trackNames(kind, points).map(name => [name, sampleTrack(shape.tracks[name], t)]));
  const sums = new Map(keyframed);
  for (const {property, parameter, factor} of shape.assignments) {
    const sum = sums.get(property);
    if (typeof sum !== 'number') continue;
    const value = values !== null && typeof values === 'object' && own(values, parameter) ? values[parameter] : 0;
    sums.set(property, sum + factor * value);
  }
  // A sum that is not finite keeps the keyframed value, which always is.
  const number = name => {
    const value = sums.get(name);
    return Number.isFinite(value) ? value : keyframed.get(name);
  };
  const color = name => sums.get(name).map(channel => Math.min(255, Math.max(0, channel)));
  const unit = value => Math.min(1, Math.max(0, value));
  return {
    kind,
    x: number('x'),
    y: number('y'),
    rotation: number('rotation'),
    width: boxed ? Math.max(0, number('width')) : 0,
    height: boxed ? Math.max(0, number('height')) : 0,
    outlineThickness: Math.max(0, number('outline_thickness')),
    outlineColor: color('outline_color'),
    outlineOpacity: unit(number('outline_opacity')),
    fillColor: color('fill_color'),
    fillOpacity: unit(number('fill_opacity')),
    points: Array.from({length: points}, (_, index) => ({
      x: number(pointTrack(index, 'x')),
      y: number(pointTrack(index, 'y')),
      inX: number(pointTrack(index, 'in.x')),
      inY: number(pointTrack(index, 'in.y')),
      outX: number(pointTrack(index, 'out.x')),
      outY: number(pointTrack(index, 'out.y')),
    })),
  };
}

// Every shape of an edge at t seconds; later shapes are drawn over earlier
// ones. `given` holds parameter values by name; missing ones take defaults.
export function resolveShapes(shapes, t, parameters = [], given = {}) {
  const values = parameterValues(parameters, given);
  return shapes.map(shape => resolveShape(shape, t, values));
}

const RESOLVED_FIELDS = {
  x: 'x', y: 'y', rotation: 'rotation', outline_thickness: 'outlineThickness', outline_color: 'outlineColor',
  outline_opacity: 'outlineOpacity', fill_color: 'fillColor', fill_opacity: 'fillOpacity', width: 'width', height: 'height',
};
const POINT_FIELDS = {'x': 'x', 'y': 'y', 'in.x': 'inX', 'in.y': 'inY', 'out.x': 'outX', 'out.y': 'outY'};

// The resolved value of the property with track name `name`, or undefined
// when the shape has no such property.
export function resolvedValue(resolved, name) {
  if (!hasTrack(resolved.kind, resolved.points.length, name)) return undefined;
  const point = pointOfTrack(name);
  return point ? resolved.points[point.index][POINT_FIELDS[point.part]] : resolved[RESOLVED_FIELDS[name]];
}

// The shape's closed outline, rotated and placed on the canvas:
// {start: [x, y], segments: [[c1x, c1y, c2x, c2y, x, y], ...]}, the last
// segment ending at the start. Draw it with moveTo and bezierCurveTo; fill
// first, then stroke it outlineThickness wide, centred on the path. The
// runtime builds the same path for tiny-skia.
//
// A rectangle starts at its top-left corner and runs clockwise on screen; its
// sides are straight segments with their control points on their ends, like
// polygon sides with zero handles. An oval is four quarter arcs from its
// right end, clockwise. A polygon runs from point 0 through every point and
// back.
export function shapeOutline(resolved) {
  const radians = resolved.rotation * (Math.PI / 180);
  const sin = Math.sin(radians), cos = Math.cos(radians);
  const place = (x, y) => [resolved.x + x * cos - y * sin, resolved.y + x * sin + y * cos];
  const segment = (c1, c2, end) => [...place(c1[0], c1[1]), ...place(c2[0], c2[1]), ...place(end[0], end[1])];
  if (resolved.kind === 'rectangle') {
    const w = resolved.width / 2, h = resolved.height / 2;
    const corners = [[-w, -h], [w, -h], [w, h], [-w, h]];
    return {start: place(...corners[0]), segments: corners.map((from, index) => {
      const to = corners[(index + 1) % 4];
      return segment(from, to, to);
    })};
  }
  if (resolved.kind === 'oval') {
    const rx = resolved.width / 2, ry = resolved.height / 2, kx = KAPPA * rx, ky = KAPPA * ry;
    return {start: place(rx, 0), segments: [
      segment([rx, ky], [kx, ry], [0, ry]),
      segment([-kx, ry], [-rx, ky], [-rx, 0]),
      segment([-rx, -ky], [-kx, -ry], [0, -ry]),
      segment([kx, -ry], [rx, -ky], [rx, 0]),
    ]};
  }
  const points = resolved.points;
  if (!points.length) return {start: place(0, 0), segments: []};
  return {start: place(points[0].x, points[0].y), segments: points.map((from, index) => {
    const to = points[(index + 1) % points.length];
    return segment([from.x + from.outX, from.y + from.outY], [to.x + to.inX, to.y + to.inY], [to.x, to.y]);
  })};
}
