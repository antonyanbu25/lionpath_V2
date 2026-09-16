#!/usr/bin/env node
/**
 * Frontend hostname -> API base URL routing (firebase-config.js workerBaseUrl).
 *
 * Regression guard: janus.benjaminsquare.com (Cloud Run prep-portal-web) used to
 * resolve to portalapi.benjaminsquare.com — the legacy VPS worker — which served a
 * stale build and 404'd /api/users/me, account deals, contacts and calls. It must
 * resolve to janus-api.benjaminsquare.com (Cloud Run prep-portal-api).
 *
 * portal.benjaminsquare.com legitimately KEEPS the portalapi.* mapping, so this
 * asserts each hostname's target independently rather than banning the old host.
 */

import assert from "node:assert/strict";
import { WORKER_BASE_URL, workerBaseUrl } from "../firebase-config.js";

const RUN_APP_API = "https://prep-portal-api-781846715448.us-central1.run.app";

// --- Production / staging hostname mappings -------------------------------
assert.equal(
  workerBaseUrl("janus.benjaminsquare.com", "https:"),
  "https://janus-api.benjaminsquare.com",
  "janus (prep-portal-web) -> janus-api (prep-portal-api), NOT the legacy VPS portalapi",
);

assert.equal(
  workerBaseUrl("portal.benjaminsquare.com", "https:"),
  "https://portalapi.benjaminsquare.com",
  "portal -> portalapi (legacy VPS) — preserved unchanged",
);

assert.equal(
  workerBaseUrl("staging.benjaminsquare.com", "https:"),
  "https://staging-api.benjaminsquare.com",
  "staging -> staging-api — preserved unchanged",
);

assert.equal(
  workerBaseUrl("yonus.benjaminsquare.com", "https:"),
  "https://yonus-api.benjaminsquare.com",
  "yonus -> yonus-api — preserved unchanged",
);

// Each frontend host must be routed independently — janus must not inherit
// portal's backend, and portal must not inherit janus's.
assert.notEqual(
  workerBaseUrl("janus.benjaminsquare.com", "https:"),
  workerBaseUrl("portal.benjaminsquare.com", "https:"),
  "janus and portal must resolve to different API backends",
);

// --- Cloud Run *.run.app --------------------------------------------------
assert.equal(
  workerBaseUrl("prep-portal-web-781846715448.us-central1.run.app", "https:"),
  RUN_APP_API,
  "*.run.app -> prep-portal-api run.app URL",
);
assert.equal(
  workerBaseUrl("anything.run.app", "https:"),
  RUN_APP_API,
  "any .run.app suffix -> prep-portal-api run.app URL",
);

// --- Local development ----------------------------------------------------
assert.equal(
  workerBaseUrl("localhost", "http:"),
  "http://127.0.0.1:8787",
  "localhost pins to IPv4 loopback (Chrome resolves localhost to ::1 first)",
);
assert.equal(
  workerBaseUrl("127.0.0.1", "http:"),
  "http://127.0.0.1:8787",
  "127.0.0.1 pins to IPv4 loopback",
);
assert.equal(
  workerBaseUrl("localhost", "https:"),
  "https://127.0.0.1:8787",
  "localhost keeps the caller's protocol",
);

// --- LAN / unknown-host fallback -----------------------------------------
assert.equal(
  workerBaseUrl("192.168.1.42", "http:"),
  "http://192.168.1.42:8787",
  "LAN host falls back to same host on the worker port",
);
assert.equal(
  workerBaseUrl("dev.example.test", "https:"),
  "https://dev.example.test:8787",
  "unknown host falls back to same host on the worker port",
);

// --- No-DOM fallback ------------------------------------------------------
assert.equal(
  workerBaseUrl("", ""),
  "http://127.0.0.1:8787",
  "empty host (no DOM) falls back to local worker",
);
assert.equal(
  workerBaseUrl(undefined, undefined),
  "http://127.0.0.1:8787",
  "undefined host falls back to local worker",
);

// Importing under Node (no `location` binding at all) must not throw a
// ReferenceError — the module uses a typeof guard, not optional chaining.
assert.equal(
  WORKER_BASE_URL,
  "http://127.0.0.1:8787",
  "WORKER_BASE_URL resolves to the local worker when there is no `location`",
);

console.log("test-worker-base-url.mjs: ok");
