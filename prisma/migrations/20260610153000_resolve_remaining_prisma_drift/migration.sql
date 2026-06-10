ALTER TABLE "employee_shift_definitions"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "employee_shifts"
  ALTER COLUMN "shift_type" DROP NOT NULL;

ALTER TABLE "store_handover_additional_items"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "store_handover_additional_values"
  ALTER COLUMN "updated_at" DROP DEFAULT;
