CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS members_name_trgm_idx
  ON members
  USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS members_phone_trgm_idx
  ON members
  USING GIN (COALESCE(phone, '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS marketing_customers_name_trgm_idx
  ON marketing_customers
  USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS finance_account_records_counterpart_trgm_idx
  ON finance_account_records
  USING GIN (counterpart gin_trgm_ops);

CREATE INDEX IF NOT EXISTS finance_reconciliation_records_title_trgm_idx
  ON finance_reconciliation_records
  USING GIN (title gin_trgm_ops);
