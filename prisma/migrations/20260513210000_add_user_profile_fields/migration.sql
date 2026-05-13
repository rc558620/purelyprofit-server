-- AlterTable
ALTER TABLE "users"
ADD COLUMN "avatar" TEXT,
ADD COLUMN "real_name" TEXT,
ADD COLUMN "id_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_id_number_key" ON "users"("id_number");
