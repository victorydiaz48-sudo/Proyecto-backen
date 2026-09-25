# Setup — no terminal required

Everything below is done from a phone or any browser: the Telegram app,
GitHub's website and Railway's dashboard. You never need to run a command.

**Current phase: 1 (foundations).** The bot still runs the Phase 0 flow: it
receives a photo, runs a **simulated** vehicle analysis and replies with a
generated caption. No paid API is used.

**Updating from Phase 0 needs no changes on Railway** — no new variables, no
database yet. Phase 2 adds PostgreSQL (and optionally Redis); this file will
list those steps before you deploy it.

---

## 1. Create your Telegram bot (2 minutes)

1. In Telegram, search for **@BotFather** (blue check mark) and open it.
2. Send `/newbot`.
3. Send a display name, e.g. `Mi Concesionario Bot`.
4. Send a username that ends in `bot`, e.g. `miconcesionario_contenido_bot`.
5. BotFather replies with a **token** like `123456789:AAE…`. Long-press → copy.
   Treat it like a password: anyone with it controls your bot.

## 2. Deploy on Railway (5 minutes)

1. Go to **https://railway.com** and sign in with GitHub.
   Railway needs a plan with credits to keep a service running; check their
   pricing page. This bot uses very little.
2. **New Project → Deploy from GitHub repo** → choose `Proyecto-backen`.
   If it isn't listed, tap *Configure GitHub App* and give Railway access to it.
3. Railway starts a first deploy right away. That's fine — it will show the bot
   as *not configured* until you add the token.
4. Open the service → **Settings → Source → Branch** and pick the branch you
   want to deploy (`claude/automotive-content-automation-9rc90v` until it is
   merged into `main`).
   The build settings come from `railway.json` in the repo; nothing else to set.
5. Open the **Variables** tab → *New Variable*, add:

   | Name | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | the token from BotFather |
   | `MOCK_MODE` | `true` |

   Railway redeploys automatically when you save.
6. Open **Deployments → latest → View logs**. Within ~1 minute you should see
   a line containing `"telegram polling started"`.

> Keep **one** replica only (Settings → Deploy → Replicas = 1). Two copies of
> the same bot in polling mode fight over messages.

## 3. Test it

1. In Telegram, open your bot (search its username) and tap **Start**.
2. Send a photo of any car.
3. You should get, within a few seconds:
   - `🚗 Analizando tu vehículo…`
   - a vehicle summary where every field is labelled ✅ *detectado*,
     🔎 *inferido* or ❔ — plus the list of info still needed (precio,
     kilometraje, ciudad, contacto) and a **🧪 Modo demo** notice
   - a ready-to-post caption with hashtags

The analysis is **simulated** in MOCK_MODE: the same photo always gives the
same result, but it is not really recognising your car. Real recognition
arrives in Phase 4.

Also try: sending a PDF (should be refused), a tiny image (refused as too
small), or plain text (asks you for a photo).

## 4. Optional: health check URL

Service → **Settings → Networking → Generate Domain**. Then open
`https://<your-domain>/health` in the browser. You should see
`{"status":"ok", "telegram":"CONFIGURED", "vision":"CONNECTED", "mockMode":true, …}`.

## 5. Optional: webhook mode

Polling works fine for one bot. Webhook mode (Telegram pushes messages to
you) is useful at scale:

1. Generate a domain as in step 4.
2. Add variables:
   - `TELEGRAM_MODE` = `webhook`
   - `TELEGRAM_WEBHOOK_URL` = `https://<your-domain>`
   - `TELEGRAM_WEBHOOK_SECRET` = a random 32+ character string (letters,
     digits, `_`, `-`) from any password generator.
3. Logs should show `"telegram webhook registered"`.

To go back to polling, set `TELEGRAM_MODE=polling` (the webhook is removed
automatically).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Logs: `Invalid configuration: - X: …` | Variable X has a bad value; the message says why. Values are never printed. |
| Logs: `TELEGRAM_BOT_TOKEN is not set` | Add the variable (step 2.5). |
| Logs: `Telegram rejected the connection` | Token is wrong/revoked (get a new one with `/token` in BotFather), or another deployment is polling the same bot. |
| Bot doesn't answer, logs quiet | Check that the latest deployment is *Active* and you're on the right branch. |

## Checking the code builds (no terminal)

Every push runs **GitHub Actions** (repo → *Actions* tab): typecheck, all
tests, the production build and the Docker image build. A green check next to
the latest commit means the code is healthy.
