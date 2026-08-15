from __future__ import annotations

from math import prod

try:
    from .ir import IRGraph, IRNode
except ImportError:  # pragma: no cover - supports direct module execution
    from ir import IRGraph, IRNode


class QuantType:
    def __init__(self, base: str, block_size: int = 1, scale_type: str = "", zero_type: str = "sym"):
        self.base = base.lower()
        self.block_size = int(block_size)
        self.scale_type = scale_type.lower() if scale_type else ""
        self.zero_type = zero_type.lower()

    def bytes_per_elem(self) -> float:
        if self.base == "mxfp4":
            return 4.25 / 8
        if self.base == "int4":
            return 5.0 / 8 if self.zero_type == "asym" else 4.5 / 8
        if self.base == "int8":
            scale_bytes = {"fp16": 2, "bf16": 2, "fp32": 4}.get(self.scale_type, 2)
            return (8 * self.block_size / 8 + scale_bytes) / self.block_size
        if self.base in {"bf16", "fp16"}:
            return 2
        if self.base == "fp32":
            return 4
        raise ValueError(f"Unknown quant base: {self.base}")

    def compatible_with(self, other: "QuantType") -> bool:
        return (
            isinstance(other, QuantType)
            and self.base == other.base
            and self.block_size == other.block_size
            and self.scale_type == other.scale_type
            and self.zero_type == other.zero_type
        )

    def __eq__(self, other) -> bool:
        return self.compatible_with(other)

    def __repr__(self) -> str:
        return (
            f"QuantType(base={self.base!r}, block_size={self.block_size}, "
            f"scale_type={self.scale_type!r}, zero_type={self.zero_type!r})"
        )


class TensorType:
    def __init__(self, quant: QuantType, shape: list[int | None]):
        self.quant = quant
        self.shape = list(shape)

    def memory_bytes(self) -> int:
        if any(dim is None for dim in self.shape):
            raise ValueError("Cannot compute memory for dynamic shape")
        return int(prod(int(dim) for dim in self.shape) * self.quant.bytes_per_elem())

    def __eq__(self, other) -> bool:
        return isinstance(other, TensorType) and self.quant == other.quant and self.shape == other.shape

    def __repr__(self) -> str:
        return f"TensorType(quant={self.quant!r}, shape={self.shape!r})"


class TypeEnv:
    def __init__(self):
        self._types: dict[str, TensorType] = {}

    def define(self, name: str, t: TensorType):
        self._types[name] = t

    def lookup(self, name: str) -> TensorType:
        if name not in self._types:
            raise KeyError(f"Undefined tensor: {name}")
        return self._types[name]

    def check_matmul(self, a: TensorType, b: TensorType) -> TensorType:
        if len(a.shape) < 2 or len(b.shape) != 2:
            raise TypeError("matmul requires rank >=2 activation and rank-2 weight")
        if a.shape[-1] != b.shape[0]:
            raise TypeError(f"matmul shape mismatch: {a.shape} @ {b.shape}")
        if a.quant.base not in {"fp32", "fp16", "bf16"}:
            raise TypeError("matmul activation must be fp32, fp16, or bf16")
        out_shape = list(a.shape[:-1]) + [b.shape[1]]
        return TensorType(QuantType("fp32"), out_shape)

    def check_attention(self, q: TensorType, k: TensorType, v: TensorType) -> TensorType:
        if q.shape != k.shape or q.shape != v.shape:
            raise TypeError(f"attention q/k/v shape mismatch: {q.shape}, {k.shape}, {v.shape}")
        if q.quant.base not in {"fp32", "fp16", "bf16"}:
            raise TypeError("attention q/k/v must be fp32, fp16, or bf16")
        return q


class TypeChecker:
    def __init__(self, ir: IRGraph):
        self.ir = ir
        self.env = TypeEnv()

    def check(self) -> list[str]:
        errors: list[str] = []
        try:
            ordered = self.ir.topological_sort()
        except ValueError as exc:
            return [str(exc)]

        for node in ordered:
            try:
                self._check_node(node)
            except (KeyError, TypeError, ValueError) as exc:
                errors.append(f"{node.id}: {exc}")
        return errors

    def _check_node(self, node: IRNode):
        declared = _tensor_type_from_attrs(node.attrs)
        if declared is not None and node.op in {"weight", "state", "scratch", "tensor"}:
            self._check_block_divisibility(node.id, declared)
            if node.op == "state" and declared.quant.base not in {"fp16", "bf16", "fp32"}:
                raise TypeError("E0310: KDA state tensors must be fp16, bf16, or fp32")
            self.env.define(node.id, declared)
            return

        if node.op in {"matmul", "matmul_q", "matmul_f"}:
            if len(node.inputs) < 2:
                raise TypeError("matmul requires two inputs")
            out = self.env.check_matmul(self.env.lookup(node.inputs[0]), self.env.lookup(node.inputs[1]))
            out_dtype = node.attrs.get("out") or node.attrs.get("out_dtype")
            if out_dtype:
                out.quant = _quant_from_any(out_dtype)
            self.env.define(node.id, out)
            return

        if node.op in {"add", "elem_add", "mul", "elem_mul"}:
            if len(node.inputs) < 2:
                raise TypeError(f"{node.op} requires two inputs")
            lhs = self.env.lookup(node.inputs[0])
            rhs = self.env.lookup(node.inputs[1])
            if lhs != rhs:
                raise TypeError("E0301: quant mismatch, insert requant()")
            self.env.define(node.id, lhs)
            return

        if node.op in {"attention", "kda", "kda_read"} and len(node.inputs) >= 3:
            out = self.env.check_attention(
                self.env.lookup(node.inputs[0]),
                self.env.lookup(node.inputs[1]),
                self.env.lookup(node.inputs[2]),
            )
            self.env.define(node.id, out)
            return

        if node.inputs:
            self.env.define(node.id, self.env.lookup(node.inputs[0]))
        elif declared is not None:
            self.env.define(node.id, declared)

    def _check_block_divisibility(self, name: str, tensor: TensorType):
        if tensor.quant.base in {"bf16", "fp16", "fp32"}:
            return
        if not tensor.shape or tensor.shape[-1] is None:
            return
        if int(tensor.shape[-1]) % tensor.quant.block_size != 0:
            raise TypeError(
                f"E0302: innermost dimension of '{name}' must be divisible by "
                f"block size {tensor.quant.block_size}"
            )


def _tensor_type_from_attrs(attrs: dict) -> TensorType | None:
    value = attrs.get("tensor_type") or attrs.get("type")
    if isinstance(value, TensorType):
        return value
    if isinstance(value, dict):
        quant = value.get("quant") or value.get("dtype")
        shape = value.get("shape")
        if quant is not None and shape is not None:
            return TensorType(_quant_from_any(quant), list(shape))
    quant = attrs.get("quant") or attrs.get("dtype")
    shape = attrs.get("shape")
    if quant is None or shape is None:
        return None
    return TensorType(_quant_from_any(quant), list(shape))


def _quant_from_any(value) -> QuantType:
    if isinstance(value, QuantType):
        return value
    if isinstance(value, dict):
        return QuantType(
            value.get("base") or value.get("dtype"),
            value.get("block_size") or value.get("block") or 1,
            value.get("scale_type") or value.get("scale") or "",
            value.get("zero_type") or value.get("zero") or "sym",
        )
    name = str(value).lower()
    defaults = {
        "mxfp4": (32, "e8m0"),
        "int8": (64, "fp16"),
        "int4": (32, "fp16"),
        "bf16": (1, ""),
        "fp16": (1, ""),
        "fp32": (1, ""),
    }
    block, scale = defaults.get(name, (1, ""))
    return QuantType(name, block, scale)
