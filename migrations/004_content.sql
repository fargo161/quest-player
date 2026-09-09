CREATE TABLE quest_content (
 quest_id uuid NOT NULL REFERENCES quests(id),
 state text NOT NULL,
 kind text NOT NULL,
 title text NOT NULL DEFAULT '' CHECK(length(title)<=120),
 body text NOT NULL DEFAULT '' CHECK(length(body)<=6000),
 image_url text, image_alt text NOT NULL DEFAULT '', video_url text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(quest_id,state),
 CHECK((kind='PARTICIPATION' AND state IN ('NONE','ACTIVE','COMPLETED')) OR (kind='REWARD' AND state IN ('ELIGIBLE','SELECTED','FULFILLED'))),
 CHECK(image_url IS NULL OR length(image_alt)>0)
);
CREATE TABLE content_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 quest_id uuid NOT NULL,
 state text NOT NULL,
 version integer NOT NULL,
 previous jsonb,
 content jsonb NOT NULL,
 operator text NOT NULL CHECK(length(trim(operator)) BETWEEN 1 AND 60),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
 request_id uuid NOT NULL UNIQUE REFERENCES action_requests(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(quest_id,state) REFERENCES quest_content(quest_id,state),
 UNIQUE(quest_id,state,version)
);
CREATE TRIGGER content_history_immutable BEFORE UPDATE OR DELETE ON content_revisions FOR EACH ROW EXECUTE FUNCTION preserve_history();
INSERT INTO quest_content(quest_id,state,kind,title,body,video_url)
 SELECT q.id,s.state,s.kind,
 CASE WHEN s.state='ACTIVE' THEN 'Before you begin' ELSE '' END,
 CASE WHEN s.state='ACTIVE' THEN q.intro_text ELSE '' END,
 CASE WHEN s.state='ACTIVE' THEN q.intro_video_url ELSE NULL END
 FROM quests q CROSS JOIN (VALUES ('NONE','PARTICIPATION'),('ACTIVE','PARTICIPATION'),('COMPLETED','PARTICIPATION'),('ELIGIBLE','REWARD'),('SELECTED','REWARD'),('FULFILLED','REWARD')) AS s(state,kind);
