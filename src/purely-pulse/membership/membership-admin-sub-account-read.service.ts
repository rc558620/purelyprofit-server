import { Injectable } from '@nestjs/common';
import { PlatformMembershipAccessService } from '../../purely-profit/member/platform-membership/platform-membership-access.service';
import { StoreSubAccountService } from '../../purely-profit/member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { PulseAdminEmployeeCandidateDto } from './dto/pulse-membership-admin-members.response.dto';
import type { PulseAdminSubAccountDetail } from './membership.types';

@Injectable()
export class PulseMembershipAdminSubAccountReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async buildAdminSubAccountDetail(
    storeId: number,
  ): Promise<PulseAdminSubAccountDetail> {
    const [benefitSnapshot, summary] = await Promise.all([
      this.platformMembershipAccessService.getSubAccountBenefitSnapshot(
        storeId,
      ),
      this.storeSubAccountService.getStoreSubAccountSummary(storeId),
    ]);

    return {
      eligible: benefitSnapshot.eligible,
      quota: summary.quota,
      quotaMax: benefitSnapshot.quotaMax,
      enabled: benefitSnapshot.enabled,
      usedCount: summary.usedCount,
      availableCount: summary.availableCount,
      roleSummary: summary.roleSummary.map((item) => ({
        role: item.role,
        activeCount: item.activeCount,
        inactiveCount: item.inactiveCount,
        disabledCount: item.disabledCount,
        assignedCount: item.assignedCount,
      })),
      slots: summary.slots.map((slot) => ({
        id: slot.id,
        slotIndex: slot.slotIndex,
        role: slot.role,
        status: slot.status,
        isAssigned: slot.isAssigned,
        employeeId: slot.employeeId,
        employeeName: slot.employeeName,
        canAccessHome: slot.canAccessHome,
        canUseHandover: slot.canUseHandover,
      })),
    };
  }

  async listAdminMemberEmployeeCandidates(
    storeId: number,
  ): Promise<PulseAdminEmployeeCandidateDto[]> {
    const [employees, employeeSlotMap] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          storeId,
          deletedAt: null,
          status: 'active',
        },
        select: {
          id: true,
          name: true,
          position: true,
          department: true,
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.buildEmployeeSlotMap(storeId),
    ]);

    return employees.map((employee) => ({
      id: String(employee.id),
      name: employee.name,
      position: employee.position ?? undefined,
      department: employee.department ?? undefined,
      hasSubAccount: employeeSlotMap.has(employee.id),
      assignedSlotIndex: employeeSlotMap.get(employee.id),
    }));
  }

  private async buildEmployeeSlotMap(
    storeId: number,
  ): Promise<Map<number, number>> {
    const subAccountSlots = await this.prisma.storeSubAccount.findMany({
      where: {
        storeId,
        isAssigned: true,
      },
      select: {
        employeeId: true,
        slotIndex: true,
      },
    });

    const employeeSlotMap = new Map<number, number>();
    for (const slot of subAccountSlots) {
      if (slot.employeeId) {
        employeeSlotMap.set(slot.employeeId, slot.slotIndex);
      }
    }

    return employeeSlotMap;
  }
}
