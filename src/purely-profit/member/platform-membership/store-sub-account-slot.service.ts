import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  Prisma,
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from './platform-membership-access.service';
import { StoreSubAccountLoginService } from './store-sub-account-login.service';
import { StoreSubAccountReadService } from './store-sub-account-read.service';
import type {
  StoreSubAccountSummary,
  UpdateStoreSubAccountSlotInput,
} from './store-sub-account.types';

@Injectable()
export class StoreSubAccountSlotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membershipAccessService: PlatformMembershipAccessService,
    private readonly storeSubAccountLoginService: StoreSubAccountLoginService,
    private readonly storeSubAccountReadService: StoreSubAccountReadService,
  ) {}

  async updateQuota(
    storeId: number,
    quota: number,
    operatorUserId: number,
    reason?: string,
  ): Promise<StoreSubAccountSummary> {
    await this.membershipAccessService.ensureSubAccountConfigurable(
      storeId,
      quota,
    );
    const current =
      await this.membershipAccessService.getSubAccountBenefitSnapshot(storeId);

    await this.prisma.$transaction(async (tx) => {
      await tx.storeMembershipProfile.upsert({
        where: { storeId },
        create: {
          storeId,
          subAccountQuota: quota,
          totalPoints: 0,
          availablePoints: 0,
        },
        update: {
          subAccountQuota: quota,
        },
      });
      await this.syncSlotsToQuota(tx, storeId, quota);
      await tx.storeSubAccountQuotaAudit.create({
        data: {
          storeId,
          oldQuota: current.rawQuota,
          newQuota: quota,
          operatorUserId,
          reason: reason?.trim() || null,
        },
      });
    });

    return this.storeSubAccountReadService.getStoreSubAccountSummary(storeId);
  }

  async updateSlot(
    storeId: number,
    input: UpdateStoreSubAccountSlotInput,
  ): Promise<StoreSubAccountSummary> {
    const entitlement =
      await this.membershipAccessService.getSubAccountBenefitSnapshot(storeId);
    if (!entitlement.enabled) {
      throw new BadRequestException(
        '当前门店未启用子账号额度，无法配置子账号槽位',
      );
    }

    if (input.slotIndex < 1 || input.slotIndex > entitlement.quota) {
      throw new BadRequestException('子账号槽位超出当前已配置额度');
    }

    const employee = await this.resolveAssignedEmployee(
      storeId,
      input.employeeId,
    );

    if (
      !employee &&
      (input.initialPassword || input.loginAccount !== undefined)
    ) {
      throw new BadRequestException('未分配员工时不能配置子账号登录信息');
    }

    if (
      employee &&
      (input.initialPassword || input.loginAccount !== undefined)
    ) {
      await this.storeSubAccountLoginService.ensureEmployeeHasLoginAccount(
        storeId,
        employee.id,
        {
          password: input.initialPassword,
          loginAccount: input.loginAccount,
        },
      );
    }

    const status = input.status ?? StoreSubAccountStatus.active;
    const canAccessHome =
      input.canAccessHome ?? status === StoreSubAccountStatus.active;
    const canUseHandover =
      input.canUseHandover ?? status === StoreSubAccountStatus.active;

    await this.prisma.storeSubAccount.upsert({
      where: {
        storeId_slotIndex: {
          storeId,
          slotIndex: input.slotIndex,
        },
      },
      create: {
        storeId,
        slotIndex: input.slotIndex,
        role: input.role,
        status,
        employeeId: employee?.id ?? null,
        isAssigned: Boolean(employee),
        assignedAt: employee ? new Date() : null,
        canAccessHome,
        canUseHandover,
      },
      update: {
        role: input.role,
        status,
        employeeId: employee?.id ?? null,
        isAssigned: Boolean(employee),
        assignedAt: employee ? new Date() : null,
        canAccessHome,
        canUseHandover,
      },
    });

    return this.storeSubAccountReadService.getStoreSubAccountSummary(storeId);
  }

  private async syncSlotsToQuota(
    tx: Prisma.TransactionClient,
    storeId: number,
    quota: number,
  ): Promise<void> {
    const existingSlots = await tx.storeSubAccount.findMany({
      where: { storeId },
      select: {
        slotIndex: true,
      },
      orderBy: [{ slotIndex: 'asc' }],
    });
    const existingSlotIndexes = new Set(
      existingSlots.map((slot) => slot.slotIndex),
    );

    // 收集需要更新（已有 slot）和需要创建（新 slot）的索引列表
    const slotIndexesToUpdate: number[] = [];
    const slotIndexesToCreate: number[] = [];
    for (let slotIndex = 1; slotIndex <= quota; slotIndex += 1) {
      if (existingSlotIndexes.has(slotIndex)) {
        slotIndexesToUpdate.push(slotIndex);
      } else {
        slotIndexesToCreate.push(slotIndex);
      }
    }

    // 批量激活已有 slot（updateMany by storeId + slotIndex IN），替代逐条 update
    if (slotIndexesToUpdate.length > 0) {
      await tx.storeSubAccount.updateMany({
        where: {
          storeId,
          slotIndex: { in: slotIndexesToUpdate },
        },
        data: {
          status: StoreSubAccountStatus.active,
          canAccessHome: true,
        },
      });
    }

    // 批量创建缺失 slot（createMany），替代逐条 create
    if (slotIndexesToCreate.length > 0) {
      await tx.storeSubAccount.createMany({
        data: slotIndexesToCreate.map((slotIndex) => ({
          storeId,
          slotIndex,
          role: StoreSubAccountRole.cashier,
          status: StoreSubAccountStatus.active,
          isAssigned: false,
          canAccessHome: true,
          canUseHandover: true,
        })),
      });
    }

    if (existingSlotIndexes.size <= quota) {
      return;
    }

    await tx.storeSubAccount.updateMany({
      where: {
        storeId,
        slotIndex: { gt: quota },
      },
      data: {
        status: StoreSubAccountStatus.disabled,
        employeeId: null,
        isAssigned: false,
        assignedAt: null,
        canAccessHome: false,
        canUseHandover: false,
      },
    });
  }

  private async resolveAssignedEmployee(
    storeId: number,
    employeeId: number | null | undefined,
  ): Promise<{ id: number } | null> {
    if (employeeId === undefined || employeeId === null) {
      return null;
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        storeId,
        deletedAt: null,
        status: EmployeeStatus.active,
      },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException('目标员工不存在或未处于在职状态');
    }

    return employee;
  }
}
