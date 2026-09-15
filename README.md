# nomu

Baby feed tracker over Telegram. A caregiver texts free text ("120ml formula 8am"), the bot parses it with Claude, logs it, and tracks daily intake against a weight-and-age-based target. Multiple caregivers can log against the same baby.

## Setup

1. **Database (Supabase)**
   - Create a free project at supabase.com.
   - Copy the connection string (Session pooler, port 5432) into `.env` as `DATABASE_URL`.
   - Run migrations: `npm run migrate`

2. **Telegram bot**
   - Open Telegram, message **@BotFather**, send `/newbot`, follow the prompts (choose a name and a unique `_bot`-suffixed username).
   - BotFather replies with a token — put it in `.env` as `TELEGRAM_BOT_TOKEN`.
   - No webhook, no public URL, no approval process — the app long-polls Telegram for updates.

3. **Anthropic**
   - Set `ANTHROPIC_API_KEY` in `.env`.

4. **Register your family**

   Telegram identity is per-chat, not per-phone-number, so you need each caregiver's `chat_id` before seeding:
   - Have each caregiver open a DM with your bot and send any message (e.g. "hi").
   - Start the app (`npm run dev`) — if the chat isn't registered yet, the bot replies with that chat's ID.
   - Insert rows:

   ```sql
   INSERT INTO babies (name, birth_date) VALUES ('Baby Name', '2026-01-01') RETURNING id;

   INSERT INTO caregivers (telegram_chat_id, name) VALUES ('<chat-id-from-bot-reply>', 'Mom') RETURNING id;

   INSERT INTO caregiver_baby (caregiver_id, baby_id, role) VALUES ('<caregiver-id>', '<baby-id>', 'parent');
   ```

   - Message the bot again — it should now log/respond normally.

5. **Run**

   ```bash
   make dev
   ```

   No tunnel needed for local dev — long polling works from anywhere with outbound internet.

## Deployment (Railway)

The app is a single always-on Node process (long-polling Telegram + cron
jobs), no public URL required. Deployed here via Railway, driven through the
`Makefile` (run `make` with no args, or open the file, to see every target).

**First-time setup:**

```bash
npm install -g @railway/cli
make railway-login    # opens a browser for OAuth
make railway-init     # creates the Railway project + links this service
make env-push          # pushes every key in your local .env to Railway
make deploy             # railway up — builds and starts the app
```

Railway auto-detects Node.js via Nixpacks and runs `npm run build` then
`npm start`, so no Dockerfile/Procfile is needed — `package.json` already
defines those scripts.

**Verify:**

```bash
make status   # should show "Online"
make logs
```

You should see `telegram long-polling started` and `jobs scheduled: ...`
with no errors.

**Important — only one poller at a time.** Telegram's `getUpdates` (long
polling) only allows a single active connection per bot token. If you run
`make dev` locally while the Railway deployment is also up, both will
fight over the connection and you'll see repeated `409 Conflict` errors in
the logs. Stop the local dev server while the production one is polling
the same bot.

**After a code change:**

```bash
git push origin main   # keep git in sync (Railway deploys via CLI here, not git-connected auto-deploy)
make deploy
```

**After an env var change:**

```bash
make env-push
make redeploy
```

**Running a migration against the production database:** migrations run
against whatever `DATABASE_URL` is in your local `.env`, which is the same
Supabase instance Railway uses — just run `make migrate` locally, no
separate prod migration step needed.
