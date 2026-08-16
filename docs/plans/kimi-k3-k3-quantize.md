# kimi-k3 K3-QUANTIZE

**Batch ID:** msgbatch_0122G9PYnc14juXpmsEFp3n6

Before diving in, one important caveat: **I don't have access to a repository called `kimi-k3-in-c`**, and I can't read files in this conversation — no code was attached, and I have no knowledge of a Kimi K3 model or that codebase (Kimi K2 exists; K3 does not, to my knowledge). So I cannot quote *that project's actual code* or verify its specific design decisions.

What I *can* do accurately is explain MXFP4 as defined by the **OCP Microscaling (MX) Formats Specification v1.0** — which is what any C implementation would be following — and give you a faithful reference implementation. I'll clearly mark what is spec-defined vs. what is implementation convention. If you paste the actual quantization files, I'll analyze them line by line.

---

## 1. What "MXFP4" actually means

The "MX" stands for **Microscaling**, not "mixed-precision" — a common misreading. The format has two components:

- **Element type: FP4 E2M1** — a 4-bit float with 1 sign bit, 2 exponent bits, 1 mantissa bit.
- **Block scale: E8M0** — one shared 8-bit power-of-two exponent per block of **32 elements**.

The representable magnitudes of E2M1 are only 8 values:

```
{0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0}  (× sign)
```

**vs INT4:** INT4 quantization maps to a *uniform* integer grid (`{-8..7}` or `{-7..7}`) with an FP16/FP32 scale and often a zero-point (affine). MXFP4's grid is **non-uniform** — denser near zero (0.5 steps) and sparser at the extremes (4→6 is a step of 2). This matches the roughly Gaussian/heavy-tailed distribution of NN weights better than uniform spacing at the same bit budget. Also, the MX scale is restricted to **powers of two** (an exponent byte, no mantissa), so "dequantization" is an exponent add rather than a true multiply — cheap in hardware.

**vs plain FP4:** Bare FP4 E2M1 has a dynamic range of only [0.5, 6.0] in magnitude — useless for raw weights. MXFP4 = FP4 **plus** the per-32-element E8M0 scale, extending effective dynamic range to roughly ±6 × 2^(±127) at block granularity.

## 2. Block scales: computation, storage, application

**Block size: 32 elements** (fixed by the MX spec; MXFP4, MXFP6, MXFP8 all use k=32).

**Computation** (per the spec's reference algorithm):

```c
// amax = max |v| over the 32-element block
// emax_elem = 2  (largest exponent of E2M1, since max magnitude 6.0 = 1.5 * 2^2)
int shared_exp = (int)floorf(log2f(amax)) - 2;   // subtract emax_elem
// clamp to E8M0 range: represents 2^(-127) .. 2^127; X=0xFF is NaN
scale_byte = (uint8_t)(shared_exp + 127);
```

Each element is then quantized as `q = round_to_nearest_even(v / 2^shared_exp)` onto the E2M1 grid, with saturation to ±6.0.

**Storage:** one `uint8_t` per 32 elements, holding `X` where `scale = 2^(X - 127)`. Note E8M0 has **no sign and no mantissa** — it is purely an exponent. `X = 0xFF` encodes NaN (whole block invalid); there is no zero scale.

**Application:** at compute time, `w = fp4_decode(nibble) * 2^(X - 127)`.

## 3. Reference dequantization kernel (MXFP4 → BF16)

This is a faithful *reference* implementation, not quoted from kimi-k3-in-c:

```c
#include <stdint.h>
#include <math.h>

// All 16 E2M1 code points, indexed by the 4-bit code.
// bit3 = sign, bits2:1 = exponent, bit0 = mantissa
static const float FP4_E2M1_LUT[16] = {
    +0.0f, +0.5f, +1.0f, +1.5f, +2.0f, +3.0f, +4.0f, +6.0f,
    -0.0f, -0.5f, -1.0f, -1.5f, -2.0f, -3.0f, -4.0f, -6.0f,
};

static inline uint16_t f32_to_bf16(float f) {
    uint32_t u; memcpy(&u, &f, 4);
    u += 0x7FFFu + ((u >> 16) & 1);      // round-to-nearest-even
    return (uint16_t)(u >> 16);
}

// One MX block: 1 scale byte + 16 packed data bytes = 32 elements
typedef struct {
    uint8_t scale;      // E8M0: value = 2^(scale - 127); 0xFF = NaN
    uint8_t data[16];   // two FP4 codes per byte
} mxfp4_block_t;

void dequant_mxfp4_block(const mxfp4_block_t *blk, uint16_t *out /*32 bf16*/) {
    const float s = ldexpf(1.0f, (int)blk->scale - 127);  // 2^(X-127)
    for (int i = 0; i < 16; i++) {
        uint8_t b  = blk->data[i];
        float lo = FP4_E2M1_LUT[b & 0x0F] * s;   // element 2i   (low nibble)
        float hi = FP4_E2M1_LUT[b >> 4]  * s;    // element 2i+1 (high nibble)
        out[2*i]     = f32_to_bf16(lo);
        out[2*i + 1] = f32_to_bf16(hi);
    }
}
```

In a real inference loop you typically **fuse** this into the matvec (dequantize into registers, FMA against activations) rather than materializing a BF16 tensor — that's how llama.cpp-style kernels and GPU kernels do it.

## 4. Memory reduction ratio

Per parameter:

| Format | bits/param | bytes/param |
|---|---|---|
| BF16 | 16 | 2.0 |
| MXFP4 | 4 + 8/32 = **4.25** | **0.53125** |

Reduction ratio: **16 / 4.25 ≈ 3.76×** (not a clean 4× — the scale bytes cost 6.25% overhead). A 1T-parameter model's MXFP4-quantized tensors drop from ~2 TB to ~531 GB.

## 5. Attention vs MLP weights

I can't verify what kimi-k3-in-c does. But the **near-universal convention** for MXFP4 deployments (e.g., OpenAI's gpt-oss, which is the highest-profile MXFP4 release) is:

- **MoE expert / MLP weights → MXFP4.** These are ~90%+ of parameters in a large MoE model and are the most quantization-tolerant.
- **Attention projections (Q/K/V/O), embeddings, lm_head, router/gate weights, and all norms → kept in BF16.** Attention weights are a small fraction of total parameters but disproportionately sensitive; routers are tiny and routing decisions are brittle under quantization.

So yes, differential treatment is standard — but it's typically *"MXFP4 for MLP, BF16 for attention"* rather than two different quantization schemes.

## 6. Bit-level layout of one MXFP4 block

**17 bytes per 32 elements** (assuming the common scale-prefixed packing; the spec defines the formats but not the serialized container ordering, so byte order is per-implementation):

```
Byte 0            : E8M0 shared scale X        value = 2^(X - 127)
Bytes 1..16       : 16 bytes of packed FP4     2 elements per byte

Byte 0 (scale):
  bit 7 6 5 4 3 2 1 0
      └──── X[7:0] ────┘        unsigned exponent-only; 0xFF = NaN

Byte k (1 ≤ k ≤ 16), holding elements e = 2(k-1) and 2(k-1)+1:
  bit  7   6   5   4   3   2   1   0
      [S] [E1][E0][M ] [S] [E1][E0][M ]
      └── element 2(k-1)+1 ──┘ └── element 2(k-1) ──┘
           (high nibble)            (low nibble)

FP4 E2M1 nibble:
  bit 3      : sign
  bits 2..1  : exponent E (bias 1)
  bit 0      : mantissa M
  E > 0 : value = (-1)^S × 2^(E-1) × (1 + M/2)
  E = 0 : value = (-1)^S × 0.5 × M      (subnormal; codes 0x0=+0, 0x1=+0.5)
```

Decode table for one nibble:

```
code: 0    1    2    3    4    5    6    7    8    9    A    B    C    D    E    F
val:  0.0  0.5  1.0  1.5  2.0  3.0  4.0  6.0 -0.0 -0.5 -1.0 -1.5 -2.0 -3.0 -4.0 -6.0
```

E2M1 has **no Inf/NaN encodings** — all 16 codes are finite values.

---

**Bottom line:** everything above about the format itself (block size 32, E2M1 elements, E8M0 scales, 4.25 bits/param) is fixed by the OCP MX spec, so any correct C implementation must match it. The parts that vary per implementation — nibble order, scale byte placement (prefixed vs. a separate scale tensor), rounding mode during quantization, and which tensors get quantized — are exactly the things I'd need the actual kimi-k3-in-c source to confirm. Paste the quantization file and I'll map it against this reference precisely.