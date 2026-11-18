import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toOptionalText } from '../../commerce/commerce.utils';
import { InventoryService } from '../../goods/inventory/inventory.service';
import { MembershipDowngradeService } from '../../member/platform-membership/membership-downgrade.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import type {
  CreateSalesRecordDto,
  SalesRecordResponseDto,
} from './dto/sales-record.dto';

import { SalesRecordCreateFlowService } from './sales-record-create-flow.service';
import {
  SalesRecordItemPreparationService,
  type CreateSalesRecordOptions,
} from './sales-record-item-preparation.service';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';
import { SalesRecordIdempotencyService } from './sales-record-idempotency.service';

@Injectable()
export class SalesRecordWriteService {
  private readonly logger = new Logger(SalesRecordWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly inventoryService: InventoryService,
    private readonly salesRecordItemPreparationService: SalesRecordItemPreparationService,
    private readonly salesRecordCreateFlowService: SalesRecordCreateFlowService,
    private readonly downgradeService: MembershipDowngradeService,
    private readonly salesRecordIdempotencyService: SalesRecordIdempotencyService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateSalesRecordDto,
    options: CreateSalesRecordOptions = {},
  ): Promise<SalesRecordResponseDto> {
    const storeId = options.skipAccessCheck
      ? user.currentMembership
        ? await this.commerceAccessService.resolveSingleStoreId(
            user,
            dto.storeId,
            'operation-entry:create',
            '无权操作该门店销售记录',
          )
        : this.requireTrustedStoreId(dto.storeId)
      : await this.commerceAccessService.resolveSingleStoreId(
          user,
          dto.storeId,
          'sales:create',
          '无权操作该门店销售记录',
        );
    // 会员过期后的差异化限制：追加点单禁用（手动录单限额在 scan-ordering 侧）。
    // 未声明 source 的来源（空间结账、老版本前端等）不受影响。
    await this.applyMembershipDowngradeGuards(storeId, dto.source);

    const orderDate = new Date(dto.date ?? Date.now());
    const operatorStaffId = await this.resolveOperatorStaffId(user, storeId);

    /*
     * 幂等只在「调用方直接提交、自己持有事务」时启用。
     * 传了 transactionClient 的调用方（空间结账、扫码点餐桥接）由外层事务决定
     * 提交结果，此刻写 succeeded 快照可能与最终回滚结论相反，故不参与幂等。
     */
    const idempotencyKey = options.transactionClient
      ? null
      : this.salesRecordIdempotencyService.normalizeKey(options.idempotencyKey);
    const requestHash = idempotencyKey
      ? this.salesRecordIdempotencyService.hashRequest({ storeId, dto })
      : null;

    // 先查重：命中历史记录时连商品目录都不必加载
    if (idempotencyKey && requestHash) {
      const replayed = await this.findIdempotentReplay(
        user.id,
        idempotencyKey,
        requestHash,
      );
      if (replayed) {
        return replayed;
      }
    }

    // 商品目录查询与操作员姓名查询互不依赖：并行发出，省掉一次串行 DB 往返。
    // 用 Promise.all 而非分别 await —— prepareItems 会抛业务异常（下架/库存不足），
    // 若另一个 Promise 未被 await，其 rejection 会变成 unhandled rejection。
    const [preparedItems, operatorNameSnapshot] = await Promise.all([
      this.salesRecordItemPreparationService.prepareItems(
        storeId,
        dto,
        options,
      ),
      this.resolveOperatorNameSnapshot(operatorStaffId),
    ]);

    // 使用统一金额聚合域计算权威金额（确保与 preview 计算一致）
    const amountsSnapshot =
      SalesRecordAmountsDomain.aggregateFromPreparedItems(preparedItems);
    // 空间结账场景：抵扣项在 items 中以正数存储，聚合会多算，
    // 使用结算层传入的权威值覆盖 totalRevenue / totalProfit。
    const totalRevenue =
      options.totalRevenueOverride ?? amountsSnapshot.totalRevenue;
    const totalProfit =
      options.totalProfitOverride ?? amountsSnapshot.totalProfit;
    const totalQuantity = amountsSnapshot.totalQuantity;

    /*
     * 占位放在「参数已校验、即将落库」这一位置：
     * 前面的上架/库存校验抛错不会白占一个 key（占位后必须靠 discard 清理）。
     */
    let placeholderId: number | null = null;
    if (idempotencyKey && requestHash) {
      const claimed = await this.claimIdempotentCreate(
        user.id,
        idempotencyKey,
        requestHash,
      );
      if ('replay' in claimed) {
        return claimed.replay;
      }
      placeholderId = claimed.placeholderId;
    }

    let response: SalesRecordResponseDto;
    try {
      response = await this.salesRecordCreateFlowService.createRecord({
        storeId,
        operatorStaffId,
        operatorNameSnapshot,
        dto,
        preparedItems,
        totalRevenue,
        totalProfit,
        totalQuantity,
        note: toOptionalText(dto.note) ?? null,
        orderDate,
        options,
      });
    } catch (error) {
      // 建单事务已回滚：清掉占位，同一个 key 才能重试成功
      if (placeholderId !== null) {
        await this.salesRecordIdempotencyService.discard(placeholderId);
      }
      throw error;
    }

    if (placeholderId !== null) {
      await this.salesRecordIdempotencyService.finalize(
        placeholderId,
        response,
      );
    }

    // 缓存失效只是「让派生缓存尽快过期」，不是建单成功的前提，且成本不低：
    // invalidateSalesDerived 会并发跑十余个 delByPattern，每个都是一次全库 SCAN。
    // 同步等待会把这轮 Redis 往返全部压在建单响应延迟上，故移出关键路径。
    // 一致性：RefreshableCacheService 本身就是「有界陈旧」语义（TTL + refresh-after
    // 后台刷新），失效晚几百毫秒不会让前端读到错误订单——分页明细不缓存，
    // 只有 summary 存在极短窗口的滞后。失败仅记日志，下一轮刷新仍会自愈。
    if (!options.transactionClient) {
      this.invalidateStoreDerivedCachesInBackground(storeId, '建单后');
    }

    return response;
  }

  /** 幂等键已存在 → 回放首次响应；null 表示这是一次新请求 */
  private async findIdempotentReplay(
    actorId: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<SalesRecordResponseDto | null> {
    const existing = await this.salesRecordIdempotencyService.find(
      actorId,
      idempotencyKey,
    );
    if (!existing) {
      return null;
    }
    this.salesRecordIdempotencyService.ensureSameRequest(existing, requestHash);
    return this.salesRecordIdempotencyService.resolveReplay(existing);
  }

  /**
   * 抢占幂等键；并发双击撞唯一键时回读记录：
   * 首个请求已成功 → 回放它的订单；仍在校验/建单中 → resolveReplay 抛 409。
   */
  private async claimIdempotentCreate(
    actorId: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<{ placeholderId: number } | { replay: SalesRecordResponseDto }> {
    try {
      const placeholderId = await this.salesRecordIdempotencyService.claim(
        actorId,
        idempotencyKey,
        requestHash,
      );
      return { placeholderId };
    } catch (error) {
      if (!this.salesRecordIdempotencyService.isDuplicateKeyError(error)) {
        throw error;
      }
      const raced = await this.salesRecordIdempotencyService.find(
        actorId,
        idempotencyKey,
      );
      if (!raced) {
        throw error;
      }
      this.salesRecordIdempotencyService.ensureSameRequest(raced, requestHash);
      return {
        replay: this.salesRecordIdempotencyService.resolveReplay(raced),
      };
    }
  }

  /**
   * 会员过期后的录单限制。
   *
   * 只在调用方显式声明 source 时生效（目前只有追加点单会声明）。
   *
   * 手动录单的每日限额**不在这里**：录入订单走 scan-ordering 的独立接口，
   * 由 `ManualEntryOrderService` 在建单事务前原子预占额度。早期这里还留过一支
   * `source === 'manual_entry'` 分支，但它既不写 `manualEntry` 标记、也不落
   * `#M-` 号段，等于同一业务语义有两套实现，已删除。
   */
  private async applyMembershipDowngradeGuards(
    storeId: number,
    source: string | undefined,
  ): Promise<void> {
    if (source === 'additional') {
      await this.downgradeService.assertAdditionalEnabled(storeId);
    }
  }

  async remove(user: AuthenticatedUser, salesRecordId: number): Promise<void> {
    const record = await this.prisma.saleOrder.findUnique({
      where: { id: salesRecordId },
      select: { id: true, storeId: true },
    });

    if (!record) {
      throw new NotFoundException('销售记录不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      record.storeId,
      'sales:delete',
      '无权删除该销售记录',
    );

    await this.prisma.$transaction(async (transaction) => {
      await this.inventoryService.revertSaleDeduction(transaction, {
        storeId: record.storeId,
        saleOrderId: salesRecordId,
      });
      // SaleOrderRefund → SaleOrder 是 Restrict 外键，必须先清理退款流水与退款记录，
      // 否则删除「已退款订单」会触发外键约束错误，连带回滚库存回退。
      const refund = await transaction.saleOrderRefund.findUnique({
        where: { saleOrderId: salesRecordId },
        select: { id: true },
      });
      if (refund) {
        await transaction.financeCashFlowRecord.deleteMany({
          where: { saleOrderRefundId: refund.id },
        });
        await transaction.saleOrderRefund.delete({
          where: { id: refund.id },
        });
      }
      await transaction.financeCashFlowRecord.deleteMany({
        where: {
          storeId: record.storeId,
          saleOrderId: salesRecordId,
        },
      });
      await transaction.saleOrder.delete({
        where: { id: salesRecordId },
      });
    });

    // 与建单同策略：事务已提交，缓存失效失败不能让接口返回错误。
    // 同步等待时 Redis 抖动会让「已删除的订单」返回 500，客户端重试只会拿到
    // 「销售记录不存在」，反而更难判断到底删没删掉。
    this.invalidateStoreDerivedCachesInBackground(record.storeId, '删单后');
  }

  /**
   * 后台失效派生缓存（fire-and-forget）。
   *
   * 写操作事务已提交后再同步等待 Redis 没有意义：失效失败既不能让订单回滚，
   * 又会把「已成功」变成接口报错。失败只记日志，下一轮 refresh-after 自愈。
   *
   * 用内部 try/catch 而不是 Promise 链式捕获，避免产生未处理的 rejection。
   */
  private invalidateStoreDerivedCachesInBackground(
    storeId: number,
    scene: string,
  ): void {
    void (async (): Promise<void> => {
      try {
        await this.invalidateStoreDerivedCaches(storeId);
      } catch (error: unknown) {
        this.logger.warn(
          `${scene}派生缓存失效失败 storeId=${storeId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  }

  private async invalidateStoreDerivedCaches(storeId: number): Promise<void> {
    await this.cacheInvalidatorService.invalidateSalesDerived(storeId);
  }

  private requireTrustedStoreId(storeId: number | undefined): number {
    if (storeId === undefined) {
      throw new NotFoundException('销售记录缺少门店信息');
    }

    return storeId;
  }

  /**
   * 操作员归属：始终取当前账号自身的 staffId。
   *
   * 曾经声明过一个 `assignToCurrentShiftOperator` 选项（意思是「把单子记到待交班
   * 班次员工名下」），但实现从未落地、参数被忽略，调用方却一直在传——比没有这个
   * 能力更糟，因为它会让人误以为班次归属已经生效。该选项已删除。
   */
  private async resolveOperatorStaffId(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<number | null> {
    const currentOperatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    // 系统用户（如自动结账调度）没有 membership，operatorStaffId 应为 null，
    // 使 SaleOrder.operatorNameSnapshot 也为 null，交班页兜底展示"空间自动结账"。
    // 交班页已不再按 operatorStaffId 过滤销售记录（按门店 + 时间范围查询），
    // 因此无需回退到班次员工。
    if (!user.currentMembership) {
      return null;
    }

    // 有 membership 的用户（主账号/店长/收银员）始终使用自身 staffId，
    // 确保本班销售记录中操作员显示为实际操作账号。
    return currentOperatorStaffId;
  }

  private async resolveOperatorNameSnapshot(
    operatorStaffId: number | null,
  ): Promise<string | null> {
    if (operatorStaffId === null) return null;
    const staff = await this.prisma.staff.findUnique({
      where: { id: operatorStaffId },
      select: { name: true },
    });
    return staff?.name ?? null;
  }
}
