-- 服务呼叫语音播报开关：门店级配置，默认关闭。
-- 餐饮/非餐饮账号通用（服务呼叫面向全部门店业态），商家端读写，
-- 控制商家端收到新的服务呼叫实时推送时是否播报语音。

ALTER TABLE "stores"
  ADD COLUMN "service_call_voice_enabled" BOOLEAN NOT NULL DEFAULT false;
