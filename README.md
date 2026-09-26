# Dealer Content Platform

Content automation for car organizations: an employee sends **one vehicle photo**
to a Telegram bot, and the system identifies the vehicle and produces marketing
content (captions, posts, stories, reels) — and later publishes it.

> **Status: Phase 2 — core backend + job queue.** Invite-only Telegram bot →
> PostgreSQL (vehicles, jobs, usage) → Redis/BullMQ queue → worker → photo
> storage → mock vision analysis → caption → reply. Vision is still simulated
> (MOCK_MODE). See [SETUP.md](SETUP.md) to deploy it from your phone.

## What works today

- Invite-only Telegram bot (`/start`, `/help`, `/invite`, photos, images sent
  as files), polling or secured webhook mode; first owner via a one-time
  bootstrap link
- Every photo becomes a Vehicle + ContentJob in PostgreSQL; daily/monthly
  limits per organization; usage and provider cost recorded exactly once
- Queue on Redis (BullMQ) or in memory; unfinished jobs resume after a restart
- Original photos stored in S3-compatible storage (e.g. Cloudflare R2) or on
  local disk; an identical photo reuses its analysis instead of paying again
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

- PostgreSQL schema for all 15 entities (+ settings, sessions, invites,
  publications, audit log) with tenant isolation enforced by the database
- `/health` and `/ready` report database, queue, storage, Telegram and vision

Built and tested, not yet used by the running app:

- Encrypted API-key storage, REST API contract (OpenAPI), five content
  templates / 15 formats / 7 video styles, provider interfaces for text,
  image, video, social publishing and analytics

## Repository layout

```
apps/
  server/            Entry point + Dockerfile: runs bot and/or worker (SERVICE=all|telegram|worker)
  telegram/          Bot: access control, invites, job creation; HTTP server
  worker/            Content-job processor (ingest → analyse → caption → deliver)
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

More apps (`api`, `web`) and packages are added phase by phase; see
[ARCHITECTURE.md](ARCHITECTURE.md).

`generador-pagina-contacto.html` is an earlier, unrelated standalone tool and
is left untouched.

## Developing (for contributors with a terminal)

```bash
corepack enable
pnpm install
pnpm check          # typecheck + tests + build (DB/Redis tests need TEST_DATABASE_URL / TEST_REDIS_URL)
pnpm dev            # needs DATABASE_URL and TELEGRAM_BOT_TOKEN in the environment
docker compose up   # app + PostgreSQL + Redis
```
