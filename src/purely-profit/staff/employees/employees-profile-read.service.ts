import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoreSubAccountStatus } from '@prisma/client';
import {
  STORE_SUB_ACCOUNT_ROLE_LABELS,
  toStoreSubAccountRoleCode,
} from '../../access-control/access-control.constants';
import {
  buildSubAccountLoginDisplay,
  extractCustomLoginAccount,
} from '../../auth/auth.utils';
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

    const subAccountMap = await this.buildEmployeeSubAccountMap(
      storeId,
      result.items.map((employee) => ({
        id: employee.id,
        phone: employee.phone,
      })),
    );

    return {
      items: result.items.map((employee) =>
        toEmployeeResponse(employee, subAccountMap.get(employee.id)),
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
    const subAccountMap = await this.buildEmployeeSubAccountMap(
      employee.storeId,
      [{ id: employee.id, phone: employee.phone }],
    );
    const detailCapabilities =
      this.employeesAccessService.buildEmployeeDetailCapabilities(
        user,
        employee.storeId,
      );

    return toEmployeeResponse(
      employee,
      subAccountMap.get(employee.id),
      detailCapabilities,
    );
  }

  private async buildEmployeeSubAccountMap(
    storeId: number,
    employees: Array<{ id: number; phone: string }>,
  ): Promise<Map<number, EmployeeResponseDto['subAccount']>> {
    if (employees.length === 0) {
      return new Map();
    }

    const employeeIds = employees.map((employee) => employee.id);
    const employeePhones = employees.map((employee) => employee.phone);
    const [subAccounts, linkedStaffs] = await Promise.all([
      this.prisma.storeSubAccount.findMany({
        where: {
          storeId,
          employeeId: { in: employeeIds },
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
      this.prisma.staff.findMany({
        where: {
          storeId,
          OR: [
            { employeeProfile: { is: { id: { in: employeeIds } } } },
            { phone: { in: employeePhones } },
          ],
        },
        select: {
          id: true,
          phone: true,
          email: true,
          updatedAt: true,
          employeeProfile: {
            select: {
              id: true,
            },
          },
          user: {
            select: {
              password: true,
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

    for (const employee of employees) {
      if (linkedStaffByEmployeeId.has(employee.id)) {
        continue;
      }
      const matchedStaff = linkedStaffs.find(
        (linkedStaff) => linkedStaff.phone === employee.phone,
      );
      if (matchedStaff) {
        linkedStaffByEmployeeId.set(employee.id, matchedStaff);
      }
    }

    return new Map(
      employees.flatMap((employee) => {
        const subAccount = subAccountByEmployeeId.get(employee.id);
        if (!subAccount) {
          return [];
        }

        const linkedStaff = linkedStaffByEmployeeId.get(employee.id);
        const loginAccountDisplay = buildSubAccountLoginDisplay(
          employee.phone,
          linkedStaff?.email ?? null,
        );
        const customLoginAccount = linkedStaff?.email
          ? extractCustomLoginAccount(linkedStaff.email)
          : null;

        return [
          [
            employee.id,
            {
              id: String(subAccount.id),
              role: toStoreSubAccountRoleCode(subAccount.role),
              roleLabel: STORE_SUB_ACCOUNT_ROLE_LABELS[subAccount.role],
              status:
                subAccount.status === StoreSubAccountStatus.inactive
                  ? 'inactive'
                  : subAccount.status === StoreSubAccountStatus.disabled
                    ? 'disabled'
                    : 'active',
              slotIndex: subAccount.slotIndex,
              ...(customLoginAccount || loginAccountDisplay
                ? { loginAccount: loginAccountDisplay }
                : {}),
              canHandover: subAccount.canUseHandover,
              hasPassword: Boolean(linkedStaff?.user?.password),
              createdAt: subAccount.createdAt.getTime(),
              updatedAt: subAccount.updatedAt.getTime(),
            },
          ] as const,
        ];
      }),
    );
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
