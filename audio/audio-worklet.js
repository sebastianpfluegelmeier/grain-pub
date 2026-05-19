// grain AudioWorkletProcessor.
//
// Loaded by the main thread via `audioContext.audioWorklet.addModule(url)`.
// On first message the worklet initialises the grain-audio-wasm bundle
// from a pre-fetched ArrayBuffer (fetch() isn't available in
// AudioWorkletGlobalScope, so the main thread does the fetch and posts
// the bytes here), then accepts:
//
//   { type: 'plan',       planJson: <string> }   — replace current renderer
//   { type: 'clear_plan' }                       — drop the renderer (silence)
//   { type: 'scalar',     name: <string>, value: <f32> }
//   { type: 'scalars',    values: { name: value, ... } } — batched
//
// Replies with `{ type: 'ready', sampleRate }` after init succeeds, and
// `{ type: 'error', error }` on any thrown error.

import init, { WorkletEngine } from './grain_audio_wasm.js';

let engine = null;

class GrainAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = async (event) => {
      const msg = event.data;
      try {
        if (msg.type === 'init') {
          await init(msg.wasmBytes);
          engine = new WorkletEngine(sampleRate);
          this.port.postMessage({ type: 'ready', sampleRate });
        } else if (msg.type === 'plan') {
          if (!engine) throw new Error('plan before init');
          engine.set_plan_json(msg.planJson);
          this.port.postMessage({ type: 'plan_loaded' });
        } else if (msg.type === 'clear_plan') {
          engine?.clear_plan();
        } else if (msg.type === 'scalar') {
          engine?.set_scalar(msg.name, msg.value);
        } else if (msg.type === 'scalars') {
          if (!engine) return;
          for (const [name, value] of Object.entries(msg.values)) {
            engine.set_scalar(name, value);
          }
        }
      } catch (err) {
        this.port.postMessage({ type: 'error', error: String(err) });
      }
    };
  }

  process(_inputs, outputs) {
    if (!engine || !engine.has_plan()) {
      // No plan → silence. Returning true keeps the node alive for the
      // next message; returning false would let the worklet be GC'd.
      return true;
    }
    const out = outputs[0];
    if (!out || !out[0]) return true;
    // Mono render, then duplicate to every channel (typically stereo).
    engine.render_mono(out[0]);
    for (let ch = 1; ch < out.length; ch++) {
      out[ch].set(out[0]);
    }
    return true;
  }
}

registerProcessor('grain-audio', GrainAudioProcessor);
