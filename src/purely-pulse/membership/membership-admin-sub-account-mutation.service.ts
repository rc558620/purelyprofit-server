import { StoreSubAccountRole } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { StoreSubAccountService } from '../../purely-profit/member/platform-membership/store-sub-account.service';
import type { UpdateStoreSubAccountSlotInput } from '../../purely-profit/member/platform-membership/store-sub-account.types';
import type {
  PulseAdminSubAccountQuotaMutationInput,
  PulseAdminSubAccountSlotMutationInput,
} from './membership.types';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';

@Injectable()
export class PulseMembershipAdminSubAccountMutationService {
  constructor(
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly mutationStateService: PulseMembershipAdminMutationStateService,
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
