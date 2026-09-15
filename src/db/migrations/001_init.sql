CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    sex        TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE caregiver_baby (
    caregiver_id UUID REFERENCES caregivers(id),
    baby_id      UUID REFERENCES babies(id),
    role         TEXT,
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
    amount_ml    NUMERIC(6,2),
    feed_type    TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    duration_min INTEGER,
    logged_by    UUID REFERENCES caregivers(id),
    raw_message  TEXT,
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE intake_guidelines (
    id             SERIAL PRIMARY KEY,
    age_days_min   INTEGER NOT NULL,
    age_days_max   INTEGER NOT NULL,
    ml_per_kg_low  NUMERIC(5,2) NOT NULL,
    ml_per_kg_high NUMERIC(5,2) NOT NULL
);

INSERT INTO intake_guidelines (age_days_min, age_days_max, ml_per_kg_low, ml_per_kg_high) VALUES
    (0,   90,  150, 180),
    (91,  180, 120, 150),
    (181, 365, 90,  120);

CREATE INDEX idx_feeds_baby_started ON feeds (baby_id, started_at);
CREATE INDEX idx_weights_baby_measured ON weights (baby_id, measured_at);
