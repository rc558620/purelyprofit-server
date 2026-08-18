-- 打印代理设备表：同一门店可绑定多台电脑（收银台/后厨），各设备持有独立 token
CREATE TABLE "print_agents" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "device_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "version" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_agents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "print_agents_token_key" ON "print_agents"("token");
CREATE UNIQUE INDEX "print_agents_store_id_device_id_key" ON "print_agents"("store_id", "device_id");
CREATE INDEX "print_agents_store_id_idx" ON "print_agents"("store_id");
