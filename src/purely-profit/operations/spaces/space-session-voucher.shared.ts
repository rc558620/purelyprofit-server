// 空间会话-纯利宝团购券共享逻辑：券码读取校验与开台核销绑定（读取接口与开台事务共用）
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** 纯利宝团购券错误文案 */
export const VOUCHER_ALREADY_USED_MESSAGE = '该团购券已使用';
export const VOUCHER_NOT_FOUND_MESSAGE = '团购券不存在';
export const VOUCHER_REFUNDED_MESSAGE = '该团购券已退款，无法使用';
export const VOUCHER_EXPIRED_MESSAGE = '该团购券已过期';
export const VOUCHER_STORE_MISMATCH_MESSAGE =
  '该团购券不属于当前门店，无法使用';

/** 商家读取券码返回的团购券信息 */
export interface ReadVoucherResult {
  /** 团购平台（当前固定纯利宝） */
  platform: string;
  /** 团购券码 */
  voucherCode: string;
  /** 顾客姓名（purelyClub 昵称快照） */
  guestName: string | null;
  /** 客人电话（账号绑定手机号快照） */
  guestPhone: string | null;
  /** 到店人数 */
  personCount: number | null;
  /** 顾客类型（当前统一 member） */
  guestType: string;
  /** 券面金额（分） */
  faceAmountFen: number;
  /** purelyClub 在途余额（分）：该顾客在购买门店的储值余额 */
  balanceFen: number;
  /** 购买商品名称 */
  productName: string;
  /** 购买数量 */
  quantity: number;
  /** 订单状态 */
  status: string;
  /**
   * 开台计费预配置（来自券对应的团购券商品；
   * 商品不存在 / 非团购券商品时为空，前端保持默认计费方式）。
   */
  billing?: {
    /** 计费方式：items=纯消费 timed=纯计时 mixed=混合 countdown=倒计时 */
    billingMode: string;
    /** 计时单价（分，billingMode=timed/mixed 时有效） */
    hourlyRateFen: number | null;
    /** 预设时长（分钟，billingMode=countdown 时有效） */
    countdownMinutes: number | null;
    /** 台位费（分，billingMode=countdown 时有效） */
    countdownPriceFen: number | null;
    /** 到时自动结账（billingMode=countdown 时有效） */
    autoCheckout: boolean;
  };
}

/**
 * 查询并校验团购券可读性（读取接口与开台核销共用）：
 * - 不存在 / 跨门店 / 已退款 / 已过期 → 抛对应错误
 * - used 且已绑定开台会话（used-已开台）→ 抛"该团购券已使用"
 * - pending / used-未开台 → 可读取、可开台
 */
export async function assertVoucherReadable(
  tx: VoucherOrderStore,
  voucherCode: string,
  storeId: number,
): Promise<{
  id: number;
  customerId: number | null;
  voucherCode: string | null;
  platform: string;
  productId: number;
  productName: string;
  personCount: number | null;
  guestName: string | null;
  guestPhone: string | null;
  guestType: string;
  paidAmountFen: number;
  status: string;
  usedSessionId: number | null;
  quantity: number;
}> {
  const order = await tx.clubVoucherOrder.findFirst({
    where: { voucherCode, storeId },
  });
  if (!order) {
    throw new NotFoundException(VOUCHER_NOT_FOUND_MESSAGE);
  }
  if (order.status === 'refunded') {
    throw new BadRequestException(VOUCHER_REFUNDED_MESSAGE);
  }
  if (order.status === 'expired') {
    throw new BadRequestException(VOUCHER_EXPIRED_MESSAGE);
  }
  if (order.status === 'used' && order.usedSessionId !== null) {
    throw new BadRequestException(VOUCHER_ALREADY_USED_MESSAGE);
  }
  if (order.status !== 'pending' && order.status !== 'used') {
    throw new BadRequestException(VOUCHER_NOT_FOUND_MESSAGE);
  }
  return order;
}

/**
 * 开台事务内绑定纯利宝团购券（自动核销）返回值。
 * - bound: true 时携带 orderNo/voucherCode 供调用方广播实时事件
 * - bound: false 表示跳过核销（第三方券或非纯利宝平台券码）
 */
export interface BindVoucherResult {
  bound: boolean;
  orderNo?: string;
  voucherCode?: string;
}

/**
 * 开台事务内绑定纯利宝团购券（自动核销）：
 * - 券码在 club_voucher_orders 无记录（手工第三方券）→ 跳过，不影响原开台流程
 * - pending / used-未开台 → 置 used 并绑定会话（防并发用条件更新兜底）
 * - used-已开台 / 已退款 / 已过期 → 抛对应错误，阻断开台
 * @returns 是否发生了核销绑定及订单信息
 */
export async function bindVoucherOnOpen(
  tx: VoucherOrderStore,
  params: {
    voucherCode: string;
    voucherPlatform: string;
    storeId: number;
    sessionId: number;
  },
): Promise<BindVoucherResult> {
  // 仅纯利宝平台券码参与核销绑定；其他平台券保持原记录流程
  if (params.voucherPlatform !== 'chunlibao') {
    return { bound: false };
  }
  const order = await tx.clubVoucherOrder.findFirst({
    where: { voucherCode: params.voucherCode, storeId: params.storeId },
  });
  if (!order) {
    // 手工输入的纯利宝平台第三方券（非 purelyClub 团购券订单），跳过核销
    return { bound: false };
  }
  if (order.status === 'used' && order.usedSessionId !== null) {
    throw new BadRequestException(VOUCHER_ALREADY_USED_MESSAGE);
  }
  if (order.status === 'refunded') {
    throw new BadRequestException(VOUCHER_REFUNDED_MESSAGE);
  }
  if (order.status === 'expired') {
    throw new BadRequestException(VOUCHER_EXPIRED_MESSAGE);
  }
  if (order.status !== 'pending' && order.status !== 'used') {
    throw new BadRequestException(VOUCHER_NOT_FOUND_MESSAGE);
  }

  const bound = await tx.clubVoucherOrder.updateMany({
    where: {
      id: order.id,
      status: { in: ['pending', 'used'] },
      usedSessionId: null,
    },
    data: {
      status: 'used',
      usedAt: new Date(),
      usedStoreId: params.storeId,
      usedSessionId: params.sessionId,
    },
  });
  if (bound.count !== 1) {
    // 并发双开台：另一笔事务已抢先绑定
    throw new BadRequestException(VOUCHER_ALREADY_USED_MESSAGE);
  }
  return {
    bound: true,
    orderNo: order.orderNo,
    voucherCode: order.voucherCode ?? undefined,
  };
}

/** 与 PrismaService/事务客户端兼容的最小读写面（结构类型，两方均满足） */
interface VoucherOrderStore {
  clubVoucherOrder: {
    findFirst(
      args: Prisma.ClubVoucherOrderFindFirstArgs,
    ): Promise<Prisma.ClubVoucherOrderGetPayload<Record<string, never>> | null>;
    updateMany(
      args: Prisma.ClubVoucherOrderUpdateManyArgs,
    ): Promise<{ count: number }>;
  };
}
