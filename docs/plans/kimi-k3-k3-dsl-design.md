# kimi-k3 K3-DSL-DESIGN

**Batch ID:** msgbatch_0122G9PYnc14juXpmsEFp3n6

# EdgeML — A DSL for Ultra-Low-Memory Edge Inference

**Design document v1.0** — inspired by the *kimi-k3-in-c* philosophy: pure C99, zero dependencies, static everything, know your RAM budget before you burn a single cycle.

---

## 0. Design Philosophy

| Principle | Consequence |
|---|---|
| **No runtime** | EdgeML compiles to a single `.c` + `.h` file. No interpreter, no dispatcher, no malloc after init. |
| **Quantization is a type, not an attribute** | You cannot write a matmul between incompatible quant formats without an explicit `dequant`/`requant`. The type checker enforces it. |
| **RAM is declared, not discovered** | Every program names a `target`. The compiler computes peak RAM exactly and **refuses to compile** if it doesn't fit. |
| **One IR, many ISAs** | Hardware-agnostic IR; the codegen backend selects NEON/AVX2/scalar kernel templates at emission time. |
| **Shapes are static** | All dims resolved at compile time (max sequence length is a config constant). Enables exact memory planning. |

---

## (a) Full EBNF Grammar

```ebnf
(* ============================================================ *)
(*  EdgeML v1.0 — EBNF Grammar                                  *)
(* ============================================================ *)

program        = { top_decl } ;

top_decl       = target_decl
               | const_decl
               | quant_decl
               | tensor_decl
               | layer_decl
               | attention_decl
               | moe_decl
               | model_decl
               | export_decl ;

(* ---------------- Target & constants ------------------------ *)

target_decl    = "target" ident "{" { target_field } "}" ;
target_field   = "arch"   "=" ( "arm64" | "x86_64" | "generic" ) ";"
               | "simd"   "=" ( "neon" | "avx2" | "none" ) ";"
               | "ram"    "=" mem_literal ";"
               | "align"  "=" int_literal ";" ;         (* alloc alignment, bytes *)

const_decl     = "const" ident "=" const_expr ";" ;
const_expr     = int_literal | const_expr op const_expr
               | "(" const_expr ")" | ident ;
op             = "+" | "-" | "*" | "/" | "%" ;

mem_literal    = int_literal ( "B" | "KB" | "MB" | "GB" ) ;

(* ---------------- Quantization types ------------------------ *)

quant_decl     = "quantscheme" ident "=" quant_type ";" ;

quant_type     = base_type [ "[" quant_params "]" ] ;
base_type      = "mxfp4" | "int8" | "int4" | "bf16" | "fp16" | "fp32" ;
quant_params   = quant_param { "," quant_param } ;
quant_param    = "block"     "=" int_literal            (* block size, elems  *)
               | "scale"     "=" scale_type             (* per-block scale     *)
               | "zero"      "=" ( "sym" | "asym" ) ;
scale_type     = "e8m0" | "fp16" | "bf16" | "fp32" ;

(* ---------------- Tensor types ------------------------------ *)

tensor_type    = "tensor" "<" quant_ref "," shape ">" ;
quant_ref      = quant_type | ident ;                   (* named scheme OK    *)
shape          = "[" dim { "," dim } "]" ;
dim            = const_expr | "?" ;                     (* "?" = seq axis,
                                                           bounded by max_seq *)

tensor_decl    = "weight" ident ":" tensor_type ";"     (* loaded from file   *)
               | "state"  ident ":" tensor_type ";"     (* persistent buffer  *)
               | "scratch" ident ":" tensor_type ";" ;  (* arena-planned      *)

(* ---------------- Layer definitions ------------------------- *)

layer_decl     = "layer" ident [ param_list ] "{" { layer_stmt } "}" ;
param_list     = "(" param { "," param } ")" ;
param          = ident ":" ( "int" | "quant" | tensor_type ) ;

layer_stmt     = tensor_decl
               | assign_stmt
               | return_stmt ;

assign_stmt    = ident "=" expr ";" ;
return_stmt    = "return" expr ";" ;

expr           = call_expr | ident | expr binop expr | "(" expr ")" ;
binop          = "+" | "*" | "@" ;                      (* "@" = matmul       *)

call_expr      = builtin "(" [ arg_list ] ")" ;
arg_list       = arg { "," arg } ;
arg            = expr | ident "=" const_expr | ident "=" quant_ref ;

builtin        = "matmul"   | "rmsnorm"  | "layernorm" | "rope"
               | "softmax"  | "silu"     | "gelu"      | "swiglu"
               | "add"      | "mul"      | "embed"
               | "quant"    | "dequant"  | "requant"
               | "topk"     | "route"    | "gather"    | "scatter_add"
               | "kda_update" | "kda_read"
               | "argmax"   | "sample" ;

(* ---------------- Attention blocks -------------------------- *)

attention_decl = "attention" ident [ param_list ] "{" { attn_field | layer_stmt } "}" ;
attn_field     = "kind"      "=" ( "kda" | "mha" | "gqa" ) ";"
               | "heads"     "=" const_expr ";"
               | "kv_heads"  "=" const_expr ";"
               | "head_dim"  "=" const_expr ";"
               | "rope_base" "=" int_literal ";"
               | "decay"     "=" ( "learned" | "fixed" ) ";"   (* KDA only *)
               | "beta"      "=" ( "learned" | "fixed" ) ";"   (* KDA only *)
               | "state_dtype" "=" quant_ref ";" ;             (* KDA state *)

(* ---------------- MoE blocks --------------------------------- *)

moe_decl       = "moe" ident [ param_list ] "{" { moe_field | layer_stmt } "}" ;
moe_field      = "experts"     "=" const_expr ";"
               | "active"      "=" const_expr ";"        (* top-k              *)
               | "expert"      "=" ident ";"             (* layer used per-exp *)
               | "router_dtype" "=" quant_ref ";"
               | "norm_topk"   "=" ( "true" | "false" ) ";" ;

(* ---------------- Model assembly ----------------------------- *)

model_decl     = "model" ident "{" { model_field | pipe_stmt } "}" ;
model_field    = "vocab"    "=" const_expr ";"
               | "d_model"  "=" const_expr ";"
               | "max_seq"  "=" const_expr ";"
               | "layers"   "=" const_expr ";"
               | tensor_decl ;

pipe_stmt      = "pipeline" "{" { pipe_op } "}" ;
pipe_op        = ident "(" [ arg_list ] ")" ";"          (* instantiate block  *)
               | "repeat" "(" const_expr ")" "{" { pipe_op } "}"
               | "if" "(" const_expr ")" "{" { pipe_op } "}"
                 [ "else" "{" { pipe_op } "}" ] ;

export_decl    = "export" ident "for" ident ";" ;        (* model for target   *)

(* ---------------- Lexical ------------------------------------ *)

ident          = letter { letter | digit | "_" } ;
int_literal    = digit { digit } ;
comment        = "//" { any_char - newline } newline
               | "/*" { any_char } "*/" ;
```

**Key grammar decisions:**

- `weight` / `state` / `scratch` are three distinct *storage classes* — this is what makes the static memory planner tractable (§c).
- `?` in a shape means "sequence axis," bounded by `max_seq`. The planner always budgets for the worst case.
- `repeat(N) { ... }` with compile-time `N` unrolls into per-layer weight instances — no dynamic dispatch.
- `if (const_expr)` inside a pipeline enables per-layer heterogeneity (e.g., alternating dense/MoE) resolved at compile time.

---

## Type System: Quantization as First-Class Types

A tensor type is `tensor<Q, [dims]>` where `Q` fully determines the byte layout:

| Type expr | Bits/elem (effective) | Layout |
|---|---|---|
| `mxfp4[block=32, scale=e8m0]` | 4.25 | 32× fp4(e2m1) packed in 16B + 1B shared exponent scale |
| `int8[block=64, scale=fp16, zero=sym]` | 8.25 | 64× i8 + 2B fp16 scale |
| `int4[block=32, scale=fp16, zero=asym]` | 5.0 | 32× i4 packed + scale + zero-point |
| `bf16` | 16 | plain array |
| `fp16` | 16 | plain array |
| `fp32` | 32 | plain array (accumulators, norms) |

**Typing rules (enforced, not warned):**

1. `matmul(A, W)` requires `A : fp32|fp16|bf16` activations and `W : any quant`. Dequantization happens **inside the fused kernel** — never as a materialized tensor — but the *type* of the output must be declared: `matmul(x, w, out=fp32)`.
2. `add(a, b)` requires `typeof(a) == typeof(b)` exactly (including block size). Otherwise: compile error `E0301: quant mismatch, insert requant()`.
3. Block size must evenly divide the innermost dimension: `mxfp4[block=32]` on `[640, 896]` ⇒ 896 % 32 == 0 ✓. Otherwise `E0302`.
4. KDA state tensors must be `fp16`, `bf16`, or `fp32` (recurrent state accumulates error; quantized state is rejected with `E0310` unless `--allow-lossy-state`).
5. Accumulation dtype is always `fp32` inside kernels; this is not user-visible or overridable (a deliberate simplification, kimi-k3-in-c style).

---

## (b) Core IR Node Types (Hardware-Agnostic)

The IR is a static single-assignment (SSA) dataflow graph. Every node has: `id`, `out_type` (quant + shape), `deps[]`, and a `lifetime` interval `[first_use, last_use]` filled in by the planner.

```c
typedef enum {
    /* ---- Data movement / storage (5) ---- */
    IR_WEIGHT,        // ref into read-only weight arena; fields: offset, quant, shape
    IR_STATE,         // ref into persistent state arena (KDA state, rope cache)
    IR_SCRATCH,       // arena-planned temporary; fields: size, align, lifetime
    IR_EMBED_LOOKUP,  // gather rows from quantized embedding table; fields: table, ids
    IR_COPY,          // explicit copy between arenas (rare; e.g. state snapshot)

    /* ---- Quantization (3) ---- */
    IR_QUANT,         // fp -> blocked quant; fields: scheme{base, block, scale_t, zero}
    IR_DEQUANT,       // blocked quant -> fp (only legal when fused or tiny)
    IR_REQUANT,       // scheme A -> scheme B, single pass, no fp32 materialization

    /* ---- Linear algebra (3) ---- */
    IR_MATMUL_Q,      // fused dequant-matmul: act(fp) x weight(quant) -> fp32
                      //   fields: M, N, K, w_quant, transpose, accum=fp32
    IR_MATMUL_F,      // fp x fp matmul (router logits, small projections)
    IR_OUTER_ACC,     // rank-1 update: S += beta * (v - S k) k^T   (KDA primitive)

    /* ---- Normalization / activation (4) ---- */
    IR_RMSNORM,       // fields: eps, weight_ref
    IR_SOFTMAX,       // fields: axis, temperature
    IR_SILU,          // x * sigmoid(x)
    IR_SWIGLU,        // silu(x @ Wg) * (x @ Wu)  -- fused, avoids one scratch buf

    /* ---- Elementwise (3) ---- */
    IR_ELEM_ADD,
    IR_ELEM_MUL,
    IR_SCALE,         // multiply by compile-time or per-head learned scalar

    /* ---- Position / attention (4) ---- */
    IR_ROPE,          // fields: base, head_dim, position (runtime scalar)
    IR_KDA_UPDATE,    // delta-rule state update per head:
                      //   S_h  <-  diag(alpha_h) * S_h  +  beta_h * (v_h - S_h k_h) k_h^T
                      //   fields: heads, head_dim, state_ref(IR_STATE),
                      //           decay_mode{learned|fixed}, beta_mode
    IR_KDA_READ,      // o_h = S_h q_h  (state readout), fields: state_ref, heads
    IR_ATTN_SDPA,     // standard softmax attention (for kind=mha/gqa fallback)

    /* ---- Routing / MoE (4) ---- */
    IR_TOPK,          // fields: k, axis, normalize(bool)
    IR_ROUTE,         // produces (expert_ids[k], gate_weights[k]) from logits
    IR_EXPERT_EXEC,   // conditionally execute expert subgraph; fields:
                      //   expert_graph_id, n_experts, active_k
                      //   (codegen: loop over active experts, weight base ptr math)
    IR_SCATTER_ADD,   // combine expert outputs weighted by gates

    /* ---- Output (2) ---- */
    IR_ARGMAX,
    IR_SAMPLE         // fields: temperature, top_p (host provides rng u64)
} ir_op_t;
```

**24 node types.** Notes:

- `IR_KDA_UPDATE` + `IR_KDA_READ` make Key-Delta Attention a *primitive*, not a lowered composite. Rationale: the delta-rule update `S += β(v − Sk)kᵀ` with per-channel decay `α` has a tight fused kernel (one pass over the `head_dim × head_dim` state per head); expressing it as generic matmuls would triple memory traffic. The state lives in the **persistent arena** — size is `layers × heads × head_dim² × sizeof(state_dtype)`, constant in sequence length, which is the whole point of KDA on edge devices: **no KV cache growth**.
- `IR_EXPERT_EXEC` is the only "control flow" node. It compiles to a plain C `for (i = 0; i < active_k; i++)` with weight pointer arithmetic `w_base + expert_id * expert_stride` — no function pointers, no dispatch tables.
- `IR_MATMUL_Q` is always **fused dequant**: weights are decoded block-by-block in registers inside the microkernel. `IR_DEQUANT` as a standalone node is legal only for tensors ≤ 64 KB (enforced), preventing accidental fp32 materialization of weight matrices.

---

## (c) Memory Allocation Strategy

### Three static arenas

```
┌─────────────────────────────────────────────────────────┐
│ ARENA W  (weights)      read-only, mmap-able, packed    │  ~size of model file
│ ARENA S  (state)        persistent across tokens        │  KDA states, norms cache
│ ARENA T  (scratch)      reused every forward pass       │  activations, logits
└─────────────────────────────────────────────────────────┘
```

- **Arena W** — byte-exact layout computed from quant schemes. `mmap(MAP_PRIVATE)` on Linux/Android targets, or a single `fread` into one allocation. Offsets are `#define`d constants in the generated header — zero pointer chasing at runtime.
- **Arena S** — one `calloc` at init. Contains: KDA state tensors (per layer per head), RoPE cos/sin tables, any `state` declarations. Constant size regardless of sequence length.
- **Arena T** — one allocation, planned by the compiler:

### Scratch planning algorithm (compile time)

1. Topologically order the IR graph (it's a DAG per token step; `repeat` layers reuse the same plan).
2. Compute each `IR_SCRATCH` node's byte size from its static shape × quant type, rounded up to `target.align`.
3. Compute lifetime intervals `[def, last_use]` via liveness on the topological order.
4. Solve offset assignment with **greedy best-fit on the interval graph** (linear-scan style):
   - Sort buffers by size descending.
   - For each buffer, place it at the lowest offset where it doesn't overlap (in offset × time) any already-placed buffer with an intersecting lifetime.
   - This is the classic "2D strip packing" heuristic; typical results are within 5–10 % of optimal and it's deterministic.
5. `arena_T_size = max(offset + size)` over all buffers.

### Admission check

```
peak_ram = |W| + |S| + |T| + code_estimate + host_reserve
if peak_ram > target.ram:  ERROR E0500 (with a full breakdown table)
```

The compiler prints the breakdown either way (see §e). In-place opportunities (`IR_ELEM_ADD` residuals, `IR_RMSNORM`) are detected before planning: if a node's input has no other consumer, output aliases input, buffer count drops ~30 %.

**No heap use after `edgeml_init()`. Ever.** The generated C contains exactly two allocations (S and T; W is mmap or one read), all freed in `edgeml_free()`.

---

## (d) CLI Tool: `edgemlc`

```
edgemlc build model.eml --target=pi5 -o out/
edgemlc plan  model.eml --target=pi5            # memory report only, no codegen
edgemlc pack  weights.safetensors --model=model.eml -o model.emw   # quantize+pack
edgemlc ir    model.eml --dump=after-fusion     # debug IR dumps
```

### Compiler phases

```
┌────────────┐  ┌────────────┐  ┌──────────────┐  ┌──────────────┐
│ 1. Lex/    │→ │ 2. Semantic│→ │ 3. Shape &   │→ │ 4. Lower to  │
│    Parse   │  │    + quant │  │    const     │  │    IR (SSA   │
│    → AST   │  │    typing  │  │    folding   │  │    DAG)      │
└────────────┘  └────────────┘  └──────────────┘  └──────┬───────┘
                                                          │
┌────────────┐  ┌────────────┐  ┌──────────────┐  ┌──────▼───────┐
│ 8. Emit    │← │ 7. Codegen │← │ 6. Memory    │← │ 5. IR passes │
│    C99 +   │  │    kernel  │  │    planner   │  │  - fusion    │
│    header +│  │    select  │  │  (arenas,    │  │  - in-place  │
│    weight  │  │  (NEON/    │  │   offsets,   │  │  - dead node │
│    manifest│  │   AVX2/    │  │   ADMIT/     │  │  - dequant   │
└────────────┘  │   scalar)  │  │   REJECT)    │  │    legality  │
                └────────────┘  └──────────────┘  └──────────────┘
```

1. **Parse** → AST. Errors carry line/col.
2. **Semantic analysis**: name resolution, quant-type checking (rules §Type System), storage-class checks (`weight` can't be written, `state` can't be scratch-planned).
3. **Shape inference & const folding**: all `const_expr` evaluated; `?` bound to `max_seq`; block-divisibility checked.
4. **Lowering**: pipeline → SSA IR DAG; `repeat` produces one graph template + per-layer weight offset tables; `swiglu`, KDA composites already emitted as fused primitives.
5. **IR passes** (all mandatory, no `-O` flags — determinism over knobs):
   - *Fusion*: `matmul→add(bias)`, `rmsnorm→matmul` prologue, `silu·mul → swiglu`.
   - *In-place*: alias analysis for residual adds.
   - *DCE*, *dequant legality* (the ≤64 KB rule).
6. **Memory planner** (§c). On reject: print breakdown + the single largest reducible item ("hint: expert d_ff 896→768 saves 4.2 MB").
7. **Codegen**: pick kernel templates per node per target. Each kernel exists in three variants selected by `#if defined(EDGEML_NEON) / defined(EDGEML_AVX2) / else scalar`. The IR never mentions SIMD — variants are pure templates parameterized by (quant scheme, tile shape).
8. **Emit**: `model.c` (kernels + graph as straight-line function calls), `model.h` (public API + `#define`d arena offsets), `model.manifest` (weight packing order for `edgemlc pack`).

**Generated API (entire surface):**

```c
int  edgeml_init(edgeml_ctx *ctx, const char *weights_path);
int  edgeml_forward(edgeml_ctx *ctx, const int32_t *tokens, int n, float *logits);
int  edgeml_step(edgeml_ctx *ctx, int32_t token, float *logits);  /* KDA: O(1) mem */
void edgeml_reset_state(edgeml_ctx *ctx);   /* zero KDA states = new conversation */
void edgeml_free(edgeml_ctx *ctx);
```

Build of generated code: `cc -std=c99 -O2 -DEDGEML_NEON model.c main.c -lm`. That's it.

---

## (e) Complete Example: `tiny100m.eml`

A ~100 M-parameter model: 10 layers, KDA attention, alternating dense-SwiGLU / 4-expert MoE, MXFP4 weights, INT8 embeddings.

```c
// ============================================================
// tiny100m.eml — 99.6M params, KDA attention, hybrid dense/MoE
// Fits comfortably on an 8GB ARM board (Raspberry Pi 5 class).
// ============================================================

target pi5 {
    arch  = arm64;
    simd  = neon;
    ram   = 8GB;         // planner budget (host_reserve subtracted internally)
    align = 64;          // cache line
}

// ---------------- Config constants ----------------
const D_MODEL  = 640;
const N_LAYERS = 10;
const N_HEADS  = 10;
const HEAD_DIM = 64;               // N_HEADS * HEAD_DIM == D_MODEL
const VOCAB    = 49152;
const MAX_SEQ  = 4096;
const FF_DENSE = 1792;
const FF_EXP   = 896;
const N_EXPERTS = 4;
const TOP_K     = 2;

// ---------------- Named quant schemes ----------------
quantscheme W4  = mxfp4[block=32, scale=e8m0];          // all projection weights
quantscheme E8  = int8[block=64, scale=fp16, zero=sym]; // embedding table
quantscheme A16 = bf16;                                  // norms, gates, activations

// ---------------- KDA attention block ----------------
attention kda_block(x: tensor<A16, [?, D_MODEL]>) {
    kind        = kda;
    heads       = N_HEADS;
    head_dim    = HEAD_DIM;
    rope_base   = 10000;
    decay       = learned;         // per-channel alpha via W_alpha
    beta        = learned;         // per-head write strength via W_beta
    state_dtype = fp16;            // S: [N_HEADS, HEAD_DIM, HEAD_DIM] per layer

    weight w_q     : tensor<W4,  [D_MODEL, D_MODEL]>;
    weight w_k     : tensor<W4,  [D_MODEL, D_MODEL]>;
    weight w_v     : tensor<W4,  [D_MODEL, D_MODEL]>;
    weight w_o     : tensor<W4,  [D_MODEL, D_MODEL]>;
    weight w_beta  : tensor<A16, [D_MODEL, N_HEADS]>;
    weight w_alpha : tensor<A16, [D_MODEL, N_HEADS]>;
    state  S       : tensor<fp16, [N_HEADS, HEAD_DIM, HEAD_DIM]>;

    q  = rope(matmul(x, w_q, out=fp32));
    k  = rope(matmul(x, w_k, out=fp32));
    v  = matmul(x, w_v, out=fp32);
    b  = matmul(x, w_beta,  out=fp32);      // -> sigmoid inside kda_update
    a  = matmul(x, w_alpha, out=fp32);      // -> decay gate inside kda_update

    // Delta rule with decay:  S <- diag(a)*S + b*(v - S k) k^T ;  o = S q
    S  = kda_update(S, k, v, beta=b, decay=a);
    o  = kda_read(S, q);

    return matmul(o, w_o, out=A16);
}

// ---------------- Dense FFN ----------------
layer ffn_dense(x: tensor<A16, [?, D_MODEL]>) {
    weight w_gate : tensor<W4, [D_MODEL, FF_DENSE]>;
    weight w_up   : tensor<W4, [D_MODEL, FF_DENSE]>;
    weight w_down : tensor<W4, [FF_DENSE, D_MODEL]>;
    h = swiglu(x, w_gate, w_up, out=fp32);   // fused: silu(x@Wg) * (x@Wu)
    return matmul(h, w_down, out=A16);
}

// ---------------- MoE expert & block ----------------
layer expert_ffn(x: tensor<A16, [?, D_MODEL]>) {
    weight w_gate : tensor<W4, [D_MODEL, FF_EXP]>;
    weight w_up   : tensor<W4, [D_MODEL, FF_EXP]>;
    weight w_down : tensor<W4, [FF_EXP, D_MODEL]>;
    h = swiglu(x, w_gate, w_up, out=fp32);
    return matmul(h, w_down, out=A16);
}

moe moe_block(x: tensor<A16, [?, D_MODEL]>) {
    experts      = N_EXPERTS;
    active       = TOP_K;
    expert       = expert_ffn;
    router_dtype = A16;
    norm_topk    = true;

    weight w_router : tensor<A16, [D_MODEL, N_EXPERTS]>;
    logits = matmul(x, w_router, out=fp32);
    sel    = route(topk(softmax(logits), k=TOP_K, normalize=true));
    return scatter_add(sel);        // sum of gate_i * expert_i(x)
}

// ---------------- Model assembly ----------------
model tiny100m {
    vocab   = VOCAB;
    d_model = D_MODEL;
    max_seq = MAX_SEQ;
    layers  = N_LAYERS;

    weight tok_embed : tensor<E8,  [VOCAB, D_MODEL]>;   // tied with lm_head
    weight norm_f    : tensor<A16, [D_MODEL]>;

    pipeline {
        embed(tok_embed);
        repeat(N_LAYERS) {
            rmsnorm(eps=1e-6);
            kda_block();               // residual add inserted implicitly
            rmsnorm(eps=1e-6);
            if (LAYER % 2 == 0) { ffn_dense(); }
            else                { moe_block(); }
        }
        rmsnorm(norm_f, eps=1e-6);
        matmul(tok_embed, transpose=true, out=fp32);    // tied lm_head
    }
}

export tiny100m for pi5;
```

### Compiler output (`edgemlc plan tiny100m.eml --target=pi5`)

```
edgemlc 1.0 — memory plan for 'tiny100m' on target 'pi5' (arm64/neon, 8GB)

Parameters
  embeddings (tied)              31,457,280
  attention  (KDA, 10 layers)    16,512,000
  ffn dense  (5 layers)          17,203,200
  moe        (5 layers, 4 exp)   34,419,200
  norms                              13,440
  TOTAL                          99,605,120  (99.6M)

Arena W (weights, read-only, mmap)
  tok_embed        int8[b64,fp16]      32.4 MB
  proj/ffn/moe     mxfp4[b32,e8m0]     36.2 MB
  norms/gates      bf16                 0.1 MB
  ------------------------------------------------
  total                                68.7 MB

Arena S (persistent state)
  KDA state  10L x 10H x 64x64 fp16     0.8 MB   <- constant in seq len!
  rope tables                           0.5 MB
  ------------------------------------------------
  total                                 1.3 MB

Arena T (scratch, planned: 41 buffers -> 9 slots after in-place/lifetime packing)
  peak (prefill, seq=4096)             86.2 MB
  peak (decode,  seq=1)                 0.4 MB
  ------------------------------------------------
  planned                              86.2 MB

Peak RAM: 68.7 + 1.3 + 86.2 + 2.0 (host reserve) = 158.2 MB   [ADMIT: 1.9% of 8GB]
Decode-only footprint: 70.4 MB  (no KV cache — KDA state is O(1) in sequence length)

wrote out/model.c (214 KB), out/model.h, out/model.manifest
```

### Flavor of the generated C (decode step, one layer, NEON path)

```c
/* ---- layer 3 (moe) : generated, do not edit ---- */
static void layer3_step(edgeml_ctx *ctx, float *restrict x) {
    rmsnorm_bf16(x, W_PTR(0x1a2c40), 640, 1e-6f, ctx->t + T_OFF_0);
    kda_step_neon(ctx->t + T_OFF_0,               /* normed input     */
                  W_PTR(L3_WQ), W_PTR(L3_WK), W_PTR(L3_WV),
                  W_PTR(L3_WB), W_PTR(L3_WA),
                  (fp16_t *)(ctx->s + S_KDA_L3),  /* 10x64x64 state   */
                  ctx->pos, ctx->t + T_OFF_1);
    matmul_q_mxfp4_neon(ctx->t + T_OFF_1, W_PTR(L3_WO), x, 640, 640); /* +residual, in-place */
    /* ... rmsnorm, router, top2, expert loop with base-ptr arithmetic ... */
    for (int e = 0; e < 2; e++) {
        const uint8_t *wb = W_PTR(L3_EXP_BASE) + sel.id[e] * L3_EXP_STRIDE;
        swiglu_q_mxfp4_neon(ctx->t + T_OFF_2, wb, wb + L3_WU_OFF, ctx->t + T_OFF_3, 640, 896);
        matmul_q_mxfp4_axpy_neon(ctx->t + T_OFF_3, wb + L3_WD_OFF, x, sel.gate[e], 896, 640);
    }
}
```

Straight-line calls, `#define`d offsets, one scratch arena, three fused quantized kernels. No structs of function pointers, no graph interpreter — the graph *is* the code.

---

## Summary of Guarantees

1. **If it compiles, it fits** — peak RAM proven at compile time, per target.
2. **If quant formats mix, it doesn't compile** — quantization errors are type errors.
3. **KDA gives O(1) decode memory** — no KV cache; the 0.8 MB state is the entire attention memory for a 4K (or 400K) context.
4. **One `.c` file, C99, `-lm` only** — auditable, portable from Cortex-A53 to Xeon by flipping one `-D` flag.