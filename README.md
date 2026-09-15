# nomu

WhatsApp baby feed tracker. See `tech-doc.md` for the full design.

## Setup

1. **Database (Supabase)**
   - Create a free project at supabase.com.
   - Copy the connection string (Session pooler, port 5432) into `.env` as `DATABASE_URL`.
   - Run migrations: `npm run migrate`

2. **Meta WhatsApp Cloud API**
   - Create a Meta app, add the WhatsApp product, use the free test number.
   - Set `WHATSAPP_TOKEN` (temporary or system-user token) and `WHATSAPP_PHONE_NUMBER_ID` in `.env`.
   - Set `WHATSAPP_VERIFY_TOKEN` in `.env` to any string of your choosing.
   - In the Meta app dashboard, configure the webhook URL to `https://<your-host>/webhook` with that same verify token.
   - Add up to 5 recipient numbers as verified testers (family members).

3. **Anthropic**
   - Set `ANTHROPIC_API_KEY` in `.env`.

4. **Register your family** (phone-number-as-identity — no signup flow, insert rows directly):

   ```sql
   INSERT INTO babies (name, birth_date) VALUES ('Baby Name', '2026-01-01') RETURNING id;

   INSERT INTO caregivers (phone_number, name) VALUES ('+15551234567', 'Mom') RETURNING id;

   INSERT INTO caregiver_baby (caregiver_id, baby_id, role) VALUES ('<caregiver-id>', '<baby-id>', 'parent');
   ```

   `phone_number` must match the `from` field WhatsApp sends, which is the number in international format without a leading `+` (e.g. `15551234567`) — check your webhook logs on first message to confirm the exact format.

5. **Run**

   ```bash
   npm run dev
   ```

   Expose it publicly for the Meta webhook during development, e.g. `ngrok http 3000`.

## Open decisions still pending (see tech-doc.md §7)

- Rate-limiting the webhook
- Undo/correction flow for bad log entries
- Confirming intake guideline numbers with a pediatrician before relying on them
