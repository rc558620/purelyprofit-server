// 提现申请的幂等键归一与重放校验（纯函数，无副作用）
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APPLY_IDEMPOTENCY_KEY_MAX_LENGTH } from './withdrawals.utils';
import type { WithdrawalRecordSnapshot } from './withdrawals.mapper';

export const resolveWithdrawalIdempotencyKey = (rawKey?: string): string => {
  const trimmed = rawKey?.trim();
  if (trimmed && trimmed.length <= APPLY_IDEMPOTENCY_KEY_MAX_LENGTH) {
    return trimmed;
  }
  // 老客户端未携带幂等键：服务端生成，保证同额合法二次申请也不会被误拒
  return `srv-${randomUUID()}`;
};

/** 幂等重放必须是同一笔申请：合伙人或金额不同即视为幂等键被挪用 */
export const assertSameWithdrawalApplication = (
  existing: WithdrawalRecordSnapshot,
  input: { partnerId: number; beanAmount: number },
): void => {
  if (
    existing.partnerId !== input.partnerId ||
    existing.beanAmount !== input.beanAmount
  ) {
    throw new ConflictException('幂等键已被其它提现申请使用，请重试');
  }
};
