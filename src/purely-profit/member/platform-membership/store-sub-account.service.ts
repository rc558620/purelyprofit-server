import { Injectable } from '@nestjs/common';
import {
  EmployeeStatus,
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountReadService } from './store-sub-account-read.service';
import { StoreSubAccountSlotService } from './store-sub-account-slot.service';
import type {
  StoreSubAccountSummary,
  UpdateStoreSubAccountSlotInput,
} from './store-sub-account.types';

@Injectable()
export class StoreSubAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSubAccountReadService: StoreSubAccountReadService,
    private readonly storeSubAccountSlotService: StoreSubAccountSlotService,
  ) {}

  async updateQuota(
    storeId: number,
    quota: number,
    operatorUserId: number,
    reason?: string,
  ): Promise<StoreSubAccountSummary> {
    return this.storeSubAccountSlotService.updateQuota(
      storeId,
      quota,
      operatorUserId,
      reason,
    );
  }

  async updateSlot(
    storeId: number,
    input: UpdateStoreSubAccountSlotInput,
  ): Promise<StoreSubAccountSummary> {
    return this.storeSubAccountSlotService.updateSlot(storeId, input);
  }

  async getStoreSubAccountSummary(
    storeId: number,
  ): Promise<StoreSubAccountSummary> {
    return this.storeSubAccountReadService.getStoreSubAccountSummary(storeId);
  }

  async findAssignedSubAccountByEmployee(
    storeId: number,
    employeeId: number,
  ): Promise<{
    id: number;
    slotIndex: number;
    role: StoreSubAccountRole;
    status: StoreSubAccountStatus;
    canUseHandover: boolean;
    canAccessHome: boolean;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    return this.prisma.storeSubAccount.findFirst({
      where: {
        storeId,
        employeeId,
        isAssigned: true,
      },
      select: {
        id: true,
        slotIndex: true,
        role: true,
        status: true,
        canUseHandover: true,
        canAccessHome: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async listAssignableHandoverCandidates(storeId: number): Promise<
    Array<{
      employeeId: number;
      employeeName: string;
      subAccountId: number;
      slotIndex: number;
      role: StoreSubAccountRole;
    }>
  > {
    const slots = await this.prisma.storeSubAccount.findMany({
      where: {
        storeId,
        isAssigned: true,
        status: StoreSubAccountStatus.active,
        canUseHandover: true,
        employee: {
          is: {
            storeId,
            status: EmployeeStatus.active,
          },
        },
      },
      select: {
        id: true,
        slotIndex: true,
        role: true,
        employee: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ slotIndex: 'asc' }],
    });

    return slots.flatMap((slot) =>
      slot.employee
        ? [
            {
              employeeId: slot.employee.id,
              employeeName: slot.employee.name,
              subAccountId: slot.id,
              slotIndex: slot.slotIndex,
              role: slot.role,
            },
          ]
        : [],
    );
  }
}
