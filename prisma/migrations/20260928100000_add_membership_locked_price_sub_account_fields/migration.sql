-- 会员成交价快照：拆出「子账号加价」与「子账号数量」，
-- 支撑新的续费定价公式：
--     续费价 = 当前配置价 + 子账号加价
-- 其中「当前配置价」实时读取，平台涨价与降价都能传导给老客；
-- 「子账号加价」在成交时录入并长期锁定，续费时持续按这个金额收。
--
-- ⚠️ 成交总额不是下限：把成交价当护城河（旧模型的 max）会让平台降价时
--    老客被旧价托住、其它档位却跟降，档位之间出现比例倒挂。
--
-- 两列均可空：存量行按「未录入」处理，子账号加价以 0 参与计算，
-- 于是历史数据自动回退到纯配置价的旧口径，无需数据订正。
-- 运营在管理端补录子账号加价后即切换到新口径。

ALTER TABLE "store_membership_locked_prices"
  ADD COLUMN IF NOT EXISTS "sub_account_amount" INTEGER,
  ADD COLUMN IF NOT EXISTS "sub_account_count" INTEGER;
