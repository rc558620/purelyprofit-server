/**
 * 提成记录查询：明细分页 + 汇总 + 员工月度提成（工资弹窗回填）+ CSV 导出。
 * 汇总与金额均由后端计算，前端仅展示。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, CommissionRecordStatus } from '@prisma/client';
import type { ServerResponse } from 'node:http';
import { Money } from '../../../shared/money.utils';
import { formatShanghaiDateTime } from '../../../shared/shanghai-time.utils';
import { safeStreamCsvExport } from '../../../shared/stream-export.utils';
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

// ─── CSV 导出辅助 ─────────────────────────────────────────────────

/** 提成明细 CSV 表头（列结构与打印报表一致）。 */
const COMMISSION_EXPORT_HEADERS = [
  '技师',
  '空间',
  '服务（每服务提成）',
  '提成金额(元)',
  '状态',
  '结账时间',
];

/** 提成状态中文标签（与前端 COMMISSION_STATUS_META 保持一致）。 */
const COMMISSION_STATUS_LABELS: Record<CommissionRecordStatusValue, string> = {
  pending: '待结账',
  settled: '已结账',
  included: '已计入工资',
  cancelled: '已作废',
};

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
    const where = this.buildWhere(storeId, query);

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

  /**
   * 流式导出提成明细 CSV，O(1) 内存占用。
   * 导出当前筛选条件下全量记录（不随分页截断），列结构对齐打印报表；
   * 文件内容由后端生成，前端仅触发下载。
   */
  async streamExportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: ListCommissionRecordsQueryDto,
  ): Promise<void> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'commission:view',
      '无权访问该门店的提成明细',
    );

    const where = this.buildWhere(storeId, query);

    // 先完成数据加载再写 CSV 头，保证加载阶段异常可被 NestJS 以 JSON 响应拦截
    const [rows, aggregates] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: [{ settledAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.commissionRecord.groupBy({
        by: ['status'],
        where,
        _sum: { commission: true },
        _count: { _all: true },
      }),
    ]);

    const summary = this.buildSummary(
      aggregates as unknown as CommissionStatusAggregate[],
    );
    const prefixRows = this.buildExportPrefixRows(summary, query.month);
    const dataRows = rows.map((row) =>
      this.buildExportCsvRow(this.toRecordRow(row)),
    );

    safeStreamCsvExport(
      reply,
      `提成明细-${query.month ?? '全部'}.csv`,
      COMMISSION_EXPORT_HEADERS,
      dataRows,
      prefixRows,
    );
  }

  /** 筛选条件 → Prisma where（列表与导出共用同一口径）。 */
  private buildWhere(
    storeId: number,
    query: ListCommissionRecordsQueryDto,
  ): Prisma.CommissionRecordWhereInput {
    return {
      storeId,
      ...(query.month ? { month: query.month } : {}),
      ...(query.technicianId ? { technicianId: query.technicianId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
  }

  /** 汇总 + 月份 → CSV 前缀行（报表头 / 归属月份 / 统计汇总）。 */
  private buildExportPrefixRows(
    summary: CommissionRecordsSummaryDto,
    month: string | undefined,
  ): unknown[][] {
    const now = Date.now();
    return [
      ['提成明细报表', '', '', `导出时间: ${formatShanghaiDateTime(now)}`],
      [],
      ['归属月份', month ? `\t${month}` : '全部月份'],
      [],
      ['【统计汇总】'],
      [
        '已结账提成(元)',
        '待结账提成(元)',
        '已作废提成(元)',
        '总笔数',
        '已结账笔数',
        '待结账笔数',
        '已作废笔数',
      ],
      [
        summary.settledTotal,
        summary.pendingTotal,
        summary.cancelledTotal,
        summary.totalCount,
        summary.settledCount,
        summary.pendingCount,
        summary.cancelledCount,
      ],
      [],
      ['【提成明细】'],
    ];
  }

  /** 业务视图行 → CSV 数据行（金额分→元两位小数，\t 前缀防 Excel 类型转换）。 */
  private buildExportCsvRow(row: CommissionRecordRow): unknown[] {
    const serviceText = row.serviceNames
      .map((name, index) => {
        const serviceCommission = row.serviceCommissions[index];
        const serviceName = name || '未命名服务';
        return serviceCommission === undefined
          ? serviceName
          : `${serviceName}（¥${Money.fromDbCents(serviceCommission).toFixedOutputYuan()}）`;
      })
      .join('；');

    return [
      row.technicianName || '-',
      row.spaceName || '-',
      serviceText,
      `\t${Money.fromDbCents(row.commission).toFixedOutputYuan()}`,
      COMMISSION_STATUS_LABELS[row.status] ?? row.status,
      row.settledAt ? `\t${formatShanghaiDateTime(row.settledAt.getTime())}` : '-',
    ];
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
