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
const MAX_TILE_SIZE = 32;
const DEFAULT_FPS = 8;
const MIN_FPS = 1;
const MAX_FPS = 24;
const STARTER_FRAME_COUNT = 4;
const BASE_TILE_RENDER_SIZE = 384;
const MIN_TILE_RENDER_SCALE = 12;
const CHECKER_DISPLAY_SIZE = 10;
const MAX_CANVAS_CELL_SIZE = 40;
const HISTORY_LIMIT = 100;
const Pixel = {
  Transparent: 0,
  Black: 1,
  White: 2,
};
const BINARY_ASSET_MAGIC = [0x54, 0x47, 0x41, 0x53]; // TGAS
const BINARY_ASSET_VERSION = 1;
const BINARY_ASSET_HEADER_SIZE = 18;
const BINARY_ASSET_KIND = {
  tileset: 1,
  animation: 2,
  cube: 3,
  blockset: 4,
};
const BINARY_KIND_ASSET = Object.fromEntries(Object.entries(BINARY_ASSET_KIND).map(([type, kind]) => [kind, type]));
const BINARY_ASSET_VISIBLE = 0x01;
const GRAY_BASE = 10;
const WRAP_MARGIN_RATIO = 0.25;
const PEN_TOOLS = ["pen", "dither", "spray", "mirror"];
const DRAG_TOOLS = ["line", "square", "shift"];
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const ONION_PREV_CSS = "rgba(217, 45, 32, 0.32)";
const ONION_NEXT_CSS = "rgba(39, 90, 210, 0.32)";
const CELL_NOUNS = {
  tileset: "tile",
  animation: "frame",
  cube: "slice",
  blockset: "layer",
};

const ICON_ATTRS = 'viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICONS = {
  pen: `<svg ${ICON_ATTRS}><path d="M11.2 2.7a1.3 1.3 0 0 1 1.85 0l.25.25a1.3 1.3 0 0 1 0 1.85L6.6 11.5 3 13l1.5-3.6 6.7-6.7z"/><path d="M10.1 3.8l2.1 2.1"/></svg>`,
  line: `<svg ${ICON_ATTRS}><path d="M3.2 12.8 12.8 3.2"/></svg>`,
  square: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>`,
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
  mirror: `<svg ${ICON_ATTRS}><path d="M8 2.5v11" stroke-dasharray="1.6 1.8"/><path d="M5.5 5 2.8 8l2.7 3z" fill="currentColor" stroke="none"/><path d="M10.5 5l2.7 3-2.7 3z"/></svg>`,
  fill: `<svg ${ICON_ATTRS}><path d="M7.5 2.2 12.6 7.3 8 11.9a1.4 1.4 0 0 1-2 0L3.6 9.5a1.4 1.4 0 0 1 0-2z"/><path d="M13.4 10.6s1.2 1.5 1.2 2.4a1.2 1.2 0 0 1-2.4 0c0-.9 1.2-2.4 1.2-2.4z" fill="currentColor" stroke="none"/></svg>`,
  shift: `<svg ${ICON_ATTRS}><path d="M8 2.5v11M2.5 8h11"/><path d="M6.3 4.2 8 2.5l1.7 1.7M6.3 11.8 8 13.5l1.7-1.7M4.2 6.3 2.5 8l1.7 1.7M11.8 6.3 13.5 8l-1.7 1.7"/></svg>`,
  onion: `<svg ${ICON_ATTRS}><rect x="2.5" y="2.5" width="8" height="8"/><rect x="5.5" y="5.5" width="8" height="8" stroke-dasharray="1.6 1.8"/></svg>`,
  tween: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="3.4" cy="8" r="1.7" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.7" fill="currentColor" fill-opacity="0.45" stroke="none"/><circle cx="12.6" cy="8" r="1.7"/></svg>`,
  stack: `<svg ${ICON_ATTRS}><path d="M8 2.2 14 5.2 8 8.2 2 5.2z"/><path d="M2 8.2l6 3 6-3M2 11.2l6 3 6-3"/></svg>`,
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
  onion: false,
  flash: "",
  selection: null, // {x, y, w, h} in cell coords on the active grid
  selectDrag: null, // "marquee" | "move" while dragging with the select tool
  moveOffset: null, // {dx, dy} while dragging a selection
  clipboard: null, // {w, h, cells}
  eraseStroke: false,
  ditherLevel: 8, // Bayer threshold out of 16 (4 = 25%, 8 = 50%, 12 = 75%)
  history: { past: [], future: [] },
  playing: false,
  playTimer: null,
};

const app = document.querySelector("#app");
let galleryTimer = null;
let previewTick = 0;
let hoverPreviewId = null;

// Test/debug hook; not part of the UI contract.
window.__grainState = state;

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

function normalizeFramed(asset) {
  const width = clampInt(asset.width || DEFAULT_TILE_SIZE, MIN_TILE_SIZE, MAX_TILE_SIZE);
  const height = clampInt(asset.height || DEFAULT_TILE_SIZE, MIN_TILE_SIZE, MAX_TILE_SIZE);
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
  const width = clampInt(asset.width || DEFAULT_TILE_SIZE, MIN_TILE_SIZE, MAX_TILE_SIZE);
  const height = clampInt(asset.height || DEFAULT_TILE_SIZE, MIN_TILE_SIZE, MAX_TILE_SIZE);
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
  view.setUint16(4, BINARY_ASSET_VERSION, true);
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

function decodeBinaryAsset(bytes, name) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  if (!(bytes instanceof Uint8Array)) throw new Error("asset bytes must be Uint8Array");
  if (bytes.length < BINARY_ASSET_HEADER_SIZE) throw new Error("binary asset is truncated");
  for (let i = 0; i < BINARY_ASSET_MAGIC.length; i += 1) {
    if (bytes[i] !== BINARY_ASSET_MAGIC[i]) throw new Error("not a TinyGrain asset");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== BINARY_ASSET_VERSION) throw new Error(`unsupported asset version ${version}`);
  const type = BINARY_KIND_ASSET[view.getUint8(6)];
  if (!type) throw new Error(`unknown asset type ${view.getUint8(6)}`);
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

/* ---------- Asset accessors ---------- */

function cellsOf(asset) {
  if (asset.type === "tileset") return asset.tiles;
  if (asset.type === "blockset") return asset.layers;
  return asset.frames;
}

function setCellsOf(asset, cells) {
  if (asset.type === "tileset") asset.tiles = cells;
  else if (asset.type === "blockset") asset.layers = cells;
  else asset.frames = cells;
}

function widthOf(asset) {
  return asset.type === "tileset" ? asset.tileSize : asset.width;
}

function heightOf(asset) {
  return asset.type === "tileset" ? asset.tileSize : asset.height;
}

function cellNoun(asset) {
  return CELL_NOUNS[asset.type] || "tile";
}

function hasPlayback(asset) {
  return asset.type === "animation" || asset.type === "cube";
}

function wraps(asset) {
  return asset.type === "cube";
}

function wrapMarginOf(asset) {
  if (!wraps(asset)) return { x: 0, y: 0 };
  return {
    x: Math.max(1, Math.round(widthOf(asset) * WRAP_MARGIN_RATIO)),
    y: Math.max(1, Math.round(heightOf(asset) * WRAP_MARGIN_RATIO)),
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
  const keepsPlayback = ["togglePlay", "setFps", "setTool", "setColor", "commitShape", "toggleOnion", "toggleAllFrames"];
  if (state.playing && !keepsPlayback.includes(action.type)) {
    stopPlayback();
  }
  switch (action.type) {
    case "openGallery":
      state.screen = "gallery";
      state.activeAssetId = null;
      state.status = "Local only";
      resetHistory();
      break;
    case "createAsset": {
      const creators = {
        tileset: createTileset,
        animation: createAnimation,
        cube: createCube,
        blockset: createBlockset,
      };
      const create = creators[action.kind] || createTileset;
      const name = uniqueName(sanitizeName(state.draftName || action.kind));
      const asset = create(name);
      state.assets = [asset, ...state.assets];
      state.activeAssetId = asset.id;
      state.activeTile = 0;
      state.screen = "editor";
      state.draftName = "new_asset";
      state.status = `Created ${name}`;
      state.color = Pixel.Black;
      state.selection = null;
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
      state.activeTile = 0;
      state.screen = "editor";
      state.status = "Editing";
      state.color = Pixel.Black;
      state.selection = null;
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
        state.status = `${widthOf(asset)}x${heightOf(asset)}`;
      }
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
    case "selectTile": {
      const asset = activeAsset();
      state.activeTile = action.index;
      if (asset && asset.type === "blockset" && !asset.visibility[action.index]) {
        asset.visibility[action.index] = true;
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
      state.allFrames = !state.allFrames;
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
  touch(asset);
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
  const nextWidth = clampInt(requestedWidth, MIN_TILE_SIZE, MAX_TILE_SIZE);
  const nextHeight = clampInt(requestedHeight, MIN_TILE_SIZE, MAX_TILE_SIZE);
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
  app.append(refreshButton());
  startGalleryPreviews();
}

// Cards animate only while hovered.
function startGalleryPreviews() {
  if (galleryTimer) {
    clearInterval(galleryTimer);
    galleryTimer = null;
  }
  if (state.screen !== "gallery" || !state.assets.some(hasPlayback)) return;
  galleryTimer = setInterval(() => {
    if (!hoverPreviewId) return;
    const canvas = document.querySelector(`[data-preview-asset="${hoverPreviewId}"]`);
    const asset = state.assets.find((item) => item.id === hoverPreviewId);
    if (!canvas || !asset || !hasPlayback(asset)) return;
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
  const count = cellsOf(asset).length;
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
    <p class="confirm-note">${asset.type} / ${count} ${cellNoun(asset)}${count === 1 ? "" : "s"} — this cannot be undone.</p>
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
  const count = asset ? cellsOf(asset).length : 0;
  const breadcrumb = asset
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
  if (hasPlayback(asset)) {
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

  const count = cellsOf(asset).length;
  const meta = document.createElement("div");
  meta.className = "asset-meta";
  const unsynced = assetUnsynced(asset)
    ? '<span class="unsynced" title="Not synced">●</span> '
    : "";
  meta.innerHTML = `
    <div>
      <div class="asset-name">${unsynced}${escapeHtml(asset.name)}</div>
      <div class="asset-kind">${count} ${cellNoun(asset)}${count === 1 ? "" : "s"}</div>
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
  wrap.className = "editor";

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
    sizeGroup.append(
      stepperControl("W", asset.width, MIN_TILE_SIZE, MAX_TILE_SIZE, "Width", (value) =>
        dispatch({ type: "resizeAsset", width: value, height: asset.height })),
      stepperControl("H", asset.height, MIN_TILE_SIZE, MAX_TILE_SIZE, "Height", (value) =>
        dispatch({ type: "resizeAsset", width: asset.width, height: value })),
    );
  }
  sizeGroup.append(iconTextButton("Export", "download", "btn", () => exportActiveAsset()));
  head.append(rename, sizeGroup);
  wrap.append(head);

  const canvasArea = document.createElement("div");
  canvasArea.className = "canvas-area";
  const canvas = document.createElement("canvas");
  canvas.className = "drawing-canvas";
  canvas.addEventListener("pointerdown", onCanvasPointerDown);
  canvas.addEventListener("pointermove", onCanvasPointerMove);
  canvas.addEventListener("pointerup", onCanvasPointerUp);
  canvas.addEventListener("pointercancel", onCanvasPointerUp);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvasArea.append(canvas);
  wrap.append(canvasArea);

  const dock = document.createElement("div");
  dock.className = "dock";
  dock.append(toolRow(asset), colorRow(asset), frameActions(asset), tileActions(asset), tileRow(asset));
  wrap.append(dock);
  return wrap;
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

function toolRow(asset) {
  const row = document.createElement("div");
  row.className = "tool-row";
  const tools = [
    ["Pen", "pen"],
    [`Dither pen (${Math.round((state.ditherLevel / 16) * 100)}% — click again to cycle)`, "dither"],
    ["Noise spray", "spray"],
    ["Mirror pen", "mirror"],
    ["Line", "line"],
    ["Filled square", "square"],
    ["Fill bucket", "fill"],
    ["Shift (drag to offset)", "shift"],
    ["Select (drag; move inside; copy/cut/paste with keyboard)", "select"],
  ];
  for (const [label, tool] of tools) {
    row.append(toggleButton(label, tool, state.tool === tool, () => dispatch({ type: "setTool", tool })));
  }
  if (hasPlayback(asset)) {
    const divider = document.createElement("span");
    divider.className = "action-divider";
    const allFrames = iconButton(
      state.allFrames ? "Drawing on all frames (click for single)" : "Draw on all frames",
      "stack",
      `tool-btn${state.allFrames ? " active" : ""}`,
      () => dispatch({ type: "toggleAllFrames" }),
    );
    row.append(divider, allFrames);
  }
  return row;
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
    const chip = document.createElement("span");
    chip.className = "gray-chip";
    chip.title = "Current gray";
    const paintColor = state.color === Pixel.Transparent ? grayPixel(0) : state.color;
    chip.style.background = cssForPixel(paintColor);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "gray-slider";
    slider.min = "0";
    slider.max = "255";
    slider.step = "1";
    slider.value = String(grayLevelOf(paintColor));
    slider.ariaLabel = "Gray level";
    slider.addEventListener("input", () => {
      state.color = grayPixel(clampInt(slider.value, 0, 255));
      chip.style.background = cssForPixel(state.color);
      row.querySelector(".color-btn.active")?.classList.remove("active");
    });
    row.append(chip, slider, colorButton("Transparent", "clear", Pixel.Transparent));
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
  const asset = activeAsset();
  const cell = cellFromEvent(event);
  if (!asset || !cell) return;
  if (state.playing) stopPlayback();
  state.eraseStroke = event.button === 2;
  if (state.tool === "fill") {
    fillAt(cell.x, cell.y);
    state.eraseStroke = false;
    render();
    return;
  }
  event.currentTarget.setPointerCapture?.(event.pointerId);
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
    paintAt(cell.x, cell.y);
    drawCanvases();
  } else {
    drawCanvases(cell);
  }
}

function onCanvasPointerMove(event) {
  const asset = activeAsset();
  const cell = cellFromEvent(event);
  if (!asset || !cell || !state.pointerDown) return;
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
    paintAt(cell.x, cell.y);
    drawCanvases();
  } else {
    drawCanvases(cell);
  }
}

function onCanvasPointerUp(event) {
  if (!state.pointerDown) return;
  const cell = cellFromEvent(event) || state.dragStart;
  state.pointerDown = false;
  if (state.tool === "select") {
    if (state.selectDrag === "move") commitSelectionMove();
    state.selectDrag = null;
    state.moveOffset = null;
    state.dragStart = null;
    state.eraseStroke = false;
    render();
    return;
  }
  if (DRAG_TOOLS.includes(state.tool) && state.dragStart && cell) {
    dispatch({ type: "commitShape", from: state.dragStart, to: cell });
  } else {
    state.dragStart = null;
    state.eraseStroke = false;
    render();
    return;
  }
  state.dragStart = null;
  state.eraseStroke = false;
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

// Cell arrays a paint operation applies to: just the active tile/frame/layer,
// or every frame when the all-frames toggle is on (animations and cubes).
function targetCells(asset) {
  if (state.allFrames && hasPlayback(asset)) return cellsOf(asset);
  const active = cellsOf(asset)[state.activeTile];
  return active ? [active] : [];
}

// Color for the current stroke: right-button strokes erase.
function strokeColor() {
  return state.eraseStroke ? Pixel.Transparent : state.color;
}

function paintAt(x, y) {
  const asset = activeAsset();
  if (!asset) return;
  const width = widthOf(asset);
  const height = heightOf(asset);
  for (const cells of targetCells(asset)) {
    penStamp(cells, width, height, x, y, wraps(asset), strokeColor());
  }
  touch(asset);
}

function penStamp(cells, width, height, x, y, wrap, color) {
  const put = (px, py, value) => {
    if (!wrap && (px < 0 || py < 0 || px >= width || py >= height)) return;
    cells[indexWrapped(px, py, width, height)] = value;
  };
  const nx = ((x % width) + width) % width;
  const ny = ((y % height) + height) % height;
  switch (state.tool) {
    case "pen":
      put(x, y, color);
      break;
    case "dither":
      if (BAYER4[ny % 4][nx % 4] < state.ditherLevel) put(x, y, color);
      break;
    case "spray":
      for (let i = 0; i < 3; i += 1) {
        if (Math.random() < 0.45) {
          put(x + randomInt(-2, 2), y + randomInt(-2, 2), color);
        }
      }
      break;
    case "mirror":
      put(nx, ny, color);
      put(width - 1 - nx, ny, color);
      put(nx, height - 1 - ny, color);
      put(width - 1 - nx, height - 1 - ny, color);
      break;
    default:
      break;
  }
}

function fillAt(x, y) {
  const asset = activeAsset();
  if (!asset) return;
  const width = widthOf(asset);
  const height = heightOf(asset);
  pushHistory();
  for (const cells of targetCells(asset)) {
    floodFill(cells, width, height, x, y, strokeColor(), wraps(asset));
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
  const targets = targetCells(asset);
  if (!targets.length) return;
  pushHistory();
  const width = widthOf(asset);
  const height = heightOf(asset);
  for (const cells of targets) {
    if (state.tool === "line") drawLine(cells, width, height, from.x, from.y, to.x, to.y, strokeColor());
    if (state.tool === "square") drawSquare(cells, width, height, from.x, from.y, to.x, to.y, strokeColor());
    if (state.tool === "shift") {
      const shifted = shiftCells(cells, width, height, to.x - from.x, to.y - from.y, wraps(asset));
      for (let i = 0; i < cells.length; i += 1) cells[i] = shifted[i];
    }
  }
  touch(asset);
}

function drawLine(cells, width, height, x0, y0, x1, y1, color) {
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    cells[indexWrapped(x0, y0, width, height)] = color;
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

function drawSquare(cells, width, height, x0, y0, x1, y1, color) {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      cells[indexWrapped(x, y, width, height)] = color;
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
  const cellSize = Math.min(availWidth / width, availHeight / height, MAX_CANVAS_CELL_SIZE);
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
  }
  document.querySelectorAll("[data-preview-asset]").forEach((canvas) => {
    const previewAsset = state.assets.find((item) => item.id === canvas.dataset.previewAsset);
    if (!previewAsset) return;
    drawAssetPreview(canvas, previewAsset, 0);
  });
}

function drawAssetPreview(canvas, asset, tick) {
  const frames = cellsOf(asset);
  const frame = hasPlayback(asset) ? frames[tick % frames.length] : frames[0];
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
  if (state.tool === "line") {
    drawLine(copy, width, height, state.dragStart.x, state.dragStart.y, previewCell.x, previewCell.y, strokeColor());
  } else if (state.tool === "square") {
    drawSquare(copy, width, height, state.dragStart.x, state.dragStart.y, previewCell.x, previewCell.y, strokeColor());
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
  return Math.max(MIN_TILE_RENDER_SCALE, Math.ceil(BASE_TILE_RENDER_SIZE / Math.max(width, height)));
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
