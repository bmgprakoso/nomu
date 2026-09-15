# Baby feed tracker (WhatsApp) — tech doc - Nomu

> **Update:** pivoted from WhatsApp (Meta Cloud API) to **Telegram**. Meta's Cloud API requires business verification even at hobby scale, and new/unverified WhatsApp Business Accounts were silently dropping messages (accepted by the API, never delivered) with no error surfaced — a dead end for a personal project. Telegram bots have no such review process and support long polling, so no public webhook URL is needed either. Sections below describe the original WhatsApp design; the parsing (§4), schema (§3, modulo `phone_number` → `telegram_chat_id`), and intake calculation (§5) carried over unchanged. See `README.md` for the current Telegram setup.

Personal project. A caregiver texts a WhatsApp number in free text ("120ml formula 8am"), the bot parses it, logs it, and tracks daily intake against a weight-and-age-based target. Multiple caregivers (parents, nanny) can log against the same baby.

---

## 1. Architecture

```
Caregiver (WhatsApp)
   │
   ▼
WhatsApp layer — Meta Cloud API (free test number, up to 5 recipients)
   │  webhook POST on inbound message
   ▼
Application layer — webhook server (Node/Express or Python/FastAPI)
   │
   ├─▶ AI parsing — Anthropic API (Claude), free text → structured JSON
   │
   ├─▶ Postgres — read/write feeds, weights, babies, caregivers
   │
   └─▶ Reply sent back via WhatsApp API

Background jobs (scheduler / cron)
   └─▶ daily digest, "no feed in N hours" nudge
```

**Why Meta Cloud API directly, not Twilio:** at personal volume every conversation is caregiver-initiated ("service conversation"), which is free under Meta's pricing. Twilio adds a per-message markup on top for no benefit at this scale. Meta's free developer test number supports up to 5 verified recipient numbers — enough for a family.

---

## 2. Tech stack

| Layer      | Choice                                 | Notes                                               |
| ---------- | -------------------------------------- | --------------------------------------------------- |
| Messaging  | Meta WhatsApp Cloud API (test number)  | Free at personal volume/recipient count             |
| App server | Node.js + Express, or Python + FastAPI | Thin layer: receive webhook → parse → store → reply |
| AI parsing | Anthropic API, `claude-sonnet-5`       | Structured JSON extraction from free text           |
| Database   | Postgres (Supabase or Neon free tier)  | Plenty of headroom for one baby's data              |
| Hosting    | Fly.io / Railway / Render              | Free or ~$5/mo hobby tier                           |
| Scheduler  | node-cron / simple cron job            | Daily digest, inactivity nudge                      |

**Estimated cost: ~$1–8/month**, almost entirely optional hosting; WhatsApp messaging and Claude parsing are near-zero at this scale (see §6).

---

## 3. Database schema

```sql
CREATE TABLE caregivers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT UNIQUE NOT NULL,
    name         TEXT,
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE babies (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    birth_date DATE NOT NULL,
    sex        TEXT,              -- optional; not used in intake calc, useful for growth percentile later
    created_at TIMESTAMPTZ DEFAULT now()
);

-- many-to-many: multiple caregivers per baby, and (future) multiple babies per caregiver
CREATE TABLE caregiver_baby (
    caregiver_id UUID REFERENCES caregivers(id),
    baby_id      UUID REFERENCES babies(id),
    role         TEXT,            -- e.g. 'parent', 'nanny'
    PRIMARY KEY (caregiver_id, baby_id)
);

CREATE TABLE weights (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baby_id      UUID REFERENCES babies(id),
    weight_kg    NUMERIC(5,2) NOT NULL,
    measured_at  TIMESTAMPTZ NOT NULL,
    logged_by    UUID REFERENCES caregivers(id)
);

CREATE TABLE feeds (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baby_id      UUID REFERENCES babies(id),
    amount_ml    NUMERIC(6,2),        -- null for direct breastfeeding logged by duration only
    feed_type    TEXT NOT NULL,       -- 'formula' | 'breast_milk' | 'breastfeeding_direct'
    started_at   TIMESTAMPTZ NOT NULL,
    duration_min INTEGER,             -- for direct breastfeeding
    logged_by    UUID REFERENCES caregivers(id),
    raw_message  TEXT,                -- original WhatsApp text, kept for debugging/re-parsing
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- lookup table so guideline numbers are data, not hardcoded logic
CREATE TABLE intake_guidelines (
    id            SERIAL PRIMARY KEY,
    age_days_min  INTEGER NOT NULL,
    age_days_max  INTEGER NOT NULL,
    ml_per_kg_low NUMERIC(5,2) NOT NULL,
    ml_per_kg_high NUMERIC(5,2) NOT NULL
);

INSERT INTO intake_guidelines (age_days_min, age_days_max, ml_per_kg_low, ml_per_kg_high) VALUES
    (0,   90,  150, 180),   -- 0–3 months
    (91,  180, 120, 150),   -- 3–6 months
    (181, 365, 90,  120);   -- 6–12 months (also drops further as solids increase)
```

**Design notes:**

- `caregiver_baby` as a join table (not a FK on `babies`) so multiple caregivers can log to one baby, and a caregiver could later cover more than one baby.
- `weights` is history, not a single column on `babies` — needed to detect stale data and (later) plot growth.
- `intake_guidelines` is a small table, not hardcoded constants — update it if your pediatrician gives different numbers, no code change needed.
- `sex` is stored but **not used** in the intake formula — only relevant later for percentile-based growth charts (WHO/CDC curves are sex-specific).

---

## 4. Message parsing

Send the caregiver's raw text to Claude with a system prompt that forces structured JSON output:

```
System prompt (fill in current ISO timestamp each call):

You extract structured data from a caregiver's WhatsApp-style message about a
baby's feeding or weight. The current date and time is {now_iso}.
Respond with ONLY raw JSON, no markdown fences, no explanation, matching exactly:

{
  "intent": "feed" | "weight" | "query" | "unknown",
  "amount": number|null,
  "unit": "ml"|"oz"|null,
  "feed_type": "formula"|"breast_milk"|"breastfeeding"|null,
  "time_iso": string|null,
  "weight_kg": number|null,
  "confidence": "high"|"low"
}

Rules:
- Resolve relative times ("8am","just now","10 mins ago") against current
  date/time into a full ISO 8601 timestamp.
- Convert lb to kg if given (1 lb = 0.453592 kg).
- "how am I doing" / "today?" / "stats" → intent "query".
- If ambiguous or low confidence, use intent "unknown", confidence "low" —
  reply asking the caregiver to clarify rather than guessing.
```

- oz → ml conversion: `ml = oz * 29.5735`
- Low-confidence or "unknown" parses should get a clarifying reply, never a silent guess — this is what keeps trust in the log.
- Store `raw_message` alongside the parsed result so a bad parse can be corrected or re-run later.

---

## 5. Daily intake calculation

```
age_days = today - baby.birth_date

rate = SELECT ml_per_kg_low, ml_per_kg_high
       FROM intake_guidelines
       WHERE age_days BETWEEN age_days_min AND age_days_max

latest_weight = SELECT weight_kg FROM weights
                WHERE baby_id = :id ORDER BY measured_at DESC LIMIT 1

target_low  = latest_weight * rate.ml_per_kg_low
target_high = latest_weight * rate.ml_per_kg_high

today_total = SELECT SUM(amount_ml) FROM feeds
              WHERE baby_id = :id
                AND started_at::date = CURRENT_DATE
                AND feed_type != 'breastfeeding_direct'   -- volume-based only
```

**Caveats to surface in the bot's reply, not just bury in code:**

- Target range only applies to bottle/formula/pumped feeds — direct breastfeeding isn't volume-trackable; track frequency/duration for that instead.
- If `latest_weight.measured_at` is more than ~2–3 weeks old, flag the target as based on stale weight (babies grow fast).
- Gender/sex is not a factor in this formula — only relevant if you later add percentile-based growth tracking.
- These are general guideline numbers, not medical advice — always secondary to pediatrician guidance, especially for premature or medically monitored infants.

---

## 6. Cost estimate (personal use)

| Item                                             | Monthly cost    |
| ------------------------------------------------ | --------------- |
| WhatsApp messaging (Meta Cloud API, test number) | $0              |
| Claude API parsing (~10–15 msgs/day)             | ~$1–3           |
| Hosting (Fly.io / Railway free–hobby tier)       | $0–5            |
| Postgres (Supabase / Neon free tier)             | $0              |
| **Total**                                        | **~$1–8/month** |

Test number caps at 5 recipients — fine for a family. Going beyond that (verified business number, wider audience) introduces Meta per-conversation charges for any bot-initiated message (e.g. proactive nudges).

---

## 7. Open decisions / TODO before building

- [x] Pick Node/Express vs Python/FastAPI for the webhook server — Node/Express/TypeScript
- [x] Decide phone-number-as-identity vs a lightweight account layer — Telegram `chat_id`-as-identity (post-pivot equivalent)
- [ ] Confirm intake guideline numbers with pediatrician before hardcoding into `intake_guidelines`
- [x] Decide how "undo last entry" / correction flow should work — caregiver texts "undo"/"oops", deletes their own most recent feed or weight entry immediately, no confirmation step
- [x] Rate-limit the message handler (Claude API call runs per inbound message) — 10 msgs/min per caregiver, in-memory sliding window (`RATE_LIMIT_PER_MINUTE`)
- [x] Decide daily digest time and inactivity-nudge threshold — defaults 20:00 local, 6h since last feed; configurable via `DIGEST_TIME` / `NUDGE_THRESHOLD_HOURS`

## 8. Suggested build order

1. Postgres schema (§3) + seed `intake_guidelines`
2. Webhook server skeleton, wired to Meta Cloud API test number, echo replies
3. Wire in Claude parsing (§4), log parsed feed/weight entries
4. Daily total + target range calculation (§5), returned in confirmation replies
5. `"today?"` / `"stats"` query intent
6. Background job: daily digest + inactivity nudge
7. (Optional later) multi-baby disambiguation, undo/correction flow, growth percentile tracking
