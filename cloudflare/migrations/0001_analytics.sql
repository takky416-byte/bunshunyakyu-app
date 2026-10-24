      CREATE TABLE IF NOT EXISTS plays (
        id TEXT PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        team TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('page_view','play_start','play_complete')),
        visitor_id TEXT NOT NULL,
        play_id TEXT,
        team TEXT,
        occurred_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS unique_play_event ON events(play_id, type) WHERE play_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS event_time ON events(occurred_at);
      CREATE INDEX IF NOT EXISTS play_time ON plays(started_at);

CREATE TRIGGER IF NOT EXISTS event_identity_guard BEFORE INSERT ON events
WHEN NEW.play_id IS NOT NULL AND EXISTS (
 SELECT 1 FROM plays WHERE id=NEW.play_id AND (visitor_id<>NEW.visitor_id OR team<>NEW.team)
) BEGIN SELECT RAISE(ABORT, 'Play identity mismatch'); END;
