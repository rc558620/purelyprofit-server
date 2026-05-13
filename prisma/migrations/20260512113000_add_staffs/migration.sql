-- CreateTable
CREATE TABLE "staffs" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staffs_store_id_idx" ON "staffs"("store_id");

-- AddForeignKey
ALTER TABLE "staffs" ADD CONSTRAINT "staffs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
