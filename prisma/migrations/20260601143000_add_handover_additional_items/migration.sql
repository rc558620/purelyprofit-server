CREATE TABLE "store_handover_additional_items" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_handover_additional_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_handover_additional_values" (
  "id" SERIAL NOT NULL,
  "record_id" INTEGER NOT NULL,
  "item_id" INTEGER NOT NULL,
  "value" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_handover_additional_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_handover_additional_items_store_id_name_key"
  ON "store_handover_additional_items"("store_id", "name");

CREATE INDEX "store_handover_additional_items_store_id_created_at_idx"
  ON "store_handover_additional_items"("store_id", "created_at");

CREATE UNIQUE INDEX "store_handover_additional_values_record_id_item_id_key"
  ON "store_handover_additional_values"("record_id", "item_id");

CREATE INDEX "store_handover_additional_values_item_id_created_at_idx"
  ON "store_handover_additional_values"("item_id", "created_at");

ALTER TABLE "store_handover_additional_items"
  ADD CONSTRAINT "store_handover_additional_items_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_handover_additional_values"
  ADD CONSTRAINT "store_handover_additional_values_record_id_fkey"
  FOREIGN KEY ("record_id") REFERENCES "store_handover_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_handover_additional_values"
  ADD CONSTRAINT "store_handover_additional_values_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "store_handover_additional_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
