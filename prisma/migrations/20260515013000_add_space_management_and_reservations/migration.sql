-- CreateEnum
CREATE TYPE "SpaceStatus" AS ENUM ('idle', 'occupied', 'reserved', 'cleaning');

-- CreateEnum
CREATE TYPE "SpaceReservationStatus" AS ENUM (
  'pending',
  'fulfilled',
  'cancelled'
);

-- CreateTable
CREATE TABLE "space_types" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "space_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_zones" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "space_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spaces" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "type_id" INTEGER NOT NULL,
  "zone_id" INTEGER,
  "name" TEXT NOT NULL,
  "capacity" INTEGER,
  "enable_dirty_room" BOOLEAN NOT NULL DEFAULT false,
  "auto_checkout" BOOLEAN NOT NULL DEFAULT false,
  "status" "SpaceStatus" NOT NULL DEFAULT 'idle',
  "sort_order" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_reservations" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "space_id" INTEGER NOT NULL,
  "guest_name" TEXT NOT NULL,
  "phone" TEXT,
  "reserved_at" TIMESTAMP(3) NOT NULL,
  "reserved_end_at" TIMESTAMP(3),
  "guest_count" INTEGER,
  "note" TEXT,
  "status" "SpaceReservationStatus" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "space_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "space_types_store_id_name_key"
  ON "space_types"("store_id", "name");

-- CreateIndex
CREATE INDEX "space_types_store_id_updated_at_idx"
  ON "space_types"("store_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "space_zones_store_id_name_key"
  ON "space_zones"("store_id", "name");

-- CreateIndex
CREATE INDEX "space_zones_store_id_updated_at_idx"
  ON "space_zones"("store_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "spaces_store_id_name_key"
  ON "spaces"("store_id", "name");

-- CreateIndex
CREATE INDEX "spaces_store_id_status_sort_order_idx"
  ON "spaces"("store_id", "status", "sort_order");

-- CreateIndex
CREATE INDEX "spaces_store_id_type_id_sort_order_idx"
  ON "spaces"("store_id", "type_id", "sort_order");

-- CreateIndex
CREATE INDEX "spaces_store_id_zone_id_sort_order_idx"
  ON "spaces"("store_id", "zone_id", "sort_order");

-- CreateIndex
CREATE INDEX "space_reservations_space_id_status_reserved_at_idx"
  ON "space_reservations"("space_id", "status", "reserved_at");

-- CreateIndex
CREATE INDEX "space_reservations_store_id_status_reserved_at_idx"
  ON "space_reservations"("store_id", "status", "reserved_at");

-- CreateIndex
CREATE INDEX "space_reservations_store_id_created_at_idx"
  ON "space_reservations"("store_id", "created_at");

-- AddForeignKey
ALTER TABLE "space_types"
  ADD CONSTRAINT "space_types_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_zones"
  ADD CONSTRAINT "space_zones_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces"
  ADD CONSTRAINT "spaces_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces"
  ADD CONSTRAINT "spaces_type_id_fkey"
  FOREIGN KEY ("type_id") REFERENCES "space_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces"
  ADD CONSTRAINT "spaces_zone_id_fkey"
  FOREIGN KEY ("zone_id") REFERENCES "space_zones"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_reservations"
  ADD CONSTRAINT "space_reservations_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_reservations"
  ADD CONSTRAINT "space_reservations_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
