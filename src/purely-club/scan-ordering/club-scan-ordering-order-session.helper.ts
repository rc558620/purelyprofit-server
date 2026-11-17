/**
 * 扫码点餐建单前的会话语义校验。
 *
 * 会话「能下单」的判定条件（本人 / active / 未过期 / 绑定桌台 + 门店一致）
 * 集中在这里：建单、取消、后续新增的写路径都应复用同一口径，避免各处各写一套
 * 过滤条件导致订单落到用户已经离开的门店或桌台上。
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import type { CreateOrderSession } from './club-scan-ordering-order-create.helper';

/**
 * 建单会话：必须是本人的、未过期、未删除的 active 会话，且绑定了桌台。
 * 桌台及其区域 / 类型随会话一次查出，供 order.created 通知拼位置，省掉提交后补查。
 */
export const loadCreateSession = async (
  prisma: PrismaService,
  input: { clubUserId: number; sessionId: number },
): Promise<CreateOrderSession> => {
  const session = await prisma.scanOrderingSession.findFirst({
    where: {
      id: input.sessionId,
      clubUserId: input.clubUserId,
      status: 'active',
      expiresAt: { gt: new Date() },
      deletedAt: null,
    },
    include: {
      table: {
        select: {
          name: true,
          area: { select: { name: true } },
          type: { select: { name: true } },
        },
      },
    },
  });
  if (!session?.tableId)
    throw new ForbiddenException(
      clubScanOrderingError(
        CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_TABLE_SESSION_UNAVAILABLE,
        '当前桌台会话不可用，请重新扫码',
      ),
    );
  return session;
};

/**
 * 门店一致性：桌台会话所属门店必须等于当前门店。
 *
 * 扫桌码进店时后端已把当前门店切到桌台所属门店，正常情况下两者恒等；
 * 不等只可能是用户在别处（另一台设备 / 门店选择页）切了店，而本机还握着
 * 上一家店的会话——此时必须拦住，否则订单与新客额度会记到已离开的门店上。
 */
export const assertStoreConsistency = async (
  currentStoreContextService: ClubCurrentStoreContextService,
  user: AuthenticatedUser,
  sessionStoreId: number,
): Promise<void> => {
  const currentContext =
    await currentStoreContextService.requireCurrentContext(user);
  if (sessionStoreId !== currentContext.store.id) {
    throw new BadRequestException(
      clubScanOrderingError(
        CLUB_SCAN_ORDERING_ERROR_CODE.RULE_STORE_CHANGED,
        '当前门店已切换，请刷新页面后重试',
      ),
    );
  }
};
