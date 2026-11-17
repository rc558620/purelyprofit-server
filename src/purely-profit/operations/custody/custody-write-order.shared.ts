// 客存 B 端写服务的纯组装逻辑：存入入参归一化 + 作废事务体（条件更新与解冻台账）
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { writeCustodyVoidReleaseLog } from '../../../shared/custody/custody-frozen-log';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { resolveExpireAt, type CustodyStockModeValue } from './custody.domain';
import type { CustodyCreateInput } from './custody.types';
import {
  CUSTODY_MEMBER_NOT_FOUND_MESSAGE,
  CUSTODY_ORDER_NOT_FOUND_MESSAGE,
} from './custody.constants';
import type { CreateCustodyOrderDto } from './dto/custody-request.dto';
import type { CustodySettingsDto } from './dto/custody-settings-response.dto';

/** 发起存入时已知的上下文（会员、经手人、门店设置均在事务外解析完毕） */
export interface BuildCustodyCreateInputParams {
  storeId: number;
  user: AuthenticatedUser;
  dto: CreateCustodyOrderDto;
  member: { id: number; name: string | null; phone: string | null };
  staffId: number | null;
  settings: CustodySettingsDto;
  now: Date;
}

/** 存入入参归一化：空串统一收敛为 null，到期时间按门店默认天数推导。 */
export const buildCustodyCreateInput = (
  params: BuildCustodyCreateInputParams,
): CustodyCreateInput => {
  const { storeId, user, dto, member, staffId, settings, now } = params;
  const fallbackName = member.phone ?? '';

  return {
    storeId,
    createdByStaffId: staffId,
    createdByName: user.name,
    member: {
      memberId: member.id,
      memberName: member.name || fallbackName,
      memberPhone: member.phone ?? '',
    },
    productId: dto.productId ?? null,
    productName: dto.productName,
    specName: dto.specName?.trim() ? dto.specName.trim() : null,
    unit: dto.unit,
    totalQty: dto.totalQty,
    location: dto.location?.trim() ? dto.location.trim() : null,
    storedAt: now,
    expireAt: resolveExpireAt(dto.expireAt, settings.defaultExpireDays, now),
    stockMode:
      (dto.stockMode as CustodyStockModeValue | undefined) ??
      settings.stockMode,
    sourceOrderId: dto.sourceOrderId ?? null,
    note: dto.note?.trim() ? dto.note.trim() : null,
    image: dto.image?.trim() ? dto.image.trim() : null,
    idempotencyKey: dto.idempotencyKey ?? null,
  };
};

/** 按手机号定位门店会员（禁用 / 软删会员视同不存在） */
export const findCustodyMember = async (
  prisma: PrismaService,
  storeId: number,
  phone: string,
) => {
  const member = await prisma.member.findFirst({
    where: { storeId, phone, deletedAt: null, status: { not: 'banned' } },
    select: { id: true, name: true, phone: true },
  });
  if (!member) {
    throw new NotFoundException(CUSTODY_MEMBER_NOT_FOUND_MESSAGE);
  }
  return member;
};

/** 按门店作用域定位存单（软删视同不存在） */
export const findCustodyOrder = async (
  prisma: PrismaService,
  storeId: number,
  orderId: number,
) => {
  const order = await prisma.custodyOrder.findFirst({
    where: { id: orderId, storeId, deletedAt: null },
  });
  if (!order) {
    throw new NotFoundException(CUSTODY_ORDER_NOT_FOUND_MESSAGE);
  }
  return order;
};

export interface VoidCustodyOrderInTransactionParams {
  tx: Prisma.TransactionClient;
  orderId: number;
  storeId: number;
  staffId: number | null;
  reason: string;
  now: Date;
  order: Prisma.CustodyOrderGetPayload<Record<string, never>>;
}

/**
 * 作废事务体：条件更新与解冻台账必须在同一事务。
 *
 * 并发下只有真正把状态改成 void 的那一次才释放冻结额度，
 * 各自判断会出现「状态没改成但台账已释放」。
 */
export const voidCustodyOrderInTransaction = async (
  params: VoidCustodyOrderInTransactionParams,
): Promise<void> => {
  const { tx, orderId, storeId, staffId, reason, now, order } = params;

  // 条件更新：并发下只允许一个请求把状态从 draft/stored 改为 void
  const updated = await tx.custodyOrder.updateMany({
    where: {
      id: orderId,
      storeId,
      deletedAt: null,
      status: { in: ['draft', 'stored'] },
    },
    data: {
      status: 'void',
      voidedByStaffId: staffId,
      voidedAt: now,
      voidReason: reason,
    },
  });
  if (updated.count === 0) {
    throw new ConflictException('存单状态已变更，请刷新列表后重试');
  }

  /*
   * 作废即释放剩余占用，可用库存回升，必须留痕。
   * draft 单从未占用过额度（冻结只算 stored），不能产生台账，否则两边抵消不平。
   */
  if (
    order.stockMode === 'frozen' &&
    order.productId !== null &&
    order.status === 'stored' &&
    order.remainingQty > 0
  ) {
    await writeCustodyVoidReleaseLog(tx, {
      storeId,
      productId: order.productId,
      productName: order.productName,
      qty: order.remainingQty,
      beforeRemainingQty: order.remainingQty,
      afterRemainingQty: 0,
      operatorStaffId: staffId,
      orderNo: order.orderNo,
      note: `客存作废解冻 ${order.remainingQty}${order.unit}（存单 ${order.orderNo}，物理库存未变动）`,
    });
  }
};
