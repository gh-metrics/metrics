# Metrics reliability experiments

Branch: `experiment/plugin-reliability-2026-10-30`

Based on `gh-metrics/metrics@0252603d89e89b96f0413c3cb6b0649b64387ba9`, in the user's fork. The original default branch and profile workflow are unchanged. No upstream pull request, secret changes, deployments, or production SVG updates are part of this experiment.

## Changes

- **Activity:** fetch pages and enrich events serially, stopping after the requested number of valid events. Filtering does not consume the display limit. Normalize nested comparison commit messages/authors, including null outer authors; reuse embedded commits when present. Explicit rate-limit responses get bounded backoff that honors server delays; ordinary permission errors are not retried. Repository pagination now sends page parameters.
- **16personalities:** prefer the current type-header name selector, retain the old selector as a fallback, wait for the public profile DOM, validate required values, and close the browser on success or failure.
- **Screenshot:** progressively scroll and activate native lazy loading; require real image dimensions and decode completion. Re-scan changing sources/new images, allow two quiet scans, and bound readiness to 30 seconds / 200 scroll steps. Failed, timed-out, and decode-failed images are counted separately from loaded images; at most ten redacted diagnostics are logged. A partial screenshot still returns, with an `images` readiness report. Signed request URLs are not rewritten. Navigation error/log URLs omit queries, fragments, and credentials. Browser cleanup runs in `finally`.

## Verified locally

On Node **20.20.2**:

- **44 focused regression tests passed:** activity 16, personality 18, screenshot 10. These import the changed source directly; browser-dependent cases use deterministic JSDOM fixtures and mocks.
- `npm run build` passed without generated-file drift.
- Full source `npm run linter`, contribution checks, changed-file dprint, and whitespace checks passed.
- Manual workflow YAML parses; the opt-in browser smoke script passes syntax checks.

The 300-push activity fixture now performs **one event-page fetch and five serialized comparisons**, not 300 concurrent comparisons. Tests also cover ignored authors, invalid events, order, pagination, retry exhaustion, and non-rate-limit 403s.

Screenshot fixtures cover a **1920×1080 model viewport**, eight slow covers, failed images, stalled decode, source replacement, appended nodes, bounded diagnostics/deadlines, listener cleanup, and signed-URL preservation/redaction. This is not a real-browser screenshot verification.

## Still unverified

Real Chromium could not start in the current executor because its local socket was denied by the sandbox. No real-browser render, visual PNG review, full Docker/Action/Web integration suite, live authenticated GitHub activity, secret-backed personality profile, or production workflow has been run with this patch. The exact cause of the original two blank HIMEHINA covers remains unproven.

The two quiet image scans are a bounded readiness heuristic, not a guarantee against arbitrary future website timers or virtualized content. Late changes beyond that settling window can still need site-specific handling.

## Run the focused checks

Use Node 20 and a fresh checkout of this branch:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run linter
npx --no-install jest --runInBand --testPathPattern='regression.test.js$'
```

## Close the real-browser verification gap safely

The branch version of `.github/workflows/test.yml` is intentionally **manual-only and isolated**. It builds this checkout's source, runs the focused tests, installs the matching Puppeteer browser, and tests cold native/intersection-observer lazy images at 1920×1080. Its token has only `contents: read`, it reads no repository secrets, and it uploads only test PNGs for seven days. It never runs the Metrics publishing action or pulls a prebuilt Metrics image.

If Actions are disabled in the new fork, enabling the test workflow is a user action; no repository settings were changed here. Use the existing **test.yml** workflow, select **`experiment/plugin-reliability-2026-10-30`**, then run it manually. Do not run **Continuous integration** or enable scheduled example publishing for this experiment. The original default-branch workflow names may be shown until GitHub refreshes them.

With a suitable local browser environment, the same isolated browser test can be run directly:

```sh
node node_modules/puppeteer/install.js
METRICS_ARTIFACT_DIR=/tmp/metrics-fixtures node tests/browser/screenshot.integration.mjs
```

Alternatively set `PUPPETEER_BROWSER_PATH` to an installed Chromium executable. The synthetic server is loopback-only and needs no credentials. The prepared browser test itself has **not yet run** in this executor.

The manual workflow also has an optional, default-off **public_examples** checkbox. This tests the public HIMEHINA releases section (`https://himehina.jp/`, selector `#himehina_grid > div:nth-child(5) > div`) at the original 1920×1080 viewport, and the public personality sample `https://www.16personalities.com/profiles/b7d9f29453ea5`. It obtains image URLs from the live DOM rather than hardcoding signed or expired URLs. The resulting HIMEHINA PNG is a test artifact, not a replacement profile output. These external pages can change or block automated browsers; any such failure should be inspected, not bypassed. Locally: `METRICS_ARTIFACT_DIR=/tmp/metrics-fixtures node tests/browser/public-examples.mjs`.

Experimental commits include `[skip ci]` to avoid inherited push-triggered spelling/comment automation. No workflow is automatically dispatched by this work. Preserve the focused code commits separately if proposing upstream changes later; the isolated branch workflow is an experimentation aid, not an upstream CI replacement.
