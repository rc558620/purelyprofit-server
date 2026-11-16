/**
 * 支付订单记录服务：按 out_trade_no 定位订单记录，并读写「这笔钱到底收在哪个商户号上」。
 *
 * 存在的理由：C 端有 RC / VC / SO / SF / MC 五类订单，但它们共用同一个微信回调入口。
 * （SV 服务购买单只有 Redis 草稿、没有订单表，不在本服务的落库范围内，
 *   它的归属校验在 ClubPaymentsService 里走草稿解析门店，见该方法注释。）
 * 回调里带着权威的服务商号与子商户号（sp_mchid / sub_mchid），必须落到订单上，
 * 否则后续退款只能靠「门店当前配置」猜收款主体 —— 商家一旦换绑子商户，
 * 历史订单就会退到错误的账户（S0 级资金事故）。
 *
 * 因此本服务承担两件事，且**只允许**走这里，避免退款与回调各写一套查询逻辑：
 *   1. 按 out_trade_no 找到订单记录（含门店与已记录的商户号）
 *   2. 把回调里的商户号写回订单记录
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ORDER_NO_TYPE_MAP } from './club-order-no.constants';

/** 已接入商户号落库/读取的订单类型 */
export type ClubPaymentRecordKind =
  | 'recharge'
  | 'voucher'
  | 'scan_ordering'
  | 'self_ordering'
  | 'card';

export interface ClubPaymentRecordSnapshot {
  kind: ClubPaymentRecordKind;
  storeId: number;
  spMchId: string | null;
  subMchId: string | null;
}

const MERCHANT_FIELDS = {
  storeId: true,
  spMchId: true,
  subMchId: true,
} as const;

/**
 * 自助下单支付尝试本身没有 store_id（只有 order_id），
 * 必须经 SelfOrder 关联才能拿到门店 —— 退款定位收款主体靠的就是它。
 */
const SELF_ORDER_FIELDS = {
  spMchId: true,
  subMchId: true,
  order: { select: { storeId: true } },
} as const;

/** 兜底扫描顺序：与改造前的逐表顺序严格一致 */
const ORDER_TABLE_KINDS: readonly ClubPaymentRecordKind[] = [
  'recharge',
  'voucher',
  'card',
  'scan_ordering',
  'self_ordering',
];

/**
 * 正常路径按订单号前缀直查单表（1 次 DB 往返）；
 * 前缀未知或该表未命中时仍按原顺序扫其余表，兼容历史单号与草稿态订单，
 * 避免「前缀与实际落库表不一致」时静默跳过资金归属校验。
 */
const buildLookupOrder = (
  orderNo: string,
): readonly ClubPaymentRecordKind[] => {
  const kind = ORDER_NO_TYPE_MAP[orderNo.slice(0, 2).toUpperCase()];
  if (!kind || kind === 'service') return ORDER_TABLE_KINDS;
  return [kind, ...ORDER_TABLE_KINDS.filter((item) => item !== kind)];
};

@Injectable()
export class ClubPaymentOrderRecordService {
  private readonly logger = new Logger(ClubPaymentOrderRecordService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按 out_trade_no 查找订单记录。
   *
   * @returns null 表示该单号不属于任何已接入商户号落库的表
   *          （例如 SV 服务购买单、仍只存在于草稿态的订单），调用方应按「跳过校验」处理。
   */
  async findByOrderNo(
    orderNo: string,
  ): Promise<ClubPaymentRecordSnapshot | null> {
    const kinds = buildLookupOrder(orderNo);
    // 快路径：前缀可识别时第一个 kind 就是最可能的落库表，1 次往返命中即返回
    const first = await this.readRecord(kinds[0], orderNo);
    if (first) return first;
    if (kinds.length === 1) return null;

    // 兜底：其余表互不依赖，并发探测（原先串行最多 4 次往返，现收敛为 1 次往返）
    const restRecords = await Promise.all(
      kinds.slice(1).map((kind) => this.readRecord(kind, orderNo)),
    );
    return restRecords.find((record) => record !== null) ?? null;
  }

  /**
   * 把回调里权威的商户号写回订单记录（幂等：重复回调写同样的值）。
   *
   * @returns 实际写入的表；null 表示该单号未接入落库（不视为错误，由调用方决定是否告警）
   */
  async persistMerchantIdentity(
    orderNo: string,
    spMchId: string | null,
    subMchId: string | null,
  ): Promise<ClubPaymentRecordKind | null> {
    const kinds = buildLookupOrder(orderNo);
    // 快路径：先写最可能的表，正常回调 1 次往返完成
    if (await this.writeRecord(kinds[0], orderNo, spMchId, subMchId)) {
      return kinds[0];
    }

    // 兜底：并发探出真实落库表后再单表写，避免逐表串行写（最坏 4 写 → 1 读 + 1 写）
    const restMatched = await this.findFirstMatched(orderNo, kinds.slice(1));
    if (
      restMatched &&
      (await this.writeRecord(restMatched.kind, orderNo, spMchId, subMchId))
    ) {
      return restMatched.kind;
    }

    this.logger.warn(
      `订单 ${orderNo} 未匹配到任何支付记录表，商户号未落库（订单类型可能尚未接入）`,
    );
    return null;
  }

  /** 并发探测给定表，返回按 `kinds` 顺序的第一个命中记录 */
  private async findFirstMatched(
    orderNo: string,
    kinds: readonly ClubPaymentRecordKind[],
  ): Promise<ClubPaymentRecordSnapshot | null> {
    if (kinds.length === 0) return null;
    const records = await Promise.all(
      kinds.map((kind) => this.readRecord(kind, orderNo)),
    );
    return records.find((record) => record !== null) ?? null;
  }

  private async readRecord(
    kind: ClubPaymentRecordKind,
    orderNo: string,
  ): Promise<ClubPaymentRecordSnapshot | null> {
    switch (kind) {
      case 'recharge': {
        const row = await this.prisma.clubRechargeOrder.findUnique({
          where: { orderNo },
          select: MERCHANT_FIELDS,
        });
        return row ? { kind, ...row } : null;
      }
      case 'voucher': {
        const row = await this.prisma.clubVoucherOrder.findUnique({
          where: { orderNo },
          select: MERCHANT_FIELDS,
        });
        return row ? { kind, ...row } : null;
      }
      case 'card': {
        const row = await this.prisma.memberCardOrder.findUnique({
          where: { orderNo },
          select: MERCHANT_FIELDS,
        });
        return row ? { kind, ...row } : null;
      }
      case 'scan_ordering': {
        const row = await this.prisma.scanOrderPaymentAttempt.findUnique({
          where: { merchantPaymentNo: orderNo },
          select: MERCHANT_FIELDS,
        });
        return row ? { kind, ...row } : null;
      }
      case 'self_ordering': {
        const row = await this.prisma.selfOrderPaymentAttempt.findUnique({
          where: { merchantPaymentNo: orderNo },
          select: SELF_ORDER_FIELDS,
        });
        return row
          ? {
              kind,
              storeId: row.order.storeId,
              spMchId: row.spMchId,
              subMchId: row.subMchId,
            }
          : null;
      }
      default:
        return null;
    }
  }

  private async writeRecord(
    kind: ClubPaymentRecordKind,
    orderNo: string,
    spMchId: string | null,
    subMchId: string | null,
  ): Promise<boolean> {
    const data = { spMchId, subMchId };
    switch (kind) {
      case 'recharge':
        return (
          (
            await this.prisma.clubRechargeOrder.updateMany({
              where: { orderNo },
              data,
            })
          ).count > 0
        );
      case 'voucher':
        return (
          (
            await this.prisma.clubVoucherOrder.updateMany({
              where: { orderNo },
              data,
            })
          ).count > 0
        );
      case 'card':
        return (
          (
            await this.prisma.memberCardOrder.updateMany({
              where: { orderNo },
              data,
            })
          ).count > 0
        );
      case 'scan_ordering':
        return (
          (
            await this.prisma.scanOrderPaymentAttempt.updateMany({
              where: { merchantPaymentNo: orderNo },
              data,
            })
          ).count > 0
        );
      case 'self_ordering':
        return (
          (
            await this.prisma.selfOrderPaymentAttempt.updateMany({
              where: { merchantPaymentNo: orderNo },
              data,
            })
          ).count > 0
        );
      default:
        return false;
    }
  }
}
