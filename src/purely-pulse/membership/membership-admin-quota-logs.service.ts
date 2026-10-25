// Pulse / 新客额度变动记录查询服务
//
// 数据源是 `store_new_customer_quota_logs`（商家充值 / 会员赠送 / 新客消耗 /
// 额度清零 / 平台运营调整共五种类型），与商家端 purelyProfit 额度页同源，
// 因此 Pulse 侧看到的每一条变动都能在商家端被同等追溯。
//
// 分页口径：`page / pageSize` 真分页（count + skip / take），
// 不做游标累积——运营需要「共 N 条」与跳页，前端也据此渲染下拉刷新组件。
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { GetPulseAdminNewCustomerQuotaLogsQueryDto } from './dto/pulse-membership-admin-new-customer-quota.request.dto';
import {
  PULSE_ADMIN_QUOTA_LOGS_DEFAULT_PAGE_SIZE,
  PULSE_ADMIN_QUOTA_LOGS_MAX_PAGE_SIZE,
} from './dto/pulse-membership-admin-new-customer-quota.request.dto';
import type {
  PulseAdminNewCustomerQuotaLogDto,
  PulseAdminNewCustomerQuotaLogsResponseDto,
  PulseAdminNewCustomerQuotaLogsStatsDto,
} from './dto/pulse-membership-admin-new-customer-quota.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';

/** groupBy(type) 的聚合结果（只取业务需要的字段） */
interface QuotaLogTypeGroup {
  type: string;
  count: number;
}

@Injectable()
export class PulseMembershipAdminQuotaLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
  ) {}

  /**
   * 单门店额度变动记录（真分页 + Tab 过滤）。
   *
   * 统计与列表**同源**（都吃当前 Tab）：概览卡的「总记录」必须等于列表头的
   * 「共 N 条」，否则切到「充值」Tab 时会出现「总记录 24 / 共 8 条」的自相矛盾。
   * 统计不吃分页，仍是当前 Tab 下的完整结果集聚合。
   */
  async listAdminQuotaLogs(
    user: AuthenticatedUser,
    storeId: number,
    query: GetPulseAdminNewCustomerQuotaLogsQueryDto,
  ): Promise<PulseAdminNewCustomerQuotaLogsResponseDto> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      Math.max(1, query.pageSize ?? PULSE_ADMIN_QUOTA_LOGS_DEFAULT_PAGE_SIZE),
      PULSE_ADMIN_QUOTA_LOGS_MAX_PAGE_SIZE,
    );

    await this.assertReadableStore(user, storeId);

    const listWhere: Prisma.StoreNewCustomerQuotaLogWhereInput = {
      storeId,
      ...buildQuotaLogTabWhere(query.tab),
    };

    const [total, logs, grouped] = await Promise.all([
      this.prisma.storeNewCustomerQuotaLog.count({ where: listWhere }),
      this.prisma.storeNewCustomerQuotaLog.findMany({
        where: listWhere,
        // createdAt 可能同秒，追加 id 保证翻页时顺序稳定、不重不漏
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.storeNewCustomerQuotaLog.groupBy({
        by: ['type'],
        // 与列表同口径（含 Tab、不含分页），保证统计与列表头条数一致
        where: listWhere,
        _count: { _all: true },
      }),
    ]);

    return {
      items: logs.map((log) => buildQuotaLogDto(storeId, log)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
      stats: buildQuotaLogsStats(
        grouped.map((group) => ({
          type: String(group.type),
          count: group._count._all,
        })),
      ),
    };
  }

  /**
   * 读取权限校验：与门店额度一览同口径（开发者看全部非排除门店、非开发者看自己门店），
   * 已注销门店按「不存在」处理，避免直接调接口读历史门店的流水。
   */
  private async assertReadableStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<void> {
    const canAccess = await this.accessService.canAccessAdminMember(
      user,
      storeId,
    );
    if (!canAccess) {
      throw new NotFoundException('会员不存在');
    }

    const store = await this.prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('会员不存在');
    }
  }
}

/**
 * Tab → 流水类型条件。
 *
 * `consume` Tab 同时包含 `clear`：清零也是让余额减少的变动，
 * 若漏掉，运营在「消耗」里就看不到清零记录，与「余额为什么少了」对不上。
 */
function buildQuotaLogTabWhere(
  tab: GetPulseAdminNewCustomerQuotaLogsQueryDto['tab'],
): Prisma.StoreNewCustomerQuotaLogWhereInput {
  switch (tab) {
    case 'admin':
      return { type: 'admin_adjust' };
    case 'recharge':
      return { type: 'recharge' };
    case 'consume':
      return { type: { in: ['consume', 'clear'] } };
    default:
      return {};
  }
}

/** 流水行 → 响应 DTO（金额类字段保持后端原始口径，前端只做展示） */
function buildQuotaLogDto(
  storeId: number,
  log: {
    id: number;
    type: string;
    changeAmount: number;
    balanceAfter: number;
    amountFen: number | null;
    description: string;
    createdAt: Date;
  },
): PulseAdminNewCustomerQuotaLogDto {
  return {
    id: String(log.id),
    storeId: String(storeId),
    type: String(log.type),
    changeAmount: log.changeAmount,
    balanceAfter: log.balanceAfter,
    amountFen: log.amountFen ?? null,
    description: log.description,
    createdAt: log.createdAt.toISOString(),
  };
}

/**
 * 按类型聚合 → 统计概览。
 *
 * totalRecords 是各类型条数之和（不是某个分组值），
 * consumeCount 合并 `consume` 与 `clear`，与「消耗」Tab 的口径保持一致。
 */
function buildQuotaLogsStats(
  groups: QuotaLogTypeGroup[],
): PulseAdminNewCustomerQuotaLogsStatsDto {
  let totalRecords = 0;
  let adminAdjustCount = 0;
  let rechargeCount = 0;
  let consumeCount = 0;

  for (const group of groups) {
    totalRecords += group.count;

    if (group.type === 'admin_adjust') {
      adminAdjustCount += group.count;
    } else if (group.type === 'recharge') {
      rechargeCount += group.count;
    } else if (group.type === 'consume' || group.type === 'clear') {
      consumeCount += group.count;
    }
  }

  return { totalRecords, adminAdjustCount, rechargeCount, consumeCount };
}
