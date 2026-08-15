"""Minimal EdgeML IR primitives used by code generation tests."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class IRNode:
    id: str
    op: str
    attrs: dict[str, Any] = field(default_factory=dict)
    deps: list[str] = field(default_factory=list)


class IRGraph:
    def __init__(self) -> None:
        self.nodes: dict[str, IRNode] = {}
        self._order: list[str] = []

    def add_node(self, node: IRNode) -> None:
        if node.id not in self.nodes:
            self._order.append(node.id)
        self.nodes[node.id] = node

    def topological_sort(self) -> list[IRNode]:
        visited: set[str] = set()
        visiting: set[str] = set()
        ordered: list[IRNode] = []

        def visit(node_id: str) -> None:
            if node_id in visited:
                return
            if node_id in visiting:
                raise ValueError(f"cycle detected at IR node {node_id!r}")
            node = self.nodes[node_id]
            visiting.add(node_id)
            for dep_id in getattr(node, "deps", []) or []:
                if dep_id in self.nodes:
                    visit(dep_id)
            visiting.remove(node_id)
            visited.add(node_id)
            ordered.append(node)

        for node_id in self._order:
            visit(node_id)
        return ordered
