-- 扫码点餐打印代理：门店绑定码 + 代理令牌 + 最后在线时间。
-- 商家端生成绑定码展示给客户，客户在门店电脑上的打印代理中输入绑定码完成绑定，
-- 云端通过 WebSocket 向已绑定的门店代理推送 ESC/POS 打印任务。

ALTER TABLE "stores"
  ADD COLUMN "print_agent_bind_code" VARCHAR(16),
  ADD COLUMN "print_agent_token" VARCHAR(128),
  ADD COLUMN "print_agent_last_seen_at" TIMESTAMP(3);
