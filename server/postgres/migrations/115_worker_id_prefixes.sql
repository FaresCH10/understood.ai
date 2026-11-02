-- Organization-scoped prefixes used to generate new worker IDs.

CREATE TABLE organization_worker_ids (
  org_id text PRIMARY KEY REFERENCES organizations(id),
  prefix text NOT NULL CHECK (prefix ~ '^[A-Z0-9]{2,6}$'),
  updated_at timestamptz NOT NULL
);
