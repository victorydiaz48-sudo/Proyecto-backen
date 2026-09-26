# Architecture

Status: **Phase 2 complete, Phase 3a and 3b complete.** The bot, database,
queue, worker and storage are wired together (Phase 2). The tenant concept is
`Organization` (renamed from `Dealership`) and dealership is now re-platformed
as the first vertical module on top of the `VerticalRegistry` (Phase 3a/3b) —
see [docs/phase-3-design.md](docs/phase-3-design.md) for the multi-vertical
design this implements, and §14 (rollout plan) for what's covered versus what's
still ahead (3c drops the now-redundant `vehicleId` columns once every write
path is proven on `subjectType`/`subjectId`; 3d scaffolds a second vertical to
prove genericity). `apps/api` and the dashboard come in later phases.

## Vertical modules (Phase 3a skeleton + Phase 3b dealership module)

`packages/verticals/core` defines the module contract every vertical
implements:

- `VerticalModule` — what a module registers: slug, config schema, entities,
  `WorkflowHooks`, content templates, routes, i18n message fragments, storage
  path segment.
- `WorkflowHooks<TAnalysis>` — the job-lifecycle contract
  (`onJobCreate`/`getStoredImage`/`storeImage`/`onAnalysisComplete`/
  `isSubjectUsable`/`generateCaption`/`formatSubjectForDisplay`/…) that
  `apps/worker/src/process-content-job.ts` now calls instead of any
  vehicle-specific logic inline — the worker shell has no import of, or
  knowledge about, `Vehicle`/`VehicleImage` any more.
- `VerticalRegistry` — holds the compiled-in modules, validated at
  construction (no duplicate slugs, no i18n key collisions across modules),
  dispatches by `Map` lookup only — never a `switch`/`if` keyed on a vertical
  name.
- `VerticalEnrollment` (table) + `loadBusinessProfile()`/`enrollOrganization()`
  — one vertical per organization, `vertical` is a plain string validated
  against the registry at write time (not a Prisma enum). `seed()` enrolls the
  demo organization in `dealership`.

`packages/verticals/dealership` (`@autocontent/verticals-dealership`) is the
first module: the vehicle-analysis schema, the mock/normalize/contract vision
pieces, the content-engine (caption generation), the automotive template
JSON, the module's own i18n fragment, and its `WorkflowHooks` implementation
all moved out of core packages into it. `apps/server/src/main.ts` is the only
place that imports it (core code only ever sees `VerticalModule`).

**Deliberately deferred to a later sub-phase** (documented, not silent):
- `Vehicle`/`VehicleImage` still live in the *core* `schema.prisma`, not a
  separate module schema fragment merged at build time — Prisma 7.10's
  native multi-file merge was spiked and confirmed working (3a), but the
  physical split waits for 3c, once `vehicleId` is actually dropped.
  `packages/database/src/ops/jobs.ts`'s `createTelegramContentJob()` still
  creates the `Vehicle` row directly for this reason (with a comment marking
  the spot `WorkflowHooks.onJobCreate` takes over in 3c).
- `ContentJob`/`ContentAsset`/`VideoPlan` carry `subjectType`/`subjectId`
  *alongside* `vehicleId` (additive migration, backfilled for existing rows)
  — dropping `vehicleId` is 3c.
- The vehicle REST contracts (`packages/verticals/dealership/src/
  contracts.ts`) are declared on `VerticalModule.routes` but not merged into
  the live core route table — no handler consumes any REST route yet.

## Phase 2 flow

```
Telegram ─update─▶ bot (apps/telegram)
                     │ rate limit per user (20/min)
                     │ TelegramAccount lookup  ── unknown → "private bot, ask for an invite"
                     │ SettingsService → settings snapshot (locale, limits, template)
                     │ tx + per-organization advisory lock:
                     │   duplicate? (idempotencyKey tg:{bot}:{chat}:{message}) → stop
                     │   daily / monthly limits (organization time zone) → refuse
                     │   Vehicle(DRAFT) + ContentJob(PENDING) + Usage JOBS_CREATED
                     │ enqueue { contentJobId, organizationId }   reply "🚗 Analizando…"
                     ▼
               queue "content-jobs" (BullMQ on Redis, or in memory)
                     ▼
worker (apps/worker) — each step checks the database first, so retries resume.
The shell is generic; every step below calls into the dealership module's
`WorkflowHooks` rather than touching `Vehicle`/`VehicleImage` directly:
  1 ingest    download from Telegram → validate bytes → StorageProvider
              organizations/{d}/vehicles/{v}/originals/{sha256}.{ext} →
              `workflow.storeImage()`
  2 analyse   `workflow.storeImage()` reuses an identical photo's analysis in
              the same organization (free), else VisionProvider →
              GenerationLog + Usage + job cost (charged once) →
              `workflow.onAnalysisComplete()` (Vehicle columns + provenance)
              `workflow.isSubjectUsable()` false → tell the user, archive, done
  3 copy      ContentAsset (job, instagram_caption, v1)  status QA_REVIEW until Phase 8
  4 deliver   analysis + caption (analysisDeliveredAt / deliveredAt)
  5 complete  COMPLETED exactly once → Usage VEHICLES_PROCESSED
  final failure → FAILED + lastError + one localized message
```

Startup (`apps/server`): migrations (container entrypoint) → `SELECT 1` →
idempotent seed → storage check → queue → worker (+ re-enqueue of
PENDING/PROCESSING/RETRYING jobs) → bot → HTTP (`/health`, `/ready`, webhook).
Without `DATABASE_URL` it stays up in degraded mode and the bot answers
"not configured".

Delivery is at-least-once: a crash between sending a Telegram message and
recording it can repeat that message on retry; it can never repeat a provider
call's charge.

## Target runtime

```
                 ┌──────────────┐   webhook/polling   ┌───────────────┐
Telegram ◀──────▶│ apps/telegram│───enqueue──────────▶│               │
                 └──────┬───────┘                     │    Redis      │
Browser ─▶ apps/web ─▶ apps/api ───enqueue───────────▶│   (BullMQ)    │
            (Next.js)   (REST, session auth)          └──────┬────────┘
                              │                             │ consume
                              ▼                             ▼
                        PostgreSQL ◀──────────────── apps/worker ──▶ providers
                        (Prisma)                            │   (vision, text, image,
                                                            ▼    video, Blotato)
                                                   S3-compatible storage
```

One Docker image. `SERVICE=api|worker|telegram|all` selects what runs; Railway
starts with a single `all` service plus the Postgres and Redis add-ons.

## Packages

| Package | Purpose | Status |
|---|---|---|
| `shared` | Vehicle analysis model (field provenance), i18n (es/pt/en), logger with secret redaction, typed errors, image validation, QA + VIDEO_PLAN schemas, money helpers, cost units | ✅ |
| `config` | Validated environment configuration | ✅ |
| `database` | Prisma schema, migrations, tenant-scoped client, settings snapshot, secret encryption, seed | ✅ Phase 1 |
| `queue` | `JobQueue` / `JobWorker` interfaces; in-memory and BullMQ (Redis) implementations, `createQueue()` | ✅ Phase 2 |
| `providers` | Provider interfaces (vision, text, image, video, storage, social, analytics), vision normalizer + contract suites, cost calculator, mock vision, **S3 + local-disk storage**, **Telegram adapters** | ✅ Phase 2 |
| `contracts` | REST API request/response schemas + route table → `docs/api/openapi.json` | ✅ Phase 1 |
| `templates` | 5 automotive templates, 15 content formats, 7 video styles (JSON, validated) | ✅ Phase 1 |
| `content-engine` | Publication policy + template caption (LLM copywriting in Phase 5) | Phase 0 |
| `ai`, `image-engine`, `video-engine` | Prompt registry, scene generation, reel engine | Phases 4–7 |
| `apps/telegram` | Bot (library): invite-only access, `/invite`, job creation; HTTP server | ✅ Phase 2 |
| `apps/worker` | Content-job processor (library) | ✅ Phase 2 |
| `apps/server` | Composition root: one image, `SERVICE=all\|telegram\|worker` | ✅ Phase 2 |
| `apps/api`, `apps/web` | REST API, dashboard | Phase 9 |

## Multi-tenancy

Tenant = **Organization**. Every business table has a required `organizationId`.
The boundary is enforced three times:

1. **Database.** Composite `(childId, organizationId) → parent(id, organizationId)`
   foreign keys (hand-written in the init migration, all named `tenant_*`):
   a row physically cannot reference another organization's row, even through
   the raw client. Tested against real PostgreSQL.
2. **Data access.** `forOrganization(prisma, id)` adds `organizationId` to every
   `where` and rejects creates/updates for any other organization.
3. **API.** The organization comes from the session. No endpoint accepts a
   `organizationId` (a test scans the OpenAPI document for it).

Platform-level exceptions: the provider catalogue (`APIProvider` rows with
`organizationId = NULL`) and platform API keys.

Roles, from most to least powerful:

| Capability | OWNER | ADMIN | EDITOR | OPERATOR |
|---|:-:|:-:|:-:|:-:|
| Billing, rename/delete organization, manage owners | ✓ | | | |
| Users, Telegram invites, API keys, integrations, settings, usage & audit | ✓ | ✓ | | |
| Edit vehicles/content/campaigns, approve, publish, retry jobs | ✓ | ✓ | ✓ | |
| Send photos, generate content, view jobs/content | ✓ | ✓ | ✓ | ✓ |

Each API route declares its minimum role in `packages/contracts/src/routes.ts`.
Telegram-only users get the role of the invite they used (default OPERATOR).
Telegram access is **invite-only**, via one-time `t.me/<bot>?start=<code>`
links created with `/invite [editor|admin]` (only the SHA-256 of a code is
stored; redemption is an atomic `uses < maxUses` update). The first OWNER
claims the demo organization with `BOOTSTRAP_CODE`, once (timing-safe compare,
serialised by an advisory lock). Nobody can create an OWNER through Telegram.

## Data model

Schema: `packages/database/prisma/schema.prisma`. Highlights:

- **Traceability**: every `ContentAsset` links to organization, vehicle and job
  (and through the job to the requesting user/Telegram account), plus
  `generationLogId` → provider, model, prompt id/version, latency, cost,
  timestamp; `status` and `qaReport` on the asset itself.
- **Idempotency** (a retried step can't duplicate work or charge twice):
  `ContentJob.idempotencyKey`, `ContentAsset(contentJobId, format, version)`,
  `GenerationLog.idempotencyKey`, `Publication.idempotencyKey`. `Usage` is
  incremented only together with a new `GenerationLog` row.
- **Money**: integer micro-USD (`BigInt`). Display currency is a per-organization
  setting; conversion only happens at the edges.
- **Secrets**: `APIKeyReference` either names an env var (`source=ENV`) or
  holds AES-256-GCM ciphertext (`source=DATABASE`) bound to its owner via
  authenticated data, with key versions for rotation. Only `last4` is ever
  shown.
- Actor columns (`…ById`) are plain UUIDs: users are disabled, never deleted.

## Organization settings → jobs

```
OrganizationSettings ─┐
Subscription        ├─ buildSettingsSnapshot() ─► ContentJob.settingsSnapshot ─► workers
Organization          ┘
```

- Language: Telegram user override → organization → `DEFAULT_LOCALE`.
- Limits: `min(plan, organization)` — an organization can tighten, never loosen.
- The snapshot is frozen at job creation so retries behave identically.
- Exception: publishing re-reads live settings and applies the **stricter**
  publishing mode (`stricterPublishingMode`), so switching auto-publish off
  takes effect immediately.
- `SettingsService` caches for 60 s; editing settings invalidates the cache.

## Job queue

```ts
JobQueue<P>  { enqueue(payload, { jobId, delayMs? }) → { jobId, duplicate }; getState(jobId); close() }
JobWorker<P> { process(handler, { concurrency, onFinalFailure }); close() }
```

- Retries: `JOB_MAX_RETRIES` (default 3, i.e. up to 4 attempts), backoff
  2 s → 4 s → 8 s. `NonRetryableError` subclasses (bad image, missing
  credentials, auth/refusal errors) fail immediately.
- Phase 2 BullMQ mapping: `enqueue` → `queue.add(name, data, { jobId, attempts,
  backoff })`; duplicates decided by the `ContentJob.idempotencyKey` insert;
  `NonRetryableError` → `UnrecoverableError`; the final-failure handler runs
  inside the processor on the last attempt; stalled jobs are safe to re-run
  because every step checks the database first. Payloads shrink to
  `{ contentJobId, organizationId }`.
- "🔥 Todo" becomes a BullMQ flow: `finalize` parent with `copy` / `image` /
  `video` children; a failed child doesn't fail the parent (graceful
  degradation, `PARTIALLY_COMPLETED`).

## Providers

Every provider implements `TestableProvider` (`name`, `kind`,
`testConnection()` that never spends credit) and receives
`ProviderCallOptions` (`jobId`, `organizationId`, `idempotencyKey`, abort
`signal`, `logger`). Calls return `ProviderResult<T>` with **usage, not
money**; `computeCostMicros(APIProvider.costConfig, usage)` prices it, so
prices are configuration.

### VisionProvider (what a Phase 4 adapter must implement)

```ts
interface VisionProvider {
  name: string; kind: 'VISION';
  capabilities(): { supportedMimes; maxImageBytes; maxImageDimension; maxImagesPerCall; localizedFreeText };
  analyze(input: { images: VisionImage[]; locale; knownFacts? }, opts: ProviderCallOptions)
    : Promise<ProviderResult<VehicleAnalysis>>;
  testConnection(opts?): Promise<ProviderStatus>;
}
```

Rules (full text in `packages/providers/src/vision/types.ts`):
build output with `normalizeVisionOutput()` (shared confidence policy:
detected < 0.6 → inferred, inferred < 0.4 → unknown, impossible years
dropped, `missing_information` recomputed); set `subject` honestly
(`not_vehicle` / `multiple_vehicles` / `unclear` stop the job before any
further spend); never output user-only facts; prompts from the versioned
registry; throw the typed errors below; honour the abort signal; pass
`describeVisionProviderContract()`.

| Error | Retried? |
|---|---|
| `ProviderAuthError` | no (provider marked ERROR) |
| `ProviderRateLimitError` | yes |
| `ProviderTimeoutError` | yes |
| `ProviderResponseError` | one repair re-prompt, then yes |
| `ProviderRefusedError` | no |
| `ProviderNotConfiguredError` | no |

Other interfaces: `TextGenerationProvider.generateStructured(prompt, zodSchema)`,
`ImageGenerationProvider.transform({ source, scene, preserve[] })`,
`VideoGenerationProvider.submit / getStatus / parseWebhook` (async),
`StorageProvider` (keys always `organizations/{id}/…` via `storageKey()`),
`SocialPublishingProvider` (Blotato first; per-organization credentials; callers
enforce the publishing mode), `AnalyticsProvider`.

## API

REST under `/api/v1`, cookie session (`sid`, httpOnly, Secure, SameSite=Lax),
argon2id passwords, Origin check on mutations. Errors:
`{ error: { code, message, details? } }`. Cursor pagination. Money as
micro-USD strings. URLs accepted from clients must be http(s).

Full contract: `packages/contracts/src/routes.ts` →
[`docs/api/openapi.json`](docs/api/openapi.json) (regenerated by
`pnpm --filter @autocontent/contracts generate:openapi`; a test fails if it's
stale).

## Templates

`packages/templates/automotive/<slug>/template.json`: metadata, tone (incl.
things to avoid), prompt guidance, copy strategy, scene structure, CTA
strategy with es/pt/en examples, formats and allowed video styles. Formats
(`formats.json`) and video styles (`video-styles.json`) are catalogues;
templates reference them by id and are cross-checked at load.

## Storage

`createStorageProvider(config)`: S3-compatible (`STORAGE_*`, e.g. Cloudflare
R2) when configured, otherwise local disk (`STORAGE_LOCAL_DIR`, reported as
`durable: false`). Keys always start with `organizations/{id}/`; objects are
private; access via short-lived signed URLs (HMAC-signed for local disk).
Both adapters pass `describeStorageProviderContract()` (S3 is tested against
an in-process S3 server).

## Deployment

`apps/server/Dockerfile` → one self-contained ESM bundle (Prisma client and
its WASM query compiler included) + the Prisma CLI for migrations.
`docker/start.sh` runs `prisma migrate deploy`, then the app, as the
unprivileged `node` user. `railway.json` points Railway at it with `/health`
as health check. `docker-compose.yml` runs app + PostgreSQL + Redis locally.

## Security (so far)

- Webhook secret verification (401 without the header) — Phase 0
- File type from magic bytes, size and dimension limits, streamed download cap
- Secrets never logged (redaction) and never echoed in config errors
- Tenant isolation at DB + data-access + API layers
- Encrypted credentials at rest (AES-256-GCM, owner-bound, rotatable)
- http(s)-only URLs in API input
- Invite-only Telegram access; per-user rate limit; hashed single-use invite
  codes; one-time bootstrap
- Connection-string passwords, storage secret and bootstrap code redacted
  from logs

## Logging

JSON lines on stdout with `jobId`, `attempt` and an `event`
(`JOB_STARTED`, `IMAGE_RECEIVED`, `IMAGE_ANALYZED`, `COPY_GENERATED`,
`JOB_RETRYING`, `JOB_COMPLETED`, `JOB_FAILED`, …). Vision logs include model,
usage and latency.
