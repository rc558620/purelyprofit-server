CREATE TABLE "employee_shift_definitions" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "default_start_time" TEXT NOT NULL,
  "default_end_time" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "employee_shift_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_shift_definitions_store_id_name_key"
  ON "employee_shift_definitions"("store_id", "name");

CREATE UNIQUE INDEX "employee_shift_definitions_store_id_name_lower_key"
  ON "employee_shift_definitions"("store_id", LOWER("name"));

CREATE INDEX "employee_shift_definitions_store_id_updated_at_idx"
  ON "employee_shift_definitions"("store_id", "updated_at");

ALTER TABLE "employee_shift_definitions"
  ADD CONSTRAINT "employee_shift_definitions_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_shifts"
  ADD COLUMN "shift_definition_id" INTEGER,
  ADD COLUMN "shift_name" TEXT;

UPDATE "employee_shifts"
SET "shift_name" = CASE "shift_type"
  WHEN 'morning' THEN '早班'
  WHEN 'nine_to_six' THEN '行政班'
  WHEN 'middle' THEN '中班'
  WHEN 'late' THEN '晚班'
  WHEN 'full' THEN '全天'
  WHEN 'custom' THEN '自定义'
  ELSE '自定义'
END;

ALTER TABLE "employee_shifts"
  ALTER COLUMN "shift_name" SET NOT NULL;

CREATE INDEX "employee_shifts_shift_definition_id_date_idx"
  ON "employee_shifts"("shift_definition_id", "date");

ALTER TABLE "employee_shifts"
  ADD CONSTRAINT "employee_shifts_shift_definition_id_fkey"
  FOREIGN KEY ("shift_definition_id") REFERENCES "employee_shift_definitions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
