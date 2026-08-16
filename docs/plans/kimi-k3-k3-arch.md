# kimi-k3 K3-ARCH

**Batch ID:** msgbatch_0122G9PYnc14juXpmsEFp3n6

I need to be upfront about an important limitation before answering: **I can't browse the web or read repositories**, and I don't have `github.com/FareedKhan-dev/kimi-k3-in-c` in my training data (it's either very new, very obscure, or the name doesn't match what I've seen — Fareed Khan is known for educational "X-from-scratch" repos, but I have no record of this specific one). Additionally, "Kimi K3" is not a publicly documented model as of my knowledge cutoff — Moonshot AI's public releases are Kimi K2 and Kimi Linear.

So I **cannot** give you the actual numbers or paste real struct definitions from `k3.h` — doing so would be fabrication. What I *can* do is explain the real, published mechanisms this repo is almost certainly implementing (KDA is from the Kimi Linear paper; the MoE design follows Kimi K2), with real published numbers, and show what such a C implementation typically looks like. If you paste the actual files, I'll analyze them precisely.

---

## 1. Overall inference architecture (typical llama2.c-style design)

A single-file C inference engine for this family of models generally works like this:

```
token id → embedding lookup → N × [ RMSNorm → Attention (KDA or full MLA)
                                     → residual add
                                     → RMSNorm → MoE FFN → residual add ]
        → final RMSNorm → lm_head matmul → logits → sample
```

Key architectural fact from **Kimi Linear** (the real KDA paper): layers alternate in a **3:1 ratio** — three KDA (linear attention) layers for every one full-attention (MLA) layer. Only the full-attention layers need a growing KV cache; KDA layers carry a **fixed-size recurrent state**, which is the whole point.

A typical run-state struct in these C ports:

```c
// ILLUSTRATIVE — typical shape, not verified from the repo
typedef struct {
    float *x, *xb, *xb2;      // activations (embed_dim)
    float *hb, *hb2;          // FFN hidden buffers
    float *q, *k, *v;         // per-step projections
    float *att;               // attention scores
    float *logits;            // vocab_size
    float *kda_state;         // [layers][heads][head_dim][head_dim] recurrent state
    float *key_cache;         // only for full-attn layers: [layers][seq][kv_dim]
    float *value_cache;
} RunState;
```

## 2. KDA (Kimi Delta Attention) — the real mechanism

KDA is a gated **delta rule** linear attention. Each head maintains a matrix-valued state **S** (size `head_dim × head_dim`, e.g., 128×128 floats per head). Per token:

**Classic delta rule (DeltaNet):**

  S_t = S_{t−1}(I − β_t k_t k_tᵀ) + β_t k_t v_tᵀ
  o_t = S_tᵀ q_t

Interpretation: the state is an associative memory. Before writing the new (k, v) pair, the rule **erases the old value currently associated with k_t** (the rank-1 correction term `S k kᵀ`), then writes the new one — an online gradient step on ‖Sᵀk − v‖². β_t ∈ (0,1) is a learned per-token write strength.

**KDA's addition:** a **fine-grained, per-channel diagonal decay gate** (Diag(a_t) with a_t ∈ (0,1)^{d_k}, produced by a small low-rank projection of the input), instead of a single scalar forget gate as in GLA/Mamba-style models:

  S_t = (S_{t−1} − β_t S_{t−1} k_t k_tᵀ) ⊙ decay + β_t k_t v_tᵀ  (schematically)

**Head-parallel recurrence in C:** the recurrence is sequential over *tokens* but embarrassingly parallel over *heads* — each head owns an independent `head_dim × head_dim` state block, so the inner loop is typically:

```c
#pragma omp parallel for
for (int h = 0; h < n_heads; h++) {
    float *S = kda_state + (size_t)l * n_heads * hd * hd + (size_t)h * hd * hd;
    // 1) decay: S[i][j] *= a[i]
    // 2) delta correction: S -= beta * (S k) kᵀ
    // 3) write: S += beta * k vᵀ
    // 4) read: o = Sᵀ q
}
```

Cost per token per head: O(head_dim²) — **constant in sequence length**.

## 3. MoE layer (Kimi K2 numbers — likely what the repo mirrors)

- **384 routed experts** total, plus **1 shared expert** always active
- **top_k = 8** routed experts active per token (≈32B active of 1T total params in K2)
- Routing: a linear gate `router_logits = W_router · x` (384 outputs) → select top-8 → normalize their scores (sigmoid/softmax over selected) → output = Σ gateᵢ · SwiGLU_expertᵢ(x) + shared_expert(x)
- Kimi K2 uses no auxiliary load-balancing loss at inference; bias-based balancing is a training concern.

An educational C port frequently shrinks these numbers (e.g., 8–64 experts, top_k 2) — I can't tell you what this repo chose without seeing `config`.

## 4. KV cache / memory footprint

This is where the hybrid design pays off. Per-token cache cost:

- **KDA layers: 0 bytes/token.** State is fixed: `n_heads × head_dim² × 4 bytes` per layer, regardless of context. E.g., 32 heads × 128² × 4B = **2 MB per KDA layer, total, forever.**
- **Full-attention layers:** `2 (K and V) × n_kv_heads × head_dim × bytes_per_elem` per token per layer. Example: 8 KV heads × 128 dim × 2 (K,V) × 4B = 8 KB/token/layer.

With a 3:1 ratio, only ¼ of layers pay cache cost → the paper reports up to **~75% KV-cache reduction** vs. all-full-attention. So at 4K vs. 128K context, KDA layers cost identical memory; only the MLA layers scale linearly (e.g., 8 KB/tok/layer × 16 full-attn layers → 128 KB/token → 512 MB at 4K, 16 GB at 128K in fp32; ¼ of a fully-attentive model's cache).

## 5. Config params & MXFP4

Real reference numbers (Kimi K2): `embed_dim = 7168`, `num_layers = 61`, `num_heads = 64`, `head_dim = 128 (nope_) / MLA-specific dims`, `num_experts = 384`, `top_k = 8`, `context_length = 128K`. **MXFP4 block size = 32**: each block of 32 weights stores 32 × 4-bit E2M1 values (16 bytes) + one shared 8-bit E8M0 power-of-two scale = 17 bytes per 32 weights ≈ **4.25 bits/weight**.

```c
// ILLUSTRATIVE MXFP4 block
typedef struct { uint8_t scale; uint8_t vals[16]; } mxfp4_block_t;  // 32 weights
```

---

**Bottom line:** the mechanisms above (delta rule, diagonal gating, 3:1 hybrid, 384/8 MoE, MXFP4-32) are real and published — but the repo-specific values (its actual `Config` struct, whether it shrinks the model, its exact struct names) I cannot verify. Paste `k3.h` and the README and I'll give you the precise analysis you asked for.