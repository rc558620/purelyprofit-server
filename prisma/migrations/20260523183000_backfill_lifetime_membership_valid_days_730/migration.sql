-- Backfill default lifetime membership valid days from 3650 to 730
UPDATE "membership_plan_settings"
SET
  "valid_days" = 730,
  "updated_at" = CURRENT_TIMESTAMP
WHERE
  "plan_id" = 'lifetime'
  AND "valid_days" = 3650;
