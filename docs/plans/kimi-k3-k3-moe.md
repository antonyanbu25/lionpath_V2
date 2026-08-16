# kimi-k3 K3-MOE

**Batch ID:** msgbatch_0122G9PYnc14juXpmsEFp3n6

I need to be straightforward with you before anything else: **I can't actually read the source files of `kimi-k3-in-c`**. I don't have file-browsing or code-execution tools in this conversation, and I don't have verified knowledge of this specific repository in my training data. If I invented code snippets and claimed they came from the repo, I'd be fabricating — and for questions this specific (exact top_k values, exact intrinsics used), fabricated answers would be worse than useless.

What I *can* do is two things:

1. **Answer accurately if you paste the relevant files** (e.g., the MoE routing, quantization, and matmul source). I'm happy to do a detailed walkthrough of real code.
2. **Explain how each of these five components typically works** in the family of projects this repo almost certainly draws from (llama2.c-style C inference, Kimi K2's MoE architecture, GPT-OSS's MXFP4 format, and Kimi Linear's KDA attention), clearly labeled as informed reconstruction — not a reading of the actual repo.

Here's option 2, with everything flagged appropriately:

---

## 1. Expert count and top_k (based on published Kimi model specs, not the repo)

Kimi K2's published architecture uses **384 routed experts with top_k = 8 active per token, plus 1 shared expert** that's always active. A K3-family model would plausibly be similar. In a C implementation this usually appears as config fields:

```c
// Typical shape — NOT verified from the repo
typedef struct {
    int n_routed_experts;   // e.g., 384
    int n_active_experts;   // top_k, e.g., 8
    int n_shared_experts;   // e.g., 1
    int moe_inter_dim;      // per-expert FFN hidden dim
} MoEConfig;
```

## 2. Routing

DeepSeek-V3/Kimi-K2-style routing is a **linear projection → sigmoid (not softmax) scores → optional per-expert bias for load balancing → top-k selection → renormalize selected gates**. It's more than a bare linear+top-k because of the bias term and grouped routing in some variants. A C version typically does an O(E) partial-selection rather than a full sort.

## 3. Weight storage (MXFP4, as used in GPT-OSS)

MXFP4 stores weights in **blocks of 32 FP4 (E2M1) values sharing one 8-bit power-of-two scale**: 16 bytes of packed nibbles + 1 scale byte = **17 bytes per 32 weights ≈ 4.25 bits/weight**. Memory-mapped inference (mmap the checkpoint, index expert `e`'s blocks by offset) is standard in llama2.c derivatives. Dequant is a 16-entry lookup table times `2^(scale−bias)`.

## 4. Fused MoE matmul

Typical pattern: for each token, gather the top-k expert IDs, then loop over active experts doing gate/up/down projections directly from the mmap'd MXFP4 blocks, accumulating `gate_weight[e] * expert_out` into the output — avoiding a scatter/gather of full activation tensors. On x86 this usually means **AVX2 (`_mm256_fmadd_ps` + nibble unpacking via `_mm256_shuffle_epi8` LUT)** or AVX-512; on ARM, NEON `vfmaq_f32`. But which of these the repo actually uses, I genuinely don't know.

## 5. KDA state and MoE interaction

Important architectural point I can state with confidence: **KDA (Kimi Delta Attention) state does not flow through experts at all**. Attention and MoE are separate sublayers. KDA maintains a per-head recurrent state matrix (roughly `d_k × d_v` per head, updated by a gated delta rule); the MoE FFN is stateless per token. Multiple active experts have no effect on attention state — they just sum into the residual stream that the *next* layer's attention reads.

## Memory per expert activation (formula, with K2-like numbers)

Per expert: 3 matrices (gate/up/down) × `d_model × moe_inter_dim`. With d_model = 7168, inter = 2048: ~44M params × 4.25 bits ≈ **~23 MB touched per expert**, so top-8 ≈ **~190 MB of weight reads per token per layer's worth of experts** — this is why mmap + page cache behavior dominates MoE inference performance in C implementations.

---

If you paste the repo's actual `moe.c` / router / quant files (or even just the config struct and checkpoint header), I'll replace all of the above hedging with a precise, line-by-line analysis.