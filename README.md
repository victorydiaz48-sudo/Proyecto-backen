# Dealer Content Platform

Content automation for car dealerships: an employee sends **one vehicle photo**
to a Telegram bot, and the system identifies the vehicle and produces marketing
content (captions, posts, stories, reels) — and later publishes it.

> **Status: Phase 0 — walking skeleton (MOCK_MODE).**
> Telegram photo → validated → mock vision analysis → caption → bot reply.
> See [SETUP.md](SETUP.md) to deploy it from your phone.

## What works today

- Telegram bot (`/start`, `/help`, photos, images sent as files), polling or
  secured webhook mode
- Immediate acknowledgement; processing runs in a background job queue with
  3 attempts, exponential backoff and idempotent job ids
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

## Repository layout

```
apps/
  telegram/          Bot service (Phase 0 entry point)
packages/
  shared/            Vehicle data model, i18n, logger, job queue, image validation
  config/            Validated environment configuration
  providers/         Provider interfaces + adapters (vision: mock for now)
  content-engine/    Copywriting (Phase 0: template caption)
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
