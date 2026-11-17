import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  assertMemberCardUsable,
  type UsableMemberCardSnapshot,
} from './space-session-card.shared';
import type { OpenSessionSpaceContext } from './space-session-open-create.shared';
import type { NormalizedOpenSessionPayload } from './space-sessions.types';

/**
 * 解析开台会员卡快照：未使用会员卡返回 null，否则做只读可用性校验。
 *
 * 校验在事务内、建台之前完成——失败直接抛错且不落任何数据，
 * 避免「会话已建、卡不可用」这类需要补偿的中间态。
 */
export const resolveOpenSessionMemberCardSnapshot = async (
  transaction: Prisma.TransactionClient,
  space: OpenSessionSpaceContext,
  payload: NormalizedOpenSessionPayload,
): Promise<UsableMemberCardSnapshot | null> => {
  const { activeCardId, customerId } = payload;
  if (activeCardId === undefined) {
    return null;
  }
  if (customerId === undefined) {
    // ensureOpenSessionPayload 已在输入层拦截，此处防御根路径开台等旁路调用
    throw new BadRequestException('会员卡核销缺少会员信息，请重新识别会员');
  }

  return assertMemberCardUsable(transaction, {
    storeId: space.storeId,
    customerId,
    cardId: activeCardId,
    spaceTypeId: space.type.id,
    spaceTypeName: space.type.name,
    ...(payload.guestCount !== undefined
      ? { guestCount: payload.guestCount }
      : {}),
  });
};
