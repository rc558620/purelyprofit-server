CREATE TYPE "ServiceCallSource" AS ENUM ('scan_ordering', 'club_home');
CREATE TYPE "ServiceCallType" AS ENUM ('waiter', 'water', 'checkout', 'other', 'assistance');
CREATE TYPE "ServiceCallStatus" AS ENUM ('pending', 'processing', 'completed', 'cancelled');

CREATE TABLE "service_calls" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "club_user_id" INTEGER NOT NULL,
    "source" "ServiceCallSource" NOT NULL,
    "type" "ServiceCallType" NOT NULL,
    "status" "ServiceCallStatus" NOT NULL DEFAULT 'pending',
    "location_label" VARCHAR(200),
    "remark" VARCHAR(200),
    "related_order_id" INTEGER,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "processed_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_calls_store_id_status_requested_at_idx"
    ON "service_calls"("store_id", "status", "requested_at");
CREATE INDEX "service_calls_club_user_id_store_id_type_requested_at_idx"
    ON "service_calls"("club_user_id", "store_id", "type", "requested_at" DESC);
CREATE INDEX "idx_service_calls_store_open"
    ON "service_calls"("store_id", "status", "requested_at")
    WHERE "status" IN ('pending', 'processing');
CREATE UNIQUE INDEX "uq_service_calls_club_user_store_type_open"
    ON "service_calls"("club_user_id", "store_id", "type")
    WHERE "status" IN ('pending', 'processing');
