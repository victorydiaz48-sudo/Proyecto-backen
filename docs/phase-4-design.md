# Phase 4 design: real vision AI for the dealership vertical

Scope: replace `MockVisionProvider` with a real vendor behind the existing
`VisionProvider<VehicleAnalysis>` interface, for the dealership module only.
No other vertical, no image/video generation, no dashboard, no per-organization
credentials. Deliver the design, then stop for approval — same discipline as
every phase so far.

## 1. What already exists (recap, verified against the code, not memory)

Nothing about the shape of this feature is new — Phase 0–3 already built the
seams a real adapter plugs into:

- **The interface**: `VisionProvider<TOutput>` (`packages/providers/src/vision/types.ts`)
  — `analyze(input, opts): Promise<ProviderResult<TOutput>>`, generic since
  Phase 3b. `createDealershipVisionProvider(config)`
  (`packages/verticals/dealership/src/vision/registry.ts`) already branches
  on `config.MOCK_MODE` / `config.AI_API_KEY`; today the `else` branch just
  returns `UnconfiguredVisionProvider` with a "Phase 4" comment. That's the
  one call site this phase fills in — nothing else in `apps/worker` or
  `apps/server` needs to change.
- **The confidence policy** (`packages/providers/src/vision/policy.ts`):
  `VISION_POLICY`, `applyPolicy`, `text`/`oneOf`/`year` coercers — generic,
  reusable as-is.
- **The candidate → contract pipeline**
  (`packages/verticals/dealership/src/vision/normalize.ts`):
  `visionCandidateSchema` (lenient, what an adapter maps vendor output into)
  and `normalizeVisionOutput(raw, provider)` (applies the policy, recomputes
  `missing_information`, validates against `vehicleAnalysisSchema`, throws
  `ProviderResponseError` on a shape that isn't even candidate-like). A real
  adapter's whole job is: get the vendor to fill in something close to
  `visionCandidateSchema`, then hand it to this — already-tested — function.
- **The error taxonomy** (`packages/shared/src/errors.ts`):
  `ProviderAuthError` / `ProviderRateLimitError` / `ProviderTimeoutError` /
  `ProviderRefusedError` / `ProviderResponseError` / `ProviderNotConfiguredError`,
  and the queue's retry rule (`NonRetryableError` subclasses never retry;
  everything else does, up to `JOB_MAX_RETRIES`).
- **Cost accounting**: `UNIT_TYPES` already includes `1k_input_tokens` /
  `1k_output_tokens` (`packages/shared/src/cost.ts`); `computeCostMicros()` and
  `recordProviderCall()` already turn `ProviderResult.usage` into
  `GenerationLog` rows and `Usage` counters — this phase adds one new
  `APIProvider` catalogue row with real prices, nothing else.
- **The contract test**: `describeVisionProviderContract()`
  (`packages/verticals/dealership/src/vision/contract.ts`) — any new adapter
  must pass it unchanged.
- **The gap**: no HTTP/SDK client, no prompt content, and no vendor-error
  mapping exist yet anywhere in the repo. `PromptProvider`/`ResolvedPrompt`
  (`packages/verticals/core/src/prompts.ts`, `packages/providers/src/text/types.ts`)
  are typed but have zero implementations.

## 2. Vendor and approach

**Vendor: Claude, via the official `@anthropic-ai/sdk` TypeScript package.**
Credentials: the existing `AI_API_KEY` config var (already read, already
redacted from logs in `apps/server/src/main.ts`'s `secretsOf()`) — no new env
var.

**Structured output: `client.messages.parse()` with `output_config.format`
built from `visionCandidateSchema` via `zodOutputFormat()`.** This returns
`response.parsed_output` already validated against the Zod schema — no
tool-call JSON-parsing dance, no forced `tool_choice` (which is outright
rejected on some newer models). The photo goes in as a normal `image` content
block alongside the text instructions, in the same request. The adapter's job
shrinks to: build the request, call `.parse()`, and feed `parsed_output` into
the already-built `normalizeVisionOutput()`.

**Model: configurable per `APIProvider.config.model`, not hardcoded.**
`APIProvider.config` already exists precisely for "model, base URL, timeouts"
per its own schema comment, and is the field a future dashboard would edit.
My recommendation for the seeded default is **Claude Sonnet 5**
(`claude-sonnet-5`) — strong enough for structured vehicle-photo extraction,
at $2/$10 per MTok versus Opus's $5/$25; this is a per-photo classification
call, not agentic work, so the cheaper tier is the right default. This is a
cost/quality tradeoff that's yours to set, not mine — flagged as open
question 1 below.

## 3. New code, by package (none of it touches the worker or the bot)

**`packages/providers/src/text/anthropic.ts`** (new, core — no vehicle
content, so it's the piece Phase 5's copywriting reuses later):
a `TextGenerationProvider` implementation (the interface already declared in
`text/types.ts`) wrapping `@anthropic-ai/sdk`:
  - `generateStructured<T>(prompt: ResolvedPrompt, schema, opts)`: builds a
    `messages.parse()` call from `prompt.system`/`prompt.user`/`prompt.images`,
    passes `schema` through `zodOutputFormat()`, maps the response into
    `ProviderResult<T>` (`usage` from `response.usage.{input,output}_tokens`
    as `1k_input_tokens`/`1k_output_tokens` — Claude bills image tokens as
    input tokens, so no separate `image` unit line is needed for this
    vendor).
  - Constructed with an injected `Anthropic` client instance (not a bare
    `new Anthropic()` inside the class) so tests can substitute a fake —
    matches how `S3StorageProvider` etc. take their client as a constructor
    argument.
  - `opts.signal` passed through as the SDK call's `signal` request option;
    `client = new Anthropic({ apiKey, maxRetries: 0 })` — **deliberately
    zero SDK-level retries.** The job queue already retries the whole step
    with backoff (`ctx.attempt`/`JOB_MAX_RETRIES`); retrying twice at the SDK
    layer *and* again at the queue layer would double the backoff inside one
    job attempt's own timeout budget for no benefit.
  - Error mapping (see §4).

**`packages/verticals/dealership/src/vision/real.ts`** (new): the actual
`VisionProvider<VehicleAnalysis>` — thin. Resolves its prompt from a
`PromptProvider`, calls the injected `TextGenerationProvider.generateStructured()`
with `visionCandidateSchema`, and on a schema mismatch (`parsed_output` came
back `null`, or `normalizeVisionOutput` itself throws) does **one** internal
repair re-prompt — appends the validation error as a follow-up user turn
asking Claude to fix the specific fields — before giving up and throwing
`ProviderResponseError` (retryable, so the queue's own retry gets a fresh
attempt too). This matches the "one repair, then retried" line already in
`VisionProvider`'s doc comment.

**`packages/verticals/dealership/src/prompts.ts`** (new): implements
`PromptProvider`. One versioned prompt, `id: "dealership.vehicle-photo-analysis"`,
`version: "v1"`, per-locale `user` text (so free-text fields like color and
visible features come back in the requested language) and one shared
`system` text. Code-versioned (checked into git), not database-backed — a
prompt-editing dashboard is future work, not this phase's job.

**`packages/verticals/dealership/src/vision/registry.ts`** (modified): fills
in the `else` branch of `createDealershipVisionProvider()` — when
`AI_API_KEY` is set, construct the Anthropic client, the text provider, the
prompt provider, and `RealVisionAdapter`, and return it; falls back to
`UnconfiguredVisionProvider` only if the platform `APIProvider` row for this
adapter is missing or disabled (mirrors how the vision status is already
surfaced on `/health`).

**`packages/database/src/seed.ts` / `plans.ts`** (modified): one new
`PROVIDER_CATALOGUE` entry (adapter e.g. `claude-vision`, kind `VISION`) with
real `costConfig` — `1k_input_tokens` / `1k_output_tokens` priced from
Anthropic's published rates for the chosen model — replacing the free
`mock-vision` entry as the default once `AI_API_KEY` is set. (`mock-vision`
row stays; `MOCK_MODE` still selects the mock at runtime regardless of which
catalogue rows exist, unchanged.)

No file in `apps/worker`, `apps/telegram`, or `apps/server` changes except
`main.ts` continuing to call the same `createDealershipVisionProvider(config)`
it already calls — the whole point of the Phase 3 module boundary is that
this phase doesn't touch it.

## 4. Error mapping (Anthropic SDK → our taxonomy)

| Anthropic SDK / response | Our error | Retryable? |
|---|---|---|
| `Anthropic.AuthenticationError` (401) | `ProviderAuthError` | No |
| `Anthropic.PermissionDeniedError` (403) | `ProviderAuthError` | No |
| `Anthropic.RateLimitError` (429) | `ProviderRateLimitError` (with `retryAfterMs` from the `retry-after` header when present) | Yes (queue retry) |
| `stop_reason === "refusal"` | `ProviderRefusedError` (category/explanation from `stop_details`) | No |
| `parsed_output === null` / normalize throws, after one repair attempt | `ProviderResponseError` | Yes (queue retry) |
| `Anthropic.InternalServerError` (5xx), `overloaded_error` (529), `Anthropic.APIConnectionError` | plain `Error` (unmapped — genuinely transient) | Yes (queue retry) |
| `Anthropic.NotFoundError` (404, bad model id), `Anthropic.BadRequestError` (400) | left unmapped, thrown as-is | No practical retry helps — these are our own bugs (bad model id, malformed request), not vendor transients; no existing error class fits "our code is wrong," and inventing one isn't this phase's job |
| `opts.signal` aborted (job timeout) | `ProviderTimeoutError` | Yes (queue retry) |

Caught in a most-specific-first chain per the SDK's own typed exception
classes (never string-matching `error.message`).

## 5. Testing plan

1. **`AnthropicTextProvider` unit tests** — inject a fake `Anthropic` client
   (a plain object matching the two methods called), assert request shape,
   usage-to-`ProviderUsage` mapping, and every row of the error-mapping table.
   Zero network calls, runs in every CI build like everything else today.
2. **`RealVisionAdapter` contract test** — `describeVisionProviderContract()`
   run against the adapter with the same injected-fake pattern (canned
   `parsed_output` fixtures standing in for real vendor responses, including
   one fixture that fails validation to exercise the one-repair-then-throw
   path). No network; deterministic; runs in CI.
3. **Optional live smoke test** — gated by `LIVE_AI_TESTS=1` *and* a real
   `AI_API_KEY`, skipped by default (mirrors `TEST_DATABASE_URL`/
   `REQUIRE_DB_TESTS`). One real photo, one real call, asserted loosely
   (schema-valid, non-empty `make`). For manual/local verification before
   shipping, never required for CI to pass — it costs real money per run.

Gate for this phase, mirroring 3b's: `flow.e2e.test.ts` keeps injecting
`MockVisionProvider` (or a stub) exactly as today — the real adapter is
additive, proven by its own new tests, and never required for the existing
suite to stay green.

## 6. Explicitly out of scope for this phase

- Multi-image analysis (`VisionCapabilities.maxImagesPerCall` stays 1 for
  real, matching the existing "Phase 4 sends one image" comment).
- Per-organization API keys (`APIKeyReference` already supports this
  structurally; wiring it up needs a dashboard to manage it — Phase 6+).
- A database-backed, dashboard-editable prompt registry — this phase's prompt
  is code-versioned.
- Any other vertical (barbershop stays on its mock analyzer).
- Image/video generation, publishing — later phases per the sequencing we
  agreed.

## 7. Open questions for you to decide

1. **Model default**: I recommend `claude-sonnet-5` for cost/quality fit on a
   per-photo classification task, configurable later without a code change
   via `APIProvider.config.model`. Confirm, or name a different default.
2. **Rollout**: once built and merged, is flipping `MOCK_MODE=false` +
   setting `AI_API_KEY` on the deployed demo organization something you want
   to do immediately, or keep `MOCK_MODE=true` in production until you've
   reviewed real output quality on some test photos first?
3. **Budget interaction**: this phase adds real per-call spend for the first
   time. Given the open Phase 2 gap (no `monthlyCostCapMicros` enforcement),
   do you want that enforcement landed *before* this phase ships, so the very
   first real spend is already capped? (My prior recommendation was yes —
   repeating it here since this phase is what makes it matter.)
