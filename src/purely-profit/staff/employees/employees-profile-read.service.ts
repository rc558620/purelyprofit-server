import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
} from './employees.domain';
import { toEmployeeResponse } from './employees.mapper';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  queryEmployeesOverviewMetrics,
  queryEmployeesPage,
} from './employees.query';
import {
  buildPaginationMeta,
  getCurrentMonthString,
  getStartOfCurrentMonth,
  resolvePagination,
} from './employees.utils';

@Injectable()
export class EmployeesProfileReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly configService: ConfigService,
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

    return {
      items: result.items.map(toEmployeeResponse),
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
      currentMonth: getCurrentMonthString(),
    });

    return buildEmployeesOverviewResponse(metrics);
  }

  async getDetail(
    user: AuthenticatedUser,
    employeeId: number,
  ): Promise<EmployeeResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:view',
      );
    return toEmployeeResponse(employee);
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
