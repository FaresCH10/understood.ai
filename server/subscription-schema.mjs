export function ensureSubscriptionSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS subscription_checkouts(
    request_id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),plan TEXT NOT NULL,
    environment TEXT NOT NULL CHECK(environment='sandbox'),state TEXT NOT NULL CHECK(state IN ('creating','ready','completed','needs_review')),
    transaction_id TEXT UNIQUE,created_at TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS subscription_checkout_open ON subscription_checkouts(org_id) WHERE state IN ('creating','ready','needs_review');
  CREATE TABLE IF NOT EXISTS subscription_payment_events(event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,occurred_at TEXT NOT NULL,received_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS subscription_allowance_grants(transaction_id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES subscription_checkouts(request_id),
    org_id TEXT NOT NULL REFERENCES organizations(id),plan TEXT NOT NULL,characters INTEGER NOT NULL CHECK(characters>0),transcription_minutes INTEGER NOT NULL CHECK(transcription_minutes>0),
    provider_budget_json TEXT NOT NULL,funding_state TEXT NOT NULL CHECK(funding_state='sandbox_only'),period_start TEXT NOT NULL,period_end TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES subscription_payment_events(event_id),created_at TEXT NOT NULL,CHECK(period_end>period_start));
  CREATE TRIGGER IF NOT EXISTS subscription_checkout_identity BEFORE UPDATE ON subscription_checkouts WHEN NEW.request_id<>OLD.request_id OR NEW.org_id<>OLD.org_id
    OR NEW.plan<>OLD.plan OR NEW.environment<>OLD.environment OR NEW.created_at<>OLD.created_at
    OR (OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS NOT OLD.transaction_id) OR (OLD.state='completed' AND NEW.state<>'completed')
    BEGIN SELECT RAISE(ABORT,'Subscription checkout identity is immutable');END;
  CREATE TRIGGER IF NOT EXISTS subscription_checkout_delete BEFORE DELETE ON subscription_checkouts BEGIN SELECT RAISE(ABORT,'Subscription checkout is immutable');END;`);
  for(const table of ['subscription_payment_events','subscription_allowance_grants'])for(const action of ['UPDATE','DELETE'])db.exec(
    `CREATE TRIGGER IF NOT EXISTS ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'Subscription evidence is immutable');END;`);
}
