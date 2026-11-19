-- Sandbox billing preparation. These records never activate production access.
CREATE TABLE subscription_checkouts (
 request_id uuid PRIMARY KEY,
 org_id text NOT NULL REFERENCES organizations(id),
 plan text NOT NULL CHECK(plan IN ('starter','pro','business','enterprise')),
 environment text NOT NULL CHECK(environment='sandbox'),
 state text NOT NULL CHECK(state IN ('creating','ready','completed','needs_review')),
 transaction_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(request_id,org_id)
);
CREATE UNIQUE INDEX subscription_checkout_open ON subscription_checkouts(org_id) WHERE state IN ('creating','ready','needs_review');
CREATE TABLE subscription_payment_events (
 event_id text PRIMARY KEY,
 event_type text NOT NULL,
 occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE subscription_allowance_grants (
 transaction_id text PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES subscription_checkouts(request_id),
 org_id text NOT NULL REFERENCES organizations(id),
 plan text NOT NULL,
 characters integer NOT NULL CHECK(characters>0),
 transcription_minutes integer NOT NULL CHECK(transcription_minutes>0),
 provider_budget_json jsonb NOT NULL,
 funding_state text NOT NULL DEFAULT 'sandbox_only' CHECK(funding_state='sandbox_only'),
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL CHECK(period_end>period_start),
 event_id text NOT NULL REFERENCES subscription_payment_events(event_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION guard_subscription_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Subscription evidence is immutable';
END $$;
CREATE TRIGGER subscription_payment_events_immutable BEFORE UPDATE OR DELETE ON subscription_payment_events
 FOR EACH ROW EXECUTE FUNCTION guard_subscription_ledger();
CREATE TRIGGER subscription_allowance_grants_immutable BEFORE UPDATE OR DELETE ON subscription_allowance_grants
 FOR EACH ROW EXECUTE FUNCTION guard_subscription_ledger();
CREATE FUNCTION guard_subscription_checkout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Subscription checkout is immutable'; END IF;
 IF NEW.request_id<>OLD.request_id OR NEW.org_id<>OLD.org_id OR NEW.plan<>OLD.plan OR NEW.environment<>OLD.environment
   OR NEW.created_at<>OLD.created_at OR (OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id)
   OR (OLD.state='completed' AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'Subscription checkout identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_checkout_identity BEFORE UPDATE OR DELETE ON subscription_checkouts
 FOR EACH ROW EXECUTE FUNCTION guard_subscription_checkout();
