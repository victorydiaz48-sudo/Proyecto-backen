# Architecture

This document grows with each phase. It currently describes **Phase 0**.

## Phase 0 flow

```
Telegram ──update──▶ apps/telegram (grammY)
                       │ validate metadata (declared size)
                       │ jobId = hash(chat, message)   ← idempotency key
                       │ reply "🚗 Analizando tu vehículo…"
                       ▼
                    JobQueue (InMemoryJobQueue; BullMQ in Phase 2)
                       │  up to 3 attempts, backoff 2s → 4s → 8s
                       ▼
                    analyze-photo job
                       1. download file (streamed, hard byte cap)
                       2. validateImage: magic bytes, size, dimensions
                       3. VisionProvider.analyze → VehicleAnalysis (zod-validated)
                       4. generateCaption (publishable facts only)
                       5. send analysis + caption (each reply sent once)
                       on final failure → one localized error message
```

No download, AI call or other heavy work happens inside the Telegram update
handler.

## Key contracts

### VehicleAnalysis (`packages/shared/src/vehicle.ts`)

Every identifying field is a `Tagged<T>`:

```ts
{ value: T | null, source: 'detected' | 'inferred' | 'user-provided' | 'unknown', confidence?: number }
```

The schema requires `source = unknown` exactly when `value = null`, so a
provider can't return a value without saying where it came from.
`missing_information` is recomputed from the data, and always includes the
user-only fields (price, mileage, location, contact, financing).

### Publication policy (`packages/content-engine/src/publishable.ts`)

| Source | In public copy? |
|---|---|
| detected, user-provided | yes |
| inferred | only make/model/body/segment, and only with confidence ≥ 0.7 |
| unknown | never |

Year and trim are never published unless detected or given by the user.
Features are only listed when `detected`.

### Providers (`packages/providers`)

```ts
interface VisionProvider {
  name: string;
  analyze(input: VisionInput): Promise<VehicleAnalysis>;
  testConnection(): Promise<ProviderStatus>; // CONNECTED | NOT_CONFIGURED | ERROR
}
```

`createVisionProvider(config)` is the only place that chooses an
implementation. In MOCK_MODE it returns `MockVisionProvider`, which validates
its output against the same schema a real provider must pass. Without
MOCK_MODE and without a real provider, it returns an `Unconfigured…` provider:
the app keeps running, health shows `NOT_CONFIGURED`, and jobs fail fast with
a clear message instead of retrying.

### JobQueue (`packages/shared/src/queue.ts`)

`enqueue(payload, { jobId })` ignores duplicate job ids.
`NonRetryableError` (invalid image, missing credentials) skips retries.
Job states: `pending | processing | retrying | completed | failed`.
The payload is plain JSON so it can move to Redis unchanged in Phase 2.

## Security in Phase 0

- Webhook mode requires `TELEGRAM_WEBHOOK_SECRET`; requests without the
  matching `X-Telegram-Bot-Api-Secret-Token` header get 401 (tested).
- File type is checked from the bytes; Telegram's mime type and file name are
  never trusted. Downloads are streamed with a hard byte cap.
- Config errors never print values; the logger redacts the bot token, webhook
  secret and API keys even when they appear inside error URLs.
- All user-facing HTML is escaped.

## Logging

One JSON object per line on stdout, e.g.

```json
{"level":"info","msg":"image analyzed","service":"telegram","jobId":"…","attempt":1,"event":"IMAGE_ANALYZED","provider":"mock-vision","durationMs":803}
```

Events so far: `JOB_STARTED`, `IMAGE_RECEIVED`, `IMAGE_ANALYZED`,
`COPY_GENERATED`, `JOB_RETRYING`, `JOB_COMPLETED`, `JOB_FAILED`.

## Known Phase 0 limitations (by design)

- Jobs and dedupe state live in memory: a restart drops in-flight jobs.
- No database, storage, dealership/user model or rate limiting yet.
- One global language (`DEFAULT_LOCALE`).
- Vision analysis is simulated.
