from __future__ import annotations

from dataclasses import dataclass

try:
    from .ir import IRGraph, IRNode
except ImportError:  # pragma: no cover - supports direct module execution
    from ir import IRGraph, IRNode


class MemoryError(Exception):
    pass


class MemoryBank:
    # Storage classes
    WEIGHT = "weight"  # loaded once, never freed
    STATE = "state"  # persistent across inference
    SCRATCH = "scratch"  # temporary, freed after use


@dataclass
class Allocation:
    name: str
    bank: str
    offset: int
    size_bytes: int
    alignment: int


class MemoryPlanner:
    """
    Static RAM planner. Computes the exact memory layout at compile time.
    Rejects programs that exceed target RAM.
    """

    def __init__(self, ir: IRGraph, target_ram: int, alignment: int = 16):
        self.ir = ir
        self.target_ram = target_ram
        self.alignment = alignment
        self.allocations: list[Allocation] = []
        self.weight_bytes = 0
        self.state_bytes = 0
        self.scratch_peak = 0

    def plan(self) -> tuple[int, int, int, list[Allocation]]:
        """
        Returns (weight_total, state_total, scratch_peak, allocations).
        Raises MemoryError if exceeds target_ram.
        """
        self.allocations = []
        self.weight_bytes = 0
        self.state_bytes = 0
        self.scratch_peak = 0

        for node in self.ir.topological_sort():
            if node.op == MemoryBank.WEIGHT:
                alloc = self._allocate(node.id, MemoryBank.WEIGHT, _node_size_bytes(node))
                self.weight_bytes = max(self.weight_bytes, alloc.offset + alloc.size_bytes)
            elif node.op == MemoryBank.STATE:
                alloc = self._allocate(node.id, MemoryBank.STATE, _node_size_bytes(node))
                self.state_bytes = max(self.state_bytes, alloc.offset + alloc.size_bytes)

        self.scratch_peak = self._compute_scratch_peak()
        total = self.weight_bytes + self.state_bytes + self.scratch_peak
        if total > self.target_ram:
            raise MemoryError(f"Exceeds RAM by {total - self.target_ram} bytes")
        return self.weight_bytes, self.state_bytes, self.scratch_peak, list(self.allocations)

    def _compute_scratch_peak(self) -> int:
        ordered = self.ir.topological_sort()
        index = {node.id: i for i, node in enumerate(ordered)}
        consumers: dict[str, list[int]] = {node.id: [] for node in ordered}
        for node in ordered:
            for src in node.inputs:
                if src in consumers:
                    consumers[src].append(index[node.id])

        intervals: list[dict] = []
        for node in ordered:
            if not _is_scratch(node):
                continue
            size = _align(_node_size_bytes(node), self.alignment)
            if size <= 0:
                continue
            start = index[node.id]
            last_use = max(consumers[node.id], default=start)
            intervals.append({"name": node.id, "start": start, "end": last_use, "size": size})

        placed: list[dict] = []
        for interval in sorted(intervals, key=lambda item: (-item["size"], item["start"], item["name"])):
            offset = 0
            while True:
                conflict = None
                for other in placed:
                    if _time_overlaps(interval, other) and _space_overlaps(offset, interval["size"], other):
                        conflict = other
                        break
                if conflict is None:
                    break
                offset = _align(conflict["offset"] + conflict["size"], self.alignment)

            interval["offset"] = offset
            placed.append(interval)
            self.allocations.append(
                Allocation(interval["name"], MemoryBank.SCRATCH, offset, interval["size"], self.alignment)
            )

        return max((item["offset"] + item["size"] for item in placed), default=0)

    def _allocate(self, name: str, bank: str, bytes: int) -> Allocation:
        size = _align(int(bytes), self.alignment)
        if bank == MemoryBank.WEIGHT:
            offset = self.weight_bytes
            self.weight_bytes += size
        elif bank == MemoryBank.STATE:
            offset = self.state_bytes
            self.state_bytes += size
        elif bank == MemoryBank.SCRATCH:
            offset = self.scratch_peak
            self.scratch_peak += size
        else:
            raise ValueError(f"Unknown memory bank: {bank}")
        alloc = Allocation(name, bank, offset, size, self.alignment)
        self.allocations.append(alloc)
        return alloc


def _is_scratch(node: IRNode) -> bool:
    return node.op == MemoryBank.SCRATCH or node.attrs.get("bank") == MemoryBank.SCRATCH


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


def _dtype_bytes(dtype) -> float:
    name = str(getattr(dtype, "value", dtype)).lower()
    return {
        "mxfp4": 4.25 / 8,
        "int4": 5.0 / 8,
        "int8": 8.25 / 8,
        "bf16": 2,
        "fp16": 2,
        "fp32": 4,
    }.get(name, 0)


def _align(value: int, alignment: int) -> int:
    if alignment <= 0:
        raise ValueError("alignment must be positive")
    return ((value + alignment - 1) // alignment) * alignment


def _time_overlaps(a: dict, b: dict) -> bool:
    return not (a["end"] < b["start"] or b["end"] < a["start"])


def _space_overlaps(offset: int, size: int, other: dict) -> bool:
    return offset < other["offset"] + other["size"] and other["offset"] < offset + size
