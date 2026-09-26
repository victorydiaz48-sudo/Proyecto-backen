# Phase 3 design: core + vertical modules

Status: **design document, not yet approved.** No code, schema, or migration
changes are included. This mirrors the audit performed against the actual
repository at commit `8af9e29` (branch `claude/automotive-content-automation-9rc90v`),
not from memory — every file/line reference below was read directly.

---

## 1. Audit of the current architecture

Everything below is dealership-coupled today, organized by layer.

### 1.1 Database schema (`packages/database/prisma/schema.prisma`)

| Object | Coupling |
|---|---|
| `Dealership` model | Tenant root, named after the vertical |
| `DealershipStatus` enum | Fine generically, just named after the vertical |
| `DealershipSettings.defaultTemplateSlug` default `"premium-dealership"` | Vertical-specific default baked into core settings |
| `Vehicle` model (23 columns: `make`, `model`, `version`, `year`, `color`, `bodyType`, `segment`, `mileageKm`, `vin`, `stockNumber`, `financingNotes`, …) | 100% dealership domain object, sitting in core schema |
| `VehicleImage` model | Same — this is really "the one media asset that seeds a content job," but modeled as vehicle-only |
| `BodyType` enum (10 values: SEDAN, HATCHBACK, SUV…) | Vehicle taxonomy in core schema |
| `Segment` enum (ECONOMY, MID_RANGE, LUXURY, SPORT…) | Vehicle market segment in core schema |
| `ContentJob.vehicleId` (required FK) | **Core pipeline entity hard-references the vertical entity.** This is the deepest coupling point — a job cannot exist without a vehicle. |
| `ContentAsset.vehicleId` (required FK) | Same |
| `VideoPlan.vehicleId` (required FK) | Same |
| `UsageMetric.VEHICLES_PROCESSED` | Vertical-specific metric name baked into a core enum |
| Every `…dealershipId` column (19 tables) | Correct concept (tenant id), wrong name for a generic platform |
| `TelegramAccount`, `TelegramInvite` | Fine — Telegram is a core channel, not vertical-specific. Just carries `dealershipId` naming. |
| `Campaign`, `APIProvider`, `APIKeyReference`, `PublishingAccount`, `Publication`, `GenerationLog`, `Usage`, `AuditLog`, `Session`, `User`, `Subscription` | **Already generic.** No vertical concept inside them beyond the `dealershipId` tenant column name. |

### 1.2 Shared domain model (`packages/shared/src`)

| File | Coupling |
|---|---|
| `vehicle.ts` — `vehicleAnalysisSchema`, `BODY_TYPES`, `SEGMENTS`, `ANALYSIS_FIELDS = ['make','model','version','year','color','body_type','estimated_segment']` | **The core AI output contract is a fixed vehicle schema.** Every vision provider, the worker, the caption engine, and the bot's display formatter import this one shape. This is the single hardest piece to generalize (flagged in §11). |
| `jobs.ts` — `ContentJobPayload { contentJobId, dealershipId }` | Field name only; the shape itself is already generic |
| `cost.ts`, `qa.ts`, `video-plan.ts`, `money.ts`, `logger.ts`, `errors.ts`, `image.ts`, `html.ts`, `ids.ts` | **Already generic.** No vertical concept. |
| `i18n.ts` — `Messages.labels.bodyType`, `.segment`; `Messages.bodyTypes: Record<BodyType,...>`; `Messages.segments: Record<Segment,...>`; `Messages.missingFields: Record<MissingField,...>` (make/model/version/year/color/body_type/estimated_segment/price/mileage/…) | Vertical-specific message shape hardcoded into the core i18n interface, in all three locales (es/pt/en) |
| `i18n.ts` — `Messages.notAVehicle`, `.multipleVehicles`, `.unclearPhoto`, `.access.*` | `notAVehicle`/`multipleVehicles` are vehicle-specific; `access.*` (invite/bootstrap copy) is core |

### 1.3 Providers (`packages/providers/src`)

| File | Coupling |
|---|---|
| `vision/types.ts` — `VisionProvider.analyze(): Promise<ProviderResult<VehicleAnalysis>>` | Return type is the vehicle schema. The *interface shape* (capabilities/analyze/testConnection, typed errors, abort signal, usage reporting) is generic and reusable; only the payload type is not. |
| `vision/normalize.ts` — `normalizeVisionOutput()`, `VISION_POLICY` (confidence thresholds), `visionCandidateSchema` | The **policy** (detected<0.6→inferred, inferred<0.4→unknown) is generic. The **candidate schema fields** (`make`, `model`, `body_type`, `estimated_segment`) are vehicle-specific. Mixed file. |
| `vision/mock.ts` — 6 hardcoded car samples (Toyota Corolla, BMW X5, Ford Ranger, VW hatchback…) | Entirely vehicle-specific |
| `vision/contract.ts` — `describeVisionProviderContract()` | Test helper; assertions reference `USER_ONLY_FIELDS`, vehicle field names |
| `storage/types.ts` — `storageKey(dealershipId, ...segments)` | Function itself is generic (tenant-prefixed path builder); every call site hardcodes `'vehicles'` as the first segment |
| `text/types.ts`, `image-generation/types.ts`, `video-generation/types.ts`, `social/types.ts`, `analytics/types.ts`, `telegram/types.ts`, `status.ts`, `types.ts`, `cost.ts` | **Already generic.** `ImageTransformInput.preserve: IdentityTrait[]` (body_shape, wheels, headlights, grille…) in `image-generation/types.ts` is vehicle-flavored but not yet wired to anything (Phase 6 is unbuilt) — low risk, easy rename. |

### 1.4 Content engine (`packages/content-engine/src`)

| File | Coupling |
|---|---|
| `publishable.ts` — `INFERRED_ALLOWED_IN_COPY = ['make','model','body_type','estimated_segment']` | Vehicle field names |
| `caption.ts` — hooks keyed by `Segment` (car market segment), fallback title "Vehículo disponible", hashtag `#AutosEnVenta`/`#CarrosAVenda`/`#CarsForSale` | 100% dealership copy, in all three locales |

**Entire package is dealership-specific.** Nothing here is core.

### 1.5 Templates (`packages/templates`)

`automotive/{cinematic-luxury,aggressive-sport,premium-dealership,fast-sale,minimalist}/template.json`,
`automotive/formats.json`, `automotive/video-styles.json`. The **schema**
(`schema.ts`: tone, prompt guidance, copy strategy, scene structure, CTA
strategy, format/video-style references) is generic template metadata — it
doesn't mention vehicles. The **content** (`IMAGE_SCENES = ['premium-studio',
'urban-night', 'highway', 'showroom', 'cinematic-road']`, five car-dealership
templates) is vertical data. Directory name `automotive/` is the coupling.

### 1.6 Worker (`apps/worker/src/process-content-job.ts`)

The deepest logic coupling in the codebase:
- `vehicleUpdateFromAnalysis()` — hardcoded `make`/`model`/`version`/`year`/`color`/`body_type`/`estimated_segment` → Prisma column mapping
- `db.vehicle.findFirst/update/upsert`, `db.vehicleImage.*` calls inline in the main job-processing function
- `storageKey(dealershipId, 'vehicles', job.vehicleId, ...)`
- `job.vehicle.provenance`, `job.vehicleId` accessed directly off `ContentJob`
- Analysis-reuse-by-identical-photo logic queries `vehicleImage` directly
- `CAPTION_FORMAT = 'instagram_caption'` and the one hardcoded asset format

This file **is** the dealership vertical's ingest→analyze→caption→deliver
pipeline, currently living in `apps/worker` as if it were the only pipeline
that could ever exist.

### 1.7 Database operations (`packages/database/src/ops`)

| File | Coupling |
|---|---|
| `jobs.ts` — `createTelegramContentJob()` creates `tx.vehicle.create()` **and** `tx.contentJob.create()` together, hardcodes `requestedFormats: ['instagram_caption']`, counts `monthlyVehicleLimit` against `tx.vehicle.count()` | Core job-creation function directly instantiates the vertical entity |
| `jobs.ts` — `CreateJobResult` includes `vehicleId`; `limit: 'monthly_vehicles'` | Vertical-specific field/name in an otherwise generic result type |
| `telegram.ts` — `claimBootstrap`, `createTelegramInvite`, `redeemTelegramInvite`, `canInvite`, `effectiveRole`, `findTelegramAccount` | **Already generic.** No vertical concept. |
| `time.ts`, `settings.ts` (minus the `defaultTemplateSlug` default), `crypto.ts`, `plans.ts`, `tenant.ts`, `client.ts`, `json.ts` | **Already generic.** |
| `seed.ts` — `DEMO_DEALERSHIP_SLUG = 'demo'`, `name: 'Concesionario Demo'`, `PROVIDER_CATALOGUE` includes `mock-vision` | Naming only; the seeding *mechanism* is generic |

### 1.8 Telegram bot (`apps/telegram/src/bot.ts`)

Reads as **structurally generic** — it operates on `dealershipId`,
`TelegramAccount`, roles, invites, rate limiting, settings snapshots. The only
vehicle-specific things it does: calls `createTelegramContentJob` (§1.7,
which itself is coupled) and hardcodes `requestedFormats: ['instagram_caption']`
indirectly through that call. `formatAnalysis()` (§1.9) — imported and sent
verbatim — is 100% vehicle display logic.

### 1.9 Worker display (`apps/worker/src/format.ts`)

`formatAnalysis()` renders `a.make.value`, `a.model.value`, `a.body_type`,
`a.estimated_segment`, `🚗` emoji, "Vehículo no identificado" fallback.
Entirely vehicle-specific; it is the only place that turns a `VehicleAnalysis`
into bot-facing text before publishing.

### 1.10 API contracts (`packages/contracts/src`)

| File | Coupling |
|---|---|
| `resources.ts` — `vehicle`, `vehicleListQuery`, `vehiclePatch` schemas; `usageSummary.vehiclesProcessed` | Vehicle-specific resource + one vertical-specific metric name in an otherwise generic summary object |
| `routes.ts` — `vehicles.list/get/update` (3 of 31 routes) | Vehicle-specific routes |
| Everything else (auth, dealership, settings, users, telegram, jobs, assets, templates, campaigns, publishing, integrations, api-keys, usage, audit, system) | **Already generic** — `jobCreate`/`job`/`asset`/`campaign`/etc. never reference vehicle fields. `jobs.get`/`jobs.create` etc. reference `vehicleId` only inside the `job`/`jobCreated` response indirectly through IDs — no vehicle fields leak into the job resource itself. |

### 1.11 Tests

21 test files, 136+ assertions. Concentration of vehicle-specific fixtures:
`packages/providers/src/vision/*.test.ts` (mock samples, contract assertions),
`packages/content-engine/src/caption.test.ts`, `apps/worker` (none directly —
worker has no dedicated test file today; it's exercised through
`apps/server/src/flow.e2e.test.ts`), `apps/server/src/flow.e2e.test.ts` (every
scenario sends a photo and asserts on `job.vehicle.make`, caption text,
storage keys under `vehicles/`). `packages/database/src/ops/ops.db.test.ts`
asserts on `createTelegramContentJob`'s `vehicleId` return and
`monthly_vehicles` limit result.

---

## 2. Coupling map

Legend: **(a)** core, rename/generalize · **(b)** dealership-specific, moves to module · **(c)** ambiguous, needs your input.

| Item | Class | Notes |
|---|---|---|
| `Dealership` model, `DealershipStatus`, `dealershipId` columns (19 tables) | **(a)** | → `Organization`, `OrganizationStatus`, `organizationId` |
| `DealershipSettings` (minus `defaultTemplateSlug` default) | **(a)** | Generic settings row; default template becomes module-supplied |
| `TelegramAccount`, `TelegramInvite`, bootstrap/invite logic | **(a)** | No changes beyond the FK column rename |
| `User`, `Session`, `Subscription`, `Campaign`, `APIProvider`, `APIKeyReference`, `PublishingAccount`, `Publication`, `GenerationLog`, `Usage` (minus `VEHICLES_PROCESSED`), `AuditLog` | **(a)** | Already vertical-agnostic |
| `ContentJob` core columns (id, idempotencyKey, source, telegramAccountId/chatId/fileId/messageId, status, stage, settingsSnapshot, cost/attempts/error columns) | **(a)** | Generic job envelope |
| `ContentJob.vehicleId` (FK) | **(b)→(a) shape, (b) content** | Becomes a polymorphic/optional link to a **module-owned subject entity** — see §3. The *mechanism* (a job points at "the thing it's about") is core; *what that thing is* is per-module. |
| `Vehicle`, `VehicleImage` models, `BodyType`, `Segment` enums | **(b)** | Move wholesale into the `dealership` module's own schema |
| `ContentAsset.vehicleId`, `VideoPlan.vehicleId` | **(b)→(a) shape** | Same pattern as `ContentJob.vehicleId` |
| `UsageMetric.VEHICLES_PROCESSED` | **(b)** | Becomes module-defined; core keeps a generic `SUBJECTS_PROCESSED` or lets modules register their own metric names (§8) |
| `vehicleAnalysisSchema`, `BODY_TYPES`, `SEGMENTS`, `ANALYSIS_FIELDS`, `USER_ONLY_FIELDS` (`packages/shared/src/vehicle.ts`) | **(b)** | Moves to the dealership module. Core keeps the **generic tagged-value primitive** (`Tagged<T>`, `FieldSource`, `taggedSchema`) — those have zero vehicle content already. |
| `PHOTO_SUBJECTS`, `IMAGE_QUALITY_ISSUES` | **(c)** | These describe "is this photo usable" — plausibly reusable by any photo-driven vertical (real_estate, retail product photos, restaurant dishes), but currently defined inside `vehicle.ts` next to vehicle fields. **Your call:** promote to a generic "media intake" concern in core, or leave as a dealership-module convention that other modules copy? I lean toward promoting (see §11), flagging for your decision. |
| `VisionProvider` interface *shape* (capabilities/analyze/testConnection, typed errors, abort signal, usage) | **(a)** | Generalize to `VisionProvider<TOutput>` or keep concrete but move the output type to a module-supplied generic parameter |
| `VisionProvider.analyze()` return payload (`VehicleAnalysis`) | **(b)** | Becomes module-defined via generics/registry (§7) |
| `normalizeVisionOutput()` **policy** (confidence thresholds, clamping) | **(a)** | Generalize to work over an arbitrary tagged-field record |
| `normalizeVisionOutput()` **candidate schema** (`make`/`model`/`body_type`/…) | **(b)** | Moves to module; core exposes the generic tagging/clamping helpers for modules to call |
| `mock.ts` (6 car samples), `contract.ts` (vehicle-specific assertions) | **(b)** | Move to module; core keeps a *generic* provider-contract test harness shape that any module can instantiate with its own output schema |
| `storageKey()` function | **(a)** | Already generic; only call sites hardcode `'vehicles'` |
| `ImageTransformInput.preserve: IdentityTrait[]` (body_shape/wheels/headlights…) | **(b)** | Unbuilt (Phase 6). Rename to a generic `string[]` of identity constraints the module defines |
| `packages/content-engine` (entire package) | **(b)** | Moves to the dealership module wholesale |
| `packages/templates/automotive/*` (5 templates, formats, video styles) | **(b)** | Moves to the dealership module. Template **schema** (`schema.ts`) is **(a)** — generic enough already (no vehicle fields), stays in core as the contract every module's templates must satisfy |
| `apps/worker/src/process-content-job.ts` | **(b)→(a) shell** | The *pipeline shell* (ingest→analyze→copy→deliver→complete, idempotency, retry, cost logging) is core-shaped. The *vehicle-specific steps inside it* (`vehicleUpdateFromAnalysis`, direct `vehicle`/`vehicleImage` table access) move to the module. See §6 for how a module plugs into this shell. |
| `apps/worker/src/format.ts` (`formatAnalysis`) | **(b)** | Module-owned rendering |
| `createTelegramContentJob()` | **(b)→(a) shell** | Splits into a generic "create job for this Telegram message" core function that delegates "create/find the subject entity" to the active module |
| `packages/contracts` — `vehicle`/`vehicleListQuery`/`vehiclePatch`, `vehicles.*` routes | **(b)** | Move to module; module registers its own routes (§6/§9) |
| `packages/contracts` — everything else (31−3 routes) | **(a)** | Stays in core untouched |
| `i18n.ts` — `bodyTypes`, `segments`, `missingFields` (vehicle keys), `labels.bodyType/segment`, `notAVehicle`/`multipleVehicles` | **(b)** | Module-owned message fragments, merged into the core `Messages` at runtime (§7) |
| `i18n.ts` — everything else (`access.*`, `welcome`, `help`, image-validation errors, `mockNotice`, `captionIntro`, `sources`) | **(a)** | Core, unchanged |
| `DEMO_DEALERSHIP_SLUG`, `'Concesionario Demo'`, seed's default template slug | **(c)** | Renaming is straightforward **(a)**, but *which vertical the demo org defaults to* is a product decision — does `pnpm seed` still create a demo dealership by default, or a generic empty org, or prompt? **Your call**, flagged in §14 rollout. |

---

## 3. New CORE design

### 3.1 Entity relationship overview

```
Organization (was Dealership)
 ├─ OrganizationSettings (was DealershipSettings; drops defaultTemplateSlug default)
 ├─ Subscription
 ├─ VerticalEnrollment ── which vertical module(s) this org runs, config
 ├─ User[] ── Session[]
 ├─ TelegramAccount[] ── TelegramInvite[]
 ├─ ContentJob[] ──┬─ subjectType, subjectId  (polymorphic, see §3.2)
 │                 ├─ ContentAsset[]
 │                 ├─ VideoPlan[]
 │                 ├─ GenerationLog[]
 │                 └─ Publication[]
 ├─ Campaign[]
 ├─ APIProvider[] ── APIKeyReference[]
 ├─ PublishingAccount[]
 ├─ Usage[]
 └─ AuditLog[]
```

`Vehicle`/`VehicleImage` disappear from this diagram entirely — they live in
the dealership module's own tables, referenced by `ContentJob.subjectId` but
never joined by core code.

### 3.2 The `ContentJob` subject problem

This is the one place core must reference "the thing a job is about" without
knowing what that thing is. Three options, with a recommendation:

**Option A — polymorphic loose reference (recommended).**
`ContentJob` gains `subjectType: String` (module-namespaced, e.g.
`"dealership.vehicle"`) and `subjectId: String @db.Uuid`, with **no foreign
key**. Tenant isolation is preserved because the module's own table
(`Vehicle.dealershipId` → renamed `organizationId`) still carries and enforces
the tenant column and the composite `(id, organizationId)` uniqueness; core
just doesn't get a compile-time-checked join. Loss: the database can no longer
enforce "this job's subject really exists and belongs to the same org" — that
check moves into an application-level invariant, enforced by the one function
that creates jobs (§6) and by a periodic integrity check (deferred; not
in-scope for Phase 3).

**Option B — one core "Subject" table modules attach to.**
Core defines `ContentSubject(id, organizationId, kind, createdAt)`; every
vertical entity (`Vehicle`, future `Property`, `MenuItem`) has a 1:1 FK to a
`ContentSubject` row, and `ContentJob.subjectId` FKs to `ContentSubject`. This
restores a real foreign key and tenant-checked join at the cost of every
module needing to create a shadow row for every entity it wants jobs about,
and a join hop to get from a job to the module's actual data.

**Option C — keep it dealership-only for now, revisit later.**
Leave `ContentJob.vehicleId` as-is (required FK to `Vehicle`), and defer
genericizing the job's subject to a later phase, shipping only the
registry/module-loading mechanism in Phase 3. This satisfies "prove the
boundary works" for everything *except* the one relationship that's hardest,
which somewhat undercuts the exercise.

**Recommendation: Option A.** It's the smallest schema change, matches how
`APIProvider.dealershipId` is already nullable/polymorphic-ish in spirit, and
the integrity check core loses is one that today is only enforced by
application code anyway (`vehicleUpdateFromAnalysis` et al. never rely on the
FK's `ON DELETE` behavior for correctness — cascade deletes are for cleanup,
not for logic). I flag this as the single biggest open design question in
this document — see §11 and §14 (sub-phase 3a gate).

### 3.3 Renames (mechanical, not structural)

`Dealership`→`Organization`, `DealershipSettings`→`OrganizationSettings`,
`DealershipStatus`→`OrganizationStatus`, every `dealershipId` column/param/
variable→`organizationId`, `TENANT_MODELS`→same list, renamed,
`forDealership()`→`forOrganization()`, `DEMO_DEALERSHIP_SLUG`→
`DEMO_ORGANIZATION_SLUG`. `bootstrapDealershipSlug` prop on `BotDeps`→
`bootstrapOrganizationSlug`. This touches ~40 files but changes no logic.

---

## 4. Vertical module architecture

### 4.1 Folder layout

```
packages/
  verticals/
    core/                      ← the module *contract* (interfaces only, no implementations)
      src/
        module.ts              ← VerticalModule interface, defineVerticalModule() helper
        registry.ts            ← VerticalRegistry (see §6)
        entity.ts               ← EntitySchema<T> contract a module's entities implement
        prompts.ts              ← PromptProvider contract
        workflow.ts              ← WorkflowHooks contract (job lifecycle hooks)
        forms.ts                 ← FormDefinition contract
        i18n.ts                  ← MessageFragment contract (how a module extends Messages)
        index.ts
    dealership/                 ← first concrete module (re-platformed from today's code)
      prisma/
        schema.prisma           ← Vehicle, VehicleImage, BodyType, Segment — module-owned tables
        migrations/
      src/
        module.ts               ← registers everything below with the VerticalRegistry
        entities/vehicle.ts      ← Vehicle EntitySchema + Zod validators
        vision/                  ← moved from packages/providers/src/vision (mock + normalize + candidate schema)
        content-engine/          ← moved from packages/content-engine wholesale
        templates/automotive/    ← moved from packages/templates/automotive
        i18n/                    ← bodyTypes/segments/missingFields/notAVehicle fragments, es/pt/en
        workflow.ts              ← implements WorkflowHooks: onJobCreate (creates Vehicle row), onAnalysisComplete (vehicleUpdateFromAnalysis), formatAnalysis
        routes.ts                ← vehicles.list/get/update route definitions
        package.json
        tsconfig.json
    barbershop/                  ← scaffold only in Phase 3 (see 14d), same shape, no real logic
      src/module.ts               ← minimal stub proving the shape works for a second vertical
```

A module is **one pnpm workspace package** (`@autocontent/vertical-dealership`,
`@autocontent/vertical-barbershop`, …), each with its own `package.json`,
`tsconfig.json`, and (if it owns tables) its own `prisma/schema.prisma`
fragment merged at build time (§8). This mirrors how `packages/providers`,
`packages/queue` etc. are already independent packages the app composes.

### 4.2 What a module registers

At import time, a module's `module.ts` calls a single `defineVerticalModule()`
that returns a `VerticalModule` object (§7.1) containing:

- its slug (`"dealership"`) and display metadata
- entity schemas it owns (for validation, not for core to introspect deeply)
- a `VisionProvider`-shaped analyzer *for its subject type* (or none, if the
  vertical doesn't do photo analysis)
- workflow hooks: `onJobCreate`, `onAnalysisComplete`, `onSubjectMissingInfo`,
  `formatSubjectForDisplay`
- content templates + formats it contributes
- copywriting/content-engine implementation
- i18n message fragments (typed subset of `Messages`)
- API routes it contributes (as `RouteContract[]`, same shape as core's)
- Prisma schema file path (for the build-time schema merge, §8)

### 4.3 How core stays ignorant of modules

Core code (`apps/server`, `apps/worker`'s shell, `packages/database`'s
generic ops, `packages/contracts`'s core routes) imports **only**
`@autocontent/verticals-core` (the interfaces) and, at startup, an explicit,
generated **module manifest** (§6.2) — never a specific module package by
name. `apps/server/src/main.ts` reads `ENABLED_VERTICALS` from config
(comma-separated slugs, e.g. `dealership`), and the registry resolves slugs
to modules through a lookup table built at *build time* (not runtime dynamic
`import()`, which would fight the single-bundle Docker build) — see §6.2.

---

## 5. `BusinessProfile` design

`BusinessProfile` is not a new database concept layered on top of
`Organization` — it **is** `Organization` + `OrganizationSettings` +
`VerticalEnrollment`, read together. Concretely:

```prisma
model VerticalEnrollment {
  organizationId String   @id @db.Uuid   // one enrollment per org for Phase 3
  vertical       String                  // "dealership" | "barbershop" | …, validated against the registry, not a DB enum
  config         Json                    // module-defined shape, validated by that module's own Zod schema
  enrolledAt     DateTime @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}
```

`vertical` is a **string validated against the running registry**, not a
Prisma enum — enums require a migration to add a value, which would defeat
the point of a pluggable module system (adding `barbershop` shouldn't touch
core migrations). A CHECK constraint is not used either, for the same reason;
validation happens in application code at write time (`VerticalRegistry.has(v)`)
and is covered by a test that seeds every registered module's slug and
confirms enrollment succeeds only for those.

`config` is module-owned free-form JSON (parsed by that module's own schema,
same pattern as `DealershipSettings`'s existing Json columns), e.g. the
dealership module might store `{ defaultTemplateSlug: "premium-dealership" }`
there instead of it being a core settings column.

**One organization → one vertical, for Phase 3.** The `@id` on
`organizationId` enforces this. Multi-vertical organizations (a dealership
that also runs a repair shop) are a real future need but explicitly **out of
scope** — the primary key choice here is the one place Phase 3 forecloses an
option, and I call it out because reversing it later means turning this into
a `@@unique([organizationId, vertical])` table plus a "primary vertical"
concept for anything that must pick exactly one (e.g. which template set is
the default). Flagging as a decision point, not assuming multi-vertical is
wanted.

`BusinessProfile` as a *read model* is a plain function,
`loadBusinessProfile(organizationId): Promise<BusinessProfile>`, in
`packages/database/src/ops/organization.ts`, returning
`{ organization, settings, vertical: VerticalModule, config: <module's parsed config type> }`.
This is what replaces today's `SettingsService.get()` call sites — same
caching approach (60s TTL), same invalidation-on-write.

---

## 6. `VerticalRegistry` design

### 6.1 Responsibilities

- Hold the set of modules compiled into this build (§6.2 — no runtime plugin
  loading in Phase 3).
- Validate at startup that every module's declared slug is unique, its Prisma
  schema fragment doesn't collide on table names with core or another module,
  and its declared i18n fragment doesn't collide on message keys.
- Given an `organizationId`, resolve the enrolled `VerticalModule` (one DB
  read through `loadBusinessProfile`, cached).
- Given a job's `subjectType` string (`"dealership.vehicle"`), parse the
  module-namespace prefix and dispatch to that module's workflow hooks — this
  is the **only** place a namespaced string is parsed, and it's a `Map`
  lookup, never an `if/else` chain.

### 6.2 How modules are "discovered" (build-time, not runtime)

No dynamic `import()` of arbitrary paths, no filesystem scanning in
production — that would complicate the single-file esbuild bundle
(`apps/server` builds to one `.mjs`, per `ARCHITECTURE.md` §"Deployment").
Instead:

```ts
// apps/server/src/verticals.generated.ts  (hand-written in Phase 3;
// a small script could generate it later, but a static list is honest
// about what "pluggable" means in a single-binary deploy)
import { dealershipModule } from '@autocontent/vertical-dealership';
// import { barbershopModule } from '@autocontent/vertical-barbershop'; // Phase 3d scaffold only

export const COMPILED_MODULES = [dealershipModule /*, barbershopModule */];
```

`apps/server/src/main.ts` builds the registry from `COMPILED_MODULES`, then
filters to `ENABLED_VERTICALS` (env var) at runtime — so a deploy can compile
in five modules but only *enable* one for a given tenant base, without a
rebuild per vertical. This gives you the packaging benefit of "pluggable"
(each module is an independently developed, tested, versioned package) without
pretending the Node process loads arbitrary code at runtime, which it
doesn't and — given the Docker single-bundle strategy from Phase 2 — 
shouldn't.

### 6.3 No switch statements: how dispatch actually works

Every place that today would tempt a `switch (businessType)` instead does a
`Map.get(vertical)` against the registry:

```ts
// core, generic:
const vertical = await registry.resolve(organizationId);   // Map lookup, cached
const result = await vertical.workflow.onJobCreate(ctx);    // interface call, not a branch
```

The registry itself has exactly one small `if` (unknown vertical slug →
throw `NonRetryableError`), which is error handling, not business-logic
branching, and is unit-tested with a deliberately-unregistered slug.

---

## 7. Interfaces and contracts

All in `packages/verticals/core/src/`, following the existing
`VisionProvider`/`TestableProvider` style (interfaces + a documented
contract + a `describe*Contract()` test harness every module must pass).

### 7.1 `VerticalModule`

```ts
export interface VerticalModule<TConfig = unknown> {
  readonly slug: string;                       // "dealership", stable, namespaced in subjectType as "<slug>.<entity>"
  readonly displayName: string;
  readonly configSchema: z.ZodType<TConfig>;    // validates VerticalEnrollment.config

  readonly entities: EntitySchema[];            // for docs/validation, not deep introspection by core
  readonly workflow: WorkflowHooks;
  readonly prompts?: PromptProvider;            // absent for verticals with no AI analysis step
  readonly contentTemplates: ContentTemplateSet;
  readonly routes: RouteContract[];             // merged into the core route table at build time
  readonly messages: Record<Locale, MessageFragment>;

  /** Path to this module's Prisma schema fragment, merged at build time (§8). */
  readonly prismaSchemaPath: string;
}
```

### 7.2 `WorkflowHooks` — the job-lifecycle contract a module implements

This is what `apps/worker`'s generic shell calls at each stage instead of
inlining `vehicleUpdateFromAnalysis()` etc.:

```ts
export interface JobSubjectRef { subjectType: string; subjectId: string }

export interface WorkflowHooks<TAnalysis = unknown> {
  /** Create (or find) the module's own entity for a brand-new job. Returns the subject ref core stores on ContentJob. */
  onJobCreate(ctx: { organizationId: string; tx: Prisma.TransactionClient }): Promise<JobSubjectRef>;

  /** Module's analyzer, if it has one. Same shape as today's VisionProvider, generic over the module's own output type. */
  analyze?(input: VisionInput, opts: ProviderCallOptions): Promise<ProviderResult<TAnalysis>>;

  /** Persist analysis results onto the module's own entity. Replaces vehicleUpdateFromAnalysis(). */
  onAnalysisComplete(ctx: { subject: JobSubjectRef; analysis: TAnalysis; tx: Prisma.TransactionClient }): Promise<void>;

  /** What's still missing after analysis, in the module's own vocabulary (replaces missing_information). */
  computeMissingInformation(analysis: TAnalysis): string[];

  /** Bot-facing rendering of the analysis (replaces formatAnalysis()). */
  formatSubjectForDisplay(analysis: TAnalysis, locale: Locale, opts: { mock: boolean }): string;

  /** Ready-to-post copy (replaces content-engine's generateCaption()). */
  generateCaption(analysis: TAnalysis, locale: Locale): { text: string; usedFields: string[] };
}
```

Core's worker shell (§ "Files to modify," `process-content-job.ts`) keeps
the ingest/store/retry/idempotency/cost-logging skeleton and calls these
five hooks instead of the vehicle-specific functions it calls today. The
photo-download, byte validation, and storage-key building stay in core
(genuinely generic); only `'vehicles'` as a path segment becomes
`vertical.slug` (i.e. `'dealership'`) or `subjectType`.

### 7.3 `PromptProvider`

```ts
export interface PromptProvider {
  resolve(promptId: string, locale: Locale): ResolvedPrompt;  // same ResolvedPrompt shape as today's text/types.ts
}
```

Thin — Phase 5 (LLM copywriting) will flesh this out; Phase 3 only needs the
shape to exist so `dealership`'s module can declare where its prompts will
eventually live, without inventing new prompt infrastructure now.

### 7.4 `EntitySchema`

```ts
export interface EntitySchema<T = unknown> {
  readonly name: string;            // "Vehicle"
  readonly zodSchema: z.ZodType<T>;  // for API-boundary validation, not an ORM abstraction
}
```

Deliberately thin: this is documentation + validation, not a generic ORM
layer. Modules use Prisma directly against their own tables (§8) — building a
schema-agnostic entity abstraction is more machinery than Phase 3 needs, and
would itself become a second thing to keep generic.

### 7.5 `FormDefinition`

```ts
export interface FormDefinition {
  id: string;                                  // "vehicle-missing-info"
  fields: { key: string; label: Record<Locale, string>; kind: 'text' | 'number' | 'select'; options?: string[] }[];
}
```

Not consumed by anything yet (Phase 3 has no dashboard), but declared now so
the `dealership` module's shape includes it — the "ask for what's missing"
flow (Phase 3 of the *original* roadmap, i.e. price/mileage/city prompts) can
build on this contract when it lands, per-vertical, without a core rewrite.

---

## 8. Database changes

### 8.1 Schema split strategy

Prisma (as used here — one `schema.prisma`, one generated client) does not
natively support multiple independent schema files contributing to one
client the way some ORMs do. Two real options:

**Option 1 — one schema file, sectioned, module-owned by convention
(recommended for Phase 3).** `packages/database/prisma/schema.prisma` keeps
all models, but `Vehicle`/`VehicleImage`/`BodyType`/`Segment` move to a
clearly delimited section with a comment banner
(`// ═══ OWNED BY @autocontent/vertical-dealership — see packages/verticals/dealership ═══`),
and a **build script** (`scripts/assemble-schema.ts`, run before `prisma
generate`) concatenates a core schema file with each enabled module's schema
*fragment* file, so the module's Prisma models physically live in
`packages/verticals/dealership/prisma/schema.prisma` (as stated in §4.1) and
are copied/merged into the assembled file the generator actually reads. This
keeps one Prisma client (avoiding a hard multi-schema-file migration right
now) while giving each module a real, separately-versioned schema file in its
own package.

**Option 2 — Prisma multi-file schema (native, preview-adjacent).** Recent
Prisma versions support splitting `schema.prisma` into multiple `.prisma`
files in the same folder that get merged automatically. This is
**Option 1's outcome without a custom build script**, if the currently
pinned Prisma version (`7.10.0`) supports it stably enough to rely on for
migrations. **Needs a spike before committing** — flagged in §11 as a
migration risk, resolved in sub-phase 3a (§14) before schema work proceeds
either way.

Either option preserves the answer to "how is tenant isolation kept for
module-owned tables": **unchanged.** `Vehicle.organizationId` (renamed) keeps
its `@@unique([id, organizationId])`, keeps its composite tenant foreign keys
to any table it's related to (`VehicleImage.vehicleId, organizationId` →
`Vehicle.id, organizationId`), and `forOrganization()` continues to filter
every module table the same way it filters core tables — `TENANT_MODELS`
(renamed) simply grows to include module-declared table names, contributed by
each module's `entities` list rather than hand-maintained in core.

### 8.2 Exact diff

**Renamed (mechanical):**
- `Dealership` → `Organization`, `DealershipSettings` → `OrganizationSettings`,
  `DealershipStatus` → `OrganizationStatus`
- Every `dealershipId` column → `organizationId` (19 tables)
- `TelegramAccount.dealership` relation, `bootstrapDealershipSlug`, etc. — all
  call sites, not just the schema

**New tables (core):**
- `VerticalEnrollment` (§5)

**New columns (core):**
- `ContentJob.subjectType String`, `ContentJob.subjectId String @db.Uuid`
  (replacing `vehicleId String @db.Uuid` — see §3.2 Option A)
- `ContentAsset.subjectType/subjectId`, `VideoPlan.subjectType/subjectId`
  (same replacement)

**Removed from core, moved to `packages/verticals/dealership/prisma/schema.prisma`:**
- `Vehicle`, `VehicleImage` models
- `BodyType`, `Segment` enums
- The tenant-boundary constraints these owned (`tenant_Vehicle_primaryImage`,
  `tenant_VehicleImage_vehicle`) move with them, still hand-written SQL, now
  living in the module's own migration directory

**Changed (core):**
- `UsageMetric` drops `VEHICLES_PROCESSED`; a module-contributed metric list
  is appended at the assembled-schema stage the same way module tables are
  (or, simpler and recommended: keep `UsageMetric` as a free-form `String`
  validated against `Set<string>` built from core metrics + every enabled
  module's declared metrics, same reasoning as `VerticalEnrollment.vertical`
  in §5 — **flagging this as equivalent to that decision**, so one answer
  covers both)
- `OrganizationSettings` drops the `"premium-dealership"` default for
  `defaultTemplateSlug`; the default moves into `VerticalEnrollment.config`
  or is optional or the notion of a "default template" becomes something the
  module's `contentTemplates` declares

**Migration structure:** two migrations, reviewable independently —
1. `packages/database/prisma/migrations/…_rename_dealership_to_organization/` —
   pure rename, `ALTER TABLE … RENAME`, `ALTER TYPE … RENAME`, zero data loss,
   trivially reversible (rename back).
2. `packages/verticals/dealership/prisma/migrations/…_split_vehicle_tables/` —
   moves `Vehicle`/`VehicleImage` out of the assembled schema's core section;
   because Option 1 (§8.1) keeps them in the *same physical database*, this
   migration is close to a no-op at the SQL level (the tables don't move
   servers, just which `schema.prisma` file declares them) — the real work is
   adding `ContentJob.subjectType/subjectId`, backfilling
   `subjectType='dealership.vehicle', subjectId=vehicleId` for every existing
   row, then dropping `ContentJob.vehicleId` (and the two other `vehicleId`
   columns) in a **separate, later** migration once the backfill is verified
   — never drop and add in the same migration for a column carrying live
   data. This also needs the existing `tenant_ContentJob_vehicle` /
   `tenant_ContentAsset_vehicle` / `tenant_VideoPlan_vehicle` composite
   foreign keys **dropped** (deliberately, unlike the Phase 1 rule of never
   dropping a `tenant_*` constraint — this is the one sanctioned exception,
   because the relationship itself is being replaced, not weakened; the
   `migrations.test.ts` guard needs a matching update to allow exactly these
   three named drops in exactly this migration, nothing else).

---

## 9. Files to modify

Grouped by the change each file needs.

**Rename only (Dealership→Organization, mechanical):**
- `packages/database/prisma/schema.prisma`
- `packages/database/src/tenant.ts`, `client.ts`, `settings.ts`, `seed.ts`,
  `seed-cli.ts`, `plans.ts`
- `packages/database/src/ops/telegram.ts`, `time.ts`
- `packages/database/src/*.test.ts`, `ops/*.test.ts` (assertions reference
  `dealershipId`)
- `apps/telegram/src/bot.ts` (`bootstrapDealershipSlug` → `bootstrapOrganizationSlug`,
  all `dealershipId` locals)
- `apps/server/src/main.ts` (`demoDealershipId` log field)
- `apps/server/src/flow.e2e.test.ts` (helper names, assertions)
- `packages/contracts/src/routes.ts`, `resources.ts` (`dealership.*` routes → `organization.*`)
- `.github/workflows/ci.yml`, `SETUP.md`, `ARCHITECTURE.md`, `README.md` (prose references)

**Split — core parts stay, vehicle parts extracted:**
- `packages/shared/src/vehicle.ts` → generic `Tagged<T>`/`FieldSource`/`taggedSchema`
  stay in `packages/shared/src/tagged-value.ts` (new name); everything else
  moves to `packages/verticals/dealership/src/entities/vehicle-analysis.ts`
- `packages/shared/src/i18n.ts` → `Messages` interface loses `bodyTypes`,
  `segments`, `missingFields`, `notAVehicle`, `multipleVehicles`,
  `labels.bodyType`/`labels.segment`; gains a
  `moduleMessages?: Record<string, unknown>` extension point merged by the
  registry at startup (exact merge mechanism: core `Messages` type stays
  closed/generic; each module's `MessageFragment` is looked up separately by
  module code, not spliced into the core `messages()` return — avoids
  widening a core type per module)
- `packages/providers/src/vision/normalize.ts` → `VISION_POLICY`,
  `applyPolicy`, clamping helpers stay in
  `packages/providers/src/vision/policy.ts` (new file, generic over any
  tagged-field record); `visionCandidateSchema` and the vehicle-field-specific
  parts of `normalizeVisionOutput()` move into the dealership module, which
  imports the generic policy helpers
- `packages/providers/src/vision/types.ts` → `VisionProvider` becomes
  generic (`VisionProvider<TOutput>`) or is duplicated per-module-need;
  **recommendation:** make it generic — `analyze(): Promise<ProviderResult<TOutput>>` —
  since the interface shape (capabilities, typed errors, abort signal) has
  zero vehicle content already
- `apps/worker/src/process-content-job.ts` → strip
  `vehicleUpdateFromAnalysis()`, direct `db.vehicle.*`/`db.vehicleImage.*`
  calls, `CAPTION_FORMAT` constant; replace with calls to
  `vertical.workflow.onJobCreate/onAnalysisComplete/generateCaption`; keep
  ingest/storage/retry/cost-logging/idempotency exactly as-is
- `apps/worker/src/format.ts` → deleted from core worker; becomes
  `vertical.workflow.formatSubjectForDisplay`, moved into the dealership
  module
- `packages/database/src/ops/jobs.ts` → `createTelegramContentJob()` splits:
  core keeps the idempotency check, limit checks (generalized from
  `monthly_vehicles` to a module-declared limit key), `ContentJob` row
  creation, and usage counting; delegates subject creation to
  `vertical.workflow.onJobCreate()` inside the same transaction

**Move wholesale (package relocates, imports updated at call sites):**
- `packages/content-engine/*` → `packages/verticals/dealership/src/content-engine/*`
- `packages/templates/automotive/*` → `packages/verticals/dealership/templates/*`
  (schema.ts stays as the core template contract, re-exported from
  `packages/verticals/core`)
- `packages/providers/src/vision/mock.ts`, `contract.ts` → dealership module
  (contract test harness generalized first, per above)

**Contracts:**
- `packages/contracts/src/resources.ts`, `routes.ts` → `vehicle`/
  `vehicleListQuery`/`vehiclePatch` and the three `vehicles.*` routes move to
  `packages/verticals/dealership/src/routes.ts`; core `routes.ts` exports a
  `mergeRoutes(core, ...moduleRoutes)` the assembled app calls at startup
  (mirrors §8.1's schema-assembly pattern, applied to routes instead of
  tables)

---

## 10. Files to create

```
packages/verticals/core/
  package.json, tsconfig.json
  src/
    module.ts            VerticalModule interface + defineVerticalModule()
    registry.ts           VerticalRegistry class
    workflow.ts            WorkflowHooks interface
    prompts.ts              PromptProvider interface
    entity.ts                EntitySchema interface
    forms.ts                  FormDefinition interface
    business-profile.ts        loadBusinessProfile(), BusinessProfile type
    index.ts
  src/registry.test.ts    unregistered-slug error, duplicate-slug rejection,
                          i18n-key-collision rejection (using two trivial stub
                          modules defined inline in the test)

packages/verticals/dealership/
  package.json, tsconfig.json
  prisma/schema.prisma    Vehicle, VehicleImage, BodyType, Segment (moved)
  prisma/migrations/      the split migration from §8.2
  src/
    module.ts             defineVerticalModule({ slug: 'dealership', ... })
    entities/
      vehicle.ts           EntitySchema<Vehicle> + moved vehicleAnalysisSchema,
                            BODY_TYPES, SEGMENTS, ANALYSIS_FIELDS, USER_ONLY_FIELDS,
                            PHOTO_SUBJECTS, IMAGE_QUALITY_ISSUES (pending §2's
                            flagged decision on the last two)
    vision/
      mock.ts               moved MockVisionProvider (6 car samples)
      normalize.ts           moved candidate schema + normalizeVisionOutput(),
                             now calling packages/providers' generic policy.ts
      contract.ts            moved describeVehicleVisionContract() built on a
                             generalized core contract-test harness
    content-engine/
      publishable.ts, caption.ts   moved verbatim, imports updated
    templates/automotive/          moved verbatim
    workflow.ts             implements WorkflowHooks (onJobCreate creates
                            Vehicle row, onAnalysisComplete = old
                            vehicleUpdateFromAnalysis, generateCaption
                            delegates to content-engine, formatSubjectForDisplay
                            = old formatAnalysis)
    i18n/es.ts, pt.ts, en.ts   moved bodyTypes/segments/missingFields/
                             notAVehicle/multipleVehicles fragments
    routes.ts               moved vehicle/vehicleListQuery/vehiclePatch +
                            vehicles.* route definitions
  src/*.test.ts             moved test files, updated imports; this is where
                            "same 136+ tests, reorganized" lives (§12)

packages/verticals/barbershop/       (scaffold only, sub-phase 3d, §14)
  package.json, tsconfig.json
  src/module.ts             minimal defineVerticalModule() — no real entities,
                            a stub workflow whose onJobCreate creates nothing
                            and generateCaption returns a placeholder string —
                            enough to prove the registry, business profile
                            resolution, and job-creation delegation work for
                            a module that isn't the dealership one

apps/server/src/verticals.generated.ts   compiled-module list (§6.2)

docs/phase-3-design.md         this document
```

---

## 11. Migration risks

**Vision analysis schema is the hardest thing to generalize cleanly**, as
anticipated. `VehicleAnalysis`'s field names (`make`, `model`, `body_type`)
are baked into: the Zod schema, the confidence-normalization candidate
schema, the mock provider, the contract test suite, the worker's DB-update
function, the bot's display formatter, and the caption engine — six call
sites, three of them with vehicle-specific logic that doesn't reduce to a
config table (the confidence *policy* generalizes cleanly; the *shape* does
not, because "which fields exist" is inherently vertical-specific). Making
`VisionProvider<TOutput>` generic is straightforward TypeScript; making the
*normalization/clamping helpers* generic over an arbitrary tagged-field
record is more work but tractable (turn `applyPolicy()` into something that
walks `Object.entries()` of a record of `Tagged<unknown>` rather than naming
seven fields). Recommend doing exactly that generalization and shipping it
in sub-phase 3b, verified by porting the dealership module through it, not
by a synthetic second schema.

**Content templates are the second-hardest**, but less risky than they look:
the schema (`packages/templates/src/schema.ts`) is *already* generic — no
vehicle field appears in `templateSchema`, `formatSchema`, or
`videoStyleSchema`. The five automotive templates are pure data. This is a
directory move, not a redesign. Low actual risk; flagged because the prompt
explicitly asked, and it's worth being clear that the risk here is much lower
than the vision schema's.

**`ContentJob.subjectType`/`subjectId` losing a real foreign key (§3.2
Option A)** is the biggest *architectural* risk — it trades a
database-enforced invariant for an application-enforced one. Mitigation:
the only code path that ever creates a `ContentJob` is
`createTelegramContentJob()` (soon: the core job-creation function that calls
`workflow.onJobCreate()` inside the same transaction) — there is no second
writer to drift from that invariant, and a test asserting "every ContentJob's
subjectId resolves to a live row in the module's table" can run in CI against
the real database cheaply. I'm not aware of a case in the current codebase
where something other than that one function inserts a `ContentJob` row, so
the risk is theoretical rather than active, but it's a real trade-off, not a
free lunch, and I want that on the record before it's accepted.

**Prisma multi-file schema support (§8.1 Option 2)** needs a five-minute
spike against the pinned `7.10.0` before sub-phase 3a starts, to decide
between Option 1 (custom assembly script, more code, works regardless of
Prisma version) and Option 2 (native, less code, dependent on that feature's
maturity in this version). This is the one item in this document I could not
verify by reading the repo — it requires checking Prisma's current docs/
behavior, which I did not do as part of this design pass (correctly scoped
as implementation, not design) but call out so it doesn't surprise
sub-phase 3a.

**Not worth abstracting yet:** `EntitySchema` (§7.4) is deliberately thin
rather than a generic ORM/repository abstraction over Prisma — building that
now would be solving a problem Phase 3 doesn't have (only one module owns
tables; a real cross-module entity-access abstraction is worth building once
a second module actually needs one, in 3d or later, informed by what the
barbershop scaffold reveals). Similarly, `PromptProvider` (§7.3) is
intentionally minimal — Phase 5 owns fleshing it out; Phase 3 just reserves
the shape.

---

## 12. Compatibility strategy

The dealership flow is **re-implemented as the first vertical module**, not
left as special-cased core code — this satisfies your instruction directly
rather than as a side effect. Concretely, "the existing dealership flow keeps
working" means, at the end of sub-phase 3c:

- The same Telegram bot commands (`/start`, `/help`, `/invite`), the same
  invite/bootstrap flow, the same rate limiting — **unchanged**, because none
  of that was vehicle-coupled to begin with (§1.8).
- A photo sent to the bot still: creates an org-scoped job, downloads and
  validates the image, stores it, runs the mock vision analyzer, gets a
  caption, gets delivered — but every one of those last three steps now runs
  *through* the `dealership` module's `WorkflowHooks` implementation instead
  of inline worker code.
- **All 136+ existing tests are the parity gate**, not a new test suite
  written to check parity. Test files move alongside the code they test
  (§10); assertions are updated only for renamed identifiers
  (`dealershipId`→`organizationId`) and moved imports — **no test's actual
  expectations about behavior change**. `apps/server/src/flow.e2e.test.ts`
  in particular (the fullest end-to-end proof) must pass unmodified in its
  assertions after sub-phase 3c; if it needs a behavioral change to pass,
  that's a signal the refactor broke something, not that the test was wrong.
- The demo organization (renamed from demo dealership) is seeded with
  `VerticalEnrollment { vertical: 'dealership' }` so the existing Telegram
  flow has an enrolled module to resolve against — see §14 sub-phase 3b for
  exactly when this seed change lands.

This is the concrete, testable definition of "keeps working" for this
migration — not a promise taken on faith, but the specific set of currently-
green checks that must stay green.

---

## 13. Postiz as a future `SocialPublishingProvider`

Design-level only, per your instruction — not integrated, not assumed chosen
over Blotato.

Postiz (self-hostable, open-source social scheduling) would implement the
exact same interface Blotato does today
(`packages/providers/src/social/types.ts`: `supportedPlatforms()`,
`listAccounts()`, `publish()`, `getPostStatus()`, `testConnection()`), because
that interface is already provider-agnostic — nothing in it names Blotato.
The only design question specific to Postiz: **credential shape**.
`SocialCredentials` today is `{ apiKey: string }` (matching Blotato's single
API-key model per dealership). Postiz's self-hosted API typically pairs a
base URL with an API key (since you run your own instance rather than call a
shared SaaS endpoint) — so `SocialCredentials` would need an optional
`baseUrl?: string` field, which is a backward-compatible, additive change to
that interface, not a breaking one (`APIKeyReference`'s existing
`envVarName`/encrypted-ciphertext storage already supports storing more than
one string per credential set if a JSON blob is stored instead of a bare
key — no schema change required, since `APIKeyReference.ciphertext` already
holds arbitrary encrypted bytes).

Adding it would mean: a new `packages/providers/src/social/postiz.ts`
implementing `SocialPublishingProvider`, registered in the provider catalogue
(`PROVIDER_CATALOGUE` in `packages/database/src/seed.ts`) alongside
`mock-vision` and (eventually) `blotato`, with its own `costConfig` (Postiz
self-hosted is typically free at the point of use, so `costConfig: []` is
plausible — actual pricing is your call when you decide to build it). No
calling code changes: `PublishingAccount.providerId` already points at
whichever `APIProvider` row a dealership configured, and the publish path
(not yet built — Phase 10) would call `provider.publish()` polymorphically
regardless of which adapter is behind it, exactly like `VisionProvider`
works today for the mock vs. a real vision adapter.

---

## 14. Phased rollout plan

Each sub-phase below is small enough to review independently, same discipline
as Phases 0–2. **I will stop and wait for your approval after each one**,
not just at the end of Phase 3.

**3a — Core schema + registry skeleton.**
Resolve the Prisma multi-file spike (§11). Rename `Dealership`→`Organization`
everywhere (§9's "rename only" list) as one migration, one commit — no
vehicle/vertical logic touched yet, all 136+ tests pass unchanged except for
renamed identifiers. Create `packages/verticals/core` with the interfaces
from §7 and `VerticalRegistry` (§6), unit-tested against two trivial inline
stub modules (not the real dealership module yet). Add `VerticalEnrollment`
table. **Gate:** registry tests pass, rename migration applies cleanly to a
copy of the current production-shaped database, all existing tests green.

**3b — Re-platform dealership as a module.**
Create `packages/verticals/dealership`, move the files per §9/§10, implement
`WorkflowHooks`, generalize the vision-normalization policy (§11), add
`ContentJob.subjectType/subjectId` alongside (not yet replacing) `vehicleId`,
backfill `subjectType/subjectId` for existing rows, update the worker shell
to call `vertical.workflow.*` hooks. Seed the demo organization with a
`VerticalEnrollment`. **Gate:** every moved test passes from its new
location; the worker produces byte-identical Telegram replies to today's for
the same input photo (a snapshot/golden-file comparison against current
`flow.e2e.test.ts` outputs is the concrete check).

**3c — Verify parity, drop the old columns.**
Once 3b has run against real traffic patterns (or, in this environment, an
extended CI soak) with `vehicleId` and `subjectId` both populated and
verified equal, drop `ContentJob.vehicleId`, `ContentAsset.vehicleId`,
`VideoPlan.vehicleId` and their three tenant foreign keys (the one sanctioned
exception to "never drop a tenant_* constraint," per §8.2) in a dedicated
migration. Update `migrations.test.ts`'s guard to permit exactly those three
drops in exactly that migration and no others. **Gate:** full test suite
green with the old columns gone; a manual Telegram smoke test (per
`SETUP.md`'s existing verification steps) confirms the live bot still works
end-to-end.

**3d — Scaffold a second vertical to prove genericity.**
Create `packages/verticals/barbershop` per §10's minimal scaffold — enough to
enroll a test organization, create a job, and get a placeholder response
through the *same* worker shell and registry, with zero core or dealership-
module code changes required to make it work. This is the actual proof the
boundary holds, not an assertion that it does. **Gate:** a new end-to-end
test creates a `barbershop`-enrolled organization, sends it through the same
Telegram bot, and asserts the response came from the barbershop stub, not the
dealership module — proving dispatch, not just compilation.

Each gate is a stopping point for your review before the next sub-phase
starts, exactly as every phase before this one has worked.

---

## Open questions for you (collected from inline flags above)

1. **§2** — Should `PHOTO_SUBJECTS`/`IMAGE_QUALITY_ISSUES` (photo-usability
   concepts) be promoted to core, or stay a dealership-module convention?
2. **§3.2** — Confirm Option A (polymorphic `subjectType`/`subjectId`, no DB
   FK) for how `ContentJob` references its subject, versus Option B (a shared
   `ContentSubject` shim table) or Option C (defer, don't generalize this
   relationship in Phase 3).
3. **§5** — Confirm one-vertical-per-organization is acceptable for now
   (primary-key choice that would need a real migration to undo later).
4. **§8.2** — `UsageMetric` as a Prisma enum vs. a registry-validated string
   (same shape of decision as `VerticalEnrollment.vertical` — one answer
   covers both).
5. **§8.1** — Prisma multi-file schema (native) vs. a custom assembly script
   for merging core + module schema fragments — I'll spike this at the start
   of 3a regardless, flagging so you know it's an open implementation detail,
   not asking you to resolve it yourself.
6. **§2 / §14** — What should `pnpm seed` create by default once "dealership"
   is no longer the only possible vertical: still a demo dealership org (my
   default assumption, since the running system today is a dealership demo),
   a generic empty org, or something else?

I've made a recommendation on each one above; tell me where you'd rather I
go a different way, and I'll fold that into the plan before sub-phase 3a
starts.
