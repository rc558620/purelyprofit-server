// 会员资产调整的防重复提交守卫（Redis 指纹去重，Redis 不可用时降级放行）
import { ConflictException } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import type { RedisService } from '../../../redis/redis.service';
import type { ResolvedMemberAssetAdjustment } from './members.types';

export interface MemberAssetDedupDeps {
  redisService: RedisService;
  logger: Logger;
}

/**
 * 资产调整防重复提交守卫。
 *
 * 基于「门店 + 会员 + 资产类型 + 金额 + 原因 + 操作人 + 幂等键/过期时间」指纹做 Redis 去重。
 * - 加入 operatorStaffId：避免不同管理员对同会员同金额同原因的合法调整被误判为重复。
 * - 若客户端传入 idempotencyKey，则以该键作为去重依据（每次请求唯一），彻底避免误伤；
 *   未传时回退到 expireAt（纯利豆无过期时间，退化为空串，仅作内容级兜底）。
 * Redis 不可用时降级放行（幂等性由 DB 原子相对更新兜底），不阻断正常调整。
 */
export const guardDuplicateMemberAssetAdjustment = async (
  deps: MemberAssetDedupDeps,
  assetLabel: string,
  adjustment: ResolvedMemberAssetAdjustment,
): Promise<void> => {
  const { redisService, logger } = deps;
  const dedupSignal =
    adjustment.idempotencyKey ?? adjustment.expireAt?.getTime() ?? '';
  const fingerprint = [
    'member-asset',
    'adjust',
    adjustment.member.storeId,
    adjustment.member.id,
    assetLabel,
    adjustment.delta,
    adjustment.reason,
    adjustment.operatorStaffId ?? '',
    dedupSignal,
  ].join(':');

  try {
    const acquired = await redisService.setIfAbsent(fingerprint, '1', 60);
    if (!acquired) {
      throw new ConflictException('请勿重复提交资产调整');
    }
  } catch (error) {
    if (error instanceof ConflictException) {
      throw error;
    }
    logger.warn(
      `[member-asset] 幂等校验跳过（Redis 不可用）: ${
        error instanceof Error ? error.message : 'unknown'
      }`,
    );
  }
};
