-- AlterTable
ALTER TABLE "store_membership_profiles"
  ADD COLUMN "previous_plan_id" "MembershipPlanCycle";

-- 说明：降级到免费时把原档位转存到本列。
--
-- 设为免费会清空 current_plan_id，续费页因此无法判断「原本买的是哪一档」
-- （resolveStoredMembershipLevel 会回落成 'free'），曾开通子账号功能的门店
-- 会被错判成年度档、丢掉 AGES(永久) 的续费入口，故新增本列保留原档位。
--
-- 不回填历史数据：已被清空的 current_plan_id 无法可靠还原「原档位」，
-- 用付费订单反推可能把运营已主动收回的档位重新激活；留空后的行为与修复前一致，
-- 即历史降级门店维持现状，修复只对本次上线后的降级生效。
