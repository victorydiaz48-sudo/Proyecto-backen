# Dealer Content Platform

Content automation for car dealerships: an employee sends **one vehicle photo**
to a Telegram bot, and the system identifies the vehicle and produces marketing
content (captions, posts, stories, reels) — and later publishes it.

> **Status: Phase 1 — foundations complete.** The bot runs the Phase 0 flow
> (Telegram photo → validated → mock vision analysis → caption → reply);
> the database schema, tenant isolation, provider contracts, API contracts
> and templates are built and tested, and get wired in from Phase 2.
> See [SETUP.md](SETUP.md) to deploy it from your phone.

## What works today

- Telegram bot (`/start`, `/help`, photos, images sent as files), polling or
  secured webhook mode
- Immediate acknowledgement; processing runs in a background job queue with
  up to 3 retries (4 attempts), exponential backoff and idempotent job ids
- Upload validation from the actual bytes: type (JPEG/PNG/WebP), size,
  dimensions
- Vehicle analysis contract where **every field is tagged** `detected`,
  `inferred`, `user-provided` or `unknown`; a mock provider implements the
  same interface the real one will
- Caption generator that only publishes safe facts (no invented year, trim,
  specs, price or mileage)
- Spanish (default), Portuguese and English
- Structured JSON logs with per-job events and secret redaction
- `/health` endpoint, Dockerfile, Railway config, GitHub Actions CI
- Photos that show no vehicle, several vehicles, or an unclear view get a
  specific reply and no further processing

Built and tested, wired in from Phase 2:

- PostgreSQL schema for all 15 entities (+ settings, sessions, invites,
  publications, audit log) with tenant isolation enforced by the database
- Tenant-scoped data access, settings snapshots, encrypted API-key storage
- Full provider contracts (vision, text, image, video, storage, social,
  analytics) and a conformance test suite for vision adapters
- REST API contract with per-route roles, published as OpenAPI
- Five content templates, 15 formats, 7 video styles

## Repository layout

```
apps/
  telegram/          Bot service
packages/
  shared/            Vehicle data model, i18n, logger, errors, image validation, QA/video-plan schemas
  config/            Validated environment configuration
  database/          Prisma schema + migrations, tenant-scoped client, settings, encryption, seed
  queue/             Job queue interfaces + in-memory implementation
  providers/         Provider interfaces + adapters (vision: mock for now), cost calculation
  contracts/         REST API schemas and route table (→ docs/api/openapi.json)
  templates/         Automotive content templates, formats, video styles (JSON)
  content-engine/    Copywriting (currently: template caption)
docs/api/            Generated OpenAPI document
```

More apps (`api`, `worker`, `web`) and packages are added phase by phase; see
[ARCHITECTURE.md](ARCHITECTURE.md).

`generador-pagina-contacto.html` is an earlier, unrelated standalone tool and
is left untouched.

## Developing (for contributors with a terminal)

```bash
corepack enable
pnpm install
pnpm check          # typecheck + tests + build
pnpm dev:telegram   # needs TELEGRAM_BOT_TOKEN in the environment
```
