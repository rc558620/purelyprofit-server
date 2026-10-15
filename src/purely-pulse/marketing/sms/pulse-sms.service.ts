// Pulse / 群发短信管理服务
//
// 供 purelyPulse「群发短信」页面使用：跨可访问门店聚合短信账户现状，
// 并允许**平台运营**为单个门店赠送或回收短信余额。
//
// 数据口径与 purelyProfit `/marketing/sms` 完全一致：余额本体是
// `store_sms_accounts.balance_fen`，流水写 `sms_wallet_logs`。
//
// 💡 `grant`（赠送）/ `admin_adjust`（回收）两种钱包流水类型此前在全系统
// **没有任何写入方**——本服务是它们的第一个生产者，即「运营给商家补额度」
// 这条链路的唯一入口。商家自付的充值仍然走 purelyProfit 的微信支付链路。
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SmsWalletLogType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../../purely-profit/auth/strategies/jwt.strategy';
import { SmsAccountService } from '../../../purely-profit/marketing/sms/sms-account.service';
import {
  resolveAdminMemberDisplayName,
  resolveAdminMemberPhone,
} from '../../membership/membership-admin-query.helper';
import { PulseMembershipAccessService } from '../../membership/membership-access.service';
import type { PulseAdminStoreIdentityRecord } from '../../membership/membership.types';
import {
  SMS_BROADCAST_REFUNDABLE_STATUS_VALUES,
  SMS_BROADCAST_DEFAULT_PAGE_SIZE,
} from '../../../purely-profit/marketing/sms/sms.constants';
import type {
  GetPulseAdminSmsAccountsQueryDto,
  GetPulseAdminSmsBroadcastsQueryDto,
  GrantPulseAdminSmsBalanceDto,
  PulseAdminSmsHealthFilter,
  RefundPulseAdminSmsBroadcastDto,
} from './dto/pulse-sms.request.dto';
import {
  PULSE_ADMIN_SMS_DEFAULT_PAGE_SIZE,
  PULSE_ADMIN_SMS_MAX_PAGE_SIZE,
} from './dto/pulse-sms.request.dto';
import type {
  PulseAdminSmsAccountDto,
  PulseAdminSmsAccountsResponseDto,
  PulseAdminSmsAccountsStatsDto,
  PulseAdminSmsBroadcastDto,
  PulseAdminSmsBroadcastRefundResultDto,
  PulseAdminSmsBroadcastsResponseDto,
} from './dto/pulse-sms.response.dto';

/** 短信账户列表行所需的最小门店记录：主账号身份 */
interface PulseSmsStoreRecord extends PulseAdminStoreIdentityRecord {
  id: number;
}

/** 门店 + 主账号身份的查询字段（与会员列表口径保持一致） */
const SMS_STORE_SELECT = {
  id: true,
  name: true,
  contactPhone: true,
  owner: {
    select: {
      email: true,
      name: true,
      realName: true,
      avatar: true,
      wechatPhone: true,
      lastActiveAt: true,
    },
  },
} as const;

/** 短信账户查询字段 */
const SMS_ACCOUNT_SELECT = {
  storeId: true,
  balanceFen: true,
  totalRechargedFen: true,
  totalConsumedFen: true,
  sentSmsCount: true,
  updatedAt: true,
} as const;

/** 短信账户行快照：与 SMS_ACCOUNT_SELECT 一一对应，服务内部流转的完整形态 */
interface PulseSmsAccountRow {
  storeId: number;
  balanceFen: number;
  totalRechargedFen: number;
  totalConsumedFen: number;
  sentSmsCount: number;
  updatedAt: Date;
}

/** 判定余额健康度所需的最小账户信息（从未开过户的门店没有账户行） */
type SmsBalanceSnapshot = Pick<
  PulseSmsAccountRow,
  'balanceFen' | 'totalConsumedFen'
>;

/** Serializable 事务写冲突（P2034）的重试次数 */
const SERIALIZABLE_RETRY_TIMES = 3;

/** 判断是否为可重试的序列化失败 */
const isSerializationFailure = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2034';

/**
 * 短信账户余额健康度。
 *
 * 口径必须与前端 `resolveSmsAccountHealth` 完全一致：
 * - 余额 <= 0 且累计消费 > 0 → 已耗尽
 * - 余额 <= 0 且累计消费 = 0 → 未赠送（平台从没给过额度，不能算耗尽）
 * - 余额 > 0 且低于预警阈值 → 预警
 */
type SmsAccountHealth = 'none' | 'exhausted' | 'warning' | 'healthy';

const resolveSmsAccountHealth = (
  account: SmsBalanceSnapshot | undefined,
  warningThresholdFen: number,
): SmsAccountHealth => {
  const balanceFen = account?.balanceFen ?? 0;
  if (balanceFen <= 0) {
    return (account?.totalConsumedFen ?? 0) > 0 ? 'exhausted' : 'none';
  }
  return balanceFen < warningThresholdFen ? 'warning' : 'healthy';
};

@Injectable()
export class PulseSmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly smsAccountService: SmsAccountService,
  ) {}

  /**
   * 可访问门店的短信账户一览（搜索 / 余额健康度筛选 / 分页）。
   *
   * 与会员列表接口同一口径：先按 keyword / health 过滤，再切出当前页。
   *
   * 统计口径不同于分页切片：**只吃 keyword 过滤、忽略 health 筛选**。
   * 顶部「门店数 / 余额合计」是概览指标，若跟随「已耗尽」Tab 会恒为 0 而失去意义。
   */
  async listAdminSmsAccounts(
    user: AuthenticatedUser,
    query: GetPulseAdminSmsAccountsQueryDto,
  ): Promise<PulseAdminSmsAccountsResponseDto> {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? PULSE_ADMIN_SMS_DEFAULT_PAGE_SIZE,
      PULSE_ADMIN_SMS_MAX_PAGE_SIZE,
    );
    const warningThresholdFen =
      this.smsAccountService.resolveWarningThresholdFen();

    const storeIds = await this.resolveVisibleStoreIds(user);
    if (storeIds.length === 0) {
      return this.buildEmptyPageResult(page, pageSize);
    }

    const [stores, accounts] = await Promise.all([
      this.prisma.store.findMany({
        where: { id: { in: storeIds }, deletedAt: null },
        select: SMS_STORE_SELECT,
        orderBy: { id: 'asc' },
      }),
      this.prisma.storeSmsAccount.findMany({
        where: { storeId: { in: storeIds } },
        select: SMS_ACCOUNT_SELECT,
      }),
    ]);

    const accountByStoreId = new Map(
      accounts.map((account) => [account.storeId, account]),
    );

    const keywordMatchedStores = stores.filter((store) =>
      this.matchesKeyword(store, query.keyword),
    );
    const filteredStores = query.health
      ? keywordMatchedStores.filter((store) =>
          this.matchesHealth(
            accountByStoreId.get(store.id),
            query.health as PulseAdminSmsHealthFilter,
            warningThresholdFen,
          ),
        )
      : keywordMatchedStores;

    return {
      items: filteredStores
        .slice((page - 1) * pageSize, page * pageSize)
        .map((store) =>
          this.buildAccountDto(
            store,
            accountByStoreId.get(store.id),
            warningThresholdFen,
          ),
        ),
      total: filteredStores.length,
      page,
      pageSize,
      hasMore: page * pageSize < filteredStores.length,
      // 统计只吃 keyword 过滤：概览指标不随「已耗尽」等 Tab 抖动
      stats: this.buildStats(
        keywordMatchedStores,
        accountByStoreId,
        warningThresholdFen,
      ),
    };
  }

  /**
   * 平台赠送 / 回收门店短信余额（增量语义，余额不会低于 0）。
   *
   * 权限口径沿用 `assertAdminMemberMutationAccess`：仅开发者，且目标门店不在
   * `pulse.devAccountEmails` 排除名单内——与 Pulse 会员管理其它写操作完全一致，
   * 即「平台运营改商家、改不到自己的测试店」。
   *
   * 并发保护：Serializable 事务 + P2034 重试，回收方向走条件更新防超扣。
   */
  async grantAdminSmsBalance(
    user: AuthenticatedUser,
    storeId: number,
    dto: GrantPulseAdminSmsBalanceDto,
  ): Promise<PulseAdminSmsAccountDto> {
    await this.accessService.assertAdminMemberMutationAccess(user, storeId);

    const store = await this.loadStoreOrThrow(storeId);
    const warningThresholdFen =
      this.smsAccountService.resolveWarningThresholdFen();
    const reason = dto.reason?.trim();
    const isGrant = dto.amountFen > 0;

    /*
     * 流水说明优先用运营填写的原因（如「客服补偿短信额度」）——那才是商家想看的。
     * 原先前缀「平台运营赠送短信额度：」与流水右侧的类型标签（平台赠送）完全重复，
     * 一行动两遍同样的信息。
     * 没填原因时回落到简短默认文案，保证流水永远有可读说明。
     */
    const description = reason ?? (isGrant ? '平台运营赠送' : '平台运营回收');

    const account = await this.runGrantTransaction(
      storeId,
      dto.amountFen,
      description,
    );

    return this.buildAccountDto(store, account, warningThresholdFen);
  }

  /**
   * 门店群发任务列表（平台运营视角）。
   *
   * 用途：群发失败**不自动退费**，运营要能「看到哪些任务失败了、失败了多少人」，
   * 才能人工核实后走 {@link refundBroadcast}。没有这个列表，失败任务只能靠
   * 商家反馈才知道，退费链路等于断了。
   */
  async listAdminSmsBroadcasts(
    user: AuthenticatedUser,
    storeId: number,
    query: GetPulseAdminSmsBroadcastsQueryDto,
  ): Promise<PulseAdminSmsBroadcastsResponseDto> {
    await this.accessService.assertAdminMemberMutationAccess(user, storeId);

    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? SMS_BROADCAST_DEFAULT_PAGE_SIZE,
      PULSE_ADMIN_SMS_MAX_PAGE_SIZE,
    );

    const where = {
      storeId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.smsBroadcastTask.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          broadcastId: true,
          content: true,
          status: true,
          recipientCount: true,
          validMobileCount: true,
          successCount: true,
          failedCount: true,
          chargedAmountFen: true,
          refundedAmountFen: true,
          lastError: true,
          createdAt: true,
        },
      }),
      this.prisma.smsBroadcastTask.count({ where }),
    ]);

    return {
      items: rows.map(
        (row): PulseAdminSmsBroadcastDto => ({
          broadcastId: row.broadcastId,
          content: row.content,
          status: row.status,
          recipientCount: row.recipientCount,
          validMobileCount: row.validMobileCount,
          successCount: row.successCount,
          failedCount: row.failedCount,
          chargedAmountFen: row.chargedAmountFen,
          refundedAmountFen: row.refundedAmountFen,
          refundable:
            this.isRefundableStatus(row.status) && row.refundedAmountFen === 0,
          lastError: row.lastError,
          createdAt: row.createdAt.getTime(),
        }),
      ),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  /**
   * 群发失败退费：把**未送达**部分的钱退回门店短信余额，并写 refund 流水。
   *
   * 设计约束：
   * - 只退失败条数对应的金额（成功送达的不退），且一个任务只能退一次；
   * - 只允许 failed / partial_failed：`sending` 还有机会发成功，提前退费等于白送钱；
   * - 只允许平台运营发起（商家端没有入口），原因写入流水便于对账。
   */
  async refundAdminSmsBroadcast(
    user: AuthenticatedUser,
    storeId: number,
    broadcastId: string,
    dto: RefundPulseAdminSmsBroadcastDto,
  ): Promise<PulseAdminSmsBroadcastRefundResultDto> {
    // 退费是加钱操作：权限校验必须在查任务之前，避免越权探测到「任务存在但无权」
    await this.accessService.assertAdminMemberMutationAccess(user, storeId);

    const task = await this.prisma.smsBroadcastTask.findFirst({
      where: { storeId, broadcastId },
      select: {
        id: true,
        status: true,
        unitPriceFen: true,
        chargedAmountFen: true,
        refundedAmountFen: true,
        smsSegments: true,
        validMobileCount: true,
        failedCount: true,
      },
    });
    if (!task) {
      throw new NotFoundException('群发任务不存在');
    }

    if (!this.isRefundableStatus(task.status)) {
      throw new BadRequestException(
        '只有发送失败或部分失败的任务可以退费；发送中的任务请等待派发结束',
      );
    }
    if (task.refundedAmountFen > 0) {
      throw new BadRequestException('该任务已退费，不能重复退费');
    }

    // 计费条数 = 每人分段数 × 有效收件人，反推每人分段数后按失败人数折算
    const perRecipientSegments =
      task.validMobileCount > 0
        ? Math.ceil(task.smsSegments / task.validMobileCount)
        : 0;
    const refundableFen = Math.min(
      task.failedCount * perRecipientSegments * task.unitPriceFen,
      task.chargedAmountFen - task.refundedAmountFen,
    );
    if (refundableFen <= 0) {
      throw new BadRequestException('该任务没有可退费金额');
    }

    const reason = dto.reason?.trim();
    const description = `群发短信失败退费（${task.failedCount} 人未送达）${reason ? `：${reason}` : ''}`;

    // 事务内二次确认「未退过」：并发点两次也不能退两遍
    const balanceFen = await this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.smsBroadcastTask.findUniqueOrThrow({
          where: { id: task.id },
          select: { refundedAmountFen: true },
        });
        if (fresh.refundedAmountFen > 0) {
          throw new BadRequestException('该任务已退费，不能重复退费');
        }

        await tx.storeSmsAccount.upsert({
          where: { storeId },
          create: { storeId },
          update: {},
        });

        const account = await tx.storeSmsAccount.update({
          where: { storeId },
          data: {
            balanceFen: { increment: refundableFen },
            totalConsumedFen: { decrement: refundableFen },
          },
          select: { balanceFen: true },
        });

        await tx.smsWalletLog.create({
          data: {
            storeId,
            type: SmsWalletLogType.refund,
            changeFen: refundableFen,
            balanceAfterFen: account.balanceFen,
            description,
            broadcastId,
          },
        });

        await tx.smsBroadcastTask.update({
          where: { id: task.id },
          data: { refundedAmountFen: { increment: refundableFen } },
        });

        return account.balanceFen;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      broadcastId,
      refundedAmountFen: refundableFen,
      failedCount: task.failedCount,
      balanceFen,
    };
  }

  private isRefundableStatus(status: string): boolean {
    return (
      SMS_BROADCAST_REFUNDABLE_STATUS_VALUES as readonly string[]
    ).includes(status);
  }

  /**
   * 在 Serializable 事务里完成「改余额 + 写流水」，写冲突时重试。
   *
   * 为什么必须 Serializable：`balance_fen` 的读写跨越两条语句
   * （先算新余额、再写回），默认的 Read Committed 下并发赠送会丢失更新。
   */
  private async runGrantTransaction(
    storeId: number,
    amountFen: number,
    description: string,
  ): Promise<PulseSmsAccountRow> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) =>
            this.applyBalanceChange(tx, storeId, amountFen, description),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          attempt >= SERIALIZABLE_RETRY_TIMES ||
          !isSerializationFailure(error)
        ) {
          throw error;
        }
      }
    }
  }

  private async applyBalanceChange(
    tx: Prisma.TransactionClient,
    storeId: number,
    amountFen: number,
    description: string,
  ): Promise<PulseSmsAccountRow> {
    // 账户行不存在时先建一条零余额行：短信侧刻意不建 Store 外键，
    // 账户按 storeId 惰性创建，避免为报表型表反向污染 Store model。
    await tx.storeSmsAccount.upsert({
      where: { storeId },
      create: { storeId },
      update: {},
    });

    let actualChangeFen = amountFen;

    if (amountFen >= 0) {
      await tx.storeSmsAccount.update({
        where: { storeId },
        data: { balanceFen: { increment: amountFen } },
      });
    } else {
      // 回收：条件更新防超扣——`balanceFen >= 扣减额` 由数据库原子判定，
      // 不做 read-then-write，否则并发回收会扣成负数。
      const requestedFen = -amountFen;
      const deducted = await tx.storeSmsAccount.updateMany({
        where: { storeId, balanceFen: { gte: requestedFen } },
        data: { balanceFen: { decrement: requestedFen } },
      });

      if (deducted.count === 0) {
        // 余额不足以全额回收：按清零处理（前端预览也是这个口径）
        const current = await tx.storeSmsAccount.findUnique({
          where: { storeId },
          select: { balanceFen: true },
        });
        const currentBalanceFen = current?.balanceFen ?? 0;
        if (currentBalanceFen <= 0) {
          throw new BadRequestException('当前门店短信余额已为 0，无法继续回收');
        }

        await tx.storeSmsAccount.update({
          where: { storeId },
          data: { balanceFen: 0 },
        });
        actualChangeFen = -currentBalanceFen;
      }
    }

    const updated = await tx.storeSmsAccount.findUniqueOrThrow({
      where: { storeId },
      select: SMS_ACCOUNT_SELECT,
    });

    await tx.smsWalletLog.create({
      data: {
        storeId,
        type:
          amountFen >= 0
            ? SmsWalletLogType.grant
            : SmsWalletLogType.admin_adjust,
        changeFen: actualChangeFen,
        balanceAfterFen: updated.balanceFen,
        description,
      },
    });

    return updated;
  }

  /**
   * 短信管理可见门店：与新客额度完全同一口径。
   *
   * 开发者（平台运营）：直接按「未注销 + 非排除名单」列出全部商家门店，
   * **不要求已经有短信账户**——从未发过短信的商家没有账户行，
   * 若按账户表过滤会被漏掉，运营也就没法给它赠送额度。
   *
   * 非开发者：仍退回 `resolveAdminMemberStoreIds`，只给自己的门店。
   */
  private async resolveVisibleStoreIds(
    user: AuthenticatedUser,
  ): Promise<number[]> {
    if (!this.accessService.isDeveloper(user)) {
      return this.accessService.resolveAdminMemberStoreIds(user);
    }

    const stores = await this.prisma.store.findMany({
      where: {
        ...this.accessService.buildAdminStoreExclusionWhere(),
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    return stores.map((store) => store.id);
  }

  /** 读取目标门店；已注销（软删）门店按「不存在」处理 */
  private async loadStoreOrThrow(
    storeId: number,
  ): Promise<PulseSmsStoreRecord> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: SMS_STORE_SELECT,
    });
    if (!store) {
      throw new NotFoundException('门店不存在');
    }

    return store;
  }

  /** 关键词命中门店名 / 主账号昵称 / 手机号（与前端 toLowerCase().includes 同口径） */
  private matchesKeyword(
    store: PulseSmsStoreRecord,
    keyword: string | undefined,
  ): boolean {
    const normalizedKeyword = keyword?.trim().toLowerCase();
    if (!normalizedKeyword) {
      return true;
    }

    return (
      resolveAdminMemberDisplayName(store)
        .toLowerCase()
        .includes(normalizedKeyword) ||
      resolveAdminMemberPhone(store).includes(normalizedKeyword) ||
      store.name.toLowerCase().includes(normalizedKeyword)
    );
  }

  private matchesHealth(
    account: SmsBalanceSnapshot | undefined,
    health: PulseAdminSmsHealthFilter,
    warningThresholdFen: number,
  ): boolean {
    return resolveSmsAccountHealth(account, warningThresholdFen) === health;
  }

  private buildAccountDto(
    store: PulseSmsStoreRecord,
    account: PulseSmsAccountRow | undefined,
    warningThresholdFen: number,
  ): PulseAdminSmsAccountDto {
    return {
      storeId: String(store.id),
      storeName: store.name,
      ownerName: resolveAdminMemberDisplayName(store),
      ownerPhone: resolveAdminMemberPhone(store),
      ownerAvatarUrl: store.owner.avatar ?? '',
      balanceFen: account?.balanceFen ?? 0,
      totalRechargedFen: account?.totalRechargedFen ?? 0,
      totalConsumedFen: account?.totalConsumedFen ?? 0,
      sentSmsCount: account?.sentSmsCount ?? 0,
      warningThresholdFen,
      updatedAt: account?.updatedAt?.getTime() ?? null,
    };
  }

  /**
   * 统计概览：只吃 keyword 过滤的完整门店集合。
   * 未赠送（余额 0 且从未消费）不计入「已耗尽」，否则新商家会被误标红。
   */
  private buildStats(
    stores: PulseSmsStoreRecord[],
    accountByStoreId: Map<number, PulseSmsAccountRow>,
    warningThresholdFen: number,
  ): PulseAdminSmsAccountsStatsDto {
    let totalBalanceFen = 0;
    let warningCount = 0;
    let exhaustedCount = 0;

    for (const store of stores) {
      const account = accountByStoreId.get(store.id);
      totalBalanceFen += account?.balanceFen ?? 0;

      const health = resolveSmsAccountHealth(account, warningThresholdFen);
      if (health === 'warning') {
        warningCount += 1;
      } else if (health === 'exhausted') {
        exhaustedCount += 1;
      }
    }

    return {
      storeCount: stores.length,
      totalBalanceFen,
      warningCount,
      exhaustedCount,
    };
  }

  /** 无可访问门店时的空分页结果（统计归零，结构与正常分页一致） */
  private buildEmptyPageResult(
    page: number,
    pageSize: number,
  ): PulseAdminSmsAccountsResponseDto {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      hasMore: false,
      stats: {
        storeCount: 0,
        totalBalanceFen: 0,
        warningCount: 0,
        exhaustedCount: 0,
      },
    };
  }
}
