import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import {
  CLUB_ORDER_ERROR_CODE,
  clubOrderError,
} from '../orders/club-orders.errors';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveEarnedPointsForSettlement } from '../orders/club-order-settlement-points.utils';
import { applyCustomerMetrics } from '../shared/club-customer-metrics.helper';
import {
  ACTIVE_CUSTOMER_SELECT,
  createBoundCustomer,
  resolveCustomerWithMerge,
  type ClubActiveMarketingCustomer,
} from './club-marketing-customer-directory.helper';

export type { ClubActiveMarketingCustomer };

/** 支付成功后的积分与消费落账入参。 */
export interface ScanOrderPointsSettlementInput {
  storeId: number;
  orderId: number;
  orderNo: string;
  customerId: number;
  /** 实付金额（分）：积分抵扣后的应付额。 */
  paidAmountFen: number;
  /** 本次抵扣的积分个数。 */
  pointsUsed: number;
  /** 本次抵扣对应的金额（分）。 */
  pointsDeductAmount: number;
  /** 支付渠道，决定 MarketingConsumption.payType。 */
  payType: 'balance' | 'wechat';
}

/** 支付成功后的积分与消费落账结果。 */
export interface ScanOrderPointsSettlementResult {
  earnedPoints: number;
}

@Injectable()
export class ClubScanOrderingMarketingCustomerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 支付成功后统一落账：扣减抵扣积分、按实付金额赠送积分、写入消费记录。
   *
   * 必须与支付方式无关：订单 payableAmount 存的已经是「积分抵扣后」的金额
   * （见 ClubScanOrderingOrderService.create），因此无论余额还是微信支付，
   * 只要收的是 payableAmount，就必须扣掉 pointsUsed，否则顾客可无限白拿抵扣。
   * 三条支付路径（余额 / 微信回调 / 开发态确认）都必须调用本方法。
   */
  async settlePaidOrder(
    tx: Prisma.TransactionClient,
    input: ScanOrderPointsSettlementInput,
  ): Promise<ScanOrderPointsSettlementResult> {
    const context = {
      storeId: input.storeId,
      description: `扫码点餐订单 ${input.orderNo}`,
      paidAmountFen: input.paidAmountFen,
    };

    // 只算不写：赠送积分先算出来，与抵扣积分合并成同一个增量
    const { earnedPoints, pointsMultiplier } =
      await resolveEarnedPointsForSettlement(tx, context, input.customerId);

    /*
     * 同一行只 UPDATE 一次：积分（−抵扣 + 赠送）、累计消费、到店次数、
     * 最近到店时间全部落在同一条 SET 里。
     *
     * 改造前是「扣抵扣积分 → 送消费积分 → 写指标」三次 UPDATE（外加跨档一次），
     * 每次都要重新锁同一行 marketing_customers；合并后行锁只拿一次，
     * 也顺带消除「扣了积分但指标写失败」这类中间态的时间窗。
     * 口径逐字段对齐原实现：
     *  - 积分：-pointsUsed + earnedPoints（原为两次 increment 的净效果）；
     *  - 抵扣不足：`points >= pointsUsed` 进 WHERE，命中 0 行即抛原错误；
     *  - 累计消费 / 次数 / 最近到店：仅当本次有消费金额时更新（原 if 条件）。
     */
    const consumptionAmountFen = input.paidAmountFen + input.pointsDeductAmount;
    const pointsDelta = earnedPoints - input.pointsUsed;
    if (pointsDelta !== 0 || consumptionAmountFen > 0) {
      const snapshot = await applyCustomerMetrics(tx, {
        customerId: input.customerId,
        storeId: input.storeId,
        pointsDelta,
        requirePointsGte: input.pointsUsed > 0 ? input.pointsUsed : undefined,
        totalSpentDelta: consumptionAmountFen > 0 ? consumptionAmountFen : 0,
        visitCountDelta: consumptionAmountFen > 0 ? 1 : 0,
        touchLastVisitAt: consumptionAmountFen > 0,
      });
      if (!snapshot && input.pointsUsed > 0) {
        throw new BadRequestException(
          clubOrderError(
            CLUB_ORDER_ERROR_CODE.RULE_POINTS_INSUFFICIENT,
            '积分不足或已被并发抵扣，当前积分无法完成扣减',
          ),
        );
      }
    }

    // 积分流水：两条记录合并成一条 createMany（同一张表，省一次往返）
    const pointsRecords = [
      ...(input.pointsUsed > 0
        ? [
            {
              storeId: input.storeId,
              customerId: input.customerId,
              amount: -input.pointsUsed,
              type: 'spend' as const,
              description: `消费抵扣积分（${context.description}）`,
            },
          ]
        : []),
      ...(earnedPoints > 0
        ? [
            {
              storeId: input.storeId,
              customerId: input.customerId,
              amount: earnedPoints,
              type: 'earn' as const,
              description:
                pointsMultiplier > 1
                  ? '消费获得积分（含双倍积分加成）'
                  : '消费获得积分',
            },
          ]
        : []),
    ];
    if (pointsRecords.length > 0) {
      await tx.marketingPointsRecord.createMany({ data: pointsRecords });
    }

    await tx.marketingConsumption.create({
      data: {
        storeId: input.storeId,
        customerId: input.customerId,
        amount: consumptionAmountFen,
        balancePaid: input.payType === 'balance' ? input.paidAmountFen : 0,
        pointsDeducted: input.pointsDeductAmount,
        // 积分侧事实源：与 pointsDeducted（金额分）配合可独立核对抵扣比例
        actualPointsDeducted: input.pointsUsed,
        payType: input.payType,
        itemsSummary: context.description,
      },
    });

    return { earnedPoints };
  }

  /**
   * 定位（必要时创建）当前门店下该用户的营销顾客档案。
   *
   * **只允许写路径调用**（下单 / 支付落账 / 充值）：本方法会 upsert 建档、
   * 归并 legacy 档案、认领孤儿余额，全部是写语义。只读预览请用
   * {@link findExistingCustomer}。
   *
   * 只有「归并 / 建档」这类写路径才需要事务：归并的并发安全由
   * {@link mergeIntoBoundCustomer} 的 CAS 保证，建档的并发安全由
   * {@link createBoundCustomer} 的 `ON CONFLICT DO NOTHING` 保证，
   * 都不依赖事务隔离。因此把占绝大多数的快路径摘到事务外——create /
   * balance-payment 每次少付 BEGIN + COMMIT 两次往返，且绑定档案与 user
   * 两次查询并行发起（原实现串行）。
   */
  async resolveActiveCustomer(
    storeId: number,
    clubUserId: number,
  ): Promise<ClubActiveMarketingCustomer> {
    const [boundCustomer, user] = await Promise.all([
      this.prisma.marketingCustomer.findFirst({
        where: { storeId, clubUserId, status: 'active', deletedAt: null },
        select: ACTIVE_CUSTOMER_SELECT,
      }),
      // legacy 档案定位需要 wechatPhone，建档时需要 name。
      // 放在事务外读：它只是归并/建档的输入，不参与任何 CAS 条件。
      this.prisma.user.findUnique({
        where: { id: clubUserId },
        select: { name: true, wechatPhone: true },
      }),
    ]);

    // 同手机号的 legacy 档案：无论绑定档案是否已有余额都要合并。此前只在
    // 绑定档案余额为 0 时才走这里，导致「先绑定、后充值」的用户与同号历史
    // 档案长期并存（同人双档案、两条余额各算一份）。
    const legacyCustomer = user?.wechatPhone
      ? await this.prisma.marketingCustomer.findFirst({
          where: {
            storeId,
            clubUserId: null,
            phone: user.wechatPhone,
            status: 'active',
            deletedAt: null,
          },
          select: ACTIVE_CUSTOMER_SELECT,
        })
      : null;

    // 快路径：绑定档案已存在、余额 > 0（无孤儿余额待归并）、无 legacy 档案可认领。
    if (boundCustomer && boundCustomer.balance > 0 && !legacyCustomer) {
      return boundCustomer;
    }

    // 无绑定档案也无 legacy 档案：只剩建档一步，upsert 自带幂等，无需事务。
    if (!boundCustomer && !legacyCustomer) {
      return createBoundCustomer(this.prisma, storeId, clubUserId, user);
    }

    const customer = await this.prisma.$transaction((tx) =>
      resolveCustomerWithMerge(
        tx,
        storeId,
        clubUserId,
        boundCustomer,
        legacyCustomer,
        user,
      ),
    );
    if (!customer) {
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_BALANCE_PAYMENT_NOT_ENABLED,
          '当前门店未开通余额支付，请先完成会员绑定或充值',
        ),
      );
    }
    return customer;
  }

  /**
   * **只读**定位已有顾客档案：预览链路专用。
   *
   * 预览是最高频的接口（购物车每次变化都会走一次），不允许因为它而写库：
   * - 不 upsert 建档：未建档顾客的预览返回 null，由调用方按「无会员资产」处理，
   *   建档只发生在下单 / 支付落账；
   * - 不归并、不认领 legacy 档案：归并要搬运余额并软删源档案，属写语义。
   *
   * 认人顺序与 {@link resolveActiveCustomer} 保持一致，只是去掉所有写动作：
   * 1. `(storeId, clubUserId)` 绑定档案（权威锚点）；
   * 2. 回落同门店「未绑定 + 同手机号」的历史档案，**只读不认领**。
   *
   * 第 2 步保证预览与下单拿到的是同一条档案：下单时若命中该 legacy 档案会
   * 补写 clubUserId（认领），档案 ID 不变，因此预览算出的消费次数 / 积分与
   * 下单时一致，不会出现「预览一个价、下单另一个价」。
   *
   * 注意：与写路径相比，这里有意**跳过**「绑定档案余额为 0 时认领门店内唯一
   * 孤儿余额档案」这一步——该步骤只影响余额，而预览不展示余额；消费次数与
   * 积分都挂在档案 ID 上，不随余额归并漂移。
   */
  async findExistingCustomer(
    storeId: number,
    clubUserId: number,
  ): Promise<ClubActiveMarketingCustomer | null> {
    const boundCustomer = await this.prisma.marketingCustomer.findFirst({
      where: { storeId, clubUserId, status: 'active', deletedAt: null },
      select: ACTIVE_CUSTOMER_SELECT,
    });
    // 快路径：已按 club_user_id 绑定，无需再按手机号兜底（绑定档案才是权威）。
    // 预览链路上绝大多数请求命中这条路径，因此不再预取 user.wechatPhone ——
    // 只有未绑定档案（新客 / 历史档案）才多花一次往返去取手机号。
    if (boundCustomer) {
      return boundCustomer;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: clubUserId },
      select: { wechatPhone: true },
    });
    if (!user?.wechatPhone) {
      return null;
    }

    return this.prisma.marketingCustomer.findFirst({
      where: {
        storeId,
        clubUserId: null,
        phone: user.wechatPhone,
        status: 'active',
        deletedAt: null,
      },
      select: ACTIVE_CUSTOMER_SELECT,
    });
  }
}
