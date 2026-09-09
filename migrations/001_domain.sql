CREATE TABLE players (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 public_id text NOT NULL UNIQUE CHECK (public_id ~ '^QP-[A-Z0-9]{5}$'),
 display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
 email text, email_verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 CHECK (email_verified_at IS NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX players_email_unique ON players(lower(email)) WHERE email IS NOT NULL;
CREATE TABLE events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id),
 slug text NOT NULL UNIQUE, name text NOT NULL, intro_text text NOT NULL DEFAULT '', intro_video_url text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE player_quests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES players(id),
 quest_id uuid NOT NULL REFERENCES quests(id), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED')),
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(player_id,quest_id), CHECK ((status='COMPLETED') = (completed_at IS NOT NULL))
);
CREATE TABLE rewards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quest_id uuid NOT NULL REFERENCES quests(id),
 name text NOT NULL, UNIQUE(quest_id,name)
);
CREATE TABLE player_rewards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES players(id),
 reward_id uuid NOT NULL REFERENCES rewards(id), status text NOT NULL DEFAULT 'ELIGIBLE' CHECK(status IN ('ELIGIBLE','SELECTED','FULFILLED')),
 eligible_at timestamptz NOT NULL DEFAULT now(), selected_at timestamptz, fulfilled_at timestamptz,
 suspended boolean NOT NULL DEFAULT false, UNIQUE(player_id,reward_id),
 CHECK ((status IN ('SELECTED','FULFILLED')) = (selected_at IS NOT NULL)),
 CHECK ((status='FULFILLED') = (fulfilled_at IS NOT NULL)), CHECK (status <> 'FULFILLED' OR NOT suspended)
);
CREATE TABLE action_requests (
 id uuid PRIMARY KEY, payload jsonb NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quest_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES players(id),
 quest_id uuid NOT NULL REFERENCES quests(id), event_type text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE operator_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES players(id),
 quest_id uuid NOT NULL REFERENCES quests(id), reward_id uuid REFERENCES rewards(id),
 operator text NOT NULL CHECK(length(trim(operator)) BETWEEN 1 AND 80), action text NOT NULL,
 reason text, details jsonb NOT NULL DEFAULT '{}', request_id uuid NOT NULL REFERENCES action_requests(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quest_events_player ON quest_events(player_id,created_at DESC);
CREATE INDEX operator_actions_player ON operator_actions(player_id,created_at DESC);
CREATE FUNCTION preserve_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Audit history is append-only'; END $$;
CREATE TRIGGER quest_history_immutable BEFORE UPDATE OR DELETE ON quest_events FOR EACH ROW EXECUTE FUNCTION preserve_history();
CREATE TRIGGER operator_history_immutable BEFORE UPDATE OR DELETE ON operator_actions FOR EACH ROW EXECUTE FUNCTION preserve_history();
CREATE FUNCTION preserve_fulfillment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='FULFILLED' THEN RAISE EXCEPTION 'Fulfillment is permanent; record an exception'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER fulfilled_immutable BEFORE UPDATE OR DELETE ON player_rewards FOR EACH ROW EXECUTE FUNCTION preserve_fulfillment();
INSERT INTO events(slug,name) VALUES ('as-above-so-below-2026','As Above So Below 2026');
INSERT INTO quests(event_id,slug,name,intro_text)
 SELECT id,'as-above-so-below','As Above So Below','Welcome to As Above So Below. Your player profile keeps your quest progress. Follow the instructions provided at the event, then visit Mission Control for staff confirmation.' FROM events WHERE slug='as-above-so-below-2026';
INSERT INTO rewards(quest_id,name) SELECT id,'Glass artwork giveaway' FROM quests WHERE slug='as-above-so-below';
