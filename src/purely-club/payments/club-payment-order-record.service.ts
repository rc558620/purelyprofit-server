/**
 * 支付订单记录服务：按 out_trade_no 定位订单记录，并读写「这笔钱到底收在哪个商户号上」。
 *
 * 存在的理由：C 端有 RC / VC / SO / SF 四类订单，但它们共用同一个微信回调入口。
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

/** 已接入商户号落库/读取的订单类型 */
export type ClubPaymentRecordKind =
  | 'recharge'
  | 'voucher'
  | 'scan_ordering'
  | 'self_ordering';

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
    const recharge = await this.prisma.clubRechargeOrder.findUnique({
      where: { orderNo },
      select: MERCHANT_FIELDS,
    });
    if (recharge) return { kind: 'recharge', ...recharge };

    const voucher = await this.prisma.clubVoucherOrder.findUnique({
      where: { orderNo },
      select: MERCHANT_FIELDS,
    });
    if (voucher) return { kind: 'voucher', ...voucher };

    const scan = await this.prisma.scanOrderPaymentAttempt.findUnique({
      where: { merchantPaymentNo: orderNo },
      select: MERCHANT_FIELDS,
    });
    if (scan) return { kind: 'scan_ordering', ...scan };

    const self = await this.prisma.selfOrderPaymentAttempt.findUnique({
      where: { merchantPaymentNo: orderNo },
      select: SELF_ORDER_FIELDS,
    });
    if (self) {
      return {
        kind: 'self_ordering',
        storeId: self.order.storeId,
        spMchId: self.spMchId,
        subMchId: self.subMchId,
      };
    }

    return null;
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
    const recharge = await this.prisma.clubRechargeOrder.updateMany({
      where: { orderNo },
      data: { spMchId, subMchId },
    });
    if (recharge.count > 0) return 'recharge';

    const voucher = await this.prisma.clubVoucherOrder.updateMany({
      where: { orderNo },
      data: { spMchId, subMchId },
    });
    if (voucher.count > 0) return 'voucher';

    const scan = await this.prisma.scanOrderPaymentAttempt.updateMany({
      where: { merchantPaymentNo: orderNo },
      data: { spMchId, subMchId },
    });
    if (scan.count > 0) return 'scan_ordering';

    const self = await this.prisma.selfOrderPaymentAttempt.updateMany({
      where: { merchantPaymentNo: orderNo },
      data: { spMchId, subMchId },
    });
    if (self.count > 0) return 'self_ordering';

    this.logger.warn(
      `订单 ${orderNo} 未匹配到任何支付记录表，商户号未落库（订单类型可能尚未接入）`,
    );
    return null;
  }
}
