# Phase C Tooling

D2-tooling owns the Playwright sidecar and HTTP/browser verification wrappers.

## Playwright sidecar

Build:

```sh
docker build -t gideon-playwright:phase-c docker/playwright
```

Run:

```sh
docker run --rm gideon-playwright:phase-c https://example.com
```

The sidecar opens the URL, waits for a `body` selector, and prints either
`OK <url> <title>` or `FAIL <url>`.

RAM note: expect roughly 200MB per browser verification container.

## HTTP verification

```sh
scripts/http-tool.sh HEAD https://example.com
scripts/http-tool.sh GET https://example.com
```

The wrapper prints the HTTP status line followed by the SHA-256 hash of the
response body.

## Browser verification wrapper

```sh
scripts/browser-verify.sh gideon-playwright:phase-c https://example.com
```

The wrapper runs `docker run --rm <image> <URL>` and passes through the sidecar
exit code.
