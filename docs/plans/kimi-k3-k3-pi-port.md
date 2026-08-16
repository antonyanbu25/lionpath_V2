# kimi-k3 K3-PI-PORT

**Batch ID:** msgbatch_0122G9PYnc14juXpmsEFp3n6

# Porting kimi-k3-in-c to Raspberry Pi 4: Engineering Plan

**Upfront caveats:** I don't have verified details of a "kimi-k3-in-c" repository, so I'll assume it follows the `llama2.c` pattern: single-file C inference, mmap'd weights, AVX2 matmul kernels, MoE transformer architecture in the Kimi lineage. Also, a full Kimi-scale MoE model (Kimi K2 is ~1T params) is **categorically impossible** on a Pi 4 — even at int4 that's ~500GB of weights. This plan therefore targets small distilled/variant checkpoints (≤3B params), which is consistent with your question 7.

---

## 1. Minimum RAM by Context Length

RAM = weights + KV cache + activations + buffers + OS overhead (~500–700MB for Raspberry Pi OS Lite 64-bit, leaving ~3.3GB usable).

**KV cache formula:**
```
KV bytes = 2 × n_layers × n_kv_heads × head_dim × seq_len × bytes_per_elem
```

For a representative 1.1B config (22 layers, GQA with 4 KV heads, head_dim 64, fp16 cache):
~44 KB/token.

| Component | ctx 512 | ctx 1024 | ctx 2048 |
|---|---|---|---|
| Weights (int8, 1.1B) | 1.10 GB | 1.10 GB | 1.10 GB |
| KV cache (fp16) | 22 MB | 45 MB | 90 MB |
| Activations + logits buffer | ~50 MB | ~50 MB | ~50 MB |
| **Total (int8)** | **~1.2 GB** | **~1.2 GB** | **~1.25 GB** |
| **Total (BF16 weights)** | **~2.3 GB** | **~2.35 GB** | **~2.4 GB** |

**Verdict:** int8 1B fits comfortably in 4GB. BF16 1B fits but is tight. A 3B model requires int8/int4 (3B BF16 = 6GB, won't fit). Note: if k3 uses a large vocab (~160K like Kimi K2), the fp32 logits buffer alone is ~640KB and the embedding/unembedding tables become a meaningful fraction of a small model's weights.

## 2. Memory Bottlenecks (Ranked)

1. **Weights: 90–95% of footprint.** Dominant by far. For MoE, *all* experts must be resident or mmap-pageable even though only top-k are active per token — this is the killer on 4GB.
2. **KV cache:** grows linearly with context; negligible at 2K ctx with GQA, but becomes significant at 8K+ or with MHA (no GQA → multiply by 8×).
3. **MoE routing/activations:** small per-token (a few MB), but MoE causes **page-cache thrashing** if weights don't fit in RAM — random expert access defeats sequential prefetch.
4. **Temporary buffers:** matmul scratch, logits, softmax — tens of MB, non-issue.

Practical implication: quantization of weights is where 100% of your effort should go; don't bother optimizing activation memory.

## 3. AVX2 → NEON Kernel Adaptation

Key structural differences: NEON is **128-bit** (vs 256-bit AVX2), so half the lanes — compensate by processing two vectors per loop iteration. Cortex-A72 has 2 NEON pipes with ~7-cycle FMA latency, so **unroll with 4–8 independent accumulators** to hide latency.

**Intrinsic mapping:**

| AVX2 | NEON (aarch64) | Notes |
|---|---|---|
| `_mm256_loadu_ps` | `vld1q_f32` ×2 | 4 floats per load |
| `_mm256_fmadd_ps` | `vfmaq_f32` | fused, same semantics |
| `_mm256_mul_ps` / `_mm256_add_ps` | `vmulq_f32` / `vaddq_f32` | direct |
| `_mm256_set1_ps` | `vdupq_n_f32` | direct |
| hadd/extract horizontal sum | `vaddvq_f32` | **single instruction** — nicer than x86 |
| `_mm256_maddubs_epi16` (int8) | ⚠️ see below | |

**Critical A72 gotcha:** the BCM2711's Cortex-A72 is **ARMv8.0**. It has **no SDOT/UDOT** (`vdotq_s32`, ARMv8.2) and **no native BF16** (ARMv8.6). Therefore:

- **int8 dot products:** use the widening-multiply chain: `vmull_s8` → `vpadalq_s16` accumulating into int32, or `vmovl_s8` + `vmlal_s16`.
- **BF16:** convert to fp32 manually — load as `uint16`, widen with `vshll_n_u16(x, 16)`, reinterpret as `float32x4_t`. Cheap (1 instruction) but doubles memory traffic vs int8.

Sketch of the inner int8 kernel:

```c
int32x4_t acc0 = vdupq_n_s32(0), acc1 = vdupq_n_s32(0);
for (int i = 0; i < n; i += 16) {
    int8x16_t a = vld1q_s8(x + i), b = vld1q_s8(w + i);
    int16x8_t lo = vmull_s8(vget_low_s8(a),  vget_low_s8(b));
    int16x8_t hi = vmull_s8(vget_high_s8(a), vget_high_s8(b));
    acc0 = vpadalq_s16(acc0, lo);
    acc1 = vpadalq_s16(acc1, hi);
}
int32_t sum = vaddvq_s32(vaddq_s32(acc0, acc1));
```

## 4. ARMv7 (32-bit) vs ARMv8 (64-bit)

**ARMv8/aarch64, unambiguously.** Reasons:

- **Address space:** 32-bit gives ~3GB user VA space; mmap'ing a 1–2GB weight file plus heap plus KV cache risks `mmap` failure and fragmentation. 64-bit removes this entirely.
- **Registers:** aarch64 NEON has 32×128-bit registers vs 16 — essential for the deep accumulator unrolling A72 needs.
- **Instructions:** across-lane reductions (`vaddvq_f32`), cleaner FMA intrinsics; ARMv7 NEON intrinsics are clunkier and fp32-NEON on v7 isn't even IEEE-compliant by default.
- **Toolchain:** modern GCC/Clang auto-vectorization and scheduling models are far better tuned for aarch64.

The BCM2711 runs both; just make sure you're on 64-bit Raspberry Pi OS (`uname -m` → `aarch64`).

## 5. Expected Throughput

Token generation is **memory-bandwidth bound**: every token streams all active weights. Pi 4's practical DRAM bandwidth is ~4 GB/s (LPDDR4, measured memcpy; theoretical is higher but unreachable).

```
tok/s ≈ effective_bandwidth / active_weight_bytes_per_token
```

| Config (1.1B dense) | Bytes/token | Ideal | Realistic (4 threads, thermals, compute overhead) |
|---|---|---|---|
| int8 | ~1.1 GB | ~3.6 tok/s | **2.5–4 tok/s** |
| BF16 | ~2.2 GB | ~1.8 tok/s | **1–1.8 tok/s** |

This aligns with published llama.cpp numbers for TinyLlama-class models on Pi 4 (~3–5 tok/s at Q8_0). If k3's MoE variant has fewer *active* params than total (e.g., 1B total / 300M active), throughput improves proportionally — *if* everything fits in RAM. int4 would roughly double int8 numbers. Prompt processing (batched) is compute-bound instead: expect ~10–20 tok/s prefill.

## 6. OS-Level Changes

- **OS:** Raspberry Pi OS Lite 64-bit, headless. Kill the desktop; reclaim ~400MB.
- **Swap:** replace dphys-swapfile with **zram** (2GB, lz4) — `vm.swappiness=10`. Never swap to SD card (wear + ~10MB/s random writes = death). If disk swap is needed as a backstop, put it on a USB3 SSD.
- **Memory mapping:** `mmap(PROT_READ, MAP_SHARED)` the weight file; `madvise(MADV_SEQUENTIAL)` during load, then `MADV_WILLNEED`; `mlock()` the weights if they fit to prevent eviction under pressure (raise `RLIMIT_MEMLOCK`). For MoE that doesn't fit, `MADV_RANDOM` on expert regions to avoid useless readahead.
- **CPU:** `performance` governor; **active cooling is mandatory** — A72 throttles from 1.5GHz at 80°C and sustained matmul will hit it in minutes. Pin 4 threads with `pthread_setaffinity_np`.
- **Compiler flags:**
  ```
  -O3 -mcpu=cortex-a72 -flto -ffast-math -funroll-loops -fopenmp
  ```
  (On aarch64, `-mcpu` sets both arch and tuning; no `-mfpu` needed. Do **not** pass `-march=armv8.2-a` — SDOT will SIGILL.)
- `vm.overcommit_memory=1` so mmap of large files succeeds cleanly.

## 7. Minimum Viable Pi for a 1B Variant

| Model | RAM | Verdict |
|---|---|---|
| Pi Zero 2 W / Pi 3 | 512MB / 1GB | int4 (~600MB) technically possible on 3B+ via mmap streaming; <0.5 tok/s, thrashing. Not viable in practice. |
| **Pi 4 2GB** | 2GB | **Practical minimum**: 1B int8 (1.1GB) + KV + OS fits with ~300MB headroom. |
| Pi 4 4GB (yours) | 4GB | Comfortable for 1B int8/BF16; 3B at int4. |
| Pi 5 8GB | 8GB | ~2× bandwidth and A76 cores (with SDOT!) — 2–3× throughput, fits 3B int8. |

**Bottom line:** your Pi 4 4GB handles a 1B int8 variant at a usable 2–4 tok/s; the port is mostly (a) rewriting the AVX2 kernels against NEON's ARMv8.0 subset (no dot-product instructions — that's the main trap), (b) an int8/int4 quantized weight format, and (c) mmap + zram hygiene so the MoE experts never touch the SD card.