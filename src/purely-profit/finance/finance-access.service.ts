import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { MEMBERSHIP_ACCESS_MESSAGES } from '../member/platform-membership/platform-membership-access.messages';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import type {
  ClampedHistoryRange,
  HistoryRange,
  MembershipRuleSnapshot,
} from '../member/platform-membership/platform-membership-access.shared';

/**
 * 财务域单请求访问上下文。
 *
 * 会员档案在一次请求内只读一次：功能开通校验、报表导出校验、历史窗口裁剪
 * 共用同一份规则快照，避免同一行被反复查询。
 */
export interface FinanceRequestContext {
  readonly storeId: number;
  readonly callerIsSubAccount: boolean;
  /** 历史窗口裁剪（纯内存计算，不再产生 DB 往返） */
  clamp(range: HistoryRange): ClampedHistoryRange;
  /** 报表导出权限校验（子账号沿用既有跳过语义） */
  assertReportExportEnabled(): void;
}

@Injectable()
export class FinanceAccessService {
  constructor(
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  getCurrentStoreIdOrThrow(user: AuthenticatedUser): number {
    const storeId = user.currentMembership?.storeId;
    if (!storeId) {
      throw new ForbiddenException('当前账号暂无门店权限');
    }
    return storeId;
  }

  /** 带用户态的入口：解析门店 + 组装财务访问上下文（会员档案仅读一次） */
  async getFinanceContext(
    user: AuthenticatedUser,
  ): Promise<FinanceRequestContext> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    return this.createContext(storeId, callerIsSubAccount);
  }

  /** 无用户态入口（缓存预热等）：同样只读一次会员档案 */
  async createContext(
    storeId: number,
    callerIsSubAccount: boolean,
  ): Promise<FinanceRequestContext> {
    const access =
      await this.platformMembershipAccessService.createMembershipAccessContext(
        storeId,
        callerIsSubAccount,
      );
    assertFinanceEnabled(access.snapshot);

    return {
      storeId,
      callerIsSubAccount,
      clamp: (range: HistoryRange) => access.clamp(range),
      assertReportExportEnabled: () =>
        assertReportExportEnabled(access.snapshot),
    };
  }
}

/** 功能开通校验：子账号快照为 null，沿用「不校验」语义 */
function assertFinanceEnabled(snapshot: MembershipRuleSnapshot | null): void {
  if (snapshot === null || snapshot.financeEnabled) {
    return;
  }

  throw new ForbiddenException(MEMBERSHIP_ACCESS_MESSAGES.financeDisabled);
}

/** 报表导出校验：子账号快照为 null，沿用「不校验」语义 */
function assertReportExportEnabled(
  snapshot: MembershipRuleSnapshot | null,
): void {
  if (snapshot === null || snapshot.reportExportEnabled) {
    return;
  }

  throw new ForbiddenException(MEMBERSHIP_ACCESS_MESSAGES.reportExportDisabled);
}
