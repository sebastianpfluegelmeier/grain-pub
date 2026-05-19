/* tslint:disable */
/* eslint-disable */

export class WorkletEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Drop the renderer; subsequent `render_mono` calls produce silence.
     * Used when a program edit removes the `audio { ... }` block.
     */
    clear_plan(): void;
    has_plan(): boolean;
    constructor(sample_rate_hz: number);
    /**
     * 1 for mono plan, 2 for stereo, 0 if no plan loaded. The
     * worklet picks render_mono vs render_stereo from this.
     */
    out_channels(): number;
    /**
     * Pull `out.len()` mono samples into the JS-supplied Float32Array.
     * AudioWorklet's process() runs at 128-frame blocks by spec.
     */
    render_mono(out: Float32Array): void;
    /**
     * Fill two same-length Float32Arrays with the next block of L+R
     * samples. Mono plans copy L → R inside the renderer.
     */
    render_stereo(left: Float32Array, right: Float32Array): void;
    sample_rate(): number;
    /**
     * Replace the current renderer with one built from a freshly
     * deserialized plan. A new `KrSnapshot` is created so cells from
     * the previous plan don't leak in (the main thread will replay
     * the current scalars on its next tick anyway).
     */
    set_plan_json(plan_json: string): void;
    /**
     * Insert (or replace) a decoded sample buffer. The main thread
     * fetches the WAV / decodes via AudioContext.decodeAudioData and
     * posts the resulting Float32Array here. The renderer doesn't see
     * the new sample until the next `set_plan_json` rebuild.
     */
    set_sample(path: string, samples: Float32Array): void;
    /**
     * Write a scalar value (sent from the main-thread k-rate driver
     * via worklet `postMessage`). Caches the cell handle on first
     * touch so subsequent writes are a single atomic store.
     */
    set_scalar(name: string, value: number): void;
}

export function _start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_workletengine_free: (a: number, b: number) => void;
    readonly workletengine_clear_plan: (a: number) => void;
    readonly workletengine_has_plan: (a: number) => number;
    readonly workletengine_new: (a: number) => number;
    readonly workletengine_out_channels: (a: number) => number;
    readonly workletengine_render_mono: (a: number, b: number, c: number, d: any) => void;
    readonly workletengine_render_stereo: (a: number, b: number, c: number, d: any, e: number, f: number, g: any) => void;
    readonly workletengine_sample_rate: (a: number) => number;
    readonly workletengine_set_plan_json: (a: number, b: number, c: number) => [number, number];
    readonly workletengine_set_sample: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly workletengine_set_scalar: (a: number, b: number, c: number, d: number) => void;
    readonly _start: () => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
