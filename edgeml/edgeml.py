#!/usr/bin/env python3
"""
EdgeML Compiler CLI
Usage:
    python3 edgeml.py compile <input.edgeml> [--target x86_64|arm64|generic] [--simd avx2|neon|none]
    python3 edgeml.py bench <input.edgeml>
    python3 edgeml.py info <input.edgeml>
"""
import argparse
import sys
import time
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent / "src"))

from codegen import CodeGen
from ir import IRBuilder
from lexer import Lexer
from memory_planner import MemoryError, MemoryPlanner
from parser import Parser


def _build_ir(source_path: str):
    source = Path(source_path).read_text()
    lexer = Lexer(source)
    lexer.tokenize()
    parser = Parser(source)
    ast = parser.parse()
    builder = IRBuilder(ast)
    return builder.build()


def compile(source_path: str, target_arch: str, simd: str, output_dir: str):
    ir = _build_ir(source_path)

    target_ram = ir.metadata.get("ram") or 512 * 1024 * 1024
    planner = MemoryPlanner(ir, target_ram=target_ram)
    try:
        weight_bytes, state_bytes, scratch_peak, _ = planner.plan()
        print(
            "Memory plan OK: "
            f"weight={weight_bytes // 1024}KB, "
            f"state={state_bytes // 1024}KB, "
            f"scratch_peak={scratch_peak // 1024}KB"
        )
    except MemoryError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    codegen = CodeGen(ir, target_arch=target_arch, simd=simd)
    header, source = codegen.generate()

    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    (out_path / "edgeml.h").write_text(header)
    (out_path / "edgeml.c").write_text(source)

    print(f"Generated: {out_path / 'edgeml.h'} and {out_path / 'edgeml.c'}")


def info(source_path: str):
    ir = _build_ir(source_path)
    nodes = list(ir.nodes.values())
    total_params = sum(n.attrs.get("params", 0) for n in nodes if n.op == "weight")
    total_weight = sum(n.attrs.get("size", 0) for n in nodes if n.op == "weight")
    total_state = sum(n.attrs.get("size", 0) for n in nodes if n.op == "state")
    target_ram = ir.metadata.get("ram") or 512 * 1024 * 1024
    _, _, scratch_peak, allocs = MemoryPlanner(ir, target_ram=target_ram).plan()

    print(f"Model: {ir.metadata.get('model', 'model')}")
    print(f"Target: {ir.metadata.get('target', 'default')} ({ir.metadata.get('arch')}/{ir.metadata.get('simd')})")
    print(f"Layers: {ir.metadata.get('layers', 0)}")
    print(f"Parameters: {total_params:,} ({total_params / 1_000_000:.1f}M)")
    print(f"IR nodes: {len(nodes)}")
    print(f"Topological order: {[n.id for n in ir.topological_sort()]}")
    print(f"Total weight memory: {total_weight / 1024 / 1024:.2f} MB")
    print(f"Total state memory: {total_state / 1024 / 1024:.2f} MB")
    print(f"Scratch peak estimate: {scratch_peak / 1024 / 1024:.2f} MB")
    print(f"RAM estimate: {allocs['peak'] / 1024 / 1024:.2f} MB / {target_ram / 1024 / 1024:.0f} MB")


def bench(source_path: str):
    start = time.perf_counter()
    ir = _build_ir(source_path)
    parse_ms = (time.perf_counter() - start) * 1000.0
    target_ram = ir.metadata.get("ram") or 512 * 1024 * 1024
    start = time.perf_counter()
    MemoryPlanner(ir, target_ram=target_ram).plan()
    plan_ms = (time.perf_counter() - start) * 1000.0
    print(f"parse+IR: {parse_ms:.2f} ms")
    print(f"memory plan: {plan_ms:.2f} ms")


def main():
    parser = argparse.ArgumentParser(description="EdgeML Compiler")
    sub = parser.add_subparsers(dest="cmd")

    compile_cmd = sub.add_parser("compile")
    compile_cmd.add_argument("input", help="Input .edgeml file")
    compile_cmd.add_argument("--target", default="arm64", choices=["x86_64", "arm64", "generic"])
    compile_cmd.add_argument("--simd", default="neon", choices=["avx2", "neon", "none"])
    compile_cmd.add_argument("--output", default=".", help="Output directory")

    info_cmd = sub.add_parser("info")
    info_cmd.add_argument("input", help="Input .edgeml file")

    bench_cmd = sub.add_parser("bench")
    bench_cmd.add_argument("input", help="Input .edgeml file")

    args = parser.parse_args()

    if args.cmd == "compile":
        compile(args.input, args.target, args.simd, args.output)
    elif args.cmd == "info":
        info(args.input)
    elif args.cmd == "bench":
        bench(args.input)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
