# nomu

Baby feed tracker over Telegram. See `tech-doc.md` for the original design (written for WhatsApp; the project pivoted to Telegram — see note at the top of that doc — but the parsing/DB/calculation logic is unchanged).

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
   npm run dev
   ```

   No tunnel needed for local dev — long polling works from anywhere with outbound internet.

## Open decisions still pending (see tech-doc.md §7)

- Rate-limiting the poller/handler
- Undo/correction flow for bad log entries
- Confirming intake guideline numbers with a pediatrician before relying on them
