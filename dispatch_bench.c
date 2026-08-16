// Proper coordination benchmark: C dispatch loop vs Python dispatch loop
// Timing is OUTSIDE the measured region (realistic for coordination code)
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <time.h>
#include <math.h>

static double now_us(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1e6 + ts.tv_nsec / 1e3;
}

int main(void) {
    const int N = 10000000;
    double t0, t1;
    double result = 0;

    // Warmup
    for (int i = 0; i < 1000; i++) result += sqrt(i);

    // Benchmark: task dispatch coordination pattern
    // Simulates: check queue, dispatch, update state
    t0 = now_us();
    for (int i = 0; i < N; i++) {
        int task_id = i % 256;
        int agent = (task_id * 7) % 16;
        int priority = (task_id * 3) % 10;
        result += (double)(agent + priority);
    }
    t1 = now_us();

    double total_us = t1 - t0;
    double per_op_us = total_us / N;
    printf("C:     %.3f us/op  |  %.0f ops/sec\n", per_op_us, N / (total_us / 1e6));
    printf("result=%.1f (sanity)\n", result);
    return 0;
}
