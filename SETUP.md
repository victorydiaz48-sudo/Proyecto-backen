# Setup — no terminal required

Everything below is done from a phone or any browser: the Telegram app,
GitHub's website and Railway's dashboard. You never need to run a command.

**Current phase: 2.** The bot is private (invite-only), every photo becomes a
vehicle and a job in PostgreSQL, work runs in a background queue (Redis when
available), the original photo is stored, and the bot replies with a
**simulated** analysis and a caption. No paid AI API is used yet
(`MOCK_MODE=true`).

> **Already running Phase 0/1 on Railway?** Do steps **3, 4 and 5**, then
> redeploy. Until PostgreSQL is added, the bot answers every message with
> "the system is not configured yet" instead of processing photos.

---

## 1. Create your Telegram bot (2 minutes)

1. In Telegram, search for **@BotFather** (blue check mark) and open it.
2. Send `/newbot`.
3. Send a display name, e.g. `Mi Concesionario Bot`.
4. Send a username that ends in `bot`, e.g. `miconcesionario_contenido_bot`.
5. BotFather replies with a **token** like `123456789:AAE…`. Long-press → copy.
   Treat it like a password: anyone with it controls your bot.

## 2. Create the app service on Railway (5 minutes)

1. Go to **https://railway.com** and sign in with GitHub.
   Railway needs a plan with credits to keep services running; check their
   pricing page.
2. **New Project → Deploy from GitHub repo** → choose `Proyecto-backen`.
   If it isn't listed, tap *Configure GitHub App* and give Railway access to it.
3. Open the service → **Settings → Source → Branch** and pick
   `claude/automotive-content-automation-9rc90v` (until it is merged into
   `main`). Build settings come from `railway.json`; nothing else to set.
4. Keep **one** replica (Settings → Deploy → Replicas = 1). Two copies of the
   same bot in polling mode fight over messages.

## 3. Add PostgreSQL (1 minute) — required

1. In the project canvas tap **+ Create** (or **New**) → **Database** →
   **PostgreSQL**. Railway creates it in a few seconds.
2. Open your **app service** (not the database) → **Variables** →
   **New Variable** → **Add Reference** → pick the PostgreSQL service →
   **`DATABASE_URL`**. This links the app to the database without copying
   passwords around.

Database tables are created automatically on every deploy (migrations run
before the app starts). A demo dealership called "Concesionario Demo" is
created the first time.

## 4. Add Redis (1 minute) — recommended

1. **+ Create → Database → Redis**.
2. App service → **Variables → Add Reference** → Redis service →
   **`REDIS_URL`**.

Without Redis the app still works, but jobs live in memory: a restart in the
middle of processing loses the job's place in line (the app re-queues
unfinished jobs from the database when it starts, so nothing is lost for
good — it just restarts them).

## 5. App variables

App service → **Variables** → *New Variable* for each:

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `MOCK_MODE` | `true` |
| `BOOTSTRAP_CODE` | a secret word you invent, **12–64 characters**, only letters, digits, `-` and `_` — e.g. `Autos-Silva-Arranque-2026` |

Railway redeploys automatically when you save. Keep `BOOTSTRAP_CODE` private
until you've used it in step 6.

## 6. Become the owner (1 minute)

Open this link on your phone (replace both parts):

```
https://t.me/<your_bot_username>?start=<your BOOTSTRAP_CODE>
```

Telegram opens the bot and shows a **Start** button; tap it. The bot answers
"✅ ¡Listo! Tu cuenta quedó vinculada como **propietario**".

This works **once**: after the first person claims the dealership, the code is
useless. (You can delete the `BOOTSTRAP_CODE` variable afterwards.)

## 7. Invite your team

In the bot, send:

| Command | Creates a single-use link for… | Who can use it |
|---|---|---|
| `/invite` | an **operator** (sends photos) | owner, admin |
| `/invite editor` | an **editor** | owner, admin |
| `/invite admin` | an **admin** | owner only |

Forward the link to that person. It works once and expires in 72 hours.
Anyone without a link gets "🔒 Este bot es privado".

## 8. Test it

1. Send a photo of any car. You should get, within a few seconds:
   - `🚗 Analizando tu vehículo…`
   - a vehicle summary where every field is labelled ✅ *detectado*,
     🔎 *inferido* or ❔, plus what's still missing, and a **🧪 Modo demo** notice
   - a ready-to-post caption
2. **Restart test:** Railway → app service → ⋮ → **Restart**. Send another
   photo afterwards: it still works (everything now lives in PostgreSQL).
3. Send a PDF (refused) or plain text (asks for a photo).
4. From a second Telegram account without an invite: the bot refuses.

The analysis is **simulated** in MOCK_MODE: the same photo always gives the
same result, but it is not really recognising your car. Real recognition
arrives in Phase 4.

## 9. Check the status page

Service → **Settings → Networking → Generate Domain**, then open
`https://<your-domain>/health`:

```json
{
  "status": "ok",
  "database": "CONNECTED",
  "queue": { "backend": "redis", "state": "CONNECTED" },
  "storage": { "provider": "local-disk", "state": "CONNECTED", "durable": false },
  "telegram": "CONFIGURED",
  "warnings": ["Photos are stored on local disk and are lost on redeploy (set STORAGE_*).", "…"]
}
```

`warnings` tells you what is still worth configuring.

## 10. Optional: durable photo storage (Cloudflare R2)

Without this, original photos live on the server's disk and **are deleted on
every redeploy** (vehicles and captions in the database are kept). For
production, use any S3-compatible storage. Cloudflare R2 has a free tier
(Cloudflare may ask for a payment method to enable R2).

1. **dash.cloudflare.com → R2 Object Storage → Create bucket**, e.g.
   `dealer-media`. Keep it private (default).
2. **R2 → Manage API tokens → Create API token** → permission **Object Read &
   Write**, limited to that bucket → **Create**. Copy the **Access Key ID**,
   the **Secret Access Key** and the **S3 endpoint**
   (`https://<account-id>.r2.cloudflarestorage.com`). The secret is shown once.
3. App service → **Variables**, add all four:

   | Name | Value |
   |---|---|
   | `STORAGE_ENDPOINT` | the S3 endpoint |
   | `STORAGE_ACCESS_KEY` | Access Key ID |
   | `STORAGE_SECRET_KEY` | Secret Access Key |
   | `STORAGE_BUCKET` | `dealer-media` |

   (AWS S3 also needs `STORAGE_REGION`, e.g. `eu-west-1`; R2 uses the default
   `auto`.)
4. After the redeploy, `/health` shows `"provider": "s3", "durable": true`.

If you set only some of the four, the app refuses to start and the deploy log
names the missing ones.

## 11. Optional: webhook mode

Polling is fine for one bot. For webhook mode (Telegram pushes messages):

1. Generate a domain (step 9).
2. Add `TELEGRAM_MODE` = `webhook`, `TELEGRAM_WEBHOOK_URL` =
   `https://<your-domain>`, `TELEGRAM_WEBHOOK_SECRET` = a random 32+ character
   string (letters, digits, `_`, `-`).
3. Logs show `"telegram webhook registered"`. Back to polling:
   `TELEGRAM_MODE=polling`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bot says "El sistema aún no está configurado (falta la base de datos)" | Step 3: add PostgreSQL and the `DATABASE_URL` reference. |
| Bot says "🔒 Este bot es privado" to you | You haven't linked your account yet: step 6 (first time) or ask an owner/admin for `/invite`. |
| "Este sistema ya tiene propietario" | Someone already used the bootstrap code. Ask them for an `/invite admin` link. |
| Logs: `Invalid configuration: - X: …` | Variable X has a bad value; the message says why. Values are never printed. |
| Logs: `Cannot reach the database` | Check the `DATABASE_URL` reference points at the PostgreSQL service and that it's running. |
| Logs: `Telegram rejected the connection` | Token wrong/revoked (`/token` in BotFather gives a new one), or another deployment is polling the same bot. |
| `/health` shows `"durable": false` | Expected until step 10. |
| Deploy fails while "applying database migrations" | Open the deploy log; the Prisma error names the problem (usually `DATABASE_URL`). |

## Checking the code (no terminal)

Every push runs **GitHub Actions** (repo → *Actions* tab): typecheck, all
tests against real PostgreSQL and Redis, the production build and the Docker
image build. A green check next to the latest commit means the code is healthy.
