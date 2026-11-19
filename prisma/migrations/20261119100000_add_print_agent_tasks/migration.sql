-- 打印代理任务台账：出票/补打的提交与回执状态，支撑失败可观测与补打去重
CREATE TYPE "PrintTaskStatus" AS ENUM ('submitted', 'printed', 'failed');

CREATE TABLE "print_agent_tasks" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "sale_order_id" INTEGER,
    "target" VARCHAR(16) NOT NULL,
    "device_id" VARCHAR(128),
    "status" "PrintTaskStatus" NOT NULL DEFAULT 'submitted',
    "forwarded" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "print_agent_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "print_agent_tasks_task_id_key" ON "print_agent_tasks"("task_id");
CREATE INDEX "print_agent_tasks_store_id_created_at_idx" ON "print_agent_tasks"("store_id", "created_at" DESC);
CREATE INDEX "print_agent_tasks_sale_order_id_created_at_idx" ON "print_agent_tasks"("sale_order_id", "created_at" DESC);
