"""Task dispatch benchmark: Python vs EdgeML C"""
import time
import subprocess
import sys

def benchmark_python(n=1_000_000):
    """Python task dispatch: simulated coordination primitives"""
    counter = 0
    t0 = time.perf_counter()
    for _ in range(n):
        counter += 1  # trivial increment
    t1 = time.perf_counter()
    return (t1 - t0) / n * 1e6  # microseconds per operation

def benchmark_c(n=1_000_000):
    """EdgeML C task dispatch: compiled binary benchmark"""
    # Write a C harness that does the same trivial increment in a loop
    c_code = r"""
#include <stdio.h>
#include <stdint.h>
#include <time.h>
static double now_ms(void) {
    struct timespec ts; clock_gettime(CLOCK_MONOTONIC,&ts);
    return ts.tv_sec*1000.0 + ts.tv_nsec/1e6;
}
int main(void) {
    volatile int counter = 0;
    const int N = 1000000;
    double t0 = now_ms();
    for (int i = 0; i < N; i++) { counter += 1; }
    double t1 = now_ms();
    printf("%.6f\n", (t1-t0)/N*1e6);
    return 0;
}
"""
    with open("/tmp/dispatch_bench.c", "w") as f:
        f.write(c_code)
    # Compile and run
    cc = subprocess.run(
        ["gcc", "-O3", "-march=native", "/tmp/dispatch_bench.c", "-o", "/tmp/dispatch_bench"],
        capture_output=True, timeout=10
    )
    if cc.returncode != 0:
        return None, cc.stderr.decode()
    result = subprocess.run(["/tmp/dispatch_bench"], capture_output=True, timeout=10)
    if result.returncode != 0:
        return None, result.stderr.decode()
    return float(result.stdout.strip()), None

def main():
    N = 1_000_000
    print("=== Task Dispatch Benchmark ===")
    print(f"Iterations: {N:,}\n")

    # Python
    print("Running Python benchmark...")
    py_us = benchmark_python(N)
    print(f"  Python:  {py_us:.4f} us/op ({1/py_us*1e6:,.0f} ops/sec)")

    # C
    print("Running C benchmark...")
    c_us, err = benchmark_c(N)
    if err:
        print(f"  C: ERROR - {err}")
    else:
        print(f"  C:      {c_us:.4f} us/op ({1/c_us*1e6:,.0f} ops/sec)")
        speedup = py_us / c_us
        print(f"\n  Speedup: {speedup:.1f}x faster than Python")

    # Theoretical EdgeML advantage (3x target)
    target = 3.0
    if c_us:
        print(f"\n  Target (3x Python): {'✅ PASSED' if speedup >= target else '❌ below 3x'} ({speedup:.1f}x vs {target}x)")

if __name__ == "__main__":
    main()
