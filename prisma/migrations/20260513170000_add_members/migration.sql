-- CreateEnum
CREATE TYPE "MemberGender" AS ENUM ('UNKNOWN', 'MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "members" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "gender" "MemberGender" NOT NULL DEFAULT 'UNKNOWN',
    "level" TEXT NOT NULL DEFAULT '普通会员',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "birthday" TIMESTAMP(3),
    "last_consume_at" TIMESTAMP(3),
    "total_consume_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_consume_count" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "members_store_id_phone_key" ON "members"("store_id", "phone");

-- CreateIndex
CREATE INDEX "members_store_id_updated_at_idx" ON "members"("store_id", "updated_at");

-- CreateIndex
CREATE INDEX "members_store_id_status_updated_at_idx" ON "members"("store_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "members_store_id_level_updated_at_idx" ON "members"("store_id", "level", "updated_at");

-- CreateIndex
CREATE INDEX "members_phone_idx" ON "members"("phone");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
