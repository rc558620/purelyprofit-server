CREATE TABLE "space_qr_codes" (
    "id" SERIAL NOT NULL,
    "space_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "space_qr_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "space_qr_codes_space_id_key" ON "space_qr_codes"("space_id");
CREATE UNIQUE INDEX "space_qr_codes_token_key" ON "space_qr_codes"("token");
CREATE INDEX "space_qr_codes_store_id_idx" ON "space_qr_codes"("store_id");

ALTER TABLE "space_qr_codes"
ADD CONSTRAINT "space_qr_codes_space_id_fkey"
FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "space_qr_codes"
ADD CONSTRAINT "space_qr_codes_store_id_fkey"
FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
