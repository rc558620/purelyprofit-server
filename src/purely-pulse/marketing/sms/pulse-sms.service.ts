// Pulse / 群发短信账户服务
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
//
// 拆分说明：群发任务列表 / 失败退费见 `pulse-sms-broadcast.service.ts`，
// 账户读模型（查询字段 / 健康度 / DTO 组装）见 `pulse-sms-account.helper.ts`，
// 钱包流水查询见 `pulse-sms-wallet-logs.service.ts`。
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SmsWalletLogType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../../purely-profit/auth/strategies/jwt.strategy';
import { SmsAccountService } from '../../../purely-profit/marketing/sms/sms-account.service';
import { PulseMembershipAccessService } from '../../membership/membership-access.service';
import type {
  GetPulseAdminSmsAccountsQueryDto,
  GrantPulseAdminSmsBalanceDto,
} from './dto/pulse-sms.request.dto';
import {
  PULSE_ADMIN_SMS_DEFAULT_PAGE_SIZE,
  PULSE_ADMIN_SMS_MAX_PAGE_SIZE,
} from './dto/pulse-sms.request.dto';
import type {
  PulseAdminSmsAccountDto,
  PulseAdminSmsAccountsResponseDto,
} from './dto/pulse-sms.response.dto';
import {
  SMS_ACCOUNT_SELECT,
  SMS_STORE_SELECT,
  buildEmptySmsAccountsPage,
  buildSmsAccountDto,
  buildSmsAccountsStats,
  matchesSmsStoreKeyword,
  resolveSmsAccountHealth,
} from './pulse-sms-account.helper';
import type {
  PulseSmsAccountRow,
  PulseSmsStoreRecord,
} from './pulse-sms-account.helper';

/** Serializable 事务写冲突（P2034）的重试次数 */
const SERIALIZABLE_RETRY_TIMES = 3;

/** 判断是否为可重试的序列化失败 */
const isSerializationFailure = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2034';

/** 账户一览的中间态：关键词命中集 / 最终可见集 / 门店账户索引 */
interface SmsAccountsSnapshot {
  keywordMatchedStores: PulseSmsStoreRecord[];
  visibleStores: PulseSmsStoreRecord[];
  accountByStoreId: Map<number, PulseSmsAccountRow>;
}

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
      return buildEmptySmsAccountsPage(page, pageSize);
    }

    const snapshot = await this.loadAccountSnapshot(
      storeIds,
      query,
      warningThresholdFen,
    );
    const { keywordMatchedStores, visibleStores, accountByStoreId } = snapshot;

    return {
      items: visibleStores
        .slice((page - 1) * pageSize, page * pageSize)
        .map((store) =>
          buildSmsAccountDto(
            store,
            accountByStoreId.get(store.id),
            warningThresholdFen,
          ),
        ),
      total: visibleStores.length,
      page,
      pageSize,
      hasMore: page * pageSize < visibleStores.length,
      // 统计只吃 keyword 过滤：概览指标不随「已耗尽」等 Tab 抖动
      stats: buildSmsAccountsStats(
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
    const isGrant = dto.amountFen > 0;

    /*
     * 流水说明优先用运营填写的原因（如「客服补偿短信额度」）——那才是商家想看的。
     * 原先前缀「平台运营赠送短信额度：」与流水右侧的类型标签（平台赠送）完全重复，
     * 一行动两遍同样的信息。
     * 没填原因时回落到简短默认文案，保证流水永远有可读说明。
     */
    const description =
      dto.reason?.trim() ?? (isGrant ? '平台运营赠送' : '平台运营回收');

    const account = await this.runGrantTransaction(
      storeId,
      dto.amountFen,
      description,
    );

    return buildSmsAccountDto(store, account, warningThresholdFen);
  }

  /** 拉取门店与短信账户，并完成 keyword / health 内存过滤 */
  private async loadAccountSnapshot(
    storeIds: number[],
    query: GetPulseAdminSmsAccountsQueryDto,
    warningThresholdFen: number,
  ): Promise<SmsAccountsSnapshot> {
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
      matchesSmsStoreKeyword(store, query.keyword),
    );

    // 先收敛成局部常量，闭包里才能保留非空收窄，避免把类型断言散进业务代码
    const healthFilter = query.health;
    const visibleStores = healthFilter
      ? keywordMatchedStores.filter(
          (store) =>
            resolveSmsAccountHealth(
              accountByStoreId.get(store.id),
              warningThresholdFen,
            ) === healthFilter,
        )
      : keywordMatchedStores;

    return { keywordMatchedStores, visibleStores, accountByStoreId };
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

  /** 事务内落账：确保账户行存在 → 调整余额 → 带余额快照写钱包流水 */
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

    const actualChangeFen = await this.adjustBalanceFen(tx, storeId, amountFen);

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

  /** 按增量调整余额，返回真实变动金额 */
  private async adjustBalanceFen(
    tx: Prisma.TransactionClient,
    storeId: number,
    amountFen: number,
  ): Promise<number> {
    if (amountFen >= 0) {
      await tx.storeSmsAccount.update({
        where: { storeId },
        data: { balanceFen: { increment: amountFen } },
      });
      return amountFen;
    }

    // 回收：条件更新防超扣——`balanceFen >= 扣减额` 由数据库原子判定，
    // 不做 read-then-write，否则并发回收会扣成负数。
    const requestedFen = -amountFen;
    const deducted = await tx.storeSmsAccount.updateMany({
      where: { storeId, balanceFen: { gte: requestedFen } },
      data: { balanceFen: { decrement: requestedFen } },
    });
    if (deducted.count > 0) {
      return amountFen;
    }

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
    return -currentBalanceFen;
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
}
