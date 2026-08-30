/**
 * 提成记录查询：明细分页 + 汇总 + 员工月度提成（工资弹窗回填）。
 * 汇总与金额均由后端计算，前端仅展示。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, CommissionRecordStatus } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  COMMISSION_RECORDS_DEFAULT_PAGE_SIZE,
  COMMISSION_SETTLED_STATUS_VALUES,
} from './commission.constants';
import { CommissionCoreService } from './commission-core.service';
import { toCommissionRecordResponse } from './commission.mapper';
import type {
  CommissionRecordStatusValue,
  CommissionRecordRow,
} from './commission.types';
import type {
  CommissionSummaryByEmployeeQueryDto,
  CommissionSummaryByEmployeeResponseDto,
  CommissionRecordsSummaryDto,
  ListCommissionRecordsQueryDto,
  ListCommissionRecordsResponseDto,
} from './dto/commission-record.dto';

/** 汇总聚合行（Prisma groupBy 结果）。 */
interface CommissionStatusAggregate {
  status: CommissionRecordStatus;
  _sum: { commission: number | null };
  _count: { _all: number };
}

@Injectable()
export class CommissionRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly coreService: CommissionCoreService,
  ) {}

  /** 明细分页查询（排序 settledAt DESC），汇总按当前筛选条件计算。 */
  async list(
    user: AuthenticatedUser,
    query: ListCommissionRecordsQueryDto,
  ): Promise<ListCommissionRecordsResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'commission:view',
      '无权访问该门店的提成明细',
    );

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? COMMISSION_RECORDS_DEFAULT_PAGE_SIZE;
    const where: Prisma.CommissionRecordWhereInput = {
      storeId,
      ...(query.month ? { month: query.month } : {}),
      ...(query.technicianId ? { technicianId: query.technicianId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total, aggregates] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: [{ settledAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.commissionRecord.count({ where }),
      this.prisma.commissionRecord.groupBy({
        by: ['status'],
        where,
        _sum: { commission: true },
        _count: { _all: true },
      }),
    ]);

    return {
      items: rows.map((row) =>
        toCommissionRecordResponse(this.toRecordRow(row)),
      ),
      summary: this.buildSummary(
        aggregates as unknown as CommissionStatusAggregate[],
      ),
      total,
      hasMore: page * pageSize < total,
    };
  }

  /** 员工某月已结账提成合计（settled+included，工资弹窗自动回填）。 */
  async summaryByEmployee(
    user: AuthenticatedUser,
    query: CommissionSummaryByEmployeeQueryDto,
  ): Promise<CommissionSummaryByEmployeeResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'commission:view',
      '无权访问该门店的提成明细',
    );

    const employee = await this.prisma.employee.findFirst({
      where: { id: query.employeeId, storeId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    const aggregated = await this.prisma.commissionRecord.aggregate({
      where: {
        storeId,
        technicianId: query.employeeId,
        month: query.month,
        status: { in: [...COMMISSION_SETTLED_STATUS_VALUES] },
      },
      _sum: { commission: true },
    });

    return {
      commission: Money.fromDbCents(
        aggregated._sum.commission ?? 0,
      ).toOutputYuan(),
    };
  }

  /** Prisma 行 → 业务视图行（serviceIds/serviceNames/serviceCommissions JSON 收敛）。 */
  private toRecordRow(row: {
    id: number;
    storeId: number;
    sessionId: number;
    spaceName: string;
    technicianId: number;
    technicianName: string;
    serviceIds: Prisma.JsonValue;
    serviceNames: Prisma.JsonValue;
    serviceCommissions: Prisma.JsonValue;
    commission: number;
    status: CommissionRecordStatus;
    settledAt: Date;
    month: string;
    createdAt: Date;
  }): CommissionRecordRow {
    return {
      id: row.id,
      storeId: row.storeId,
      sessionId: row.sessionId,
      spaceName: row.spaceName,
      technicianId: row.technicianId,
      technicianName: row.technicianName,
      serviceIds: Array.isArray(row.serviceIds)
        ? row.serviceIds
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
        : [],
      serviceNames: Array.isArray(row.serviceNames)
        ? row.serviceNames.flatMap((name) => {
            if (typeof name === 'string') {
              return [name];
            }
            if (typeof name === 'number') {
              return [String(name)];
            }
            return [];
          })
        : [],
      // 历史记录无拆分快照时回退为空数组（前端按服务名列表展示，不显示金额）
      serviceCommissions: Array.isArray(row.serviceCommissions)
        ? row.serviceCommissions.flatMap((commission) => {
            if (typeof commission === 'number' && Number.isFinite(commission)) {
              return [commission];
            }
            return [];
          })
        : [],
      commission: row.commission,
      status: row.status as CommissionRecordStatusValue,
      settledAt: row.settledAt,
      month: row.month,
      createdAt: row.createdAt,
    };
  }

  /** 由状态分组聚合构建汇总（金额分→元）。 */
  private buildSummary(
    aggregates: CommissionStatusAggregate[],
  ): CommissionRecordsSummaryDto {
    const sumByStatus = new Map<CommissionRecordStatus, number>();
    const countByStatus = new Map<CommissionRecordStatus, number>();
    aggregates.forEach((aggregate) => {
      sumByStatus.set(aggregate.status, aggregate._sum.commission ?? 0);
      countByStatus.set(aggregate.status, aggregate._count._all);
    });

    const settledSum =
      (sumByStatus.get('settled') ?? 0) + (sumByStatus.get('included') ?? 0);
    const settledCount =
      (countByStatus.get('settled') ?? 0) +
      (countByStatus.get('included') ?? 0);

    return {
      settledTotal: Money.fromDbCents(settledSum).toOutputYuan(),
      pendingTotal: Money.fromDbCents(
        sumByStatus.get('pending') ?? 0,
      ).toOutputYuan(),
      cancelledTotal: Money.fromDbCents(
        sumByStatus.get('cancelled') ?? 0,
      ).toOutputYuan(),
      totalCount:
        (countByStatus.get('settled') ?? 0) +
        (countByStatus.get('included') ?? 0) +
        (countByStatus.get('pending') ?? 0) +
        (countByStatus.get('cancelled') ?? 0),
      settledCount,
      pendingCount: countByStatus.get('pending') ?? 0,
      cancelledCount: countByStatus.get('cancelled') ?? 0,
    };
  }
}
