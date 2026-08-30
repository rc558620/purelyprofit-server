/**
 * 提成核心服务：提成解析、技师校验、分配快照规范化与提成记录生成。
 * 提成金额的唯一权威来源是后端配置（默认提成 + 技师覆盖表），
 * 开台/结账均以后端重算为准，不信任前端传入金额。
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { formatShanghaiYearMonth } from '../../../shared/shanghai-time.utils';
import { parseOverridesJson } from './commission.utils';
import type {
  CommissionAssignmentInput,
  CommissionAssignmentRecord,
  CommissionServiceConfigRecord,
  CreateCommissionRecordsInput,
} from './commission.types';

/** 提成配置/技师/记录读写客户端（普通客户端或事务客户端）。 */
type CommissionDbClient = Prisma.TransactionClient | PrismaService;

/** 提成解析映射：serviceId → { 默认提成(分), 技师覆盖表, 服务名 }。 */
export interface CommissionServicesMap {
  defaultByServiceId: Map<number, number>;
  overridesByServiceId: Map<number, Map<number, number>>;
  nameByServiceId: Map<number, string>;
}

/** 提成记录状态集合（结算口径 settled+included）。 */
export const SETTLED_COMMISSION_STATUSES = ['settled', 'included'] as const;

@Injectable()
export class CommissionCoreService {
  private readonly logger = new Logger(CommissionCoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 查询门店提成服务配置（含软删），并组装解析映射。 */
  async buildServicesMap(
    db: CommissionDbClient,
    storeId: number,
  ): Promise<CommissionServicesMap> {
    const services = await db.commissionService.findMany({
      where: { storeId },
      orderBy: [{ enabled: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });

    const defaultByServiceId = new Map<number, number>();
    const overridesByServiceId = new Map<number, Map<number, number>>();
    const nameByServiceId = new Map<number, string>();
    for (const service of services) {
      defaultByServiceId.set(service.id, service.defaultCommission);
      nameByServiceId.set(service.id, service.name);
      const overrideMap = new Map<number, number>();
      for (const override of parseOverridesJson(service.overrides)) {
        overrideMap.set(override.technicianId, override.commission);
      }
      overridesByServiceId.set(service.id, overrideMap);
    }

    return { defaultByServiceId, overridesByServiceId, nameByServiceId };
  }

  /**
   * 解析单个服务对指定技师的提成（分）：技师有覆盖用覆盖，否则回落默认提成。
   */
  resolveServiceCommission(
    servicesMap: CommissionServicesMap,
    serviceId: number,
    technicianId: number,
  ): number {
    const overrides = servicesMap.overridesByServiceId.get(serviceId);
    const override = overrides?.get(technicianId);
    if (override !== undefined) {
      return override;
    }
    return servicesMap.defaultByServiceId.get(serviceId) ?? 0;
  }

  /** 按技师结算一行多服务提成（分）：各服务覆盖/默认之和。 */
  resolveCommission(
    servicesMap: CommissionServicesMap,
    technicianId: number,
    serviceIds: number[],
  ): Money {
    return Money.fromDbCents(
      serviceIds.reduce(
        (sum, serviceId) =>
          sum +
          this.resolveServiceCommission(servicesMap, serviceId, technicianId),
        0,
      ),
    );
  }

  /**
   * 校验技师均属于该门店（含离职），返回技师 ID → 姓名映射。
   * 任一技师不存在时抛出参数异常，防止伪造技师 ID 写入提成记录。
   */
  async resolveTechnicianNames(
    db: CommissionDbClient,
    storeId: number,
    technicianIds: number[],
  ): Promise<Map<number, string>> {
    const uniqueIds = Array.from(new Set(technicianIds));
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const employees = await db.employee.findMany({
      where: { id: { in: uniqueIds }, storeId },
      select: { id: true, name: true },
    });

    const nameById = new Map<number, string>();
    employees.forEach((employee) => nameById.set(employee.id, employee.name));

    const missingIds = uniqueIds.filter((id) => !nameById.has(id));
    if (missingIds.length > 0) {
      this.logger.warn(
        `提成技师校验失败 storeId=${storeId} missingTechnicianIds=${missingIds.join(',')}`,
      );
      throw new BadRequestException('选择的技师不存在或不属于当前门店');
    }

    return nameById;
  }

  /**
   * 将开台提交的提成分配收敛为落库快照（金额为分）：
   * - 技师必须属于当前门店，姓名快照以员工表为准
   * - 服务名快照以提成服务配置为准，缺失时保留前端快照
   * - commission 缺省时按配置解析（后端权威）；传入值仅作会话快照展示，
   *   结账生成提成记录时仍以后端重算为准
   */
  normalizeAssignments(
    servicesMap: CommissionServicesMap,
    nameById: Map<number, string>,
    inputs: CommissionAssignmentInput[],
  ): CommissionAssignmentRecord[] {
    return inputs.map((input) => ({
      technicianId: input.technicianId,
      technicianName: nameById.get(input.technicianId) ?? '',
      serviceIds: input.serviceIds,
      serviceNames: input.serviceIds.map(
        (serviceId) =>
          servicesMap.nameByServiceId.get(serviceId) ??
          (Array.isArray(input.serviceNames)
            ? String(
                input.serviceNames[input.serviceIds.indexOf(serviceId)] ?? '',
              )
            : ''),
      ),
      commission:
        input.commission !== undefined
          ? Money.fromInputYuan(input.commission).toDbCents()
          : this.resolveCommission(
              servicesMap,
              input.technicianId,
              input.serviceIds,
            ).toDbCents(),
    }));
  }

  /** 结账时按配置重算每行提成金额（分），返回带最终金额的分配快照。 */
  recomputeAssignments(
    servicesMap: CommissionServicesMap,
    assignments: CommissionAssignmentRecord[],
  ): CommissionAssignmentRecord[] {
    return assignments.map((assignment) => ({
      ...assignment,
      commission: this.resolveCommission(
        servicesMap,
        assignment.technicianId,
        assignment.serviceIds,
      ).toDbCents(),
      // 每服务拆分金额与总额同一时刻按同一配置计算，保证明细合计 = 总额
      serviceCommissions: assignment.serviceIds.map((serviceId) =>
        this.resolveServiceCommission(
          servicesMap,
          serviceId,
          assignment.technicianId,
        ),
      ),
    }));
  }

  /** 批量生成提成记录（status=settled，归属月份按结账时间上海时区）。 */
  async createSettledRecords(
    db: CommissionDbClient,
    input: CreateCommissionRecordsInput,
  ): Promise<void> {
    if (input.assignments.length === 0) {
      return;
    }

    const month =
      input.month ?? formatShanghaiYearMonth(input.settledAt.getTime());
    await db.commissionRecord.createMany({
      data: input.assignments.map((assignment) => ({
        storeId: input.storeId,
        sessionId: input.sessionId,
        spaceName: input.spaceName,
        technicianId: assignment.technicianId,
        technicianName: assignment.technicianName,
        serviceIds: assignment.serviceIds,
        serviceNames: assignment.serviceNames,
        serviceCommissions: assignment.serviceCommissions ?? [],
        commission: assignment.commission,
        status: 'settled',
        settledAt: input.settledAt,
        month,
      })),
    });
  }

  /** 工资确认结算时，将员工当月已结账提成标记为「已计入工资」。 */
  async markSettledRecordsIncluded(
    db: CommissionDbClient,
    storeId: number,
    employeeId: number,
    month: string,
  ): Promise<number> {
    const result = await db.commissionRecord.updateMany({
      where: {
        storeId,
        technicianId: employeeId,
        month,
        status: 'settled',
      },
      data: { status: 'included' },
    });
    return result.count;
  }

  /** 提成配置行（业务视图，金额为分），供服务 CRUD 复用。 */
  async listConfigRecords(
    db: CommissionDbClient,
    storeId: number,
  ): Promise<CommissionServiceConfigRecord[]> {
    const services = await db.commissionService.findMany({
      where: { storeId },
      orderBy: [{ enabled: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });

    return services
      .filter((service) => service.deletedAt === null)
      .map((service) => this.toConfigRecord(service));
  }

  /** Prisma 服务配置行 → 业务视图记录（overrides JSON 收敛为覆盖表）。 */
  toConfigRecord(service: {
    id: number;
    storeId: number;
    name: string;
    defaultCommission: number;
    enabled: boolean;
    sortOrder: number;
    overrides: Prisma.JsonValue;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): CommissionServiceConfigRecord {
    return {
      id: service.id,
      storeId: service.storeId,
      name: service.name,
      defaultCommission: service.defaultCommission,
      enabled: service.enabled,
      sortOrder: service.sortOrder,
      overrides: parseOverridesJson(service.overrides),
      deletedAt: service.deletedAt,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    };
  }
}
