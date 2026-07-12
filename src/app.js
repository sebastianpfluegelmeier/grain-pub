const STORAGE_KEY = "grain.assets.v1";
const SYNC_TOKEN_KEY = "grain.assets.github.token";
const SYNC_OWNER_KEY = "grain.assets.github.owner";
const SYNC_REPO_KEY = "grain.assets.github.repo";
const SYNC_DEFAULT_REPO = "grain-userdata";
const SYNC_BRANCH = "main";
const SYNC_PREFIX = "asset-editor/";
const SYNC_STATE_KEY = "grain.assets.sync.state";
const DEFAULT_TILE_SIZE = 16;
const MIN_TILE_SIZE = 4;
const MIN_PARTICLE_SIZE = 1;
const MAX_TILE_SIZE = 32;
const MAX_BLOCKSET_SIZE = 512;
const MAX_CUBE_SIZE = 1024;
const DEFAULT_FPS = 8;
const MIN_FPS = 1;
const MAX_FPS = 24;
const STARTER_FRAME_COUNT = 4;
const BASE_TILE_RENDER_SIZE = 384;
const CHECKER_DISPLAY_SIZE = 10;
const MAX_CANVAS_CELL_SIZE = 40;
const ZOOM_LEVELS = [1, 2, 4, 8, 16];
const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 64;
const MAX_Z_BRUSH_RADIUS = 16;
const HISTORY_LIMIT = 100;
const MAX_PARTICLE_PREVIEW_COUNT = 500;
const PARTICLE_PREVIEW_WIDTH = 480;
const PARTICLE_PREVIEW_HEIGHT = 240;
const MIN_PARTICLE_PREVIEW_SIZE = 16;
const MAX_PARTICLE_PREVIEW_SIZE = 1024;
const TOUCH_DRAW_THRESHOLD_PX = 6;
const PEN_PALM_REJECTION_MS = 800;
const Pixel = {
  Transparent: 0,
  Black: 1,
  White: 2,
};
const BINARY_ASSET_MAGIC = [0x54, 0x47, 0x41, 0x53]; // TGAS
const BINARY_ASSET_VERSION_V1 = 1;
const BINARY_ASSET_VERSION_V2 = 2;
const BINARY_ASSET_HEADER_SIZE = 18;
const BINARY_PARTICLE_DESCRIPTOR_SIZE = 8;
const BINARY_ASSET_KIND = {
  tileset: 1,
  animation: 2,
  cube: 3,
  blockset: 4,
  particles: 5,
};
const BINARY_KIND_ASSET = Object.fromEntries(Object.entries(BINARY_ASSET_KIND).map(([type, kind]) => [kind, type]));
const BINARY_ASSET_VISIBLE = 0x01;
const GRAY_BASE = 10;
const WRAP_MARGIN_RATIO = 0.25;
const MAX_WRAP_MARGIN = 32;
const PEN_TOOLS = ["pen", "dither", "spray", "noise", "blur", "displace"];
const DRAG_TOOLS = ["line", "square", "gradient", "shift"];
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const ONION_PREV_CSS = "rgba(217, 45, 32, 0.32)";
const ONION_NEXT_CSS = "rgba(39, 90, 210, 0.32)";
const DOCK_SCROLL_SELECTORS = [".tool-row", ".brush-row", ".frame-actions", ".tile-actions", ".tile-row"];
const CELL_NOUNS = {
  tileset: "tile",
  animation: "frame",
  cube: "slice",
  blockset: "layer",
  particles: "frame",
};
const PARTICLE_PREVIEW_DEFAULTS = Object.freeze({
  number: 40,
  speed: 1,
  driftX: 0,
  driftY: 0,
  movement: 12,
  dirChange: 0.5,
  canvasWidth: PARTICLE_PREVIEW_WIDTH,
  canvasHeight: PARTICLE_PREVIEW_HEIGHT,
});

const ICON_ATTRS = 'viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICONS = {
  pen: `<svg ${ICON_ATTRS}><path d="M11.2 2.7a1.3 1.3 0 0 1 1.85 0l.25.25a1.3 1.3 0 0 1 0 1.85L6.6 11.5 3 13l1.5-3.6 6.7-6.7z"/><path d="M10.1 3.8l2.1 2.1"/></svg>`,
  line: `<svg ${ICON_ATTRS}><path d="M3.2 12.8 12.8 3.2"/></svg>`,
  square: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>`,
  circle: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="5.2"/></svg>`,
  plus: `<svg ${ICON_ATTRS}><path d="M8 3.2v9.6M3.2 8h9.6"/></svg>`,
  minus: `<svg ${ICON_ATTRS}><path d="M3.2 8h9.6"/></svg>`,
  duplicate: `<svg ${ICON_ATTRS}><rect x="5.7" y="5.7" width="7.1" height="7.1" rx="1.4"/><path d="M10.3 3.2H4.9a1.7 1.7 0 0 0-1.7 1.7v5.4"/></svg>`,
  undo: `<svg ${ICON_ATTRS}><path d="M3 6.8h6.2a3.4 3.4 0 0 1 0 6.8H6.6"/><path d="M5.8 4 3 6.8l2.8 2.8"/></svg>`,
  redo: `<svg ${ICON_ATTRS}><path d="M13 6.8H6.8a3.4 3.4 0 0 0 0 6.8h2.6"/><path d="M10.2 4 13 6.8l-2.8 2.8"/></svg>`,
  trash: `<svg ${ICON_ATTRS}><path d="M3 4.4h10M6.4 4.4V3h3.2v1.4M4.4 4.4l.5 8.6h6.2l.5-8.6"/></svg>`,
  back: `<svg ${ICON_ATTRS}><path d="M9.8 3.4 5.2 8l4.6 4.6"/></svg>`,
  sync: `<svg ${ICON_ATTRS}><path d="M13 8a5 5 0 0 1-8.7 3.4M3 8a5 5 0 0 1 8.7-3.4"/><path d="M11.4 1.8l.3 2.8-2.8.3M4.6 14.2l-.3-2.8 2.8-.3"/></svg>`,
  dither: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="2.4" height="2.4"/><rect x="7.8" y="3" width="2.4" height="2.4"/><rect x="5.4" y="5.4" width="2.4" height="2.4"/><rect x="10.2" y="5.4" width="2.4" height="2.4"/><rect x="3" y="7.8" width="2.4" height="2.4"/><rect x="7.8" y="7.8" width="2.4" height="2.4"/><rect x="5.4" y="10.2" width="2.4" height="2.4"/><rect x="10.2" y="10.2" width="2.4" height="2.4"/></svg>`,
  spray: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="1.4"/><circle cx="4" cy="5" r="1"/><circle cx="12" cy="4.5" r="1"/><circle cx="11.5" cy="11.5" r="1"/><circle cx="4.5" cy="11" r="1"/><circle cx="8" cy="3" r="0.8"/><circle cx="13" cy="8" r="0.8"/><circle cx="3" cy="8" r="0.8"/><circle cx="8" cy="13" r="0.8"/></svg>`,
  noise: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="2" height="2"/><rect x="8" y="2" width="1.6" height="1.6"/><rect x="12" y="4" width="1.7" height="1.7"/><rect x="5.8" y="6.2" width="2.4" height="2.4"/><rect x="10.5" y="8" width="1.6" height="1.6"/><rect x="2.8" y="10.2" width="2.2" height="2.2"/><rect x="7.5" y="11.5" width="2" height="2"/><rect x="12" y="12" width="1.8" height="1.8"/></svg>`,
  blur: `<svg ${ICON_ATTRS}><circle cx="6.2" cy="6.1" r="2.7"/><circle cx="9.8" cy="9.8" r="2.7"/><path d="M3 12.8h10" stroke-dasharray="1.6 2"/></svg>`,
  displace: `<svg ${ICON_ATTRS}><path d="M3 9.5c2.2-3 4.7 3 7 0 1-.9 1.5-2.1 1.5-3.5"/><path d="M9.3 4.2 11.5 6 9.7 8.2"/><path d="M4.5 12.8h7"/></svg>`,
  gradient: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="3" width="3.4" height="10" fill="currentColor"/><rect x="6.3" y="3" width="3.4" height="10" fill="currentColor" opacity="0.55"/><rect x="9.6" y="3" width="3.4" height="10" fill="currentColor" opacity="0.18"/><rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  fill: `<svg ${ICON_ATTRS}><path d="M7.5 2.2 12.6 7.3 8 11.9a1.4 1.4 0 0 1-2 0L3.6 9.5a1.4 1.4 0 0 1 0-2z"/><path d="M13.4 10.6s1.2 1.5 1.2 2.4a1.2 1.2 0 0 1-2.4 0c0-.9 1.2-2.4 1.2-2.4z" fill="currentColor" stroke="none"/></svg>`,
  shift: `<svg ${ICON_ATTRS}><path d="M8 2.5v11M2.5 8h11"/><path d="M6.3 4.2 8 2.5l1.7 1.7M6.3 11.8 8 13.5l1.7-1.7M4.2 6.3 2.5 8l1.7 1.7M11.8 6.3 13.5 8l-1.7 1.7"/></svg>`,
  onion: `<svg ${ICON_ATTRS}><rect x="2.5" y="2.5" width="8" height="8"/><rect x="5.5" y="5.5" width="8" height="8" stroke-dasharray="1.6 1.8"/></svg>`,
  tween: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="3.4" cy="8" r="1.7" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.7" fill="currentColor" fill-opacity="0.45" stroke="none"/><circle cx="12.6" cy="8" r="1.7"/></svg>`,
  stack: `<svg ${ICON_ATTRS}><path d="M8 2.2 14 5.2 8 8.2 2 5.2z"/><path d="M2 8.2l6 3 6-3M2 11.2l6 3 6-3"/></svg>`,
  target: `<svg ${ICON_ATTRS}><circle cx="8" cy="8" r="4.8"/><circle cx="8" cy="8" r="1.6"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2"/></svg>`,
  visible: `<svg ${ICON_ATTRS}><path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8s-2.3 4.2-6.2 4.2S1.8 8 1.8 8z"/><path d="M5.6 8h4.8"/></svg>`,
  zframe: `<svg ${ICON_ATTRS}><path d="M3 3.5h10M3 8h10M3 12.5h10"/><path d="M8 2.3v11.4"/><rect x="6.3" y="6.3" width="3.4" height="3.4" fill="currentColor" stroke="none"/></svg>`,
  zsoft: `<svg ${ICON_ATTRS}><path d="M3 3.5h10M3 8h10M3 12.5h10"/><circle cx="5" cy="8" r="1.8" fill="currentColor" stroke="none"/><circle cx="9" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r=".7" fill="currentColor" stroke="none"/></svg>`,
  zblend: `<svg ${ICON_ATTRS}><path d="M3 4.2h10M3 8h10M3 11.8h10"/><rect x="4" y="5.7" width="2.2" height="4.6" fill="currentColor" stroke="none"/><rect x="6.9" y="5.7" width="2.2" height="4.6" fill="currentColor" fill-opacity=".55" stroke="none"/><rect x="9.8" y="5.7" width="2.2" height="4.6" fill="currentColor" fill-opacity=".22" stroke="none"/></svg>`,
  fixed: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8"/></svg>`,
  random: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="4" cy="5" r="1.3"/><circle cx="11" cy="4" r="1"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="12" cy="11" r="1.2"/><circle cx="4.8" cy="12" r="0.9"/></svg>`,
  radialOut: `<svg ${ICON_ATTRS}><circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  radialIn: `<svg ${ICON_ATTRS}><circle cx="8" cy="8" r="5.2" fill="currentColor" fill-opacity="0.18"/><circle cx="8" cy="8" r="2.3"/></svg>`,
  single: `<svg ${ICON_ATTRS}><path d="M8 3v10"/><path d="M5.5 5.5h5M5.5 10.5h5"/></svg>`,
  range: `<svg ${ICON_ATTRS}><path d="M4.7 3v10M11.3 3v10"/><path d="M4.7 8h6.6"/></svg>`,
  select: `<svg ${ICON_ATTRS}><rect x="3" y="3" width="10" height="10" stroke-dasharray="2.4 2"/></svg>`,
  flipH: `<svg ${ICON_ATTRS}><path d="M8 2.5v11" stroke-dasharray="1.6 1.8"/><path d="M6 5.5 3 8l3 2.5zM10 5.5 13 8l-3 2.5z"/></svg>`,
  flipV: `<svg ${ICON_ATTRS}><path d="M2.5 8h11" stroke-dasharray="1.6 1.8"/><path d="M5.5 6 8 3l2.5 3zM5.5 10 8 13l2.5-3z"/></svg>`,
  rotate: `<svg ${ICON_ATTRS}><path d="M12.8 8A4.8 4.8 0 1 1 8 3.2"/><path d="M8 1l2.4 2.2L8 5.4"/></svg>`,
  forward: `<svg ${ICON_ATTRS}><path d="M6.2 3.4 10.8 8l-4.6 4.6"/></svg>`,
  play: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M5 3.2v9.6L13 8z"/></svg>`,
  pause: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="4.2" y="3.4" width="2.8" height="9.2"/><rect x="9" y="3.4" width="2.8" height="9.2"/></svg>`,
  download: `<svg ${ICON_ATTRS}><path d="M8 2.6v7.2"/><path d="M5.2 7.1 8 9.9l2.8-2.8"/><path d="M3.2 12.8h9.6"/></svg>`,
  eye: `<svg ${ICON_ATTRS}><path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8s-2.3 4.2-6.2 4.2S1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.9"/></svg>`,
  eyeOff: `<svg ${ICON_ATTRS}><path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8s-2.3 4.2-6.2 4.2S1.8 8 1.8 8z"/><path d="M3.2 12.8 12.8 3.2"/></svg>`,
};

const state = {
  screen: "gallery",
  assets: loadAssets(),
  activeAssetId: null,
  activeParticle: 0,
  activeTile: 0,
  tool: "pen",
  color: Pixel.Black,
  dragStart: null,
  pointerDown: false,
  draftName: "new_asset",
  status: "Local only",
  pendingDelete: null,
  syncOpen: false,
  syncBusy: false,
  syncMessage: "",
  allFrames: false,
  paintScope: "active",
  onion: false,
  flash: "",
  selection: null, // {x, y, w, h} in cell coords on the active grid
  selectDrag: null, // "marquee" | "move" while dragging with the select tool
  moveOffset: null, // {dx, dy} while dragging a selection
  clipboard: null, // {w, h, cells}
  eraseStroke: false,
  lastPaintCell: null,
  strokePath: [],
  strokeBase: null,
  brushSize: 1,
  brushShape: "square",
  zBrushRadius: 1,
  zFalloffMode: "coverage",
  grayMin: 0,
  grayMax: 255,
  grayScale: "range",
  grayMode: "fixed",
  opacityMin: 100,
  opacityMax: 100,
  opacityScale: "range",
  opacityMode: "fixed",
  ditherLevel: 8, // Bayer threshold out of 16 (4 = 25%, 8 = 50%, 12 = 75%)
  history: { past: [], future: [] },
  playing: false,
  playTimer: null,
  zoom: 1,
  particlePreviewOpen: false,
};

const app = document.querySelector("#app");
let galleryTimer = null;
let previewTick = 0;
let hoverPreviewId = null;
let particlePreviewFrame = null;
const particlePreviewSimulation = {
  assetId: null,
  instances: [],
  lastTime: 0,
};
let activeCanvasPointerId = null;
let activeCanvasPointerType = null;
let penPalmRejectionUntil = 0;
const canvasTouchGesture = {
  mode: "idle", // "idle" | "pending" | "drawing" | "panning"
  pointers: new Map(),
  primaryId: null,
  startEvent: null,
  lastCentroid: null,
  area: null,
  rollback: null,
  blockDrawing: false,
};

// Test/debug hook; not part of the UI contract.
window.__grainState = state;
window.__grainCanvasGesture = canvasTouchGesture;

installViewportLocks();

function installViewportLocks() {
  const prevent = (event) => {
    if (event.cancelable) event.preventDefault();
  };
  for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(name, prevent, { passive: false });
  }
  document.addEventListener("dblclick", prevent, { passive: false });
  document.addEventListener("touchmove", (event) => {
    const stylusTouch = [...Array.from(event.touches), ...Array.from(event.changedTouches)]
      .some((touch) => touch.touchType === "stylus");
    const target = event.target;
    const onDrawingCanvas = target instanceof Element && !!target.closest(".drawing-canvas");
    // The canvas owns its gesture policy. Let the Pencil stream continue
    // even when iPadOS reports a palm as a second touch; pointer ownership
    // below rejects that palm without cancelling the pen stroke.
    if (stylusTouch && onDrawingCanvas) return;
    if (event.touches.length > 1) {
      prevent(event);
      return;
    }
    if (stylusTouch) return;
    const allowsInteraction = target instanceof Element
      && target.closest(
        ".drawing-canvas, button, input, select, textarea, a, "
        + "[role='button'], [role='slider'], .gray-dual-slider, .asset-card, .tile-thumb",
      );
    if (!allowsInteraction) prevent(event);
  }, { passive: false });
  // Block browser zoom (ctrl/pinch wheel and ctrl +/-/0); canvas zoom uses buttons.
  document.addEventListener("wheel", (event) => {
    if (event.ctrlKey) prevent(event);
  }, { passive: false });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && ["+", "-", "=", "0"].includes(event.key)) {
      prevent(event);
    }
  }, { passive: false });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.pendingDelete) {
    dispatch({ type: "cancelDelete" });
    return;
  }
  if (event.key === "Escape" && state.syncOpen && !state.syncBusy) {
    dispatch({ type: "closeSync" });
    return;
  }
  if (state.screen !== "editor") return;
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === " ") {
    const asset = activeAsset();
    if (asset && hasPlayback(asset)) {
      event.preventDefault();
      dispatch({ type: "togglePlay" });
    }
    return;
  }
  if (event.key === "Escape" && state.selection) {
    dispatch({ type: "clearSelection" });
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && state.selection) {
    event.preventDefault();
    deleteSelection();
    return;
  }
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === "z") {
    event.preventDefault();
    dispatch({ type: event.shiftKey ? "redo" : "undo" });
  } else if (key === "y") {
    event.preventDefault();
    dispatch({ type: "redo" });
  } else if (key === "c" && state.selection) {
    event.preventDefault();
    copySelection();
  } else if (key === "x" && state.selection) {
    event.preventDefault();
    cutSelection();
  } else if (key === "v" && state.clipboard) {
    event.preventDefault();
    pasteClipboard();
  }
});

window.addEventListener("resize", () => {
  layoutMainCanvas();
  drawCanvases();
});

render();

// Auto-pull once on startup when sync is configured, matching grain's
// pull-on-startup behavior.
if (syncConfigured() && navigator.onLine !== false) {
  syncPull();
}

/* ---------- Asset creation ---------- */

function defaultAssets() {
  return [
    createTileset("basic_tiles", true),
    createAnimation("basic_anim", true),
    createParticles("basic_particles", true),
    createCube("basic_cube", true),
    createBlockset("basic_blocks", true),
  ];
}

function createTileset(name, withStarter = false) {
  const tileSize = DEFAULT_TILE_SIZE;
  const tiles = [blankGrid(tileSize, tileSize)];
  if (withStarter) {
    tiles.push(blankGrid(tileSize, tileSize), blankGrid(tileSize, tileSize));
    drawStarterTile(tiles[0], tileSize, "border");
    drawStarterTile(tiles[1], tileSize, "slash");
    drawStarterTile(tiles[2], tileSize, "box");
  }
  return {
    id: freshId(),
    type: "tileset",
    name,
    tileSize,
    tiles,
    updatedAt: Date.now(),
  };
}

function createAnimation(name, withStarter = false) {
  const width = DEFAULT_TILE_SIZE;
  const height = DEFAULT_TILE_SIZE;
  const frames = [];
  const dot = 3;
  const count = withStarter ? STARTER_FRAME_COUNT : 1;
  for (let i = 0; i < count; i += 1) {
    const frame = blankGrid(width, height);
    if (withStarter) {
      const x0 = Math.round((i * (width - dot)) / (STARTER_FRAME_COUNT - 1));
      const y0 = Math.floor((height - dot) / 2);
      for (let y = y0; y < y0 + dot; y += 1) {
        for (let x = x0; x < x0 + dot; x += 1) {
          frame[indexFor(x, y, width)] = Pixel.Black;
        }
      }
    }
    frames.push(frame);
  }
  return {
    id: freshId(),
    type: "animation",
    name,
    width,
    height,
    fps: DEFAULT_FPS,
    frames,
    updatedAt: Date.now(),
  };
}

function createParticles(name, withStarter = false) {
  const particles = [createParticle(DEFAULT_TILE_SIZE, DEFAULT_TILE_SIZE)];
  if (withStarter) {
    particles[0] = createParticle(9, 9, 4);
    particles.push(createParticle(13, 7, 6));
    drawStarterParticle(particles[0], "dot");
    drawStarterParticle(particles[1], "dash");
  }
  return {
    id: freshId(),
    type: "particles",
    name,
    fps: DEFAULT_FPS,
    particles,
    preview: defaultParticlePreview(),
    updatedAt: Date.now(),
  };
}

function createParticle(width = DEFAULT_TILE_SIZE, height = DEFAULT_TILE_SIZE, frameCount = 1) {
  const safeWidth = clampInt(width, MIN_PARTICLE_SIZE, MAX_TILE_SIZE);
  const safeHeight = clampInt(height, MIN_PARTICLE_SIZE, MAX_TILE_SIZE);
  const safeFrames = clampInt(frameCount, 1, 0xffff);
  return {
    id: freshParticleId(),
    width: safeWidth,
    height: safeHeight,
    frames: Array.from({ length: safeFrames }, () => blankGrid(safeWidth, safeHeight)),
  };
}

function drawStarterParticle(particle, mode) {
  const centerX = (particle.width - 1) / 2;
  const centerY = (particle.height - 1) / 2;
  particle.frames.forEach((frame, frameIndex) => {
    const t = particle.frames.length <= 1 ? 0 : frameIndex / (particle.frames.length - 1);
    for (let y = 0; y < particle.height; y += 1) {
      for (let x = 0; x < particle.width; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (mode === "dot") {
          const radius = 1 + Math.sin(t * Math.PI) * 2;
          if (Math.hypot(dx, dy) <= radius) frame[indexFor(x, y, particle.width)] = Pixel.Black;
        } else {
          const offset = Math.round((t - 0.5) * 4);
          if (Math.abs(dy - offset) <= 0.5 && Math.abs(dx) <= 4) {
            frame[indexFor(x, y, particle.width)] = frameIndex % 2 ? Pixel.White : Pixel.Black;
          }
        }
      }
    }
  });
}

function createCube(name, withStarter = false) {
  const width = DEFAULT_TILE_SIZE;
  const height = DEFAULT_TILE_SIZE;
  const frames = [];
  const shift = Math.floor(width / STARTER_FRAME_COUNT);
  const count = withStarter ? STARTER_FRAME_COUNT : 1;
  for (let i = 0; i < count; i += 1) {
    const frame = blankGrid(width, height);
    if (withStarter) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if ((x + y + i * shift) % width < 2) frame[indexFor(x, y, width)] = Pixel.Black;
        }
      }
    }
    frames.push(frame);
  }
  return {
    id: freshId(),
    type: "cube",
    name,
    width,
    height,
    fps: DEFAULT_FPS,
    frames,
    updatedAt: Date.now(),
  };
}

function createBlockset(name, withStarter = false) {
  const width = DEFAULT_TILE_SIZE;
  const height = DEFAULT_TILE_SIZE;
  const layers = [blankGrid(width, height)];
  if (withStarter) {
    layers.push(blankGrid(width, height));
    drawStarterTile(layers[0], width, "border");
    drawStarterTile(layers[1], width, "box");
  }
  return {
    id: freshId(),
    type: "blockset",
    name,
    width,
    height,
    layers,
    visibility: layers.map(() => true),
    updatedAt: Date.now(),
  };
}

function freshId() {
  return `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function freshParticleId() {
  return `particle_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultParticlePreview() {
  return { ...PARTICLE_PREVIEW_DEFAULTS };
}

function blankGrid(width, height, fill = Pixel.Transparent) {
  return new Array(width * height).fill(fill);
}

function drawStarterTile(tile, tileSize, mode) {
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      const edge = x === 0 || y === 0 || x === tileSize - 1 || y === tileSize - 1;
      if (mode === "border" && edge) tile[indexFor(x, y, tileSize)] = Pixel.Black;
      if (mode === "slash" && (x === y || x === tileSize - 1 - y)) tile[indexFor(x, y, tileSize)] = Pixel.White;
      if (
        mode === "box"
        && x >= Math.floor(tileSize * 0.25)
        && y >= Math.floor(tileSize * 0.25)
        && x < Math.ceil(tileSize * 0.75)
        && y < Math.ceil(tileSize * 0.75)
      ) {
        tile[indexFor(x, y, tileSize)] = Pixel.Black;
      }
    }
  }
}

/* ---------- Persistence ---------- */

function loadAssets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAssets();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.assets)) return defaultAssets();
    return parsed.assets.map(normalizeAsset).filter(Boolean);
  } catch {
    return defaultAssets();
  }
}

function normalizeAsset(asset) {
  if (!asset) return null;
  if (asset.type === "particles") return normalizeParticles(asset);
  if (asset.type === "animation" || asset.type === "cube") return normalizeFramed(asset);
  if (asset.type === "blockset") return normalizeBlockset(asset);
  if (asset.type !== "tileset" || !Array.isArray(asset.tiles)) return null;
  const tileSize = clampInt(asset.tileSize || DEFAULT_TILE_SIZE, MIN_TILE_SIZE, MAX_TILE_SIZE);
  const tiles = asset.tiles.map((tile) => normalizeGrid(tile, tileSize, tileSize));
  return {
    id: String(asset.id || freshId()),
    type: "tileset",
    name: sanitizeName(asset.name || "tileset"),
    tileSize,
    tiles: tiles.length ? tiles : [blankGrid(tileSize, tileSize)],
    updatedAt: Number(asset.updatedAt || Date.now()),
  };
}

function normalizeParticles(asset) {
  const source = Array.isArray(asset.particles) ? asset.particles.slice(0, 0xffff) : [];
  const particles = source.map((particle) => {
    const width = clampInt(particle?.width || DEFAULT_TILE_SIZE, MIN_PARTICLE_SIZE, MAX_TILE_SIZE);
    const height = clampInt(particle?.height || DEFAULT_TILE_SIZE, MIN_PARTICLE_SIZE, MAX_TILE_SIZE);
    const sourceFrames = Array.isArray(particle?.frames) ? particle.frames.slice(0, 0xffff) : [];
    const frames = sourceFrames.map((frame) => normalizeGrid(frame, width, height));
    return {
      id: String(particle?.id || freshParticleId()),
      width,
      height,
      frames: frames.length ? frames : [blankGrid(width, height)],
    };
  });
  if (!particles.length) particles.push(createParticle());
  return {
    id: String(asset.id || freshId()),
    type: "particles",
    name: sanitizeName(asset.name || "particles"),
    fps: clampInt(asset.fps || DEFAULT_FPS, MIN_FPS, MAX_FPS),
    particles,
    preview: normalizeParticlePreview(asset.preview),
    updatedAt: Number(asset.updatedAt || Date.now()),
  };
}

function normalizeParticlePreview(preview) {
  const source = preview && typeof preview === "object" ? preview : {};
  return {
    number: clampInt(source.number ?? PARTICLE_PREVIEW_DEFAULTS.number, 0, MAX_PARTICLE_PREVIEW_COUNT),
    speed: clampNumber(source.speed ?? PARTICLE_PREVIEW_DEFAULTS.speed, -8, 8),
    driftX: clampNumber(source.driftX ?? PARTICLE_PREVIEW_DEFAULTS.driftX, -200, 200),
    driftY: clampNumber(source.driftY ?? PARTICLE_PREVIEW_DEFAULTS.driftY, -200, 200),
    movement: clampNumber(source.movement ?? PARTICLE_PREVIEW_DEFAULTS.movement, 0, 200),
    dirChange: clampNumber(source.dirChange ?? PARTICLE_PREVIEW_DEFAULTS.dirChange, 0, 10),
    canvasWidth: clampInt(source.canvasWidth ?? PARTICLE_PREVIEW_DEFAULTS.canvasWidth, MIN_PARTICLE_PREVIEW_SIZE, MAX_PARTICLE_PREVIEW_SIZE),
    canvasHeight: clampInt(source.canvasHeight ?? PARTICLE_PREVIEW_DEFAULTS.canvasHeight, MIN_PARTICLE_PREVIEW_SIZE, MAX_PARTICLE_PREVIEW_SIZE),
  };
}

function normalizeFramed(asset) {
  const maxSize = maxSizeForType(asset.type);
  const width = clampInt(asset.width || DEFAULT_TILE_SIZE, MIN_TILE_SIZE, maxSize);
  const height = clampInt(asset.height || DEFAULT_TILE_SIZE, MIN_TILE_SIZE, maxSize);
  const source = Array.isArray(asset.frames) ? asset.frames : [];
  const allowGray = asset.type === "cube";
  const frames = source.map((frame) => normalizeGrid(frame, width, height, allowGray));
  return {
    id: String(asset.id || freshId()),
    type: asset.type,
    name: sanitizeName(asset.name || asset.type),
    width,
    height,
    fps: clampInt(asset.fps || DEFAULT_FPS, MIN_FPS, MAX_FPS),
    frames: frames.length ? frames : [blankGrid(width, height)],
    updatedAt: Number(asset.updatedAt || Date.now()),
  };
}

function normalizeBlockset(asset) {
  const maxSize = maxSizeForType("blockset");
  const width = clampInt(asset.width || DEFAULT_TILE_SIZE, MIN_TILE_SIZE, maxSize);
  const height = clampInt(asset.height || DEFAULT_TILE_SIZE, MIN_TILE_SIZE, maxSize);
  const source = Array.isArray(asset.layers) ? asset.layers : [];
  const layers = source.map((layer) => normalizeGrid(layer, width, height));
  if (!layers.length) layers.push(blankGrid(width, height));
  const visibility = layers.map((_, index) =>
    Array.isArray(asset.visibility) ? asset.visibility[index] !== false : true);
  return {
    id: String(asset.id || freshId()),
    type: "blockset",
    name: sanitizeName(asset.name || "blockset"),
    width,
    height,
    layers,
    visibility,
    updatedAt: Number(asset.updatedAt || Date.now()),
  };
}

function normalizeGrid(cells, width, height, allowGray = false) {
  const next = blankGrid(width, height);
  if (Array.isArray(cells)) {
    for (let i = 0; i < next.length && i < cells.length; i += 1) {
      next[i] = normalizePixel(cells[i], allowGray);
    }
  }
  return next;
}

function saveAssets() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ assets: state.assets }));
}

/* ---------- Binary export ---------- */

function exportActiveAsset() {
  const asset = activeAsset();
  if (!asset) return;
  try {
    const bytes = encodeBinaryAsset(asset);
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeName(asset.name || asset.type) || asset.type}.grainasset`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    state.flash = `Exported ${link.download}`;
  } catch (error) {
    state.flash = `Export failed: ${error.message}`;
  }
  render();
}

function encodeBinaryAsset(asset) {
  const kind = BINARY_ASSET_KIND[asset.type];
  if (!kind) throw new Error(`unsupported asset type ${asset.type}`);
  if (asset.type === "particles") return encodeBinaryParticles(asset);
  const width = widthOf(asset);
  const height = heightOf(asset);
  const items = cellsOf(asset);
  const count = items.length;
  if (width > 0xffff || height > 0xffff || count > 0xffff) {
    throw new Error("asset dimensions are too large");
  }
  const cellsPerItem = width * height;
  const totalCells = cellsPerItem * count;
  const byteLength = BINARY_ASSET_HEADER_SIZE + count + totalCells * 2;
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set(BINARY_ASSET_MAGIC, 0);
  view.setUint16(4, BINARY_ASSET_VERSION_V1, true);
  view.setUint8(6, kind);
  view.setUint8(7, 0);
  view.setUint16(8, width, true);
  view.setUint16(10, height, true);
  view.setUint16(12, count, true);
  view.setUint16(14, hasPlayback(asset) ? asset.fps : 0, true);
  view.setUint16(16, 0, true);

  let offset = BINARY_ASSET_HEADER_SIZE;
  for (let i = 0; i < count; i += 1) {
    const visible = asset.type === "blockset" && asset.visibility[i] !== false;
    view.setUint8(offset, visible ? BINARY_ASSET_VISIBLE : 0);
    offset += 1;
  }

  const allowGray = asset.type === "cube";
  for (const cells of items) {
    for (let i = 0; i < cellsPerItem; i += 1) {
      view.setUint16(offset, normalizePixel(cells[i], allowGray), true);
      offset += 2;
    }
  }
  return bytes;
}

function encodeBinaryParticles(asset) {
  const particles = Array.isArray(asset.particles) ? asset.particles : [];
  if (!particles.length) throw new Error("particles asset has no particles");
  if (particles.length > 0xffff) throw new Error("particle count is too large");
  let cellBytes = 0;
  for (const particle of particles) {
    const width = Number(particle.width);
    const height = Number(particle.height);
    const frames = Array.isArray(particle.frames) ? particle.frames : [];
    if (!Number.isInteger(width) || !Number.isInteger(height)
      || width < MIN_PARTICLE_SIZE || height < MIN_PARTICLE_SIZE
      || width > MAX_TILE_SIZE || height > MAX_TILE_SIZE || !frames.length || frames.length > 0xffff) {
      throw new Error("particle dimensions or frame count are invalid");
    }
    const next = cellBytes + width * height * frames.length * 2;
    if (!Number.isSafeInteger(next)) throw new Error("particles asset is too large");
    cellBytes = next;
  }
  const byteLength = BINARY_ASSET_HEADER_SIZE
    + particles.length * BINARY_PARTICLE_DESCRIPTOR_SIZE
    + cellBytes;
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set(BINARY_ASSET_MAGIC, 0);
  view.setUint16(4, BINARY_ASSET_VERSION_V2, true);
  view.setUint8(6, BINARY_ASSET_KIND.particles);
  view.setUint8(7, 0);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, particles.length, true);
  view.setUint16(14, clampInt(asset.fps, MIN_FPS, MAX_FPS), true);
  view.setUint16(16, 0, true);

  let descriptorOffset = BINARY_ASSET_HEADER_SIZE;
  for (const particle of particles) {
    view.setUint16(descriptorOffset, particle.width, true);
    view.setUint16(descriptorOffset + 2, particle.height, true);
    view.setUint16(descriptorOffset + 4, particle.frames.length, true);
    view.setUint16(descriptorOffset + 6, 0, true);
    descriptorOffset += BINARY_PARTICLE_DESCRIPTOR_SIZE;
  }

  let offset = descriptorOffset;
  for (const particle of particles) {
    const cellsPerFrame = particle.width * particle.height;
    for (const frame of particle.frames) {
      for (let i = 0; i < cellsPerFrame; i += 1) {
        view.setUint16(offset, normalizePixel(frame[i]), true);
        offset += 2;
      }
    }
  }
  return bytes;
}

function decodeBinaryAsset(bytes, name) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  if (!(bytes instanceof Uint8Array)) throw new Error("asset bytes must be Uint8Array");
  if (bytes.length < BINARY_ASSET_HEADER_SIZE) throw new Error("binary asset is truncated");
  for (let i = 0; i < BINARY_ASSET_MAGIC.length; i += 1) {
    if (bytes[i] !== BINARY_ASSET_MAGIC[i]) throw new Error("not a TinyGrain asset");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version === BINARY_ASSET_VERSION_V2) return decodeBinaryParticles(bytes, view, name);
  if (version !== BINARY_ASSET_VERSION_V1) throw new Error(`unsupported asset version ${version}`);
  const type = BINARY_KIND_ASSET[view.getUint8(6)];
  if (!type || type === "particles") throw new Error(`unknown asset type ${view.getUint8(6)}`);
  const width = view.getUint16(8, true);
  const height = view.getUint16(10, true);
  const count = view.getUint16(12, true);
  const fps = view.getUint16(14, true);
  if (!width || !height || !count) throw new Error("asset has zero dimensions");
  const cellsPerItem = width * height;
  const cellsStart = BINARY_ASSET_HEADER_SIZE + count;
  const expected = cellsStart + cellsPerItem * count * 2;
  if (bytes.length !== expected) throw new Error("asset byte length does not match header");

  const flags = [];
  for (let i = 0; i < count; i += 1) flags.push(view.getUint8(BINARY_ASSET_HEADER_SIZE + i));

  let offset = cellsStart;
  const items = [];
  for (let item = 0; item < count; item += 1) {
    const cells = [];
    for (let i = 0; i < cellsPerItem; i += 1) {
      cells.push(view.getUint16(offset, true));
      offset += 2;
    }
    items.push(cells);
  }

  const assetName = sanitizeName(name || type);
  if (type === "tileset") {
    return normalizeAsset({
      id: freshId(),
      type,
      name: assetName,
      tileSize: width,
      tiles: items,
      updatedAt: Date.now(),
    });
  }
  if (type === "blockset") {
    return normalizeAsset({
      id: freshId(),
      type,
      name: assetName,
      width,
      height,
      layers: items,
      visibility: flags.map((flag) => (flag & BINARY_ASSET_VISIBLE) !== 0),
      updatedAt: Date.now(),
    });
  }
  return normalizeAsset({
    id: freshId(),
    type,
    name: assetName,
    width,
    height,
    fps: fps || DEFAULT_FPS,
    frames: items,
    updatedAt: Date.now(),
  });
}

function decodeBinaryParticles(bytes, view, name) {
  if (view.getUint8(6) !== BINARY_ASSET_KIND.particles) {
    throw new Error(`asset version 2 does not support kind ${view.getUint8(6)}`);
  }
  if (view.getUint8(7) !== 0 || view.getUint16(8, true) !== 0 || view.getUint16(10, true) !== 0
    || view.getUint16(16, true) !== 0) {
    throw new Error("invalid particles asset header");
  }
  const particleCount = view.getUint16(12, true);
  const fps = view.getUint16(14, true);
  if (!particleCount) throw new Error("particles asset has no particles");
  const cellsStart = BINARY_ASSET_HEADER_SIZE + particleCount * BINARY_PARTICLE_DESCRIPTOR_SIZE;
  if (cellsStart > bytes.length) throw new Error("binary asset is truncated");

  const descriptors = [];
  let expected = cellsStart;
  for (let i = 0; i < particleCount; i += 1) {
    const descriptorOffset = BINARY_ASSET_HEADER_SIZE + i * BINARY_PARTICLE_DESCRIPTOR_SIZE;
    const width = view.getUint16(descriptorOffset, true);
    const height = view.getUint16(descriptorOffset + 2, true);
    const frameCount = view.getUint16(descriptorOffset + 4, true);
    const reserved = view.getUint16(descriptorOffset + 6, true);
    if (!width || !height || width > MAX_TILE_SIZE || height > MAX_TILE_SIZE || !frameCount || reserved !== 0) {
      throw new Error("invalid particle descriptor");
    }
    const nextExpected = expected + width * height * frameCount * 2;
    if (!Number.isSafeInteger(nextExpected) || nextExpected > bytes.length) {
      throw new Error("binary asset is truncated");
    }
    expected = nextExpected;
    descriptors.push({ width, height, frameCount });
  }
  if (bytes.length !== expected) throw new Error("asset byte length does not match header");

  let offset = cellsStart;
  const particles = descriptors.map(({ width, height, frameCount }) => {
    const frames = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frame = [];
      for (let i = 0; i < width * height; i += 1) {
        const pixel = view.getUint16(offset, true);
        if (pixel > Pixel.White) throw new Error("invalid particle pixel");
        frame.push(pixel);
        offset += 2;
      }
      frames.push(frame);
    }
    return { id: freshParticleId(), width, height, frames };
  });

  return normalizeAsset({
    id: freshId(),
    type: "particles",
    name: sanitizeName(name || "particles"),
    fps: fps || DEFAULT_FPS,
    particles,
    preview: defaultParticlePreview(),
    updatedAt: Date.now(),
  });
}

/* ---------- Asset accessors ---------- */

function cellsOf(asset) {
  if (asset.type === "tileset") return asset.tiles;
  if (asset.type === "blockset") return asset.layers;
  if (asset.type === "particles") return selectedParticle(asset)?.frames || [];
  return asset.frames;
}

function setCellsOf(asset, cells) {
  if (asset.type === "tileset") asset.tiles = cells;
  else if (asset.type === "blockset") asset.layers = cells;
  else if (asset.type === "particles") {
    const particle = selectedParticle(asset);
    if (particle) particle.frames = cells;
  }
  else asset.frames = cells;
}

function widthOf(asset) {
  if (asset.type === "particles") return selectedParticle(asset)?.width || DEFAULT_TILE_SIZE;
  return asset.type === "tileset" ? asset.tileSize : asset.width;
}

function heightOf(asset) {
  if (asset.type === "particles") return selectedParticle(asset)?.height || DEFAULT_TILE_SIZE;
  return asset.type === "tileset" ? asset.tileSize : asset.height;
}

function selectedParticle(asset) {
  if (!asset || asset.type !== "particles" || !asset.particles.length) return null;
  const index = asset.id === state.activeAssetId
    ? Math.max(0, Math.min(state.activeParticle, asset.particles.length - 1))
    : 0;
  return asset.particles[index];
}

function assetItemCount(asset) {
  return asset.type === "particles" ? asset.particles.length : cellsOf(asset).length;
}

function assetItemNoun(asset) {
  return asset.type === "particles" ? "particle" : cellNoun(asset);
}

function cellNoun(asset) {
  return CELL_NOUNS[asset.type] || "tile";
}

function hasPlayback(asset) {
  return asset.type === "animation" || asset.type === "cube" || asset.type === "particles";
}

function hasGalleryAnimation(asset) {
  if (asset.type === "particles") {
    return asset.particles.length > 1 || asset.particles.some((particle) => particle.frames.length > 1);
  }
  return (asset.type === "tileset" || hasPlayback(asset)) && cellsOf(asset).length > 1;
}

function wraps(asset) {
  return asset.type === "cube";
}

function wrapMarginOf(asset) {
  if (!wraps(asset)) return { x: 0, y: 0 };
  return {
    x: Math.min(MAX_WRAP_MARGIN, Math.max(1, Math.round(widthOf(asset) * WRAP_MARGIN_RATIO))),
    y: Math.min(MAX_WRAP_MARGIN, Math.max(1, Math.round(heightOf(asset) * WRAP_MARGIN_RATIO))),
  };
}

function layerVisible(asset, index) {
  return asset.type !== "blockset" || asset.visibility[index] !== false;
}

function activeAsset() {
  return state.assets.find((asset) => asset.id === state.activeAssetId) || null;
}

function activeCells() {
  const asset = activeAsset();
  if (!asset) return null;
  return cellsOf(asset)[state.activeTile] || null;
}

/* ---------- Actions ---------- */

function dispatch(action) {
  const keepsPlayback = [
    "togglePlay",
    "setFps",
    "setTool",
    "setColor",
    "setBrushSize",
    "setBrushShape",
    "setPaintScope",
    "setZBrushRadius",
    "setZFalloffMode",
    "setGrayRange",
    "setGrayScale",
    "setGrayMode",
    "setOpacityRange",
    "setOpacityScale",
    "setOpacityMode",
    "commitShape",
    "toggleOnion",
    "toggleAllFrames",
    "setZoom",
    "setParticlePreview",
  ];
  if (state.playing && !keepsPlayback.includes(action.type)) {
    stopPlayback();
  }
  switch (action.type) {
    case "openGallery":
      state.screen = "gallery";
      state.activeAssetId = null;
      state.activeParticle = 0;
      state.status = "Local only";
      state.zoom = 1;
      resetHistory();
      break;
    case "createAsset": {
      const creators = {
        tileset: createTileset,
        animation: createAnimation,
        particles: createParticles,
        cube: createCube,
        blockset: createBlockset,
      };
      const create = creators[action.kind] || createTileset;
      const name = uniqueName(sanitizeName(state.draftName || action.kind));
      const asset = create(name);
      state.assets = [asset, ...state.assets];
      state.activeAssetId = asset.id;
      state.activeParticle = 0;
      state.activeTile = 0;
      state.screen = "editor";
      state.draftName = "new_asset";
      state.status = `Created ${name}`;
      state.color = Pixel.Black;
      state.selection = null;
      state.zoom = 1;
      resetHistory();
      saveAssets();
      break;
    }
    case "openSync":
      state.syncOpen = true;
      state.syncMessage = "";
      break;
    case "closeSync":
      state.syncOpen = false;
      break;
    case "requestDelete":
      state.pendingDelete = action.id;
      break;
    case "cancelDelete":
      state.pendingDelete = null;
      break;
    case "deleteAsset":
      state.assets = state.assets.filter((asset) => asset.id !== action.id);
      state.pendingDelete = null;
      state.status = "Deleted asset";
      saveAssets();
      break;
    case "openAsset":
      state.activeAssetId = action.id;
      state.activeParticle = 0;
      state.activeTile = 0;
      state.screen = "editor";
      state.status = "Editing";
      state.color = Pixel.Black;
      state.selection = null;
      state.zoom = 1;
      resetHistory();
      break;
    case "renameAsset": {
      const asset = activeAsset();
      if (asset) {
        asset.name = sanitizeName(action.name);
        touch(asset);
      }
      break;
    }
    case "resizeAsset": {
      const asset = activeAsset();
      if (asset) {
        resizeAsset(asset, action.width, action.height);
        state.selection = null;
        if (!canZoomAsset(asset)) state.zoom = 1;
        state.status = `${widthOf(asset)}x${heightOf(asset)}`;
      }
      break;
    }
    case "setZoom": {
      const asset = activeAsset();
      state.zoom = asset && canZoomAsset(asset) ? clampZoom(action.zoom) : 1;
      break;
    }
    case "setFps": {
      const asset = activeAsset();
      if (asset && hasPlayback(asset)) {
        asset.fps = clampInt(action.fps, MIN_FPS, MAX_FPS);
        touch(asset);
        if (state.playing) startPlayback();
      }
      break;
    }
    case "setParticlePreview": {
      const asset = activeAsset();
      if (asset?.type === "particles" && Object.hasOwn(PARTICLE_PREVIEW_DEFAULTS, action.key)) {
        asset.preview = normalizeParticlePreview({ ...asset.preview, [action.key]: action.value });
        saveAssets();
      }
      break;
    }
    case "togglePlay":
      if (state.playing) stopPlayback();
      else startPlayback();
      break;
    case "setTool":
      if (action.tool === "dither" && state.tool === "dither") {
        state.ditherLevel = state.ditherLevel >= 12 ? 4 : state.ditherLevel + 4;
        state.flash = `Dither density ${Math.round((state.ditherLevel / 16) * 100)}%`;
      }
      state.tool = action.tool;
      break;
    case "clearSelection":
      state.selection = null;
      break;
    case "transform": {
      const asset = activeAsset();
      if (!asset) break;
      const width = widthOf(asset);
      const height = heightOf(asset);
      if (action.kind === "rotate" && width !== height) {
        state.flash = "Rotate needs a square grid";
        break;
      }
      pushHistory();
      for (const cells of targetCells(asset)) {
        const out = blankGrid(width, height);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            let sx = x;
            let sy = y;
            if (action.kind === "flipX") sx = width - 1 - x;
            if (action.kind === "flipY") sy = height - 1 - y;
            if (action.kind === "rotate") {
              sx = y;
              sy = height - 1 - x;
            }
            out[indexFor(x, y, width)] = cells[indexFor(sx, sy, width)];
          }
        }
        for (let i = 0; i < cells.length; i += 1) cells[i] = out[i];
      }
      touch(asset);
      break;
    }
    case "moveTile": {
      const asset = activeAsset();
      if (!asset) break;
      const cells = cellsOf(asset);
      const from = state.activeTile;
      const to = from + action.dir;
      if (to < 0 || to >= cells.length) break;
      pushHistory();
      [cells[from], cells[to]] = [cells[to], cells[from]];
      if (asset.type === "blockset") {
        [asset.visibility[from], asset.visibility[to]] = [asset.visibility[to], asset.visibility[from]];
      }
      state.activeTile = to;
      touch(asset);
      break;
    }
    case "setColor":
      state.color = action.color;
      break;
    case "setBrushSize":
      state.brushSize = clampBrushSize(action.size);
      break;
    case "setBrushShape":
      state.brushShape = action.shape === "round" ? "round" : "square";
      break;
    case "setPaintScope":
      state.paintScope = validPaintScope(action.scope);
      if (action.zFalloffMode) state.zFalloffMode = validZFalloffMode(action.zFalloffMode);
      state.allFrames = state.paintScope === "all";
      break;
    case "setZBrushRadius":
      state.zBrushRadius = clampInt(action.radius, 0, MAX_Z_BRUSH_RADIUS);
      break;
    case "setZFalloffMode":
      state.zFalloffMode = validZFalloffMode(action.mode);
      break;
    case "setGrayRange": {
      const nextMin = clampInt(action.min ?? state.grayMin, 0, 255);
      const nextMax = clampInt(action.max ?? state.grayMax, 0, 255);
      state.grayMin = Math.min(nextMin, nextMax);
      state.grayMax = Math.max(nextMin, nextMax);
      state.color = grayPixel(state.grayMin);
      break;
    }
    case "setGrayScale":
      state.grayScale = validScaleMode(action.scale);
      if (state.grayScale === "single") state.grayMax = state.grayMin;
      state.color = grayPixel(state.grayMin);
      break;
    case "setGrayMode":
      state.grayMode = validGrayMode(action.mode);
      state.color = grayPixel(state.grayMin);
      break;
    case "setOpacityRange": {
      const nextMin = clampInt(action.min ?? state.opacityMin, 0, 100);
      const nextMax = clampInt(action.max ?? state.opacityMax, 0, 100);
      state.opacityMin = Math.min(nextMin, nextMax);
      state.opacityMax = Math.max(nextMin, nextMax);
      break;
    }
    case "setOpacityScale":
      state.opacityScale = validScaleMode(action.scale);
      if (state.opacityScale === "single") state.opacityMax = state.opacityMin;
      break;
    case "setOpacityMode":
      state.opacityMode = validRangeMode(action.mode);
      break;
    case "selectTile": {
      const asset = activeAsset();
      state.activeTile = action.index;
      if (asset && asset.type === "blockset" && !asset.visibility[action.index]) {
        asset.visibility[action.index] = true;
        touch(asset);
      }
      break;
    }
    case "selectParticle": {
      const asset = activeAsset();
      if (asset?.type === "particles") {
        state.activeParticle = Math.max(0, Math.min(action.index, asset.particles.length - 1));
        state.activeTile = 0;
        state.selection = null;
        state.zoom = 1;
      }
      break;
    }
    case "addParticle": {
      const asset = activeAsset();
      if (asset?.type === "particles" && asset.particles.length < 0xffff) {
        pushHistory();
        asset.particles.push(createParticle(widthOf(asset), heightOf(asset)));
        resetParticlePreviewChoices(asset);
        state.activeParticle = asset.particles.length - 1;
        state.activeTile = 0;
        state.selection = null;
        state.zoom = 1;
        touch(asset);
      }
      break;
    }
    case "duplicateParticle": {
      const asset = activeAsset();
      const source = asset?.type === "particles" ? selectedParticle(asset) : null;
      if (asset?.type === "particles" && source && asset.particles.length < 0xffff) {
        pushHistory();
        const duplicate = {
          id: freshParticleId(),
          width: source.width,
          height: source.height,
          frames: source.frames.map((frame) => [...frame]),
        };
        asset.particles.splice(state.activeParticle + 1, 0, duplicate);
        resetParticlePreviewChoices(asset);
        state.activeParticle += 1;
        state.activeTile = 0;
        state.selection = null;
        state.zoom = 1;
        touch(asset);
      }
      break;
    }
    case "removeParticle": {
      const asset = activeAsset();
      if (asset?.type === "particles") {
        if (asset.particles.length <= 1) {
          state.flash = "A particles asset needs at least one particle";
          break;
        }
        pushHistory();
        asset.particles.splice(state.activeParticle, 1);
        resetParticlePreviewChoices(asset);
        state.activeParticle = Math.min(state.activeParticle, asset.particles.length - 1);
        state.activeTile = 0;
        state.selection = null;
        state.zoom = 1;
        touch(asset);
      }
      break;
    }
    case "toggleLayerVisibility": {
      const asset = activeAsset();
      if (asset && asset.type === "blockset") {
        asset.visibility[action.index] = !asset.visibility[action.index];
        touch(asset);
      }
      break;
    }
    case "addTile": {
      const asset = activeAsset();
      if (asset) {
        pushHistory();
        cellsOf(asset).push(blankGrid(widthOf(asset), heightOf(asset)));
        if (asset.type === "blockset") asset.visibility.push(true);
        state.activeTile = cellsOf(asset).length - 1;
        touch(asset);
      }
      break;
    }
    case "duplicateTile": {
      const asset = activeAsset();
      if (asset) {
        pushHistory();
        const cells = cellsOf(asset);
        cells.splice(state.activeTile + 1, 0, [...cells[state.activeTile]]);
        if (asset.type === "blockset") asset.visibility.splice(state.activeTile + 1, 0, true);
        state.activeTile += 1;
        touch(asset);
      }
      break;
    }
    case "removeTile": {
      const asset = activeAsset();
      if (asset) {
        pushHistory();
        const cells = cellsOf(asset);
        if (cells.length === 1) {
          cells[0] = blankGrid(widthOf(asset), heightOf(asset));
          if (asset.type === "blockset") asset.visibility[0] = true;
          state.activeTile = 0;
        } else {
          cells.splice(state.activeTile, 1);
          if (asset.type === "blockset") asset.visibility.splice(state.activeTile, 1);
          state.activeTile = Math.min(state.activeTile, cells.length - 1);
        }
        touch(asset);
      }
      break;
    }
    case "commitShape":
      commitShape(action);
      break;
    case "toggleAllFrames":
      state.paintScope = state.paintScope === "all" ? "active" : "all";
      state.allFrames = state.paintScope === "all";
      break;
    case "toggleOnion":
      state.onion = !state.onion;
      break;
    case "tween": {
      const asset = activeAsset();
      if (!asset || !hasPlayback(asset)) break;
      const frames = cellsOf(asset);
      const start = state.activeTile;
      let end = -1;
      for (let i = start + 1; i < frames.length; i += 1) {
        if (frames[i].some((value) => value !== Pixel.Transparent)) {
          end = i;
          break;
        }
      }
      if (end < 0 || end === start + 1) {
        state.flash = "Tween needs blank frames before the next drawn frame";
        break;
      }
      pushHistory();
      const lerpGray = asset.type === "cube";
      for (let k = start + 1; k < end; k += 1) {
        const t = (k - start) / (end - start);
        frames[k] = frames[start].map((value, index) => {
          const target = frames[end][index];
          if (lerpGray && value !== Pixel.Transparent && target !== Pixel.Transparent) {
            const from = grayLevelOf(value);
            const to = grayLevelOf(target);
            return grayPixel(Math.round(from + (to - from) * t));
          }
          return hash01(index) < t ? target : value;
        });
      }
      state.flash = `Tweened ${end - start - 1} ${cellNoun(asset)}${end - start - 1 === 1 ? "" : "s"}`;
      touch(asset);
      break;
    }
    case "undo": {
      const asset = activeAsset();
      if (asset && state.history.past.length) {
        state.history.future.push(snapshotAsset(asset));
        applySnapshot(asset, state.history.past.pop());
      }
      break;
    }
    case "redo": {
      const asset = activeAsset();
      if (asset && state.history.future.length) {
        state.history.past.push(snapshotAsset(asset));
        applySnapshot(asset, state.history.future.pop());
      }
      break;
    }
    default:
      break;
  }
  render();
}

function touch(asset) {
  asset.updatedAt = Date.now();
  saveAssets();
}

/* ---------- History ---------- */

function resetHistory() {
  state.history = { past: [], future: [] };
}

function snapshotAsset(asset) {
  if (asset.type === "particles") {
    return {
      particles: asset.particles.map((particle) => ({
        id: particle.id,
        width: particle.width,
        height: particle.height,
        frames: particle.frames.map((frame) => [...frame]),
      })),
      activeParticle: state.activeParticle,
      activeTile: state.activeTile,
    };
  }
  return {
    width: widthOf(asset),
    height: heightOf(asset),
    cells: cellsOf(asset).map((cell) => [...cell]),
    visibility: asset.type === "blockset" ? [...asset.visibility] : null,
    activeTile: state.activeTile,
  };
}

function pushHistory() {
  const asset = activeAsset();
  if (!asset) return;
  state.history.past.push(snapshotAsset(asset));
  if (state.history.past.length > HISTORY_LIMIT) state.history.past.shift();
  state.history.future = [];
}

function applySnapshot(asset, snapshot) {
  restoreSnapshot(asset, snapshot);
  touch(asset);
}

function restoreSnapshot(asset, snapshot) {
  if (asset.type === "particles") {
    asset.particles = snapshot.particles.map((particle) => ({
      id: particle.id,
      width: particle.width,
      height: particle.height,
      frames: particle.frames.map((frame) => [...frame]),
    }));
    state.activeParticle = Math.min(snapshot.activeParticle, asset.particles.length - 1);
    state.activeTile = Math.min(snapshot.activeTile, selectedParticle(asset).frames.length - 1);
    state.selection = null;
    if (!canZoomAsset(asset)) state.zoom = 1;
    return;
  }
  const cells = snapshot.cells.map((cell) => [...cell]);
  if (asset.type === "tileset") {
    asset.tileSize = snapshot.width;
  } else {
    asset.width = snapshot.width;
    asset.height = snapshot.height;
  }
  setCellsOf(asset, cells);
  if (asset.type === "blockset") {
    asset.visibility = snapshot.visibility
      ? cells.map((_, index) => snapshot.visibility[index] !== false)
      : cells.map(() => true);
  }
  state.activeTile = Math.min(snapshot.activeTile, cells.length - 1);
}

/* ---------- Playback ---------- */

function startPlayback() {
  const asset = activeAsset();
  if (!asset || !hasPlayback(asset)) return;
  stopPlayTimer();
  state.playing = true;
  state.playTimer = setInterval(playbackTick, 1000 / clampInt(asset.fps, MIN_FPS, MAX_FPS));
}

function stopPlayback() {
  state.playing = false;
  stopPlayTimer();
  const playButton = document.querySelector("[data-play-btn]");
  if (playButton) {
    playButton.classList.remove("playing");
    playButton.innerHTML = ICONS.play;
    playButton.title = "Play";
    playButton.ariaLabel = "Play";
  }
}

function stopPlayTimer() {
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
  }
}

function playbackTick() {
  const asset = activeAsset();
  if (!asset || !hasPlayback(asset)) {
    stopPlayback();
    return;
  }
  state.activeTile = (state.activeTile + 1) % cellsOf(asset).length;
  drawCanvases();
  document.querySelectorAll(".tile-thumb").forEach((thumb, index) => {
    thumb.classList.toggle("active", index === state.activeTile);
  });
}

/* ---------- Resizing ---------- */

function resizeAsset(asset, requestedWidth, requestedHeight) {
  const maxSize = maxSizeForAsset(asset);
  const minSize = minSizeForAsset(asset);
  const nextWidth = clampInt(requestedWidth, minSize, maxSize);
  const nextHeight = clampInt(requestedHeight, minSize, maxSize);
  const oldWidth = widthOf(asset);
  const oldHeight = heightOf(asset);
  if (nextWidth === oldWidth && nextHeight === oldHeight) return;
  pushHistory();
  const resized = cellsOf(asset).map((cells) => {
    const next = blankGrid(nextWidth, nextHeight);
    for (let y = 0; y < Math.min(oldHeight, nextHeight); y += 1) {
      for (let x = 0; x < Math.min(oldWidth, nextWidth); x += 1) {
        next[indexFor(x, y, nextWidth)] = cells[indexFor(x, y, oldWidth)];
      }
    }
    return next;
  });
  if (asset.type === "tileset") {
    asset.tileSize = nextWidth;
  } else if (asset.type === "particles") {
    const particle = selectedParticle(asset);
    particle.width = nextWidth;
    particle.height = nextHeight;
  } else {
    asset.width = nextWidth;
    asset.height = nextHeight;
  }
  setCellsOf(asset, resized);
  touch(asset);
}

/* ---------- Rendering ---------- */

function render() {
  // The DOM is rebuilt, so any hover state is stale; a genuine hover
  // re-fires mouseenter on the next mouse move.
  const scrollPositions = captureDockScroll();
  hoverPreviewId = null;
  app.innerHTML = "";
  app.append(topbar());
  const screen = document.createElement("section");
  screen.className = "screen";
  screen.append(state.screen === "editor" ? editorScreen() : galleryScreen());
  app.append(screen);
  if (state.pendingDelete) {
    const overlay = confirmOverlay();
    if (overlay) app.append(overlay);
  }
  if (state.syncOpen) app.append(syncOverlay());
  // Layout and draw synchronously: the elements are already attached, and
  // deferring to rAF leaves a window where the canvas is unsized, so
  // pointer coordinates computed against it land on the wrong cells.
  layoutMainCanvas();
  drawCanvases();
  restoreDockScroll(scrollPositions);
  app.append(refreshButton());
  startGalleryPreviews();
  startParticlePreview();
}

function captureDockScroll() {
  const positions = {
    dock: {},
    canvas: null,
  };
  for (const selector of DOCK_SCROLL_SELECTORS) {
    const node = app.querySelector(selector);
    if (node) positions.dock[selector] = node.scrollLeft;
  }
  const canvasArea = app.querySelector(".canvas-area");
  if (canvasArea) {
    positions.canvas = {
      left: canvasArea.scrollLeft,
      top: canvasArea.scrollTop,
    };
  }
  return positions;
}

function restoreDockScroll(positions) {
  for (const [selector, scrollLeft] of Object.entries(positions.dock)) {
    const node = app.querySelector(selector);
    if (node) node.scrollLeft = scrollLeft;
  }
  const canvasArea = app.querySelector(".canvas-area");
  if (canvasArea && positions.canvas) {
    canvasArea.scrollLeft = positions.canvas.left;
    canvasArea.scrollTop = positions.canvas.top;
  }
}

// Cards animate only while hovered.
function startGalleryPreviews() {
  if (galleryTimer) {
    clearInterval(galleryTimer);
    galleryTimer = null;
  }
  if (state.screen !== "gallery" || !state.assets.some(hasGalleryAnimation)) return;
  galleryTimer = setInterval(() => {
    if (!hoverPreviewId) return;
    const canvas = document.querySelector(`[data-preview-asset="${hoverPreviewId}"]`);
    const asset = state.assets.find((item) => item.id === hoverPreviewId);
    if (!canvas || !asset || !hasGalleryAnimation(asset)) return;
    const card = canvas.closest(".asset-card");
    if (!card || !card.matches(":hover")) {
      hoverPreviewId = null;
      drawAssetPreview(canvas, asset, 0);
      return;
    }
    previewTick += 1;
    drawAssetPreview(canvas, asset, previewTick);
  }, 160);
}

function confirmOverlay() {
  const asset = state.assets.find((item) => item.id === state.pendingDelete);
  if (!asset) return null;
  const count = assetItemCount(asset);
  const noun = assetItemNoun(asset);
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) dispatch({ type: "cancelDelete" });
  });
  const box = document.createElement("div");
  box.className = "confirm-box";
  box.role = "alertdialog";
  box.ariaLabel = `Delete ${asset.name}`;
  box.innerHTML = `
    <p class="confirm-title">Delete ${escapeHtml(asset.name)}?</p>
    <p class="confirm-note">${asset.type} / ${count} ${noun}${count === 1 ? "" : "s"} — this cannot be undone.</p>
  `;
  const row = document.createElement("div");
  row.className = "confirm-actions";
  row.append(
    button("Cancel", "btn", () => dispatch({ type: "cancelDelete" })),
    button("Delete", "btn danger-solid", () => dispatch({ type: "deleteAsset", id: asset.id })),
  );
  box.append(row);
  overlay.append(box);
  return overlay;
}

function topbar() {
  const asset = activeAsset();
  const count = asset ? assetItemCount(asset) : 0;
  const breadcrumb = asset?.type === "particles"
    ? `${asset.name} / particle ${state.activeParticle + 1} of ${count} / ${widthOf(asset)}x${heightOf(asset)} / ${cellsOf(asset).length} frame${cellsOf(asset).length === 1 ? "" : "s"}`
    : asset
      ? `${asset.name} / ${widthOf(asset)}x${heightOf(asset)} / ${count} ${cellNoun(asset)}${count === 1 ? "" : "s"}`
      : state.status;
  let status = state.screen === "editor" ? (state.flash || breadcrumb) : state.status;
  if (state.screen === "gallery" && state.status === "Local only" && syncConfigured()) {
    const record = syncStateRecord();
    status = record ? `Synced ${relativeTime(record.at)}` : "Sync configured — not synced yet";
  }
  state.flash = "";
  const header = document.createElement("header");
  header.className = "topbar";
  header.innerHTML = `
    <span class="mark" aria-hidden="true"></span>
    <div class="title-block">
      <h1>Grain Assets</h1>
      <p class="status">${escapeHtml(status)}</p>
    </div>
  `;
  const right = document.createElement("div");
  right.className = "topbar-actions";
  if (state.screen === "editor") {
    right.append(iconTextButton("Gallery", "back", "btn", () => dispatch({ type: "openGallery" })));
  } else {
    right.append(iconTextButton("Sync", "sync", "btn", () => dispatch({ type: "openSync" })));
  }
  header.append(right);
  return header;
}

function refreshButton() {
  const el = iconButton("Refresh page", "sync", "refresh-btn", hardReloadApp);
  return el;
}

async function hardReloadApp() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    if (regs) await Promise.all(regs.map((registration) => registration.unregister()));
  } catch (error) {
    console.warn("service worker unregister failed:", error);
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn("cache clear failed:", error);
  }
  // Unregistering the service worker and clearing the Cache API is not enough:
  // iOS home-screen web apps still serve app.js/styles.css from the HTTP disk
  // cache, and a plain reload only cache-busts the document URL, not those
  // sub-resources. Re-fetch every same-origin script/stylesheet (plus the
  // document) with cache: "reload" to force the network and refresh those
  // cache entries, so the reload below actually loads the new code.
  try {
    const urls = new Set([window.location.pathname]);
    document.querySelectorAll("script[src], link[rel='stylesheet'][href]").forEach((node) => {
      const src = node.getAttribute("src") || node.getAttribute("href");
      if (!src) return;
      const abs = new URL(src, window.location.href);
      if (abs.origin === window.location.origin) urls.add(abs.href);
    });
    await Promise.all([...urls].map((url) => fetch(url, { cache: "reload" }).catch(() => {})));
  } catch (error) {
    console.warn("resource refresh failed:", error);
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_", Date.now().toString());
  window.location.replace(url.toString());
}

/* ---------- Git sync ---------- */

function syncConfig() {
  return {
    token: localStorage.getItem(SYNC_TOKEN_KEY) || "",
    owner: localStorage.getItem(SYNC_OWNER_KEY) || "",
    repo: localStorage.getItem(SYNC_REPO_KEY) || SYNC_DEFAULT_REPO,
  };
}

function syncConfigured() {
  const { token, owner } = syncConfig();
  return Boolean(token && owner);
}

function syncStateRecord() {
  try {
    const raw = localStorage.getItem(SYNC_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed.at) || !Array.isArray(parsed.names)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function recordSyncState() {
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify({
    at: Date.now(),
    names: state.assets.map((asset) => asset.name),
  }));
}

function assetUnsynced(asset) {
  if (!syncConfigured()) return false;
  const record = syncStateRecord();
  if (!record) return true;
  return !record.names.includes(asset.name) || asset.updatedAt > record.at;
}

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function setSyncStatus(message, busy = state.syncBusy) {
  state.syncBusy = busy;
  state.syncMessage = message;
  render();
}

function assetRemotePath(asset) {
  return `${SYNC_PREFIX}${asset.name}.grainasset`;
}

function assetNameFromRemotePath(path) {
  const file = path.split("/").pop() || "asset";
  return sanitizeName(file.replace(/\.grainasset$/i, ""));
}

async function syncPush() {
  const { token, owner, repo } = syncConfig();
  if (!token || !owner) {
    setSyncStatus("Set a token and owner first.");
    return;
  }
  setSyncStatus("Pushing…", true);
  try {
    const remote = await GrainSync.listTree(token, owner, repo, SYNC_BRANCH);
    const localPaths = new Set(state.assets.map(assetRemotePath));
    const deletes = (remote ? remote.tree : [])
      .filter((entry) =>
        entry.path.startsWith(SYNC_PREFIX)
        && (entry.path.endsWith(".grainasset") || entry.path.endsWith(".json")))
      .map((entry) => entry.path)
      .filter((path) => !localPaths.has(path));
    const files = state.assets.map((asset) => ({
      path: assetRemotePath(asset),
      contentBytes: encodeBinaryAsset(asset),
    }));
    if (files.length === 0 && deletes.length === 0) {
      setSyncStatus("Nothing to push.", false);
      return;
    }
    const message = `${new Date().toISOString()} — asset editor sync`;
    await GrainSync.putTree(token, owner, repo, files, message, deletes, SYNC_BRANCH);
    recordSyncState();
    setSyncStatus(`Pushed ${files.length} asset${files.length === 1 ? "" : "s"}${deletes.length ? `, removed ${deletes.length}` : ""}.`, false);
  } catch (error) {
    setSyncStatus(`Push failed: ${error.message}`, false);
  }
}

async function syncPull() {
  const { token, owner, repo } = syncConfig();
  if (!token || !owner) {
    setSyncStatus("Set a token and owner first.");
    return;
  }
  setSyncStatus("Pulling…", true);
  try {
    const remote = await GrainSync.listTree(token, owner, repo, SYNC_BRANCH);
    const entries = (remote ? remote.tree : [])
      .filter((entry) => entry.path.startsWith(SYNC_PREFIX) && entry.path.endsWith(".grainasset"));
    let pulled = 0;
    for (const entry of entries) {
      const bytes = await GrainSync.getBlob(token, owner, repo, entry.sha);
      let asset = null;
      try {
        asset = decodeBinaryAsset(bytes, assetNameFromRemotePath(entry.path));
      } catch {
        continue;
      }
      if (!asset) continue;
      const index = state.assets.findIndex((item) => item.name === asset.name);
      if (index >= 0) state.assets[index] = asset;
      else state.assets.push(asset);
      pulled += 1;
    }
    saveAssets();
    if (pulled) recordSyncState();
    setSyncStatus(pulled ? `Pulled ${pulled} asset${pulled === 1 ? "" : "s"} (remote wins).` : "Nothing to pull.", false);
  } catch (error) {
    setSyncStatus(`Pull failed: ${error.message}`, false);
  }
}

function syncOverlay() {
  const config = syncConfig();
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay && !state.syncBusy) dispatch({ type: "closeSync" });
  });
  const box = document.createElement("div");
  box.className = "confirm-box sync-box";
  box.role = "dialog";
  box.ariaLabel = "Git sync";
  box.innerHTML = `
    <p class="confirm-title">Git sync</p>
    <p class="confirm-note">Assets sync as TinyGrain .grainasset files to github.com/&lt;owner&gt;/&lt;repo&gt; under ${SYNC_PREFIX} — fine-grained token, contents read/write.</p>
  `;
  const fields = document.createElement("div");
  fields.className = "sync-fields";
  const token = syncField(fields, "Token", "password", config.token, SYNC_TOKEN_KEY);
  const owner = syncField(fields, "Owner", "text", config.owner, SYNC_OWNER_KEY);
  const repo = syncField(fields, "Repo", "text", config.repo, SYNC_REPO_KEY);
  box.append(fields);
  const record = syncStateRecord();
  const status = document.createElement("p");
  status.className = "sync-status";
  status.textContent = state.syncMessage
    || (record ? `Last sync ${relativeTime(record.at)}.` : "Ready.");
  box.append(status);
  const row = document.createElement("div");
  row.className = "confirm-actions";
  const pull = button("Pull all", "btn", () => syncPull());
  const push = button("Push all", "btn primary", () => syncPush());
  pull.disabled = state.syncBusy;
  push.disabled = state.syncBusy;
  row.append(pull, push);
  box.append(row);
  const close = button("Close", "btn sync-close", () => dispatch({ type: "closeSync" }));
  close.disabled = state.syncBusy;
  box.append(close);
  overlay.append(box);
  return overlay;

  function syncField(parent, label, type, value, storageKey) {
    const wrap = document.createElement("label");
    wrap.className = "size-control sync-field";
    wrap.innerHTML = `<span>${label}</span>`;
    const input = document.createElement("input");
    input.className = "name-input";
    input.type = type;
    input.value = value;
    input.autocomplete = "off";
    input.addEventListener("change", () => {
      localStorage.setItem(storageKey, input.value.trim());
    });
    wrap.append(input);
    parent.append(wrap);
    return input;
  }
}

function galleryScreen() {
  const wrap = document.createElement("div");
  wrap.className = "gallery";

  const actions = document.createElement("div");
  actions.className = "gallery-actions";
  const createPanel = document.createElement("div");
  createPanel.className = "create-panel";
  const name = document.createElement("input");
  name.className = "name-input";
  name.value = state.draftName;
  name.autocomplete = "off";
  name.ariaLabel = "New asset name";
  name.addEventListener("input", () => {
    state.draftName = name.value;
  });
  createPanel.append(
    name,
    iconTextButton("Tileset", "plus", "btn primary", () => dispatch({ type: "createAsset", kind: "tileset" })),
    iconTextButton("Animation", "plus", "btn", () => dispatch({ type: "createAsset", kind: "animation" })),
    iconTextButton("Particles", "plus", "btn", () => dispatch({ type: "createAsset", kind: "particles" })),
    iconTextButton("Cube", "plus", "btn", () => dispatch({ type: "createAsset", kind: "cube" })),
    iconTextButton("Blockset", "plus", "btn", () => dispatch({ type: "createAsset", kind: "blockset" })),
  );
  actions.append(createPanel);
  wrap.append(actions);

  if (state.assets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No assets yet.";
    wrap.append(empty);
    return wrap;
  }

  const grid = document.createElement("div");
  grid.className = "asset-grid";
  for (const asset of state.assets) {
    grid.append(assetCard(asset));
  }
  wrap.append(grid);
  return wrap;
}

function assetCard(asset) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "asset-card";
  card.addEventListener("click", () => dispatch({ type: "openAsset", id: asset.id }));

  const preview = document.createElement("div");
  preview.className = "asset-preview";
  const canvas = document.createElement("canvas");
  canvas.width = widthOf(asset);
  canvas.height = heightOf(asset);
  canvas.dataset.previewAsset = asset.id;
  preview.append(canvas);
  if (hasGalleryAnimation(asset)) {
    // Real mouse hover only: touch taps synthesize mouseenter without a
    // matching mouseleave, which left previews animating forever.
    card.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      hoverPreviewId = asset.id;
      previewTick = 0;
    });
    card.addEventListener("pointerleave", () => {
      if (hoverPreviewId === asset.id) hoverPreviewId = null;
      drawAssetPreview(canvas, asset, 0);
    });
  }

  const count = assetItemCount(asset);
  const noun = assetItemNoun(asset);
  const meta = document.createElement("div");
  meta.className = "asset-meta";
  const unsynced = assetUnsynced(asset)
    ? '<span class="unsynced" title="Not synced">●</span> '
    : "";
  meta.innerHTML = `
    <div>
      <div class="asset-name">${unsynced}${escapeHtml(asset.name)}</div>
      <div class="asset-kind">${count} ${noun}${count === 1 ? "" : "s"}</div>
    </div>
    <div class="asset-kind">${asset.type}</div>
  `;
  const remove = document.createElement("span");
  remove.className = "card-delete";
  remove.role = "button";
  remove.tabIndex = 0;
  remove.title = `Delete ${asset.name}`;
  remove.ariaLabel = remove.title;
  remove.innerHTML = ICONS.trash;
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    dispatch({ type: "requestDelete", id: asset.id });
  });
  card.append(preview, meta, remove);
  return card;
}

function editorScreen() {
  const asset = activeAsset();
  if (!asset) return galleryScreen();

  const wrap = document.createElement("div");
  wrap.className = `editor${asset.type === "particles" ? " particles-editor" : ""}`;

  const head = document.createElement("div");
  head.className = "editor-head";
  const rename = document.createElement("input");
  rename.className = "name-input";
  rename.value = asset.name;
  rename.ariaLabel = "Asset name";
  rename.addEventListener("change", () => dispatch({ type: "renameAsset", name: rename.value }));
  const sizeGroup = document.createElement("div");
  sizeGroup.className = "size-group";
  if (asset.type === "tileset") {
    sizeGroup.append(
      stepperControl("Size", asset.tileSize, MIN_TILE_SIZE, MAX_TILE_SIZE, "Tile size", (value) =>
        dispatch({ type: "resizeAsset", width: value, height: value })),
    );
  } else {
    const maxSize = maxSizeForAsset(asset);
    const minSize = minSizeForAsset(asset);
    sizeGroup.append(
      stepperControl("W", widthOf(asset), minSize, maxSize, "Width", (value) =>
        dispatch({ type: "resizeAsset", width: value, height: heightOf(asset) })),
      stepperControl("H", heightOf(asset), minSize, maxSize, "Height", (value) =>
        dispatch({ type: "resizeAsset", width: widthOf(asset), height: value })),
    );
  }
  if (canZoomAsset(asset)) sizeGroup.append(zoomControl(asset));
  sizeGroup.append(iconTextButton("Export", "download", "btn", () => exportActiveAsset()));
  head.append(rename, sizeGroup);
  wrap.append(head);

  if (asset.type === "particles") wrap.append(particleList(asset));

  const canvasArea = document.createElement("div");
  canvasArea.className = "canvas-area";
  const canvas = document.createElement("canvas");
  canvas.className = "drawing-canvas";
  canvas.addEventListener("pointerdown", onCanvasPointerDown);
  canvas.addEventListener("pointermove", onCanvasPointerMove);
  canvas.addEventListener("pointerup", onCanvasPointerUp);
  canvas.addEventListener("pointercancel", onCanvasPointerCancel);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvasArea.addEventListener("wheel", onCanvasWheel, { passive: false });
  canvasArea.append(canvas);
  wrap.append(canvasArea);

  if (asset.type === "particles") wrap.append(particlePreviewPanel(asset));

  const dock = document.createElement("div");
  dock.className = "dock";
  dock.append(toolRow(asset), colorRow(asset), brushRow(asset), frameActions(asset), tileActions(asset), tileRow(asset));
  wrap.append(dock);
  return wrap;
}

function particleList(asset) {
  const panel = document.createElement("section");
  panel.className = "particle-list-panel";
  const heading = document.createElement("div");
  heading.className = "particle-list-heading";
  heading.innerHTML = `<span>Particles</span><span>${asset.particles.length}</span>`;
  const list = document.createElement("div");
  list.className = "particle-list";
  asset.particles.forEach((particle, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `particle-item${index === state.activeParticle ? " active" : ""}`;
    item.ariaLabel = `Edit particle ${index + 1}, ${particle.width} by ${particle.height}, ${particle.frames.length} frames`;
    item.addEventListener("click", () => dispatch({ type: "selectParticle", index }));
    const canvas = document.createElement("canvas");
    canvas.dataset.particleThumb = String(index);
    const label = document.createElement("span");
    label.innerHTML = `<b>${String(index + 1).padStart(2, "0")}</b><small>${particle.width}×${particle.height} · ${particle.frames.length}f</small>`;
    item.append(canvas, label);
    list.append(item);
  });
  const actions = document.createElement("div");
  actions.className = "particle-list-actions";
  const remove = iconButton("Delete selected particle", "trash", "icon-btn danger", () =>
    dispatch({ type: "removeParticle" }));
  remove.disabled = asset.particles.length <= 1;
  actions.append(
    iconTextButton("Add", "plus", "btn", () => dispatch({ type: "addParticle" })),
    iconTextButton("Duplicate", "duplicate", "btn", () => dispatch({ type: "duplicateParticle" })),
    remove,
  );
  panel.append(heading, list, actions);
  return panel;
}

function particlePreviewPanel(asset) {
  const details = document.createElement("details");
  details.className = "particle-preview-panel";
  details.open = state.particlePreviewOpen;
  details.addEventListener("toggle", () => {
    state.particlePreviewOpen = details.open;
    if (details.open) startParticlePreview();
    else stopParticlePreview();
  });
  const summary = document.createElement("summary");
  summary.innerHTML = `<span>Particle preview</span><small>editor only</small>`;
  const body = document.createElement("div");
  body.className = "particle-preview-body";
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "particle-preview-canvas-wrap";
  const canvas = document.createElement("canvas");
  canvas.className = "particle-preview-canvas";
  canvas.width = asset.preview.canvasWidth;
  canvas.height = asset.preview.canvasHeight;
  canvasWrap.append(canvas);
  const controls = document.createElement("div");
  controls.className = "particle-preview-controls";
  const configs = [
    { key: "number", label: "Number", min: 0, max: MAX_PARTICLE_PREVIEW_COUNT, step: 1 },
    { key: "speed", label: "Animation speed", min: -8, max: 8, step: 0.1 },
    { key: "driftX", label: "Drift X", min: -200, max: 200, step: 1, unit: "px/s" },
    { key: "driftY", label: "Drift Y", min: -200, max: 200, step: 1, unit: "px/s" },
    { key: "movement", label: "Movement", min: 0, max: 200, step: 1, unit: "px/s" },
    { key: "dirChange", label: "Direction change", min: 0, max: 10, step: 0.1, unit: "/s" },
    { key: "canvasWidth", label: "Canvas width", min: MIN_PARTICLE_PREVIEW_SIZE, max: MAX_PARTICLE_PREVIEW_SIZE, step: 1, unit: "px", integer: true },
    { key: "canvasHeight", label: "Canvas height", min: MIN_PARTICLE_PREVIEW_SIZE, max: MAX_PARTICLE_PREVIEW_SIZE, step: 1, unit: "px", integer: true },
  ];
  for (const config of configs) controls.append(particlePreviewControl(asset, config));
  body.append(canvasWrap, controls);
  details.append(summary, body);
  return details;
}

function particlePreviewControl(asset, config) {
  const label = document.createElement("label");
  label.className = "particle-preview-control";
  const text = document.createElement("span");
  text.textContent = config.label;
  const valueWrap = document.createElement("span");
  valueWrap.className = "particle-preview-value";
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(config.min);
  input.max = String(config.max);
  input.step = String(config.step);
  input.value = String(asset.preview[config.key]);
  input.ariaLabel = config.label;
  const isInteger = config.key === "number" || config.integer === true;
  input.addEventListener("input", () => {
    const value = isInteger
      ? clampInt(input.value, config.min, config.max)
      : clampNumber(input.value, config.min, config.max);
    asset.preview = normalizeParticlePreview({ ...asset.preview, [config.key]: value });
    saveAssets();
    if (config.key === "canvasWidth" || config.key === "canvasHeight") {
      const canvas = document.querySelector(".particle-preview-canvas");
      if (canvas) resizeParticlePreviewCanvas(canvas, asset);
    }
  });
  input.addEventListener("change", () => {
    input.value = String(asset.preview[config.key]);
  });
  valueWrap.append(input);
  if (config.unit) {
    const unit = document.createElement("small");
    unit.textContent = config.unit;
    valueWrap.append(unit);
  }
  label.append(text, valueWrap);
  return label;
}

function stepperControl(label, value, min, max, description, apply) {
  const control = document.createElement("div");
  control.className = "size-control";
  control.innerHTML = `<span>${escapeHtml(label)}</span>`;
  const stepper = document.createElement("div");
  stepper.className = "stepper";
  const input = document.createElement("input");
  input.className = "step-value";
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = "1";
  input.value = String(value);
  input.ariaLabel = description;
  input.addEventListener("change", () => apply(clampInt(input.value, min, max)));
  stepper.append(
    iconButton(`Decrease ${description.toLowerCase()}`, "minus", "step-btn", () => apply(clampInt(value - 1, min, max))),
    input,
    iconButton(`Increase ${description.toLowerCase()}`, "plus", "step-btn", () => apply(clampInt(value + 1, min, max))),
  );
  control.append(stepper);
  return control;
}

function zoomControl(asset) {
  const zoom = zoomFactorForAsset(asset);
  const control = document.createElement("div");
  control.className = "size-control zoom-control";
  control.innerHTML = "<span>Zoom</span>";
  const stepper = document.createElement("div");
  stepper.className = "stepper small";
  const zoomIndex = ZOOM_LEVELS.indexOf(zoom);
  const out = document.createElement("span");
  out.className = "step-value zoom-value";
  out.textContent = `${zoom}x`;
  const zoomOut = iconButton("Zoom out", "minus", "step-btn", () =>
    dispatch({ type: "setZoom", zoom: ZOOM_LEVELS[Math.max(0, zoomIndex - 1)] }));
  const zoomIn = iconButton("Zoom in", "plus", "step-btn", () =>
    dispatch({ type: "setZoom", zoom: ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, zoomIndex + 1)] }));
  zoomOut.disabled = zoomIndex <= 0;
  zoomIn.disabled = zoomIndex >= ZOOM_LEVELS.length - 1;
  stepper.append(zoomOut, out, zoomIn);
  control.append(stepper);
  return control;
}

function toolRow(asset) {
  const row = document.createElement("div");
  row.className = "tool-row";
  const toolGroups = [
    [
      ["Pen", "pen"],
      [`Dither pen (${Math.round((state.ditherLevel / 16) * 100)}% — click again to cycle)`, "dither"],
      ["Spray", "spray"],
      ["Noise brush", "noise"],
      ["Blur / smudge", "blur"],
      ["Soft displace", "displace"],
    ],
    [
      ["Line", "line"],
      ["Filled square", "square"],
      ["Gradient", "gradient"],
      ["Fill bucket", "fill"],
    ],
    [
      ["Shift (drag to offset)", "shift"],
      ["Select (drag; move inside; copy/cut/paste with keyboard)", "select"],
    ],
  ];
  toolGroups.forEach((tools, groupIndex) => {
    if (groupIndex) row.append(toolbarDivider());
    for (const [label, tool] of tools) {
      row.append(toggleButton(label, tool, state.tool === tool, () => dispatch({ type: "setTool", tool })));
    }
  });
  return row;
}

function toolbarDivider() {
  const divider = document.createElement("span");
  divider.className = "action-divider";
  return divider;
}

function brushRow(asset) {
  const row = document.createElement("div");
  row.className = "brush-row";
  row.append(
    controlCluster("Brush", brushSizeControl()),
    controlCluster("Scope", paintScopeButtons(asset)),
  );
  if (["z", "zsoft"].includes(paintScopeFor(asset)) && hasPlayback(asset)) {
    row.append(controlCluster("Z", zBrushControl(asset)));
  }
  if (asset.type === "cube") {
    row.append(controlCluster("Gray", grayRangeControl()));
    row.append(controlCluster("Alpha", opacityRangeControl()));
  }
  return row;
}

function controlCluster(label, content) {
  const wrap = document.createElement("div");
  wrap.className = "control-cluster";
  const title = document.createElement("span");
  title.className = "cluster-label";
  title.textContent = label;
  const body = document.createElement("div");
  body.className = "cluster-body";
  body.append(content);
  wrap.append(title, body);
  return wrap;
}

function brushSizeControl() {
  const control = document.createElement("div");
  control.className = "brush-size-control";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "brush-size-slider";
  slider.min = String(MIN_BRUSH_SIZE);
  slider.max = String(MAX_BRUSH_SIZE);
  slider.step = "1";
  slider.value = String(state.brushSize);
  slider.ariaLabel = "Brush size";
  const value = document.createElement("span");
  value.className = "brush-size-value";
  value.textContent = String(state.brushSize);
  slider.addEventListener("input", () => {
    const size = clampBrushSize(slider.value);
    state.brushSize = size;
    value.textContent = String(size);
  });
  slider.addEventListener("change", () => dispatch({ type: "setBrushSize", size: slider.value }));
  const shape = document.createElement("div");
  shape.className = "segmented icon-segmented brush-shape";
  for (const [label, iconName, brushShape] of [
    ["Square brush", "square", "square"],
    ["Round brush", "circle", "round"],
  ]) {
    shape.append(iconButton(label, iconName, `segment-btn icon-segment${state.brushShape === brushShape ? " active" : ""}`, () =>
      dispatch({ type: "setBrushShape", shape: brushShape })));
  }
  control.append(slider, value, shape);
  return control;
}

function paintScopeButtons(asset) {
  const group = document.createElement("div");
  group.className = "segmented icon-segmented";
  const current = paintScopeFor(asset);
  const scopes = [
    { label: "Active target", iconName: "target", scope: "active" },
    asset.type === "blockset" ? { label: "Visible layers", iconName: "visible", scope: "visible" } : null,
    { label: "All targets", iconName: "stack", scope: "all" },
    hasPlayback(asset) ? { label: "Z frame brush", iconName: "zframe", scope: "z" } : null,
    hasPlayback(asset) && asset.type === "cube"
      ? { label: "Dithered Z falloff brush", iconName: "zsoft", scope: "zsoft", zFalloffMode: "coverage" }
      : null,
    hasPlayback(asset) && asset.type === "cube"
      ? { label: "Blended Z falloff brush", iconName: "zblend", scope: "zsoft", zFalloffMode: "blend" }
      : null,
    hasPlayback(asset) && asset.type !== "cube"
      ? { label: "Z falloff brush", iconName: "zsoft", scope: "zsoft" }
      : null,
  ].filter(Boolean);
  for (const { label, iconName, scope, zFalloffMode } of scopes) {
    const active = current === scope && (!zFalloffMode || validZFalloffMode(state.zFalloffMode) === zFalloffMode);
    const btn = iconButton(label, iconName, `segment-btn icon-segment${active ? " active" : ""}`, () =>
      dispatch({ type: "setPaintScope", scope, zFalloffMode }));
    group.append(btn);
  }
  return group;
}

function zBrushControl(asset) {
  const frames = cellsOf(asset).length;
  const max = Math.min(MAX_Z_BRUSH_RADIUS, Math.max(0, frames - 1));
  const radius = clampInt(state.zBrushRadius, 0, max);
  const control = document.createElement("div");
  control.className = "z-brush-control";
  const stepper = document.createElement("div");
  stepper.className = "stepper small flat-stepper";
  const out = document.createElement("span");
  out.className = "step-value zoom-value";
  out.textContent = String(radius);
  const down = iconButton("Smaller z brush", "minus", "step-btn", () =>
    dispatch({ type: "setZBrushRadius", radius: radius - 1 }));
  const up = iconButton("Larger z brush", "plus", "step-btn", () =>
    dispatch({ type: "setZBrushRadius", radius: radius + 1 }));
  down.disabled = radius <= 0;
  up.disabled = radius >= max;
  stepper.append(down, out, up);
  control.append(stepper);
  return control;
}

function grayRangeControl() {
  return scaleRangeControl({
    kind: "gray",
    label: "gray",
    scale: state.grayScale,
    minValue: state.grayMin,
    maxValue: state.grayMax,
    max: 255,
    mode: state.grayMode,
    setRangeType: "setGrayRange",
    setScaleType: "setGrayScale",
    setModeType: "setGrayMode",
    onUpdate: (value) => {
      state.color = grayPixel(value);
      const chip = document.querySelector(".gray-chip");
      if (chip) chip.style.background = cssForPixel(grayPixel(value));
    },
  });
}

function opacityRangeControl() {
  return scaleRangeControl({
    kind: "opacity",
    label: "opacity",
    scale: state.opacityScale,
    minValue: state.opacityMin,
    maxValue: state.opacityMax,
    max: 100,
    mode: state.opacityMode,
    setRangeType: "setOpacityRange",
    setScaleType: "setOpacityScale",
    setModeType: "setOpacityMode",
  });
}

function scaleRangeControl(config) {
  const wrap = document.createElement("div");
  wrap.className = `gray-range-control ${config.kind}-range-control`;
  let currentMin = clampInt(config.minValue, 0, config.max);
  let currentMax = config.scale === "single" ? currentMin : clampInt(config.maxValue, 0, config.max);
  const values = document.createElement("div");
  values.className = `gray-range-values${config.scale === "single" ? " single" : ""}`;
  const min = grayRangeNumber(config.scale === "single" ? capitalize(config.label) : `Minimum ${config.label}`, currentMin, config.max);
  const slider = config.scale === "single"
    ? singleRangeSlider(config.kind, currentMin, config.max, config.label)
    : dualRangeSlider(config.kind, currentMin, currentMax, config.max, config.label);
  const updateCss = (low, high) => {
    const lowPercent = config.max > 0 ? (low / config.max) * 100 : 0;
    const highPercent = config.max > 0 ? (high / config.max) * 100 : 0;
    slider.wrap.style.setProperty("--range-min", `${lowPercent}%`);
    slider.wrap.style.setProperty("--range-max", `${highPercent}%`);
  };
  const update = (nextMin, nextMax = nextMin) => {
    const low = config.scale === "single"
      ? clampInt(nextMin, 0, config.max)
      : Math.min(clampInt(nextMin, 0, config.max), clampInt(nextMax, 0, config.max));
    const high = config.scale === "single"
      ? low
      : Math.max(clampInt(nextMin, 0, config.max), clampInt(nextMax, 0, config.max));
    currentMin = low;
    currentMax = high;
    if (config.kind === "gray") {
      state.grayMin = low;
      state.grayMax = high;
    } else if (config.kind === "opacity") {
      state.opacityMin = low;
      state.opacityMax = high;
    }
    min.value = String(low);
    if (max) max.value = String(high);
    slider.min.value = String(low);
    if (slider.max) slider.max.value = String(high);
    slider.min.syncUI?.();
    slider.max?.syncUI?.();
    updateCss(config.scale === "single" ? 0 : low, high);
    config.onUpdate?.(low, high);
  };
  const commitCurrent = () => {
    dispatch({ type: config.setRangeType, min: currentMin, max: currentMax });
  };
  const commitNumbers = () => {
    if (config.scale === "single") update(clampInt(min.value, 0, config.max));
    else update(clampInt(min.value, 0, config.max), clampInt(max.value, 0, config.max));
    commitCurrent();
  };
  min.addEventListener("change", commitNumbers);
  slider.min.addEventListener("input", () => update(clampInt(slider.min.value, 0, config.max), currentMax));
  slider.min.addEventListener("change", commitCurrent);
  values.append(min, slider.wrap);
  let max = null;
  if (config.scale === "range") {
    max = grayRangeNumber(`Maximum ${config.label}`, currentMax, config.max);
    max.addEventListener("change", commitNumbers);
    slider.max.addEventListener("input", () => update(currentMin, clampInt(slider.max.value, 0, config.max)));
    slider.max.addEventListener("change", commitCurrent);
    values.append(max);
  }
  update(currentMin, currentMax);
  wrap.append(values, scaleToggle(config));
  if (config.scale === "range") {
    const modes = document.createElement("div");
    modes.className = `segmented icon-segmented gray-mode ${config.kind}-mode`;
    for (const [label, iconName, mode] of rangeModeOptions(config.label)) {
      modes.append(iconButton(label, iconName, `segment-btn icon-segment${config.mode === mode ? " active" : ""}`, () =>
        dispatch({ type: config.setModeType, mode })));
    }
    wrap.append(modes);
  }
  return wrap;
}

function scaleToggle(config) {
  const group = document.createElement("div");
  group.className = "segmented icon-segmented scale-toggle";
  for (const [label, iconName, scale] of [
    [`Single ${config.label} value`, "single", "single"],
    [`${capitalize(config.label)} range`, "range", "range"],
  ]) {
    group.append(iconButton(label, iconName, `segment-btn icon-segment${config.scale === scale ? " active" : ""}`, () =>
      dispatch({ type: config.setScaleType, scale })));
  }
  return group;
}

function rangeModeOptions(label) {
  return [
    [`Fixed ${label}`, "fixed", "fixed"],
    [`Random ${label} in range`, "random", "random"],
    [`${capitalize(label)} follows stroke`, "gradient", "gradient"],
    [`${capitalize(label)} darker/softer inside`, "radialOut", "radialOut"],
    [`${capitalize(label)} lighter/stronger inside`, "radialIn", "radialIn"],
  ];
}

function grayRangeNumber(label, value, max = 255) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "gray-number";
  input.min = "0";
  input.max = String(max);
  input.step = "1";
  input.value = String(value);
  input.ariaLabel = label;
  input.title = label;
  return input;
}

function dualRangeSlider(kind, minValue, maxValue, max, label) {
  const wrap = document.createElement("div");
  wrap.className = `gray-dual-slider dual-handle-slider ${kind}-dual-slider`;
  wrap.style.setProperty("--range-min", `${(minValue / max) * 100}%`);
  wrap.style.setProperty("--range-max", `${(maxValue / max) * 100}%`);
  const track = document.createElement("span");
  track.className = "gray-slider-track";
  const fill = document.createElement("span");
  fill.className = "gray-slider-fill";
  const minThumb = dualRangeThumb(`Minimum ${label}`);
  minThumb.classList.add("min-thumb");
  const maxThumb = dualRangeThumb(`Maximum ${label}`);
  maxThumb.classList.add("max-thumb");
  const min = proxyRangeInput(minThumb, minValue, max);
  const maxInput = proxyRangeInput(maxThumb, maxValue, max);
  bindDualRangeSlider(wrap, min, maxInput, max, minThumb, maxThumb);
  wrap.append(track, fill, minThumb, maxThumb, min, maxInput);
  return { wrap, min, max: maxInput };
}

function singleRangeSlider(kind, value, max, label) {
  const wrap = document.createElement("div");
  wrap.className = `gray-dual-slider single-slider ${kind}-dual-slider`;
  wrap.style.setProperty("--range-min", "0%");
  wrap.style.setProperty("--range-max", `${(value / max) * 100}%`);
  const track = document.createElement("span");
  track.className = "gray-slider-track";
  const fill = document.createElement("span");
  fill.className = "gray-slider-fill";
  const min = rangeInput(`${capitalize(label)} slider`, "single", value, max);
  wrap.append(track, fill, min);
  return { wrap, min };
}

function dualRangeThumb(label) {
  const thumb = document.createElement("span");
  thumb.className = "gray-slider-thumb";
  thumb.tabIndex = 0;
  thumb.setAttribute("role", "slider");
  thumb.setAttribute("aria-label", label);
  thumb.setAttribute("aria-valuemin", "0");
  thumb.setAttribute("aria-valuemax", "0");
  return thumb;
}

function proxyRangeInput(thumb, value, max) {
  const input = document.createElement("input");
  input.type = "hidden";
  input.value = String(value);
  input.max = String(max);
  input.syncUI = () => {
    thumb.setAttribute("aria-valuemax", String(max));
    thumb.setAttribute("aria-valuenow", String(input.value));
  };
  return input;
}

function bindDualRangeSlider(wrap, minInput, maxInput, max, minThumb, maxThumb) {
  const valueFromClientX = (clientX) => {
    const rect = wrap.getBoundingClientRect();
    const t = rect.width <= 0 ? 0 : Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(t * max);
  };
  const setInputValue = (input, value, commit = false) => {
    const lower = input === minInput ? 0 : clampInt(minInput.value, 0, max);
    const upper = input === minInput ? clampInt(maxInput.value, 0, max) : max;
    input.value = String(clampInt(value, lower, upper));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (commit) input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const nearestInput = (value) => {
    const minDistance = Math.abs(value - clampInt(minInput.value, 0, max));
    const maxDistance = Math.abs(value - clampInt(maxInput.value, 0, max));
    return minDistance <= maxDistance ? minInput : maxInput;
  };
  const beginDrag = (input, event) => {
    event.preventDefault();
    wrap.setPointerCapture?.(event.pointerId);
    setInputValue(input, valueFromClientX(event.clientX));
    const move = (moveEvent) => setInputValue(input, valueFromClientX(moveEvent.clientX));
    const finish = (upEvent) => {
      setInputValue(input, valueFromClientX(upEvent.clientX), true);
      wrap.removeEventListener("pointermove", move);
      wrap.removeEventListener("pointerup", finish);
      wrap.removeEventListener("pointercancel", cancel);
    };
    const cancel = () => {
      wrap.removeEventListener("pointermove", move);
      wrap.removeEventListener("pointerup", finish);
      wrap.removeEventListener("pointercancel", cancel);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerup", finish);
    wrap.addEventListener("pointercancel", cancel);
  };
  wrap.addEventListener("pointerdown", (event) => {
    const value = valueFromClientX(event.clientX);
    const input = event.target === minThumb ? minInput : event.target === maxThumb ? maxInput : nearestInput(value);
    beginDrag(input, event);
  });
  const keyHandler = (input) => (event) => {
    const step = event.shiftKey ? 10 : 1;
    const current = clampInt(input.value, 0, max);
    let next = current;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = current - step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = current + step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault();
    setInputValue(input, next, true);
  };
  minThumb.addEventListener("keydown", keyHandler(minInput));
  maxThumb.addEventListener("keydown", keyHandler(maxInput));
}

function rangeInput(label, handle, value, max) {
  const input = document.createElement("input");
  input.type = "range";
  input.className = `gray-range-slider ${handle}`;
  input.min = "0";
  input.max = String(max);
  input.step = "1";
  input.value = String(value);
  input.ariaLabel = label;
  return input;
}

function frameActions(asset) {
  const row = document.createElement("div");
  row.className = "frame-actions";
  const transforms = document.createDocumentFragment();
  transforms.append(
    iconButton("Flip horizontal", "flipH", "icon-btn", () => dispatch({ type: "transform", kind: "flipX" })),
    iconButton("Flip vertical", "flipV", "icon-btn", () => dispatch({ type: "transform", kind: "flipY" })),
  );
  const rotate = iconButton("Rotate 90°", "rotate", "icon-btn", () => dispatch({ type: "transform", kind: "rotate" }));
  rotate.disabled = widthOf(asset) !== heightOf(asset);
  transforms.append(rotate);
  if (!hasPlayback(asset)) {
    row.append(transforms);
    return row;
  }
  const play = iconButton(
    state.playing ? "Pause" : "Play",
    state.playing ? "pause" : "play",
    `icon-btn${state.playing ? " playing" : ""}`,
    () => dispatch({ type: "togglePlay" }),
  );
  play.dataset.playBtn = "true";
  const fps = document.createElement("div");
  fps.className = "stepper small";
  const fpsInput = document.createElement("input");
  fpsInput.className = "step-value";
  fpsInput.type = "number";
  fpsInput.min = String(MIN_FPS);
  fpsInput.max = String(MAX_FPS);
  fpsInput.step = "1";
  fpsInput.value = String(asset.fps);
  fpsInput.ariaLabel = "Frames per second";
  fpsInput.title = "Frames per second";
  fpsInput.addEventListener("change", () => dispatch({ type: "setFps", fps: fpsInput.value }));
  fps.append(
    iconButton("Slower playback", "minus", "step-btn", () => dispatch({ type: "setFps", fps: asset.fps - 1 })),
    fpsInput,
    iconButton("Faster playback", "plus", "step-btn", () => dispatch({ type: "setFps", fps: asset.fps + 1 })),
  );
  const onion = iconButton(
    state.onion ? "Onion skin on" : "Onion skin",
    "onion",
    `icon-btn${state.onion ? " playing" : ""}`,
    () => dispatch({ type: "toggleOnion" }),
  );
  const tween = iconButton(
    "Tween: fill blank frames between this and the next drawn frame",
    "tween",
    "icon-btn",
    () => dispatch({ type: "tween" }),
  );
  const divider = document.createElement("span");
  divider.className = "action-divider";
  row.append(play, fps, onion, tween, divider, transforms);
  return row;
}

function colorRow(asset) {
  const row = document.createElement("div");
  row.className = "color-row";
  if (asset.type === "cube") {
    const chip = button("", `gray-chip gray-chip-btn${state.color !== Pixel.Transparent ? " active" : ""}`, () =>
      dispatch({ type: "setColor", color: grayPixel(state.grayMin) }));
    chip.title = "Gray paint";
    chip.ariaLabel = "Gray paint";
    const paintColor = state.color === Pixel.Transparent ? grayPixel(state.grayMin) : state.color;
    chip.style.background = cssForPixel(paintColor);
    row.append(chip, colorButton("Transparent", "clear", Pixel.Transparent));
  } else {
    row.append(
      colorButton("Black", "black", Pixel.Black),
      colorButton("White", "white", Pixel.White),
      colorButton("Transparent", "clear", Pixel.Transparent),
    );
  }
  return row;
}

function tileRow(asset) {
  const row = document.createElement("div");
  row.className = "tile-row";
  const noun = cellNoun(asset);
  cellsOf(asset).forEach((_cells, index) => {
    const hidden = !layerVisible(asset, index);
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = `tile-thumb${index === state.activeTile ? " active" : ""}${hidden ? " hidden-layer" : ""}`;
    thumb.ariaLabel = `${noun} ${index + 1}`;
    thumb.addEventListener("click", () => dispatch({ type: "selectTile", index }));
    const canvas = document.createElement("canvas");
    canvas.width = widthOf(asset);
    canvas.height = heightOf(asset);
    canvas.dataset.tileThumb = String(index);
    const tileIndex = document.createElement("span");
    tileIndex.className = "tile-index";
    tileIndex.textContent = String(index + 1).padStart(2, "0");
    thumb.append(canvas, tileIndex);
    if (asset.type === "blockset") {
      const eye = document.createElement("span");
      eye.className = "layer-eye";
      eye.role = "button";
      eye.tabIndex = 0;
      eye.title = hidden ? "Show layer" : "Hide layer";
      eye.ariaLabel = eye.title;
      eye.innerHTML = hidden ? ICONS.eyeOff : ICONS.eye;
      eye.addEventListener("click", (event) => {
        event.stopPropagation();
        dispatch({ type: "toggleLayerVisibility", index });
      });
      thumb.append(eye);
    }
    row.append(thumb);
  });
  row.append(iconButton(`Add ${noun}`, "plus", "tile-add", () => dispatch({ type: "addTile" })));
  return row;
}

function tileActions(asset) {
  const row = document.createElement("div");
  row.className = "tile-actions";
  const noun = cellNoun(asset);
  const undo = iconButton("Undo", "undo", "icon-btn", () => dispatch({ type: "undo" }));
  undo.disabled = state.history.past.length === 0;
  const redo = iconButton("Redo", "redo", "icon-btn", () => dispatch({ type: "redo" }));
  redo.disabled = state.history.future.length === 0;
  const moveLeft = iconButton(`Move ${noun} left`, "back", "icon-btn", () => dispatch({ type: "moveTile", dir: -1 }));
  moveLeft.disabled = state.activeTile === 0;
  const moveRight = iconButton(`Move ${noun} right`, "forward", "icon-btn", () => dispatch({ type: "moveTile", dir: 1 }));
  moveRight.disabled = state.activeTile >= cellsOf(asset).length - 1;
  const divider = document.createElement("span");
  divider.className = "action-divider";
  const divider2 = document.createElement("span");
  divider2.className = "action-divider";
  row.append(
    undo,
    redo,
    divider,
    moveLeft,
    moveRight,
    divider2,
    iconButton(`Duplicate ${noun}`, "duplicate", "icon-btn", () => dispatch({ type: "duplicateTile" })),
    iconButton(`Remove ${noun}`, "trash", "icon-btn danger", () => dispatch({ type: "removeTile" })),
  );
  return row;
}

function button(label, className, onClick) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.textContent = label;
  el.addEventListener("click", onClick);
  return el;
}

function toggleButton(label, iconName, active, onClick) {
  return iconButton(label, iconName, `tool-btn${active ? " active" : ""}`, onClick);
}

function iconButton(label, iconName, className, onClick) {
  const el = button("", className, onClick);
  el.innerHTML = ICONS[iconName];
  el.ariaLabel = label;
  el.title = label;
  return el;
}

function iconTextButton(label, iconName, className, onClick) {
  const el = button("", className, onClick);
  el.innerHTML = `${ICONS[iconName]}<span>${escapeHtml(label)}</span>`;
  el.ariaLabel = label;
  return el;
}

function colorButton(label, swatch, color) {
  const el = button("", `color-btn${state.color === color ? " active" : ""}`, () => {
    dispatch({ type: "setColor", color });
  });
  el.innerHTML = `<span class="swatch ${swatch}" aria-hidden="true"></span>`;
  el.ariaLabel = label;
  return el;
}

/* ---------- Canvas input ---------- */

function onCanvasPointerDown(event) {
  if (event.pointerType === "pen") {
    noteCanvasPenInput();
    cancelCanvasTouchForPen();
  }
  if (event.pointerType === "touch" && state.pointerDown && activeCanvasPointerType !== "touch") {
    event.preventDefault();
    return;
  }
  if (event.pointerType !== "touch" && canvasTouchGesture.mode !== "idle") {
    event.preventDefault();
    return;
  }
  if (event.pointerType === "touch" && canvasUsesTouchGestures(event.currentTarget)) {
    onCanvasTouchPointerDown(event);
    return;
  }
  beginCanvasPointerDown(event);
}

function onCanvasPointerMove(event) {
  if (event.pointerType === "pen"
    && (event.pointerId === activeCanvasPointerId || event.buttons > 0 || event.pressure > 0)) {
    noteCanvasPenInput();
  }
  if (event.pointerType === "touch" && canvasTouchGesture.mode !== "idle") {
    onCanvasTouchPointerMove(event);
    return;
  }
  moveCanvasPointer(event);
}

function onCanvasPointerUp(event) {
  if (event.pointerType === "pen") noteCanvasPenInput();
  if (event.pointerType === "touch" && canvasTouchGesture.mode !== "idle") {
    onCanvasTouchPointerUp(event);
    return;
  }
  finishCanvasPointer(event);
}

function onCanvasPointerCancel(event) {
  if (event.pointerType === "pen") noteCanvasPenInput();
  if (event.pointerType === "touch" && canvasTouchGesture.mode !== "idle") {
    onCanvasTouchPointerCancel(event);
    return;
  }
  if (state.pointerDown && event.pointerId === activeCanvasPointerId) {
    resetActiveCanvasPointer();
    render();
  }
}

function canvasUsesTouchGestures(canvas) {
  const asset = activeAsset();
  return !!asset
    && canvas instanceof Element
    && !!canvas.closest(".canvas-area");
}

function noteCanvasPenInput() {
  penPalmRejectionUntil = Date.now() + PEN_PALM_REJECTION_MS;
}

function cancelCanvasTouchForPen() {
  if (canvasTouchGesture.mode === "drawing") rollbackCanvasTouchDrawing();
  else if (activeCanvasPointerType === "touch") resetActiveCanvasPointer();
  resetCanvasTouchGesture();
}

function canvasPointerSnapshot(event) {
  return {
    button: event.button === 2 ? 2 : 0,
    clientX: event.clientX,
    clientY: event.clientY,
    currentTarget: event.currentTarget,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
  };
}

function touchCentroid() {
  if (!canvasTouchGesture.pointers.size) return null;
  let x = 0;
  let y = 0;
  for (const point of canvasTouchGesture.pointers.values()) {
    x += point.x;
    y += point.y;
  }
  return {
    x: x / canvasTouchGesture.pointers.size,
    y: y / canvasTouchGesture.pointers.size,
  };
}

function resetCanvasTouchGesture() {
  canvasTouchGesture.mode = "idle";
  canvasTouchGesture.pointers.clear();
  canvasTouchGesture.primaryId = null;
  canvasTouchGesture.startEvent = null;
  canvasTouchGesture.lastCentroid = null;
  canvasTouchGesture.area = null;
  canvasTouchGesture.rollback = null;
  canvasTouchGesture.blockDrawing = false;
}

function captureCanvasTouchRollback() {
  const asset = activeAsset();
  return {
    assetId: asset?.id || null,
    assetUpdatedAt: asset?.updatedAt,
    assetSnapshot: null,
    activeTile: state.activeTile,
    historyPast: [...state.history.past],
    historyFuture: [...state.history.future],
    selection: state.selection ? { ...state.selection } : null,
  };
}

function beginCanvasTouchDrawing(moveEvent = null) {
  const rollback = captureCanvasTouchRollback();
  const previousHistory = rollback.historyPast[rollback.historyPast.length - 1];
  canvasTouchGesture.mode = "drawing";
  beginCanvasPointerDown(canvasTouchGesture.startEvent);
  const currentHistory = state.history.past[state.history.past.length - 1];
  if (currentHistory && currentHistory !== previousHistory) {
    rollback.assetSnapshot = currentHistory;
  }
  canvasTouchGesture.rollback = rollback;
  if (moveEvent && state.pointerDown) moveCanvasPointer(moveEvent);
}

function rollbackCanvasTouchDrawing() {
  const rollback = canvasTouchGesture.rollback;
  const asset = rollback?.assetId
    ? state.assets.find((item) => item.id === rollback.assetId)
    : null;
  if (asset && rollback.assetSnapshot) {
    restoreSnapshot(asset, rollback.assetSnapshot);
    asset.updatedAt = rollback.assetUpdatedAt;
    saveAssets();
  }
  if (rollback) {
    state.activeTile = rollback.activeTile;
    state.history.past = rollback.historyPast;
    state.history.future = rollback.historyFuture;
    state.selection = rollback.selection;
  }
  resetActiveCanvasPointer();
  canvasTouchGesture.rollback = null;
  drawCanvases();
}

function beginCanvasTouchPan(canvas) {
  canvasTouchGesture.mode = "panning";
  canvasTouchGesture.area = canvas.closest(".canvas-area");
  canvasTouchGesture.lastCentroid = touchCentroid();
}

function onCanvasTouchPointerDown(event) {
  event.preventDefault();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  canvasTouchGesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (canvasTouchGesture.mode === "panning") {
    canvasTouchGesture.lastCentroid = touchCentroid();
    return;
  }

  if (canvasTouchGesture.mode === "idle") {
    canvasTouchGesture.mode = "pending";
    canvasTouchGesture.primaryId = event.pointerId;
    canvasTouchGesture.startEvent = canvasPointerSnapshot(event);
    canvasTouchGesture.blockDrawing = Date.now() < penPalmRejectionUntil;
    return;
  }

  if (canvasTouchGesture.pointers.size >= 2
    && (canvasTouchGesture.mode === "pending" || canvasTouchGesture.mode === "drawing")) {
    if (canvasTouchGesture.mode === "drawing") rollbackCanvasTouchDrawing();
    beginCanvasTouchPan(event.currentTarget);
  }
}

function onCanvasTouchPointerMove(event) {
  const point = canvasTouchGesture.pointers.get(event.pointerId);
  if (!point) return;
  event.preventDefault();
  point.x = event.clientX;
  point.y = event.clientY;

  if (canvasTouchGesture.mode === "panning") {
    const centroid = touchCentroid();
    const previous = canvasTouchGesture.lastCentroid;
    const area = canvasTouchGesture.area;
    if (area && centroid && previous) {
      area.scrollLeft -= centroid.x - previous.x;
      area.scrollTop -= centroid.y - previous.y;
    }
    canvasTouchGesture.lastCentroid = centroid;
    return;
  }

  if (event.pointerId !== canvasTouchGesture.primaryId) return;
  if (canvasTouchGesture.mode === "pending") {
    const start = canvasTouchGesture.startEvent;
    const distance = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
    // Fill is a tap operation that rebuilds the DOM immediately; keep it
    // pending until release so a second finger can always claim the gesture.
    if (canvasTouchGesture.blockDrawing
      || distance < TOUCH_DRAW_THRESHOLD_PX
      || state.tool === "fill") return;
    beginCanvasTouchDrawing(event);
    return;
  }
  if (canvasTouchGesture.mode === "drawing") moveCanvasPointer(event);
}

function onCanvasTouchPointerUp(event) {
  event.preventDefault();
  if (canvasTouchGesture.mode === "panning") {
    canvasTouchGesture.pointers.delete(event.pointerId);
    if (!canvasTouchGesture.pointers.size) resetCanvasTouchGesture();
    else canvasTouchGesture.lastCentroid = touchCentroid();
    return;
  }

  if (event.pointerId !== canvasTouchGesture.primaryId) {
    canvasTouchGesture.pointers.delete(event.pointerId);
    return;
  }

  if (canvasTouchGesture.mode === "pending") {
    const startEvent = canvasTouchGesture.startEvent;
    const blockDrawing = canvasTouchGesture.blockDrawing;
    resetCanvasTouchGesture();
    if (blockDrawing) return;
    beginCanvasPointerDown(startEvent, false);
    if (state.pointerDown) finishCanvasPointer(event);
    return;
  }

  if (canvasTouchGesture.mode === "drawing") {
    canvasTouchGesture.pointers.delete(event.pointerId);
    finishCanvasPointer(event);
    resetCanvasTouchGesture();
  }
}

function onCanvasTouchPointerCancel(event) {
  event.preventDefault();
  if (canvasTouchGesture.mode === "panning") {
    canvasTouchGesture.pointers.delete(event.pointerId);
    if (!canvasTouchGesture.pointers.size) {
      resetCanvasTouchGesture();
    } else {
      if (event.pointerId === canvasTouchGesture.primaryId) {
        canvasTouchGesture.primaryId = canvasTouchGesture.pointers.keys().next().value;
      }
      canvasTouchGesture.lastCentroid = touchCentroid();
    }
    return;
  }
  if (canvasTouchGesture.mode === "drawing") rollbackCanvasTouchDrawing();
  canvasTouchGesture.pointers.delete(event.pointerId);
  if (!canvasTouchGesture.pointers.size || event.pointerId === canvasTouchGesture.primaryId) {
    resetCanvasTouchGesture();
  } else if (canvasTouchGesture.mode === "panning") {
    canvasTouchGesture.lastCentroid = touchCentroid();
  }
}

function onCanvasWheel(event) {
  if (event.ctrlKey || state.zoom <= 1) return;
  const area = event.currentTarget;
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? Math.max(area.clientWidth, area.clientHeight)
      : 1;
  let dx = event.deltaX * unit;
  let dy = event.deltaY * unit;
  if (event.shiftKey && Math.abs(dx) < 0.001) {
    dx = dy;
    dy = 0;
  }
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
  event.preventDefault();
  area.scrollLeft += dx;
  area.scrollTop += dy;
}

function beginCanvasPointerDown(event, capture = true) {
  if (state.pointerDown) return;
  if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 2) return;
  const asset = activeAsset();
  const cell = cellFromEvent(event);
  if (!asset || !cell) return;
  if (state.playing) stopPlayback();
  state.eraseStroke = event.button === 2;
  if (state.tool === "fill") {
    fillAt(cell.x, cell.y);
    state.eraseStroke = false;
    state.lastPaintCell = null;
    state.strokePath = [];
    state.strokeBase = null;
    render();
    return;
  }
  if (capture) event.currentTarget.setPointerCapture?.(event.pointerId);
  activeCanvasPointerId = event.pointerId;
  activeCanvasPointerType = event.pointerType;
  state.pointerDown = true;
  if (state.tool === "select") {
    const clamped = clampCell(asset, cell);
    state.dragStart = clamped;
    if (insideSelection(clamped)) {
      state.selectDrag = "move";
      state.moveOffset = { dx: 0, dy: 0 };
    } else {
      state.selectDrag = "marquee";
      state.selection = { x: clamped.x, y: clamped.y, w: 1, h: 1 };
    }
    drawCanvases();
    return;
  }
  state.dragStart = cell;
  if (PEN_TOOLS.includes(state.tool)) {
    pushHistory();
    if (usesStrokeGradient(asset)) {
      beginGradientStroke(asset, cell);
    } else {
      paintAt(cell.x, cell.y);
      state.strokePath = [];
      state.strokeBase = null;
    }
    state.lastPaintCell = cell;
    drawCanvases();
  } else {
    state.lastPaintCell = null;
    state.strokePath = [];
    state.strokeBase = null;
    drawCanvases(cell);
  }
}

function moveCanvasPointer(event) {
  if (!state.pointerDown || event.pointerId !== activeCanvasPointerId) return;
  const asset = activeAsset();
  const cell = cellFromEvent(event);
  if (!asset || !cell) return;
  if (state.tool === "select") {
    const clamped = clampCell(asset, cell);
    if (state.selectDrag === "marquee") {
      state.selection = rectFromPoints(state.dragStart, clamped);
    } else if (state.selectDrag === "move") {
      state.moveOffset = { dx: clamped.x - state.dragStart.x, dy: clamped.y - state.dragStart.y };
    }
    drawCanvases();
    return;
  }
  if (PEN_TOOLS.includes(state.tool)) {
    if (state.strokeBase) extendGradientStroke(cell);
    else paintStrokeBetween(state.lastPaintCell || cell, cell);
    state.lastPaintCell = cell;
    drawCanvases();
  } else {
    drawCanvases(cell);
  }
}

function finishCanvasPointer(event) {
  if (!state.pointerDown || event.pointerId !== activeCanvasPointerId) return;
  const cell = cellFromEvent(event) || state.dragStart;
  state.pointerDown = false;
  activeCanvasPointerId = null;
  activeCanvasPointerType = null;
  if (state.tool === "select") {
    if (state.selectDrag === "move") commitSelectionMove();
    state.selectDrag = null;
    state.moveOffset = null;
    state.dragStart = null;
    state.eraseStroke = false;
    state.lastPaintCell = null;
    state.strokePath = [];
    state.strokeBase = null;
    render();
    return;
  }
  if (PEN_TOOLS.includes(state.tool)) {
    if (state.strokeBase) {
      extendGradientStroke(cell);
    } else if (state.lastPaintCell && cell && (state.lastPaintCell.x !== cell.x || state.lastPaintCell.y !== cell.y)) {
      paintStrokeBetween(state.lastPaintCell, cell);
    }
    state.dragStart = null;
    state.eraseStroke = false;
    state.lastPaintCell = null;
    state.strokePath = [];
    state.strokeBase = null;
    render();
    return;
  }
  if (DRAG_TOOLS.includes(state.tool) && state.dragStart && cell) {
    dispatch({ type: "commitShape", from: state.dragStart, to: cell });
  } else {
    state.dragStart = null;
    state.eraseStroke = false;
    state.lastPaintCell = null;
    state.strokePath = [];
    state.strokeBase = null;
    render();
    return;
  }
  state.dragStart = null;
  state.eraseStroke = false;
  state.lastPaintCell = null;
  state.strokePath = [];
  state.strokeBase = null;
}

function resetActiveCanvasPointer() {
  state.pointerDown = false;
  activeCanvasPointerId = null;
  activeCanvasPointerType = null;
  state.selectDrag = null;
  state.moveOffset = null;
  state.dragStart = null;
  state.eraseStroke = false;
  state.lastPaintCell = null;
  state.strokePath = [];
  state.strokeBase = null;
}

function cellFromEvent(event) {
  const asset = activeAsset();
  if (!asset) return null;
  const margin = wrapMarginOf(asset);
  const width = widthOf(asset) + 2 * margin.x;
  const height = heightOf(asset) + 2 * margin.y;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * width) - margin.x;
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * height) - margin.y;
  if (x < -margin.x || y < -margin.y || x >= widthOf(asset) + margin.x || y >= heightOf(asset) + margin.y) return null;
  return { x, y };
}

function paintScopeFor(asset) {
  const scope = validPaintScope(state.paintScope);
  if (scope === "visible" && asset.type !== "blockset") return "active";
  if ((scope === "z" || scope === "zsoft") && !hasPlayback(asset)) return "active";
  if (state.allFrames && hasPlayback(asset)) return "all";
  return scope;
}

// Targets for paint operations. Soft Z targets carry a weight so strokes can
// fade into neighboring frames without changing the rest of the pipeline.
function targetPaintTargets(asset) {
  const layers = cellsOf(asset);
  const activeIndex = Math.max(0, Math.min(state.activeTile, layers.length - 1));
  const active = layers[activeIndex];
  if (!active) return [];
  const scope = paintScopeFor(asset);
  if (scope === "all") {
    return layers.map((cells, index) => ({ cells, index, weight: 1 }));
  }
  if (scope === "visible") {
    return layers
      .map((cells, index) => ({ cells, index, weight: 1 }))
      .filter((target) => layerVisible(asset, target.index));
  }
  if (scope === "z" || scope === "zsoft") {
    const radius = clampInt(state.zBrushRadius, 0, Math.min(MAX_Z_BRUSH_RADIUS, layers.length - 1));
    const softMode = asset.type === "cube" ? validZFalloffMode(state.zFalloffMode) : "coverage";
    const targets = new Map();
    for (let dz = -radius; dz <= radius; dz += 1) {
      const index = (activeIndex + dz + layers.length) % layers.length;
      const distance = Math.abs(dz);
      const weight = scope === "zsoft" && radius > 0 ? 1 - distance / (radius + 1) : 1;
      const current = targets.get(index);
      if (!current || weight > current.weight) {
        targets.set(index, { cells: layers[index], index, weight, soft: scope === "zsoft", softMode });
      }
    }
    return [...targets.values()].sort((a, b) => Math.abs(a.index - activeIndex) - Math.abs(b.index - activeIndex));
  }
  return [{ cells: active, index: activeIndex, weight: 1 }];
}

// Cell arrays a paint/transform operation applies to.
function targetCells(asset) {
  return targetPaintTargets(asset).map((target) => target.cells);
}

function paintAt(x, y) {
  const asset = activeAsset();
  if (!asset) return;
  const width = widthOf(asset);
  const height = heightOf(asset);
  paintPoint(asset, width, height, targetPaintTargets(asset), x, y, pointGradient(x, y));
  touch(asset);
}

function paintStrokeBetween(from, to, gradient = null) {
  const asset = activeAsset();
  if (!asset || !from || !to) return;
  const width = widthOf(asset);
  const height = heightOf(asset);
  const targets = targetPaintTargets(asset);
  paintStrokeSegment(asset, width, height, targets, from, to, gradient || strokeGradient(from, to), motionVector(from, to));
  touch(asset);
}

function paintStrokeSegment(asset, width, height, targets, from, to, gradient = null, motion = null) {
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    paintPoint(asset, width, height, targets, x0, y0, gradient, motion);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function paintPoint(asset, width, height, targets, x, y, gradient = null, motion = null) {
  for (const target of targets) {
    penStamp(target.cells, width, height, x, y, asset, target, gradient, motion);
  }
}

function usesStrokeGradient(asset) {
  return (
    asset?.type === "cube"
    && usesGradientRangeMode()
    && !state.eraseStroke
    && state.color !== Pixel.Transparent
    && ["pen", "dither", "spray", "noise"].includes(state.tool)
  );
}

function beginGradientStroke(asset, cell) {
  const targets = targetPaintTargets(asset);
  state.strokeBase = {
    assetId: asset.id,
    targets: targets.map((target) => ({ index: target.index, cells: [...target.cells] })),
  };
  state.strokePath = [cell];
  repaintGradientStroke(cell);
}

function extendGradientStroke(cell) {
  const last = state.strokePath[state.strokePath.length - 1];
  if (!last || last.x !== cell.x || last.y !== cell.y) state.strokePath.push(cell);
  repaintGradientStroke(cell);
}

function repaintGradientStroke(end) {
  const asset = activeAsset();
  if (!asset || !state.strokeBase || state.strokeBase.assetId !== asset.id || !state.strokePath.length) return;
  restoreStrokeBase(asset);
  const width = widthOf(asset);
  const height = heightOf(asset);
  const targets = targetPaintTargets(asset);
  const gradient = strokeGradient(state.strokePath[0], end);
  if (state.strokePath.length === 1) {
    paintPoint(asset, width, height, targets, end.x, end.y, gradient);
  } else {
    for (let i = 1; i < state.strokePath.length; i += 1) {
      paintStrokeSegment(asset, width, height, targets, state.strokePath[i - 1], state.strokePath[i], gradient);
    }
  }
  touch(asset);
}

function restoreStrokeBase(asset) {
  const layers = cellsOf(asset);
  for (const snapshot of state.strokeBase.targets) {
    const target = layers[snapshot.index];
    if (!target) continue;
    for (let i = 0; i < target.length; i += 1) target[i] = snapshot.cells[i];
  }
}

function strokeGradient(from, to) {
  return usesGradientRangeMode() ? { from, to } : null;
}

function pointGradient(x, y) {
  return usesGradientRangeMode()
    ? { from: { x, y }, to: { x, y } }
    : null;
}

function usesGradientRangeMode() {
  return (
    (state.grayScale === "range" && state.grayMode === "gradient")
    || (state.opacityScale === "range" && state.opacityMode === "gradient")
  );
}

function motionVector(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return { dx: 0, dy: 0 };
  return {
    dx: dx / length,
    dy: dy / length,
  };
}

function penStamp(cells, width, height, x, y, asset, target, gradient = null, motion = null) {
  const wrap = wraps(asset);
  switch (state.tool) {
    case "pen":
      stampBrush(cells, width, height, x, y, wrap, asset, target, "solid", gradient);
      break;
    case "dither":
      stampBrush(cells, width, height, x, y, wrap, asset, target, "dither", gradient);
      break;
    case "spray":
      sprayStamp(cells, width, height, x, y, wrap, asset, target, gradient);
      break;
    case "noise":
      stampBrush(cells, width, height, x, y, wrap, asset, target, "noise", gradient);
      break;
    case "blur":
      blurStamp(cells, width, height, x, y, wrap, asset, target);
      break;
    case "displace":
      displaceStamp(cells, width, height, x, y, wrap, motion, target);
      break;
    default:
      break;
  }
}

function stampBrush(cells, width, height, x, y, wrap, asset, target, mode = "solid", gradient = null) {
  forBrushCells(x, y, width, height, wrap, (px, py, index, brush) => {
    if (mode === "dither" && BAYER4[((py % 4) + 4) % 4][((px % 4) + 4) % 4] >= state.ditherLevel) return;
    const current = cells[index];
    cells[index] = strokePixelForCell(asset, px, py, width, height, target, current, {
      noise: mode === "noise",
      gradient,
      brush,
    });
  });
}

function sprayStamp(cells, width, height, x, y, wrap, asset, target, gradient = null) {
  const radius = Math.max(2, state.brushSize * 2);
  const count = Math.min(192, Math.max(8, state.brushSize * state.brushSize * 2));
  for (let i = 0; i < count; i += 1) {
    if (Math.random() > 0.58) continue;
    const px = x + randomInt(-radius, radius);
    const py = y + randomInt(-radius, radius);
    putBrushPixel(cells, width, height, px, py, wrap, asset, target, "solid", gradient);
  }
}

function blurStamp(cells, width, height, x, y, wrap, asset, target) {
  const snapshot = [...cells];
  forBrushCells(x, y, width, height, wrap, (px, py, index) => {
    cells[index] = blurredPixel(snapshot, width, height, px, py, wrap, asset, target, cells[index]);
  });
}

function displaceStamp(cells, width, height, x, y, wrap, motion, target) {
  if (!motion || (!motion.dx && !motion.dy)) return;
  const snapshot = [...cells];
  const maxShift = Math.max(1, Math.round(clampBrushSize(state.brushSize) / 16));
  const strength = targetStrength(target);
  forBrushCells(x, y, width, height, wrap, (px, py, index, brush) => {
    if (!targetPixelPass(target, px, py)) return;
    const falloff = Math.max(0, 1 - (brush?.distance ?? 0));
    const shiftX = Math.round(motion.dx * maxShift * falloff * strength);
    const shiftY = Math.round(motion.dy * maxShift * falloff * strength);
    if (!shiftX && !shiftY) return;
    const sx = px - shiftX;
    const sy = py - shiftY;
    if (!wrap && (sx < 0 || sy < 0 || sx >= width || sy >= height)) return;
    cells[index] = snapshot[indexWrapped(sx, sy, width, height)];
  });
}

function putBrushPixel(cells, width, height, x, y, wrap, asset, target, mode = "solid", gradient = null) {
  if (!wrap && (x < 0 || y < 0 || x >= width || y >= height)) return;
  const index = indexWrapped(x, y, width, height);
  const px = ((x % width) + width) % width;
  const py = ((y % height) + height) % height;
  cells[index] = strokePixelForCell(asset, px, py, width, height, target, cells[index], {
    noise: mode === "noise",
    gradient,
  });
}

function forBrushCells(x, y, width, height, wrap, visit) {
  const size = clampBrushSize(state.brushSize);
  const start = -Math.floor(size / 2);
  const round = state.brushShape === "round";
  const center = start + (size - 1) / 2;
  const radius = Math.max(0.5, size / 2);
  const radiusSq = radius * radius;
  const squareRadius = Math.max(0.5, Math.floor(size / 2));
  const seen = new Set();
  for (let by = 0; by < size; by += 1) {
    for (let bx = 0; bx < size; bx += 1) {
      const dx = start + bx - center;
      const dy = start + by - center;
      if (round) {
        if (dx * dx + dy * dy > radiusSq) continue;
      }
      const px = x + start + bx;
      const py = y + start + by;
      if (!wrap && (px < 0 || py < 0 || px >= width || py >= height)) continue;
      const index = indexWrapped(px, py, width, height);
      if (seen.has(index)) continue;
      seen.add(index);
      const distance = round
        ? Math.min(1, Math.sqrt(dx * dx + dy * dy) / radius)
        : Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) / squareRadius);
      visit(index % width, Math.floor(index / width), index, { distance });
    }
  }
}

function strokePixelForCell(asset, x, y, width, height, target, current, options = {}) {
  if (state.eraseStroke || state.color === Pixel.Transparent) {
    return targetPixelPass(target, x, y) ? Pixel.Transparent : current;
  }
  if (asset.type !== "cube") {
    if (!targetPixelPass(target, x, y)) return current;
    if (options.noise) return Math.random() < 0.5 ? Pixel.Black : Pixel.White;
    return normalizePixel(state.color);
  }
  const range = grayRange();
  const grayMode = options.forceGradient ? "gradient" : activeRangeMode(state.grayMode, state.grayScale);
  const opacityMode = options.forceOpacityGradient ? "gradient" : activeRangeMode(state.opacityMode, state.opacityScale);
  const level = options.noise
    ? randomInt(range.min, range.max)
    : rangedValue(grayMode, range.min, range.max, x, y, width, height, options);
  const opacityRange = paintOpacityRange();
  const opacity = targetPaintOpacity(
    target,
    current,
    x,
    y,
    rangedValue(opacityMode, opacityRange.min, opacityRange.max, x, y, width, height, options) / 100,
  );
  return applyPaintOpacity(level, current, opacity, {
    transparentBase: target?.softMode === "blend" ? 255 : null,
  });
}

function rangedValue(mode, min, max, x, y, width, height, options = {}) {
  if (mode === "random") return randomInt(min, max);
  if (mode === "gradient" && options.gradient) {
    return gradientLevelAt(x, y, width, height, options.gradient.from, options.gradient.to, min, max);
  }
  if (mode === "radialOut") {
    return Math.round(min + (max - min) * (options.brush?.distance ?? 0));
  }
  if (mode === "radialIn") {
    return Math.round(min + (max - min) * (1 - (options.brush?.distance ?? 0)));
  }
  return min;
}

function applyPaintOpacity(level, current, opacity, options = {}) {
  if (opacity <= 0) return current;
  if (opacity >= 1) return grayPixel(level);
  if (current === Pixel.Transparent) {
    if (Number.isFinite(options.transparentBase)) {
      return grayPixel(Math.round(options.transparentBase + (level - options.transparentBase) * opacity));
    }
    return grayPixel(level);
  }
  return grayPixel(Math.round(grayLevelOf(current) + (level - grayLevelOf(current)) * opacity));
}

function blurredPixel(snapshot, width, height, x, y, wrap, asset, target, current) {
  if (!targetPixelPass(target, x, y) && (asset.type !== "cube" || current === Pixel.Transparent)) return current;
  if (asset.type === "cube") {
    let sum = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (!wrap && (px < 0 || py < 0 || px >= width || py >= height)) continue;
        const pixel = snapshot[indexWrapped(px, py, width, height)];
        if (pixel === Pixel.Transparent) continue;
        sum += grayLevelOf(pixel);
        count += 1;
      }
    }
    if (!count) return current;
    return grayPixel(blendZLevel(Math.round(sum / count), target, current));
  }
  const counts = new Map();
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const px = x + dx;
      const py = y + dy;
      if (!wrap && (px < 0 || py < 0 || px >= width || py >= height)) continue;
      const pixel = snapshot[indexWrapped(px, py, width, height)];
      counts.set(pixel, (counts.get(pixel) || 0) + 1);
    }
  }
  let best = current;
  let bestCount = -1;
  for (const [pixel, count] of counts.entries()) {
    if (count > bestCount) {
      best = pixel;
      bestCount = count;
    }
  }
  return best;
}

function blendZLevel(level, target, current) {
  const strength = targetStrength(target);
  if (strength >= 0.999) return level;
  const base = current === Pixel.Transparent && target?.softMode === "blend" ? 255 : grayLevelOf(current);
  return Math.round(base + (level - base) * strength);
}

function targetStrength(target) {
  if (!target?.soft) return 1;
  return Math.max(0, Math.min(1, target.weight ?? 1));
}

function targetPixelPass(target, x, y) {
  const strength = targetStrength(target);
  if (strength >= 0.999) return true;
  if (strength <= 0.001) return false;
  const row = ((y + target.index) % 4 + 4) % 4;
  const col = ((x + target.index * 2) % 4 + 4) % 4;
  return BAYER4[row][col] < strength * 16;
}

function targetPaintOpacity(target, current, x, y, opacity) {
  const strength = targetStrength(target);
  if (strength >= 0.999) return opacity;
  if (target?.softMode === "blend") return opacity * strength;
  if (current === Pixel.Transparent) return targetPixelPass(target, x, y) ? opacity : 0;
  return opacity * strength;
}

function grayRange() {
  if (state.grayScale === "single") {
    return { min: clampInt(state.grayMin, 0, 255), max: clampInt(state.grayMin, 0, 255) };
  }
  return {
    min: Math.min(state.grayMin, state.grayMax),
    max: Math.max(state.grayMin, state.grayMax),
  };
}

function paintOpacityRange() {
  if (state.opacityScale === "single") {
    return { min: clampInt(state.opacityMin, 0, 100), max: clampInt(state.opacityMin, 0, 100) };
  }
  return {
    min: Math.min(state.opacityMin, state.opacityMax),
    max: Math.max(state.opacityMin, state.opacityMax),
  };
}

function gradientLevelAt(x, y, width, height, from = null, to = null, min = 0, max = 255) {
  const start = from || { x: 0, y: 0 };
  const end = to || { x: Math.max(1, width - 1), y: 0 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq <= 0
    ? 0
    : Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSq));
  return Math.round(min + (max - min) * t);
}

function fillAt(x, y) {
  const asset = activeAsset();
  if (!asset) return;
  const width = widthOf(asset);
  const height = heightOf(asset);
  pushHistory();
  for (const target of targetPaintTargets(asset)) {
    const index = indexWrapped(x, y, width, height);
    const color = strokePixelForCell(asset, x, y, width, height, target, target.cells[index]);
    floodFill(target.cells, width, height, x, y, color, wraps(asset));
  }
  touch(asset);
}

/* ---------- Selection ---------- */

function clampCell(asset, cell) {
  return {
    x: Math.max(0, Math.min(widthOf(asset) - 1, cell.x)),
    y: Math.max(0, Math.min(heightOf(asset) - 1, cell.y)),
  };
}

function rectFromPoints(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

function insideSelection(cell) {
  const sel = state.selection;
  return sel && cell.x >= sel.x && cell.x < sel.x + sel.w && cell.y >= sel.y && cell.y < sel.y + sel.h;
}

// Copy of `cells` with the selection cleared at its old spot and its
// non-transparent pixels stamped at the offset position.
function movedCells(cells, width, height, sel, dx, dy, wrap) {
  const out = [...cells];
  for (let ry = 0; ry < sel.h; ry += 1) {
    for (let rx = 0; rx < sel.w; rx += 1) {
      out[indexFor(sel.x + rx, sel.y + ry, width)] = Pixel.Transparent;
    }
  }
  for (let ry = 0; ry < sel.h; ry += 1) {
    for (let rx = 0; rx < sel.w; rx += 1) {
      const value = cells[indexFor(sel.x + rx, sel.y + ry, width)];
      if (value === Pixel.Transparent) continue;
      const tx = sel.x + rx + dx;
      const ty = sel.y + ry + dy;
      if (!wrap && (tx < 0 || ty < 0 || tx >= width || ty >= height)) continue;
      out[indexWrapped(tx, ty, width, height)] = value;
    }
  }
  return out;
}

function commitSelectionMove() {
  const asset = activeAsset();
  const cells = activeCells();
  const sel = state.selection;
  const offset = state.moveOffset;
  if (!asset || !cells || !sel || !offset || (!offset.dx && !offset.dy)) return;
  pushHistory();
  const width = widthOf(asset);
  const height = heightOf(asset);
  const moved = movedCells(cells, width, height, sel, offset.dx, offset.dy, wraps(asset));
  for (let i = 0; i < cells.length; i += 1) cells[i] = moved[i];
  const nx = Math.max(0, Math.min(width - 1, sel.x + offset.dx));
  const ny = Math.max(0, Math.min(height - 1, sel.y + offset.dy));
  state.selection = {
    x: nx,
    y: ny,
    w: Math.min(sel.w, width - nx),
    h: Math.min(sel.h, height - ny),
  };
  touch(asset);
}

function copySelection() {
  const asset = activeAsset();
  const cells = activeCells();
  const sel = state.selection;
  if (!asset || !cells || !sel) return;
  const width = widthOf(asset);
  const region = [];
  for (let ry = 0; ry < sel.h; ry += 1) {
    for (let rx = 0; rx < sel.w; rx += 1) {
      region.push(cells[indexFor(sel.x + rx, sel.y + ry, width)]);
    }
  }
  state.clipboard = { w: sel.w, h: sel.h, cells: region };
  state.flash = `Copied ${sel.w}x${sel.h}`;
  render();
}

function cutSelection() {
  const asset = activeAsset();
  if (!asset || !state.selection) return;
  copySelection();
  pushHistory();
  clearSelectionRegion();
  state.flash = `Cut ${state.clipboard.w}x${state.clipboard.h}`;
  touch(asset);
  render();
}

function deleteSelection() {
  const asset = activeAsset();
  if (!asset || !state.selection) return;
  pushHistory();
  clearSelectionRegion();
  touch(asset);
  render();
}

function clearSelectionRegion() {
  const asset = activeAsset();
  const cells = activeCells();
  const sel = state.selection;
  if (!asset || !cells || !sel) return;
  const width = widthOf(asset);
  for (let ry = 0; ry < sel.h; ry += 1) {
    for (let rx = 0; rx < sel.w; rx += 1) {
      cells[indexFor(sel.x + rx, sel.y + ry, width)] = Pixel.Transparent;
    }
  }
}

function pasteClipboard() {
  const asset = activeAsset();
  const cells = activeCells();
  const clip = state.clipboard;
  if (!asset || !cells || !clip) return;
  pushHistory();
  const width = widthOf(asset);
  const height = heightOf(asset);
  const ox = state.selection ? state.selection.x : 0;
  const oy = state.selection ? state.selection.y : 0;
  for (let ry = 0; ry < clip.h; ry += 1) {
    for (let rx = 0; rx < clip.w; rx += 1) {
      const value = clip.cells[ry * clip.w + rx];
      if (value === Pixel.Transparent) continue;
      const tx = ox + rx;
      const ty = oy + ry;
      if (wraps(asset)) {
        cells[indexWrapped(tx, ty, width, height)] = value;
      } else if (tx < width && ty < height) {
        cells[indexFor(tx, ty, width)] = value;
      }
    }
  }
  state.selection = {
    x: ox,
    y: oy,
    w: Math.min(clip.w, width - ox),
    h: Math.min(clip.h, height - oy),
  };
  state.flash = "Pasted";
  touch(asset);
  render();
}

function floodFill(cells, width, height, x, y, color, wrap) {
  const startIndex = indexWrapped(x, y, width, height);
  const target = cells[startIndex];
  if (target === color) return;
  const stack = [startIndex];
  while (stack.length) {
    const index = stack.pop();
    if (cells[index] !== target) continue;
    cells[index] = color;
    const cx = index % width;
    const cy = Math.floor(index / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!wrap && (nx < 0 || ny < 0 || nx >= width || ny >= height)) continue;
      const next = indexWrapped(nx, ny, width, height);
      if (cells[next] === target) stack.push(next);
    }
  }
}

function shiftCells(cells, width, height, dx, dy, wrap) {
  const out = blankGrid(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - dx;
      const sy = y - dy;
      if (!wrap && (sx < 0 || sy < 0 || sx >= width || sy >= height)) continue;
      out[indexFor(x, y, width)] = cells[indexWrapped(sx, sy, width, height)];
    }
  }
  return out;
}

function commitShape({ from, to }) {
  const asset = activeAsset();
  if (!asset || !from || !to) return;
  const targets = targetPaintTargets(asset);
  if (!targets.length) return;
  pushHistory();
  const width = widthOf(asset);
  const height = heightOf(asset);
  for (const target of targets) {
    const cells = target.cells;
    if (state.tool === "line") drawLine(cells, width, height, from.x, from.y, to.x, to.y, asset, target);
    if (state.tool === "square") drawSquare(cells, width, height, from.x, from.y, to.x, to.y, asset, target);
    if (state.tool === "gradient") drawGradient(cells, width, height, from, to, asset, target);
    if (state.tool === "shift") {
      const shifted = shiftCells(cells, width, height, to.x - from.x, to.y - from.y, wraps(asset));
      for (let i = 0; i < cells.length; i += 1) cells[i] = shifted[i];
    }
  }
  touch(asset);
}

function drawLine(cells, width, height, x0, y0, x1, y1, assetOrColor, target = null) {
  const asset = assetOrColor && typeof assetOrColor === "object" ? assetOrColor : null;
  const color = asset ? null : assetOrColor;
  const wrap = asset ? wraps(asset) : true;
  const gradient = asset ? strokeGradient({ x: x0, y: y0 }, { x: x1, y: y1 }) : null;
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    if (asset) {
      stampBrush(cells, width, height, x0, y0, wrap, asset, target, "solid", gradient);
    } else {
      cells[indexWrapped(x0, y0, width, height)] = color;
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function drawSquare(cells, width, height, x0, y0, x1, y1, assetOrColor, target = null) {
  const asset = assetOrColor && typeof assetOrColor === "object" ? assetOrColor : null;
  const color = asset ? null : assetOrColor;
  const wrap = asset ? wraps(asset) : true;
  const gradient = asset ? strokeGradient({ x: x0, y: y0 }, { x: x1, y: y1 }) : null;
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (!wrap && (x < 0 || y < 0 || x >= width || y >= height)) continue;
      const index = indexWrapped(x, y, width, height);
      cells[index] = asset
        ? strokePixelForCell(asset, index % width, Math.floor(index / width), width, height, target, cells[index], { gradient })
        : color;
    }
  }
}

function drawGradient(cells, width, height, from, to, asset, target) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexFor(x, y, width);
      cells[index] = strokePixelForCell(asset, x, y, width, height, target, cells[index], {
        gradient: { from, to },
        forceGradient: true,
      });
    }
  }
}

/* ---------- Canvas drawing ---------- */

function layoutMainCanvas() {
  const asset = activeAsset();
  const canvas = document.querySelector(".drawing-canvas");
  const area = document.querySelector(".canvas-area");
  if (!asset || !canvas || !area) return;
  const margin = wrapMarginOf(asset);
  const width = widthOf(asset) + 2 * margin.x;
  const height = heightOf(asset) + 2 * margin.y;
  const availWidth = Math.max(60, area.clientWidth - 20);
  const availHeight = Math.max(60, area.clientHeight - 20);
  const fitCellSize = Math.min(availWidth / width, availHeight / height, MAX_CANVAS_CELL_SIZE);
  const cellSize = Math.min(fitCellSize * zoomFactorForAsset(asset), MAX_CANVAS_CELL_SIZE);
  area.classList.toggle("zoomable", canZoomAsset(asset));
  area.classList.toggle("zoomed", canZoomAsset(asset) && state.zoom > 1);
  canvas.style.width = `${Math.floor(width * cellSize)}px`;
  canvas.style.height = `${Math.floor(height * cellSize)}px`;
}

function drawCanvases(previewCell = null) {
  const asset = activeAsset();
  if (asset) {
    const width = widthOf(asset);
    const height = heightOf(asset);
    const main = document.querySelector(".drawing-canvas");
    if (main) {
      if (asset.type === "blockset") {
        const preview = withShapePreview(cellsOf(asset)[state.activeTile], width, height, previewCell);
        drawGrid(main, width, height, compositeCells(asset, preview));
      } else {
        drawGrid(main, width, height, cellsOf(asset)[state.activeTile], previewCell, wrapMarginOf(asset), onionUnderlays(asset));
      }
      if (state.selection) drawSelectionOverlay(main, asset);
    }
    document.querySelectorAll("[data-tile-thumb]").forEach((canvas) => {
      drawGrid(canvas, width, height, cellsOf(asset)[Number(canvas.dataset.tileThumb)]);
    });
    if (asset.type === "particles") {
      document.querySelectorAll("[data-particle-thumb]").forEach((canvas) => {
        const index = Number(canvas.dataset.particleThumb);
        const particle = asset.particles[index];
        if (!particle) return;
        const frameIndex = index === state.activeParticle
          ? Math.min(state.activeTile, particle.frames.length - 1)
          : 0;
        drawPreviewGrid(canvas, particle.width, particle.height, particle.frames[frameIndex]);
      });
    }
  }
  document.querySelectorAll("[data-preview-asset]").forEach((canvas) => {
    const previewAsset = state.assets.find((item) => item.id === canvas.dataset.previewAsset);
    if (!previewAsset) return;
    drawAssetPreview(canvas, previewAsset, 0);
  });
}

function drawAssetPreview(canvas, asset, tick) {
  if (asset.type === "particles") {
    const particle = asset.particles[tick % asset.particles.length];
    const frame = particle.frames[tick % particle.frames.length];
    drawPreviewGrid(canvas, particle.width, particle.height, frame);
    return;
  }
  const frames = cellsOf(asset);
  const frameIndex = hasGalleryAnimation(asset) ? tick % frames.length : 0;
  const frame = frames[frameIndex];
  const cells = asset.type === "blockset" ? compositeCells(asset) : frame;
  if (asset.type === "cube") {
    const tiled = tiledCells(cells, widthOf(asset), heightOf(asset));
    drawPreviewGrid(canvas, tiled.width, tiled.height, tiled.cells);
  } else {
    drawPreviewGrid(canvas, widthOf(asset), heightOf(asset), cells);
  }
}

function drawPreviewGrid(canvas, width, height, cells) {
  if (!cells) return;
  const scale = renderScale(width, height);
  const renderWidth = width * scale;
  const renderHeight = height * scale;
  if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, renderWidth, renderHeight);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = cells[indexFor(x, y, width)];
      if (pixel === Pixel.Transparent) continue;
      ctx.fillStyle = cssForPixel(pixel);
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

function startParticlePreview() {
  stopParticlePreview();
  const asset = activeAsset();
  const canvas = document.querySelector(".particle-preview-canvas");
  if (state.screen !== "editor" || asset?.type !== "particles" || !state.particlePreviewOpen || !canvas) return;
  ensureParticlePreviewInstances(asset);
  particlePreviewSimulation.lastTime = performance.now();
  drawParticlePreview(canvas, asset);
  particlePreviewFrame = requestAnimationFrame(particlePreviewTick);
}

function stopParticlePreview() {
  if (particlePreviewFrame !== null) {
    cancelAnimationFrame(particlePreviewFrame);
    particlePreviewFrame = null;
  }
}

function particlePreviewTick(now) {
  particlePreviewFrame = null;
  const asset = activeAsset();
  const canvas = document.querySelector(".particle-preview-canvas");
  if (state.screen !== "editor" || asset?.type !== "particles" || !state.particlePreviewOpen || !canvas) return;
  ensureParticlePreviewInstances(asset);
  const elapsed = (now - particlePreviewSimulation.lastTime) / 1000;
  const dt = Math.max(0, Math.min(0.05, Number.isFinite(elapsed) ? elapsed : 0));
  particlePreviewSimulation.lastTime = now;
  updateParticlePreview(asset, dt);
  drawParticlePreview(canvas, asset);
  particlePreviewFrame = requestAnimationFrame(particlePreviewTick);
}

function ensureParticlePreviewInstances(asset) {
  const simulation = particlePreviewSimulation;
  if (simulation.assetId !== asset.id) {
    simulation.assetId = asset.id;
    simulation.instances = [];
  }
  const count = clampInt(asset.preview.number, 0, MAX_PARTICLE_PREVIEW_COUNT);
  if (simulation.instances.length > count) simulation.instances.length = count;
  while (simulation.instances.length < count) {
    simulation.instances.push(createParticlePreviewInstance(asset, simulation.instances.length));
  }
  const ids = new Set(asset.particles.map((particle) => particle.id));
  simulation.instances.forEach((instance, index) => {
    if (!ids.has(instance.particleId)) {
      instance.particleId = asset.particles[index % asset.particles.length].id;
    }
  });
}

function resetParticlePreviewChoices(asset) {
  if (particlePreviewSimulation.assetId !== asset.id || !asset.particles.length) return;
  for (const instance of particlePreviewSimulation.instances) {
    const index = Math.floor(nextParticleRandom(instance) * asset.particles.length);
    instance.particleId = asset.particles[index].id;
  }
}

function createParticlePreviewInstance(asset, index) {
  const instance = {
    index,
    randomState: hashString32(`${asset.id}:${index}`) || 0x9e3779b9,
    particleId: asset.particles[0].id,
    x: 0,
    y: 0,
    phase: 0,
    directionFrom: 0,
    directionTo: 0,
    directionPhase: 0,
    directionIndex: 1,
  };
  instance.particleId = asset.particles[Math.floor(nextParticleRandom(instance) * asset.particles.length)].id;
  instance.x = nextParticleRandom(instance) * asset.preview.canvasWidth;
  instance.y = nextParticleRandom(instance) * asset.preview.canvasHeight;
  instance.phase = nextParticleRandom(instance) * 32;
  instance.directionFrom = nextParticleRandom(instance) * Math.PI * 2;
  instance.directionTo = nextParticleRandom(instance) * Math.PI * 2;
  instance.directionPhase = nextParticleRandom(instance);
  return instance;
}

function updateParticlePreview(asset, dt) {
  const config = asset.preview;
  const directionRate = Math.max(0, config.dirChange);
  for (const instance of particlePreviewSimulation.instances) {
    const directionTotal = instance.directionPhase + dt * directionRate;
    const crossings = Math.max(0, Math.floor(directionTotal));
    instance.directionPhase = directionTotal - Math.floor(directionTotal);
    for (let crossing = 0; crossing < crossings; crossing += 1) {
      instance.directionFrom = instance.directionTo;
      instance.directionTo = nextParticleRandom(instance) * Math.PI * 2;
      instance.directionIndex += 1;
    }
    const directionT = instance.directionPhase * instance.directionPhase * (3 - 2 * instance.directionPhase);
    const direction = instance.directionFrom
      + shortestAngle(instance.directionFrom, instance.directionTo) * directionT;
    const velocityX = config.driftX + Math.cos(direction) * config.movement;
    const velocityY = config.driftY + Math.sin(direction) * config.movement;
    instance.x = wrapNumber(instance.x + velocityX * dt, config.canvasWidth);
    instance.y = wrapNumber(instance.y + velocityY * dt, config.canvasHeight);
    instance.phase += dt * asset.fps * config.speed;
  }
}

function resizeParticlePreviewCanvas(canvas, asset) {
  const width = asset.preview.canvasWidth;
  const height = asset.preview.canvasHeight;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function drawParticlePreview(canvas, asset) {
  resizeParticlePreviewCanvas(canvas, asset);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  drawParticlePreviewChecker(ctx, canvas.width, canvas.height);
  for (const instance of particlePreviewSimulation.instances) {
    let particle = asset.particles.find((candidate) => candidate.id === instance.particleId);
    if (!particle) particle = asset.particles[instance.index % asset.particles.length];
    const frameIndex = wrapInteger(Math.floor(instance.phase), particle.frames.length);
    const frame = particle.frames[frameIndex];
    // Snap to whole pixels so each source pixel maps to one canvas pixel:
    // fractional fillRect coordinates get anti-aliased, which reads as blur.
    const left = Math.round(instance.x - particle.width / 2);
    const top = Math.round(instance.y - particle.height / 2);
    for (const offsetY of [-canvas.height, 0, canvas.height]) {
      for (const offsetX of [-canvas.width, 0, canvas.width]) {
        const copyLeft = left + offsetX;
        const copyTop = top + offsetY;
        if (copyLeft >= canvas.width || copyTop >= canvas.height
          || copyLeft + particle.width <= 0 || copyTop + particle.height <= 0) continue;
        drawParticleFrame(ctx, particle, frame, copyLeft, copyTop);
      }
    }
  }
}

function drawParticlePreviewChecker(ctx, width, height) {
  const size = 12;
  ctx.fillStyle = "#d7d5cb";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#c8c6bb";
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if ((x / size + y / size) % 2 === 0) ctx.fillRect(x, y, size, size);
    }
  }
}

function drawParticleFrame(ctx, particle, frame, left, top) {
  for (let y = 0; y < particle.height; y += 1) {
    for (let x = 0; x < particle.width; x += 1) {
      const pixel = frame[indexFor(x, y, particle.width)];
      if (pixel === Pixel.Transparent) continue;
      ctx.fillStyle = cssForPixel(pixel);
      ctx.fillRect(left + x, top + y, 1, 1);
    }
  }
}

function shortestAngle(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function wrapNumber(value, extent) {
  return ((value % extent) + extent) % extent;
}

function wrapInteger(value, extent) {
  return ((value % extent) + extent) % extent;
}

function hashString32(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextParticleRandom(instance) {
  let value = instance.randomState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  instance.randomState = value >>> 0;
  return instance.randomState / 0x100000000;
}

// 2x2 repeat of a cube slice so gallery previews show the seams looping.
function tiledCells(cells, width, height) {
  const outWidth = width * 2;
  const outHeight = height * 2;
  const out = blankGrid(outWidth, outHeight);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      out[indexFor(x, y, outWidth)] = cells[indexFor(x % width, y % height, width)];
    }
  }
  return { width: outWidth, height: outHeight, cells: out };
}

function drawSelectionOverlay(canvas, asset) {
  const sel = state.selection;
  if (!sel) return;
  const margin = wrapMarginOf(asset);
  const scale = renderScale(widthOf(asset), heightOf(asset));
  const dx = state.moveOffset ? state.moveOffset.dx : 0;
  const dy = state.moveOffset ? state.moveOffset.dy : 0;
  const px = (sel.x + dx + margin.x) * scale;
  const py = (sel.y + dy + margin.y) * scale;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.strokeRect(px + 1, py + 1, sel.w * scale - 2, sel.h * scale - 2);
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#121210";
  ctx.strokeRect(px + 1, py + 1, sel.w * scale - 2, sel.h * scale - 2);
  ctx.restore();
}

function compositeCells(asset, activeOverride = null) {
  const out = blankGrid(widthOf(asset), heightOf(asset));
  cellsOf(asset).forEach((layer, index) => {
    if (!layerVisible(asset, index)) return;
    const cells = index === state.activeTile && activeOverride ? activeOverride : layer;
    for (let i = 0; i < out.length; i += 1) {
      if (cells[i] !== Pixel.Transparent) out[i] = cells[i];
    }
  });
  return out;
}

function withShapePreview(cells, width, height, previewCell) {
  if (!cells) return cells;
  if (
    state.tool === "select"
    && state.selectDrag === "move"
    && state.moveOffset
    && state.selection
    && cells === activeCells()
  ) {
    const asset = activeAsset();
    return movedCells(cells, width, height, state.selection, state.moveOffset.dx, state.moveOffset.dy, asset ? wraps(asset) : false);
  }
  if (!previewCell || !state.dragStart || !DRAG_TOOLS.includes(state.tool)) return cells;
  if (state.tool === "shift") {
    const asset = activeAsset();
    return shiftCells(
      cells,
      width,
      height,
      previewCell.x - state.dragStart.x,
      previewCell.y - state.dragStart.y,
      asset ? wraps(asset) : false,
    );
  }
  const copy = [...cells];
  const asset = activeAsset();
  const target = { cells: copy, index: state.activeTile, weight: 1 };
  if (state.tool === "line") {
    drawLine(copy, width, height, state.dragStart.x, state.dragStart.y, previewCell.x, previewCell.y, asset, target);
  } else if (state.tool === "square") {
    drawSquare(copy, width, height, state.dragStart.x, state.dragStart.y, previewCell.x, previewCell.y, asset, target);
  } else if (state.tool === "gradient" && width * height <= 262144) {
    drawGradient(copy, width, height, state.dragStart, previewCell, asset, target);
  }
  return copy;
}

function onionUnderlays(asset) {
  if (!state.onion || !hasPlayback(asset)) return [];
  const frames = cellsOf(asset);
  if (frames.length < 2) return [];
  const prev = (state.activeTile - 1 + frames.length) % frames.length;
  const next = (state.activeTile + 1) % frames.length;
  const underlays = [{ cells: frames[prev], css: ONION_PREV_CSS }];
  if (next !== prev) underlays.push({ cells: frames[next], css: ONION_NEXT_CSS });
  return underlays;
}

function drawGrid(canvas, width, height, cells, previewCell = null, margin = null, underlays = []) {
  if (!cells) return;
  const visible = withShapePreview(cells, width, height, previewCell);
  const marginX = margin ? margin.x : 0;
  const marginY = margin ? margin.y : 0;
  const scale = renderScale(width, height);
  const renderWidth = (width + 2 * marginX) * scale;
  const renderHeight = (height + 2 * marginY) * scale;
  if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, renderWidth, renderHeight);
  drawChecker(ctx, canvas, renderWidth, renderHeight);
  const paintCells = (source, cssOverride = null) => {
    for (let y = -marginY; y < height + marginY; y += 1) {
      for (let x = -marginX; x < width + marginX; x += 1) {
        const pixel = source[indexWrapped(x, y, width, height)];
        if (pixel === Pixel.Transparent) continue;
        ctx.fillStyle = cssOverride || cssForPixel(pixel);
        ctx.fillRect((x + marginX) * scale, (y + marginY) * scale, scale, scale);
      }
    }
  };
  for (const underlay of underlays) paintCells(underlay.cells, underlay.css);
  paintCells(visible);
  drawGridLines(ctx, width + 2 * marginX, height + 2 * marginY, scale);
  if (marginX || marginY) dimWrapMargins(ctx, width, height, marginX, marginY, scale);
}

function dimWrapMargins(ctx, width, height, marginX, marginY, scale) {
  const w = width * scale;
  const h = height * scale;
  const offsetX = marginX * scale;
  const offsetY = marginY * scale;
  ctx.fillStyle = "rgba(246, 246, 241, 0.45)";
  ctx.fillRect(0, 0, w + 2 * offsetX, offsetY);
  ctx.fillRect(0, offsetY + h, w + 2 * offsetX, offsetY);
  ctx.fillRect(0, offsetY, offsetX, h);
  ctx.fillRect(offsetX + w, offsetY, offsetX, h);
  ctx.strokeStyle = "rgba(18, 18, 16, 0.9)";
  ctx.lineWidth = 2;
  ctx.strokeRect(offsetX + 1, offsetY + 1, w - 2, h - 2);
}

function renderScale(width, height) {
  return Math.max(1, Math.ceil(BASE_TILE_RENDER_SIZE / Math.max(width, height)));
}

function drawChecker(ctx, canvas, renderWidth, renderHeight) {
  const displaySize = Math.max(1, canvas.getBoundingClientRect().width || renderWidth);
  const checkerSize = Math.max(2, Math.round((CHECKER_DISPLAY_SIZE / displaySize) * renderWidth));
  ctx.fillStyle = "#d7d5cb";
  ctx.fillRect(0, 0, renderWidth, renderHeight);
  ctx.fillStyle = "#c8c6bb";
  for (let y = 0, row = 0; y < renderHeight; y += checkerSize, row += 1) {
    for (let x = 0, col = 0; x < renderWidth; x += checkerSize, col += 1) {
      if ((col + row) % 2 === 0) {
        ctx.fillRect(
          x,
          y,
          Math.min(checkerSize, renderWidth - x),
          Math.min(checkerSize, renderHeight - y),
        );
      }
    }
  }
}

function drawGridLines(ctx, width, height, scale) {
  if (scale < 4) return;
  ctx.fillStyle = "rgba(18, 18, 16, 0.16)";
  for (let x = 1; x < width; x += 1) {
    ctx.fillRect(Math.round(x * scale), 0, 1, height * scale);
  }
  for (let y = 1; y < height; y += 1) {
    ctx.fillRect(0, Math.round(y * scale), width * scale, 1);
  }
}

/* ---------- Utilities ---------- */

function indexFor(x, y, width) {
  return y * width + x;
}

function indexWrapped(x, y, width, height) {
  const wx = ((x % width) + width) % width;
  const wy = ((y % height) + height) % height;
  return wy * width + wx;
}

function maxSizeForType(type) {
  if (type === "cube") return MAX_CUBE_SIZE;
  if (type === "blockset") return MAX_BLOCKSET_SIZE;
  return MAX_TILE_SIZE;
}

function maxSizeForAsset(asset) {
  return maxSizeForType(asset?.type);
}

function minSizeForAsset(asset) {
  return asset?.type === "particles" ? MIN_PARTICLE_SIZE : MIN_TILE_SIZE;
}

function canZoomAsset(asset) {
  return !!asset && (widthOf(asset) > 64 || heightOf(asset) > 64);
}

function zoomFactorForAsset(asset) {
  return canZoomAsset(asset) ? clampZoom(state.zoom) : 1;
}

function clampZoom(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 1;
  return ZOOM_LEVELS.reduce((best, next) =>
    Math.abs(next - requested) < Math.abs(best - requested) ? next : best, ZOOM_LEVELS[0]);
}

function clampBrushSize(value) {
  return clampInt(value, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
}

function validPaintScope(scope) {
  return ["active", "visible", "all", "z", "zsoft"].includes(scope) ? scope : "active";
}

function validZFalloffMode(mode) {
  return mode === "blend" ? "blend" : "coverage";
}

function validGrayMode(mode) {
  return validRangeMode(mode);
}

function validRangeMode(mode) {
  return ["fixed", "random", "gradient", "radialOut", "radialIn"].includes(mode) ? mode : "fixed";
}

function validScaleMode(scale) {
  return scale === "single" ? "single" : "range";
}

function activeRangeMode(mode, scale) {
  return scale === "single" ? "fixed" : validRangeMode(mode);
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function normalizePixel(value, allowGray = false) {
  if (value === Pixel.Black || value === Pixel.White) return value;
  if (allowGray && Number.isInteger(value) && value >= GRAY_BASE && value <= GRAY_BASE + 255) return value;
  return Pixel.Transparent;
}

function grayPixel(level) {
  return GRAY_BASE + clampInt(level, 0, 255);
}

function grayLevelOf(pixel) {
  if (pixel === Pixel.White) return 255;
  if (pixel >= GRAY_BASE) return pixel - GRAY_BASE;
  return 0;
}

function cssForPixel(pixel) {
  if (pixel === Pixel.Black) return "#000";
  if (pixel === Pixel.White) return "#fff";
  if (pixel >= GRAY_BASE) {
    const level = pixel - GRAY_BASE;
    return `rgb(${level}, ${level}, ${level})`;
  }
  return "transparent";
}

function sanitizeName(value) {
  return String(value || "asset")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "asset";
}

function uniqueName(base) {
  const existing = new Set(state.assets.map((asset) => asset.name));
  if (!existing.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}_${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Deterministic per-cell hash in [0, 1); keeps tween dissolves stable so a
// pixel flips from A to B exactly once across the interpolated frames.
function hash01(index) {
  const s = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function clampInt(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
