from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any


class IRType(Enum):
    # Quantized types
    MXFP4 = auto()
    INT8 = auto()
    BF16 = auto()
    FP16 = auto()
    FP32 = auto()
    # Structural
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
    inputs: list[str] = field(default_factory=list)  # IR node IDs
    outputs: list[str] = field(default_factory=list)


@dataclass
class IRGraph:
    nodes: dict[str, IRNode] = field(default_factory=dict)
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)

    def add_node(self, node: IRNode):
        if node.id in self.nodes:
            raise ValueError(f"Duplicate IR node id: {node.id}")
        self.nodes[node.id] = node
        for src in node.inputs:
            if src in self.nodes and node.id not in self.nodes[src].outputs:
                self.nodes[src].outputs.append(node.id)

    def topological_sort(self) -> list[IRNode]:
        indegree = {node_id: 0 for node_id in self.nodes}
        outgoing = {node_id: list(node.outputs) for node_id, node in self.nodes.items()}

        for node_id, node in self.nodes.items():
            for src in node.inputs:
                if src not in self.nodes:
                    raise ValueError(f"Unknown input '{src}' for node '{node_id}'")
                indegree[node_id] += 1
                if node_id not in outgoing[src]:
                    outgoing[src].append(node_id)

        ready = [node_id for node_id, degree in indegree.items() if degree == 0]
        ordered: list[IRNode] = []

        while ready:
            node_id = ready.pop(0)
            ordered.append(self.nodes[node_id])
            for dst in outgoing[node_id]:
                if dst not in indegree:
                    raise ValueError(f"Unknown output '{dst}' for node '{node_id}'")
                indegree[dst] -= 1
                if indegree[dst] == 0:
                    ready.append(dst)

        if len(ordered) != len(self.nodes):
            raise ValueError("IR graph contains a cycle")
        return ordered

    def estimate_memory(self) -> int:
        return sum(_node_size_bytes(node) for node in self.nodes.values())


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
                if kind == "target":
                    self._visit_target(node)
                elif kind in {"weight", "state", "scratch", "tensor"}:
                    self._visit_tensor(node)
                elif kind == "attention":
                    self._visit_attention(node)
                elif kind == "moe":
                    self._visit_moe(node)
                elif kind == "model":
                    self._visit_model(node)
            return self.graph

        raise TypeError("Unsupported AST root for IRBuilder")

    def _visit_target(self, node) -> IRNode:
        name = _name(node, "target")
        attrs = _attrs(node)
        ir_node = IRNode(name, "target", attrs)
        self.graph.add_node(ir_node)
        return ir_node

    def _visit_tensor(self, node) -> IRNode:
        attrs = _attrs(node)
        op = _kind(node)
        if op == "tensor":
            op = attrs.get("storage", "tensor")
        ir_node = IRNode(_name(node), op, attrs)
        self.graph.add_node(ir_node)
        return ir_node

    def _visit_attention(self, node) -> IRNode:
        attrs = _attrs(node)
        kind = attrs.get("kind", "attention")
        op = "kda" if kind == "kda" else "attention"
        ir_node = IRKDA(
            _name(node),
            op,
            attrs,
            list(attrs.get("inputs", [])),
            list(attrs.get("outputs", [])),
        )
        self.graph.add_node(ir_node)
        return ir_node

    def _visit_moe(self, node) -> IRNode:
        attrs = _attrs(node)
        ir_node = IRMoE(
            _name(node),
            "moe",
            attrs,
            list(attrs.get("inputs", [])),
            list(attrs.get("outputs", [])),
        )
        self.graph.add_node(ir_node)
        return ir_node

    def _visit_model(self, node) -> IRGraph:
        for child in _children(node):
            kind = _kind(child)
            if kind in {"weight", "state", "scratch", "tensor"}:
                self._visit_tensor(child)
            elif kind == "attention":
                self._visit_attention(child)
            elif kind == "moe":
                self._visit_moe(child)
            elif kind == "target":
                self._visit_target(child)
            else:
                attrs = _attrs(child)
                ir_node = IRNode(
                    _name(child, f"node_{len(self.graph.nodes)}"),
                    attrs.get("op", kind),
                    attrs,
                    list(attrs.get("inputs", [])),
                    list(attrs.get("outputs", [])),
                )
                self.graph.add_node(ir_node)
        return self.graph


class IRMatmul(IRNode):
    attrs = {"a_dtype", "b_dtype", "out_dtype", "a_quant", "b_quant"}
    required_attrs = attrs


class IRKDA(IRNode):
    attrs = {"heads", "head_dim", "max_seq", "decay", "beta", "state_dtype"}
    required_attrs = attrs


class IRMoE(IRNode):
    attrs = {"num_experts", "active", "expert_fn"}
    required_attrs = attrs


class IRQuantize(IRNode):
    attrs = {"from_dtype", "to_dtype", "block_size"}
    required_attrs = attrs


class IRDequantize(IRNode):
    attrs = {"from_dtype", "to_dtype", "block_size"}
    required_attrs = attrs


def _node_size_bytes(node: IRNode) -> int:
    if "size" in node.attrs:
        return int(node.attrs["size"])
    if "size_bytes" in node.attrs:
        return int(node.attrs["size_bytes"])
    tensor_type = node.attrs.get("type") or node.attrs.get("tensor_type")
    if hasattr(tensor_type, "memory_bytes"):
        return int(tensor_type.memory_bytes())
    shape = node.attrs.get("shape")
    dtype = node.attrs.get("dtype") or node.attrs.get("out_dtype")
    if shape is None or dtype is None:
        return 0
    elems = 1
    for dim in shape:
        if dim is None:
            return 0
        elems *= int(dim)
    return int(elems * _dtype_bytes(dtype))


def _dtype_bytes(dtype: Any) -> float:
    name = str(getattr(dtype, "value", dtype)).lower()
    return {
        "mxfp4": 4.25 / 8,
        "int4": 5.0 / 8,
        "int8": 8.25 / 8,
        "bf16": 2,
        "fp16": 2,
        "fp32": 4,
    }.get(name, 0)


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
            if key not in {"kind", "type", "op", "name", "id", "children", "body"}:
                attrs.setdefault(key, value)
        return attrs
    attrs = dict(getattr(node, "attrs", {}) or {})
    for key in ("dtype", "shape", "size", "size_bytes", "inputs", "outputs"):
        if hasattr(node, key):
            attrs.setdefault(key, getattr(node, key))
    return attrs


def _children(node: Any) -> list:
    if isinstance(node, dict):
        return list(node.get("children") or node.get("body") or node.get("decls") or [])
    return list(
        getattr(node, "children", None)
        or getattr(node, "body", None)
        or getattr(node, "decls", None)
        or []
    )
