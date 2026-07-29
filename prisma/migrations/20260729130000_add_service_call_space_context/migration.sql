ALTER TABLE "service_calls" ADD COLUMN "space_id" INTEGER;

CREATE INDEX "service_calls_space_id_idx" ON "service_calls"("space_id");
