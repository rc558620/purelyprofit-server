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
import {
  PrismaService,
  TX_TIMEOUT_MEDIUM,
} from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from './platform-membership-access.service';
import { StoreSubAccountLoginService } from './store-sub-account-login.service';
import { StoreSubAccountReadService } from './store-sub-account-read.service';
import type {
  StoreSubAccountSummary,
  UpdateStoreSubAccountSlotInput,
} from './store-sub-account.types';

type PrismaClientOrTransaction = PrismaService | Prisma.TransactionClient;

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
    // 额度快照与变更写入放在同一事务内读取，避免并发下审计记录写入的是过期 oldQuota
    await this.prisma.$transaction(async (tx) => {
      const current =
        await this.membershipAccessService.getSubAccountBenefitSnapshot(
          storeId,
          tx,
        );

      await tx.storeMembershipProfile.upsert({
        where: { storeId },
        create: {
          storeId,
          pulseSubAccountQuota: quota,
          totalPoints: 0,
          availablePoints: 0,
        },
        update: {
          pulseSubAccountQuota: quota,
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
    // 额度校验、登录凭证创建、槽位 upsert 必须在同一事务内完成：
    // 拆成先后两次独立写时，「收缩额度（updateQuota）」与「配置高序号槽位（updateSlot）」
    // 并发会互相覆盖——被 disabled 的槽位可能被重新写回 active，且该槽位员工的登录凭证
    // 已创建完成，于是出现超出配额、仍可登录的幽灵子账号。
    await this.prisma.$transaction(
      async (tx) => {
        // 事务内重读额度快照（走 tx 连接），确保读到的是提交后的最新额度
        const entitlement =
          await this.membershipAccessService.getSubAccountBenefitSnapshot(
            storeId,
            tx,
          );
        if (!entitlement.enabled) {
          throw new BadRequestException(
            '当前门店未启用子账号额度，无法配置子账号槽位',
          );
        }

        if (input.slotIndex < 1 || input.slotIndex > entitlement.quota) {
          throw new BadRequestException('子账号槽位超出当前已配置额度');
        }

        const employee = await this.resolveAssignedEmployee(
          tx,
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
            tx,
          );
        }

        const status = input.status ?? StoreSubAccountStatus.active;
        const canAccessHome =
          input.canAccessHome ?? status === StoreSubAccountStatus.active;
        // 交班参与权按角色强制派生：财务视角永不参与交班（仅保留 handover:view
        // 只读审计查看），其他角色未显式指定时跟随槽位启用状态。
        // 与员工分配路径（deriveSubAccountCanUseHandover）保持同一口径，
        // 避免经槽位路径创建的财务子账号获得交班事务权限。
        const canUseHandover =
          input.role === StoreSubAccountRole.finance
            ? false
            : (input.canUseHandover ?? status === StoreSubAccountStatus.active);

        await tx.storeSubAccount.upsert({
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
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

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
        employeeId: true,
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

    // 先摘出待关闭槽位已分配的员工：下面的 updateMany 会把 employeeId 置空，
    // 之后再也回溯不到需要吊销登录凭证的账号。
    const closedEmployeeIds = [
      ...new Set(
        existingSlots
          .filter((slot) => slot.slotIndex > quota)
          .map((slot) => slot.employeeId)
          .filter((id): id is number => id != null),
      ),
    ];

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

    // 关闭子账号能力时必须一并吊销登录凭证，否则旧子账号持原账号密码仍能登录
    // purelyProfit（员工 Staff 行还是 active）。解绑后员工档案保留，重新分配
    // 槽位即等于全新子账号。
    if (closedEmployeeIds.length > 0) {
      await this.storeSubAccountLoginService.revokeEmployeeLoginAccounts(
        storeId,
        closedEmployeeIds,
        tx,
      );
    }
  }

  private async resolveAssignedEmployee(
    db: PrismaClientOrTransaction,
    storeId: number,
    employeeId: number | null | undefined,
  ): Promise<{ id: number } | null> {
    if (employeeId === undefined || employeeId === null) {
      return null;
    }

    const employee = await db.employee.findFirst({
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
