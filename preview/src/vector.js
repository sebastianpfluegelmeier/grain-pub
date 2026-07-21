// Vector animation editor for the Grain asset editor.
//
// A separate classic script (like noiselab.js): globals defined in app.js
// (state, dispatch, render, saveAssets, iconTextButton, iconButton, ICONS,
// freshId, sanitizeName, uniqueName, activeAsset, stepperControl,
// clampNumber, escapeHtml) resolve at call time.
//
// Vector assets are authored white-on-transparent and rasterized 1-bit
// (no anti-aliasing): coverage is thresholded so every pixel is either
// fully white or fully transparent. There is no runtime Grain playback and
// no binary export yet — assets live in localStorage only, so git sync
// skips them.

/* ==================== Model ==================== */

const VEC_W = 512;
const VEC_H = 256;
const VEC_DEFAULT_DURATION = 3; // seconds
const VEC_DEFAULT_FPS = 30;
const VEC_MIN_SIZE = 16;
const VEC_MAX_SIZE = 2048;

// Every animatable value is a "track": an ordered list of keyframes.
//  - scalar key:  { t, v, ease }
//  - point key:   { t, x, y, ease, spatial }   (spatial: "linear" | "smooth")
//  - bool key:    { t, v }                      (stepped / hold, no ease)
// ease: { type: "linear" | "in" | "out" | "inout", strength: 0..1 }.
// A single-key track is effectively a constant.

function vecEase(type = "linear", strength = 0) {
  return { type, strength: clampNumber(strength, 0, 1) };
}

// `animated` is the stopwatch state. A non-animated track is a plain constant
// (its single key is edited in place); editing it never creates keyframes.
// Only once animation is enabled do value edits key at the playhead.
function scalarTrack(v) {
  return { animated: false, keys: [{ t: 0, v, ease: vecEase() }] };
}

function pointTrack(x, y) {
  return { animated: false, keys: [{ t: 0, x, y, ease: vecEase(), spatial: "linear" }] };
}

function boolTrack(v) {
  return { animated: false, keys: [{ t: 0, v: !!v }] };
}

// Apply an easing curve to normalized segment progress u in [0, 1].
function applyEase(ease, u) {
  if (!ease || ease.type === "linear" || !ease.strength) return u;
  const s = clampNumber(ease.strength, 0, 1);
  const p = 1 + s * 3; // exponent 1..4: strength 0 collapses to linear
  if (ease.type === "in") return Math.pow(u, p);
  if (ease.type === "out") return 1 - Math.pow(1 - u, p);
  // inout
  return u < 0.5
    ? 0.5 * Math.pow(2 * u, p)
    : 1 - 0.5 * Math.pow(2 * (1 - u), p);
}

// Locate the segment [a, b] surrounding time t. Returns { a, b, u } with u
// the eased-ready raw progress, or { a } when t is at/beyond an endpoint.
function segmentAt(keys, t) {
  if (keys.length === 1 || t <= keys[0].t) return { a: keys[0] };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { a: last };
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t || 1;
      return { a, b, u: (t - a.t) / span, i };
    }
  }
  return { a: last };
}

function evalScalar(track, t) {
  const seg = segmentAt(track.keys, t);
  if (!seg.b) return seg.a.v;
  const e = applyEase(seg.a.ease, seg.u);
  return seg.a.v + (seg.b.v - seg.a.v) * e;
}

function evalBool(track, t) {
  let v = track.keys[0].v;
  for (const key of track.keys) {
    if (key.t <= t) v = key.v;
    else break;
  }
  return v;
}

function catmull(p0, p1, p2, p3, e) {
  const e2 = e * e;
  const e3 = e2 * e;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * e +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * e2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * e3)
  );
}

function evalPoint(track, t) {
  const keys = track.keys;
  const seg = segmentAt(keys, t);
  if (!seg.b) return { x: seg.a.x, y: seg.a.y };
  const e = applyEase(seg.a.ease, seg.u);
  const a = seg.a;
  const b = seg.b;
  if (a.spatial === "smooth") {
    // Catmull-Rom through the neighbouring keyframes so the spatial path
    // curves smoothly through waypoints, independent of temporal easing.
    const p0 = keys[seg.i - 1] || a;
    const p3 = keys[seg.i + 2] || b;
    return {
      x: catmull(p0.x, a.x, b.x, p3.x, e),
      y: catmull(p0.y, a.y, b.y, p3.y, e),
    };
  }
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
}

/* ==================== Shape factories ==================== */

function vecShape(kind, props) {
  return {
    id: freshId(),
    node: "shape",
    kind,
    name: kind,
    visible: boolTrack(true),
    ...props,
  };
}

function makeOval(x, y, w, h) {
  return vecShape("oval", {
    pos: pointTrack(x, y),
    size: pointTrack(w, h),
    fill: true,
    stroke: scalarTrack(0),
  });
}

function makeRect(x, y, w, h) {
  return vecShape("rect", {
    pos: pointTrack(x, y),
    size: pointTrack(w, h),
    fill: true,
    stroke: scalarTrack(0),
  });
}

function makeLine(x1, y1, x2, y2) {
  return vecShape("line", {
    a: pointTrack(x1, y1),
    b: pointTrack(x2, y2),
    stroke: scalarTrack(2),
  });
}

function makePolygon(points) {
  return vecShape("polygon", {
    verts: points.map((p) => pointTrack(p.x, p.y)),
    fill: true,
    stroke: scalarTrack(0),
  });
}

function makeGroup(children) {
  return {
    id: freshId(),
    node: "group",
    name: "group",
    op: "none", // none | union | intersect | difference | xor
    visible: boolTrack(true),
    transform: {
      pos: pointTrack(0, 0),
      scale: scalarTrack(1),
    },
    children: children || [],
  };
}

/* ==================== Sampling a node to concrete geometry ==================== */

// Resolve a node's animated properties at time t into plain numbers.
function sampleNode(node, t) {
  if (node.node === "group") {
    return {
      node: "group",
      id: node.id,
      op: node.op,
      visible: evalBool(node.visible, t),
      tx: evalPoint(node.transform.pos, t),
      scale: evalScalar(node.transform.scale, t),
      children: node.children.map((c) => sampleNode(c, t)),
    };
  }
  const visible = evalBool(node.visible, t);
  if (node.kind === "oval" || node.kind === "rect") {
    const p = evalPoint(node.pos, t);
    const s = evalPoint(node.size, t);
    return {
      node: "shape",
      kind: node.kind,
      id: node.id,
      visible,
      fill: node.fill,
      stroke: evalScalar(node.stroke, t),
      x: p.x,
      y: p.y,
      w: s.x,
      h: s.y,
    };
  }
  if (node.kind === "line") {
    return {
      node: "shape",
      kind: "line",
      id: node.id,
      visible,
      stroke: Math.max(1, evalScalar(node.stroke, t)),
      a: evalPoint(node.a, t),
      b: evalPoint(node.b, t),
    };
  }
  // polygon
  return {
    node: "shape",
    kind: "polygon",
    id: node.id,
    visible,
    fill: node.fill,
    stroke: evalScalar(node.stroke, t),
    verts: node.verts.map((v) => evalPoint(v, t)),
  };
}

/* ==================== Rasterizer (1-bit white on transparent) ==================== */

function vecMakeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Canvas composite mode used when folding boolean operands together.
function compositeFor(op, first) {
  if (first || op === "none" || op === "union") return "source-over";
  if (op === "intersect") return "source-in";
  if (op === "difference") return "destination-out";
  if (op === "xor") return "xor";
  return "source-over";
}

function pathShape(ctx, s) {
  ctx.beginPath();
  if (s.kind === "oval") {
    ctx.ellipse(
      s.x + s.w / 2,
      s.y + s.h / 2,
      Math.abs(s.w / 2),
      Math.abs(s.h / 2),
      0,
      0,
      Math.PI * 2,
    );
  } else if (s.kind === "rect") {
    ctx.rect(s.x, s.y, s.w, s.h);
  } else if (s.kind === "polygon") {
    s.verts.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
    ctx.closePath();
  }
}

// Render one sampled shape onto its own native-resolution layer canvas.
function renderShapeLayer(s, w, h) {
  const c = vecMakeCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (s.kind === "line") {
    ctx.lineWidth = s.stroke;
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
    return c;
  }
  pathShape(ctx, s);
  if (s.fill) ctx.fill();
  if (s.stroke > 0) {
    ctx.lineWidth = s.stroke;
    ctx.stroke();
  }
  return c;
}

// Fold a list of sampled nodes into one native-resolution canvas, applying
// the parent's boolean op across area operands. Lines never participate in
// boolean ops — they draw normally on top (per design).
function renderNodeList(nodes, op, w, h) {
  const visible = nodes.filter((n) => n.visible);
  const lines = visible.filter((n) => n.node === "shape" && n.kind === "line");
  const operands = visible.filter(
    (n) => !(n.node === "shape" && n.kind === "line"),
  );

  const acc = vecMakeCanvas(w, h);
  const ctx = acc.getContext("2d");
  operands.forEach((n, i) => {
    const layer = renderNode(n, w, h);
    ctx.globalCompositeOperation = compositeFor(op, i === 0);
    ctx.drawImage(layer, 0, 0);
  });
  // Draw passthrough lines over the boolean result.
  ctx.globalCompositeOperation = "source-over";
  for (const line of lines) ctx.drawImage(renderShapeLayer(line, w, h), 0, 0);
  return acc;
}

function renderNode(node, w, h) {
  if (node.node === "shape") return renderShapeLayer(node, w, h);
  // group: render children with the group's op, then bake the group transform.
  const inner = renderNodeList(node.children, node.op, w, h);
  const layer = vecMakeCanvas(w, h);
  const ctx = layer.getContext("2d");
  const cx = w / 2;
  const cy = h / 2;
  // Uniform scale about the canvas centre, then translate.
  ctx.setTransform(
    node.scale,
    0,
    0,
    node.scale,
    cx - cx * node.scale + node.tx.x,
    cy - cy * node.scale + node.tx.y,
  );
  ctx.drawImage(inner, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return layer;
}

// Threshold coverage to 1-bit: alpha >= 128 becomes opaque white, else clear.
function threshold1bit(canvas) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= 128) {
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = 255;
    } else {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Rasterize the whole document at time t into a fresh native-resolution,
// 1-bit canvas.
function rasterizeVector(doc, t) {
  const w = doc.width || VEC_W;
  const h = doc.height || VEC_H;
  const sampled = doc.root.map((n) => sampleNode(n, t));
  const canvas = renderNodeList(sampled, "none", w, h);
  threshold1bit(canvas);
  return canvas;
}

/* ==================== Persistence ==================== */

function createVector(name) {
  return {
    id: freshId(),
    type: "vector",
    name: sanitizeName(name || "vector"),
    width: VEC_W,
    height: VEC_H,
    duration: VEC_DEFAULT_DURATION,
    fps: VEC_DEFAULT_FPS,
    root: [],
    updatedAt: Date.now(),
  };
}

// Forward-compatible load: keep only recognisable structure, fill defaults.
function normalizeVector(asset) {
  const doc = {
    id: String(asset.id || freshId()),
    type: "vector",
    name: sanitizeName(asset.name || "vector"),
    width: clampNumber(asset.width || VEC_W, VEC_MIN_SIZE, VEC_MAX_SIZE),
    height: clampNumber(asset.height || VEC_H, VEC_MIN_SIZE, VEC_MAX_SIZE),
    duration: clampNumber(asset.duration || VEC_DEFAULT_DURATION, 0.1, 600),
    fps: clampNumber(asset.fps || VEC_DEFAULT_FPS, 1, 120),
    root: Array.isArray(asset.root) ? asset.root : [],
    updatedAt: asset.updatedAt || Date.now(),
  };
  doc.root.forEach(migrateVectorNode);
  return doc;
}

// Back-fill the `animated` stopwatch flag on tracks loaded from older docs:
// a track counts as animated if it already carries more than one keyframe.
function migrateVectorTrack(track) {
  if (track && Array.isArray(track.keys) && track.animated === undefined) {
    track.animated = track.keys.length > 1;
  }
}

function migrateVectorNode(node) {
  if (!node) return;
  migrateVectorTrack(node.visible);
  if (node.node === "group") {
    migrateVectorTrack(node.transform?.pos);
    migrateVectorTrack(node.transform?.scale);
    (node.children || []).forEach(migrateVectorNode);
    return;
  }
  if (node.kind === "oval" || node.kind === "rect") {
    migrateVectorTrack(node.pos);
    migrateVectorTrack(node.size);
    migrateVectorTrack(node.stroke);
  } else if (node.kind === "line") {
    migrateVectorTrack(node.a);
    migrateVectorTrack(node.b);
    migrateVectorTrack(node.stroke);
  } else if (node.kind === "polygon") {
    (node.verts || []).forEach(migrateVectorTrack);
    migrateVectorTrack(node.stroke);
  }
}

/* ==================== Editor state ==================== */

const vecState = {
  docId: null,
  tool: "select", // select | oval | rect | line | polygon
  selection: [], // node ids
  time: 0, // playhead seconds
  zoom: 2,
  drag: null,
  polygonDraft: null, // array of {x,y} while drawing a polygon
  hoverClose: false,
  selKey: null, // { nodeId, key, t } — selected keyframe
  tlDrag: null, // active timeline drag
};

const vecHistory = { past: [], future: [] };

function vecSnapshot(asset) {
  return JSON.stringify(asset.root);
}

function vecPushHistory(asset) {
  vecHistory.past.push(vecSnapshot(asset));
  if (vecHistory.past.length > 200) vecHistory.past.shift();
  vecHistory.future.length = 0;
}

function vecEdit(asset, fn) {
  vecPushHistory(asset);
  fn();
  asset.updatedAt = Date.now();
  saveAssets();
  render();
}

function vecUndo() {
  const asset = activeAsset();
  if (!asset || asset.type !== "vector" || !vecHistory.past.length) return;
  vecHistory.future.push(vecSnapshot(asset));
  asset.root = JSON.parse(vecHistory.past.pop());
  asset.updatedAt = Date.now();
  saveAssets();
  render();
}

function vecRedo() {
  const asset = activeAsset();
  if (!asset || asset.type !== "vector" || !vecHistory.future.length) return;
  vecHistory.past.push(vecSnapshot(asset));
  asset.root = JSON.parse(vecHistory.future.pop());
  asset.updatedAt = Date.now();
  saveAssets();
  render();
}

/* ==================== Node lookup / mutation ==================== */

function vecWalk(nodes, fn, parent = null) {
  for (const node of nodes) {
    fn(node, parent, nodes);
    if (node.node === "group") vecWalk(node.children, fn, node);
  }
}

function vecFindNode(asset, id) {
  let found = null;
  vecWalk(asset.root, (node, parent, siblings) => {
    if (node.id === id) found = { node, parent, siblings };
  });
  return found;
}

function vecSelectedNodes(asset) {
  return vecState.selection
    .map((id) => vecFindNode(asset, id)?.node)
    .filter(Boolean);
}

// Shift every position keyframe of a node by (dx, dy) so the shape — and its
// whole animation path — moves as one.
function translateNode(node, dx, dy) {
  const shiftPoint = (track) => {
    for (const k of track.keys) {
      k.x += dx;
      k.y += dy;
    }
  };
  if (node.node === "group") {
    shiftPoint(node.transform.pos);
    return;
  }
  if (node.kind === "oval" || node.kind === "rect") shiftPoint(node.pos);
  else if (node.kind === "line") {
    shiftPoint(node.a);
    shiftPoint(node.b);
  } else if (node.kind === "polygon") node.verts.forEach(shiftPoint);
}

/* ==================== Hit testing ==================== */

function pointInEllipse(px, py, s) {
  const rx = s.w / 2;
  const ry = s.h / 2;
  if (rx === 0 || ry === 0) return false;
  const nx = (px - (s.x + rx)) / rx;
  const ny = (py - (s.y + ry)) / ry;
  return nx * nx + ny * ny <= 1;
}

function pointInRect(px, py, s) {
  const x0 = Math.min(s.x, s.x + s.w);
  const y0 = Math.min(s.y, s.y + s.h);
  return px >= x0 && px <= x0 + Math.abs(s.w) && py >= y0 && py <= y0 + Math.abs(s.h);
}

function pointInPoly(px, py, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i, i += 1) {
    const a = verts[i];
    const b = verts[j];
    if (
      a.y > py !== b.y > py &&
      px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let tt = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  tt = Math.max(0, Math.min(1, tt));
  const cx = a.x + tt * dx;
  const cy = a.y + tt * dy;
  return Math.hypot(px - cx, py - cy);
}

function minPolyEdgeDist(px, py, verts) {
  let m = Infinity;
  for (let i = 0; i < verts.length; i += 1) {
    m = Math.min(m, distToSegment(px, py, verts[i], verts[(i + 1) % verts.length]));
  }
  return m;
}

function hitSampledShape(px, py, s) {
  if (s.kind === "oval") return pointInEllipse(px, py, s);
  if (s.kind === "rect") return pointInRect(px, py, s);
  if (s.kind === "line") return distToSegment(px, py, s.a, s.b) <= s.stroke / 2 + 3;
  // Include an edge tolerance so clicks on the outline still count (keeps a
  // polygon selected when adding a vertex on an edge).
  if (s.kind === "polygon") return pointInPoly(px, py, s.verts) || minPolyEdgeDist(px, py, s.verts) <= 3;
  return false;
}

function hitSampledNode(px, py, s) {
  if (s.node === "group") return s.children.some((c) => c.visible && hitSampledNode(px, py, c));
  return hitSampledShape(px, py, s);
}

// Topmost (last-painted) hit among the document's top-level nodes.
function hitTest(asset, px, py) {
  const sampled = asset.root.map((n) => sampleNode(n, vecState.time));
  for (let i = sampled.length - 1; i >= 0; i -= 1) {
    const s = sampled[i];
    if (s.visible && hitSampledNode(px, py, s)) return asset.root[i].id;
  }
  return null;
}

/* ==================== Editor screen ==================== */

function vectorEditorScreen(asset) {
  if (vecState.docId !== asset.id) {
    vecState.docId = asset.id;
    vecState.selection = [];
    vecState.time = 0;
    vecState.polygonDraft = null;
    vecState.selKey = null;
    vecHistory.past.length = 0;
    vecHistory.future.length = 0;
  }

  const wrap = document.createElement("div");
  wrap.className = "editor vector-editor";
  wrap.append(vecHead(asset), vecToolRow(asset));

  const body = document.createElement("div");
  body.className = "vector-body";
  body.append(vecStage(asset), vecSidePanels(asset));
  wrap.append(body);
  wrap.append(vecTimeline(asset));

  requestAnimationFrame(() => drawVectorStage(asset));
  return wrap;
}

function vecHead(asset) {
  const head = document.createElement("div");
  head.className = "editor-head";
  const rename = document.createElement("input");
  rename.className = "name-input";
  rename.value = asset.name;
  rename.ariaLabel = "Asset name";
  rename.addEventListener("change", () =>
    dispatch({ type: "renameAsset", name: rename.value }),
  );

  const group = document.createElement("div");
  group.className = "size-group";
  group.append(
    stepperControl("W", asset.width, VEC_MIN_SIZE, VEC_MAX_SIZE, "Width", (v) =>
      vecEdit(asset, () => (asset.width = v)),
    ),
    stepperControl("H", asset.height, VEC_MIN_SIZE, VEC_MAX_SIZE, "Height", (v) =>
      vecEdit(asset, () => (asset.height = v)),
    ),
    stepperControl("Dur", Math.round(asset.duration), 1, 600, "Duration (s)", (v) =>
      vecEdit(asset, () => (asset.duration = v)),
    ),
    stepperControl("FPS", asset.fps, 1, 120, "Preview FPS", (v) =>
      vecEdit(asset, () => (asset.fps = v)),
    ),
    vecZoomControl(),
  );
  head.append(rename, group);
  return head;
}

function vecZoomControl() {
  const box = document.createElement("div");
  box.className = "zoom-control";
  box.append(
    iconButton("Zoom out", "minus", "btn icon", () => {
      vecState.zoom = Math.max(1, vecState.zoom - 1);
      render();
    }),
    (() => {
      const label = document.createElement("span");
      label.className = "zoom-label";
      label.textContent = `${vecState.zoom}×`;
      return label;
    })(),
    iconButton("Zoom in", "plus", "btn icon", () => {
      vecState.zoom = Math.min(4, vecState.zoom + 1);
      render();
    }),
  );
  return box;
}

function vecToolRow(asset) {
  const row = document.createElement("div");
  row.className = "tool-row vector-tools";
  const tools = [
    ["select", "select", "Select"],
    ["oval", "circle", "Oval"],
    ["rect", "square", "Rectangle"],
    ["line", "line", "Line"],
    ["polygon", "stack", "Polygon"],
  ];
  for (const [tool, icon, label] of tools) {
    row.append(
      iconTextButton(label, icon, `btn${vecState.tool === tool ? " active" : ""}`, () => {
        vecState.tool = tool;
        vecState.polygonDraft = null;
        render();
      }),
    );
  }
  const spacer = document.createElement("div");
  spacer.className = "tool-spacer";
  row.append(spacer);
  row.append(
    iconButton("Undo", "undo", "btn icon", vecUndo),
    iconButton("Redo", "redo", "btn icon", vecRedo),
    iconTextButton("Duplicate", "duplicate", "btn", () => vecDuplicateSelection(asset)),
    iconTextButton("Group", "stack", "btn", () => vecGroupSelection(asset)),
    iconTextButton("Ungroup", "stack", "btn", () => vecUngroup(asset)),
    iconTextButton("Delete", "trash", "btn", () => vecDeleteSelection(asset)),
  );
  return row;
}

function vecStage(asset) {
  const area = document.createElement("div");
  area.className = "vector-stage-area";
  const stage = document.createElement("div");
  stage.className = "vector-stage";
  stage.style.width = `${asset.width * vecState.zoom}px`;
  stage.style.height = `${asset.height * vecState.zoom}px`;

  const scene = document.createElement("canvas");
  scene.className = "vector-scene";
  scene.width = asset.width;
  scene.height = asset.height;

  const overlay = document.createElement("canvas");
  overlay.className = "vector-overlay";
  overlay.width = asset.width * vecState.zoom;
  overlay.height = asset.height * vecState.zoom;
  overlay.addEventListener("pointerdown", (e) => vecPointerDown(e, asset));
  overlay.addEventListener("pointermove", (e) => vecPointerMove(e, asset));
  overlay.addEventListener("pointerup", (e) => vecPointerUp(e, asset));
  overlay.addEventListener("dblclick", (e) => vecDoubleClick(e, asset));
  overlay.addEventListener("contextmenu", (e) => e.preventDefault());

  stage.append(scene, overlay);
  area.append(stage);
  return area;
}

function vecEventPoint(event, asset) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / vecState.zoom,
    y: (event.clientY - rect.top) / vecState.zoom,
  };
}

/* ==================== Pointer interaction ==================== */

function vecPointerDown(event, asset) {
  event.currentTarget.setPointerCapture?.(event.pointerId);
  const p = vecEventPoint(event, asset);

  if (vecState.tool === "polygon") {
    if (!vecState.polygonDraft) vecState.polygonDraft = [];
    const draft = vecState.polygonDraft;
    if (draft.length >= 3 && Math.hypot(p.x - draft[0].x, p.y - draft[0].y) <= 8) {
      vecCommitPolygon(asset);
    } else {
      draft.push(p);
      drawVectorStage(asset);
    }
    return;
  }

  if (vecState.tool === "select") {
    // A handle on a single selected top-level shape takes priority.
    if (vecState.selection.length === 1) {
      const found = vecFindNode(asset, vecState.selection[0]);
      if (found && !found.parent && found.node.node === "shape") {
        const hid = hitHandle(found.node, p, vecState.time);
        if (hid) {
          vecState.drag = { mode: "handle", node: found.node, handle: hid, t: snapT(asset, vecState.time), pushed: false };
          return;
        }
      }
    }
    const id = hitTest(asset, p.x, p.y);
    if (id) {
      if (!vecState.selection.includes(id)) {
        vecState.selection = event.shiftKey ? [...vecState.selection, id] : [id];
        vecState.selKey = null;
        render();
      }
      vecState.drag = { mode: "move", startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, pushed: false };
    } else {
      vecState.selection = [];
      vecState.selKey = null;
      vecState.drag = null;
      render();
    }
    return;
  }

  // Shape creation tools: drag out a bounding box / line.
  vecState.drag = { mode: "create", tool: vecState.tool, startX: p.x, startY: p.y, curX: p.x, curY: p.y };
  drawVectorStage(asset);
}

function vecPointerMove(event, asset) {
  const p = vecEventPoint(event, asset);
  const drag = vecState.drag;

  if (vecState.tool === "polygon" && vecState.polygonDraft) {
    vecState.polygonPreview = p;
    const draft = vecState.polygonDraft;
    vecState.hoverClose = draft.length >= 3 && Math.hypot(p.x - draft[0].x, p.y - draft[0].y) <= 8;
    drawVectorStage(asset);
    return;
  }

  if (!drag) return;
  if (drag.mode === "move") {
    const dx = p.x - drag.lastX;
    const dy = p.y - drag.lastY;
    if (dx === 0 && dy === 0) return;
    if (!drag.pushed) {
      vecPushHistory(asset);
      drag.pushed = true;
    }
    const selNodes = vecSelectedNodes(asset);
    for (const node of selNodes) translateNode(node, dx, dy);
    // Snap a single top-level shape's centre to the canvas centre.
    vecState.snapX = false;
    vecState.snapY = false;
    if (selNodes.length === 1) {
      const found = vecFindNode(asset, selNodes[0].id);
      const b = found && !found.parent ? nodeBounds(sampleNode(found.node, vecState.time)) : null;
      if (b) {
        const tol = 6 / vecState.zoom;
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;
        if (Math.abs(cx - asset.width / 2) <= tol) { translateNode(found.node, asset.width / 2 - cx, 0); vecState.snapX = true; }
        if (Math.abs(cy - asset.height / 2) <= tol) { translateNode(found.node, 0, asset.height / 2 - cy); vecState.snapY = true; }
      }
    }
    drag.lastX = p.x;
    drag.lastY = p.y;
    drawVectorStage(asset);
  } else if (drag.mode === "create") {
    drag.curX = p.x;
    drag.curY = p.y;
    drawVectorStage(asset);
  } else if (drag.mode === "handle") {
    const node = drag.node;
    const t = drag.t;
    if (!drag.pushed) {
      vecPushHistory(asset);
      drag.pushed = true;
      if (node.kind === "oval" || node.kind === "rect") {
        drag.posKey = keyToEditRaw(asset, node, "pos");
        drag.sizeKey = keyToEditRaw(asset, node, "size");
      } else if (node.kind === "line") {
        drag.pKey = keyToEditRaw(asset, node, drag.handle);
      } else {
        drag.pKey = keyToEditRaw(asset, node, `v${Number(drag.handle.slice(1))}`);
      }
    }
    if (node.kind === "oval" || node.kind === "rect") {
      const [ex, ey] = BOX_HANDLES[drag.handle];
      let x = drag.posKey.x;
      let y = drag.posKey.y;
      let w = drag.sizeKey.x;
      let h = drag.sizeKey.y;
      if (ex === -1) { w = x + w - p.x; x = p.x; } else if (ex === 1) { w = p.x - x; }
      if (ey === -1) { h = y + h - p.y; y = p.y; } else if (ey === 1) { h = p.y - y; }
      drag.posKey.x = x;
      drag.posKey.y = y;
      drag.sizeKey.x = w;
      drag.sizeKey.y = h;
    } else {
      drag.pKey.x = p.x;
      drag.pKey.y = p.y;
    }
    drawVectorStage(asset);
  }
}

function vecPointerUp(event, asset) {
  const drag = vecState.drag;
  vecState.drag = null;
  if (!drag) return;

  // Only re-render when something actually moved: a no-op click must NOT
  // rebuild the overlay, or it would break the browser's dblclick pairing
  // (used for polygon vertex add/remove).
  if (drag.mode === "move") {
    vecState.snapX = false;
    vecState.snapY = false;
    if (drag.pushed) {
      asset.updatedAt = Date.now();
      saveAssets();
      render();
    } else {
      drawVectorStage(asset);
    }
    return;
  }

  if (drag.mode === "handle") {
    if (drag.pushed) {
      // Normalize a box so width/height stay positive.
      if ((drag.node.kind === "oval" || drag.node.kind === "rect") && drag.posKey && drag.sizeKey) {
        if (drag.sizeKey.x < 0) { drag.posKey.x += drag.sizeKey.x; drag.sizeKey.x = -drag.sizeKey.x; }
        if (drag.sizeKey.y < 0) { drag.posKey.y += drag.sizeKey.y; drag.sizeKey.y = -drag.sizeKey.y; }
      }
      asset.updatedAt = Date.now();
      saveAssets();
      render();
    }
    return;
  }

  if (drag.mode === "create") {
    const x0 = Math.min(drag.startX, drag.curX);
    const y0 = Math.min(drag.startY, drag.curY);
    const w = Math.abs(drag.curX - drag.startX);
    const h = Math.abs(drag.curY - drag.startY);
    let shape = null;
    if (drag.tool === "line") {
      if (Math.hypot(drag.curX - drag.startX, drag.curY - drag.startY) < 2) return;
      shape = makeLine(drag.startX, drag.startY, drag.curX, drag.curY);
    } else {
      // A click with no drag makes a default-sized shape.
      const ww = w < 3 ? 64 : w;
      const hh = h < 3 ? 48 : h;
      shape = drag.tool === "oval" ? makeOval(x0, y0, ww, hh) : makeRect(x0, y0, ww, hh);
    }
    vecEdit(asset, () => {
      asset.root.push(shape);
      vecState.selection = [shape.id];
      vecState.tool = "select";
    });
  }
}

function vecDoubleClick(event, asset) {
  if (vecState.tool === "polygon" && vecState.polygonDraft?.length >= 3) {
    vecCommitPolygon(asset);
    return;
  }
  // Double-click a selected top-level polygon: remove a vertex (on a handle)
  // or insert one on the nearest edge.
  if (vecState.tool !== "select") return;
  const sel = vecSelectedNodes(asset);
  if (sel.length !== 1 || sel[0].node !== "shape" || sel[0].kind !== "polygon") return;
  const found = vecFindNode(asset, sel[0].id);
  if (!found || found.parent) return;
  const node = found.node;
  const p = vecEventPoint(event, asset);
  const hid = hitHandle(node, p, vecState.time);
  if (hid && node.verts.length > 3) {
    const i = Number(hid.slice(1));
    vecEdit(asset, () => node.verts.splice(i, 1));
    return;
  }
  const s = sampleNode(node, vecState.time);
  let best = { d: Infinity, i: -1, pt: null };
  for (let i = 0; i < s.verts.length; i += 1) {
    const a = s.verts[i];
    const b = s.verts[(i + 1) % s.verts.length];
    const proj = projectToSeg(p, a, b);
    const d = Math.hypot(p.x - proj.x, p.y - proj.y);
    if (d < best.d) best = { d, i, pt: proj };
  }
  if (best.i >= 0 && best.d < 10 / vecState.zoom + 4) {
    vecEdit(asset, () => node.verts.splice(best.i + 1, 0, pointTrack(best.pt.x, best.pt.y)));
  }
}

function vecCommitPolygon(asset) {
  const draft = vecState.polygonDraft;
  vecState.polygonDraft = null;
  vecState.polygonPreview = null;
  vecState.hoverClose = false;
  if (!draft || draft.length < 3) {
    render();
    return;
  }
  const poly = makePolygon(draft);
  vecEdit(asset, () => {
    asset.root.push(poly);
    vecState.selection = [poly.id];
    vecState.tool = "select";
  });
}

/* ==================== Node actions ==================== */

function vecDeleteSelection(asset) {
  if (!vecState.selection.length) return;
  const ids = new Set(vecState.selection);
  vecEdit(asset, () => {
    const prune = (nodes) =>
      nodes.filter((n) => !ids.has(n.id)).map((n) => {
        if (n.node === "group") n.children = prune(n.children);
        return n;
      });
    asset.root = prune(asset.root);
    vecState.selection = [];
  });
}

function vecDuplicateSelection(asset) {
  const nodes = vecSelectedNodes(asset);
  if (!nodes.length) return;
  vecEdit(asset, () => {
    const copies = nodes.map((n) => reId(JSON.parse(JSON.stringify(n))));
    for (const c of copies) translateNode(c, 12, 12);
    asset.root.push(...copies);
    vecState.selection = copies.map((c) => c.id);
  });
}

function reId(node) {
  node.id = freshId();
  if (node.node === "group") node.children.forEach(reId);
  return node;
}

function vecGroupSelection(asset) {
  const ids = new Set(vecState.selection);
  if (ids.size < 2) return;
  vecEdit(asset, () => {
    const chosen = asset.root.filter((n) => ids.has(n.id));
    asset.root = asset.root.filter((n) => !ids.has(n.id));
    const group = makeGroup(chosen);
    asset.root.push(group);
    vecState.selection = [group.id];
  });
}

function vecReorder(asset, id, dir) {
  const found = vecFindNode(asset, id);
  if (!found) return;
  const sib = found.siblings;
  const i = sib.indexOf(found.node);
  const j = i + dir;
  if (j < 0 || j >= sib.length) return;
  vecEdit(asset, () => {
    const [n] = sib.splice(i, 1);
    sib.splice(j, 0, n);
  });
}

// Dissolve a selected group, lifting its children into the parent at the
// group's position and baking the group's base offset into each child.
function vecUngroup(asset) {
  const groups = vecSelectedNodes(asset).filter((n) => n.node === "group");
  if (!groups.length) return;
  vecEdit(asset, () => {
    const lifted = [];
    for (const g of groups) {
      const found = vecFindNode(asset, g.id);
      if (!found) continue;
      const sib = found.siblings;
      const idx = sib.indexOf(g);
      const off = g.transform.pos.keys[0];
      g.children.forEach((c) => translateNode(c, off.x, off.y));
      sib.splice(idx, 1, ...g.children);
      lifted.push(...g.children.map((c) => c.id));
    }
    vecState.selection = lifted;
  });
}

function vecToggleVisible(asset, id) {
  const found = vecFindNode(asset, id);
  if (!found) return;
  const next = !evalBool(found.node.visible, snapT(asset, vecState.time));
  vecEdit(asset, () => (keyToEditRaw(asset, found.node, "visible").v = next));
}

/* ==================== Tracks & keyframes ==================== */

// Enumerate a node's animatable tracks as { label, key, kind }. `key` is a
// stable string id so selections survive undo (which replaces node objects).
function nodeTracks(node) {
  const out = [];
  const add = (label, key, kind) => out.push({ label, key, kind });
  add("Visibility", "visible", "bool");
  if (node.node === "group") {
    add("Position", "tpos", "point");
    add("Scale", "tscale", "scalar");
  } else if (node.kind === "oval" || node.kind === "rect") {
    add("Position", "pos", "point");
    add("Size", "size", "point");
    add("Stroke", "stroke", "scalar");
  } else if (node.kind === "line") {
    add("Point A", "a", "point");
    add("Point B", "b", "point");
    add("Width", "stroke", "scalar");
  } else {
    node.verts.forEach((_, i) => add(`Vertex ${i + 1}`, `v${i}`, "point"));
    add("Stroke", "stroke", "scalar");
  }
  return out;
}

function resolveTrack(node, key) {
  if (key === "visible") return node.visible;
  if (key === "tpos") return node.transform.pos;
  if (key === "tscale") return node.transform.scale;
  if (key === "pos") return node.pos;
  if (key === "size") return node.size;
  if (key === "stroke") return node.stroke;
  if (key === "a") return node.a;
  if (key === "b") return node.b;
  if (key.startsWith("v")) return node.verts[Number(key.slice(1))];
  return null;
}

function trackKindFor(node, key) {
  if (key === "visible") return "bool";
  if (key === "tscale" || key === "stroke") return "scalar";
  return "point";
}

// Snap a time to the frame grid and clamp to the timeline.
function snapT(asset, t) {
  const f = asset.fps || VEC_DEFAULT_FPS;
  return Math.max(0, Math.min(asset.duration, Math.round(t * f) / f));
}

function findKeyAt(track, t) {
  return track.keys.findIndex((k) => Math.abs(k.t - t) < 1e-4);
}

function insertKeySorted(track, key) {
  track.keys.push(key);
  track.keys.sort((a, b) => a.t - b.t);
}

function sampleTrack(track, kind, t) {
  if (kind === "bool") return evalBool(track, t);
  if (kind === "point") return evalPoint(track, t);
  return evalScalar(track, t);
}

function newKeyFor(kind, t, sample) {
  if (kind === "bool") return { t, v: sample };
  if (kind === "point") return { t, x: sample.x, y: sample.y, ease: vecEase(), spatial: "linear" };
  return { t, v: sample, ease: vecEase() };
}

// Add a keyframe at the playhead capturing the current interpolated value.
// Return the key object a value edit should target, respecting the stopwatch:
// a constant track edits its single key; an animated track keys the playhead
// (inserting one there if needed). Does not push history / save.
function keyToEditRaw(asset, node, key) {
  const track = resolveTrack(node, key);
  const kind = trackKindFor(node, key);
  if (!track.animated) return track.keys[0];
  const t = snapT(asset, vecState.time);
  let i = findKeyAt(track, t);
  if (i < 0) {
    insertKeySorted(track, newKeyFor(kind, t, sampleTrack(track, kind, t)));
    i = findKeyAt(track, t);
  }
  return track.keys[i];
}

// Add an explicit keyframe at the playhead, enabling animation if needed.
function vecAddKey(asset, node, key) {
  const kind = trackKindFor(node, key);
  const track = resolveTrack(node, key);
  const t = snapT(asset, vecState.time);
  vecEdit(asset, () => {
    track.animated = true;
    if (findKeyAt(track, t) < 0) insertKeySorted(track, newKeyFor(kind, t, sampleTrack(track, kind, t)));
    vecState.selKey = { nodeId: node.id, key, t };
  });
}

// Stopwatch toggle: enable animation (seeding a key at the playhead) or
// collapse back to a constant at the current value.
function vecToggleAnimated(asset, node, key) {
  const track = resolveTrack(node, key);
  const kind = trackKindFor(node, key);
  const t = snapT(asset, vecState.time);
  vecEdit(asset, () => {
    if (track.animated) {
      track.keys = [newKeyFor(kind, 0, sampleTrack(track, kind, t))];
      track.animated = false;
      vecState.selKey = null;
    } else {
      track.animated = true;
      if (findKeyAt(track, t) < 0) insertKeySorted(track, newKeyFor(kind, t, sampleTrack(track, kind, t)));
    }
  });
}

// Set a value at the playhead. A constant track edits in place; an animated
// track keys at the playhead. `fields` is merged into the target key.
function vecSetValueAtTime(asset, node, key, fields) {
  vecEdit(asset, () => Object.assign(keyToEditRaw(asset, node, key), fields));
}

function vecMoveKey(asset, node, key, index, newT) {
  const track = resolveTrack(node, key);
  const t = snapT(asset, newT);
  if (findKeyAt(track, t) >= 0 && Math.abs(track.keys[index].t - t) > 1e-4) return;
  track.keys[index].t = t;
  track.keys.sort((a, b) => a.t - b.t);
}

function vecDeleteKey(asset, node, key, index) {
  const track = resolveTrack(node, key);
  if (track.keys.length <= 1) return; // a track always keeps at least one key
  vecEdit(asset, () => {
    track.keys.splice(index, 1);
    vecState.selKey = null;
  });
}

/* ==================== Handles & nested transforms ==================== */

const VEC_HANDLE_HIT = 7; // px

// Which box edges a handle moves: -1 left/top, 1 right/bottom, 0 none.
const BOX_HANDLES = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0],
  se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

// Handle positions (doc coords) for a top-level shape at time t.
function shapeHandles(node, t) {
  if (node.kind === "oval" || node.kind === "rect") {
    const p = evalPoint(node.pos, t);
    const s = evalPoint(node.size, t);
    const L = Math.min(p.x, p.x + s.x);
    const T = Math.min(p.y, p.y + s.y);
    const W = Math.abs(s.x);
    const H = Math.abs(s.y);
    return Object.entries(BOX_HANDLES).map(([id, [dx, dy]]) => ({
      id,
      x: L + (dx < 0 ? 0 : dx > 0 ? W : W / 2),
      y: T + (dy < 0 ? 0 : dy > 0 ? H : H / 2),
    }));
  }
  if (node.kind === "line") {
    const a = evalPoint(node.a, t);
    const b = evalPoint(node.b, t);
    return [{ id: "a", x: a.x, y: a.y }, { id: "b", x: b.x, y: b.y }];
  }
  if (node.kind === "polygon") {
    return node.verts.map((v, i) => ({ id: `v${i}`, ...evalPoint(v, t) }));
  }
  return [];
}

function hitHandle(node, p, t) {
  const tol = VEC_HANDLE_HIT / vecState.zoom;
  for (const h of shapeHandles(node, t)) {
    if (Math.hypot(p.x - h.x, p.y - h.y) <= tol) return h.id;
  }
  return null;
}

// Ancestor group chain (outermost first) for a node id, or null if not found.
function nodePath(nodes, id, chain = []) {
  for (const n of nodes) {
    if (n.id === id) return chain;
    if (n.node === "group") {
      const r = nodePath(n.children, id, [...chain, n]);
      if (r) return r;
    }
  }
  return null;
}

// Map a node-local point through its ancestor group transforms to screen-doc
// coords (uniform scale about the canvas centre + translate, innermost first).
function mapNodeToScreen(asset, chain, p, t) {
  const cx = asset.width / 2;
  const cy = asset.height / 2;
  let x = p.x;
  let y = p.y;
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const g = chain[i];
    const s = evalScalar(g.transform.scale, t);
    const tt = evalPoint(g.transform.pos, t);
    x = cx + (x - cx) * s + tt.x;
    y = cy + (y - cy) * s + tt.y;
  }
  return { x, y };
}

function projectToSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  let tt = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  tt = Math.max(0, Math.min(1, tt));
  return { x: a.x + tt * dx, y: a.y + tt * dy };
}

function vecRenameNode(asset, id, name) {
  const found = vecFindNode(asset, id);
  if (!found) return;
  vecEdit(asset, () => {
    found.node.name = name.trim() || found.node.kind || "node";
  });
}

/* ==================== Side panels ==================== */

function vecSidePanels(asset) {
  const col = document.createElement("div");
  col.className = "vector-panels";
  col.append(vecLayersPanel(asset), vecArrangePanel(asset), vecPropsPanel(asset));
  return col;
}

/* ==================== Arrange / align ==================== */

// Selected nodes that sit at the document root (alignment works in world
// space, so it operates on top-level nodes — like the on-canvas handles).
function vecSelectedTopLevel(asset) {
  return vecState.selection
    .map((id) => vecFindNode(asset, id))
    .filter((f) => f && !f.parent)
    .map((f) => f.node);
}

// World-space bounding box of a top-level node at the playhead.
function vecWorldBounds(node) {
  return nodeBounds(sampleNode(node, vecState.time));
}

function vecCenterInCanvas(asset, axis) {
  const nodes = vecSelectedTopLevel(asset);
  if (!nodes.length) return;
  vecEdit(asset, () => {
    for (const node of nodes) {
      const b = vecWorldBounds(node);
      if (!b) continue;
      if (axis !== "v") translateNode(node, asset.width / 2 - (b.x0 + b.x1) / 2, 0);
      if (axis !== "h") translateNode(node, 0, asset.height / 2 - (b.y0 + b.y1) / 2);
    }
  });
}

function vecAlign(asset, edge) {
  const nodes = vecSelectedTopLevel(asset);
  if (nodes.length < 2) return;
  const items = nodes.map((n) => ({ n, b: vecWorldBounds(n) })).filter((o) => o.b);
  if (items.length < 2) return;
  const x0 = Math.min(...items.map((o) => o.b.x0));
  const x1 = Math.max(...items.map((o) => o.b.x1));
  const y0 = Math.min(...items.map((o) => o.b.y0));
  const y1 = Math.max(...items.map((o) => o.b.y1));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  vecEdit(asset, () => {
    for (const { n, b } of items) {
      if (edge === "left") translateNode(n, x0 - b.x0, 0);
      else if (edge === "right") translateNode(n, x1 - b.x1, 0);
      else if (edge === "cx") translateNode(n, cx - (b.x0 + b.x1) / 2, 0);
      else if (edge === "top") translateNode(n, 0, y0 - b.y0);
      else if (edge === "bottom") translateNode(n, 0, y1 - b.y1);
      else if (edge === "cy") translateNode(n, 0, cy - (b.y0 + b.y1) / 2);
    }
  });
}

function vecDistribute(asset, axis) {
  const nodes = vecSelectedTopLevel(asset);
  if (nodes.length < 3) return;
  const items = nodes.map((n) => ({ n, b: vecWorldBounds(n) })).filter((o) => o.b);
  if (items.length < 3) return;
  const center = (b) => (axis === "h" ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2);
  items.sort((a, b) => center(a.b) - center(b.b));
  const first = center(items[0].b);
  const step = (center(items[items.length - 1].b) - first) / (items.length - 1);
  vecEdit(asset, () => {
    items.forEach((o, i) => {
      const d = first + step * i - center(o.b);
      if (axis === "h") translateNode(o.n, d, 0);
      else translateNode(o.n, 0, d);
    });
  });
}

function vecArrangePanel(asset) {
  const panel = document.createElement("section");
  panel.className = "vector-panel";
  const head = document.createElement("div");
  head.className = "vector-panel-head";
  head.textContent = "Arrange";
  panel.append(head);

  const body = document.createElement("div");
  body.className = "vector-arrange";
  const count = vecSelectedTopLevel(asset).length;
  if (!count) {
    const hint = document.createElement("div");
    hint.className = "vector-empty";
    hint.textContent = "Select shapes to center or align.";
    body.append(hint);
    panel.append(body);
    return panel;
  }

  const btn = (label, title, onClick, enabled = true) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn vector-arrange-btn";
    b.textContent = label;
    b.title = title;
    b.disabled = !enabled;
    b.addEventListener("click", onClick);
    return b;
  };

  const canvasRow = document.createElement("div");
  canvasRow.className = "vector-arrange-row";
  canvasRow.append(
    (() => { const l = document.createElement("span"); l.className = "vector-arrange-cap"; l.textContent = "Canvas"; return l; })(),
    btn("↔", "Center horizontally in canvas", () => vecCenterInCanvas(asset, "h")),
    btn("↕", "Center vertically in canvas", () => vecCenterInCanvas(asset, "v")),
    btn("＋", "Center in canvas", () => vecCenterInCanvas(asset, "both")),
  );
  body.append(canvasRow);

  const multi = count >= 2;
  const alignRow = document.createElement("div");
  alignRow.className = "vector-arrange-row";
  alignRow.append(
    (() => { const l = document.createElement("span"); l.className = "vector-arrange-cap"; l.textContent = "Align"; return l; })(),
    btn("L", "Align left edges", () => vecAlign(asset, "left"), multi),
    btn("C", "Align horizontal centers", () => vecAlign(asset, "cx"), multi),
    btn("R", "Align right edges", () => vecAlign(asset, "right"), multi),
    btn("T", "Align top edges", () => vecAlign(asset, "top"), multi),
    btn("M", "Align middles (vertical centers)", () => vecAlign(asset, "cy"), multi),
    btn("B", "Align bottom edges", () => vecAlign(asset, "bottom"), multi),
  );
  body.append(alignRow);

  const canDist = count >= 3;
  const distRow = document.createElement("div");
  distRow.className = "vector-arrange-row";
  distRow.append(
    (() => { const l = document.createElement("span"); l.className = "vector-arrange-cap"; l.textContent = "Distribute"; return l; })(),
    btn("↔", "Distribute horizontally", () => vecDistribute(asset, "h"), canDist),
    btn("↕", "Distribute vertically", () => vecDistribute(asset, "v"), canDist),
  );
  body.append(distRow);

  panel.append(body);
  return panel;
}

function vecLayersPanel(asset) {
  const panel = document.createElement("section");
  panel.className = "vector-panel";
  const head = document.createElement("div");
  head.className = "vector-panel-head";
  head.textContent = "Layers";
  panel.append(head);

  const list = document.createElement("div");
  list.className = "vector-layer-list";
  if (!asset.root.length) {
    const empty = document.createElement("div");
    empty.className = "vector-empty";
    empty.textContent = "No shapes yet.";
    list.append(empty);
  }
  // Front-most (last painted) at the top, recursing into groups.
  const addRows = (nodes, depth) => {
    for (const node of [...nodes].reverse()) {
      list.append(vecLayerRow(asset, node, depth));
      if (node.node === "group") addRows(node.children, depth + 1);
    }
  };
  addRows(asset.root, 0);
  panel.append(list);
  return panel;
}

function vecLayerRow(asset, node, depth = 0) {
  const row = document.createElement("div");
  const selected = vecState.selection.includes(node.id);
  row.className = `vector-layer${selected ? " active" : ""}`;
  row.style.paddingLeft = `${6 + depth * 14}px`;

  const eye = iconButton(
    "Toggle visibility",
    node.visible.keys[0].v ? "eye" : "eyeOff",
    "btn icon tiny",
    () => vecToggleVisible(asset, node.id),
  );

  const label = document.createElement("button");
  label.type = "button";
  label.className = "vector-layer-name";
  const kindTag = node.node === "group" ? `group·${node.op}` : node.kind;
  label.innerHTML = `<span>${escapeHtml(node.name)}</span><span class="vector-layer-kind">${kindTag}</span>`;
  label.addEventListener("click", () => {
    vecState.selection = [node.id];
    vecState.selKey = null;
    render();
  });
  label.addEventListener("dblclick", () => {
    const name = prompt("Rename", node.name);
    if (name != null) vecRenameNode(asset, node.id, name);
  });

  const up = iconButton("Bring forward", "forward", "btn icon tiny", () =>
    vecReorder(asset, node.id, 1),
  );
  const down = iconButton("Send backward", "back", "btn icon tiny", () =>
    vecReorder(asset, node.id, -1),
  );

  row.append(eye, label, up, down);
  return row;
}

function vecNumberField(label, value, apply) {
  const wrap = document.createElement("label");
  wrap.className = "vector-field";
  const span = document.createElement("span");
  span.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.value = Math.round(value * 100) / 100;
  input.addEventListener("change", () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) apply(v);
  });
  wrap.append(span, input);
  return wrap;
}

// Phase 1 properties edit the value at the shape's first keyframe. Full
// keyframe/timeline editing arrives in the next phase.
function vecPropsPanel(asset) {
  const panel = document.createElement("section");
  panel.className = "vector-panel";
  const head = document.createElement("div");
  head.className = "vector-panel-head";
  head.textContent = "Properties";
  panel.append(head);

  const nodes = vecSelectedNodes(asset);
  const body = document.createElement("div");
  body.className = "vector-fields";
  if (nodes.length !== 1) {
    const hint = document.createElement("div");
    hint.className = "vector-empty";
    hint.textContent = nodes.length ? `${nodes.length} selected` : "Select a shape.";
    body.append(hint);
    panel.append(body);
    return panel;
  }

  const node = nodes[0];
  // One row per animatable track: [stopwatch] label [value input(s)] [◆ nav].
  for (const tr of nodeTracks(node)) body.append(vecTrackField(asset, node, tr));
  // Non-animatable extras.
  if (node.node === "shape" && node.kind !== "line") body.append(vecFillToggle(asset, node));
  if (node.node === "group") body.append(vecOpSelect(asset, node));
  panel.append(body);
  return panel;
}

// Short axis labels per point track (Size reads W/H; positions read X/Y).
function vecAxisLabels(key) {
  return key === "size" ? ["W", "H"] : ["X", "Y"];
}

function vecTrackField(asset, node, tr) {
  const row = document.createElement("div");
  row.className = "vector-track-field";
  const track = resolveTrack(node, tr.key);
  const t = vecState.time;

  row.append(vecStopwatch(asset, node, tr.key, track));
  const name = document.createElement("span");
  name.className = "vector-track-label";
  name.textContent = tr.label;
  row.append(name);

  const inputs = document.createElement("div");
  inputs.className = "vector-track-inputs";
  if (tr.kind === "point") {
    const p = evalPoint(track, t);
    const [lx, ly] = vecAxisLabels(tr.key);
    inputs.append(
      vecMiniNum(lx, p.x, (v) => vecSetValueAtTime(asset, node, tr.key, { x: v })),
      vecMiniNum(ly, p.y, (v) => vecSetValueAtTime(asset, node, tr.key, { y: v })),
    );
  } else if (tr.kind === "scalar") {
    inputs.append(vecMiniNum("", evalScalar(track, t), (v) => vecSetValueAtTime(asset, node, tr.key, { v })));
  } else {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = evalBool(track, t);
    cb.addEventListener("change", () => vecSetValueAtTime(asset, node, tr.key, { v: cb.checked }));
    inputs.append(cb);
  }
  row.append(inputs);

  if (track.animated) row.append(vecKeyNav(asset, node, tr.key, track));
  return row;
}

function vecMiniNum(label, value, apply) {
  const wrap = document.createElement("label");
  wrap.className = "vector-mini-num";
  if (label) {
    const span = document.createElement("span");
    span.textContent = label;
    wrap.append(span);
  }
  const input = document.createElement("input");
  input.type = "number";
  input.value = Math.round(value * 100) / 100;
  input.addEventListener("change", () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) apply(v);
  });
  wrap.append(input);
  return wrap;
}

// Stopwatch: ◇ = constant, ◆ = animated. Toggles animation for the track.
function vecStopwatch(asset, node, key, track) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `vector-stopwatch${track.animated ? " on" : ""}`;
  btn.textContent = track.animated ? "◆" : "◇";
  btn.title = track.animated
    ? "Animated — click to make this property constant"
    : "Click to animate this property (adds a keyframe)";
  btn.addEventListener("click", () => vecToggleAnimated(asset, node, key));
  return btn;
}

// Keyframe navigator for an animated track: filled when the playhead sits on
// a key (click removes it), hollow otherwise (click adds one here).
function vecKeyNav(asset, node, key, track) {
  const t = snapT(asset, vecState.time);
  const idx = findKeyAt(track, t);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `vector-keynav${idx >= 0 ? " on" : ""}`;
  btn.textContent = idx >= 0 ? "◆" : "◇";
  btn.title = idx >= 0 ? "Keyframe here — click to remove" : "Add a keyframe at the playhead";
  btn.addEventListener("click", () => {
    if (idx >= 0) vecDeleteKey(asset, node, key, idx);
    else vecAddKey(asset, node, key);
  });
  return btn;
}

function vecFillToggle(asset, node) {
  const wrap = document.createElement("label");
  wrap.className = "vector-field vector-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!node.fill;
  input.addEventListener("change", () => vecEdit(asset, () => (node.fill = input.checked)));
  const span = document.createElement("span");
  span.textContent = "Fill";
  wrap.append(input, span);
  return wrap;
}

function vecOpSelect(asset, node) {
  const wrap = document.createElement("label");
  wrap.className = "vector-field";
  const span = document.createElement("span");
  span.textContent = "Boolean";
  const select = document.createElement("select");
  for (const op of ["none", "union", "intersect", "difference", "xor"]) {
    const opt = document.createElement("option");
    opt.value = op;
    opt.textContent = op;
    if (node.op === op) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener("change", () => vecEdit(asset, () => (node.op = select.value)));
  wrap.append(span, select);
  return wrap;
}

/* ==================== Timeline ==================== */

// Horizontal gutter (px) inside each lane so keyframes at t=0 and t=duration
// aren't half-clipped at the container edge. Must match --tl-gutter in CSS.
const VEC_TL_GUTTER = 8;

function laneLeftCalc(frac) {
  return `calc(var(--tl-gutter) + (100% - 2 * var(--tl-gutter)) * ${frac})`;
}

function playheadLeftCalc(frac) {
  return `calc(var(--tl-label) + var(--tl-gutter) + (100% - var(--tl-label) - 2 * var(--tl-gutter)) * ${frac})`;
}

function trackLabel(node, key) {
  return nodeTracks(node).find((tr) => tr.key === key)?.label || key;
}

function vecTimeFromX(clientX, rect, asset) {
  const g = VEC_TL_GUTTER;
  const frac = Math.max(0, Math.min(1, (clientX - rect.left - g) / (rect.width - 2 * g)));
  return frac * asset.duration;
}

function vecFracForX(clientX, rect) {
  const g = VEC_TL_GUTTER;
  return Math.max(0, Math.min(1, (clientX - rect.left - g) / (rect.width - 2 * g)));
}

function updatePlayheadDom(asset) {
  const frac = asset.duration ? vecState.time / asset.duration : 0;
  const ph = document.querySelector(".vector-tl-playhead");
  if (ph) ph.style.left = playheadLeftCalc(frac);
  const lbl = document.querySelector(".vector-tl-rulerrow .vector-tl-label");
  if (lbl) {
    const span = lbl.querySelector("span");
    if (span) span.textContent = `${vecState.time.toFixed(2)}s`;
  }
}

function vecTimeline(asset) {
  const bar = document.createElement("div");
  bar.className = "vector-timeline";
  bar.append(vecKeyInspector(asset));

  const tl = document.createElement("div");
  tl.className = "vector-tl";

  // Ruler row (scrub + playhead position readout + play button).
  const rulerRow = document.createElement("div");
  rulerRow.className = "vector-tl-row vector-tl-rulerrow";
  const rlabel = document.createElement("div");
  rlabel.className = "vector-tl-label";
  const play = iconButton(vecPlayRAF ? "Pause" : "Play", vecPlayRAF ? "pause" : "play", "btn icon tiny vector-play", () =>
    vecTogglePlay(asset),
  );
  const tspan = document.createElement("span");
  tspan.textContent = `${vecState.time.toFixed(2)}s`;
  rlabel.append(play, tspan);
  const ruler = document.createElement("div");
  ruler.className = "vector-tl-ruler";
  ruler.addEventListener("pointerdown", (e) => {
    vecStopPlay();
    const rect = ruler.getBoundingClientRect();
    vecState.tlDrag = { mode: "scrub", rect };
    vecState.time = snapT(asset, vecTimeFromX(e.clientX, rect, asset));
    drawVectorStage(asset);
    updatePlayheadDom(asset);
  });
  rulerRow.append(rlabel, ruler);
  tl.append(rulerRow);

  // Track rows for a single selected node — only tracks with animation on.
  const nodes = vecSelectedNodes(asset);
  if (nodes.length === 1) {
    const animated = nodeTracks(nodes[0]).filter((tr) => resolveTrack(nodes[0], tr.key).animated);
    if (animated.length) {
      const scroll = document.createElement("div");
      scroll.className = "vector-tl-scroll";
      for (const tr of animated) scroll.append(vecTrackRow(asset, nodes[0], tr));
      tl.append(scroll);
    } else {
      const hint = document.createElement("div");
      hint.className = "vector-tl-hint";
      hint.textContent = "No animated properties. Click a ◇ stopwatch in Properties to animate one.";
      tl.append(hint);
    }
  } else {
    const hint = document.createElement("div");
    hint.className = "vector-tl-hint";
    hint.textContent = nodes.length
      ? "Select a single shape to edit its tracks."
      : "Select a shape to edit keyframes.";
    tl.append(hint);
  }

  const playhead = document.createElement("div");
  playhead.className = "vector-tl-playhead";
  const frac = asset.duration ? vecState.time / asset.duration : 0;
  playhead.style.left = playheadLeftCalc(frac);
  tl.append(playhead);

  bar.append(tl);
  return bar;
}

function vecTrackRow(asset, node, tr) {
  const row = document.createElement("div");
  row.className = "vector-tl-row";
  const label = document.createElement("div");
  label.className = "vector-tl-label vector-tl-tracklabel";
  const name = document.createElement("span");
  name.textContent = tr.label;
  label.append(name, iconButton("Add keyframe", "plus", "btn icon tiny", () => vecAddKey(asset, node, tr.key)));

  const lane = document.createElement("div");
  lane.className = "vector-tl-lane";
  // Clicking empty lane space scrubs (matches the ruler); keyframes are added
  // explicitly via the + button or the Properties keyframe navigator.
  lane.addEventListener("pointerdown", (e) => {
    if (e.target !== lane) return;
    vecStopPlay();
    const rect = lane.getBoundingClientRect();
    vecState.tlDrag = { mode: "scrub", rect };
    vecState.time = snapT(asset, vecTimeFromX(e.clientX, rect, asset));
    drawVectorStage(asset);
    updatePlayheadDom(asset);
  });

  const track = resolveTrack(node, tr.key);
  track.keys.forEach((k, index) => {
    const d = document.createElement("button");
    d.type = "button";
    d.className = "vector-tl-key";
    const sel = vecState.selKey;
    if (sel && sel.nodeId === node.id && sel.key === tr.key && Math.abs(sel.t - k.t) < 1e-4) {
      d.classList.add("active");
    }
    d.style.left = laneLeftCalc(asset.duration ? k.t / asset.duration : 0);
    d.title = `${k.t.toFixed(2)}s`;
    d.addEventListener("pointerdown", (e) => vecKeyPointer(e, asset, node, tr.key, index, lane, d));
    lane.append(d);
  });

  row.append(label, lane);
  return row;
}

function vecKeyPointer(event, asset, node, key, index, lane, el) {
  event.stopPropagation();
  event.preventDefault();
  vecStopPlay();
  const keyObj = resolveTrack(node, key).keys[index];
  vecState.selKey = { nodeId: node.id, key, t: keyObj.t };
  vecState.tlDrag = { mode: "key", node, key, keyObj, el, rect: lane.getBoundingClientRect(), pushed: false, moved: false };
  // Highlight without a full re-render so el stays attached for the drag.
  document.querySelectorAll(".vector-tl-key.active").forEach((n) => n.classList.remove("active"));
  el.classList.add("active");
}

function vecKeyInspector(asset) {
  const wrap = document.createElement("div");
  wrap.className = "vector-key-inspector";
  const sel = vecState.selKey;
  const found = sel && vecFindNode(asset, sel.nodeId);
  if (!sel || !found) {
    wrap.classList.add("muted");
    wrap.textContent = "No keyframe selected — click a diamond to edit its easing. Add keys with ◆ in Properties or the + on a track.";
    return wrap;
  }
  const node = found.node;
  const track = resolveTrack(node, sel.key);
  const index = track ? findKeyAt(track, sel.t) : -1;
  if (index < 0) {
    wrap.classList.add("muted");
    wrap.textContent = "No keyframe selected.";
    return wrap;
  }
  const kind = trackKindFor(node, sel.key);
  const k = track.keys[index];
  const title = document.createElement("span");
  title.className = "vector-key-title";
  title.textContent = `${trackLabel(node, sel.key)} · ${k.t.toFixed(2)}s`;
  wrap.append(title);

  const isLast = index === track.keys.length - 1;
  if (kind === "bool") {
    wrap.append(
      vecLabeled("Visible", vecToggleInput(k.v, (v) => vecSetKeyField(asset, node, sel.key, index, { v }))),
    );
  } else if (isLast) {
    const note = document.createElement("span");
    note.className = "vector-key-note";
    note.textContent = "last key — no outgoing segment";
    wrap.append(note);
  } else {
    wrap.append(
      vecLabeled(
        "Ease",
        vecSelectInput(["linear", "in", "out", "inout"], k.ease?.type || "linear", (v) =>
          vecSetEase(asset, node, sel.key, index, { type: v }),
        ),
      ),
      vecLabeled("Strength", vecStrengthSlider(asset, node, sel.key, index, k.ease?.strength || 0)),
    );
    if (kind === "point") {
      wrap.append(
        vecLabeled(
          "Path",
          vecSelectInput(["linear", "smooth"], k.spatial || "linear", (v) =>
            vecSetSpatial(asset, node, sel.key, index, v),
          ),
        ),
      );
    }
  }
  wrap.append(iconButton("Delete keyframe", "trash", "btn icon", () => vecDeleteKey(asset, node, sel.key, index)));
  return wrap;
}

/* -------- small inspector controls -------- */

function vecLabeled(label, el) {
  const wrap = document.createElement("label");
  wrap.className = "vector-field vector-inline";
  const span = document.createElement("span");
  span.textContent = label;
  wrap.append(span, el);
  return wrap;
}

function vecSelectInput(options, value, onChange) {
  const select = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (opt === value) o.selected = true;
    select.append(o);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function vecToggleInput(checked, onChange) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return input;
}

// Live-updates during drag (no full re-render, which would break the drag),
// commits once on release.
function vecStrengthSlider(asset, node, key, index, value) {
  const input = document.createElement("input");
  input.type = "range";
  input.min = 0;
  input.max = 1;
  input.step = 0.01;
  input.value = value;
  let pushed = false;
  input.addEventListener("input", () => {
    if (!pushed) {
      vecPushHistory(asset);
      pushed = true;
    }
    const k = resolveTrack(node, key).keys[index];
    if (!k.ease) k.ease = vecEase();
    k.ease.strength = Number(input.value);
    drawVectorStage(asset);
  });
  input.addEventListener("change", () => {
    pushed = false;
    asset.updatedAt = Date.now();
    saveAssets();
  });
  return input;
}

function vecSetEase(asset, node, key, index, fields) {
  vecEdit(asset, () => {
    const k = resolveTrack(node, key).keys[index];
    k.ease = { ...(k.ease || vecEase()), ...fields };
  });
}

function vecSetSpatial(asset, node, key, index, v) {
  vecEdit(asset, () => (resolveTrack(node, key).keys[index].spatial = v));
}

function vecSetKeyField(asset, node, key, index, fields) {
  vecEdit(asset, () => Object.assign(resolveTrack(node, key).keys[index], fields));
}

/* ==================== Playback ==================== */

let vecPlayRAF = null;
let vecPlayLast = 0;

function vecTogglePlay(asset) {
  if (vecPlayRAF) vecStopPlay();
  else {
    vecPlayLast = performance.now();
    vecPlayRAF = requestAnimationFrame(vecPlayTick);
    const btn = document.querySelector(".vector-play");
    if (btn) btn.innerHTML = ICONS.pause;
  }
}

function vecStopPlay() {
  if (vecPlayRAF) {
    cancelAnimationFrame(vecPlayRAF);
    vecPlayRAF = null;
    const btn = document.querySelector(".vector-play");
    if (btn) btn.innerHTML = ICONS.play;
  }
}

function vecPlayTick(now) {
  const asset = activeAsset();
  if (!asset || asset.type !== "vector" || state.screen !== "editor") {
    vecPlayRAF = null;
    return;
  }
  const dt = (now - vecPlayLast) / 1000;
  vecPlayLast = now;
  vecState.time += dt;
  if (vecState.time >= asset.duration) vecState.time %= asset.duration || 1;
  drawVectorStage(asset);
  updatePlayheadDom(asset);
  vecPlayRAF = requestAnimationFrame(vecPlayTick);
}

/* ==================== Drawing ==================== */

function drawVectorStage(asset) {
  const scene = document.querySelector(".vector-scene");
  const overlay = document.querySelector(".vector-overlay");
  if (!scene || !overlay) return;

  const sctx = scene.getContext("2d");
  sctx.clearRect(0, 0, scene.width, scene.height);
  const raster = rasterizeVector(asset, vecState.time);
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(raster, 0, 0);

  const z = vecState.zoom;
  const octx = overlay.getContext("2d");
  octx.clearRect(0, 0, overlay.width, overlay.height);

  // Center snap guides.
  if (vecState.snapX || vecState.snapY) {
    octx.strokeStyle = "#ff4ec8";
    octx.lineWidth = 1;
    if (vecState.snapX) {
      const x = (asset.width / 2) * z + 0.5;
      octx.beginPath();
      octx.moveTo(x, 0);
      octx.lineTo(x, overlay.height);
      octx.stroke();
    }
    if (vecState.snapY) {
      const y = (asset.height / 2) * z + 0.5;
      octx.beginPath();
      octx.moveTo(0, y);
      octx.lineTo(overlay.width, y);
      octx.stroke();
    }
  }

  // Selection outlines (mapped through any ancestor group transforms).
  octx.strokeStyle = "#4ea1ff";
  octx.lineWidth = 1;
  const selNodes = vecSelectedNodes(asset);
  for (const node of selNodes) {
    const box = nodeBounds(sampleNode(node, vecState.time));
    if (!box) continue;
    const chain = nodePath(asset.root, node.id) || [];
    const p0 = mapNodeToScreen(asset, chain, { x: box.x0, y: box.y0 }, vecState.time);
    const p1 = mapNodeToScreen(asset, chain, { x: box.x1, y: box.y1 }, vecState.time);
    octx.strokeRect(
      Math.min(p0.x, p1.x) * z + 0.5,
      Math.min(p0.y, p1.y) * z + 0.5,
      Math.abs(p1.x - p0.x) * z,
      Math.abs(p1.y - p0.y) * z,
    );
  }

  // Direct-manipulation handles: single selected top-level shape only.
  if (selNodes.length === 1 && selNodes[0].node === "shape") {
    const chain = nodePath(asset.root, selNodes[0].id) || [];
    if (chain.length === 0) {
      const poly = selNodes[0].kind === "polygon";
      for (const h of shapeHandles(selNodes[0], vecState.time)) {
        const hx = h.x * z;
        const hy = h.y * z;
        octx.fillStyle = "#fff";
        octx.strokeStyle = "#4ea1ff";
        if (poly) {
          octx.beginPath();
          octx.arc(hx, hy, 4, 0, Math.PI * 2);
          octx.fill();
          octx.stroke();
        } else {
          octx.fillRect(hx - 4, hy - 4, 8, 8);
          octx.strokeRect(hx - 4, hy - 4, 8, 8);
        }
      }
    }
  }

  // In-progress polygon.
  if (vecState.polygonDraft?.length) {
    const d = vecState.polygonDraft;
    octx.strokeStyle = "#ffd24e";
    octx.fillStyle = "#ffd24e";
    octx.beginPath();
    d.forEach((pt, i) => (i ? octx.lineTo(pt.x * z, pt.y * z) : octx.moveTo(pt.x * z, pt.y * z)));
    if (vecState.polygonPreview) octx.lineTo(vecState.polygonPreview.x * z, vecState.polygonPreview.y * z);
    octx.stroke();
    for (const pt of d) octx.fillRect(pt.x * z - 2, pt.y * z - 2, 4, 4);
    if (vecState.hoverClose) {
      octx.strokeStyle = "#4eff9a";
      octx.strokeRect(d[0].x * z - 4, d[0].y * z - 4, 8, 8);
    }
  }

  // Creation preview.
  const drag = vecState.drag;
  if (drag?.mode === "create") {
    octx.strokeStyle = "#4ea1ff";
    if (drag.tool === "line") {
      octx.beginPath();
      octx.moveTo(drag.startX * z, drag.startY * z);
      octx.lineTo(drag.curX * z, drag.curY * z);
      octx.stroke();
    } else {
      const x = Math.min(drag.startX, drag.curX) * z;
      const y = Math.min(drag.startY, drag.curY) * z;
      octx.strokeRect(x, y, Math.abs(drag.curX - drag.startX) * z, Math.abs(drag.curY - drag.startY) * z);
    }
  }
}

function nodeBounds(s) {
  if (s.node === "group") {
    let box = null;
    for (const c of s.children) {
      const b = nodeBounds(c);
      if (!b) continue;
      box = box
        ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) }
        : b;
    }
    return box;
  }
  if (s.kind === "oval" || s.kind === "rect") {
    return {
      x0: Math.min(s.x, s.x + s.w),
      y0: Math.min(s.y, s.y + s.h),
      x1: Math.max(s.x, s.x + s.w),
      y1: Math.max(s.y, s.y + s.h),
    };
  }
  if (s.kind === "line") {
    return { x0: Math.min(s.a.x, s.b.x), y0: Math.min(s.a.y, s.b.y), x1: Math.max(s.a.x, s.b.x), y1: Math.max(s.a.y, s.b.y) };
  }
  if (s.kind === "polygon" && s.verts.length) {
    const xs = s.verts.map((v) => v.x);
    const ys = s.verts.map((v) => v.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  return null;
}

// Gallery / preview: draw the scene at t=0 into a preview canvas.
function drawVectorPreview(canvas, asset) {
  const raster = rasterizeVector(asset, 0);
  canvas.width = asset.width;
  canvas.height = asset.height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(raster, 0, 0);
}

/* ==================== Keyboard ==================== */

// Timeline drags use window-level listeners so a full re-render (which
// detaches DOM nodes) is never needed mid-drag.
window.addEventListener("pointermove", (event) => {
  const drag = vecState.tlDrag;
  if (!drag) return;
  const asset = activeAsset();
  if (!asset || asset.type !== "vector") return;

  if (drag.mode === "scrub") {
    vecState.time = snapT(asset, vecTimeFromX(event.clientX, drag.rect, asset));
    drawVectorStage(asset);
    updatePlayheadDom(asset);
  } else if (drag.mode === "key") {
    const frac = vecFracForX(event.clientX, drag.rect);
    const t = snapT(asset, frac * asset.duration);
    if (Math.abs(t - drag.keyObj.t) < 1e-9) return;
    const track = resolveTrack(drag.node, drag.key);
    // Don't stack onto another key at the same frame.
    if (track.keys.some((k) => k !== drag.keyObj && Math.abs(k.t - t) < 1e-4)) return;
    if (!drag.pushed) {
      vecPushHistory(asset);
      drag.pushed = true;
    }
    drag.moved = true;
    drag.keyObj.t = t;
    track.keys.sort((a, b) => a.t - b.t);
    vecState.selKey = { nodeId: drag.node.id, key: drag.key, t };
    if (drag.el) drag.el.style.left = laneLeftCalc(asset.duration ? t / asset.duration : 0);
    drawVectorStage(asset);
  }
});

window.addEventListener("pointerup", () => {
  const drag = vecState.tlDrag;
  if (!drag) return;
  vecState.tlDrag = null;
  const asset = activeAsset();
  if (drag.mode === "key" && drag.moved && asset) {
    asset.updatedAt = Date.now();
    saveAssets();
  }
  render();
});

// Registered before app.js's handler (this script loads first), so we can
// preempt raster shortcuts while the vector editor is active.
window.addEventListener("keydown", (event) => {
  const asset = activeAsset();
  if (state.screen !== "editor" || asset?.type !== "vector") return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

  if (event.key === "Escape") {
    if (vecState.polygonDraft) {
      vecState.polygonDraft = null;
      vecState.polygonPreview = null;
      render();
    } else if (vecState.selection.length) {
      vecState.selection = [];
      render();
    }
    return;
  }
  if (event.key === "Enter" && vecState.polygonDraft?.length >= 3) {
    event.preventDefault();
    vecCommitPolygon(asset);
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    event.stopImmediatePropagation();
    const sel = vecState.selKey;
    const found = sel && vecFindNode(asset, sel.nodeId);
    if (sel && found) {
      const track = resolveTrack(found.node, sel.key);
      const index = track ? findKeyAt(track, sel.t) : -1;
      if (index >= 0) {
        vecDeleteKey(asset, found.node, sel.key, index);
        return;
      }
    }
    vecDeleteSelection(asset);
    return;
  }
  if (event.metaKey || event.ctrlKey) {
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.shiftKey ? vecRedo() : vecUndo();
    } else if (key === "y") {
      event.preventDefault();
      event.stopImmediatePropagation();
      vecRedo();
    } else if (key === "d") {
      event.preventDefault();
      event.stopImmediatePropagation();
      vecDuplicateSelection(asset);
    }
  }
});
