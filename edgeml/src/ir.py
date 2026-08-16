"""EdgeML IR — graph representation of EdgeML programs."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any


class IRType(Enum):
    MXFP4 = auto()
    INT8 = auto()
    INT4 = auto()
    BF16 = auto()
    FP16 = auto()
    FP32 = auto()
    TENSOR = auto()
    LAYER = auto()
    ATTENTION = auto()
    MOE = auto()
    MODEL = auto()


@dataclass
class IRNode:
    id: str
    op: str
    attrs: dict = field(default_factory=dict)
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)


@dataclass
class IRGraph:
    nodes: dict[str, IRNode] = field(default_factory=dict)
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def add_node(self, node: IRNode) -> None:
        if node.id in self.nodes:
            raise ValueError(f"Duplicate IR node id: {node.id}")
        self.nodes[node.id] = node
        for src in node.inputs:
            if src in self.nodes and node.id not in self.nodes[src].outputs:
                self.nodes[src].outputs.append(node.id)

    def topological_sort(self) -> list[IRNode]:
        indegree = {nid: 0 for nid in self.nodes}
        outgoing: dict[str, list[str]] = {nid: list(n.outputs) for nid, n in self.nodes.items()}
        for nid, node in self.nodes.items():
            for src in node.inputs:
                if src not in self.nodes:
                    raise ValueError(f"Unknown input {src!r} for node {nid!r}")
                indegree[nid] += 1
                if nid not in outgoing[src]:
                    outgoing[src].append(nid)
        ready = [nid for nid, d in indegree.items() if d == 0]
        ordered: list[IRNode] = []
        while ready:
            nid = ready.pop(0)
            ordered.append(self.nodes[nid])
            for dst in outgoing[nid]:
                indegree[dst] -= 1
                if indegree[dst] == 0:
                    ready.append(dst)
        if len(ordered) != len(self.nodes):
            raise ValueError("IR graph contains a cycle")
        return ordered

    def estimate_memory(self) -> int:
        return sum(_node_size_bytes(n) for n in self.nodes.values())


# ------------------------------------------------------------------
# IRBuilder
# ------------------------------------------------------------------

class IRBuilder:
    def __init__(self, ast: Any):
        self.ast = ast
        self.graph = IRGraph()

    def build(self) -> IRGraph:
        if _kind(self.ast) == "model":
            return self._visit_model(self.ast)
        decls = _children(self.ast)
        if decls:
            for node in decls:
                kind = _kind(node)
                if kind in {"target", "targetdecl"}:
                    self._visit_target(node)
                elif kind in {"weight", "state", "scratch", "tensor", "tensordecl", "input"}:
                    self._visit_tensor(node)
                elif kind in {"quantscheme", "quantschemedecl"}:
                    self._visit_quantscheme(node)
                elif kind in {"attention", "attentionblock"}:
                    self._visit_attention(node)
                elif kind in {"moe", "moeblock"}:
                    self._visit_moe(node)
                elif kind == "model":
                    self._visit_model(node)
            return self.graph
        raise TypeError("Unsupported AST root for IRBuilder")

    def _visit_target(self, node) -> IRNode:
        attrs = _attrs(node)
        name = _name(node, "target")
        ir_node = IRNode(name, "target", attrs)
        self.graph.add_node(ir_node)
        self.graph.metadata["target"] = name
        self.graph.metadata["arch"] = attrs.get("arch", "")
        self.graph.metadata["simd"] = attrs.get("simd", "")
        ram_str = attrs.get("ram", "")
        self.graph.metadata["ram"] = _parse_ram_string(ram_str) if ram_str else 512 * 1024 * 1024
        return ir_node

    def _visit_quantscheme(self, node) -> IRNode:
        ir_node = IRNode(_name(node), "quantscheme", _attrs(node))
        self.graph.add_node(ir_node)
        return ir_node

    def _visit_tensor(self, node) -> IRNode:
        attrs = _attrs(node)
        storage = attrs.get("storage_class", attrs.get("storage", "tensor"))
        # Use quant_type for size calculation if present
        shape = attrs.get("shape") or []
        dtype = attrs.get("quant_type") or attrs.get("dtype") or "bf16"
        size = attrs.get("size_bytes") or _compute_tensor_bytes(shape, dtype)
        attrs["size_bytes"] = size
        ir_node = IRNode(_name(node), storage, attrs)
        self.graph.add_node(ir_node)
        return ir_node

    def _visit_attention(self, node) -> IRNode:
        attrs = _attrs(node)
        kind = attrs.get("kind", "attention")
        op = "kda" if kind == "kda" else "attention"
        ir_node = IRNode(_name(node), op, attrs)
        self.graph.add_node(ir_node)
        return ir_node

    def _visit_moe(self, node) -> IRNode:
        attrs = _attrs(node)
        ir_node = IRNode(_name(node), "moe", attrs)
        self.graph.add_node(ir_node)
        return ir_node

    def _visit_model(self, node) -> IRGraph:
        for child in _children(node):
            kind = _kind(child)
            if kind in {"weight", "state", "scratch", "tensor", "tensordecl"}:
                self._visit_tensor(child)
            elif kind == "attention":
                self._visit_attention(child)
            elif kind == "moe":
                self._visit_moe(child)
            elif kind == "target":
                self._visit_target(child)
            else:
                ir_node = IRNode(
                    _name(child, f"node_{len(self.graph.nodes)}"),
                    kind,
                    _attrs(child),
                )
                self.graph.add_node(ir_node)
        return self.graph


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _kind(node: Any) -> str:
    if isinstance(node, dict):
        return str(node.get("kind") or node.get("type") or node.get("op") or "")
    return str(
        getattr(node, "kind", None)
        or getattr(node, "type", None)
        or getattr(node, "op", None)
        or node.__class__.__name__.lower()
    )


def _name(node: Any, default: str | None = None) -> str:
    if isinstance(node, dict):
        value = node.get("name") or node.get("id") or default
    else:
        value = getattr(node, "name", None) or getattr(node, "id", None) or default
    if value is None:
        raise ValueError(f"AST node has no name/id: {node!r}")
    return str(value)


def _attrs(node: Any) -> dict:
    if isinstance(node, dict):
        attrs = dict(node.get("attrs", {}))
        for key, value in node.items():
            if key not in {"kind", "type", "op", "name", "id", "children", "body", "declarations"}:
                attrs.setdefault(key, value)
        return attrs
    attrs = dict(getattr(node, "attrs", {}) or {})
    # Include direct dataclass fields for TensorDecl, TargetDecl etc.
    for key in ("dtype", "shape", "size", "size_bytes", "inputs", "outputs",
                "storage", "quant", "quant_type", "storage_class",
                "arch", "simd", "ram", "name"):
        if hasattr(node, key):
            value = getattr(node, key)
            if value is not None and value != "":
                attrs.setdefault(key, value)
    return attrs


def _children(node: Any) -> list:
    if isinstance(node, dict):
        return list(node.get("children") or node.get("body") or node.get("decls") or node.get("declarations") or [])
    return list(
        getattr(node, "children", None)
        or getattr(node, "body", None)
        or getattr(node, "decls", None)
        or getattr(node, "declarations", None)
        or []
    )


def _dtype_bytes(dtype: Any) -> float:
    name = str(getattr(dtype, "value", dtype)).lower()
    name = name.replace("q_", "").replace("quant_", "").split("[")[0].split("(")[0].strip()
    return {
        "mxfp4": 4.25 / 8,
        "int4": 4.0 / 8,
        "int8": 8.0 / 8,
        "bf16": 16.0 / 8,
        "fp16": 16.0 / 8,
        "fp32": 32.0 / 8,
        "f32": 32.0 / 8,
        "f16": 16.0 / 8,
    }.get(name, 2.0)


def _compute_tensor_bytes(shape: list, dtype: Any) -> int:
    if not shape or any(d is None for d in shape):
        return 0
    elems = 1
    for d in shape:
        try:
            elems *= int(d)
        except (ValueError, TypeError):
            return 0
    return int(elems * _dtype_bytes(dtype))


def _parse_ram_string(value: str) -> int:
    if not value:
        return 512 * 1024 * 1024
    value = str(value).strip()
    units = {"GB": 1024 ** 3, "MB": 1024 ** 2, "KB": 1024, "B": 1}
    for unit, mult in sorted(units.items(), key=lambda x: -len(x[0])):
        if value.endswith(unit):
            try:
                return int(float(value[:-len(unit)]) * mult)
            except ValueError:
                pass
    try:
        return int(float(value))
    except ValueError:
        return 512 * 1024 * 1024


def _node_size_bytes(node: IRNode) -> int:
    for key in ("size_bytes", "size"):
        if key in node.attrs:
            return int(node.attrs[key])
    shape = node.attrs.get("shape")
    dtype = node.attrs.get("dtype") or node.attrs.get("quant")
    if shape is not None and dtype is not None:
        return _compute_tensor_bytes(shape, dtype)
    return 0
