# Metrics reliability experiments

Branch: [`experiment/plugin-reliability-2026-10-30`](https://github.com/rakuzen25/metrics/tree/experiment/plugin-reliability-2026-10-30)

Based on `gh-metrics/metrics@0252603d89e89b96f0413c3cb6b0649b64387ba9`. Work is confined to the user's Metrics fork and a separate profile-repository test branch. Neither repository's default branch was changed. No upstream PR, production gist update, deployment, new secret, or repository-setting change is part of this experiment.

## Changes

- **Activity:** fetch pages and enrich events serially, stopping after the requested number of valid events. Filtering does not consume the display limit. Normalize nested comparison messages/authors, including null outer authors, and reuse embedded commits when present. Explicit rate-limit responses get bounded backoff honoring server delays; ordinary permission errors are not retried. Repository pagination sends page parameters. When modern PushEvents omit `size`, use the comparison's full `total_commits`, with a commit-array fallback before filtering.
- **16personalities:** prefer the current type-header name selector, retain the old selector as a fallback, wait for profile readiness, validate required fields/five traits, and close the browser in `finally`.
- **Screenshot input wiring:** the real metadata parser turns `plugin_screenshot_lazy_load` into **`lazy.load`**, not `lazy_load`. The old destructuring silently disabled lazy readiness in the actual Action even when its input log said `true`. Read the real dotted key. A parser-backed plugin regression covers enabled and disabled paths; an old-key mutation fails it.
- **Screenshot readiness:** progressively scroll, activate native lazy loading, require nonzero natural dimensions and successful decoding, and rescan changing sources/new images. Bound readiness to 30 seconds/200 scroll steps; report failed, timed-out and decode-failed images rather than counting errors as successes. Keep signed request URLs unchanged and redact diagnostic queries, fragments and credentials. A partial screenshot still returns with bounded warnings and an `images` readiness report.
- **Screenshot capture:** reset the scroll origin, wait two animation frames within a bounded timeout, remeasure the document-space clip, capture, then restore scrolling. This preserves the requested viewport and CSS while addressing an independently reproduced initial offscreen-paint omission. Always close the browser.

## Tests and evidence

### Local source checks

Node **20.20.2**:

- **54 focused tests:** activity 19, personality 18, screenshot readiness/metadata 11, capture origin 5, crop-validation 1.
- Source build, full source ESLint, contribution check, changed-file formatting and whitespace checks pass.
- The 300-push fixture makes one event-page fetch and five serial comparisons, not 300 simultaneous comparisons. Tests cover filtering, newest-first order, pagination, null authors, ignored emails, missing counts, server retry delays, exhaustion, and ordinary non-rate-limit 403s.
- Slow/broken-image fixtures cover source replacement, appended nodes, stalled decode, bounded deadlines/diagnostics, listener/browser cleanup, and signed-URL preservation.

### Real-environment experiment

The profile-repository branch is [`experiment/metrics-fork-real-env-2026-10-30`](https://github.com/rakuzen25/rakuzen25/tree/experiment/metrics-fork-real-env-2026-10-30). Its workflow is **Metrics fork experiment (artifact only)**. It tests the fork source in the normal Docker/Actions runtime rather than an upstream prebuilt image.

The first full run exposed integration gaps that mocked tests missed: a blank push count and the dotted lazy-load input key. Artifact inspection also caught a faulty pixel check: Sharp's `stats()` reads original input pixels, ignoring queued crop operations. The corrected shared validator **materializes each crop before computing statistics**. A synthetic negative test and all three earlier bad artifacts fail correctly; all four visually good diagnostic captures pass.

The [metadata-fix run](https://github.com/rakuzen25/rakuzen25/actions/runs/41113504335) passed with source `2992f606898b0fdba1848f3e563db2ae383e9ffe`. Its actual Action SVG was downloaded and visually inspected: all eight HIMEHINA covers are present. The corrected materialized-crop validator passes every cover (individual variation 53.8–82.4). Activity includes the push count/message; the personality output includes all five traits.

**Final strict-gate run passed:** [run 41114068955](https://github.com/rakuzen25/rakuzen25/actions/runs/41114068955), using exact fork commit `314bb85064c2cb53e3bc8a79df52d61a65c84933` and profile test commit `cef6db46c49a5365382021ffae4f389332286efd`. It passed all 54 focused tests, the real Chrome fixtures, three cold public captures, four Action renders, and the corrected actual-cover pixel gate. Downloaded SVG/PNG artifacts were independently checked and visually inspected: all eight release covers are present, with separate per-cover variation scores 61.92, 79.03, 79.36, 53.83, 63.85, 79.33, 82.37 and 56.08. Earlier green runs did **not** prove that every cover rendered.

The run summary contains `metrics-fork-experiment-41114068955` (four SVGs and four PNG previews) and `metrics-public-diagnostics-41114068955` (public captures and redacted diagnostics). GitHub retention expires these artifacts on **2026-11-02 UTC**; the code, workflow and logs remain in the experimental repositories.

The real-browser harness exercises:

- Chrome at **1920×1080**, cold native/intersection-observer lazy images with delayed responses, two failed images, stalled decode, and actual sampled pixels.
- Three fresh public HIMEHINA captures, checking all eight covers' layout and painted pixels.
- Actual Actions rendering of public GitHub activity, the existing secret-backed personality profile, HIMEHINA Info, and HIMEHINA New Releases.
- Separate per-cover checks on the **actual Action's embedded screenshot PNG**, plus complete SVG PNG previews for visual inspection.

The HIMEHINA crop assertions are intentionally website-specific (current 325×1209 block, eight colorful covers). A website layout/artwork change should fail for inspection, not be silently accepted.

## Isolation and reruns

The profile experiment has an exact repository/branch guard, no schedule or keepalive, and only `contents: read` for `GITHUB_TOKEN`. Every Metrics invocation uses `output_action: none`, empty gist/committer/cleanup inputs, explicit experimental filenames, and the exact fork commit. It reuses existing service secrets only for their original services; no secret values are inspected.

A clean source image is built **before** service secrets are passed. The workflow verifies its source-SHA label and absence of `.env`; the Action then reuses that image. This avoids baking the wrapper's later secret `.env` into an image. No image, checkout, `.env`, raw private JSON, or workspace is uploaded.

Artifacts contain only the named SVGs, their PNG previews, and public-page diagnostic images/redacted JSON, retained for three days. Preview containers have networking disabled and allow only the four exact SVG file URLs and embedded images; document JavaScript is disabled.

To rerun, use the profile experiment workflow with this exact branch. Do **not** run the production/default-branch workflow for this test. The original production schedule and gist destination remain unchanged on `main`.

The fork also retains a separate manual-only `.github/workflows/test.yml` for secret-free synthetic/public smoke tests; enabling fork Actions, if disabled, remains a user action. No repository settings were changed. Experimental fork commits use `[skip ci]` to avoid inherited push-triggered comment/spelling automation.

## Local commands

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run linter
npx --no-install jest --runInBand --testPathPattern='regression.test.js$'
```

With an authorized local Chromium environment:

```sh
# PUPPETEER_BROWSER_PATH can identify an already installed browser.
node tests/browser/screenshot.integration.mjs
METRICS_ARTIFACT_DIR=/tmp/metrics-public node tests/browser/himehina.capture.mjs
```

No browser was launched successfully in the assistant's local sandbox; real Chromium evidence comes from GitHub Actions. The complete unrelated plugin suite and production publishing workflow were not run. Live secondary-limit exhaustion was not deliberately provoked; its retry behavior is covered by deterministic tests. Two quiet scans and two paint frames are bounded readiness heuristics, not guarantees against arbitrary future website timers or virtualization.
