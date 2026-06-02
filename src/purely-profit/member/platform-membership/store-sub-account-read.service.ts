import { Injectable, UnauthorizedException } from '@nestjs/common';
import { StoreSubAccountRole, StoreSubAccountStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from './platform-membership-access.service';
import type {
  StoreSubAccountRoleSummary,
  StoreSubAccountSlotSummary,
  StoreSubAccountSummary,
} from './store-sub-account.types';

@Injectable()
export class StoreSubAccountReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getStoreSubAccountSummary(
    storeId: number,
  ): Promise<StoreSubAccountSummary> {
    const entitlement =
      await this.membershipAccessService.getSubAccountBenefitSnapshot(storeId);

    try {
      const slots = await this.prisma.storeSubAccount.findMany({
        where: { storeId },
        select: {
          id: true,
          slotIndex: true,
          role: true,
          status: true,
          isAssigned: true,
          employeeId: true,
          canUseHandover: true,
          canAccessHome: true,
          employee: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [{ slotIndex: 'asc' }],
      });

      const normalizedSlots = slots
        .filter(
          (slot) =>
            slot.slotIndex <= Math.max(entitlement.rawQuota, entitlement.quota),
        )
        .map((slot) => ({
          id: slot.id,
          slotIndex: slot.slotIndex,
          role: slot.role,
          status: slot.status,
          isAssigned: slot.isAssigned,
          employeeId: slot.employeeId,
          employeeName: slot.employee?.name ?? null,
          canUseHandover: slot.canUseHandover,
          canAccessHome: slot.canAccessHome,
        }));

      return {
        quota: entitlement.quota,
        usedCount: normalizedSlots.filter((slot) => slot.isAssigned).length,
        availableCount: Math.max(
          entitlement.quota -
            normalizedSlots.filter((slot) => slot.isAssigned).length,
          0,
        ),
        roleSummary: this.buildRoleSummary(normalizedSlots),
        slots: normalizedSlots,
      };
    } catch (error: unknown) {
      if (!this.isMissingStoreSubAccountSchemaError(error)) {
        throw error;
      }

      console.warn(
        '[store-sub-account] store_sub_accounts schema not ready, deny request to avoid stale sub-account summary fallback',
      );
      throw new UnauthorizedException(
        '子账号能力上下文未就绪，请联系管理员完成系统升级后重试',
      );
    }
  }

  private buildRoleSummary(
    slots: StoreSubAccountSlotSummary[],
  ): StoreSubAccountRoleSummary[] {
    return [
      StoreSubAccountRole.cashier,
      StoreSubAccountRole.finance,
      StoreSubAccountRole.manager,
    ].map((role) => {
      const roleSlots = slots.filter((slot) => slot.role === role);
      return {
        role,
        activeCount: roleSlots.filter(
          (slot) => slot.status === StoreSubAccountStatus.active,
        ).length,
        inactiveCount: roleSlots.filter(
          (slot) => slot.status === StoreSubAccountStatus.inactive,
        ).length,
        disabledCount: roleSlots.filter(
          (slot) => slot.status === StoreSubAccountStatus.disabled,
        ).length,
        assignedCount: roleSlots.filter((slot) => slot.isAssigned).length,
      };
    });
  }

  private isMissingStoreSubAccountSchemaError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

    if (
      !message.includes('store_sub_accounts') &&
      !message.includes('store sub account') &&
      !message.includes('can_access_home') &&
      !message.includes('can_use_handover')
    ) {
      return false;
    }

    return (
      message.includes('does not exist') ||
      message.includes("doesn't exist") ||
      message.includes('unknown column') ||
      message.includes('no such column') ||
      message.includes('unknown field') ||
      message.includes('column')
    );
  }
}
