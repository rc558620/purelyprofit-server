import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import type {
  CreateRechargeDto,
  ListRechargesQueryDto,
} from './dto/marketing-query.dto';
import type {
  MarketingRechargeDto,
  MarketingRechargesResponseDto,
} from './dto/marketing-response.dto';
import { enrichRefundGiftCleared } from './marketing.domain';
import { mapRechargeRow } from './marketing.mapper';
import {
  queryCustomerRechargePage,
  queryCustomerRefundPage,
  queryRechargePage,
} from './marketing-flow.query';
import {
  queryCustomerRechargeRefundSums,
  queryRechargeRowById,
} from './marketing.query';
import { createRechargeInTransaction } from './marketing-recharge-transaction.shared';
import {
  buildMarketingFlowPage,
  resolveMarketingFlowPaging,
} from './marketing-flow.cursor';
import { MarketingSharedService } from './marketing-shared.service';
import { Money } from '../../shared/money.utils';
import { buildMarketingPaginationMeta } from './marketing.utils';

@Injectable()
export class MarketingRechargesService {
  private readonly logger = new Logger(MarketingRechargesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly marketingSharedService: MarketingSharedService,
    private readonly redisService: RedisService,
  ) {}

  async listRecharges(
    user: AuthenticatedUser,
    query: ListRechargesQueryDto,
  ): Promise<MarketingRechargesResponseDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );
    // 分页参数归一放在取数之前：cursor 非法时直接 400，不白跑一次列表查询
    const paging = resolveMarketingFlowPaging(query);
    if (!resolvedStoreId) {
      return {
        items: [],
        meta: buildMarketingPaginationMeta(0, 1, paging.limit),
        hasMore: false,
        nextCursor: null,
      };
    }

    const { items: rows, total } = await queryRechargePage(this.prisma, {
      storeId: resolvedStoreId,
      customerId: query.customerId,
      startMs: query.startMs,
      endMs: query.endMs,
      skip: paging.offset,
      // 游标路径多取一行做「是否还有下一页」探测；offset 路径取数成本不变
      take: paging.cursor ? paging.limit + 1 : paging.limit,
      cursor: paging.cursor,
    });
    const page = buildMarketingFlowPage(rows, total, paging);

    return {
      items: page.rows.map(mapRechargeRow),
      meta: page.meta,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async listCustomerRecharges(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number },
  ): Promise<MarketingRechargesResponseDto> {
    const customer =
      await this.marketingSharedService.findCustomerOrThrow(customerId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      customer.storeId,
      'marketing:view',
    );

    const paging = resolveMarketingFlowPaging(query);
    const { items: rows, total } = await queryCustomerRechargePage(
      this.prisma,
      customerId,
      paging.offset,
      paging.limit,
    );
    const page = buildMarketingFlowPage(rows, total, paging);

    return {
      items: page.rows.map(mapRechargeRow),
      meta: page.meta,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async listCustomerRefunds(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number },
  ): Promise<MarketingRechargesResponseDto> {
    const customer =
      await this.marketingSharedService.findCustomerOrThrow(customerId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      customer.storeId,
      'marketing:view',
    );

    const paging = resolveMarketingFlowPaging(query);
    const { items: rows, total } = await queryCustomerRefundPage(
      this.prisma,
      customerId,
      paging.offset,
      paging.limit,
    );
    const page = buildMarketingFlowPage(rows, total, paging);

    const items = await enrichRefundGiftCleared(
      this.prisma,
      customerId,
      page.rows,
    );

    return {
      items,
      meta: page.meta,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async createRecharge(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateRechargeDto,
  ): Promise<MarketingRechargeDto> {
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      storeId,
      'marketing:manage',
    );

    const rechargeType = dto.type ?? 'recharge';

    // 资金链路硬约束：子账号（含店长）一律不得办理储值退款。
    // 与 PermissionsGuard 的 marketing:manage 形成双保险，避免后续误授权子账号写权限后出现资金越权。
    // 放在查顾客之前：越权请求不应触发任何业务读取。
    if (
      rechargeType === 'refund' &&
      user.currentMembership?.subjectType === 'sub_account'
    ) {
      throw new ForbiddenException('子账号无权办理顾客退款');
    }

    const customer = await this.marketingSharedService.findCustomerOrThrow(
      dto.customerId,
    );
    if (customer.storeId !== storeId) {
      throw new BadRequestException('顾客不属于该门店');
    }

    // ── 幂等保护：同一笔操作 5 秒内不可重复提交 ──
    // F5: key 包含 clearRemainingGift，防止不同清零策略的请求被误判为重复
    // 占位放在所有业务校验**之后**：否则用户因「余额不足」被拒后，5 秒内
    // 修正金额重试仍会被判重复提交。并发重复写入由事务内的条件更新兜底。
    const idempotencyKey = `recharge:dedup:${storeId}:${dto.customerId}:${rechargeType}:${dto.amount}:${dto.giftAmount ?? 0}:${dto.clearRemainingGift ?? false}:${dto.note?.trim() || ''}`;

    // ── 退款不允许携带赠送金额（前端传入的 giftAmount 必须为 0，服务端会内部计算清零额） ──
    if (rechargeType === 'refund' && (dto.giftAmount ?? 0) !== 0) {
      throw new BadRequestException('退款操作不允许携带赠送金额');
    }

    // ── 金额全链路走 Money：入站分→Money 对象→计算→入库分 ──
    const rechargeMoney = Money.fromDbCents(dto.amount);
    const giftMoney = Money.fromDbCents(dto.giftAmount ?? 0);
    const totalMoney = rechargeMoney.add(giftMoney);

    // recharge / refund 要求 amount > 0；gift 允许 amount=0 但 totalAmount 须 > 0
    if (rechargeType !== 'gift' && dto.amount < 1) {
      throw new BadRequestException(
        rechargeType === 'refund' ? '退款金额必须大于 0' : '充值金额必须大于 0',
      );
    }
    if (rechargeType === 'gift' && totalMoney.toDbCents() <= 0) {
      throw new BadRequestException('赠送金额必须大于 0');
    }

    // ── 退款预校验：退款金额不能超过可退本金，且不能超过当前实际余额 ──
    if (rechargeType === 'refund') {
      const { rechargeCents, refundCents } =
        await queryCustomerRechargeRefundSums(this.prisma, dto.customerId);
      const refundableCents = Math.max(0, rechargeCents - refundCents);
      if (Money.fromDbCents(refundableCents).lessThan(totalMoney)) {
        throw new BadRequestException('退款金额不能超过最大可退本金');
      }
      // B1: 余额兗底校验——退款金额不得超过当前实际余额
      if (Money.fromDbCents(customer.balance).lessThan(totalMoney)) {
        throw new BadRequestException('退款金额不能超过顾客当前储值余额');
      }
    }

    const isNew = await this.redisService.setIfAbsent(idempotencyKey, '1', 5);
    if (!isNew) {
      throw new BadRequestException('请勿重复提交，请稍后再试');
    }

    const transactionResult = this.prisma.$transaction(
      (tx) =>
        createRechargeInTransaction({
          tx,
          storeId,
          dto,
          rechargeType,
          rechargeMoney,
          giftMoney,
          totalMoney,
        }),
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    let rechargeRecordId: number;
    let giftClearedAmountCents = 0;
    try {
      const completed = await transactionResult;
      rechargeRecordId = completed.rechargeId;
      giftClearedAmountCents = completed.giftClearedAmountCents;
    } catch (error: unknown) {
      // 事务失败（余额不足、活动不属于门店、并发余额条件不满足等）必须立刻
      // 释放 5s 幂等占位，让用户修正参数后能重试；事务提交成功后绝不释放，
      // 否则同一笔充值/退款的重试会重复入账。
      try {
        await this.redisService.del(idempotencyKey);
      } catch (releaseError: unknown) {
        // 清理动作失败不能覆盖事务本身的业务异常；占位带 5s TTL 会自行失效
        this.logger.warn(
          `释放充值幂等占位失败：${releaseError instanceof Error ? releaseError.message : '未知错误'}`,
        );
      }
      throw error;
    }

    const row = await queryRechargeRowById(this.prisma, rechargeRecordId);
    if (!row) {
      throw new NotFoundException('充值记录不存在');
    }

    await this.invalidateOverviewCache(storeId);

    const result = mapRechargeRow(row);
    // B5: 返回结构化赠送清零金额（事务内计算）
    if (giftClearedAmountCents > 0) {
      result.giftClearedAmount = Money.fromDbCents(
        giftClearedAmountCents,
      ).toOutputYuan();
    }
    return result;
  }

  private async invalidateOverviewCache(storeId: number): Promise<void> {
    // derived 失效器已覆盖概览 key、顾客列表、顾客详情与 club 派生缓存，
    // 这里再逐个 delByPattern 只会把同一批模式多扫两遍。
    await Promise.all([
      this.cacheInvalidatorService.invalidateMarketingOverview(storeId),
      // 充值/退款改的是 marketing_customers.balance：C 端会员快照与会员中心
      // 列表/详情都以它为事实源，必须一并失效，否则余额读数陈旧到 TTL 到期
      this.cacheInvalidatorService.invalidateMarketingCustomerDerived(storeId),
      this.cacheInvalidatorService.invalidateMembersDerived(storeId),
    ]);
  }
}
