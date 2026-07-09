import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoreSubAccountStatus } from '@prisma/client';
import {
  STORE_SUB_ACCOUNT_ROLE_LABELS,
  toStoreSubAccountRoleCode,
} from '../../access-control/access-control.constants';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  EmployeeResponseDto,
  EmployeesOverviewQueryDto,
  EmployeesOverviewResponseDto,
  ListEmployeesQueryDto,
  PaginatedEmployeesResponseDto,
} from './dto/employee-response.dto';
import { EmployeesAccessService } from './employees-access.service';
import {
  buildEmployeeListOrderBy,
  buildEmployeeListWhere,
  buildEmployeesOverviewResponse,
} from './employees-list.domain';
import { toEmployeeResponse } from './employees.mapper';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import {
  queryEmployeesOverviewMetrics,
  queryEmployeesPage,
} from './employees.query';
import {
  buildPaginationMeta,
  getStartOfCurrentMonth,
  resolvePagination,
} from './employees.utils';

@Injectable()
export class EmployeesProfileReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly configService: ConfigService,
    private readonly storeSubAccountService: StoreSubAccountService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListEmployeesQueryDto,
  ): Promise<PaginatedEmployeesResponseDto> {
    const storeId = await this.employeesAccessService.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店员工列表',
    );
    const { page, skip, take } = this.resolvePagination(
      query.page,
      query.pageSize,
    );
    const result = await queryEmployeesPage(this.prisma, {
      where: buildEmployeeListWhere(storeId, query),
      orderBy: buildEmployeeListOrderBy(query.status),
      skip,
      take,
    });

    if (result.items.length === 0) {
      return {
        items: [],
        meta: buildPaginationMeta(result.total, page, take),
      };
    }

    const canViewSubAccountModule =
      user.currentMembership?.subjectType !== 'sub_account';

    const subAccountMap = canViewSubAccountModule
      ? await this.buildEmployeeSubAccountMap(
          storeId,
          result.items.map((employee) => ({
            id: employee.id,
            phone: employee.phone,
          })),
        )
      : new Map<number, EmployeeResponseDto['subAccount']>();

    const viewOptions = { canViewSubAccountModule };

    return {
      items: result.items.map((employee) =>
        toEmployeeResponse(
          employee,
          subAccountMap.get(employee.id),
          viewOptions,
        ),
      ),
      meta: buildPaginationMeta(result.total, page, take),
    };
  }

  async getOverview(
    user: AuthenticatedUser,
    query: EmployeesOverviewQueryDto,
  ): Promise<EmployeesOverviewResponseDto> {
    const storeId = await this.employeesAccessService.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店员工概览',
    );
    const metrics = await queryEmployeesOverviewMetrics(this.prisma, {
      storeId,
      monthStart: getStartOfCurrentMonth(),
    });

    return buildEmployeesOverviewResponse(metrics);
  }

  async getDetail(
    user: AuthenticatedUser,
    employeeId: number,
  ): Promise<EmployeeResponseDto> {
    return this.buildEmployeeDetail(user, employeeId, 'staff:view');
  }

  async buildEmployeeDetail(
    user: AuthenticatedUser,
    employeeId: number,
    permission: 'staff:view' | 'staff:update',
  ): Promise<EmployeeResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        permission,
      );
    const detailCapabilities =
      this.employeesAccessService.buildEmployeeDetailCapabilities(
        user,
        employee.storeId,
      );
    const subAccountMap = detailCapabilities.canViewSubAccountModule
      ? await this.buildEmployeeSubAccountMap(employee.storeId, [
          { id: employee.id, phone: employee.phone },
        ])
      : new Map<number, EmployeeResponseDto['subAccount']>();

    return toEmployeeResponse(
      employee,
      subAccountMap.get(employee.id),
      detailCapabilities,
    );
  }

  private async buildEmployeeSubAccountMap(
    _storeId: number,
    employees: Array<{ id: number; phone: string }>,
  ): Promise<Map<number, EmployeeResponseDto['subAccount']>> {
    if (employees.length === 0) {
      return new Map();
    }

    const employeeIds = employees.map((employee) => employee.id);
    const [subAccounts, linkedStaffs] = await Promise.all([
      // ── Bug 3 修复：移除冗余 storeId 过滤 ──
      // employeeId 为 @unique，按 employeeId 已可唯一定位子账号。
      // 叠加 storeId 在账号全局化模型下会因 storeId 漂移导致数据缺失。
      this.prisma.storeSubAccount.findMany({
        where: {
          employeeId: { in: employeeIds },
          isAssigned: true,
        },
        select: {
          id: true,
          employeeId: true,
          slotIndex: true,
          role: true,
          status: true,
          canUseHandover: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      // ── Bug 3 修复：移除冗余 storeId 过滤 ──
      // Employee.linkedStaffId 为 @unique，每个 Employee 最多关联一条 Staff。
      // 叠加 storeId 在员工跨门店调动时会导致 Staff 信息缺失。
      this.prisma.staff.findMany({
        where: {
          employeeProfile: { is: { id: { in: employeeIds } } },
        },
        select: {
          id: true,
          phone: true,
          email: true,
          loginAccount: true,
          userId: true,
          updatedAt: true,
          employeeProfile: {
            select: {
              id: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const subAccountByEmployeeId = new Map(
      subAccounts
        .filter((subAccount) => subAccount.employeeId !== null)
        .map((subAccount) => [subAccount.employeeId as number, subAccount]),
    );
    const employeeMap = new Map(
      employees.map((employee) => [employee.id, employee]),
    );
    const linkedStaffByEmployeeId = new Map<
      number,
      (typeof linkedStaffs)[number]
    >();

    for (const linkedStaff of linkedStaffs) {
      const linkedEmployeeId = linkedStaff.employeeProfile?.id;
      if (
        linkedEmployeeId &&
        employeeMap.has(linkedEmployeeId) &&
        !linkedStaffByEmployeeId.has(linkedEmployeeId)
      ) {
        linkedStaffByEmployeeId.set(linkedEmployeeId, linkedStaff);
      }
    }

    return new Map(
      employees.flatMap((employee) => {
        const subAccount = subAccountByEmployeeId.get(employee.id);
        if (!subAccount) {
          return [];
        }

        const linkedStaff = linkedStaffByEmployeeId.get(employee.id);
        const customLoginAccount = linkedStaff?.loginAccount ?? null;
        // 登录账号展示：有自定义账号时只展示自定义账号，否则展示手机号
        const displayLoginAccount = customLoginAccount ?? employee.phone;

        return [
          [
            employee.id,
            {
              id: String(subAccount.id),
              role: toStoreSubAccountRoleCode(subAccount.role),
              roleLabel: STORE_SUB_ACCOUNT_ROLE_LABELS[subAccount.role],
              status: this.mapSubAccountStatus(subAccount.status),
              slotIndex: subAccount.slotIndex,
              loginAccount: displayLoginAccount,
              canHandover: subAccount.canUseHandover,
              hasPassword: linkedStaff?.userId != null,
              createdAt: subAccount.createdAt.getTime(),
              updatedAt: subAccount.updatedAt.getTime(),
            },
          ] as const,
        ];
      }),
    );
  }

  private mapSubAccountStatus(
    status: StoreSubAccountStatus,
  ): 'active' | 'inactive' | 'disabled' {
    switch (status) {
      case StoreSubAccountStatus.active:
        return 'active';
      case StoreSubAccountStatus.inactive:
        return 'inactive';
      case StoreSubAccountStatus.disabled:
        return 'disabled';
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
