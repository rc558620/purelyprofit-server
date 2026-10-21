import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { StaffRole, StoreSubAccountRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  SpaceSessionAutoCheckoutService,
  createAutoCheckoutSystemUser,
} from '../spaces/space-session-auto-checkout.service';
import { buildCacheRefreshTaskKey } from '../../../redis/keys';
import { RedisService } from '../../../redis/redis.service';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import type {
  CreateHandoverAdditionalItemDto,
  HandoverAdditionalItemDto,
  HandoverAdditionalItemListResponseDto,
  UpdateHandoverAdditionalItemDto,
} from './dto/handover-additional-items.dto';
import type {
  ConfirmHandoverRequestDto,
  HandoverPageQueryDto,
  HandoverPageResponseDto,
} from './dto/handover-page.dto';
import type {
  CancelHandoverRecordDto,
  CompleteHandoverRecordDto,
  CreateHandoverRecordDto,
  HandoverCandidateDto,
  HandoverRecordListItemDto,
  HandoverRecordListResponseDto,
  HandoverRecordSummaryListResponseDto,
  HandoverRecordSummaryQueryDto,
} from './dto/handover-records.dto';

import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import {
  buildHandoverPageCacheKey,
  buildHandoverPagePattern,
} from './handover.cache-keys';
import { HandoverConfirmService } from './handover-confirm.service';
import { HandoverPageService } from './handover-page.service';
import { HandoverRecordsService } from './handover-records.service';
import {
  CASHIER_SHIFT_OPERATION_BLOCK_MESSAGE,
  ensureMembershipContext,
  ensureMembershipStoreId,
} from './handover.shared';

/**
 * 交班页缓存 TTL（秒）。
 * 与 refreshAfterMs 配合：被持续访问的页面在 refreshAfterMs 后由后台刷新自愈，
 * 实际陈旧窗口约 5s；TTL 只兜底「页面已无人访问」时的最长陈旧时间。
 */
const HANDOVER_PAGE_CACHE_TTL_SECONDS = 20;
const HANDOVER_PAGE_CACHE_REFRESH_AFTER_MS = 5_000;

@Injectable()
export class HandoverService {
  private readonly logger = new Logger(HandoverService.name);

  constructor(
    private readonly handoverPageService: HandoverPageService,
    private readonly handoverConfirmService: HandoverConfirmService,
    private readonly handoverRecordsService: HandoverRecordsService,
    private readonly handoverAdditionalItemsService: HandoverAdditionalItemsService,
    private readonly spaceSessionAutoCheckoutService: SpaceSessionAutoCheckoutService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly redisService: RedisService,
  ) {}

  async getHandoverPage(
    user: AuthenticatedUser,
    query: HandoverPageQueryDto,
  ): Promise<HandoverPageResponseDto> {
    this.triggerAutoCheckoutInBackground(user, 'handover:page');

    const cacheKey = buildHandoverPageCacheKey({
      storeId: ensureMembershipStoreId(user),
      userId: user.id,
      shiftType: query.shiftType,
      operatorName: query.operatorName,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: HANDOVER_PAGE_CACHE_TTL_SECONDS,
      refreshAfterMs: HANDOVER_PAGE_CACHE_REFRESH_AFTER_MS,
      loadValue: () => this.handoverPageService.getHandoverPage(user, query),
    });
  }

  async confirmHandover(
    user: AuthenticatedUser,
    dto: ConfirmHandoverRequestDto,
  ): Promise<HandoverRecordListItemDto> {
    await this.ensureUserCanOperateShift(user, dto.shiftType);
    const record = await this.handoverConfirmService.confirmHandover(user, dto);
    // 交班完成后班次状态翻转，页面必须立即反映（不等 TTL）
    await this.invalidateHandoverPageCache(user);
    return record;
  }

  listAdditionalItems(
    user: AuthenticatedUser,
  ): Promise<HandoverAdditionalItemListResponseDto> {
    return this.handoverAdditionalItemsService.listAdditionalItems(user);
  }

  async createAdditionalItem(
    user: AuthenticatedUser,
    dto: CreateHandoverAdditionalItemDto,
  ): Promise<HandoverAdditionalItemDto> {
    this.ensureUserCanManageAdditionalItems(user);
    return this.handoverAdditionalItemsService.createAdditionalItem(user, dto);
  }

  async updateAdditionalItem(
    user: AuthenticatedUser,
    itemId: number,
    dto: UpdateHandoverAdditionalItemDto,
  ): Promise<HandoverAdditionalItemDto> {
    this.ensureUserCanManageAdditionalItems(user);
    return this.handoverAdditionalItemsService.updateAdditionalItem(
      user,
      itemId,
      dto,
    );
  }

  async deleteAdditionalItem(
    user: AuthenticatedUser,
    itemId: number,
  ): Promise<void> {
    this.ensureUserCanManageAdditionalItems(user);
    return this.handoverAdditionalItemsService.deleteAdditionalItem(
      user,
      itemId,
    );
  }

  async createHandoverRecord(
    user: AuthenticatedUser,
    dto: CreateHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    await this.ensureUserCanOperateCurrentShift(user);
    const record = await this.handoverRecordsService.createHandoverRecord(
      user,
      dto,
    );
    await this.invalidateHandoverPageCache(user);
    return record;
  }

  async completeHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
    dto: CompleteHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    await this.ensureUserCanOperateCurrentShift(user);
    const record = await this.handoverRecordsService.completeHandoverRecord(
      user,
      recordId,
      dto,
    );
    // 完成交班会把记录置为 completed，直接影响「班次是否已交班」判定
    await this.invalidateHandoverPageCache(user);
    return record;
  }

  async cancelHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
    dto: CancelHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    await this.ensureUserCanOperateCurrentShift(user);
    const record = await this.handoverRecordsService.cancelHandoverRecord(
      user,
      recordId,
      dto,
    );
    await this.invalidateHandoverPageCache(user);
    return record;
  }

  async listHandoverRecords(
    user: AuthenticatedUser,
    limit?: number,
    offset?: number,
  ): Promise<HandoverRecordListResponseDto> {
    this.triggerAutoCheckoutInBackground(user, 'handover:records');
    return this.handoverRecordsService.listHandoverRecords(user, limit, offset);
  }

  async getHandoverRecord(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<HandoverRecordListItemDto> {
    this.triggerAutoCheckoutInBackground(user, 'handover:record-detail');
    return this.handoverRecordsService.getHandoverRecord(user, recordId);
  }

  async listHandoverRecordSummaries(
    user: AuthenticatedUser,
    query: HandoverRecordSummaryQueryDto,
  ): Promise<HandoverRecordSummaryListResponseDto> {
    this.triggerAutoCheckoutInBackground(user, 'handover:record-summaries');
    return this.handoverRecordsService.listHandoverRecordSummaries(user, query);
  }

  getHandoverCandidates(storeId: number): Promise<HandoverCandidateDto[]> {
    return this.handoverRecordsService.getHandoverCandidates(storeId);
  }

  async getMyPendingHandover(
    user: AuthenticatedUser,
  ): Promise<HandoverRecordListItemDto | null> {
    this.triggerAutoCheckoutInBackground(user, 'handover:my-pending');
    return this.handoverRecordsService.getMyPendingHandover(user);
  }

  private async ensureUserCanOperateCurrentShift(
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.ensureUserCanOperateShift(user);
  }

  /**
   * 写操作后按门店失效交班页缓存。
   * 失效是尽力而为：Redis 不可用时只记录告警，不回滚已完成的写操作
   * （缓存最长再存活一个 TTL，TTL 到期后自然收敛）。
   */
  private async invalidateHandoverPageCache(
    user: AuthenticatedUser,
  ): Promise<void> {
    const storeId = ensureMembershipStoreId(user);
    try {
      await this.redisService.delByPattern(buildHandoverPagePattern(storeId));
    } catch (error) {
      this.logger.warn(
        `[handover] page_cache_invalidate_failed storeId=${storeId} reason=${
          error instanceof Error ? error.message : 'UnknownError'
        }`,
      );
    }
  }

  /**
   * 读接口的自动结账：后台触发，不参与请求耗时。
   *
   * 自动结账本质是写操作（Redis 分布式锁 + 过期会话查询 + 逐会话结算事务），
   * 同步 await 会让每个读请求都承担这部分延迟（2 次 Redis RTT + 1 次重查询 +
   * 每个过期会话一个结算事务）。过期会话由 scheduler:auto-checkout 定时任务兜底，
   * 读接口只做尽力而为的后台触发，最坏情况是本轮响应滞后显示未结账会话。
   *
   * 写接口（confirm/create/complete/cancel）仍同步 await：归档营收前必须完成结账。
   */
  private triggerAutoCheckoutInBackground(
    user: AuthenticatedUser,
    trigger: string,
  ): void {
    void this.autoCheckoutCurrentStoreSessions(user, trigger).catch((error) => {
      this.logger.warn(
        `[handover] auto_checkout_background_failed trigger=${trigger} reason=${
          error instanceof Error ? error.message : 'UnknownError'
        }`,
      );
    });
  }

  private async autoCheckoutCurrentStoreSessions(
    user: AuthenticatedUser,
    trigger: string,
  ): Promise<void> {
    // 自动结账必须使用系统用户（无 membership），使 SaleOrder.operatorStaffId 为 null，
    // 交班页兜底展示"空间自动结账"，而非当前登录用户的姓名。
    void user;
    const systemUser = createAutoCheckoutSystemUser();
    // 自动结账只是交班前的尽力而为步骤：其分布式锁依赖 Redis，
    // Redis 不可用时应降级跳过（记录告警），而不是让交班的读接口一并 500。
    // 结账本身由 scheduler:auto-checkout 定时任务兜底。
    try {
      await this.spaceSessionAutoCheckoutService.autoCheckoutExpiredCountdownSessions(
        systemUser,
        ensureMembershipStoreId(user),
        Date.now(),
        trigger,
      );
    } catch (error) {
      this.logger.warn(
        `[handover] auto_checkout_skipped trigger=${trigger} reason=${
          error instanceof Error ? error.message : 'UnknownError'
        }`,
      );
    }
  }

  private ensureUserCanManageAdditionalItems(user: AuthenticatedUser): void {
    const membership = ensureMembershipContext(user);
    const isManager =
      membership.role === StaffRole.manager ||
      membership.subAccountRole === StoreSubAccountRole.manager;

    if (membership.subjectType === 'owner' || isManager) {
      return;
    }

    // 附加项是门店级配置（影响全店所有交班），仅允许 owner / manager 管理
    throw new ForbiddenException('仅店长或管理员可管理附加项配置');
  }

  private async ensureUserCanOperateShift(
    user: AuthenticatedUser,
    shiftType?: HandoverPageQueryDto['shiftType'],
  ): Promise<void> {
    // 写接口前置自动结账：确保过期倒计时空间会话在交班确认前完成结账，
    // 避免归档的营收数据漏算刚过期的会话。
    await this.autoCheckoutCurrentStoreSessions(user, 'handover:write');

    // BUG-5 优化：仅解析权限上下文，不再跑整页渲染
    // （省去 resolvePageShiftRange + loadPageMetrics 的 7 个并行查询 + buildPageResponse）。
    const access =
      await this.handoverPageService.resolveHandoverOperationAccess(
        user,
        shiftType,
      );
    if (!access.canOperate) {
      throw new ForbiddenException(
        access.blockedReason ?? CASHIER_SHIFT_OPERATION_BLOCK_MESSAGE,
      );
    }

    // 页面读取允许自动切到下一班次，但写接口必须严格命中请求的班次，避免重复交旧班。
    if (shiftType && access.selectedShiftType !== shiftType) {
      throw new ForbiddenException('当前班次已完成交班，暂不允许重复操作');
    }
  }
}
