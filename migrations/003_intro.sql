CREATE UNIQUE INDEX quest_intro_once ON quest_events(player_id,quest_id) WHERE event_type='INTRO_VIEWED';
