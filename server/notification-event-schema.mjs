export function ensureNotificationEventSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS notification_events (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    audience TEXT NOT NULL CHECK(audience IN ('staff','worker')),recipient_id TEXT NOT NULL,
    kind TEXT NOT NULL,object_type TEXT NOT NULL CHECK(length(object_type) BETWEEN 1 AND 40),
    object_id TEXT NOT NULL CHECK(length(object_id) BETWEEN 1 AND 120),
    dedupe_key TEXT NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 160),
    created_at TEXT NOT NULL,
    UNIQUE(org_id,site_id,audience,recipient_id,dedupe_key)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS notification_events_inbox ON notification_events(org_id,site_id,audience,recipient_id,created_at DESC,id);
  CREATE TRIGGER IF NOT EXISTS notification_event_scope_insert BEFORE INSERT ON notification_events
    WHEN NOT EXISTS(SELECT 1 FROM sites s WHERE s.id=NEW.site_id AND s.org_id=NEW.org_id)
      OR (NEW.audience='worker' AND NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.recipient_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id))
      OR (NEW.audience='staff' AND NOT EXISTS(SELECT 1 FROM staff st WHERE st.id=NEW.recipient_id AND st.org_id=NEW.org_id AND st.site_id=NEW.site_id AND st.role IN ('owner','supervisor','auditor')))
    BEGIN SELECT RAISE(ABORT,'Notification event scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS notification_event_frozen_update BEFORE UPDATE ON notification_events
    BEGIN SELECT RAISE(ABORT,'Notification events are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS notification_event_frozen_delete BEFORE DELETE ON notification_events
    BEGIN SELECT RAISE(ABORT,'Notification events are immutable'); END;

  CREATE TABLE IF NOT EXISTS notification_event_reads (
    event_id TEXT NOT NULL REFERENCES notification_events(id),principal_type TEXT NOT NULL CHECK(principal_type IN ('staff','worker')),
    principal_id TEXT NOT NULL,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    read_at TEXT NOT NULL,PRIMARY KEY(event_id,principal_type,principal_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS notification_event_reads_owner ON notification_event_reads(org_id,site_id,principal_type,principal_id,event_id);
  CREATE TRIGGER IF NOT EXISTS notification_event_read_scope BEFORE INSERT ON notification_event_reads
    WHEN NOT EXISTS(SELECT 1 FROM notification_events e WHERE e.id=NEW.event_id AND e.org_id=NEW.org_id AND e.site_id=NEW.site_id
      AND e.audience=NEW.principal_type AND e.recipient_id=NEW.principal_id)
    BEGIN SELECT RAISE(ABORT,'Notification read scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS notification_event_read_immutable_update BEFORE UPDATE ON notification_event_reads
    BEGIN SELECT RAISE(ABORT,'Notification read receipt is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS notification_event_read_immutable_delete BEFORE DELETE ON notification_event_reads
    BEGIN SELECT RAISE(ABORT,'Notification read receipt is immutable'); END;

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    principal_type TEXT NOT NULL CHECK(principal_type IN ('staff','worker')),principal_id TEXT NOT NULL,
    session_hash TEXT NOT NULL CHECK(length(session_hash)=64),endpoint_hash TEXT NOT NULL CHECK(length(endpoint_hash)=64),
    endpoint TEXT NOT NULL CHECK(length(endpoint) BETWEEN 20 AND 2048),p256dh TEXT NOT NULL CHECK(length(p256dh) BETWEEN 4 AND 256),
    auth TEXT NOT NULL CHECK(length(auth) BETWEEN 4 AND 256),expires_at TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,
    revoked_at TEXT,revoke_reason TEXT CHECK(revoke_reason IS NULL OR length(revoke_reason) BETWEEN 1 AND 40)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_active_endpoint ON push_subscriptions(endpoint_hash) WHERE revoked_at IS NULL;
  CREATE INDEX IF NOT EXISTS push_subscriptions_owner ON push_subscriptions(org_id,site_id,principal_type,principal_id,revoked_at);
  CREATE INDEX IF NOT EXISTS push_subscriptions_session ON push_subscriptions(session_hash,revoked_at);
  CREATE TRIGGER IF NOT EXISTS push_subscription_scope_insert BEFORE INSERT ON push_subscriptions
    WHEN NOT EXISTS(SELECT 1 FROM sites s WHERE s.id=NEW.site_id AND s.org_id=NEW.org_id)
      OR (NEW.principal_type='worker' AND NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.principal_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id))
      OR (NEW.principal_type='staff' AND NOT EXISTS(SELECT 1 FROM staff st WHERE st.id=NEW.principal_id AND st.org_id=NEW.org_id AND st.site_id=NEW.site_id))
      OR NOT EXISTS(SELECT 1 FROM sessions se WHERE se.token_hash=NEW.session_hash AND se.org_id=NEW.org_id AND se.site_id=NEW.site_id
        AND se.principal_type=NEW.principal_type AND se.principal_id=NEW.principal_id AND se.revoked_at IS NULL)
    BEGIN SELECT RAISE(ABORT,'Push subscription scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS push_subscription_scope_update BEFORE UPDATE ON push_subscriptions
    WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
      OR NEW.principal_type IS NOT OLD.principal_type OR NEW.principal_id IS NOT OLD.principal_id
      OR NEW.endpoint_hash IS NOT OLD.endpoint_hash OR NEW.endpoint IS NOT OLD.endpoint
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
    BEGIN SELECT RAISE(ABORT,'Push subscription evidence is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS push_subscription_delete_frozen BEFORE DELETE ON push_subscriptions
    BEGIN SELECT RAISE(ABORT,'Push subscription evidence is immutable'); END;

  CREATE TABLE IF NOT EXISTS push_deliveries (
    id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES notification_events(id),subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id),
    state TEXT NOT NULL CHECK(state IN ('queued','sending','accepted','uncertain','failed','cancelled','expired')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),adapter TEXT CHECK(adapter IS NULL OR adapter IN ('disabled','synthetic','webpush')),
    next_attempt_at TEXT NOT NULL,accepted_at TEXT,last_error TEXT CHECK(last_error IS NULL OR length(last_error) BETWEEN 1 AND 40),
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(event_id,subscription_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS push_deliveries_due ON push_deliveries(state,next_attempt_at,created_at);
  CREATE INDEX IF NOT EXISTS push_deliveries_subscription ON push_deliveries(subscription_id,state);
  CREATE TRIGGER IF NOT EXISTS push_delivery_scope_insert BEFORE INSERT ON push_deliveries
    WHEN NOT EXISTS(SELECT 1 FROM notification_events e JOIN push_subscriptions s ON s.id=NEW.subscription_id
      WHERE e.id=NEW.event_id AND e.org_id=s.org_id AND e.site_id=s.site_id
        AND e.audience=s.principal_type AND e.recipient_id=s.principal_id)
    BEGIN SELECT RAISE(ABORT,'Push delivery scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS push_delivery_frozen_delete BEFORE DELETE ON push_deliveries
    BEGIN SELECT RAISE(ABORT,'Push delivery evidence is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS push_delivery_identity_frozen BEFORE UPDATE ON push_deliveries
    WHEN NEW.id IS NOT OLD.id OR NEW.event_id IS NOT OLD.event_id OR NEW.subscription_id IS NOT OLD.subscription_id
    BEGIN SELECT RAISE(ABORT,'Push delivery evidence is immutable'); END;`);
}
