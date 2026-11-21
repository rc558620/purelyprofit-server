/**
 * 提成核心服务：提成解析、服务人员校验、分配快照规范化与提成记录生成。
 * 提成金额的唯一权威来源是后端配置（默认提成 + 服务人员覆盖表），
 * 开台/结账均以后端重算为准，不信任前端传入金额。
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { formatShanghaiYearMonth } from '../../../shared/shanghai-time.utils';
import { parseOverridesJson } from './commission.utils';
import {
  DEFAULT_TECHNICIAN_LABEL,
  normalizeTechnicianLabel,
} from '../../stores/dto/store-response.dto';
import type {
  CommissionAssignmentInput,
  CommissionAssignmentRecord,
  CommissionServiceConfigRecord,
  CreateCommissionRecordsInput,
} from './commission.types';

/** 提成配置/服务人员/记录读写客户端（普通客户端或事务客户端）。 */
type CommissionDbClient = Prisma.TransactionClient | PrismaService;

/** 提成解析映射：serviceId → { 默认提成(分), 服务人员覆盖表, 服务名 }。 */
export interface CommissionServicesMap {
  defaultByServiceId: Map<number, number>;
  overridesByServiceId: Map<number, Map<number, number>>;
  nameByServiceId: Map<number, string>;
  /** 当前可用于新开单的服务（启用且未软删），用于开台提交时的准入校验。 */
  openableServiceIds: Set<number>;
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
    const openableServiceIds = new Set<number>();
    for (const service of services) {
      defaultByServiceId.set(service.id, service.defaultCommission);
      nameByServiceId.set(service.id, service.name);
      if (service.enabled && service.deletedAt === null) {
        openableServiceIds.add(service.id);
      }
      const overrideMap = new Map<number, number>();
      for (const override of parseOverridesJson(service.overrides)) {
        overrideMap.set(override.technicianId, override.commission);
      }
      overridesByServiceId.set(service.id, overrideMap);
    }

    return {
      defaultByServiceId,
      overridesByServiceId,
      nameByServiceId,
      openableServiceIds,
    };
  }

  /**
   * 解析单个服务对指定服务人员的提成（分）：服务人员有覆盖用覆盖，否则回落默认提成。
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

  /** 按服务人员结算一行多服务提成（分）：各服务覆盖/默认之和。 */
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
   * 校验服务人员均属于该门店（含离职），返回服务人员 ID → 姓名映射。
   * 任一服务人员不存在时抛出参数异常，防止伪造服务人员 ID 写入提成记录。
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
        `提成服务人员校验失败 storeId=${storeId} missingTechnicianIds=${missingIds.join(',')}`,
      );
      throw new BadRequestException(
        `选择的${await this.resolveStoreTechnicianLabel(db, storeId)}不存在或不属于当前门店`,
      );
    }

    return nameById;
  }

  /**
   * 读取门店服务人员称呼（仅在校验失败时才回源，成功路径不增加查询）。
   * 读取失败时回落默认称呼，不因文案查询异常改变校验结论。
   */
  private async resolveStoreTechnicianLabel(
    db: CommissionDbClient,
    storeId: number,
  ): Promise<string> {
    try {
      const store = await db.store.findUnique({
        where: { id: storeId },
        select: { technicianLabel: true },
      });
      return normalizeTechnicianLabel(store?.technicianLabel);
    } catch (error: unknown) {
      this.logger.warn(
        `读取门店服务人员称呼失败，回落默认称呼: ${error instanceof Error ? error.message : String(error)}`,
      );
      return DEFAULT_TECHNICIAN_LABEL;
    }
  }

  /**
   * 将开台提交的提成分配收敛为落库快照（金额为分）：
   * - 服务人员必须属于当前门店，姓名快照以员工表为准
   * - 服务必须是本店启用且未软删的配置，服务名快照以配置为准
   * - commission 缺省时按配置解析（后端权威）；传入值仅作会话快照展示，
   *   结账生成提成记录时仍以后端重算为准
   * - 同一服务人员 + 同一服务只允许出现一次，避免同一笔服务被重复计提
   */
  normalizeAssignments(
    servicesMap: CommissionServicesMap,
    nameById: Map<number, string>,
    inputs: CommissionAssignmentInput[],
  ): CommissionAssignmentRecord[] {
    this.assertServicesOpenable(servicesMap, inputs);
    this.assertNoDuplicateAssignments(servicesMap, inputs);

    return inputs.map((input) => ({
      technicianId: input.technicianId,
      technicianName: nameById.get(input.technicianId) ?? '',
      serviceIds: input.serviceIds,
      serviceNames: input.serviceIds.map(
        (serviceId) => servicesMap.nameByServiceId.get(serviceId) ?? '',
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

  /**
   * 新开单只接受本店启用且未软删的服务。
   * 停用/删除后旧页面的缓存选项仍可能提交上来，这里直接拒绝，避免脏单继续计提。
   */
  private assertServicesOpenable(
    servicesMap: CommissionServicesMap,
    inputs: CommissionAssignmentInput[],
  ): void {
    const unavailable = new Map<number, string>();
    inputs.forEach((input) => {
      input.serviceIds.forEach((serviceId) => {
        if (servicesMap.openableServiceIds.has(serviceId)) {
          return;
        }
        if (!unavailable.has(serviceId)) {
          unavailable.set(
            serviceId,
            servicesMap.nameByServiceId.get(serviceId) ?? String(serviceId),
          );
        }
      });
    });

    if (unavailable.size === 0) {
      return;
    }

    const names = Array.from(unavailable.values())
      .map((name) => `「${name}」`)
      .join('、');
    throw new BadRequestException(
      `服务${names}已停用或已删除，请刷新后重新选择`,
    );
  }

  /**
   * 校验提成分配不存在重复计提：同一「服务人员 + 服务」组合只能出现在一处。
   * 同一行内重复选择或跨行重复选择都会导致同一笔服务被重复计薪，直接拦截。
   */
  private assertNoDuplicateAssignments(
    servicesMap: CommissionServicesMap,
    inputs: CommissionAssignmentInput[],
  ): void {
    const firstRowByKey = new Map<string, number>();

    inputs.forEach((input, rowIndex) => {
      input.serviceIds.forEach((serviceId, serviceIndex) => {
        const key = `${input.technicianId}:${serviceId}`;
        const firstRowIndex = firstRowByKey.get(key);
        if (firstRowIndex === undefined) {
          firstRowByKey.set(key, rowIndex);
          return;
        }

        const nameFromConfig = servicesMap.nameByServiceId.get(serviceId);
        const nameFromInput = Array.isArray(input.serviceNames)
          ? String(input.serviceNames[serviceIndex] ?? '')
          : '';
        const serviceName =
          nameFromConfig ?? (nameFromInput || String(serviceId));
        const rowHint =
          firstRowIndex === rowIndex
            ? `第 ${rowIndex + 1} 行内`
            : `第 ${firstRowIndex + 1} 行与第 ${rowIndex + 1} 行`;
        throw new BadRequestException(
          `同一服务人员与同一服务不能重复计提（${rowHint}重复选择了「${serviceName}」）`,
        );
      });
    });
  }

  /**
   * 结账时按配置重算每行提成金额（分），返回带最终金额的分配快照。
   *
   * 配置行被物理清理（迁移、跨门店脏数据）时无法重算，保留开台快照金额并告警，
   * 不能回落到 0——否则会在结账时静默抹掉员工提成。
   */
  recomputeAssignments(
    servicesMap: CommissionServicesMap,
    assignments: CommissionAssignmentRecord[],
  ): CommissionAssignmentRecord[] {
    return assignments.map((assignment) => {
      const missingServiceIds = assignment.serviceIds.filter(
        (serviceId) => !servicesMap.defaultByServiceId.has(serviceId),
      );
      if (missingServiceIds.length > 0) {
        this.logger.warn(
          `结账重算缺少服务配置，保留开台快照 technicianId=${assignment.technicianId} missingServiceIds=${missingServiceIds.join(',')} snapshotCommission=${assignment.commission}`,
        );
        return assignment;
      }

      return {
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
      };
    });
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

  /**
   * 工资确认结算时，将员工当月已结账提成标记为「已计入工资」。
   *
   * 传入 commissionLimitCents（工资单提成金额，单位分）时，按结账时间顺序累计，
   * 只标记真正被工资单金额覆盖的记录：避免工资单只计入 ¥100、明细却把 ¥120
   * 全部标成「已计入工资」造成账实不符。超出部分保留 settled，待补差流程处理。
   */
  async markSettledRecordsIncluded(
    db: CommissionDbClient,
    storeId: number,
    employeeId: number,
    month: string,
    commissionLimitCents?: number,
  ): Promise<number> {
    const records = await db.commissionRecord.findMany({
      where: {
        storeId,
        technicianId: employeeId,
        month,
        status: 'settled',
      },
      orderBy: [{ settledAt: 'asc' }, { id: 'asc' }],
      select: { id: true, commission: true },
    });
    if (records.length === 0) {
      return 0;
    }

    let includedIds: number[];
    if (commissionLimitCents === undefined) {
      includedIds = records.map((record) => record.id);
    } else {
      let accumulatedCents = 0;
      includedIds = [];
      for (const record of records) {
        if (accumulatedCents + record.commission > commissionLimitCents) {
          break;
        }
        accumulatedCents += record.commission;
        includedIds.push(record.id);
      }
    }

    if (includedIds.length === 0) {
      return 0;
    }

    const result = await db.commissionRecord.updateMany({
      where: { id: { in: includedIds }, status: 'settled' },
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
