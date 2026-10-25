CREATE TABLE notification_events (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  site_id text NOT NULL REFERENCES sites(id),
  audience text NOT NULL CHECK (audience IN ('staff','worker')),
  recipient_id text NOT NULL,
  kind text NOT NULL,
  object_type text NOT NULL CHECK (length(object_type) BETWEEN 1 AND 40),
  object_id text NOT NULL CHECK (length(object_id) BETWEEN 1 AND 120),
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL,
  UNIQUE (org_id,site_id,audience,recipient_id,dedupe_key)
);
CREATE INDEX notification_events_inbox ON notification_events(org_id,site_id,audience,recipient_id,created_at DESC,id);
CREATE FUNCTION guard_notification_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Notification events are immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM sites s WHERE s.id=NEW.site_id AND s.org_id=NEW.org_id)
    OR (NEW.audience='worker' AND NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.recipient_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id))
    OR (NEW.audience='staff' AND NOT EXISTS(SELECT 1 FROM staff st WHERE st.id=NEW.recipient_id AND st.org_id=NEW.org_id
      AND st.site_id=NEW.site_id AND st.role IN ('owner','supervisor','auditor')))
  THEN RAISE EXCEPTION 'Notification event scope mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_event_guard BEFORE INSERT OR UPDATE OR DELETE ON notification_events
  FOR EACH ROW EXECUTE FUNCTION guard_notification_event();

CREATE TABLE notification_event_reads (
  event_id text NOT NULL REFERENCES notification_events(id),
  principal_type text NOT NULL CHECK (principal_type IN ('staff','worker')),
  principal_id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id),
  site_id text NOT NULL REFERENCES sites(id),
  read_at timestamptz NOT NULL,
  PRIMARY KEY (event_id,principal_type,principal_id)
);
CREATE INDEX notification_event_reads_owner ON notification_event_reads(org_id,site_id,principal_type,principal_id,event_id);
CREATE FUNCTION guard_notification_event_read() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Notification read receipt is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM notification_events e WHERE e.id=NEW.event_id AND e.org_id=NEW.org_id AND e.site_id=NEW.site_id
    AND e.audience=NEW.principal_type AND e.recipient_id=NEW.principal_id)
  THEN RAISE EXCEPTION 'Notification read scope mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_event_read_guard BEFORE INSERT OR UPDATE OR DELETE ON notification_event_reads
  FOR EACH ROW EXECUTE FUNCTION guard_notification_event_read();

CREATE TABLE push_subscriptions (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  site_id text NOT NULL REFERENCES sites(id),
  principal_type text NOT NULL CHECK (principal_type IN ('staff','worker')),
  principal_id text NOT NULL,
  session_hash text NOT NULL CHECK (length(session_hash)=64),
  endpoint_hash text NOT NULL CHECK (length(endpoint_hash)=64),
  endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 20 AND 2048),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 4 AND 256),
  auth text NOT NULL CHECK (length(auth) BETWEEN 4 AND 256),
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR length(revoke_reason) BETWEEN 1 AND 40)
);
CREATE UNIQUE INDEX push_subscriptions_active_endpoint ON push_subscriptions(endpoint_hash) WHERE revoked_at IS NULL;
CREATE INDEX push_subscriptions_owner ON push_subscriptions(org_id,site_id,principal_type,principal_id,revoked_at);
CREATE INDEX push_subscriptions_session ON push_subscriptions(session_hash,revoked_at);
CREATE FUNCTION guard_push_subscription() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Push subscription evidence is immutable'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.org_id,NEW.site_id,NEW.principal_type,NEW.principal_id,NEW.endpoint_hash,NEW.endpoint)
      IS DISTINCT FROM (OLD.id,OLD.org_id,OLD.site_id,OLD.principal_type,OLD.principal_id,OLD.endpoint_hash,OLD.endpoint)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at))
  THEN RAISE EXCEPTION 'Push subscription evidence is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM sites s WHERE s.id=NEW.site_id AND s.org_id=NEW.org_id)
    OR (NEW.principal_type='worker' AND NOT EXISTS(SELECT 1 FROM workers w WHERE w.id=NEW.principal_id AND w.org_id=NEW.org_id AND w.site_id=NEW.site_id))
    OR (NEW.principal_type='staff' AND NOT EXISTS(SELECT 1 FROM staff st WHERE st.id=NEW.principal_id AND st.org_id=NEW.org_id AND st.site_id=NEW.site_id))
    OR NOT EXISTS(SELECT 1 FROM sessions se WHERE se.token_hash=NEW.session_hash AND se.org_id=NEW.org_id AND se.site_id=NEW.site_id
      AND se.principal_type=NEW.principal_type AND se.principal_id=NEW.principal_id AND se.revoked_at IS NULL)
  THEN RAISE EXCEPTION 'Push subscription scope mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER push_subscription_guard BEFORE INSERT OR UPDATE OR DELETE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION guard_push_subscription();

CREATE TABLE push_deliveries (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES notification_events(id),
  subscription_id text NOT NULL REFERENCES push_subscriptions(id),
  state text NOT NULL CHECK (state IN ('queued','sending','accepted','uncertain','failed','cancelled','expired')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  adapter text CHECK (adapter IS NULL OR adapter IN ('disabled','synthetic','webpush')),
  next_attempt_at timestamptz NOT NULL,
  accepted_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (event_id,subscription_id)
);
CREATE INDEX push_deliveries_due ON push_deliveries(state,next_attempt_at,created_at);
CREATE INDEX push_deliveries_subscription ON push_deliveries(subscription_id,state);
CREATE FUNCTION guard_push_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Push delivery evidence is immutable'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id,NEW.event_id,NEW.subscription_id) IS DISTINCT FROM (OLD.id,OLD.event_id,OLD.subscription_id)
  THEN RAISE EXCEPTION 'Push delivery evidence is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM notification_events e JOIN push_subscriptions s ON s.id=NEW.subscription_id
    WHERE e.id=NEW.event_id AND e.org_id=s.org_id AND e.site_id=s.site_id
      AND e.audience=s.principal_type AND e.recipient_id=s.principal_id)
  THEN RAISE EXCEPTION 'Push delivery scope mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER push_delivery_guard BEFORE INSERT OR UPDATE OR DELETE ON push_deliveries
  FOR EACH ROW EXECUTE FUNCTION guard_push_delivery();
