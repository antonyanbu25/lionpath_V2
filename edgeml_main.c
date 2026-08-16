// Benchmark harness for EdgeML compiled model
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <string.h>
#include "edgeml.h"

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

int main(void) {
    printf("=== EdgeML Benchmark ===\n\n");

    edgeml_config cfg = {0};
    uint8_t scratch[1024 * 1024]; // 1MB scratch
    cfg.scratch = scratch;
    cfg.scratch_size = sizeof(scratch);
    cfg.embed_w = NULL;  // no actual weights loaded
    cfg.fc1_w = NULL;
    cfg.fc2_w = NULL;

    edgeml_ctx ctx;
    int rc = edgeml_init(&ctx, &cfg);
    if (rc != 0) {
        printf("ERROR: init failed (rc=%d)\n", rc);
        return 1;
    }
    printf("✅ EdgeML init OK\n");

    // Benchmark: 1000 forward passes
    const int N = 1000;
    float input[128];
    float output[256];
    for (int i = 0; i < 128; i++) input[i] = (float)(i % 64) / 64.0f;

    double t0 = now_ms();
    for (int i = 0; i < N; i++) {
        edgeml_forward(&ctx, input, output);
    }
    double t1 = now_ms();

    double elapsed = t1 - t0;
    double avg_us = elapsed * 1000.0 / N;
    double throughput = N / (elapsed / 1000.0);

    printf("\n=== Results (%d iterations) ===\n", N);
    printf("Total time:   %.2f ms\n", elapsed);
    printf("Avg per call: %.3f us\n", avg_us);
    printf("Throughput:   %.0f calls/sec\n", throughput);

    edgeml_free(&ctx);
    printf("\n✅ Benchmark complete.\n");
    return 0;
}
