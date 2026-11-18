import { NotFoundException } from '@nestjs/common';
import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  mapRenewRecordRows,
  mapSessionItemRows,
} from './space-sessions.mapper';
import { buildSpaceSessionSettlementMoney } from './space-session-settlement.shared';
import { resolveGrouponVoucherFacts } from './space-care-record-snapshot.shared';
import type {
  SpaceSessionItemRow,
  SpaceSessionRenewRecordRow,
  SpaceSessionSettlementRecord,
} from './space-sessions.types';

/**
 * 分钟桶宽度（毫秒）：与 `calcDurationMinutes` 的分钟刻度严格对齐。
 * 桶边界必须等于「整分」边界，否则桶内结算分钟数不恒定。
 */
export const LIVE_PREVIEW_BUCKET_MS = 60_000;

/**
 * live-preview 缓存体内允许保存的字段：只有结算金额与展示标签。
 *
 * `asOf` 刻意不在其中 —— 前端用它跑倒计时，必须每次实时取 `Date.now()`，
 * 缓存里存一份就会让倒计时在命中缓存时倒退。
 */
export interface LivePreviewAmounts {
  durationMinutes: number;
  durationLabel: string;
  timeCost: number;
  itemsCost: number;
  renewDeduction: number;
  prepaidDeduction: number;
  /** 自助下单已在线支付商品的抵扣合计（元），从待付总额中冲减 */
  selfOrderDeduction: number;
  /** 开台团购券券面金额（元），仅纯消费模式且开台用券时 > 0 */
  voucherConsumption: number;
  totalAmount: number;
  timeFeeMode?: string;
  countdownFeeMode?: string;
}

/**
 * 预览前置查询的轻量投影：只够算 bucket、做权限校验与状态校验，
 * 不连带 items / renewRecords 两个子表。
 */
export interface LivePreviewTarget {
  id: number;
  storeId: number;
  startTime: Date;
  /** 与结账口径同源；当前不参与分键，券码变更由门店 pattern 失效兜底 */
  prepaidVoucherCode: string | null;
}

/** 缓存未命中路径所需的完整会话行（含 items / renewRecords） */
type LivePreviewSettlementRow = SpaceSessionSettlementRecord & {
  sessionItems: SpaceSessionItemRow[];
  sessionRenewRecords: SpaceSessionRenewRecordRow[];
};

/**
 * 计算 elapsed 分钟桶：`bucket = floor((now - startTime) / 60000)`。
 *
 * 时钟回拨 / startTime 在未来时兜底为 0，避免出现负 bucket 造成的键空间无限扩张。
 */
export function resolveLivePreviewBucket(
  startTimeMs: number,
  nowMs: number,
): number {
  return Math.max(
    0,
    Math.floor((nowMs - startTimeMs) / LIVE_PREVIEW_BUCKET_MS),
  );
}

/**
 * 桶内固定结算时点 = 桶起点 + 1ms。
 *
 * 为什么不用真实 `now`：`calcDurationMinutes` 用 `ceil` 向上取整，
 * `elapsed` 恰好等于桶起点（整分）时结果为 `bucket`、落在桶内其余位置时为
 * `bucket + 1`。取「桶起点 + 1ms」可以保证结果恒为 `bucket + 1`，
 * 既与真实 now 的分钟口径一致，又与真实毫秒无关 ⇒ 同桶金额恒定。
 */
export function resolveLivePreviewCheckoutAt(
  startTimeMs: number,
  bucket: number,
): number {
  return startTimeMs + bucket * LIVE_PREVIEW_BUCKET_MS + 1;
}

/**
 * 前置轻量查询：只取算 bucket / 鉴权所需字段。
 *
 * 校验口径与 `findActiveSessionForPreview` 完全一致：软删空间内的会话必须
 * 视为不存在，非 active 会话不可预览。禁止为了方便削弱这两个条件。
 */
export async function findLivePreviewTarget(
  prisma: PrismaService,
  sessionId: number,
): Promise<LivePreviewTarget> {
  const session = await prisma.spaceSession.findFirst({
    where: {
      id: sessionId,
      space: { deletedAt: null },
    },
    select: {
      id: true,
      storeId: true,
      startTime: true,
      status: true,
      prepaidVoucherCode: true,
    },
  });

  if (!session) {
    throw new NotFoundException('空间会话不存在');
  }

  if (session.status !== PrismaSpaceSessionStatus.active) {
    throw new NotFoundException('当前会话已结账，无法预览');
  }

  return session;
}

/**
 * 预览金额加载（缓存未命中路径）：给定桶内固定时点结算一次。
 *
 * 同一 bucket 下必须得到逐字段相同的金额；跨 bucket 由键版本保证换键回源。
 */
export async function buildLivePreviewAmounts(
  prisma: PrismaService,
  session: LivePreviewSettlementRow,
  bucket: number,
): Promise<LivePreviewAmounts> {
  const items = mapSessionItemRows(session.sessionItems);
  const renewRecords = mapRenewRecordRows(session.sessionRenewRecords);
  // 纯消费模式开台用券时，券面会额外生成一条正向消费行，
  // 展示名取团购商品名、利润按「券面 - 商品成本快照」计算
  const voucherFacts = await resolveGrouponVoucherFacts(
    prisma,
    session.storeId,
    session.prepaidVoucherCode,
  );

  const settlement = buildSpaceSessionSettlementMoney({
    session,
    checkoutAt: resolveLivePreviewCheckoutAt(
      session.startTime.getTime(),
      bucket,
    ),
    payload: {},
    items,
    renewRecords,
    voucherProductName: voucherFacts?.productName ?? null,
    voucherCost: voucherFacts ?? undefined,
  });

  return {
    durationMinutes: settlement.durationMinutes,
    durationLabel: settlement.durationLabel,
    timeCost: settlement.timeCostMoney.toOutputYuan(),
    itemsCost: settlement.itemsCostMoney.toOutputYuan(),
    renewDeduction: settlement.renewDeductionMoney.toOutputYuan(),
    prepaidDeduction: settlement.prepaidDeductionMoney.toOutputYuan(),
    selfOrderDeduction: settlement.selfOrderDeductionMoney.toOutputYuan(),
    voucherConsumption: settlement.voucherConsumptionMoney.toOutputYuan(),
    totalAmount: settlement.totalAmountMoney.toOutputYuan(),
    ...(settlement.timeFeeMode ? { timeFeeMode: settlement.timeFeeMode } : {}),
    ...(settlement.countdownFeeMode
      ? { countdownFeeMode: settlement.countdownFeeMode }
      : {}),
  };
}
