-- 空间管理语音播报开关：门店级配置，默认关闭。
-- 商家端读写（/spaces/voice-settings），控制空间管理页收到自助下单新订单实时推送时是否播报语音。

ALTER TABLE "stores"
  ADD COLUMN "space_management_voice_enabled" BOOLEAN NOT NULL DEFAULT false;
