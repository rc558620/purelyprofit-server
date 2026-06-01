import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  Prisma,
  StaffRole,
  StaffStatus,
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildAccountIdentifiers,
  buildLoginEmailFromAccount,
  isValidSubAccountLoginAccount,
} from '../../auth/auth.utils';
import { PlatformMembershipAccessService } from './platform-membership-access.service';

export interface StoreSubAccountSlotSummary {
  id: number;
  slotIndex: number;
  role: StoreSubAccountRole;
  status: StoreSubAccountStatus;
  isAssigned: boolean;
  employeeId: number | null;
  employeeName: string | null;
  canUseHandover: boolean;
  canAccessHome: boolean;
}

export interface StoreSubAccountRoleSummary {
  role: StoreSubAccountRole;
  activeCount: number;
  inactiveCount: number;
  disabledCount: number;
  assignedCount: number;
}

export interface StoreSubAccountSummary {
  quota: number;
  usedCount: number;
  availableCount: number;
  roleSummary: StoreSubAccountRoleSummary[];
  slots: StoreSubAccountSlotSummary[];
}

export interface UpdateStoreSubAccountSlotInput {
  slotIndex: number;
  role: StoreSubAccountRole;
  status?: StoreSubAccountStatus;
  employeeId?: number | null;
  canUseHandover?: boolean;
  canAccessHome?: boolean;
  /** 可选：覆盖子账号登录账号，支持字母/数字/下划线的 6~32 位账号。 */
  loginAccount?: string;
  /** 可选：为子账号设置初始密码。仅在分配员工时生效，若员工尚无登录账号则会创建。 */
  initialPassword?: string;
}

@Injectable()
export class StoreSubAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membershipAccessService: PlatformMembershipAccessService,
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

    return this.getStoreSubAccountSummary(storeId);
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

    // 如果分配了员工，需要确保员工有对应的登录账号
    if (
      employee &&
      (input.initialPassword || input.loginAccount !== undefined)
    ) {
      await this.ensureEmployeeHasLoginAccount(storeId, employee.id, {
        password: input.initialPassword,
        loginAccount: input.loginAccount,
      });
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

    return this.getStoreSubAccountSummary(storeId);
  }

  /**
   * 确保员工有对应的登录账号（User + Staff）
   * 支持按手机号登录，也支持通过自定义账号别名登录。
   */
  private async ensureEmployeeHasLoginAccount(
    storeId: number,
    employeeId: number,
    input: {
      password?: string;
      loginAccount?: string;
    },
  ): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        phone: true,
        name: true,
        linkedStaffId: true,
        linkedStaff: {
          select: {
            id: true,
            userId: true,
            email: true,
            user: {
              select: {
                id: true,
                password: true,
              },
            },
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    if (!employee.phone) {
      throw new BadRequestException('员工手机号为空，无法创建登录账号');
    }

    const normalizedPassword = input.password?.trim();
    const normalizedLoginAccount = input.loginAccount?.trim();

    if (
      normalizedLoginAccount !== undefined &&
      normalizedLoginAccount.length > 0 &&
      !isValidSubAccountLoginAccount(normalizedLoginAccount)
    ) {
      throw new BadRequestException(
        '登录账号仅支持 6~32 位字母、数字或下划线，且不可使用保留账号',
      );
    }

    const nextLoginEmail = normalizedLoginAccount
      ? buildLoginEmailFromAccount(normalizedLoginAccount)
      : null;

    if (employee.linkedStaff) {
      if (nextLoginEmail) {
        await this.ensureLoginAccountAvailable(
          employee.linkedStaff.id,
          nextLoginEmail,
        );
      }

      if (!employee.linkedStaff.userId) {
        if (!normalizedPassword) {
          throw new BadRequestException('首次设置子账号时必须填写登录密码');
        }

        const user = await this.createOrFindUser(
          employee.phone,
          employee.name ?? `员工${employee.id}`,
          normalizedPassword,
        );
        await this.prisma.staff.update({
          where: { id: employee.linkedStaff.id },
          data: {
            userId: user.id,
            ...(nextLoginEmail ? { email: nextLoginEmail } : {}),
          },
        });
        return;
      }

      if (nextLoginEmail && employee.linkedStaff.email !== nextLoginEmail) {
        await this.prisma.staff.update({
          where: { id: employee.linkedStaff.id },
          data: { email: nextLoginEmail },
        });
      }

      if (normalizedPassword) {
        await this.updateUserPassword(
          employee.linkedStaff.userId,
          normalizedPassword,
        );
      }
      return;
    }

    if (!normalizedPassword) {
      throw new BadRequestException('首次设置子账号时必须填写登录密码');
    }

    const user = await this.createOrFindUser(
      employee.phone,
      employee.name ?? `员工${employee.id}`,
      normalizedPassword,
    );

    const nextStaffEmail =
      nextLoginEmail ?? buildAccountIdentifiers(employee.phone).email;
    const existingStaff = await this.prisma.staff.findFirst({
      where: {
        phone: employee.phone,
        storeId,
      },
      select: { id: true, userId: true },
    });

    if (existingStaff) {
      await this.ensureLoginAccountAvailable(existingStaff.id, nextStaffEmail);
      await this.prisma.staff.update({
        where: { id: existingStaff.id },
        data: {
          ...(existingStaff.userId ? {} : { userId: user.id }),
          email: nextStaffEmail,
        },
      });
      await this.prisma.employee.update({
        where: { id: employeeId },
        data: { linkedStaffId: existingStaff.id },
      });
      return;
    }

    const newStaff = await this.prisma.staff.create({
      data: {
        storeId,
        userId: user.id,
        email: nextStaffEmail,
        name: employee.name ?? `员工${employee.id}`,
        phone: employee.phone,
        role: StaffRole.STAFF,
        permissions: [],
        status: StaffStatus.ACTIVE,
        isSeatActive: true,
        isActive: true,
      },
    });
    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { linkedStaffId: newStaff.id },
    });
  }

  private async ensureLoginAccountAvailable(
    currentStaffId: number,
    loginEmail: string,
  ): Promise<void> {
    const conflictStaff = await this.prisma.staff.findFirst({
      where: {
        email: loginEmail,
        id: { not: currentStaffId },
      },
      select: { id: true },
    });

    if (conflictStaff) {
      throw new ConflictException('登录账号已被其他员工使用');
    }
  }

  /**
   * 创建新 User 或查找已存在的 User（通过手机号别名邮箱）
   */
  private async createOrFindUser(
    phone: string,
    name: string,
    password: string,
  ): Promise<{ id: number }> {
    const aliasEmail = buildAccountIdentifiers(phone).email;

    // 先检查是否已存在该手机号对应的 User
    // 通过 Staff.phone -> Staff.userId -> User 或 User.email 查找
    const existingStaffWithUser = await this.prisma.staff.findFirst({
      where: {
        phone,
        userId: { not: null },
      },
      select: {
        user: {
          select: { id: true },
        },
      },
    });

    if (existingStaffWithUser?.user) {
      // 用户已存在，更新密码
      await this.updateUserPassword(existingStaffWithUser.user.id, password);
      return existingStaffWithUser.user;
    }

    // 检查是否已存在该别名邮箱的 User
    const existingUser = await this.prisma.user.findUnique({
      where: { email: aliasEmail },
      select: { id: true },
    });

    if (existingUser) {
      // 用户已存在，更新密码
      await this.updateUserPassword(existingUser.id, password);
      return existingUser;
    }

    // 创建新用户
    const hashedPassword = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: {
        email: aliasEmail,
        password: hashedPassword,
        name,
      },
      select: { id: true },
    });
  }

  /**
   * 更新用户密码
   */
  private async updateUserPassword(
    userId: number,
    password: string,
  ): Promise<void> {
    const hashedPassword = await bcrypt.hash(password, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }

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
        '[store-sub-account] store_sub_accounts schema not ready, fallback to empty summary',
      );

      return this.buildEmptySummary(entitlement.quota);
    }
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

    for (let slotIndex = 1; slotIndex <= quota; slotIndex += 1) {
      if (existingSlotIndexes.has(slotIndex)) {
        await tx.storeSubAccount.update({
          where: {
            storeId_slotIndex: {
              storeId,
              slotIndex,
            },
          },
          data: {
            status: StoreSubAccountStatus.active,
            canAccessHome: true,
          },
        });
        continue;
      }

      await tx.storeSubAccount.create({
        data: {
          storeId,
          slotIndex,
          role: StoreSubAccountRole.cashier,
          status: StoreSubAccountStatus.active,
          isAssigned: false,
          canAccessHome: true,
          canUseHandover: true,
        },
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
        status: EmployeeStatus.active,
      },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException('目标员工不存在或未处于在职状态');
    }

    return employee;
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

  private buildEmptySummary(quota: number): StoreSubAccountSummary {
    return {
      quota,
      usedCount: 0,
      availableCount: quota,
      roleSummary: this.buildRoleSummary([]),
      slots: [],
    };
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
