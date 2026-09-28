import { StoreSubAccountRole } from '@prisma/client';
import { BadRequestException, Injectable } from '@nestjs/common';
import { isSubAccountPricingPlan } from '../../purely-profit/member/platform-membership/platform-membership.constants';
import { StoreMembershipLockedPriceService } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import { StoreSubAccountService } from '../../purely-profit/member/platform-membership/store-sub-account.service';
import type { UpdateStoreSubAccountSlotInput } from '../../purely-profit/member/platform-membership/store-sub-account.types';
import type {
  PulseAdminSubAccountAmountBackfillInput,
  PulseAdminSubAccountQuotaMutationInput,
  PulseAdminSubAccountSlotMutationInput,
} from './membership.types';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import { resolveAmountFen } from './membership-admin-money.utils';

@Injectable()
export class PulseMembershipAdminSubAccountMutationService {
  constructor(
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly mutationStateService: PulseMembershipAdminMutationStateService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
  ) {}

  async updateAdminMemberSubAccountQuota(
    memberId: number,
    userId: number,
    dto: PulseAdminSubAccountQuotaMutationInput,
  ): Promise<void> {
    await this.storeSubAccountService.updateQuota(
      memberId,
      dto.quota,
      userId,
      dto.reason,
    );

    if (dto.roleSummary?.length) {
      await this.syncAdminMemberSubAccountRoleSummary(memberId, dto.quota, dto);
    }

    // 关闭子账号能力（配额归零）时只清掉子账号加价：不再提供子账号，就不该继续
    // 收这部分的钱，定价公式随后退化为 max(当前配置价, 成交总额)。
    // ⚠️ 不能用 resetLockedPrices：那会连成交总额一起销毁，导致门店降级为免费、
    //    或是配额从 0 重新开通后，历史议价全部失效。
    if (dto.quota <= 0) {
      await this.lockedPriceService.clearSubAccountAmounts(memberId);
    }

    await this.mutationStateService.invalidateAdminMemberDerived(memberId);
  }

  /**
   * 补录 / 撤销存量门店的子账号加价。
   *
   * 只动子账号字段，**不改写成交总额**：补录是把当初没拆出来的那部分补上，
   * 而不是重新议价。不传加价即视为撤销补录，回退到旧口径。
   */
  async backfillSubAccountAmount(
    memberId: number,
    dto: PulseAdminSubAccountAmountBackfillInput,
  ): Promise<void> {
    // 月 / 季会员开不了子账号，对这两档补录没有意义，直接拒绝
    if (!isSubAccountPricingPlan(dto.planId)) {
      throw new BadRequestException(
        '仅年度 / 永久会员支持子账号，月度 / 季度档位无需补录子账号加价',
      );
    }

    const rawDisplay = dto.subAccountAmountDisplay;
    const trimmedDisplay =
      typeof rawDisplay === 'string' ? rawDisplay.trim() : '';
    // 未传、传 null 或空串 = 撤销补录（注意 0 是有效取值：这家店不收子账号的钱）
    const isRevoke = trimmedDisplay === '';

    // 未传数量 = 本次只改加价，**保留**已录入的数量：
    // updateMany 是无差别覆盖，不先读原值就会把「3 个子账号」抹成 NULL，
    // 续费卡随后回落实时配额，与账单上收的加价脱节
    let nextSubAccountCount = isRevoke ? null : (dto.subAccountCount ?? null);
    if (!isRevoke && dto.subAccountCount === undefined) {
      const existing = (
        await this.lockedPriceService.listLockedPrices(memberId)
      ).find((item) => item.planId === dto.planId);
      nextSubAccountCount = existing?.subAccountCount ?? null;
    }

    await this.lockedPriceService.updateSubAccountSnapshot({
      storeId: memberId,
      planId: dto.planId,
      subAccountAmount: isRevoke ? null : resolveAmountFen(trimmedDisplay),
      subAccountCount: nextSubAccountCount,
    });

    await this.mutationStateService.invalidateAdminMemberDerived(memberId);
  }

  async updateAdminMemberSubAccountSlot(
    memberId: number,
    dto: PulseAdminSubAccountSlotMutationInput,
  ): Promise<void> {
    await this.storeSubAccountService.updateSlot(
      memberId,
      dto as UpdateStoreSubAccountSlotInput,
    );
    await this.mutationStateService.invalidateAdminMemberDerived(memberId);
  }

  private async syncAdminMemberSubAccountRoleSummary(
    memberId: number,
    quota: number,
    dto: PulseAdminSubAccountQuotaMutationInput,
  ): Promise<void> {
    const roleSummary =
      dto.roleSummary?.filter((item) => item.slot <= quota) ?? [];
    if (roleSummary.length === 0) {
      return;
    }

    const currentSummary =
      await this.storeSubAccountService.getStoreSubAccountSummary(memberId);
    const slotSnapshotMap = new Map(
      currentSummary.slots.map((slot) => [slot.slotIndex, slot] as const),
    );

    for (const item of roleSummary.sort(
      (left, right) => left.slot - right.slot,
    )) {
      const currentSlot = slotSnapshotMap.get(item.slot);
      const shouldKeepAssignedEmployee =
        item.isAssigned ?? currentSlot?.isAssigned ?? false;
      await this.storeSubAccountService.updateSlot(memberId, {
        slotIndex: item.slot,
        role: item.role as StoreSubAccountRole,
        status: item.status ?? currentSlot?.status,
        employeeId: shouldKeepAssignedEmployee
          ? (currentSlot?.employeeId ?? null)
          : null,
        canAccessHome: currentSlot?.canAccessHome,
        canUseHandover: currentSlot?.canUseHandover,
      });
    }
  }
}
