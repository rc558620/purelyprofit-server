// Pulse / 群发短信钱包流水查询服务
//
// 数据源是 `sms_wallet_logs`（商家充值 / 群发扣费 / 失败退费 / 平台赠送 /
// 平台回收共五种类型），与商家端 purelyProfit `/marketing/sms` 同源，
// 因此 Pulse 侧看到的每一条变动都能在商家端被同等追溯。
//
// 分页口径：`page / pageSize` 真分页（count + skip / take），
// 不做游标累积——运营需要「共 N 条」与跳页，前端也据此渲染下拉刷新组件。
//
// 为什么独立成 service 而不是塞进 PulseSmsService：
// 账户列表 / 赠送 / 退费已经让该文件接近 700 行，流水查询是独立的读模型，
// 与写链路（事务 + 余额变更）没有共享状态，拆开才能各自守住复杂度阈值。
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../../purely-profit/auth/strategies/jwt.strategy';
import { PulseMembershipAccessService } from '../../membership/membership-access.service';
import {
  PULSE_ADMIN_SMS_WALLET_LOGS_DEFAULT_PAGE_SIZE,
  PULSE_ADMIN_SMS_WALLET_LOGS_MAX_PAGE_SIZE,
} from './dto/pulse-sms.request.dto';
import type {
  GetPulseAdminSmsWalletLogsQueryDto,
  PulseAdminSmsWalletLogTab,
} from './dto/pulse-sms.request.dto';
import type {
  PulseAdminSmsWalletLogDto,
  PulseAdminSmsWalletLogsResponseDto,
  PulseAdminSmsWalletLogsStatsDto,
} from './dto/pulse-sms.response.dto';

/** groupBy(type) 的聚合结果（只取业务需要的字段） */
interface WalletLogTypeGroup {
  type: string;
  count: number;
}

@Injectable()
export class PulseSmsWalletLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
  ) {}

  /**
   * 单门店短信钱包流水（真分页 + Tab 过滤）。
   *
   * 统计与列表**同源**（都吃当前 Tab）：概览卡的「总记录」必须等于列表头的
   * 「共 N 条」，否则切到「充值」Tab 时会出现「总记录 86 / 共 3 条」的自相矛盾。
   * 统计不吃分页，仍是当前 Tab 下的完整结果集聚合。
   */
  async listAdminSmsWalletLogs(
    user: AuthenticatedUser,
    storeId: number,
    query: GetPulseAdminSmsWalletLogsQueryDto,
  ): Promise<PulseAdminSmsWalletLogsResponseDto> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      Math.max(
        1,
        query.pageSize ?? PULSE_ADMIN_SMS_WALLET_LOGS_DEFAULT_PAGE_SIZE,
      ),
      PULSE_ADMIN_SMS_WALLET_LOGS_MAX_PAGE_SIZE,
    );

    await this.assertReadableStore(user, storeId);

    const listWhere: Prisma.SmsWalletLogWhereInput = {
      storeId,
      ...buildWalletLogTabWhere(query.tab),
    };

    const [total, logs, grouped] = await Promise.all([
      this.prisma.smsWalletLog.count({ where: listWhere }),
      this.prisma.smsWalletLog.findMany({
        where: listWhere,
        // createdAt 可能同秒（群发扣费批量写入），追加 id 保证翻页不重不漏
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.smsWalletLog.groupBy({
        by: ['type'],
        // 与列表同口径（含 Tab、不含分页），保证统计与列表头条数一致
        where: listWhere,
        _count: { _all: true },
      }),
    ]);

    return {
      items: logs.map((log) => buildWalletLogDto(storeId, log)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
      stats: buildWalletLogsStats(
        grouped.map((group) => ({
          type: String(group.type),
          count: group._count._all,
        })),
      ),
    };
  }

  /**
   * 读取权限校验：与门店短信账户一览同口径（开发者看全部非排除门店、
   * 非开发者看自己门店），已注销门店按「不存在」处理，
   * 避免直接调接口读历史门店的流水。
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
      throw new NotFoundException('门店不存在');
    }

    const store = await this.prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('门店不存在');
    }
  }
}

/**
 * Tab → 流水类型条件。
 *
 * `admin` 同时包含 `grant` 与 `admin_adjust`：两者都是平台运营对余额的操作，
 * 运营在「平台调整」里要能一次看完自己发出去和收回来的额度。
 */
function buildWalletLogTabWhere(
  tab: PulseAdminSmsWalletLogTab | undefined,
): Prisma.SmsWalletLogWhereInput {
  switch (tab) {
    case 'admin':
      return { type: { in: ['grant', 'admin_adjust'] } };
    case 'recharge':
      return { type: 'recharge' };
    case 'consume':
      return { type: 'consume' };
    case 'refund':
      return { type: 'refund' };
    default:
      return {};
  }
}

/** 流水行 → 响应 DTO（金额类字段保持后端原始口径，前端只做展示） */
function buildWalletLogDto(
  storeId: number,
  log: {
    id: number;
    type: string;
    changeFen: number;
    balanceAfterFen: number;
    description: string;
    orderNo: string | null;
    broadcastId: string | null;
    createdAt: Date;
  },
): PulseAdminSmsWalletLogDto {
  return {
    id: String(log.id),
    storeId: String(storeId),
    type: String(log.type),
    changeFen: log.changeFen,
    balanceAfterFen: log.balanceAfterFen,
    description: log.description,
    orderNo: log.orderNo,
    broadcastId: log.broadcastId,
    createdAt: log.createdAt.getTime(),
  };
}

/**
 * 按类型聚合 → 统计概览。
 *
 * totalRecords 是各类型条数之和（不是某个分组值）；
 * adminAdjustCount 合并 `grant` 与 `admin_adjust`，与「平台调整」Tab 的口径一致。
 */
function buildWalletLogsStats(
  groups: WalletLogTypeGroup[],
): PulseAdminSmsWalletLogsStatsDto {
  let totalRecords = 0;
  let adminAdjustCount = 0;
  let rechargeCount = 0;
  let consumeCount = 0;
  let refundCount = 0;

  for (const group of groups) {
    totalRecords += group.count;

    if (group.type === 'grant' || group.type === 'admin_adjust') {
      adminAdjustCount += group.count;
    } else if (group.type === 'recharge') {
      rechargeCount += group.count;
    } else if (group.type === 'consume') {
      consumeCount += group.count;
    } else if (group.type === 'refund') {
      refundCount += group.count;
    }
  }

  return {
    totalRecords,
    adminAdjustCount,
    rechargeCount,
    consumeCount,
    refundCount,
  };
}
