# wgpu for Grain Developers

A practical guide to GPU programming with wgpu, using the Grain video synthesis language as a running example.

---

## Who This Book Is For

This book is for experienced Rust developers who understand ownership, traits, async, and the Rust ecosystem, but have little or no experience with GPU programming, shaders, or graphics APIs. After reading, you'll understand:

- How GPUs work at a conceptual level and why they exist
- The graphics rendering pipeline and how fragment shaders fit in
- How wgpu provides a safe Rust API for GPU programming
- How Grain uses wgpu to compile expressions into real-time video synthesis
- Every GPU-related concept used in the Grain codebase

The book uses the Grain video synthesis language as a running example throughout. Grain is a good teaching vehicle because it uses GPU rendering for 2D image synthesis — simpler than 3D game rendering, but exercising all the same wgpu concepts (textures, shaders, render passes, bind groups, etc.).

## How to Read This Book

Part I (Chapters 1–7) covers GPU fundamentals. If you've never written a shader or thought about how GPUs work, start here. Each chapter builds on the previous one.

Part II (Chapters 8–22) walks through how Grain uses wgpu. These chapters alternate between wgpu API concepts and Grain-specific implementation details. Read them in order — later chapters reference concepts from earlier ones.

The Appendices are reference material you can consult as needed.

Code snippets are taken from the actual Grain source code, with file paths and line references where helpful. The snippets may be slightly simplified for clarity (removing error handling boilerplate, etc.), but the core logic is preserved.

---

# Part I: GPU Foundations

## Chapter 1: What Is a GPU?

If you've spent your career writing Rust that runs on CPUs, the GPU is a fundamentally different machine. Understanding *how* it's different is the key to understanding everything else in this book.

### The CPU: Fast but Sequential

A modern CPU has a small number of powerful cores — typically 4 to 16 on consumer hardware. Each core is a sophisticated engine optimized for executing complex, branching, sequential code as fast as possible. It has deep pipelines, branch predictors, out-of-order execution, and large caches. A single CPU core can chew through a complicated algorithm with unpredictable branches and pointer-chasing at remarkable speed.

But there's a ceiling. If you need to process 1920×1080 pixels — roughly two million of them — and each pixel requires even a modest computation, doing it one pixel at a time is simply too slow for real-time work at 60 frames per second. That's 124 million pixel computations per second. Even with multithreading across 8 cores, each core handles 15 million pixels per second, which leaves almost no room for non-trivial math per pixel.

### The GPU: Wide but Simple

A GPU takes the opposite approach. Instead of a few powerful cores, it has thousands of simple ones. An NVIDIA RTX 4070 has 5,888 "CUDA cores." An Apple M1 GPU has 1,024 execution units. These aren't full-featured processor cores — they can't do branch prediction or out-of-order execution like a CPU core can. But they can all execute the *same instruction* on *different data* simultaneously.

This is the SIMT model — Single Instruction, Multiple Threads. The GPU organizes its threads into groups (called "warps" on NVIDIA, "waves" on AMD, "SIMD groups" on Apple). Every thread in a group executes the same instruction at the same time, but each thread operates on its own data — its own pixel coordinates, its own set of variables.

When you write a fragment shader in Grain, you're writing a function that says "given pixel coordinates (x, y), compute a color." The GPU runs that function on every pixel simultaneously. A 1920×1080 image has 2,073,600 pixels. If the GPU can run 5,000 threads in parallel, it completes the entire image in roughly 415 "waves" of execution — which at GPU clock speeds takes well under a millisecond.

### Why This Matters for Grain

Grain is a video synthesis language. Every frame, it needs to compute a color for every pixel on screen. This is the GPU's ideal workload: the same computation, independently applied to millions of data points. There are no dependencies between pixels — pixel (100, 200) doesn't need to know the result of pixel (50, 75) before it can compute its own value.

This is why Grain compiles to GPU shaders rather than running on the CPU. A Grain expression like:

```
noise(x * 4, y * 4, time) >> blur(3)
```

becomes a fragment shader that the GPU executes for every pixel in parallel. The GPU's massively parallel architecture makes real-time video synthesis possible at resolutions and frame rates that would be completely impractical on a CPU.

### The Cost of Parallelism

The GPU's parallelism comes with constraints that shape everything about how Grain works:

**No shared mutable state between pixels.** Each pixel computation is independent. You can't write to a variable in one pixel and read it in another during the same frame. This is why temporal effects in Grain (like `impulse` or `acc`) use feedback textures — they read the *previous* frame's result, which is already fully computed and immutable.

**Branching is expensive.** When threads in a group hit an `if/else`, threads that take the `if` branch must wait while threads that take the `else` branch execute, and vice versa. Both branches execute; some threads just discard their results. This is called "divergent branching." Grain's generated WGSL code prefers `select()` (a branchless conditional) over `if/else` for this reason.

**Memory access patterns matter.** GPU memory is optimized for sequential, predictable access. When neighboring pixels read neighboring memory locations (as when sampling a texture), the GPU's memory system is fast. Random access patterns are much slower. This is relevant when Grain does texture sampling with spatial transforms like `warp`.

**Communication with the CPU is slow.** Moving data between CPU memory and GPU memory requires crossing the PCIe bus (on discrete GPUs) or going through system memory (on integrated GPUs). This transfer is orders of magnitude slower than GPU-local memory access. Grain minimizes CPU-GPU communication: it sends a small uniform buffer of parameters each frame (288 bytes — trivial) and reads back pixels only when exporting to disk.

### GPU Memory Hierarchy

Like CPUs, GPUs have a memory hierarchy, but the details differ:

```
Registers (per-thread)     ← fastest, smallest
    │
Shared Memory (per-workgroup)  ← fast, small (16-48 KB)
    │
L1 / Texture Cache         ← fast, small per core
    │
L2 Cache                   ← medium speed, larger (MB range)
    │
VRAM (device memory)       ← slow relative to cache, large (GB range)
    │
System RAM (via PCIe/bus)  ← slowest, largest
```

When a fragment shader reads `params.time`, the value comes from a uniform buffer in VRAM, but after the first read by any thread, it's cached and subsequent reads across all threads are essentially free. Uniform buffers are specifically optimized for this broadcast pattern — the same value going to every thread.

Texture reads go through a dedicated texture cache that's optimized for spatial locality. When fragment shader invocations for neighboring pixels read neighboring texels, the cache hit rate is high. This is the normal case in Grain — consecutive pixel positions map to consecutive texture positions. But spatial transforms (like `warp` with a chaotic displacement) can destroy this locality, causing cache misses and slowdowns.

Understanding this hierarchy isn't necessary for writing Grain programs, but it explains *why* certain operations are fast (uniform reads, spatially coherent texture reads) and others are slow (random texture access, CPU readback).


## Chapter 2: The Graphics Pipeline

The GPU isn't just a collection of parallel cores with a flat programming model. It has a fixed-function pipeline — a series of stages that data flows through, some programmable, some not. Understanding this pipeline explains why Grain's code is structured the way it is.

### The Pipeline Stages

When you ask a GPU to draw something, data flows through these stages:

```
                          Fixed-function          Programmable
                         ┌─────────────┐      ┌──────────────────┐
 Vertex Data ──────────► │ Input       │ ───► │ Vertex Shader    │
                         │ Assembly    │      │ (per vertex)     │
                         └─────────────┘      └────────┬─────────┘
                                                       │
                         ┌─────────────┐               │
                         │ Primitive   │ ◄─────────────┘
                         │ Assembly    │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │ Rasterizer  │
                         │ (triangles  │
                         │  → pixels)  │
                         └──────┬──────┘
                                │
                         ┌──────▼──────────────┐
                         │ Fragment Shader      │
                         │ (per pixel,          │
                         │  programmable)       │
                         └──────┬──────────────┘
                                │
                         ┌──────▼──────┐
                         │ Output      │
                         │ Merger      │
                         │ (blend,     │
                         │  write)     │
                         └──────┬──────┘
                                │
                                ▼
                          Framebuffer
```

**1. Vertex Input and Assembly:** The pipeline starts with vertices — points in space that define geometry. For a triangle, you provide three vertices, each with a position (and optionally other data like texture coordinates or colors). The input assembler groups vertices into primitives (triangles, lines, or points) based on the primitive topology.

**2. Vertex Shader:** A programmable stage that processes each vertex independently. It transforms vertex positions from whatever coordinate space they're in (model space, world space) into *clip space* — a normalized coordinate system where (-1, -1) is the bottom-left of the screen and (1, 1) is the top-right. The vertex shader runs once per vertex.

In a 3D game, the vertex shader might multiply each vertex position by a model-view-projection matrix to transform from 3D world coordinates to 2D screen coordinates. In Grain, the vertex shader is trivial — it outputs hardcoded positions that form a fullscreen triangle.

**3. Rasterization:** A fixed-function (non-programmable) stage. The rasterizer takes the transformed triangles from clip space and figures out which pixels on screen they cover. For each covered pixel, it generates a *fragment* — a candidate pixel with interpolated values from the triangle's vertices.

The interpolation is key: if vertex A has texture coordinate (0, 0) and vertex B has (1, 0), a fragment halfway between them gets (0.5, 0). This is called *barycentric interpolation* — the GPU computes a weighted average of the triangle's three vertex values based on where the fragment falls within the triangle. Grain doesn't pass custom vertex attributes (since its vertex shader has no outputs beyond position), but the `@builtin(position)` value is always available.

**4. Fragment Shader:** A programmable stage that runs once per fragment. It receives the interpolated values and computes a final color. This is where the interesting work happens in Grain — the fragment shader is where `noise`, `blend`, `hsv`, and all other Grain operations execute.

The term "fragment" rather than "pixel" is deliberate: a fragment is a *candidate* pixel. Multiple fragments can contribute to the same pixel (when triangles overlap), and some fragments may be discarded (by depth testing, alpha testing, or the `discard` keyword in WGSL). In Grain's case, there's only one triangle and no depth testing, so every fragment becomes a pixel.

**5. Output Merger:** The computed color is written to the framebuffer — a texture that represents the final image. The output merger stage handles blending (combining the fragment's color with the existing pixel color), depth testing (discarding fragments behind previously drawn geometry), and stencil testing. Grain uses `BlendState::REPLACE`, which means the fragment shader's output completely replaces whatever was in the framebuffer — no blending with existing contents.

### Why Fragment Shaders Are Everything for Grain

In a typical 3D game, the vertex shader does meaningful geometric work — transforming 3D models, computing lighting directions, projecting perspective. The fragment shader handles surface appearance — textures, shadows, reflections.

Grain doesn't do 3D geometry at all. It's a 2D image synthesis tool. Every frame, it draws a single shape (a triangle, as we'll see in Chapter 14) that covers the entire screen. The vertex shader is trivial — it just positions the triangle. All the real work happens in the fragment shader.

This means Grain uses the graphics pipeline in a somewhat unusual way:

- **Vertex input:** 3 vertices (a single triangle covering the screen)
- **Vertex shader:** Generates clip-space positions; nothing else
- **Rasterizer:** Generates a fragment for every pixel on screen
- **Fragment shader:** Runs the entire Grain program for each pixel
- **Output:** Writes the computed color to a texture

The fragment shader is invoked for every pixel, and it receives the pixel's coordinates. It uses those coordinates — along with uniform data like the current time and frame number — to compute a color. This is the core execution model: a pure function from (x, y, time, parameters) → color.

### Render Targets

The output of a render pass doesn't have to be the screen. It can be any texture. This is critical for Grain's multi-block rendering: each named expression in a Grain program renders to its own offscreen texture, and later blocks can sample those textures as inputs. The final "output" block renders to a texture that gets displayed on screen.

This offscreen rendering is sometimes called "render-to-texture." The texture you render into is called a "render target" or "color attachment" (because it's attached to the render pass as the destination for color output).

Render-to-texture enables a wide variety of techniques beyond Grain's multi-block system:

- **Post-processing:** Render a scene to a texture, then apply effects (blur, color grading, distortion) by rendering a fullscreen quad that samples the scene texture. Grain does exactly this for filter functions like `blur`.
- **Shadow mapping:** Render the scene from the light's perspective to a depth texture, then use that texture to determine shadows when rendering from the camera. (Not used in Grain.)
- **Deferred rendering:** Render geometry data (normals, colors, depth) to multiple textures (a "G-buffer"), then compute lighting in a separate pass. (Not used in Grain.)

### Multiple Render Targets (MRT)

A render pass can write to multiple color attachments simultaneously. The fragment shader would output to multiple `@location` values:

```wgsl
struct FragmentOutput {
    @location(0) color: vec4f,
    @location(1) normal: vec4f,
}
```

Grain doesn't use MRT — each block writes to a single texture. But the capability exists in wgpu and is useful for techniques like deferred rendering.

### The Execution Model

It's worth stepping back to see the big picture of how GPU work is organized:

1. The CPU records commands into command buffers
2. Command buffers are submitted to the GPU queue
3. The GPU processes submitted work in order
4. Within a command buffer, render passes execute sequentially
5. Within a render pass, all draw calls share the same render target
6. Within a draw call, millions of shader invocations run in parallel

The CPU and GPU run asynchronously — the CPU can submit new work while the GPU is still processing previous work. This pipelining keeps both processors busy. The CPU only blocks when it explicitly waits for GPU results (like when mapping a buffer for readback).


## Chapter 3: Shaders

A shader is a program that runs on the GPU. The name comes from the original use case — computing shading (lighting and color) for 3D graphics — but today shaders are used for all kinds of GPU computation. Grain uses shaders exclusively for 2D image synthesis.

### A Brief History of Shader Languages

Before WGSL, the GPU programming world was fragmented:

- **GLSL** (OpenGL Shading Language): The original cross-platform shader language. C-like syntax, used by OpenGL and OpenGL ES. Still widely used.
- **HLSL** (High Level Shading Language): Microsoft's shader language for Direct3D. Dominant on Windows.
- **MSL** (Metal Shading Language): Apple's shader language for Metal. C++-based syntax. Used on macOS and iOS.
- **SPIR-V**: An intermediate binary format used by Vulkan. Not human-readable — you typically compile GLSL or HLSL to SPIR-V.

The WebGPU specification introduced **WGSL** to provide a single shader language that works everywhere. Under the hood, wgpu's naga library translates WGSL to whatever the platform needs — SPIR-V for Vulkan, MSL for Metal, HLSL for DX12. This means Grain writes WGSL once and it runs on all platforms without modification.

### WGSL: The Shading Language

WGSL has a C-like syntax with some distinctive features. It's more explicit than GLSL about types and less permissive about implicit conversions — you can't multiply an `i32` by a `f32` without an explicit cast.

**Types:** WGSL has scalar types (`f32`, `u32`, `i32`, `bool`), vector types (`vec2f`, `vec3f`, `vec4f`, `vec2u`, etc.), and matrix types. The `f` and `u` suffixes are shorthand — `vec4f` means `vec4<f32>`, `vec2u` means `vec2<u32>`.

The `vec4f` type is central to Grain. Every Grain value is a `vec4f` — four 32-bit floats representing RGBA color channels. Even a scalar number like `0.5` becomes `vec4f(0.5, 0.5, 0.5, 1.0)` in the generated shader. This is how the `fragment_codegen.rs` handles number literals:

```rust
// grain-compiler/src/fragment_codegen.rs
Expr::Number(n) => Ok(format!("vec4f({0}, {0}, {0}, 1.0)", format_float(*n))),
```

**Functions:** WGSL functions look like this:

```wgsl
fn my_function(x: f32, y: f32) -> vec4f {
    return vec4f(x, y, 0.0, 1.0);
}
```

**Built-in functions:** WGSL provides mathematical functions that Grain uses heavily:
- `sin`, `cos`, `tan`, `atan2` — trigonometry
- `floor`, `ceil`, `fract` — rounding (`fract` returns the fractional part)
- `min`, `max`, `clamp` — clamping
- `mix` — linear interpolation: `mix(a, b, t)` returns `a * (1-t) + b * t`
- `select` — branchless conditional: `select(false_val, true_val, condition)`
- `step` — returns 0.0 if x < edge, 1.0 otherwise
- `smoothstep` — smooth Hermite interpolation between two edges
- `length`, `dot`, `normalize` — vector operations
- `textureSample` — reads a color from a texture at given coordinates

### Anatomy of a Grain-Generated Shader

Here's what the Grain compiler produces for a simple expression like `x * 0.5 + 0.25`. The `build_shader` method in `fragment_codegen.rs` assembles this structure:

```wgsl
// Resource bindings (textures, samplers, uniforms)
struct Params {
    time: f32,
    frame: u32,
    width: u32,
    height: u32,
    beat_info: vec4f,
    knobs: array<vec4f, 16>,
}

@group(0) @binding(0) var<uniform> params: Params;

// Vertex shader — generates fullscreen triangle
@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4f {
    var pos: vec2f;
    switch vertex_index {
        case 0u: { pos = vec2f(-1.0, -3.0); }
        case 1u: { pos = vec2f(-1.0,  1.0); }
        default: { pos = vec2f( 3.0,  1.0); }
    }
    return vec4f(pos, 0.0, 1.0);
}

// Fragment shader — the actual Grain computation
@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = vec2f(pos.x / f32(params.width), pos.y / f32(params.height));
    let uv_min_dim = f32(min(params.width, params.height));
    let uv_ax = pos.x / uv_min_dim;
    let uv_ay = pos.y / uv_min_dim;
    // Generated from: x * 0.5 + 0.25
    let _out = clamp(
        (vec4f(uv.x, uv.x, uv.x, 1.0) * vec4f(0.5, 0.5, 0.5, 1.0))
        + vec4f(0.25, 0.25, 0.25, 1.0),
        vec4f(0.0), vec4f(1.0)
    );
    return vec4f(_out.rgb, 1.0);
}
```

The vertex shader is always the same — it draws a fullscreen triangle (more on that in Chapter 14). The fragment shader is where the Grain expression has been translated into WGSL. The `uv` variable gives normalized coordinates in [0, 1] range. The `@builtin(position)` input provides the pixel position, and dividing by the texture dimensions gives the normalized UV coordinates.

For output blocks (the final displayed image and feedback textures), the result is clamped to [0, 1] and alpha is forced to 1.0. Internal blocks pass unclamped values, allowing intermediate computations to exceed the visible range.

### How Fragment Shaders Map (x, y) → Color

The conceptual model is simple: the fragment shader is a function from pixel position to color. For each pixel on screen:

1. The GPU invokes `fs_main` with `pos` set to the pixel's position (e.g., `vec4f(100.5, 200.5, 0.0, 1.0)` — the .5 means the center of the pixel)
2. The shader normalizes this to UV coordinates: `uv = vec2f(100.5/1920.0, 200.5/1080.0)` = approximately `(0.052, 0.186)`
3. The Grain expression is evaluated using these UV coordinates and the uniform parameters
4. A `vec4f` color is returned and written to the output texture

This runs simultaneously for all pixels. The GPU doesn't process them one at a time — it runs thousands of instances of `fs_main` in parallel, each with different `pos` values.

### Everything Is vec4f

A design decision that permeates Grain's shader generation: every Grain value is represented as a `vec4f`. A number like `0.5` becomes `vec4f(0.5, 0.5, 0.5, 1.0)`. A color like `#ff8000` becomes `vec4f(1.0, 0.502, 0.0, 1.0)`. The UV x-coordinate becomes `vec4f(uv.x, uv.x, uv.x, 1.0)`.

This uniform representation simplifies code generation enormously. Every operation (addition, multiplication, blending, etc.) works the same way regardless of whether the inputs are colors, scalars, or coordinates. The tradeoff is that scalar operations carry three redundant copies of the same value, but GPUs are designed to process vec4f data natively — the hardware operates on all four components in a single instruction (this is the "SIMD" in SIMT). Using vec4f everywhere actually aligns with the hardware's natural data width.

When the shader needs a scalar (like for UV coordinate manipulation or conditional testing), it extracts the `.x` component:

```wgsl
// Testing a condition: use .x channel
select(false_val, true_val, trigger.x > 0.0)

// UV manipulation: use .x for the scalar value
let zoom_uv = vec2f(0.5 + (uv.x - 0.5) / factor.x, 0.5 + (uv.y - 0.5) / factor.x);
```

The `.x` channel is the "canonical" scalar value throughout Grain's generated code.


## Chapter 4: GPU Memory Model

Getting data onto the GPU — and understanding how it's organized once there — is fundamental to working with wgpu. The GPU has its own memory, separate from system RAM, and the CPU can't simply dereference a pointer to GPU data.

### Buffers

A buffer is a blob of bytes on the GPU. It's the simplest form of GPU memory — a linear array of data. Buffers are used for vertex data, index data, uniform data, and general-purpose storage.

In Grain, the main buffer is the **uniform buffer** that holds `RenderParams`. This is how the CPU communicates per-frame data to the shader:

```rust
// grain-runtime/src/params.rs
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct RenderParams {
    pub time: f32,
    pub frame: u32,
    pub width: u32,
    pub height: u32,
    pub beat_info: [f32; 4],
    pub knobs: [[f32; 4]; 16],
}
```

The buffer is created once at startup and updated every frame:

```rust
// grain-runtime/src/renderer.rs — creation
let params = RenderParams::new(width, height);
let params_buffer = device.create_buffer_init(&util::BufferInitDescriptor {
    label: Some("params_buffer"),
    contents: bytemuck::cast_slice(&[params]),
    usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
});
```

```rust
// grain-runtime/src/renderer.rs — per-frame update
self.queue.write_buffer(&self.params_buffer, 0, bytemuck::cast_slice(&[params]));
```

The `BufferUsages::UNIFORM` flag tells wgpu this buffer will be bound as a uniform buffer in shaders. `COPY_DST` allows the CPU to write data into it via `queue.write_buffer()`.

### Alignment and `repr(C)`

GPU memory has strict alignment requirements. The WGSL spec requires that struct members follow specific alignment rules:

- `f32`, `u32`, `i32`: 4-byte alignment
- `vec2f`: 8-byte alignment
- `vec3f`, `vec4f`: 16-byte alignment
- Arrays of `vec4f`: each element is 16-byte aligned

The `#[repr(C)]` attribute on `RenderParams` ensures Rust uses C-compatible struct layout (no field reordering, predictable padding). Without it, the Rust compiler could rearrange fields for efficiency, which would mismatch the WGSL struct layout.

The `bytemuck` crate (via the `Pod` and `Zeroable` derive macros) allows safe transmutation of the struct to raw bytes. `bytemuck::cast_slice(&[params])` converts the struct to a `&[u8]` that can be sent to the GPU. The `Pod` ("Plain Old Data") trait guarantees the struct has no padding bytes that could contain uninitialized memory, and no types with invalid bit patterns.

Let's verify the layout matches. The Rust struct `RenderParams`:
- `time: f32` — 4 bytes at offset 0
- `frame: u32` — 4 bytes at offset 4
- `width: u32` — 4 bytes at offset 8
- `height: u32` — 4 bytes at offset 12
- `beat_info: [f32; 4]` — 16 bytes at offset 16 (naturally vec4f-aligned)
- `knobs: [[f32; 4]; 16]` — 256 bytes at offset 32

Total: 288 bytes. The test in `params.rs` confirms this:

```rust
#[test]
fn layout_size() {
    assert_eq!(std::mem::size_of::<RenderParams>(), 288);
}
```

The corresponding WGSL struct in the generated shader:

```wgsl
struct Params {
    time: f32,       // offset 0
    frame: u32,      // offset 4
    width: u32,      // offset 8
    height: u32,     // offset 12
    beat_info: vec4f, // offset 16 (16-byte aligned)
    knobs: array<vec4f, 16>, // offset 32
}
```

These must match exactly. If you added a `vec3f` field to the Rust struct, you'd need to account for the fact that WGSL pads `vec3f` to 16 bytes — a common source of bugs.

### Buffer Usage Flags

When you create a buffer, you must declare how it will be used. This isn't just an optimization hint — it's a requirement. The GPU driver uses these flags to decide where to place the buffer in memory and what operations to allow on it.

Common usage flags:

| Flag | Meaning |
|------|---------|
| `BufferUsages::UNIFORM` | Can be bound as a uniform buffer in shaders |
| `BufferUsages::COPY_DST` | CPU can write data into it (`queue.write_buffer()`) |
| `BufferUsages::COPY_SRC` | Data can be copied from it |
| `BufferUsages::MAP_READ` | CPU can read from it (after mapping) |
| `BufferUsages::VERTEX` | Can be used as a vertex buffer |
| `BufferUsages::INDEX` | Can be used as an index buffer |
| `BufferUsages::STORAGE` | Can be used as a storage buffer (read-write in shaders) |

Grain's params buffer uses `UNIFORM | COPY_DST` — it's a uniform buffer that the CPU updates each frame. The staging buffer used for readback uses `COPY_DST | MAP_READ` — data is copied into it from a texture, then the CPU reads it.

Attempting to use a buffer in a way not declared by its usage flags is a validation error. wgpu catches these errors and will panic (in debug) or silently fail (in release).

### Textures

Textures are the other major form of GPU memory. Unlike buffers (which are 1D arrays of bytes), textures are 2D (or 3D, or 1D) arrays of pixels with built-in support for filtering and addressing modes. The GPU has dedicated hardware for texture operations — the texture sampling units (TMUs) — which can read, filter, and interpolate texture data much faster than generic memory reads. We'll cover textures in detail in the next chapter.

### Bind Groups: Connecting Resources to Shaders

Shaders declare what resources they expect using `@group` and `@binding` attributes in WGSL:

```wgsl
@group(0) @binding(0) var my_texture: texture_2d<f32>;
@group(0) @binding(1) var my_sampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
```

The `@group(N)` corresponds to a bind group index, and `@binding(M)` corresponds to a binding within that group. A shader can use multiple groups, but Grain uses only group 0 for simplicity.

On the CPU side, you create a **bind group** that provides the actual GPU resources for these bindings. The bind group is the bridge between "the shader wants a texture at binding 0" and "here's the specific texture to use." Creating a bind group also requires a **bind group layout** — a description of what types of resources each binding expects (is it a texture? what dimensionality? is it a sampler? a buffer?).

This two-level indirection (layout declares types, bind group provides instances) allows:
1. The GPU to validate the pipeline at creation time (the layout is baked into the pipeline)
2. Different bind groups to be swapped at draw time (changing which specific textures are used without recreating the pipeline)

Grain exploits this: every block shares the same pipeline layout pattern (textures + sampler + params), but each block gets its own bind group pointing to its specific dependency textures.


## Chapter 5: Textures and Sampling

Textures are the workhorses of Grain's rendering system. Every intermediate result, every feedback buffer, every input image, and the final output are all textures. Understanding textures deeply is essential to understanding Grain.

### What Is a Texture?

A texture is a structured array of pixel data stored on the GPU, optimized for spatial access. Unlike a buffer (which is just bytes), a texture has:

- **Dimensions**: width and height (for 2D textures), plus optional depth/array layers
- **A format**: defines how each pixel's data is interpreted
- **Hardware-accelerated sampling**: the GPU can read textures with filtering (interpolation) and configurable edge behavior, all in hardware

### Texture Formats

The format determines what data each pixel stores and how many bits it uses. Grain primarily uses two formats:

**`Rgba16Float` (internal rendering):** Each pixel has four channels (R, G, B, A), each stored as a 16-bit floating-point number (half-precision). That's 8 bytes per pixel. Half-floats provide a range of roughly ±65,504 with about 3 decimal digits of precision. Grain chose this format as a balance between precision (important for intermediate computations) and memory bandwidth.

```rust
// grain-runtime/src/renderer.rs
let output_format = TextureFormat::Rgba16Float;
```

**`Rgba8UnormSrgb` or similar (display output):** When presenting to the screen, the window surface typically uses an 8-bit-per-channel sRGB format. The display pipeline converts from the internal `Rgba16Float` to whatever the surface requires.

### Texture Creation

Grain's `TextureManager` creates textures on demand:

```rust
// grain-runtime/src/texture_manager.rs
let texture = device.create_texture(&TextureDescriptor {
    label: Some(name),
    size: wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    },
    mip_level_count: 1,
    sample_count: 1,
    dimension: wgpu::TextureDimension::D2,
    format: self.format,
    usage: TextureUsages::TEXTURE_BINDING
        | TextureUsages::RENDER_ATTACHMENT
        | TextureUsages::COPY_SRC
        | TextureUsages::COPY_DST,
    view_formats: &[],
});
```

The usage flags are important:
- `TEXTURE_BINDING`: this texture can be read by shaders (sampled)
- `RENDER_ATTACHMENT`: this texture can be used as a render target (written to by a render pass)
- `COPY_SRC`: data can be copied from this texture (needed for feedback and readback)
- `COPY_DST`: data can be copied into this texture (needed for feedback and input uploads)

Every texture in Grain's `TextureManager` gets all four flags because textures serve multiple roles — a block's output texture might be read by another block's shader, written to during rendering, and copied for feedback.

### Texture Views

You never bind a `Texture` directly to a shader. Instead, you create a `TextureView` — a description of how to interpret the texture's data. For simple 2D textures, the default view works fine:

```rust
let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
```

For texture arrays (used by tilesets), you specify a different view dimension:

```rust
// grain-runtime/src/tileset.rs
let view = texture.create_view(&TextureViewDescriptor {
    dimension: Some(TextureViewDimension::D2Array),
    ..Default::default()
});
```

This tells the GPU "treat this texture's depth layers as array layers, not 3D depth."

### Samplers

A sampler defines *how* to read from a texture. Two key properties:

**Filter mode:** What happens when you sample between pixel centers?
- `FilterMode::Nearest`: snap to the nearest pixel (pixelated look)
- `FilterMode::Linear`: interpolate between neighboring pixels (smooth)

**Address mode:** What happens when coordinates go outside [0, 1]?
- `AddressMode::ClampToEdge`: coordinates are clamped; edge pixels repeat
- `AddressMode::Repeat`: coordinates wrap around (tiling)
- `AddressMode::MirrorRepeat`: coordinates mirror at edges

Grain creates a single sampler with nearest filtering and clamp-to-edge:

```rust
// grain-runtime/src/renderer.rs
let sampler = device.create_sampler(&SamplerDescriptor {
    label: Some("texture_sampler"),
    address_mode_u: AddressMode::ClampToEdge,
    address_mode_v: AddressMode::ClampToEdge,
    address_mode_w: AddressMode::ClampToEdge,
    mag_filter: FilterMode::Nearest,
    min_filter: FilterMode::Nearest,
    mipmap_filter: FilterMode::Nearest,
    ..Default::default()
});
```

Nearest filtering is appropriate for Grain because many effects (pixelation, tilesets, dithering) rely on sharp pixel boundaries. When smooth sampling is needed, Grain handles it in the shader code itself rather than relying on hardware filtering.

### Sampling in WGSL

In the generated shader, texture sampling looks like:

```wgsl
textureSample(my_texture, tex_sampler, uv)
```

This reads the texture `my_texture` using sampler `tex_sampler` at coordinates `uv` (a `vec2f` in [0, 1] range). It returns a `vec4f` — the RGBA color at that position.

There's also `textureLoad`, which reads a specific pixel by integer coordinates without any filtering:

```wgsl
textureLoad(img, vec2i(x, y), 0)  // 0 is the mip level
```

Grain's display shader uses `textureLoad` for exact pixel-to-pixel mapping when presenting to the screen.

### Texture Usage Flags

Like buffers, textures have usage flags that control what operations are permitted:

| Flag | Meaning |
|------|---------|
| `TextureUsages::TEXTURE_BINDING` | Can be sampled in shaders |
| `TextureUsages::RENDER_ATTACHMENT` | Can be used as a render target |
| `TextureUsages::COPY_SRC` | Data can be copied from this texture |
| `TextureUsages::COPY_DST` | Data can be copied into this texture |
| `TextureUsages::STORAGE_BINDING` | Can be used as a storage texture (read-write in compute shaders) |

Grain's block textures get all four common flags because they serve multiple roles across their lifetime. A texture might be:
- Written to as a render target (RENDER_ATTACHMENT)
- Read by a downstream block's shader (TEXTURE_BINDING)
- Copied to a feedback `_prev` texture (COPY_SRC)
- Copied from a feedback current texture (COPY_DST)

### Mipmaps

Mipmaps are pre-computed downscaled versions of a texture (half-size, quarter-size, etc.) used to avoid aliasing when textures are viewed from far away. In 3D games, a texture on a distant wall might cover only a few pixels on screen. Without mipmaps, sampling a high-resolution texture for those few pixels causes aliasing artifacts (shimmering, moiré patterns). Mipmaps provide pre-filtered versions at each power-of-two size, and the GPU automatically selects the appropriate level.

Grain doesn't use mipmaps — all textures have `mip_level_count: 1`. This is appropriate because Grain's textures are always sampled at their native resolution or processed with explicit downsampling (like `pixelate`). There's no 3D perspective causing textures to appear at varying sizes.

### sRGB vs Linear Color Space

Color space is a subtle but important topic. The key insight: **the human eye doesn't perceive brightness linearly**. A physical doubling of light intensity doesn't look "twice as bright." Our perception is roughly logarithmic — we're more sensitive to differences in dark tones than in bright tones.

**sRGB** is a color space that accounts for this non-linear perception. In sRGB, a pixel value of 0.5 looks like "middle gray" to the human eye. But physically, 0.5 in sRGB corresponds to only about 21.4% of the light intensity (not 50%). The sRGB transfer function (a gamma curve of approximately 2.2) compresses more values into the dark end of the range, where our eyes are more discriminating.

**Linear** color space is physically correct. A value of 0.5 means 50% light intensity. Math works correctly in linear space: `0.5 + 0.5 = 1.0` means "add two half-intensity lights to get full intensity," which is physically accurate. In sRGB space, `0.5 + 0.5 = 1.0` wouldn't be correct — the two "sRGB 0.5" values represent much less than half intensity each.

**Why this matters for Grain:** All shader math should happen in linear space for physically correct results. If you blend two colors in sRGB space, the mid-tones come out darker than expected (because sRGB values are "gamma encoded" and the math treats them as if they were linear).

Grain's approach:
1. **Internal textures use `Rgba16Float`** — a linear format. No automatic gamma conversion happens when reading or writing.
2. **Input images are loaded as raw bytes** — the u8 values from PNG files are in sRGB space. Grain converts them to f16 but does NOT apply the sRGB-to-linear conversion. This means Grain's input processing technically treats sRGB values as linear. For most video synthesis use cases, this is acceptable.
3. **Display surface uses an sRGB format** (when available) — the GPU automatically applies the linear-to-sRGB conversion when writing to the surface. This means the display shader's output values are interpreted as linear and get the correct gamma curve applied.

This approach is pragmatic: Grain isn't doing physically-based rendering where color accuracy is critical. For video synthesis, the slight color inaccuracy of treating inputs as linear is barely noticeable, and it simplifies the pipeline significantly.


## Chapter 6: Render Passes

A render pass is the fundamental unit of GPU work. It describes: what are we rendering to, how should it be initialized, and what draw commands should execute.

### Command Encoding

The GPU doesn't execute commands immediately. Instead, you record commands into a command buffer, then submit the entire buffer to the GPU's work queue. This batching is essential for performance — it amortizes the overhead of CPU-GPU communication.

```rust
// Create a command encoder
let mut encoder = self.device.create_command_encoder(&CommandEncoderDescriptor {
    label: Some(block_id),
});

// Record commands (render passes, copies, etc.)
// ... (see below)

// Submit to the GPU queue
self.queue.submit(std::iter::once(encoder.finish()));
```

The `encoder.finish()` call consumes the encoder and produces a `CommandBuffer`. Passing it to `queue.submit()` sends it to the GPU for execution. The GPU processes submitted command buffers in order, but internally the GPU hardware pipelines and parallelizes the work.

### Render Pass Descriptors

A render pass needs to know where it's rendering to and how to initialize the target. Here's how Grain sets up a render pass for a block:

```rust
// grain-runtime/src/renderer.rs — render_block()
let mut render_pass = encoder.begin_render_pass(&RenderPassDescriptor {
    label: Some(block_id),
    color_attachments: &[Some(RenderPassColorAttachment {
        view: target_view,
        resolve_target: None,
        ops: Operations {
            load: LoadOp::Clear(Color::BLACK),
            store: StoreOp::Store,
        },
    })],
    depth_stencil_attachment: None,
    timestamp_writes: None,
    occlusion_query_set: None,
});
```

The key parts:

**`color_attachments`:** The texture(s) being rendered to. Grain uses a single color attachment — the block's output texture. The `view` field is a `TextureView` pointing to the target texture.

**`load: LoadOp::Clear(Color::BLACK)`:** At the start of the render pass, clear the target to black. The alternative is `LoadOp::Load`, which preserves the existing contents. Grain always clears because each block computes its output from scratch.

**`store: StoreOp::Store`:** At the end of the render pass, keep the rendered results. The alternative is `StoreOp::Discard`, which is used for temporary render targets that don't need to persist (like depth buffers in 3D rendering). Grain always stores because the output texture may be read by subsequent blocks.

**`depth_stencil_attachment: None`:** Grain doesn't use depth testing (it's 2D rendering), so no depth buffer is needed.

### Drawing

Within a render pass, you set the pipeline, bind resources, and issue draw calls:

```rust
render_pass.set_pipeline(&block_pipeline.pipeline);
render_pass.set_bind_group(0, &bind_group, &[]);
render_pass.draw(0..3, 0..1);
```

`set_pipeline` tells the GPU which shader to use and how to interpret the draw call.

`set_bind_group(0, &bind_group, &[])` binds resources (textures, samplers, uniform buffers) at group 0. The empty `&[]` is for dynamic offsets, which Grain doesn't use.

`draw(0..3, 0..1)` issues the actual draw command: draw 3 vertices (a single triangle), 1 instance. The GPU's vertex shader will be invoked with `vertex_index` values 0, 1, and 2. The rasterizer will determine which pixels the triangle covers. The fragment shader will run for each covered pixel.

### Multiple Render Passes in One Encoder

A command encoder can contain multiple render passes. Each render pass begins with `begin_render_pass` and ends when the `RenderPass` object is dropped (in Rust, this happens at the end of the enclosing scope). Between render passes within the same encoder, you can also record non-pass commands like texture copies.

Grain uses a single render pass per encoder per block, then submits immediately. A more optimized approach might batch multiple blocks into one command buffer:

```rust
// Hypothetical batched approach:
let mut encoder = device.create_command_encoder(&Default::default());
for block in blocks {
    // render pass for block A
    { let mut rp = encoder.begin_render_pass(...); rp.draw(...); }
    // render pass for block B
    { let mut rp = encoder.begin_render_pass(...); rp.draw(...); }
}
queue.submit(std::iter::once(encoder.finish()));
```

### Why Grain Submits Per-Block

Grain actually submits a separate command buffer for each block:

```rust
self.queue.submit(std::iter::once(encoder.finish()));
```

This ensures that each block's output is fully written before the next block reads it. Within a single command buffer, wgpu guarantees that render passes execute in order and that writes from one pass are visible to subsequent passes (this is specified by the WebGPU spec's implicit synchronization rules). So batching would work correctly.

However, per-block submission is simpler to reason about and works reliably. The overhead of multiple submissions is small compared to the actual rendering work. If profiling showed submission overhead to be significant, batching would be a straightforward optimization.

### Load and Store Operations

The `load` and `store` operations on color attachments deserve deeper explanation because they have real performance implications:

**`LoadOp::Clear(color)`:** The GPU's tile-based renderers (common on mobile and Apple GPUs) can clear a tile without loading the previous contents from memory. This saves memory bandwidth. For GPUs with immediate-mode rendering (most desktop GPUs), clear is essentially free — it sets up hardware state before the first pixel is drawn.

**`LoadOp::Load`:** The GPU must read the existing texture contents into the render pass's working memory. This costs memory bandwidth but is necessary when you want to draw on top of existing content (like adding a UI overlay).

**`StoreOp::Store`:** Write the results back to the texture. This is the normal case — you want to keep what you rendered.

**`StoreOp::Discard`:** Don't bother writing results back. Used for temporary buffers (like depth/stencil buffers that aren't needed after the pass). On tile-based GPUs, this saves significant bandwidth.

Grain always clears and stores. The clear is appropriate because each block computes all its pixels from scratch. The store is necessary because the texture is read by downstream blocks.


## Chapter 7: Compute vs Render

GPUs can do more than graphics. They also support **compute shaders** — general-purpose programs that run on the GPU without the graphics pipeline's stages. Compute shaders are used for physics simulation, machine learning, image processing, and other parallelizable workloads.

### How Compute Shaders Differ

A compute shader doesn't have the graphics pipeline's fixed-function stages. There's no vertex input, no rasterization, no automatic output to a render target. Instead, you dispatch a grid of **workgroups**, each containing a fixed number of **invocations** (threads). Each invocation knows its position in the grid (via `@builtin(global_invocation_id)`) and can read/write storage buffers and storage textures.

```wgsl
// Hypothetical compute shader (not used by Grain)
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let x = id.x;
    let y = id.y;
    let color = compute_pixel(x, y);
    textureStore(output, vec2u(x, y), color);
}
```

wgpu supports both compute and render pipelines through `ComputePipeline` (created with `create_compute_pipeline`) and `RenderPipeline`. Compute pipelines are dispatched via `compute_pass.dispatch_workgroups(x, y, z)` instead of `render_pass.draw()`.

### Key Differences from Render Pipelines

| Aspect | Render Pipeline | Compute Pipeline |
|--------|----------------|-----------------|
| Stages | Vertex + Fragment (programmable) + fixed-function | Single compute stage |
| Output | Writes to color attachments automatically | Must explicitly write to storage textures/buffers |
| Input | `@builtin(position)` provides pixel coords | `@builtin(global_invocation_id)` provides thread ID |
| Texture access | `textureSample` (with filtering) | `textureLoad`/`textureStore` (no filtering) |
| Synchronization | Automatic between passes | Must manage barriers manually |
| Shared memory | None | Workgroup shared memory available |

### Why Grain Uses Render Pipelines

**Grain uses the render pipeline exclusively.** The fragment shader model — "for each pixel, compute a color" — maps perfectly to Grain's domain. Several advantages make render pipelines the right choice:

1. **Automatic pixel iteration.** The rasterizer generates fragments for every pixel in the render target. With compute, you'd need to calculate dispatch dimensions and handle edge cases when the image size isn't divisible by the workgroup size.

2. **Built-in texture sampling.** Fragment shaders can use `textureSample` with hardware-accelerated filtering. Compute shaders can only use `textureLoad` (exact pixel reads) — implementing bilinear filtering manually is possible but slower.

3. **Natural output writing.** The fragment shader's return value is automatically written to the color attachment. In compute, you'd need to call `textureStore` explicitly and handle the storage texture format constraints.

4. **No shared state needed.** Each pixel in Grain is truly independent. Compute shaders' workgroup shared memory (which allows threads in the same group to communicate) is unused. The overhead of managing workgroup dimensions and barriers provides no benefit.

Compute shaders would be useful if Grain needed to do reductions (like computing the average brightness of an image), histogram analysis, or algorithms with complex data dependencies between pixels. For its current design as a per-pixel synthesis tool, the render pipeline is the right choice.

---

# Part II: wgpu in Practice — The Grain Renderer

## Chapter 8: wgpu Overview

wgpu is a Rust-native implementation of the WebGPU specification. It provides a safe, cross-platform API for GPU programming that works on Vulkan, Metal, DX12, and WebGL2 backends. When you write code against wgpu, it translates your calls to whatever graphics API the platform supports — Vulkan on Linux, Metal on macOS, DX12 on Windows.

### Why wgpu?

Before wgpu, Rust GPU programming options were limited:
- **Raw Vulkan** (via `ash` or `vulkano`): Maximum control, maximum complexity. Vulkan requires explicit memory management, synchronization, and hundreds of lines of boilerplate for basic rendering.
- **gfx-hal**: A Rust abstraction over Vulkan/Metal/DX12, but still low-level and eventually deprecated in favor of wgpu.
- **OpenGL** (via `gl` or `glium`): Simpler but dated, with a stateful API design that's error-prone and doesn't map well to modern GPU hardware.

wgpu occupies the sweet spot: it's high-level enough to handle memory management and synchronization automatically, but low-level enough for serious GPU programming. Its API is modeled on WebGPU — a modern standard designed with decades of GPU API experience behind it. Key properties:

**Safe by default.** wgpu validates every API call (in debug mode) and prevents undefined behavior. You can't accidentally use a buffer that hasn't been mapped, or bind a texture with the wrong format, or read from a texture while writing to it. Compare this to Vulkan, where such errors corrupt memory silently.

**Cross-platform.** The same Rust code runs on macOS (Metal), Windows (DX12), Linux (Vulkan), and even in web browsers (WebGPU/WebGL2). Grain can run on all these platforms without changing a line of rendering code.

**Explicit but manageable.** You explicitly create resources, record commands, and submit work. But you don't manage memory allocations, pipeline barriers, or descriptor pools — wgpu handles these internally.

### The Initialization Chain

Every wgpu application starts with the same sequence of initialization steps:

```
Instance ──► Adapter ──► Device + Queue
```

**Instance:** The entry point to wgpu. It represents the GPU subsystem and lets you discover available GPU hardware.

**Adapter:** Represents a specific GPU on the system. You request an adapter with preferences (like "give me a high-performance GPU"), and wgpu finds one that matches.

**Device:** A logical connection to the GPU. It's your handle for creating resources (buffers, textures, pipelines) and recording commands. Multiple devices can exist simultaneously, but each has its own resource namespace.

**Queue:** The submission queue for the device. You submit command buffers to the queue, and the GPU processes them in order.

### How Grain Initializes

Grain has two initialization paths: one for standalone rendering (export mode) and one for live preview. The standalone path in `Renderer::new()`:

```rust
// grain-runtime/src/renderer.rs
pub async fn new(width: u32, height: u32) -> Result<Self, String> {
    let instance = Instance::default();

    let adapter = instance
        .request_adapter(&RequestAdapterOptions {
            power_preference: PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
        .ok_or_else(|| "Failed to find GPU adapter".to_string())?;

    let (device, queue) = adapter
        .request_device(
            &DeviceDescriptor {
                label: Some("Grain Renderer"),
                required_features: Features::empty(),
                required_limits: Limits::default(),
                memory_hints: MemoryHints::Performance,
            },
            None,
        )
        .await
        .map_err(|e| format!("Failed to create device: {}", e))?;

    Ok(Self::from_device(device, queue, width, height))
}
```

Note several things:

**`PowerPreference::HighPerformance`:** On systems with multiple GPUs (like a laptop with integrated and discrete graphics), this requests the more powerful GPU.

**`compatible_surface: None`:** In export mode, there's no window, so no surface compatibility is needed. The live preview path (in `live.rs`) also passes `None` here because the adapter is requested before the window exists.

**`Features::empty()`:** Grain doesn't require any optional GPU features. It runs on the baseline WebGPU feature set, which ensures maximum compatibility.

**`Limits::default()`:** Uses the default resource limits (max texture size, max buffer size, etc.). These defaults are generous enough for Grain's needs.

**`MemoryHints::Performance`:** Tells wgpu to prefer speed over memory efficiency when allocating GPU memory.

The `from_device` constructor does the rest — creates the sampler, uniform buffer, and initializes the texture manager:

```rust
pub fn from_device(device: Device, queue: Queue, width: u32, height: u32) -> Self {
    let output_format = TextureFormat::Rgba16Float;

    let sampler = device.create_sampler(&SamplerDescriptor {
        label: Some("texture_sampler"),
        address_mode_u: AddressMode::ClampToEdge,
        address_mode_v: AddressMode::ClampToEdge,
        address_mode_w: AddressMode::ClampToEdge,
        mag_filter: FilterMode::Nearest,
        min_filter: FilterMode::Nearest,
        mipmap_filter: FilterMode::Nearest,
        ..Default::default()
    });

    let params = RenderParams::new(width, height);
    let params_buffer = device.create_buffer_init(&util::BufferInitDescriptor {
        label: Some("params_buffer"),
        contents: bytemuck::cast_slice(&[params]),
        usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
    });

    Self {
        device,
        queue,
        texture_manager: TextureManager::new(output_format),
        block_pipelines: HashMap::new(),
        params_buffer,
        sampler,
        output_format,
        tileset_textures: HashMap::new(),
        base_dir: None,
    }
}
```

### The Live Preview Path

The live preview (`live.rs`) initializes differently because it needs a window and surface. It creates the `Instance` and `Adapter` at the top level, then passes the `Device` and `Queue` to `Renderer::from_device()`:

```rust
// grain/src/live.rs
let instance = Instance::default();
let adapter = instance
    .request_adapter(&RequestAdapterOptions {
        power_preference: PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    })
    .await
    .ok_or("Failed to find GPU adapter")?;

let (device, queue) = adapter
    .request_device(
        &DeviceDescriptor {
            label: Some("Grain Live"),
            required_features: Features::empty(),
            required_limits: Limits::default(),
            memory_hints: MemoryHints::Performance,
        },
        None,
    )
    .await?;

// Renderer takes ownership of device + queue
let mut renderer = Renderer::from_device(device, queue, width, height);
```

The live preview keeps references to the `Instance` and `Adapter` because it needs them later to create the window surface. The `Renderer` takes ownership of the `Device` and `Queue` and exposes them via accessor methods (`renderer.device()`, `renderer.queue()`) for the display pipeline to use.

### Why `async`?

You'll notice `request_adapter` and `request_device` are both `async`. On native platforms (Vulkan, Metal, DX12), they complete immediately — the async is there for WebGPU compatibility, where these operations genuinely need to communicate with the browser's GPU process. Grain uses `pollster::block_on` or tokio's runtime to drive these futures, but they never actually yield.

### Labels

Every wgpu resource takes an optional `label: Some("...")`. These labels appear in GPU debugging tools (like RenderDoc, Xcode's GPU debugger, or PIX) and in wgpu's error messages. When a shader compilation fails or a validation error occurs, the label tells you *which* resource caused the problem. Grain uses descriptive labels throughout:

```rust
label: Some("Grain Renderer")      // device
label: Some("params_buffer")        // uniform buffer
label: Some("texture_sampler")      // sampler
label: Some(block_id)               // per-block shader modules and pipelines
```

In production, labels have near-zero overhead — they're just string pointers stored alongside the resource handle.


## Chapter 9: Shader Modules

A shader module is a compiled WGSL program loaded onto the GPU. Grain creates one shader module per block — each block has its own vertex + fragment shader pair.

### Creating a Shader Module

```rust
// grain-runtime/src/renderer.rs — create_pipeline()
let shader = self.device.create_shader_module(ShaderModuleDescriptor {
    label: Some(block_id),
    source: ShaderSource::Wgsl(shader_output.code.as_str().into()),
});
```

The `ShaderSource::Wgsl` variant takes a `Cow<str>` — the WGSL source code as a string. The `.into()` converts from `&str` to `Cow::Borrowed`.

### The Compilation Pipeline

The path from Grain source to GPU execution has several stages:

```
.grain file ──► Parser ──► AST ──► Dependency Graph ──► WGSL strings ──► Shader Modules
```

1. **Parser** (`grain-lang`): Converts Grain source text into an AST
2. **Dependency graph** (`block_compiler.rs`): Splits the program into blocks based on named expressions and feedback patterns
3. **WGSL generation** (`fragment_codegen.rs`): Each block's expression tree is translated into a WGSL fragment shader
4. **Shader module creation** (`renderer.rs`): wgpu compiles the WGSL string into GPU machine code

### Naga Validation

Under the hood, wgpu uses **naga** — a shader translation and validation library — to process WGSL. When you call `create_shader_module`, naga:

1. Parses the WGSL text into naga's internal IR (intermediate representation)
2. Validates the shader: type checking, resource binding validation, ensures no undefined variables, checks that built-in functions receive the correct number and types of arguments
3. Translates to the backend's native shader format (MSL for Metal, SPIR-V for Vulkan, HLSL for DX12)

If the WGSL has a syntax error or type error, `create_shader_module` will panic (in debug) or return an error through wgpu's error handling. Grain's compiler aims to produce valid WGSL, but GPU shader errors can be surprising — type mismatches, missing bindings, or alignment issues that are hard to catch at the Rust level.

Common naga errors you might encounter when working on Grain's code generation:

- **"expected 'f32', found 'u32'"** — WGSL doesn't implicitly convert between integer and float types. You must use `f32(my_uint)` explicitly. Grain's codegen handles this in several places, like converting `params.frame` (which is `u32`) to `f32` for arithmetic.
- **"unknown function 'foo'"** — A WGSL function was called that doesn't exist. This can happen if a Grain built-in function's code generation forgot to include the necessary helper function.
- **"binding 3 is not present in the layout"** — The shader declares a binding that doesn't match the bind group layout. This typically means the codegen and the layout builder are out of sync.
- **"texture sample type must be compatible"** — The shader declares a texture as `texture_2d<f32>` but the bind group provides a texture with an incompatible sample type. This can happen when format mismatches occur.

### Shader Module Lifetime

Once created, a shader module is immutable. It's used when creating render pipelines (which reference the module for vertex and fragment stages). The shader module itself doesn't hold GPU resources beyond the compiled shader program — it's lightweight to keep alive. In Grain, shader modules are consumed during pipeline creation and don't need to be stored separately.

### The Shader Output Structure

The Grain compiler produces a `ShaderOutput` for each block:

```rust
// grain-compiler/src/types.rs (inferred from usage)
pub struct ShaderOutput {
    pub code: String,              // The WGSL source code
    pub texture_bindings: Vec<TextureBinding>,  // What textures this shader needs
    pub tileset_bindings: Vec<TilesetBinding>,  // What tilesets this shader needs
    pub has_sampler: bool,         // Whether a sampler binding is needed
    pub params_binding: u32,       // The binding index for the params uniform
}
```

This structure carries both the shader code and metadata about what resources it needs. The renderer uses this metadata to create the correct bind group layout and bind group for each block.


## Chapter 10: Uniform Buffers

Uniform buffers are how the CPU sends small, frequently-changing data to shaders. "Uniform" means the data is the same for every invocation of the shader within a draw call — every pixel sees the same time value, the same frame number, the same knob positions.

### Uniform vs Storage vs Push Constants

wgpu provides several mechanisms for passing data to shaders. Understanding why Grain chose uniform buffers requires knowing the alternatives:

**Uniform buffers** (`var<uniform>`): Read-only in shaders, limited to 64 KB (the minimum guaranteed maximum), optimized for broadcasting the same data to all invocations. Hardware stores uniform data in a special fast-access memory and broadcasts reads to all threads in a group simultaneously.

**Storage buffers** (`var<storage>`): Read-write in compute shaders, read-only or read-write in fragment shaders (with extensions), can be much larger (up to 128 MB+). Slower than uniform buffers because the hardware can't assume broadcast access. Useful for large arrays of data where each thread reads a different element.

**Push constants** (`push_constant_ranges` in the pipeline layout): Small amounts of data (typically 128-256 bytes) embedded directly in the command stream. Fastest possible access, but very limited size and not available in the base WebGPU spec (it's a wgpu extension).

Grain uses a uniform buffer because the data is small (288 bytes), read-only, and identical for all pixels — the perfect use case. The 288 bytes fit comfortably within the 64 KB limit, and the hardware can broadcast every read to all threads without contention.

### The RenderParams Struct

Grain's uniform data is defined in `params.rs`:

```rust
// grain-runtime/src/params.rs
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct RenderParams {
    pub time: f32,
    pub frame: u32,
    pub width: u32,
    pub height: u32,
    pub beat_info: [f32; 4],
    pub knobs: [[f32; 4]; 16],
}
```

**`time: f32`** — Elapsed time in seconds since the program started. Used by Grain's `time` builtin, and internally for `hold_ms` computations.

**`frame: u32`** — Frame counter, incrementing each frame. Used by `frame` builtin, `hold_every` (modulo frame count), and frame-dependent noise seeds.

**`width: u32, height: u32`** — Output texture dimensions in pixels. Used to convert pixel positions to UV coordinates in the shader.

**`beat_info: [f32; 4]`** — Musical timing data. `beat_info[0]` stores the BPM (beats per minute). The remaining channels are reserved for future use.

**`knobs: [[f32; 4]; 16]`** — Control surface values. Each knob, toggle, button, or sequencer in the Grain program gets an index into this array. The value is broadcast across all four channels (so `knobs[3]` might be `[0.75, 0.75, 0.75, 1.0]`), which makes it easy to use as a `vec4f` in the shader. The 16-element limit means a Grain program can have up to 16 control surface elements.

### Buffer Update

Each frame, the renderer updates the uniform buffer:

```rust
// grain-runtime/src/renderer.rs — render_to_texture()
let mut params = RenderParams::new(options.width, options.height);
params.time = options.time;
params.frame = options.frame;
params.set_bpm(options.bpm);
for (i, knob_val) in options.knobs.iter().enumerate() {
    params.set_knob(i, *knob_val);
}
self.queue
    .write_buffer(&self.params_buffer, 0, bytemuck::cast_slice(&[params]));
```

`queue.write_buffer()` is a convenience method that stages a CPU-to-GPU copy. The data is copied immediately into a staging buffer and will be available on the GPU before the next submitted command buffer executes. This is simpler than creating an explicit staging buffer and copy command.

### WGSL Side

The generated shader declares the uniform struct to match:

```wgsl
struct Params {
    time: f32,
    frame: u32,
    width: u32,
    height: u32,
    beat_info: vec4f,
    knobs: array<vec4f, 16>,
}

@group(0) @binding(N) var<uniform> params: Params;
```

The binding index `N` varies per block because it comes after the texture and sampler bindings. The `var<uniform>` declaration tells WGSL this is a uniform buffer — read-only, same for all shader invocations.

Accessing uniform data in the shader is straightforward:

```wgsl
// In fs_main:
let uv = vec2f(pos.x / f32(params.width), pos.y / f32(params.height));
```

```wgsl
// Generated from Grain's `time` builtin:
vec4f(params.time, params.time, params.time, 1.0)
```

```wgsl
// Generated from a Grain knob at index 5:
vec4f(params.knobs[5].x, params.knobs[5].x, params.knobs[5].x, 1.0)
```

### The Knob Array Design

The `knobs` array uses `[[f32; 4]; 16]` (an array of 16 `vec4f` values) rather than a flat `[f32; 16]`. This is a deliberate design choice driven by WGSL alignment rules: an `array<f32, 16>` in WGSL has each element at 4-byte stride, but `array<vec4f, 16>` has each element at 16-byte stride. By storing knob values as `vec4f`, each knob is naturally aligned and can be used directly as a vector in the shader without awkward extraction.

When a knob value is set on the CPU:

```rust
pub fn set_knob(&mut self, index: usize, value: f32) {
    if index < 16 {
        self.knobs[index][0] = value;  // x
        self.knobs[index][1] = value;  // y
        self.knobs[index][2] = value;  // z
        self.knobs[index][3] = 1.0;    // w (alpha)
    }
}
```

The value is broadcast to all four channels. This means `params.knobs[5]` in the shader is already a valid `vec4f` representing a grayscale color at the knob's value, which can be used directly in arithmetic without conversion. If the value is 0.75, the shader sees `vec4f(0.75, 0.75, 0.75, 1.0)`.

The `set_surface_value` method provides an alternative that sets only the `.x` channel, used for surface elements like step sequencers where the y/z/w channels might carry different information in the future.


## Chapter 11: Textures as Render Targets

One of the most powerful capabilities of the GPU is rendering to textures instead of the screen. This is how Grain implements its multi-block pipeline: each block renders its output to an offscreen texture, and downstream blocks can sample those textures as inputs.

### Creating Offscreen Textures

Grain's `TextureManager` lazily creates textures when they're first needed:

```rust
// grain-runtime/src/texture_manager.rs
pub(crate) fn get_or_create(
    &mut self,
    device: &Device,
    name: &str,
    width: u32,
    height: u32,
) -> &TextureView {
    if !self.textures.contains_key(name) {
        let texture = device.create_texture(&TextureDescriptor {
            label: Some(name),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: TextureUsages::TEXTURE_BINDING
                | TextureUsages::RENDER_ATTACHMENT
                | TextureUsages::COPY_SRC
                | TextureUsages::COPY_DST,
            view_formats: &[],
        });

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.textures.insert(name.to_string(), texture);
        self.views.insert(name.to_string(), view);
    }

    &self.views[name]
}
```

Every texture has both `TEXTURE_BINDING` (can be read by shaders) and `RENDER_ATTACHMENT` (can be written by render passes). This dual role is the key: a texture starts as a render target for one block, then becomes an input texture for the next block.

### Using a Texture as a Color Attachment

In `render_block`, the target texture's view becomes the color attachment:

```rust
// grain-runtime/src/renderer.rs — render_block()
let target_view = self
    .texture_manager
    .get_view(block_id)
    .ok_or_else(|| format!("Target texture '{}' not found", block_id))?;

let mut render_pass = encoder.begin_render_pass(&RenderPassDescriptor {
    label: Some(block_id),
    color_attachments: &[Some(RenderPassColorAttachment {
        view: target_view,
        resolve_target: None,
        ops: Operations {
            load: LoadOp::Clear(Color::BLACK),
            store: StoreOp::Store,
        },
    })],
    depth_stencil_attachment: None,
    timestamp_writes: None,
    occlusion_query_set: None,
});
```

The GPU will write the fragment shader's output color into this texture for every pixel. After the render pass completes and the command buffer is submitted, the texture contains the block's computed image.

### Reading a Texture as Shader Input

When a downstream block references an upstream block, the upstream's texture is bound as a shader input. In the generated WGSL:

```wgsl
@group(0) @binding(0) var tex_block_a: texture_2d<f32>;
@group(0) @binding(1) var tex_sampler: sampler;

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = vec2f(pos.x / f32(params.width), pos.y / f32(params.height));
    // Reference to block_a becomes a texture sample:
    let val = textureSample(tex_block_a, tex_sampler, uv);
    // ... further operations on val ...
}
```

The renderer binds the actual texture view in the bind group:

```rust
// grain-runtime/src/renderer.rs — create_bind_group()
for tex_binding in &shader_output.texture_bindings {
    let tex_name = match &tex_binding.source {
        TextureSource::Dependency(dep_id) => dep_id.clone(),
        TextureSource::Input(n) => format!("input_{}", n),
        TextureSource::Feedback(n) => format!("feedback_{}_prev", n),
    };

    let view = self
        .texture_manager
        .get_view(&tex_name)
        .ok_or_else(|| format!("Texture '{}' not found", tex_name))?;

    entries.push(BindGroupEntry {
        binding,
        resource: BindingResource::TextureView(view),
    });
    binding += 1;
}
```

### The Multi-Pass Pattern

This render-then-read pattern is the foundation of Grain's multi-block system:

```
Block A: render to texture_A
Block B: read texture_A, render to texture_B
Block C: read texture_A and texture_B, render to texture_C (output)
```

Each block sees its dependency textures as if they were ordinary images. The fact that they were computed by other shaders moments earlier is transparent to the shader code.

### Texture Hazards and Synchronization

A critical rule in GPU programming: you cannot read from and write to the same texture in the same render pass. This would create a *read-after-write hazard* — the GPU might read stale data before the write completes, or the results might be undefined depending on the order in which pixel tiles are processed.

wgpu enforces this: if you try to bind a texture as both a color attachment and a texture binding in the same render pass, it's a validation error. Grain avoids this naturally because each block renders to its *own* texture and only reads from *other* blocks' textures.

Between render passes (especially in different command buffer submissions), wgpu handles synchronization automatically. When block B reads texture_A, wgpu ensures that block A's render pass has completed before block B's fragment shader samples from it. You don't need to insert explicit barriers or fences — this is one of the advantages of the WebGPU/wgpu model over lower-level APIs like Vulkan.

### Why Not Render Everything in One Pass?

You might wonder: why not compile the entire Grain program into a single shader that computes everything in one pass?

For simple programs, this would work. But several features require multiple passes:

1. **Filter functions (blur, sharpen, etc.):** A blur reads neighboring pixels from its input. If the input is a complex expression, that expression would be evaluated multiple times — once for each neighboring sample. With a separate pass, the input is rendered once to a texture, and the blur just reads 9 texels.

2. **Feedback:** By definition, feedback reads the output from a previous frame. This requires the output to exist as a persistent texture.

3. **Multiple references:** If a `let` binding is referenced by multiple downstream expressions, computing it once to a texture avoids redundant evaluation.

4. **Shader length limits:** GPUs have practical limits on shader instruction counts. A monolithic shader for a complex program might exceed these limits.


### Texture Manager and Resource Lifecycle

Grain's `TextureManager` provides a simple lazy-allocation pattern for textures:

```rust
// grain-runtime/src/texture_manager.rs
pub(crate) struct TextureManager {
    pub(crate) textures: HashMap<String, Texture>,
    views: HashMap<String, TextureView>,
    format: TextureFormat,
}
```

Textures are identified by string names (`"output"`, `"bg"`, `"feedback_0"`, `"feedback_0_prev"`, etc.) and created on first access. This lazy approach means the renderer doesn't need to know in advance how many textures a program needs — they're created as `render_block` encounters them.

When the output resolution changes (e.g., the user resizes the window), all textures must be recreated at the new size:

```rust
pub(crate) fn resize(&mut self, device: &Device, width: u32, height: u32) {
    let names: Vec<String> = self.textures.keys().cloned().collect();
    self.clear();
    for name in names {
        self.get_or_create(device, &name, width, height);
    }
}
```

This destroys all existing textures and creates new ones at the new dimensions. Any data in the old textures (including feedback state) is lost. This is acceptable because resizing is an infrequent operation and feedback state can be rebuilt by rendering a few frames.

When a program is hot-reloaded, `load_program` clears the pipeline map:

```rust
pub fn load_program(&mut self, program: &CompiledProgram) -> Result<(), String> {
    self.block_pipelines.clear();
    self.tileset_textures.clear();
    // ... create new pipelines ...
}
```

Note that the `texture_manager` is NOT cleared during hot reload — existing textures persist. This means if the old program had a block named "bg" and the new program also has one, the old texture is reused (and overwritten on the next render). If the new program removed a block, the old texture lingers harmlessly.

### GPU Resource Cleanup

wgpu uses Rust's ownership system for resource management. When you drop a `Texture`, `Buffer`, `RenderPipeline`, or other GPU resource, wgpu schedules its GPU memory for deallocation. The actual deallocation happens asynchronously — the GPU might still be using the resource for in-flight commands. wgpu tracks this internally and frees the memory once the GPU is done with it.

This means you don't need to worry about use-after-free or double-free at the GPU level. Rust's borrow checker ensures you can't use a reference to a dropped resource, and wgpu's internal reference counting ensures GPU memory is freed at the right time.

## Chapter 12: Bind Groups and Layouts

Bind groups are how GPU resources (textures, samplers, buffers) are connected to shader bindings. They're the glue between the CPU-side resource management and the GPU-side shader declarations.

### Bind Group Layouts

A bind group layout declares what types of resources a shader expects at each binding index. Grain creates one layout per block:

```rust
// grain-runtime/src/renderer.rs — create_bind_group_layout()
fn create_bind_group_layout(&self, shader_output: &ShaderOutput) -> BindGroupLayout {
    let mut entries = Vec::new();
    let mut binding = 0u32;

    // Texture bindings
    for _ in &shader_output.texture_bindings {
        entries.push(BindGroupLayoutEntry {
            binding,
            visibility: ShaderStages::FRAGMENT,
            ty: BindingType::Texture {
                multisampled: false,
                view_dimension: TextureViewDimension::D2,
                sample_type: TextureSampleType::Float { filterable: true },
            },
            count: None,
        });
        binding += 1;
    }

    // Tileset bindings (texture arrays)
    for _ in &shader_output.tileset_bindings {
        entries.push(BindGroupLayoutEntry {
            binding,
            visibility: ShaderStages::FRAGMENT,
            ty: BindingType::Texture {
                multisampled: false,
                view_dimension: TextureViewDimension::D2Array,
                sample_type: TextureSampleType::Float { filterable: true },
            },
            count: None,
        });
        binding += 1;
    }

    // Sampler
    if shader_output.has_sampler {
        entries.push(BindGroupLayoutEntry {
            binding,
            visibility: ShaderStages::FRAGMENT,
            ty: BindingType::Sampler(SamplerBindingType::Filtering),
            count: None,
        });
        binding += 1;
    }

    // Params uniform
    entries.push(BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::FRAGMENT,
        ty: BindingType::Buffer {
            ty: BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    });

    self.device.create_bind_group_layout(&BindGroupLayoutDescriptor {
        label: Some("bgl"),
        entries: &entries,
    })
}
```

Each entry describes one binding slot:

- **`binding`:** The index that matches `@binding(N)` in WGSL
- **`visibility: ShaderStages::FRAGMENT`:** Only the fragment shader accesses these resources (the vertex shader in Grain doesn't need any external data)
- **`ty`:** The resource type — `Texture`, `Sampler`, or `Buffer`
- **`TextureViewDimension::D2`** for regular textures, **`D2Array`** for tilesets
- **`SamplerBindingType::Filtering`** means the sampler supports filtered reads (bilinear interpolation), as opposed to `NonFiltering` which only allows nearest-neighbor

### Grain's Dynamic Binding Pattern

The binding layout varies between blocks because each block references different textures. A simple block with no texture dependencies might have:

```
binding 0: uniform buffer (params)
```

A block that references two other blocks and uses a tileset might have:

```
binding 0: texture_2d (block_a output)
binding 1: texture_2d (block_b output)
binding 2: texture_2d_array (tileset)
binding 3: sampler
binding 4: uniform buffer (params)
```

The order is always: textures first, then tilesets, then sampler (if needed), then params. The `fragment_codegen.rs` `build_shader` method generates the WGSL `@binding` annotations in this same order, and `create_bind_group_layout` constructs the layout to match.

### Bind Groups

Once the layout is defined, a bind group provides the actual resources:

```rust
// grain-runtime/src/renderer.rs — create_bind_group()
fn create_bind_group(
    &self,
    block_id: &str,
    shader_output: &ShaderOutput,
) -> Result<BindGroup, String> {
    let mut entries = Vec::new();
    let mut binding = 0u32;

    // Texture bindings — provide actual texture views
    for tex_binding in &shader_output.texture_bindings {
        let tex_name = match &tex_binding.source {
            TextureSource::Dependency(dep_id) => dep_id.clone(),
            TextureSource::Input(n) => format!("input_{}", n),
            TextureSource::Feedback(n) => format!("feedback_{}_prev", n),
        };
        let view = self.texture_manager.get_view(&tex_name)
            .ok_or_else(|| format!("Texture '{}' not found", tex_name))?;
        entries.push(BindGroupEntry {
            binding,
            resource: BindingResource::TextureView(view),
        });
        binding += 1;
    }

    // Tileset bindings — provide texture array views
    for ts_binding in &shader_output.tileset_bindings {
        let ts_tex = self.tileset_textures.get(&ts_binding.path)
            .ok_or_else(|| format!("Tileset '{}' not loaded", ts_binding.path))?;
        entries.push(BindGroupEntry {
            binding,
            resource: BindingResource::TextureView(&ts_tex.view),
        });
        binding += 1;
    }

    // Sampler
    if shader_output.has_sampler {
        entries.push(BindGroupEntry {
            binding,
            resource: BindingResource::Sampler(&self.sampler),
        });
        binding += 1;
    }

    // Params buffer
    entries.push(BindGroupEntry {
        binding,
        resource: self.params_buffer.as_entire_binding(),
    });

    Ok(self.device.create_bind_group(&BindGroupDescriptor {
        label: Some(&format!("{}_bind_group", block_id)),
        layout: &block_pipeline.bind_group_layout,
        entries: &entries,
    }))
}
```

The bind group is created fresh for each render call (not cached), because the texture views might change if textures are resized. The `as_entire_binding()` on the params buffer creates a `BindingResource::Buffer` that references the entire buffer.


## Chapter 13: The Render Pipeline

A render pipeline is a compiled, immutable description of the entire rendering configuration: which shaders to use, what vertex format to expect, how to blend colors, and what output format to target. Creating a pipeline is expensive (it compiles shaders), but using one is cheap.

### Pipeline Creation in Grain

```rust
// grain-runtime/src/renderer.rs — create_pipeline()
let pipeline = self.device.create_render_pipeline(&RenderPipelineDescriptor {
    label: Some(block_id),
    layout: Some(&pipeline_layout),
    vertex: VertexState {
        module: &shader,
        entry_point: "vs_main",
        compilation_options: Default::default(),
        buffers: &[],
    },
    fragment: Some(FragmentState {
        module: &shader,
        entry_point: "fs_main",
        compilation_options: Default::default(),
        targets: &[Some(ColorTargetState {
            format: self.output_format,
            blend: Some(BlendState::REPLACE),
            write_mask: ColorWrites::ALL,
        })],
    }),
    primitive: PrimitiveState {
        topology: PrimitiveTopology::TriangleList,
        strip_index_format: None,
        front_face: FrontFace::Ccw,
        cull_mode: None,
        polygon_mode: PolygonMode::Fill,
        unclipped_depth: false,
        conservative: false,
    },
    depth_stencil: None,
    multisample: MultisampleState {
        count: 1,
        mask: !0,
        alpha_to_coverage_enabled: false,
    },
    multiview: None,
    cache: None,
});
```

Let's examine each part:

### Vertex State

```rust
vertex: VertexState {
    module: &shader,
    entry_point: "vs_main",
    compilation_options: Default::default(),
    buffers: &[],
},
```

**`entry_point: "vs_main"`:** The function in the shader module to use as the vertex shader.

**`buffers: &[]`:** No vertex buffers. Grain's vertex shader generates vertex positions procedurally from the `vertex_index` builtin — it doesn't read any per-vertex data from buffers. This is key to the fullscreen triangle technique (Chapter 14).

### Fragment State

```rust
fragment: Some(FragmentState {
    module: &shader,
    entry_point: "fs_main",
    compilation_options: Default::default(),
    targets: &[Some(ColorTargetState {
        format: self.output_format,
        blend: Some(BlendState::REPLACE),
        write_mask: ColorWrites::ALL,
    })],
}),
```

**`entry_point: "fs_main"`:** The fragment shader function.

**`targets`:** Describes the color attachment(s) the fragment shader writes to. Grain uses a single target in `Rgba16Float` format.

**`BlendState::REPLACE`:** The fragment shader's output completely replaces whatever was in the target texture. No alpha blending — Grain handles blending in the shader when needed (via `blend`, `mix`, etc.).

**`ColorWrites::ALL`:** Write all four channels (RGBA).

### Primitive State

```rust
primitive: PrimitiveState {
    topology: PrimitiveTopology::TriangleList,
    cull_mode: None,
    ..
},
```

**`TriangleList`:** Every three vertices form a triangle.

**`cull_mode: None`:** Don't discard triangles based on their facing direction. In 3D rendering, you'd typically use backface culling to skip triangles facing away from the camera. Grain draws a single fullscreen triangle and doesn't care about winding order.

### Multisample State

```rust
multisample: MultisampleState {
    count: 1,
    mask: !0,
    alpha_to_coverage_enabled: false,
},
```

**`count: 1`:** No multisampling (MSAA). Grain renders at the target resolution without anti-aliasing. MSAA is useful for smoothing triangle edges in 3D rendering, but Grain's fullscreen triangle has no visible edges.

### Pipeline Layout

Before creating the render pipeline, Grain creates a pipeline layout that references the bind group layout:

```rust
let pipeline_layout = self.device.create_pipeline_layout(&PipelineLayoutDescriptor {
    label: Some(&format!("{}_layout", block_id)),
    bind_group_layouts: &[&bind_group_layout],
    push_constant_ranges: &[],
});
```

The pipeline layout specifies which bind group layouts the pipeline uses. Grain uses a single bind group (group 0) per pipeline, containing all textures, the sampler, and the uniform buffer. The WebGPU spec allows up to 4 bind groups (group 0 through group 3), which is useful for separating resources that change at different frequencies. For example, a game engine might put per-scene data in group 0 (changes rarely), per-material data in group 1 (changes per material), and per-object data in group 2 (changes per draw call). Grain's programs are simple enough that a single group suffices.

### Pipeline Caching

Creating a render pipeline is expensive — it involves compiling shaders and allocating GPU state. Grain creates pipelines once per program load (in `load_program`) and reuses them across frames. The pipelines are stored in the `block_pipelines` HashMap:

```rust
struct BlockPipeline {
    pipeline: RenderPipeline,
    bind_group_layout: BindGroupLayout,
}

block_pipelines: HashMap<String, BlockPipeline>,
```

When the program is hot-reloaded, all pipelines are cleared and recreated from the new shader code. Pipeline creation happens on the CPU but involves GPU work (shader compilation), so there's a brief pause on hot reload. For simple programs, this is imperceptible; for complex programs with many blocks, the pause can be noticeable.

### Immutability

Once created, a `RenderPipeline` is immutable. You cannot change its shaders, formats, blend state, or any other property. To change anything, you must create a new pipeline. This immutability is by design — it allows the GPU to pre-optimize the entire rendering configuration, making draw calls cheap.

This is a fundamental difference from older APIs like OpenGL, where you could change state (blend mode, shader, etc.) between draw calls. The modern approach (used by Vulkan, Metal, DX12, and wgpu) is to bake all state into immutable pipeline objects, making the GPU's work fully deterministic at draw time.


## Chapter 14: The Fullscreen Triangle

Every Grain block draws a single triangle that covers the entire viewport. This is an elegant GPU rendering trick worth understanding in detail.

### Why Not a Quad?

The obvious approach to drawing a fullscreen image is a quad (rectangle) made of two triangles:

```
(-1,1)───────(1,1)
  │  ╲          │
  │    ╲        │
  │      ╲      │
  │        ╲    │
  │          ╲  │
(-1,-1)───────(1,-1)
```

This works, but the diagonal edge creates a problem: pixels along the diagonal are processed by *both* triangles' fragment shader invocations, and the GPU must handle the overlap. Fragment shaders run in square tiles (typically 2×2 pixels, called "quads" — confusingly), and at the diagonal, these tiles straddle both triangles, causing some shader invocations to be wasted.

### The Oversized Triangle Trick

Instead, Grain uses a single triangle that's larger than the viewport:

```
              (-1,1)
               /|
              / |
             /  |
            /   |
(-1,-1)────/    |
  |       /     |
  |      /      |
  |     /       |
  |    /        |
  |   /         |
  |  /          |
(-1,-3)        (3,1)
```

The triangle extends beyond the viewport boundaries. The rasterizer automatically clips it to the viewport, so only pixels within the viewport get fragment shader invocations. But because there's only one triangle, there's no diagonal seam and no wasted work.

Here's the vertex shader from `fragment_codegen.rs`:

```wgsl
@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4f {
    var pos: vec2f;
    switch vertex_index {
        case 0u: { pos = vec2f(-1.0, -3.0); }
        case 1u: { pos = vec2f(-1.0,  1.0); }
        default: { pos = vec2f( 3.0,  1.0); }
    }
    return vec4f(pos, 0.0, 1.0);
}
```

The three vertices are at (-1, -3), (-1, 1), and (3, 1) in clip space. The viewport in clip space is [-1, 1] × [-1, 1]. This triangle covers the entire viewport with room to spare. The extra area outside the viewport is clipped away by the hardware.

No vertex buffer is needed — the positions are hardcoded in the shader, indexed by `vertex_index` (the built-in vertex ID). The draw call just says "3 vertices":

```rust
render_pass.draw(0..3, 0..1);
```

### UV Coordinates

The fragment shader receives the rasterized position in `pos` and converts it to normalized UV coordinates:

```wgsl
@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = vec2f(pos.x / f32(params.width), pos.y / f32(params.height));
    let uv_min_dim = f32(min(params.width, params.height));
    let uv_ax = pos.x / uv_min_dim;
    let uv_ay = pos.y / uv_min_dim;
    // ...
}
```

The `pos` values range from (0.5, 0.5) at the top-left pixel center to (width-0.5, height-0.5) at the bottom-right. Dividing by the dimensions gives UV coordinates in approximately [0, 1].

There are actually two coordinate systems set up:

**`uv` (normalized coordinates):** Maps the full width to [0, 1] on x and full height to [0, 1] on y. This is what `x` and `y` in Grain refer to. At 1920×1080, `uv.x = 0.5` is the horizontal center and `uv.y = 0.5` is the vertical center. Circles drawn in UV space appear as ellipses on non-square outputs.

**`uv_ax, uv_ay` (aspect-ratio-corrected coordinates):** Both axes use the same scale based on the smaller dimension. At 1920×1080, the y axis still maps to [0, 1], but the x axis maps to [0, 1.778] (because 1920/1080 = 1.778). Circles drawn in this space appear as true circles regardless of aspect ratio.

### Display Quad vs Content Triangle

Notice that Grain's content shader uses a triangle (3 vertices, `draw(0..3, ...)`) while the display shader uses a quad (6 vertices, `draw(0..6, ...)`):

```wgsl
// Content shader: oversized triangle
case 0u: { pos = vec2f(-1.0, -3.0); }
case 1u: { pos = vec2f(-1.0,  1.0); }
default: { pos = vec2f( 3.0,  1.0); }

// Display shader: two triangles forming a quad
case 0u: { pos = vec2f(-1.0, -1.0); }
case 1u: { pos = vec2f( 1.0, -1.0); }
case 2u: { pos = vec2f(-1.0,  1.0); }
case 3u: { pos = vec2f(-1.0,  1.0); }
case 4u: { pos = vec2f( 1.0, -1.0); }
default: { pos = vec2f( 1.0,  1.0); }
```

Both approaches cover the full screen. The triangle is slightly more efficient (3 vertices instead of 6, no overlapping fragments along the diagonal), which is why it's used for the performance-critical content rendering. The display shader uses a quad because it was written at a different time and the efficiency difference is negligible for a single draw call per frame.

### No Vertex Buffers

Both approaches generate vertex positions entirely in the shader using `@builtin(vertex_index)`. No vertex buffer is created, no vertex attributes are defined, and the `buffers: &[]` array in the pipeline's vertex state is empty:

```rust
vertex: VertexState {
    module: &shader,
    entry_point: "vs_main",
    compilation_options: Default::default(),
    buffers: &[],  // No vertex buffers
},
```

In a traditional 3D renderer, you'd create a buffer with vertex positions, texture coordinates, normals, etc., and describe the layout via `VertexBufferLayout` entries in the `buffers` array. Grain's approach of generating positions in the shader eliminates all of that complexity. The draw call just says "invoke the vertex shader 3 times" and the shader produces the right positions.


## Chapter 15: Fragment Shader Code Generation

The `ShaderGenerator` in `fragment_codegen.rs` is the heart of Grain's compiler. It translates the AST of a Grain expression into WGSL code that computes a color for each pixel.

### The Generation Strategy

The shader generator uses a simple recursive descent approach. Each Grain expression maps to a WGSL expression or a sequence of WGSL statements:

```rust
// grain-compiler/src/fragment_codegen.rs
fn expr_to_wgsl(
    &mut self,
    expr: &Expr,
    dependencies: &HashMap<String, String>,
    uv_expr: &str,
) -> Result<String, String> {
    match expr {
        Expr::Number(n) => Ok(format!("vec4f({0}, {0}, {0}, 1.0)", format_float(*n))),

        Expr::ColorLiteral { r, g, b, a } => {
            let alpha = a.unwrap_or(1.0);
            Ok(format!(
                "vec4f({}, {}, {}, {})",
                format_float(*r), format_float(*g), format_float(*b), format_float(alpha)
            ))
        }

        Expr::Binary { op, lhs, rhs } => {
            let l = self.expr_to_wgsl(lhs, dependencies, uv_expr)?;
            let r = self.expr_to_wgsl(rhs, dependencies, uv_expr)?;
            self.binary_to_wgsl(*op, &l, &r)
        }
        // ...
    }
}
```

The `uv_expr` parameter is critical — it carries the current UV coordinate expression through the recursion. Spatial transforms modify it before recursing into their body expression. For example, `zoom(expr, 2)` divides the UV by 2 before evaluating `expr`, making it appear zoomed in.

### Variable Generation

Complex expressions that need intermediate values use a `next_var` counter to generate unique variable names:

```rust
fn next_var(&mut self, prefix: &str) -> String {
    let n = self.var_counter;
    self.var_counter += 1;
    format!("{}_{}", prefix, n)
}
```

These variables are added to the `statements` vector, which is later written into the fragment shader body. For example, the modulo operation generates an intermediate variable because it requires per-channel computation:

```rust
BinOp::Mod => {
    let var_name = self.next_var("mod_r");
    self.statements.push(format!(
        "let {} = vec4f({}.x % max({}.x, 0.0001), {}.y % max({}.y, 0.0001), \
         {}.z % max({}.z, 0.0001), 1.0);",
        var_name, lhs, rhs, lhs, rhs, lhs, rhs
    ));
    Ok(var_name)
}
```

### Texture References

When a Grain expression references a named block, it generates a texture sample:

```rust
Expr::NameRef(name) => {
    if let Some(texture) = dependencies.get(name) {
        let tex_name = self
            .ensure_texture_binding(texture, TextureSource::Dependency(name.clone()));
        Ok(format!(
            "textureSample({}, tex_sampler, {})",
            tex_name, uv_expr
        ))
    } else {
        // ...
    }
}
```

The `ensure_texture_binding` method tracks which textures have been referenced, assigning binding indices and recording them for the bind group layout. The actual texture lookup happens at runtime through the bind group.

### Spatial Transforms

Spatial transforms are the most interesting part of code generation. Instead of transforming the output, they transform the *input coordinates*. This is the classic shader technique of "inverse mapping":

To zoom into an image by 2×, you don't compute each output pixel by averaging nearby source pixels. Instead, you divide the UV coordinates by 2 and sample the source at the modified position. The GPU's texture sampling hardware handles the rest.

```rust
"zoom" => {
    let factor = param_args.get(0).cloned().unwrap_or("vec4f(1.0)".to_string());
    let v = self.next_var("zoom_uv");
    self.statements.push(format!(
        "let {} = vec2f(0.5 + ({}.x - 0.5) / {}.x, 0.5 + ({}.y - 0.5) / {}.x);",
        v, uv_expr, factor, uv_expr, factor
    ));
    v
}
```

The zoom centers on (0.5, 0.5) — the center of the UV space. Dividing the distance from center by the zoom factor makes things appear larger.

The body expression is then evaluated with the modified UV:

```rust
let body_result = self.expr_to_wgsl(body_expr, dependencies, &new_uv)?;
```

This recursive UV modification means transforms compose naturally: `zoom(rotate(expr, 0.5), 2)` first applies the zoom's UV modification, then the rotation's, then evaluates `expr` at the doubly-modified coordinates.

Let's trace through a concrete example. Given the Grain code:

```
noise(x * 4, y * 4, time) >> zoom(2)
```

After pipeline desugaring, this becomes `zoom(noise(x * 4, y * 4, time), 2)`. The shader generator processes this:

1. `call_to_wgsl("zoom", [noise_expr, 2])` is called
2. `zoom` is identified as a spatial transform
3. The zoom UV is computed:
   ```wgsl
   let zoom_uv_0 = vec2f(0.5 + (uv.x - 0.5) / 2.0, 0.5 + (uv.y - 0.5) / 2.0);
   ```
4. The body (`noise(x * 4, y * 4, time)`) is evaluated with `zoom_uv_0` as the UV:
   ```wgsl
   // x becomes zoom_uv_0.x, y becomes zoom_uv_0.y
   let noise_result = noise3d(zoom_uv_0.x * 4.0, zoom_uv_0.y * 4.0, params.time);
   ```

The pixel at screen center (uv = 0.5, 0.5) samples noise at (0.5, 0.5) — unchanged. But a pixel at the edge (uv = 0.0, 0.0) samples noise at (0.25, 0.25) — pulled toward center. This creates the zoom effect: the noise pattern appears larger because a smaller region of it is stretched across the screen.

### The `warp` Transform — A Special Case

Most spatial transforms (zoom, rotate, shift, tile) just modify UV coordinates and pass them through. But `warp` is special because it needs to handle out-of-bounds access:

```rust
"warp" => {
    // Compute displaced UV
    let v = self.next_var("warp_uv");
    self.statements.push(format!(
        "let {} = vec2f({}.x + {}.x, {}.y + {}.x);",
        v, uv_expr, fx, uv_expr, fy
    ));
    // Clamp for evaluation
    let clamped = self.next_var("warp_clamp");
    self.statements.push(format!(
        "let {} = clamp({}, vec2f(0.0), vec2f(1.0));",
        clamped, v
    ));
    // Evaluate body at clamped UV
    let body_result = self.expr_to_wgsl(body_expr, dependencies, &clamped)?;
    // Mask out-of-bounds to black
    let mask = self.next_var("warp_mask");
    self.statements.push(format!(
        "let {m} = select(vec4f(0.0), {body}, \
         {uv}.x >= 0.0 && {uv}.x <= 1.0 && {uv}.y >= 0.0 && {uv}.y <= 1.0);",
        m = mask, body = body_result, uv = v
    ));
    return Ok(mask);
}
```

Warp displaces UV coordinates by arbitrary amounts, which can push them outside [0, 1]. Rather than wrapping (which `warp_wrap` does) or clamping (which would smear edge pixels), `warp` evaluates at the clamped position but then masks the result to black if the original position was out of bounds. This creates clean edges where the warp pulls the image away from the viewport boundary.

### Built-in Function Calls

Many Grain functions map to WGSL built-in functions or simple expressions. The `call_to_wgsl_resolved` method handles these. Here are some representative examples (not all shown for brevity):

```rust
// sin(x) — wrap WGSL sin, broadcast result to vec4f
"sin" => {
    Ok(format!("vec4f(sin({a}.x), sin({a}.y), sin({a}.z), {a}.w)", a = args[0]))
}

// mix(a, b, t) — linear interpolation using WGSL mix()
"mix" => {
    Ok(format!("mix({}, {}, {})", args[0], args[1], args[2]))
}

// blend(a, b, t) — alpha-based blending
"blend" => {
    let v = self.next_var("blend");
    self.statements.push(format!(
        "let {v} = mix({a}, {b}, vec4f({t}.x));",
        v = v, a = args[0], b = args[1], t = args[2]
    ));
    Ok(v)
}
```

The pattern is consistent: Grain function arguments arrive as WGSL `vec4f` expressions, the function produces a `vec4f` result (or a variable name that holds one), and the `.x` channel is used when a scalar is needed.

### Filter Functions

Convolution filters (blur, sharpen, edge detect) are interesting because they sample the same texture at multiple offset positions. The shader generator handles these specially through `filter_call`, which generates code that reads neighboring pixels:

For example, a 3×3 blur reads 9 samples around the current pixel and averages them. The offset between samples is computed from the texture dimensions:

```wgsl
let blur_dx = 1.0 / f32(params.width);
let blur_dy = 1.0 / f32(params.height);
// ... sample at (uv.x - dx, uv.y - dy), (uv.x, uv.y - dy), etc.
```

This is why `params.width` and `params.height` are in the uniform buffer — the shader needs to know the texel size to compute correct sampling offsets.

### Conditional Helper Functions

Grain includes several helper functions that are only added to the shader when needed, keeping the generated code compact:

- **Noise functions** (`NOISE_FUNCTIONS`): PCG hash-based noise, added when the program uses `noise`, `fbm`, or `voronoi`. Includes `pcg_hash`, `hash2`, `hash3` functions, and a `value_noise_3d` implementation.
- **HSV functions** (`HSV_FUNCTIONS`): HSV-to-RGB and RGB-to-HSV conversion, added when the program uses `hsv`, `hue`, `saturate`, etc.
- **Filter sampling** (`FILTER_SAMPLE_FUNCTION`): A helper for convolution-based effects, added when blur/sharpen/edge functions are used.

The generator tracks these dependencies with boolean flags:

```rust
pub struct ShaderGenerator {
    // ...
    needs_noise: bool,
    needs_hsv: bool,
    needs_filter_sample: bool,
}
```

And includes them in the final shader only when set:

```rust
if self.needs_noise {
    shader.push_str(NOISE_FUNCTIONS);
}
```

### Assembling the Final Shader

The `build_shader` method puts everything together. Here's the complete structure of a generated shader, annotated:

```wgsl
// === Section 1: Resource bindings ===
// (Only present if the block reads textures)
@group(0) @binding(0) var tex_block_a: texture_2d<f32>;
@group(0) @binding(1) var tex_sampler: sampler;

// === Section 2: Params struct ===
struct Params {
    time: f32,
    frame: u32,
    width: u32,
    height: u32,
    beat_info: vec4f,
    knobs: array<vec4f, 16>,
}

@group(0) @binding(2) var<uniform> params: Params;

// === Section 3: Helper functions (conditional) ===
// Noise, HSV, filter sampling — only if needed

// === Section 4: Vertex shader (always the same) ===
@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4f {
    // Fullscreen triangle
}

// === Section 5: Fragment shader (the Grain computation) ===
@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = vec2f(pos.x / f32(params.width), pos.y / f32(params.height));
    let uv_min_dim = f32(min(params.width, params.height));
    let uv_ax = pos.x / uv_min_dim;
    let uv_ay = pos.y / uv_min_dim;

    // Generated statements (intermediate computations)
    let zoom_uv_0 = vec2f(0.5 + (uv.x - 0.5) / 2.0, 0.5 + (uv.y - 0.5) / 2.0);
    // ...more statements...

    // Final result (clamped for output blocks)
    let _out = clamp(result_expression, vec4f(0.0), vec4f(1.0));
    return vec4f(_out.rgb, 1.0);
}
```

The `uv_min_dim`, `uv_ax`, and `uv_ay` variables provide aspect-ratio-independent coordinates. While `uv` maps the full width and height to [0, 1], `uv_ax` and `uv_ay` maintain equal scaling on both axes — useful for drawing circles that appear as circles (not ellipses) regardless of the output aspect ratio.

The generated shader is a self-contained WGSL program. It declares all its resource bindings, includes any needed helper functions, defines both vertex and fragment shaders, and encodes the entire Grain expression as WGSL statements.


## Chapter 16: Multi-Block Rendering

A Grain program isn't always a single expression. Named bindings (`let`), feedback loops, and input references create a graph of dependencies that must be rendered in the correct order.

### The Dependency Graph

The `DependencyGraph` in `dependency_graph.rs` models the program as a directed acyclic graph (DAG) of blocks:

```rust
// grain-compiler/src/dependency_graph.rs
pub struct DependencyGraph {
    blocks: IndexMap<String, Block>,
    execution_order: Vec<String>,
    graph: DiGraph<String, ()>,
    node_map: HashMap<String, NodeIndex>,
    pub functions: HashMap<String, (Vec<String>, Expr)>,
}
```

Each block has an ID, an expression, and a list of dependencies:

```rust
pub struct Block {
    pub id: String,
    pub expr: Expr,
    pub dependencies: Vec<String>,
    pub is_dynamic: bool,
}
```

### Feedback Extraction

Before building the graph, the compiler walks the AST to extract feedback patterns. This happens in `extract_feedback_from_expr`:

```rust
// grain-compiler/src/dependency_graph.rs
fn extract_feedback_from_expr(&mut self, expr: Expr) -> Result<Expr, String> {
    match expr {
        // Explicit feedback: X >> fout#N
        Expr::Pipeline { lhs, rhs } => {
            if let Expr::FeedbackOut(n) = *rhs {
                let lhs = self.extract_feedback_from_expr(*lhs)?;
                self.add_feedback(n as usize, lhs)?;
                Ok(Expr::FeedbackIn(n))
            }
            // ...
        }
        // Implicit feedback: acc(delta) becomes fin#N + delta
        Expr::Call { name, args } if name == "acc" && args.len() == 1 => {
            let delta = self.extract_feedback_from_expr(args.into_iter().next().unwrap())?;
            let n = self.feedback_count as u32;
            let acc_expr = Expr::Binary {
                op: BinOp::Add,
                lhs: Box::new(Expr::FeedbackIn(n)),
                rhs: Box::new(delta),
            };
            self.add_feedback(n as usize, acc_expr)?;
            Ok(Expr::FeedbackIn(n))
        }
        // impulse(trigger) — edge detection using feedback
        Expr::Call { name, args } if name == "impulse" && args.len() == 1 => {
            let trigger = self.extract_feedback_from_expr(args.into_iter().next().unwrap())?;
            let n = self.feedback_count as u32;
            self.add_feedback(n as usize, trigger.clone())?;
            Ok(Expr::Impulse {
                trigger: Box::new(trigger),
                prev: Box::new(Expr::FeedbackIn(n)),
            })
        }
        // ... similar patterns for hold_every, nth, prob, hold_frames, hold_ms
    }
}
```

This transformation is crucial. The user writes `impulse(trigger)` — a simple function call. The compiler transforms it into:
1. A `feedback_N` block that stores the current trigger value each frame
2. An `Impulse` node that compares current trigger against `feedback_N_prev`
3. The appropriate `FeedbackIn(n)` references in both expressions

All of this happens before shader generation. By the time `fragment_codegen.rs` sees the AST, the feedback structure is fully explicit.

### Building the Graph

The `compile_program` function in `block_compiler.rs` orchestrates the compilation:

```rust
// grain-compiler/src/block_compiler.rs
pub fn compile_program(program: &Program) -> Result<CompiledProgram, String> {
    let graph = DependencyGraph::from_program(program)?;

    let mut shaders = HashMap::new();
    let mut shader_gen = ShaderGenerator::new();

    for block_id in graph.execution_order() {
        let block = graph.get_block(block_id)
            .ok_or_else(|| format!("Block '{}' not found", block_id))?;

        let mut dependencies = HashMap::new();
        for dep_id in &block.dependencies {
            dependencies.insert(dep_id.clone(), dep_id.clone());
        }

        let is_output = block_id == "output" || block_id.starts_with("feedback_");
        let shader_output = shader_gen
            .generate_shader(&block.expr, &dependencies, is_output, ...)
            .map_err(|e| format!("Failed to generate shader for '{}': {}", block_id, e))?;

        shaders.insert(block_id.clone(), shader_output);
    }
    // ...
}
```

The graph is built from the program's statements. Each `let` binding becomes a block. The main (unnamed) expression becomes the `"output"` block. Feedback patterns generate `"feedback_N"` blocks.

### Topological Sort

The `execution_order` is a topological sort of the dependency graph, computed using the `petgraph` crate:

```rust
use petgraph::algo::toposort;
use petgraph::graph::{DiGraph, NodeIndex};
```

Topological sort ensures that every block is rendered after all its dependencies. If block C depends on blocks A and B, both A and B will appear before C in the execution order.

The graph is stored as a `DiGraph<String, ()>` — a directed graph where nodes are block IDs and edges represent dependencies. A separate `node_map: HashMap<String, NodeIndex>` maps block names to graph node indices.

Topological sort has a critical requirement: the graph must be acyclic (a DAG — directed acyclic graph). A cycle would mean block A depends on block B which depends on block A — impossible to resolve. The `petgraph::algo::toposort` function returns `Err` if a cycle is detected.

Feedback *appears* to create cycles (a block reads its own previous output), but the dependency graph avoids this by modeling feedback through separate `_prev` textures. The feedback block depends on its *input* expression, not on itself. The `_prev` texture is populated by a copy operation, not by a dependency edge.

### The `is_dynamic` Flag

Each block is classified as static or dynamic:

```rust
pub struct Block {
    pub id: String,
    pub expr: Expr,
    pub dependencies: Vec<String>,
    pub is_dynamic: bool,
}
```

A block is dynamic if its expression tree contains any time-varying element:
- `time` or `frame` builtins
- Feedback references (`FeedbackIn`)
- References to other dynamic blocks
- Control surface elements (knobs, toggles, etc.) that change at runtime

Static blocks contain only spatial expressions (`x`, `y`), constants, and references to other static blocks. Their output is the same every frame, so they're computed once and cached.

The `is_dynamic` classification propagates through the dependency graph: if block A is static and block B references block A plus `time`, then block B is dynamic even though block A is static.

### Rendering in Order

The renderer executes blocks in the computed order:

```rust
// grain-runtime/src/renderer.rs — render_to_texture()
for block_id in program.graph.execution_order() {
    let block = program.graph.get_block(block_id)
        .ok_or_else(|| format!("Block '{}' not found", block_id))?;

    // Skip static blocks after first frame if texture already cached
    if !block.is_dynamic && options.frame > 0 && self.texture_manager.has_texture(block_id) {
        continue;
    }

    let shader_output = program.shaders.get(block_id)
        .ok_or_else(|| format!("Shader '{}' not found", block_id))?;

    self.render_block(block_id, shader_output, options.width, options.height)?;
}
```

Each block renders to its own texture. Downstream blocks read those textures via their bind groups. The optimization for static blocks is notable: if a block's expression doesn't depend on time, frame, or any dynamic value, its texture is computed once and reused on subsequent frames.

### A Concrete Example

Consider this Grain program:

```
let bg = noise(x * 8, y * 8, time)
let mask = circle(0.5, 0.5, 0.3)
bg * mask
```

The dependency graph has three blocks:

1. **`bg`**: Expression `noise(x * 8, y * 8, time)`. Dependencies: none. Dynamic: yes (depends on `time`).
2. **`mask`**: Expression `circle(0.5, 0.5, 0.3)`. Dependencies: none. Dynamic: no (purely static).
3. **`output`**: Expression `bg * mask`. Dependencies: `bg`, `mask`.

Topological sort gives execution order: `bg`, `mask`, `output` (or `mask`, `bg`, `output` — both are valid since `bg` and `mask` are independent).

Frame 0: All three blocks render.
Frame 1: `mask` is skipped (static, already cached). `bg` re-renders (dynamic). `output` re-renders.
Frame 2+: Same as frame 1.

The `mask` texture is computed once and reused forever, saving a full render pass per frame. For static blocks with expensive computations (complex noise patterns, heavy blurs), this optimization is significant.

### Why Blocks Exist

Blocks serve two purposes:

1. **Named sub-expressions.** A `let bg = noise(x, y, time)` declaration creates a block whose output can be referenced multiple times without recomputation. Without blocks, the noise would be evaluated separately at each reference site, potentially giving different results (since noise with time-dependent seeds must be evaluated consistently). Also, if `bg` is referenced by both `output` and another block, computing it once as a texture is cheaper than evaluating the noise function twice per pixel.

2. **Feedback loops.** Temporal effects like `impulse`, `acc`, and `hold_every` need to read their own output from the previous frame. Each feedback pattern creates a dedicated block whose texture persists between frames. The dependency graph builder in `dependency_graph.rs` detects these patterns and creates the appropriate `feedback_N` blocks automatically.


## Chapter 17: Feedback Textures

Feedback is how Grain achieves temporal effects — operations that depend on their own previous output. This requires a careful dance of texture copying to avoid reading and writing the same texture simultaneously.

### The Ping-Pong Pattern

The fundamental problem: a shader cannot read from and write to the same texture in a single render pass. If `feedback_0` needs to read its previous value while computing its new value, it can't render directly to the same texture it's sampling from.

The solution is the **ping-pong pattern**: maintain two textures and alternate between them each frame. In Grain, these are named `feedback_N` (the current output) and `feedback_N_prev` (the previous frame's value):

```
Frame 0:  render feedback_0 (reads feedback_0_prev, which is black)
          copy feedback_0 → feedback_0_prev

Frame 1:  copy feedback_0 → feedback_0_prev  (save current for next read)
          render feedback_0 (reads feedback_0_prev, which has frame 0's output)

Frame 2:  copy feedback_0 → feedback_0_prev  (save current for next read)
          render feedback_0 (reads feedback_0_prev, which has frame 1's output)
```

Actually, Grain does the copy *before* rendering each frame:

```rust
// grain-runtime/src/renderer.rs — render_to_texture()
if program.metadata.has_feedback {
    self.copy_feedback_to_prev(options.width, options.height)?;
}
```

### The Copy Operation

```rust
// grain-runtime/src/renderer.rs — copy_feedback_to_prev()
fn copy_feedback_to_prev(&mut self, width: u32, height: u32) -> Result<(), String> {
    let feedback_names: Vec<String> = self
        .texture_manager
        .textures
        .keys()
        .filter(|k| k.starts_with("feedback_") && !k.ends_with("_prev"))
        .cloned()
        .collect();

    for fb_name in &feedback_names {
        let prev_name = format!("{}_prev", fb_name);
        self.texture_manager
            .get_or_create(&self.device, &prev_name, width, height);
    }

    let mut encoder = self.device.create_command_encoder(&CommandEncoderDescriptor {
        label: Some("feedback_copy_to_prev"),
    });

    for fb_name in &feedback_names {
        let prev_name = format!("{}_prev", fb_name);
        let src = self.texture_manager.textures.get(fb_name).unwrap();
        let dst = self.texture_manager.textures.get(&prev_name).unwrap();

        encoder.copy_texture_to_texture(
            ImageCopyTexture {
                texture: src,
                mip_level: 0,
                origin: Origin3d::ZERO,
                aspect: TextureAspect::All,
            },
            ImageCopyTexture {
                texture: dst,
                mip_level: 0,
                origin: Origin3d::ZERO,
                aspect: TextureAspect::All,
            },
            Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
    }

    self.queue.submit(std::iter::once(encoder.finish()));
    Ok(())
}
```

`copy_texture_to_texture` is a GPU-side operation — it copies pixel data between textures entirely on the GPU without touching the CPU. This is fast because it doesn't cross the CPU-GPU boundary.

### How Feedback Is Used

When the dependency graph builder encounters a feedback pattern like `impulse(trigger)`, it creates:

1. A `feedback_N` block that stores the current trigger value
2. An `Expr::Impulse` node that compares the current trigger against `feedback_N_prev` (the previous frame's trigger value)

In the generated WGSL, the feedback read becomes a texture sample:

```wgsl
// Generated for Expr::FeedbackIn(0):
textureSample(tex_feedback_0, tex_sampler, uv)
```

And the impulse detection:

```wgsl
// Generated for Expr::Impulse:
let imp_0 = select(
    vec4f(0.0, 0.0, 0.0, 0.0),
    vec4f(1.0, 1.0, 1.0, 1.0),
    trigger.x > 0.0 && prev.x <= 0.0
);
```

This compares the current trigger value against the previous frame's value. If the trigger went from ≤0 to >0 (a rising edge), the impulse fires.

### Multi-Channel Feedback

Some feedback operations pack multiple values into the RGBA channels of the feedback texture. For example, `nth(input, n)` uses:
- `.x` — the output value (0 or 1)
- `.y` — the previous input value (for edge detection)
- `.z` — the counter value

The generated WGSL shows this clearly:

```wgsl
// nth: fire every N-th rising edge of input
let nth_0_edge = input.x > 0.0 && prev.y <= 0.0;          // rising edge of input
let nth_0_fire = nth_0_edge && prev.z < 1.0;               // counter expired?
let nth_0_ctr = select(prev.z,                              // update counter
    select(n.x - 1.0, prev.z - 1.0, prev.z >= 1.0),
    nth_0_edge);
let nth_0_val = select(0.0, 1.0, nth_0_fire);              // output
let nth_0 = vec4f(nth_0_val, input.x, nth_0_ctr, 1.0);    // pack into vec4f
```

This is possible because Grain's textures use `Rgba16Float` — four 16-bit float channels per pixel — giving enough room to store auxiliary state alongside the visible output. The `.x` channel carries the value that downstream operations see, while `.y`, `.z`, and `.w` carry hidden state for the feedback mechanism.

### Feedback and the Accumulator Pattern

The `acc(delta)` function is the simplest feedback pattern. It accumulates a value over time:

```
// Grain source
acc(0.01)  // increases by 0.01 per frame
```

The dependency graph builder transforms this into:

```rust
// feedback_N = fin#N + delta
let acc_expr = Expr::Binary {
    op: BinOp::Add,
    lhs: Box::new(Expr::FeedbackIn(n)),  // previous frame's value
    rhs: Box::new(delta),                 // the accumulation step
};
```

This becomes a feedback block that adds `delta` to the previous frame's value. On frame 0, `feedback_0_prev` is black (all zeros), so the result is `0 + 0.01 = 0.01`. On frame 1, it's `0.01 + 0.01 = 0.02`. And so on.

Without feedback textures, this kind of temporal accumulation would be impossible in a fragment shader — there's no way to say "remember what I computed last frame" without external storage. The feedback texture provides that storage, and the ping-pong copy ensures safe read-after-write behavior.

### Initial State

On the very first frame, `feedback_N_prev` textures are freshly created and haven't been written to. wgpu does not guarantee the initial contents of a texture — it could be zeros, garbage, or whatever was previously in that GPU memory. However, Grain always clears textures to black (`LoadOp::Clear(Color::BLACK)`) in the first render pass that writes to them, and the `_prev` textures are created via `get_or_create` which allocates fresh GPU memory (typically zeroed on most platforms). In practice, feedback starts from black.


## Chapter 18: Texture Copying

Beyond feedback, texture copying is used for two other purposes in Grain: getting rendered output to the display, and reading pixels back to the CPU for export.

### Texture-to-Texture Copy (Display)

The live preview needs to copy the renderer's output texture to a display-compatible texture. This happens in `display_to_surface`:

```rust
// grain/src/live.rs — display_to_surface()
if let (Some(output_tex), Some(display_tex)) =
    (self.renderer.output_texture(), self.display_texture.as_ref())
{
    let device = self.renderer.device();
    let mut encoder = device.create_command_encoder(&Default::default());
    encoder.copy_texture_to_texture(
        ImageCopyTexture {
            texture: output_tex,
            mip_level: 0,
            origin: Origin3d::ZERO,
            aspect: TextureAspect::All,
        },
        ImageCopyTexture {
            texture: display_tex,
            mip_level: 0,
            origin: Origin3d::ZERO,
            aspect: TextureAspect::All,
        },
        Extent3d {
            width: self.content_width,
            height: self.content_height,
            depth_or_array_layers: 1,
        },
    );
    self.renderer.queue().submit(std::iter::once(encoder.finish()));
}
```

Why copy instead of rendering directly to the display texture? Because the renderer's output texture is `Rgba16Float` (the internal format), while the display texture needs to be in a format compatible with the display shader's `textureLoad`. Keeping the copy separates the renderer's internal format from the display pipeline.

### Texture-to-Buffer Copy (Export Readback)

To save a rendered frame as an image file, the pixel data must travel from GPU texture → GPU buffer → CPU memory. This is the most complex copy operation:

```rust
// grain-runtime/src/renderer.rs — read_texture()
fn read_texture(&self, name: &str, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let bytes_per_pixel = 8u32; // Rgba16Float = 4 channels * 2 bytes
    let unpadded_bytes_per_row = width * bytes_per_pixel;
    let align = COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) / align * align;
    let buffer_size = (padded_bytes_per_row * height) as u64;

    let staging_buffer = self.device.create_buffer(&BufferDescriptor {
        label: Some("staging_buffer"),
        size: buffer_size,
        usage: BufferUsages::COPY_DST | BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
```

**Row alignment:** GPU texture copies require that each row in the destination buffer is aligned to `COPY_BYTES_PER_ROW_ALIGNMENT` (typically 256 bytes). If a row's data doesn't fill a full alignment boundary, it's padded. This means the buffer might be larger than `width * height * bytes_per_pixel`.

**Staging buffer:** The buffer has `COPY_DST` (destination of the copy) and `MAP_READ` (the CPU can read it). You can't read directly from a render target — you must copy to a buffer with the `MAP_READ` flag first.

The copy command:

```rust
    encoder.copy_texture_to_buffer(
        ImageCopyTexture {
            texture,
            mip_level: 0,
            origin: Origin3d::ZERO,
            aspect: TextureAspect::All,
        },
        ImageCopyBuffer {
            buffer: &staging_buffer,
            layout: ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(padded_bytes_per_row),
                rows_per_image: Some(height),
            },
        },
        Extent3d { width, height, depth_or_array_layers: 1 },
    );

    self.queue.submit(std::iter::once(encoder.finish()));
```

### Buffer Mapping

After the copy, the CPU needs to access the buffer. This requires *mapping* — making GPU memory accessible to the CPU:

```rust
    let buffer_slice = staging_buffer.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    buffer_slice.map_async(MapMode::Read, move |result| {
        tx.send(result).unwrap();
    });

    self.device.poll(Maintain::Wait);
    rx.recv()
        .unwrap()
        .map_err(|e| format!("Failed to map buffer: {:?}", e))?;

    let padded_data = buffer_slice.get_mapped_range();
```

`map_async` requests that the GPU make the buffer's contents available to the CPU. The callback fires when the mapping is complete. `device.poll(Maintain::Wait)` blocks until all GPU work (including the copy) is done.

Once mapped, the data is accessed as a byte slice. Grain converts the `f16` RGBA data to `u8` RGBA:

```rust
    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for row in 0..height as usize {
        let row_start = row * padded_bytes_per_row as usize;
        for col in 0..width as usize {
            let px_start = row_start + col * bytes_per_pixel as usize;
            for ch in 0..4usize {
                let offset = px_start + ch * 2;
                let val = f16::from_le_bytes([padded_data[offset], padded_data[offset + 1]]);
                out.push((val.to_f32().clamp(0.0, 1.0) * 255.0) as u8);
            }
        }
    }

    drop(padded_data);
    staging_buffer.unmap();
```

Note the careful handling of padded rows: each row starts at `row * padded_bytes_per_row`, not `row * unpadded_bytes_per_row`. The padding bytes at the end of each row are skipped.

To make the alignment issue concrete, consider a 100-pixel-wide `Rgba16Float` texture:

```
Unpadded bytes per row: 100 × 8 = 800 bytes
COPY_BYTES_PER_ROW_ALIGNMENT: 256 bytes
Padded bytes per row: ceil(800 / 256) × 256 = 1024 bytes
Padding per row: 224 bytes of unused data
```

For a 100×100 texture:
```
Actual pixel data: 100 × 100 × 8 = 80,000 bytes
Buffer size needed: 1024 × 100 = 102,400 bytes
Wasted to padding: 22,400 bytes (28% overhead!)
```

At larger resolutions, the percentage shrinks (1920×8=15360, which rounds up to 15616 — only 1.7% overhead), but for small textures the alignment waste can be significant.

Finally, `unmap()` releases the CPU mapping, making the buffer available to the GPU again. It's important to drop the `MappedRange` (the `padded_data` variable) before calling `unmap()`, or the unmap will panic. The `drop(padded_data)` call makes this explicit.

### The Mapping Model

Buffer mapping deserves special attention because it's one of the most conceptually different aspects of GPU programming compared to CPU programming.

On the CPU, you can read any memory at any time (modulo ownership rules). On the GPU, you can't just dereference a pointer to GPU memory — the data lives on a separate device with its own address space. To read it, you must:

1. **Request mapping:** `buffer_slice.map_async(MapMode::Read, callback)` tells the GPU "I want to read this buffer." The GPU queues this request.
2. **Wait for completion:** `device.poll(Maintain::Wait)` ensures all GPU work is done and the mapping is complete. Without this, the callback might not have fired yet.
3. **Access the data:** `buffer_slice.get_mapped_range()` returns a `BufferView` — a byte slice that points to GPU memory made accessible to the CPU. On discrete GPUs, this might be a special CPU-visible copy of the data. On integrated GPUs, it might point directly to the shared memory.
4. **Release the mapping:** `staging_buffer.unmap()` tells the GPU the CPU is done reading. The buffer returns to GPU-only access.

A buffer cannot be used by the GPU while it's mapped. If you tried to render to a texture and copy it to a mapped buffer, wgpu would return an error. This is why Grain creates the staging buffer as unmapped, submits the copy command, waits for completion, and only then maps it.


## Chapter 19: Presenting to Screen

The live preview needs to get the rendered output onto the user's display. This involves wgpu's surface system — the bridge between GPU rendering and the operating system's window management.

### Surfaces

A `wgpu::Surface` represents a platform window's drawing area. It's created from a window handle:

```rust
// grain/src/live.rs — resumed()
let surface = self.instance.create_surface(window.clone()).unwrap();
```

### Surface Configuration

Before rendering to a surface, it must be configured with a format, size, and presentation mode:

```rust
let surface_caps = surface.get_capabilities(&self.adapter);

let surface_format = surface_caps
    .formats
    .iter()
    .find(|f| f.is_srgb())
    .copied()
    .unwrap_or(surface_caps.formats[0]);

let config = SurfaceConfiguration {
    usage: TextureUsages::RENDER_ATTACHMENT,
    format: surface_format,
    width: size.width.max(1),
    height: size.height.max(1),
    present_mode: if surface_caps.present_modes.contains(&PresentMode::Mailbox) {
        PresentMode::Mailbox
    } else {
        PresentMode::Fifo
    },
    alpha_mode: surface_caps.alpha_modes[0],
    view_formats: vec![],
    desired_maximum_frame_latency: 2,
};
surface.configure(self.renderer.device(), &config);
```

**Format selection:** Grain prefers an sRGB format because sRGB correctly represents how monitors display colors. The sRGB transfer function approximates the human eye's non-linear brightness perception — a value of 0.5 in sRGB appears as roughly mid-gray, while a linear 0.5 would appear too bright.

**Present mode:** `Mailbox` (if available) gives low-latency presentation without tearing — it always presents the most recently completed frame, discarding older ones. `Fifo` is the fallback — it queues frames and presents them in order, synchronized to the display's refresh rate (vsync). Grain prefers Mailbox because it's a real-time visual tool where seeing the latest frame matters more than presenting every frame.

**Desired maximum frame latency:** `2` means wgpu can have up to 2 frames in-flight (being rendered on the GPU) before blocking the CPU. This provides a buffer against GPU/CPU timing mismatches.

### The Frame Loop

Each frame in the live preview follows this sequence:

```rust
// grain/src/live.rs — RedrawRequested handler
WindowEvent::RedrawRequested => {
    let now = Instant::now();
    if now >= self.next_frame_time {
        self.check_hot_reload();
        self.render_frame();
        self.display_to_surface();
        self.next_frame_time = now + self.frame_interval;
    }
}
```

### Getting the Surface Texture

Each frame, you request the next texture from the surface:

```rust
// grain/src/live.rs — display_to_surface()
let frame = match surface.get_current_texture() {
    Ok(f) => f,
    Err(_) => return,
};

let frame_view = frame.texture.create_view(&TextureViewDescriptor::default());
```

`get_current_texture()` returns a `SurfaceTexture` — a texture owned by the surface's swap chain. You can render to it like any other texture. When you're done, call `present()`:

```rust
frame.present();
```

`present()` signals that the frame is ready to be displayed. Depending on the present mode, it might appear immediately (Mailbox) or be queued for the next vsync (Fifo).

### The Display Pipeline

Grain's display pipeline is separate from the content rendering pipeline. The content is rendered to an internal `Rgba16Float` texture at the content resolution (e.g., 128×128). The display pipeline then renders this texture to the window surface at the window's resolution, with aspect-ratio-preserving letterboxing.

The display shader uses a quad (two triangles, 6 vertices) instead of the fullscreen triangle:

```wgsl
// grain/src/live.rs — DISPLAY_WGSL
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var pos: vec2f;
    switch i {
        case 0u: { pos = vec2f(-1.0, -1.0); }
        case 1u: { pos = vec2f( 1.0, -1.0); }
        case 2u: { pos = vec2f(-1.0,  1.0); }
        case 3u: { pos = vec2f(-1.0,  1.0); }
        case 4u: { pos = vec2f( 1.0, -1.0); }
        default: { pos = vec2f( 1.0,  1.0); }
    }
    return vec4f(pos, 0.0, 1.0);
}
```

The fragment shader handles letterboxing by computing the viewport area and mapping only the visible region to texture coordinates:

```wgsl
@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let sw = f32(params.surface_width);
    let sh = f32(params.surface_height);
    let tw = f32(params.texture_width);
    let th = f32(params.texture_height);
    let scale = min(sw / tw, sh / th);
    let vw = tw * scale;
    let vh = th * scale;
    let vx = (sw - vw) * 0.5;
    let vy = (sh - vh) * 0.5;
    // ...
    if px >= vx && px < vx + vw && py >= vy && py < vy + vh {
        // Map to texture coordinates and load pixel
        let coord = vec2i(i32(u * tw), i32(v * th));
        return textureLoad(img, clamped, 0);
    }
    return vec4f(0.0, 0.0, 0.0, 1.0);  // Letterbox bars are black
}
```

The display shader uses `textureLoad` (integer coordinate, no filtering) rather than `textureSample`, giving exact pixel-to-pixel mapping from the content texture to the window.

### Frame Pacing

Grain controls its frame rate independently of the display's refresh rate:

```rust
// grain/src/live.rs
frame_interval: Duration::from_secs_f64(1.0 / fps.max(1) as f64),

// In the RedrawRequested handler:
let now = Instant::now();
if now >= self.next_frame_time {
    self.check_hot_reload();
    self.render_frame();
    self.display_to_surface();
    self.next_frame_time = now + self.frame_interval;
}
```

The `--fps` flag controls this interval. At 60 fps, a new frame renders every ~16.7ms. At 30 fps, every ~33.3ms. Between frames, the event loop uses `ControlFlow::WaitUntil` to avoid busy-waiting:

```rust
fn about_to_wait(&mut self, event_loop: &winit::event_loop::ActiveEventLoop) {
    if let Some(window) = &self.window {
        window.request_redraw();
        event_loop.set_control_flow(ControlFlow::WaitUntil(
            std::time::Instant::now() + self.frame_interval,
        ));
    }
}
```

This means the CPU sleeps between frames instead of spinning. The Grain frame rate and the display refresh rate are decoupled — if Grain renders at 30 fps on a 60 Hz display, the surface presents the same frame twice per refresh.

### Hot Reload

The live preview supports hot-reloading Grain source files. When the `.grain` file changes on disk, a watcher thread detects the change, recompiles the program, and sends the new `CompiledProgram` through a channel:

```rust
fn check_hot_reload(&mut self) {
    // ...
    while let Ok(result) = rx.try_recv() {
        match result {
            Ok(new_program) => {
                match self.renderer.load_program(&new_program) {
                    Ok(()) => {
                        let new_surface = build_surface(&new_program);
                        *self.control_surface.lock().unwrap() = new_surface;
                        self.program = new_program;
                        self.compile_error = None;
                        self.frame = 0;
                        eprintln!("Hot reload: OK");
                    }
                    Err(e) => {
                        self.compile_error = Some(e.clone());
                        eprintln!("Hot reload pipeline error: {}", e);
                    }
                }
            }
            Err(e) => { /* compilation error — keep old program running */ }
        }
    }
}
```

When a reload succeeds, `renderer.load_program()` creates new shader modules and pipelines from the new compiled program. The old pipelines are dropped (and their GPU resources freed). The frame counter resets to 0, which means feedback textures start fresh. If compilation fails, the old program keeps running — the user sees the error in the terminal and can fix the source file.

This hot reload is what makes Grain a live-coding tool: edit the `.grain` file in your text editor, save, and see the result immediately in the preview window.


## Chapter 20: Texture Arrays for Tilesets

Tilesets let Grain programs select from a collection of tile images based on per-pixel or per-cell values. The tiles are stored as a GPU texture array — a single texture resource containing multiple 2D layers.

### What Is a Texture Array?

A regular 2D texture has width, height, and a single layer of pixel data. A 2D texture array has width, height, and *N* layers — like a stack of identically-sized images. In WGSL, you sample it with an additional layer index:

```wgsl
textureSample(tileset, sampler, uv, layer_index)
```

The layer index is an integer selecting which tile image to read from.

### Loading Tile Images

Grain loads tilesets from a directory of image files. Each image becomes one layer in the texture array:

```rust
// grain-runtime/src/tileset.rs — load_tileset_normal()
fn load_tileset_normal(dir: &Path) -> Result<TileData, String> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| format!("Cannot read tileset dir {:?}: {}", dir, e))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().map_or(false, |ext| {
                ext.eq_ignore_ascii_case("png") || ext.eq_ignore_ascii_case("jpg")
            })
        })
        .collect();
    entries.sort();  // Alphabetical order determines layer indices
    // ...
}
```

The images are sorted alphabetically, so the first image (alphabetically) is layer 0, the second is layer 1, etc.

### Creating the GPU Texture Array

```rust
// grain-runtime/src/tileset.rs — create_tileset_texture()
let texture = device.create_texture(&TextureDescriptor {
    label: Some(label),
    size: Extent3d {
        width: tile_data.tile_width,
        height: tile_data.tile_height,
        depth_or_array_layers: num_layers,
    },
    mip_level_count: 1,
    sample_count: 1,
    dimension: TextureDimension::D2,
    format,
    usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
    view_formats: &[],
});
```

The key is `depth_or_array_layers: num_layers` — this creates a texture with multiple layers. The `dimension` is still `TextureDimension::D2`, not `D3`.

Each layer is uploaded separately using `queue.write_texture()` with a layer-specific origin:

```rust
for (layer_idx, layer) in tile_data.layers.iter().enumerate() {
    // ... (convert pixels to f16 RGBA bytes) ...

    queue.write_texture(
        ImageCopyTexture {
            texture: &texture,
            mip_level: 0,
            origin: Origin3d {
                x: 0,
                y: 0,
                z: layer_idx as u32,  // z selects the layer
            },
            aspect: TextureAspect::All,
        },
        &bytes,
        ImageDataLayout {
            offset: 0,
            bytes_per_row: Some(aligned_bpr),
            rows_per_image: Some(tile_data.tile_height),
        },
        Extent3d {
            width: tile_data.tile_width,
            height: tile_data.tile_height,
            depth_or_array_layers: 1,  // Upload one layer at a time
        },
    );
}
```

### The Texture Array View

The texture view must specify `D2Array` to tell the GPU to treat the layers as array elements:

```rust
let view = texture.create_view(&TextureViewDescriptor {
    dimension: Some(TextureViewDimension::D2Array),
    ..Default::default()
});
```

### Bind Group Layout for Arrays

In the bind group layout, tileset textures use `TextureViewDimension::D2Array`:

```rust
entries.push(BindGroupLayoutEntry {
    binding,
    visibility: ShaderStages::FRAGMENT,
    ty: BindingType::Texture {
        multisampled: false,
        view_dimension: TextureViewDimension::D2Array,
        sample_type: TextureSampleType::Float { filterable: true },
    },
    count: None,
});
```

In the generated WGSL, the binding uses `texture_2d_array`:

```wgsl
@group(0) @binding(N) var tileset_0: texture_2d_array<f32>;
```

And sampling uses the 4-argument form with the array index:

```wgsl
textureSample(tileset_0, tex_sampler, cell_uv, i32(tile_index))
```

The tile index comes from evaluating the Grain expression that selects tiles — it might be a noise function, an input-dependent value, or anything else that maps to a tile number.

### Layer Upload and f16 Conversion

Each tile image goes through the same format conversion pipeline as input textures, but with an additional concern: row alignment for texture writes.

```rust
// grain-runtime/src/tileset.rs — create_tileset_texture()
let bytes_per_pixel = 8u32; // 4 channels * 2 bytes (f16)
let bpr = tile_data.tile_width * bytes_per_pixel;
let align = COPY_BYTES_PER_ROW_ALIGNMENT;
let aligned_bpr = (bpr + align - 1) / align * align;

for (layer_idx, layer) in tile_data.layers.iter().enumerate() {
    let mut bytes = vec![0u8; (aligned_bpr * tile_data.tile_height) as usize];
    for y in 0..tile_data.tile_height as usize {
        for x in 0..tile_data.tile_width as usize {
            let src = &layer[y * tile_data.tile_width as usize + x];
            let dst_offset = y * aligned_bpr as usize + x * bytes_per_pixel as usize;
            for ch in 0..4usize {
                let f = f16::from_f32(src[ch]);
                let b = f.to_le_bytes();
                bytes[dst_offset + ch * 2] = b[0];
                bytes[dst_offset + ch * 2 + 1] = b[1];
            }
        }
    }

    queue.write_texture(
        ImageCopyTexture {
            texture: &texture,
            mip_level: 0,
            origin: Origin3d { x: 0, y: 0, z: layer_idx as u32 },
            aspect: TextureAspect::All,
        },
        &bytes,
        ImageDataLayout {
            offset: 0,
            bytes_per_row: Some(aligned_bpr),
            rows_per_image: Some(tile_data.tile_height),
        },
        Extent3d {
            width: tile_data.tile_width,
            height: tile_data.tile_height,
            depth_or_array_layers: 1,
        },
    );
}
```

The `origin: Origin3d { x: 0, y: 0, z: layer_idx as u32 }` is the key — it targets a specific layer in the texture array. Each `write_texture` call uploads one tile image to one layer, with `z` selecting the layer index.

Note that `write_texture` DOES require aligned rows when the `bytes_per_row` is specified — the tileset code manually handles alignment with `aligned_bpr`, padding each row to a multiple of `COPY_BYTES_PER_ROW_ALIGNMENT`. This differs from the simpler `load_input_image` path, which uses `width * 8` directly for bytes_per_row (this works because `queue.write_texture` is more forgiving than `copy_texture_to_buffer` about alignment — the wgpu implementation handles it internally when there's no intermediate buffer).

### How Tilesets Work End-to-End

To make the tileset pipeline concrete, let's trace a Grain `tileset` expression from source to pixels.

Given a Grain program:

```
tileset("tiles", noise(x * 4, y * 4, time), 8)
```

This means: divide the screen into an 8×8 grid of cells. For each cell, evaluate `noise(...)` at the cell center to pick a tile index. Display the selected tile in that cell.

**1. Compilation:** The compiler generates WGSL that:
   - Computes which cell the current pixel belongs to
   - Evaluates the selection expression at the cell center
   - Uses the result to index into the texture array
   - Samples the tile at the local pixel position within the cell

**2. Asset loading:** When the renderer loads the program, it finds the tileset binding, reads all PNG/JPG files from the "tiles" directory, and creates a `texture_2d_array` with one layer per image file.

**3. Rendering:** Each pixel's fragment shader runs the above logic. Neighboring pixels in the same cell select the same tile (because they evaluate the selection at the cell center) but sample different positions within that tile (because their local UV within the cell differs).

The `tileset_px` variant is different: instead of evaluating the selection expression per-cell, it evaluates per-pixel and samples the tile at the tile's native pixel resolution. This gives a different aesthetic — each pixel can potentially show a different tile.

### Auto-Tilesets

Grain also supports auto-tilesets — a system where 16 tiles correspond to all possible combinations of cardinal-direction neighbors (up, down, left, right). The tile files are named `empty.png`, `d.png`, `l.png`, `dl.png`, ... `dlru.png`, following a binary encoding of which edges connect to neighboring cells. The shader evaluates the input expression at neighboring cell centers to determine connectivity, then selects the appropriate tile. This is commonly used for procedural map generation with connected borders.


## Chapter 21: Input Textures

Grain programs can process external images and video frames via input textures. These are loaded from files on the CPU and uploaded to the GPU.

### Uploading Input Images

```rust
// grain-runtime/src/renderer.rs — load_input_image()
pub fn load_input_image(&mut self, index: usize, image_data: &[u8], width: u32, height: u32) {
    let name = format!("input_{}", index);
    self.texture_manager
        .get_or_create(&self.device, &name, width, height);

    if let Some(texture) = self.texture_manager.textures.get(&name) {
        // Convert u8 RGBA to f16 RGBA
        let mut f16_data = Vec::with_capacity(image_data.len() / 4 * 8);
        for chunk in image_data.chunks(4) {
            for &byte in chunk {
                let f = f16::from_f32(byte as f32 / 255.0);
                f16_data.extend_from_slice(&f.to_le_bytes());
            }
        }
        self.queue.write_texture(
            ImageCopyTexture {
                texture,
                mip_level: 0,
                origin: Origin3d::ZERO,
                aspect: TextureAspect::All,
            },
            &f16_data,
            ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(width * 8),
                rows_per_image: Some(height),
            },
            Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
    }
}
```

The input arrives as `u8` RGBA pixels (0–255 per channel, as loaded by the `image` crate). The renderer converts each channel to `f16` (half-precision float, 0.0–1.0) to match the internal `Rgba16Float` texture format. This conversion doubles the data size (4 bytes per pixel → 8 bytes per pixel) but allows the input to participate in the same floating-point pipeline as all other textures.

`queue.write_texture()` handles the CPU → GPU upload. Like `queue.write_buffer()`, it stages the data immediately and makes it available before the next submitted command buffer.

### Input Textures in the Shader

When a Grain program uses `input(0)`, the compiler generates:

```rust
// grain-compiler/src/fragment_codegen.rs
Expr::Input(n) => {
    let tex_name =
        self.ensure_texture_binding(&format!("input_{}", n), TextureSource::Input(*n));
    Ok(format!(
        "textureSample({}, tex_sampler, {})",
        tex_name, uv_expr
    ))
}
```

This produces WGSL that samples the input texture at the current UV coordinates, just like any other texture reference. The input texture appears in the bind group alongside dependency textures and feedback textures — from the shader's perspective, they're all just `texture_2d<f32>` resources.

### Export with Inputs

The export path in `export.rs` loads input images from disk and passes them to the renderer:

```rust
// grain/src/export.rs — export_frame_with_inputs()
for (i, path) in input_images.iter().enumerate() {
    let img = image::open(path)
        .map_err(|e| ...)?
        .resize_exact(options.width, options.height, image::imageops::FilterType::Nearest)
        .to_rgba8();
    renderer.load_input_image(i, img.as_raw(), options.width, options.height);
}
```

Note the `resize_exact` — input images are resized to match the output dimensions. This ensures the UV coordinate mapping is straightforward: UV (0.5, 0.5) in the output corresponds to the center of the input, regardless of original image size.

### The Format Conversion Pipeline

Data format conversion is a recurring theme in Grain's texture handling. Here's the full picture of format conversions that happen:

**Loading images from disk:**
```
File (PNG/JPG) → image crate → [u8; 4] per pixel (RGBA, 0-255)
                              → convert to [f16; 4] per pixel (RGBA, 0.0-1.0)
                              → queue.write_texture()
```

**Reading pixels back for export:**
```
GPU texture (Rgba16Float) → copy_texture_to_buffer
                          → map buffer → [f16; 4] per pixel
                          → convert to [u8; 4] per pixel (RGBA, 0-255)
                          → image crate → File (PNG/JPG)
```

The u8 → f16 conversion during loading:
```rust
let f = f16::from_f32(byte as f32 / 255.0);
```

The f16 → u8 conversion during readback:
```rust
let val = f16::from_le_bytes([padded_data[offset], padded_data[offset + 1]]);
out.push((val.to_f32().clamp(0.0, 1.0) * 255.0) as u8);
```

The `clamp(0.0, 1.0)` during readback is important: intermediate textures can contain values outside [0, 1] (shader computations don't inherently clamp), but pixel values in an image file must be in [0, 255]. Values below 0 become 0 (black), values above 1 become 255 (white).

### queue.write_texture()

`queue.write_texture()` is the primary mechanism for uploading pixel data from the CPU to a texture on the GPU. It takes three pieces of information:

1. **Where to write:** The target texture, mip level, and origin (for writing to a sub-region)
2. **The source data:** A byte slice plus layout information (bytes per row, rows per image)
3. **The region size:** Width, height, and depth of the copy

The `ImageDataLayout` struct describes how the source bytes are organized:

```rust
ImageDataLayout {
    offset: 0,              // Start at the beginning of the byte slice
    bytes_per_row: Some(width * 8),  // 8 bytes per pixel for Rgba16Float
    rows_per_image: Some(height),    // Only relevant for 3D textures / arrays
}
```

Unlike `copy_texture_to_buffer`, `queue.write_texture()` does NOT require row alignment. The source data can be tightly packed — wgpu handles the alignment internally. This is a convenience that makes uploading pixel data simpler than the readback path.


## Chapter 22: Putting It All Together

Let's trace the complete lifecycle of a single frame in Grain, from the application requesting a render to pixels appearing on screen (or being saved to disk).

### Phase 1: Update Parameters

The CPU prepares the per-frame data:

```rust
let mut params = RenderParams::new(options.width, options.height);
params.time = options.time;
params.frame = options.frame;
params.set_bpm(options.bpm);
for (i, knob_val) in options.knobs.iter().enumerate() {
    params.set_knob(i, *knob_val);
}
self.queue
    .write_buffer(&self.params_buffer, 0, bytemuck::cast_slice(&[params]));
```

This 288-byte write is the primary CPU → GPU data transfer per frame. All the information the shader needs (time, frame number, resolution, BPM, control surface values) is packed into a single uniform buffer update.

### Phase 2: Copy Feedback

If the program has feedback loops, copy current feedback textures to their `_prev` counterparts:

```rust
if program.metadata.has_feedback {
    self.copy_feedback_to_prev(options.width, options.height)?;
}
```

This is a GPU-to-GPU copy — fast and doesn't involve the CPU. After this, each `feedback_N_prev` texture contains the previous frame's output of `feedback_N`.

### Phase 3: Render Blocks in Dependency Order

For each block in topological order:

```rust
for block_id in program.graph.execution_order() {
    // Skip static blocks that are already cached
    if !block.is_dynamic && options.frame > 0 && self.texture_manager.has_texture(block_id) {
        continue;
    }
    self.render_block(block_id, shader_output, options.width, options.height)?;
}
```

Each `render_block` call:

1. **Ensures dependency textures exist** — creates any needed textures in the texture manager
2. **Creates a bind group** — connects the block's input textures, tilesets, sampler, and uniform buffer to the shader's binding points
3. **Records a render pass** — clears the target texture, sets the pipeline and bind group, draws 3 vertices (the fullscreen triangle)
4. **Submits to the GPU queue** — the GPU executes the render pass

After a block renders, its output texture is available for downstream blocks to sample.

### Phase 4: Present or Export

**Live preview path:**

```
Output texture ──copy──► Display texture ──display shader──► Surface texture ──present──► Screen
```

1. Copy the `output` texture to a display-compatible texture
2. Run the display shader (letterboxing, resolution adaptation) to render onto the window surface's texture
3. Call `frame.present()` to show the result

**Export path:**

```
Output texture ──copy──► Staging buffer ──map──► CPU memory ──image crate──► File
```

1. Copy the `output` texture to a staging buffer (GPU-to-GPU)
2. Map the staging buffer for CPU read access (GPU-to-CPU sync)
3. Convert `f16` pixels to `u8`
4. Save to file using the `image` crate

### The Complete Data Flow

Here's the full picture for a Grain program with two named blocks and feedback:

```
CPU                                 GPU
────                                ───

write_buffer(params)    ──────►    params uniform buffer
                                        │
                                   copy feedback_0 → feedback_0_prev
                                        │
                                   ┌────▼──────────────────────┐
                                   │ Render block "bg"          │
                                   │  read: params              │
                                   │  write: texture "bg"       │
                                   └────┬──────────────────────┘
                                        │
                                   ┌────▼──────────────────────┐
                                   │ Render block "feedback_0"  │
                                   │  read: params, "bg",       │
                                   │        feedback_0_prev     │
                                   │  write: texture feedback_0 │
                                   └────┬──────────────────────┘
                                        │
                                   ┌────▼──────────────────────┐
                                   │ Render block "output"      │
                                   │  read: params, "bg",       │
                                   │        feedback_0          │
                                   │  write: texture "output"   │
                                   └────┬──────────────────────┘
                                        │
                                   copy output → display_texture
                                        │
                                   ┌────▼──────────────────────┐
                                   │ Display render pass        │
                                   │  read: display_texture,    │
                                   │        display_params      │
                                   │  write: surface texture    │
                                   └────┬──────────────────────┘
                                        │
                                   present()
                                        │
                                        ▼
                                   Screen
```

The CPU's involvement after the initial parameter write is minimal — it issues GPU commands but doesn't touch pixel data. All the heavy per-pixel work happens on the GPU.

### The Export Path

The export path (saving frames as images or GIF) has a different lifecycle because it needs to read pixels back to the CPU. Here's the sequence for a single frame export:

```rust
// grain/src/export.rs — export_frame_with_inputs()

// 1. Create a headless renderer (no window, no surface)
let mut renderer = Renderer::new(options.width, options.height).await?;

// 2. Load the compiled program (creates shader modules and pipelines)
renderer.load_program(program)?;

// 3. Load input images if any
for (i, path) in input_images.iter().enumerate() {
    let img = image::open(path)?.to_rgba8();
    renderer.load_input_image(i, img.as_raw(), options.width, options.height);
}

// 4. For feedback programs, render preceding frames to accumulate state
if program.metadata.has_feedback && options.frame > 0 {
    for f in 0..options.frame {
        let _ = renderer.render(program, &prev_options)?;
    }
}

// 5. Render the target frame and read pixels back
let pixels = renderer.render(program, &options)?;

// 6. Save to file
let img = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, pixels).unwrap();
img.save(output_path)?;
```

Step 4 is notable: if the program uses feedback and you want to export frame 30, the renderer must render frames 0–29 first to build up the feedback state. Each frame's feedback textures depend on the previous frame. The results of frames 0–29 are discarded (only the texture-to-buffer readback happens on the final frame), but the GPU still does all the work of rendering them.

For video export (GIF or image sequence), the renderer stays alive across frames, accumulating feedback state naturally:

```rust
for frame_num in 0..total_frames {
    let pixels = renderer.render(program, &options)?;
    // Encode frame to GIF or save as individual PNG
}
```

This is more efficient than the single-frame path because each frame builds on the previous frame's feedback state directly.

### Performance Characteristics

To give a sense of the numbers involved:

| Resolution | Pixels | Texture Size (Rgba16Float) | Frame Budget (60fps) |
|------------|--------|---------------------------|---------------------|
| 128×128 | 16,384 | 128 KB | 16.7 ms |
| 512×512 | 262,144 | 2 MB | 16.7 ms |
| 1920×1080 | 2,073,600 | 16 MB | 16.7 ms |
| 3840×2160 | 8,294,400 | 64 MB | 16.7 ms |

A simple Grain program (one block, no textures) renders at 1080p in well under 1 ms on modern GPUs. A complex program (5+ blocks, feedback, blur passes) might take 2–5 ms. The bottleneck is usually texture bandwidth (reading multiple large textures) rather than shader computation.

Export mode doesn't have the 16.7 ms budget constraint and can afford to render at higher resolutions or with more complex programs. The bottleneck shifts to the readback step — mapping the staging buffer and copying pixels to CPU memory.

---

# Appendices

## Appendix A: WGSL Quick Reference

WGSL (WebGPU Shading Language) is designed to be the universal shader language for WebGPU. It borrows syntax from Rust, C, and GLSL, but has its own distinct personality. This appendix covers the WGSL features used in Grain-generated shaders.

### Scalar Types

| Type | Description |
|------|-------------|
| `f32` | 32-bit float |
| `f16` | 16-bit float (requires extension) |
| `i32` | 32-bit signed integer |
| `u32` | 32-bit unsigned integer |
| `bool` | Boolean |

### Vector Types

| Type | Shorthand | Description |
|------|-----------|-------------|
| `vec2<f32>` | `vec2f` | 2D float vector |
| `vec3<f32>` | `vec3f` | 3D float vector |
| `vec4<f32>` | `vec4f` | 4D float vector (RGBA color) |
| `vec2<u32>` | `vec2u` | 2D unsigned int vector |
| `vec2<i32>` | `vec2i` | 2D signed int vector |

### Vector Construction

```wgsl
vec4f(1.0, 0.5, 0.0, 1.0)   // Explicit components
vec4f(0.5)                     // Splat: vec4f(0.5, 0.5, 0.5, 0.5)
vec4f(v.rgb, 1.0)             // Swizzle + scalar
vec2f(v.x, v.y)               // Extract components
```

### Swizzling

```wgsl
let v = vec4f(1.0, 2.0, 3.0, 4.0);
v.x    // 1.0
v.xy   // vec2f(1.0, 2.0)
v.rgb  // vec3f(1.0, 2.0, 3.0)
v.zyx  // vec3f(3.0, 2.0, 1.0) — reorder
v.xxx  // vec3f(1.0, 1.0, 1.0) — repeat
```

### Operators

Arithmetic operators work component-wise on vectors:

```wgsl
vec4f(1,2,3,4) + vec4f(5,6,7,8)  // vec4f(6,8,10,12)
vec4f(1,2,3,4) * vec4f(2,2,2,2)  // vec4f(2,4,6,8)
vec4f(1,2,3,4) * 0.5             // vec4f(0.5,1,1.5,2)
```

### Built-in Functions Used in Grain

**Math:**

| Function | Description |
|----------|-------------|
| `sin(x)`, `cos(x)`, `tan(x)` | Trigonometry (radians) |
| `atan2(y, x)` | Two-argument arctangent |
| `abs(x)` | Absolute value |
| `floor(x)`, `ceil(x)` | Rounding |
| `fract(x)` | Fractional part: `x - floor(x)` |
| `min(a, b)`, `max(a, b)` | Min/max |
| `clamp(x, lo, hi)` | Clamp to range |
| `mix(a, b, t)` | Linear interpolation: `a*(1-t) + b*t` |
| `step(edge, x)` | 0.0 if `x < edge`, 1.0 otherwise |
| `smoothstep(lo, hi, x)` | Smooth Hermite interpolation |
| `pow(base, exp)` | Power |
| `sqrt(x)` | Square root |
| `log(x)`, `log2(x)` | Natural/base-2 logarithm |
| `exp(x)`, `exp2(x)` | Exponential |
| `sign(x)` | -1.0, 0.0, or 1.0 |

**Vector:**

| Function | Description |
|----------|-------------|
| `length(v)` | Vector magnitude |
| `distance(a, b)` | Distance between points |
| `dot(a, b)` | Dot product |
| `normalize(v)` | Unit vector |
| `cross(a, b)` | Cross product (vec3f only) |
| `reflect(v, n)` | Reflection |

**Control flow:**

| Function | Description |
|----------|-------------|
| `select(f, t, cond)` | Branchless conditional: `t` if `cond`, else `f` |

**Texture:**

| Function | Description |
|----------|-------------|
| `textureSample(tex, sampler, uv)` | Sample 2D texture with filtering |
| `textureSample(tex, sampler, uv, layer)` | Sample 2D array texture |
| `textureLoad(tex, coord, mip)` | Load texel by integer coords |
| `textureDimensions(tex)` | Get texture size as `vec2u` |

### Resource Declarations

```wgsl
// Uniform buffer
@group(0) @binding(0) var<uniform> params: Params;

// 2D texture
@group(0) @binding(1) var my_texture: texture_2d<f32>;

// 2D texture array
@group(0) @binding(2) var my_array: texture_2d_array<f32>;

// Sampler
@group(0) @binding(3) var my_sampler: sampler;
```

### Shader Entry Points

```wgsl
@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4f {
    // Return clip-space position
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    // Return RGBA color
}
```

### Variable Declarations

WGSL has two ways to declare local variables:

```wgsl
let x = 5.0;      // Immutable (like Rust's let)
var y = 5.0;       // Mutable (like Rust's let mut)
y = 10.0;          // OK — y is var
// x = 10.0;       // ERROR — x is let
```

Grain's generated code uses `let` almost exclusively, since most intermediate values are computed once and never modified. The rare `var` is used for conditionals like `gate()`:

```wgsl
var gate_0 = vec4f(0.0);
if (cond.x > 0.0) {
    gate_0 = body_value;
}
```

### Control Flow

```wgsl
// If-else
if (condition) {
    // ...
} else {
    // ...
}

// Switch (used in vertex shaders for vertex position selection)
switch my_value {
    case 0u: { /* ... */ }
    case 1u: { /* ... */ }
    default: { /* ... */ }
}

// For loops (not used in Grain's generated code, but available)
for (var i = 0u; i < 10u; i++) {
    // ...
}
```

### Type Conversions

WGSL requires explicit type conversions — there are no implicit promotions:

```wgsl
let a: u32 = 5u;
let b: f32 = f32(a);      // u32 → f32
let c: i32 = i32(b);      // f32 → i32 (truncates)
let d: u32 = u32(b);      // f32 → u32 (truncates, must be non-negative)
```

Grain's codegen uses these conversions frequently. For example, converting `params.frame` (which is `u32`) for use in floating-point expressions:

```wgsl
let frame_val_0 = f32(params.frame);
```

### Important WGSL Gotchas

**Integer division truncates toward zero**, just like Rust.

**The `%` operator** works on floats (unlike Rust, where `%` is integer-only and you need `f32::rem`).

**No implicit scalar-to-vector promotion** in most contexts. You can't write `vec4f(1.0, 2.0, 3.0, 4.0) + 1.0`. You must write `vec4f(1.0, 2.0, 3.0, 4.0) + vec4f(1.0)` (using the splat constructor). However, multiplication of a vector by a scalar works: `vec4f(1.0, 2.0, 3.0, 4.0) * 2.0`.

**`discard` statement** can appear in fragment shaders to abort the current fragment without writing any output. Grain doesn't use this — every pixel always writes a color.


## Appendix B: Debugging GPU Code

GPU debugging is fundamentally different from CPU debugging. You can't set breakpoints in a fragment shader. You can't `println!` from GPU code. You can't step through execution. The GPU runs millions of shader invocations in parallel, and they all must complete before you see any output. This appendix covers the practical techniques for debugging Grain's GPU rendering.

### Common Pitfalls

**Alignment mismatches.** The most insidious bug in GPU programming. If your Rust struct has `[f32; 3]` (12 bytes) but the WGSL struct has `vec3f` (which is 16-byte aligned and padded to 16 bytes), all subsequent fields will be offset. Symptoms: garbled values, reading neighboring fields' data. Prevention: keep Rust and WGSL layouts in sync, test with known values, use `assert_eq!(std::mem::size_of::<MyStruct>(), expected_size)`.

Grain avoids this by using only naturally-aligned types in `RenderParams`: `f32`, `u32`, `[f32; 4]` (= `vec4f`), and `[[f32; 4]; 16]` (= `array<vec4f, 16>`). No `vec3f` or `vec2f` fields that could cause alignment surprises.

**sRGB vs linear color space.** Textures marked as `Srgb` (like `Rgba8UnormSrgb`) automatically convert between sRGB and linear color space when reading/writing. If you do math in sRGB space, colors blend incorrectly (mid-tones appear too dark). If you forget to convert back to sRGB for display, colors appear washed out.

Grain sidesteps this by using `Rgba16Float` for all internal textures — a linear format with no automatic conversion. The sRGB conversion happens only at the display stage when rendering to the window surface.

**Coordinate systems.** In WGSL, `@builtin(position)` in a fragment shader gives pixel coordinates where (0.5, 0.5) is the center of the top-left pixel. The y-axis points downward (y=0 at top). This matches screen coordinates but differs from OpenGL conventions (y=0 at bottom). Grain normalizes to UV coordinates immediately (`pos.x / width`, `pos.y / height`), making the rest of the code coordinate-system-agnostic.

**Texture row padding.** When copying texture data to/from buffers, each row must be aligned to `COPY_BYTES_PER_ROW_ALIGNMENT` (256 bytes). If your texture is 100 pixels wide at 8 bytes/pixel, that's 800 bytes per row — but the buffer must have 1024-byte rows (next multiple of 256). Forgetting this causes garbled or shifted images.

**Reading and writing the same texture.** You cannot sample a texture that is also the render target of the current render pass. The results are undefined. Grain avoids this through its feedback copy pattern (Chapter 17) — always copy to `_prev` before rendering.

### Debugging Strategies

**Solid color test.** If your shader isn't producing output, start by returning a solid color:

```wgsl
return vec4f(1.0, 0.0, 1.0, 1.0);  // Magenta
```

If you see magenta, the pipeline is working and the problem is in the shader math. If you see nothing, the problem is in the pipeline setup (wrong render target, missing bind group, etc.).

**UV gradient.** Verify coordinate mapping by outputting UV as color:

```wgsl
return vec4f(uv.x, uv.y, 0.0, 1.0);  // Red = x, Green = y
```

You should see a gradient from black (top-left) to yellow (bottom-right), with red (bottom-left) and green (top-right).

**Value inspection.** To debug a specific value, encode it as a visible color. For a value expected to be in [0, 1]:

```wgsl
let debug_val = my_value.x;
return vec4f(debug_val, debug_val, debug_val, 1.0);
```

For values outside [0, 1], scale them: `clamp(my_value / 10.0, vec4f(0.0), vec4f(1.0))`.

**Naga error messages.** When `create_shader_module` fails, naga produces error messages that reference WGSL line numbers and column positions. The errors can be cryptic, but they usually point to the right location. Common causes: mismatched types in expressions, incorrect number of arguments to built-in functions, or missing resource bindings.

**Infinite or NaN values.** GPU floating-point math can produce infinity or NaN (Not a Number) through division by zero, `sqrt` of negative numbers, or `log` of zero. These values propagate through subsequent operations — any arithmetic involving NaN produces NaN. The result is typically black, white, or flickering pixels. Grain's codegen guards against some of these cases (e.g., modulo uses `max(divisor, 0.0001)` to prevent division by zero), but user expressions can still trigger them.

**Texture not initialized.** If a block references a texture that hasn't been rendered yet (due to incorrect execution order), it reads whatever data happens to be in GPU memory — usually garbage or zeros. Grain's topological sort should prevent this, but bugs in the dependency graph builder can cause it.

### Strategies for Shader Debugging

**The magenta test.** When nothing appears on screen, the first question is: is the pipeline working at all? Change the fragment shader's return to:

```wgsl
return vec4f(1.0, 0.0, 1.0, 1.0);  // Magenta — impossible to miss
```

If you see magenta, the pipeline (vertex shader, rasterization, render target, presentation) is all working. The problem is in the fragment shader's logic. If you see black, the pipeline itself is broken.

**Binary search with early returns.** For complex shaders, narrow down the problem by returning intermediate values. Start by returning the UV coordinates to verify position mapping:

```wgsl
return vec4f(uv.x, uv.y, 0.0, 1.0);
```

Then progressively return values from later stages of the computation to find where things go wrong.

**Writing to a file.** For non-visual bugs, export the frame as a PNG and inspect it in an image editor. You can check exact pixel values, look for subtle artifacts, and compare against reference images. Grain's reference tests use this approach — rendering frames at small sizes (32×32) and comparing against known-good outputs.

**Printing the generated WGSL.** When the codegen produces wrong results, the most direct debugging technique is to print the generated WGSL string and read it. Add a temporary `eprintln!("{}", shader_output.code)` in the compilation path. The generated code is verbose but readable — you can trace the logic manually.

**wgpu validation layers.** In debug builds, wgpu enables validation layers that check for common errors: mismatched bind groups, incorrect buffer sizes, reading unmapped buffers, etc. These validation errors show up as panic messages with descriptive text. Always develop in debug mode to catch these early.


## Appendix C: Performance Considerations

### Texture Bandwidth

The primary performance bottleneck in Grain is texture bandwidth — the rate at which shaders can read from textures. Each `textureSample` call reads 8 bytes of data (4 × f16 channels) from GPU memory. For a 1920×1080 output with 5 texture reads per pixel, that's:

```
1920 × 1080 × 5 × 8 = ~83 MB per frame
```

At 60 fps, that's ~5 GB/s of texture bandwidth — well within a modern GPU's capabilities (which can handle 200+ GB/s), but it adds up quickly with complex programs that have many texture dependencies and filter passes.

### Shader Complexity

The fragment shader runs for every pixel. Even small per-pixel costs add up. For a 1920×1080 image at 60 fps:

- 1 extra multiply per pixel = 124 million extra operations/second
- 1 extra `textureSample` per pixel = ~500 MB/s extra bandwidth

Grain's code generation inlines everything into a single function. While this avoids function call overhead, it can produce very long shaders for complex programs. Extremely long shaders may hit GPU instruction cache limits, though this is rarely a practical concern.

### Why `render_at` Exists

The `render_at` spatial transform evaluates its body expression at a reduced resolution, then upscales the result. This is a performance optimization for expensive effects: if a noise+blur chain looks the same at half resolution, `render_at(expr, 0.5, 0.5)` cuts the fragment shader invocations by 4×.

```wgsl
// render_at divides the UV grid, evaluating fewer unique pixels
let rndrat_0_sx = max(rndrat_nx.x, 1.0) / f32(params.width);
let rndrat_0_sy = max(rndrat_ny.x, 1.0) / f32(params.height);
let rndrat_0 = vec2f(
    floor(uv.x / rndrat_0_sx) * rndrat_0_sx + rndrat_0_sx * 0.5,
    floor(uv.y / rndrat_0_sy) * rndrat_0_sy + rndrat_0_sy * 0.5
);
```

Multiple pixels end up sampling at the same snapped UV coordinate, so the shader still runs for every output pixel, but the texture reads and heavy math operate on a coarser grid. The GPU's texture cache makes repeated reads at the same coordinates essentially free.

### When to Use `pixelate`

The `pixelate` (also called `nn` for nearest-neighbor) transform is similar to `render_at` but is a creative effect rather than an optimization. It snaps UV coordinates to a grid, creating visible pixel-art-style blocks. Each block of N×N output pixels reads the same texture coordinate.

Both `render_at` and `pixelate` exploit the GPU's texture cache: when many fragment shader invocations read the same texture coordinate, the first read brings the data into cache, and subsequent reads are nearly free.

### Multi-Block Overhead

Each block in a Grain program requires a separate render pass and command submission. The overhead per block includes:
- Command buffer creation and submission
- Pipeline state changes
- Bind group creation
- Render target clearing

For programs with many blocks, this overhead can become significant. However, the alternative — compiling everything into a single monolithic shader — would lose the ability to cache static blocks and would create extremely long shaders.

### Static Block Caching

Grain optimizes blocks whose output doesn't change between frames:

```rust
if !block.is_dynamic && options.frame > 0 && self.texture_manager.has_texture(block_id) {
    continue;
}
```

A block is marked as non-dynamic (static) if it doesn't reference `time`, `frame`, feedback textures, or other time-varying inputs. Static blocks render once and their textures are reused on all subsequent frames. This is a significant optimization for programs where only part of the expression tree is animated.

### Memory Usage

Each texture consumes `width × height × 8 bytes` (for `Rgba16Float`). At 1920×1080, that's approximately 16 MB per texture. A program with 5 blocks plus feedback textures plus `_prev` copies might use 10-15 textures, totaling 160-240 MB of GPU memory. This is well within the capacity of modern GPUs (which typically have 4-16 GB of VRAM), but can become significant at very high resolutions (4K) or with many blocks.

Grain's `TextureManager` doesn't proactively free textures. When a program is hot-reloaded and blocks change, old textures may linger until the manager is cleared (which happens on `load_program`). This is acceptable for interactive use but worth being aware of for long-running sessions with frequent reloads.

### CPU-GPU Synchronization

The biggest performance risk isn't the GPU work itself — it's waiting for the GPU. Grain's export path must map a staging buffer after rendering, which requires `device.poll(Maintain::Wait)` — a blocking call that stalls the CPU until the GPU finishes all queued work. In the live preview, this is avoided entirely: the CPU submits work to the GPU and moves on, with presentation happening asynchronously.

If Grain's live preview ever needs to read pixel data (e.g., for a histogram or color picker), it would need to be careful to avoid per-frame synchronization, which would cap the frame rate at the GPU round-trip time. One approach would be to read data that's a frame or two old, using a ring of staging buffers.

### Pipeline State Changes

Each block requires a separate pipeline (because each block has different shader code and bind group layout). Changing pipelines between draw calls has some overhead — the GPU must reconfigure its shader processors. In Grain's case, each pipeline change is followed by a draw call that processes millions of pixels, so the setup cost is amortized. But for programs with many tiny blocks (each doing very little work), the overhead could dominate.

### Texture Format Choice

Grain uses `Rgba16Float` (64 bits per pixel) instead of `Rgba8Unorm` (32 bits per pixel). This doubles memory usage and bandwidth, but provides important benefits:

1. **Precision in intermediate computations.** Chaining multiple operations (blur → color transform → blend) with 8-bit intermediates accumulates rounding errors quickly. 16-bit floats preserve enough precision for long processing chains.
2. **Values outside [0, 1].** Intermediate results can exceed the visible range. An 8-bit format clamps to [0, 1], losing information. Float formats preserve the full value, allowing later operations to bring it back into range.
3. **Avoiding banding.** 256 levels (8-bit) can show visible banding in smooth gradients. 16-bit floats have ~1024 levels in the [0, 1] range, effectively eliminating perceptible banding.

The final output clamping to [0, 1] and conversion to 8-bit happens only at the very end — when presenting to the screen or exporting to a file.

## Appendix D: Glossary

**Adapter.** A handle to a physical GPU. Obtained from an `Instance`. Used to create a `Device`.

**Bind group.** A set of GPU resources (textures, samplers, buffers) bound together for use by a shader. Created from a `BindGroupLayout`.

**Bind group layout.** A declaration of what types of resources a shader expects at each binding index. Baked into the render pipeline.

**Block (Grain).** A named computation unit in Grain's dependency graph. Each block has its own shader and renders to its own texture.

**Buffer.** A linear array of bytes on the GPU. Used for vertex data, uniform data, or general storage.

**Clip space.** The coordinate system after vertex shader processing. Ranges from (-1, -1) at bottom-left to (1, 1) at top-right. The Z axis ranges from 0 to 1.

**Color attachment.** A texture that a render pass writes color data to. Specified in `RenderPassDescriptor`.

**Command buffer.** A recorded sequence of GPU commands. Created by finishing a `CommandEncoder`, submitted via `Queue::submit()`.

**Command encoder.** Records GPU commands (render passes, copies) into a command buffer.

**Device.** A logical connection to a GPU. The handle for creating all GPU resources.

**Feedback (Grain).** A texture that persists between frames, allowing temporal effects. Uses the ping-pong pattern with `_prev` copies.

**Fragment.** A candidate pixel generated by the rasterizer. Processed by the fragment shader.

**Fragment shader.** A GPU program that runs per-fragment, computing a color from interpolated inputs.

**Framebuffer.** The texture(s) being rendered to. In wgpu, this is configured via color attachments in the render pass descriptor.

**Instance.** The entry point to wgpu. Represents the GPU subsystem.

**Linear color space.** A color space where values are proportional to physical light intensity. Math (blending, interpolation) is physically correct in linear space.

**Mipmap.** Pre-computed downscaled versions of a texture for anti-aliased sampling at various distances. Not used in Grain.

**Naga.** The shader translation and validation library used by wgpu. Parses WGSL and translates to platform-native formats.

**Pipeline (render).** An immutable GPU object that combines shader modules, vertex format, blend state, and output format into a complete rendering configuration.

**Queue.** The submission queue for GPU work. Command buffers are submitted to the queue for execution.

**Rasterization.** The fixed-function GPU stage that converts triangles into fragments (pixels).

**Render pass.** A unit of GPU rendering work. Specifies the render targets, load/store operations, and contains draw commands.

**Render target.** A texture being written to by a render pass. Also called a "color attachment."

**Sampler.** A GPU object that defines how textures are read: filtering mode (nearest/linear) and address mode (clamp/repeat/mirror).

**Shader module.** A compiled WGSL program loaded onto the GPU. Contains one or more shader entry points.

**SIMT.** Single Instruction, Multiple Threads. The GPU execution model where many threads execute the same instruction simultaneously on different data.

**sRGB.** A color space with a non-linear transfer function that approximates human brightness perception. Used for display output.

**Staging buffer.** A GPU buffer used as an intermediary for data transfer between GPU and CPU. Has `MAP_READ` or `MAP_WRITE` usage.

**Surface.** A wgpu object representing a platform window's drawable area. Provides textures for on-screen rendering.

**Texture.** A structured array of pixel data on the GPU, with hardware-accelerated sampling support.

**Texture array.** A texture with multiple layers of the same dimensions. Sampled with an additional layer index.

**Texture view.** A description of how to interpret a texture's data for binding purposes.

**Topological sort.** An ordering of a directed acyclic graph where each node comes after all its dependencies. Used to determine block execution order.

**Uniform buffer.** A GPU buffer bound as `var<uniform>` in shaders. Read-only, same value for all shader invocations. Optimized for broadcast access.

**UV coordinates.** Normalized 2D coordinates, typically in [0, 1] range, used to address textures and position computations.

**Vertex shader.** A GPU program that runs per-vertex, typically transforming positions from model space to clip space.

**WGSL.** WebGPU Shading Language. The shader language used by wgpu and the WebGPU standard.

---

*This book covers the wgpu and GPU concepts used in the Grain video synthesis language. For the Grain language itself — its syntax, expressions, and built-in functions — see the Grain user guide.*
