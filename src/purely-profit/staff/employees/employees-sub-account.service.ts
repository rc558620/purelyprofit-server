import { BadRequestException, Injectable } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DEFAULT_ROLE_PERMISSIONS,
  toStoreSubAccountRole,
} from '../../access-control/access-control.constants';
import { StoreSubAccountLoginService } from '../../member/platform-membership/store-sub-account-login.service';
import type { UpdateEmployeeSubAccountDto } from './dto/employee-sub-account.dto';
import type { EmployeeResponseDto } from './dto/employee-response.dto';
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesProfileReadService } from './employees-profile-read.service';

@Injectable()
export class EmployeesSubAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly employeesProfileReadService: EmployeesProfileReadService,
    private readonly storeSubAccountLoginService: StoreSubAccountLoginService,
  ) {}

  async updateSubAccount(
    user: AuthenticatedUser,
    employeeId: number,
    dto: UpdateEmployeeSubAccountDto,
  ): Promise<EmployeeResponseDto> {
    this.employeesAccessService.ensureCanManageEmployeeSubAccount(user);

    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    // #8 修复：将槽位分配与登录账号创建纳入同一事务，避免孤立子账号
    await this.prisma.$transaction(async (tx) => {
      const existingSubAccount = await tx.storeSubAccount.findFirst({
        where: {
          storeId: employee.storeId,
          employeeId: employee.id,
          isAssigned: true,
        },
        select: { slotIndex: true },
      });

      let assignedSlotIndex: number | undefined;

      if (existingSubAccount) {
        // 缺陷4修复：CAS 原子更新已分配槽位，防止并发覆盖
        const casResult = await tx.storeSubAccount.updateMany({
          where: {
            storeId: employee.storeId,
            slotIndex: existingSubAccount.slotIndex,
            employeeId: employee.id,
            isAssigned: true,
          },
          data: {
            role: toStoreSubAccountRole(dto.role),
            status: 'active',
            assignedAt: new Date(),
            canAccessHome: true,
            canUseHandover: dto.role !== 'finance',
          },
        });
        if (casResult.count === 0) {
          throw new BadRequestException(
            '子账号槽位已被其他操作变更，请刷新后重试',
          );
        }
        assignedSlotIndex = existingSubAccount.slotIndex;
      } else {
        // 缺陷4修复：CAS 原子抢占空槽，防止并发串号
        const emptySlots = await tx.storeSubAccount.findMany({
          where: {
            storeId: employee.storeId,
            isAssigned: false,
            status: 'active',
          },
          select: { slotIndex: true },
          orderBy: { slotIndex: 'asc' },
        });

        for (const slot of emptySlots) {
          const casResult = await tx.storeSubAccount.updateMany({
            where: {
              storeId: employee.storeId,
              slotIndex: slot.slotIndex,
              isAssigned: false,
            },
            data: {
              role: toStoreSubAccountRole(dto.role),
              status: 'active',
              employeeId: employee.id,
              isAssigned: true,
              assignedAt: new Date(),
              canAccessHome: true,
              canUseHandover: dto.role !== 'finance',
            },
          });
          if (casResult.count > 0) {
            assignedSlotIndex = slot.slotIndex;
            break;
          }
        }
      }

      if (assignedSlotIndex === undefined) {
        throw new BadRequestException(
          '当前门店暂无可分配的子账号槽位，请先提升子账号额度',
        );
      }

      // 缺陷2修复：同步 Staff 角色与权限，使展示角色与真实登录权限同源
      // ── Bug 3 修复：移除冗余 storeId 过滤 ──
      // Employee.linkedStaffId 为 @unique，employeeProfile 条件已唯一定位 Staff。
      // 叠加 storeId 在 storeId 漂移时导致更新 0 行，角色与权限不同步。
      const staffRole =
        dto.role === 'manager' ? StaffRole.manager : StaffRole.staff;
      const staffPermissions = DEFAULT_ROLE_PERMISSIONS[staffRole];
      await tx.staff.updateMany({
        where: {
          employeeProfile: { is: { id: employee.id } },
        },
        data: {
          role: staffRole,
          permissions: [...staffPermissions],
        },
      });

      // 事务内创建/更新登录账号，失败时整个事务回滚
      await this.storeSubAccountLoginService.ensureEmployeeHasLoginAccount(
        employee.storeId,
        employee.id,
        {
          loginAccount: dto.loginAccount.trim(),
          password: dto.password.trim(),
        },
        tx,
      );
    });

    return this.employeesProfileReadService.buildEmployeeDetail(
      user,
      employeeId,
      'staff:update',
    );
  }
}
