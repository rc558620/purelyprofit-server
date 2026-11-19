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
}

/** 作废事务结果：状态已落库的存单行 + 作废前的真实状态 */
export interface VoidCustodyOrderResult {
  order: Prisma.CustodyOrderGetPayload<Record<string, never>>;
  previousStatus: 'draft' | 'stored';
}

/**
 * 作废事务体：条件更新与解冻台账必须在同一事务。
 *
 * 作废前的状态必须以事务内的实际状态为准，不能用事务外读到的快照：
 * 草稿在被读到的瞬间可能已被会员确认（draft → stored），此时作废同样成功，
 * 但按旧快照判断会漏记解冻台账。
 */
export const voidCustodyOrderInTransaction = async (
  params: VoidCustodyOrderInTransactionParams,
): Promise<VoidCustodyOrderResult> => {
  const { tx, orderId, storeId, staffId, reason, now } = params;

  /*
   * 先尝试按 stored 条件更新：命中说明这张单确实占用过冻结额度（含惰性过期单）。
   * 拆成两次条件更新而不是一次 in-list，是为了在并发下拿到「作废前到底处于哪个状态」。
   */
  const data = {
    status: 'void' as const,
    voidedByStaffId: staffId,
    voidedAt: now,
    voidReason: reason,
  };
  let previousStatus: 'draft' | 'stored' | null = null;
  const voidStored = await tx.custodyOrder.updateMany({
    where: { id: orderId, storeId, deletedAt: null, status: 'stored' },
    data,
  });
  if (voidStored.count > 0) {
    previousStatus = 'stored';
  } else {
    const voidDraft = await tx.custodyOrder.updateMany({
      where: { id: orderId, storeId, deletedAt: null, status: 'draft' },
      data,
    });
    if (voidDraft.count > 0) {
      previousStatus = 'draft';
    }
  }
  if (previousStatus === null) {
    throw new ConflictException('存单状态已变更，请刷新列表后重试');
  }

  // 状态变更后回读：余量可能已被并发取出改小，台账必须按实际余量释放
  const voided = await tx.custodyOrder.findUniqueOrThrow({
    where: { id: orderId },
  });

  /*
   * 作废即释放剩余占用，可用库存回升，必须留痕。
   * draft 单从未占用过额度（冻结只算 stored），不能产生台账，否则两边抵消不平。
   */
  if (
    previousStatus === 'stored' &&
    voided.stockMode === 'frozen' &&
    voided.productId !== null &&
    voided.remainingQty > 0
  ) {
    await writeCustodyVoidReleaseLog(tx, {
      storeId,
      productId: voided.productId,
      productName: voided.productName,
      qty: voided.remainingQty,
      operatorStaffId: staffId,
      orderNo: voided.orderNo,
      note: `客存作废解冻 ${voided.remainingQty}${voided.unit}（存单 ${voided.orderNo}，物理库存未变动）`,
    });
  }

  return { order: voided, previousStatus };
};
