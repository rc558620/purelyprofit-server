/**
 * 提成服务配置 CRUD：按门店维护「服务 → 默认提成 + 服务人员覆盖表」。
 * 同名校验、服务人员存在性校验、软删除均在此收敛。
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, type Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { normalizeTechnicianLabel } from '../../stores/dto/store-response.dto';
import { CommissionCoreService } from './commission-core.service';
import { toCommissionServiceResponse } from './commission.mapper';
import type {
  CommissionOpenOptionsResponseDto,
  CommissionServiceResponseDto,
  UpsertCommissionServiceDto,
} from './dto/commission-service.dto';
import type { CommissionOverrideRecord } from './commission.types';

@Injectable()
export class CommissionServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly coreService: CommissionCoreService,
  ) {}

  /** 查询当前门店提成服务配置列表（排序与前端一致：启用在前、sortOrder 升序）。 */
  async list(user: AuthenticatedUser): Promise<CommissionServiceResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'commission:view',
      '无权访问该门店的提成配置',
    );

    const records = await this.coreService.listConfigRecords(
      this.prisma,
      storeId,
    );
    return records.map(toCommissionServiceResponse);
  }

  /**
   * 开台选项（空间管理开台弹窗）：已启用服务项 + 在职服务人员。
   *
   * 不复用提成配置列表与员工档案接口的原因：
   * - GET /commission-services 由 commission:view 把关（与提成明细/导出同源），收银员无此权限；
   * - GET /employees 由 staff:view 把关，且响应带手机号、薪资等档案字段，不应下发给收银员。
   * 因此本接口以 space:view 放行，仅返回开台选择所需的最小字段；
   * 提成金额仍由后端在结账时按配置重算，前端拿到的快照仅用于展示。
   */
  async listOpenOptions(
    user: AuthenticatedUser,
  ): Promise<CommissionOpenOptionsResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'space:view',
      '无权访问该门店的开台选项',
    );

    const [records, store, employees] = await Promise.all([
      this.coreService.listConfigRecords(this.prisma, storeId),
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: { technicianLabel: true },
      }),
      this.prisma.employee.findMany({
        where: { storeId, deletedAt: null, status: EmployeeStatus.active },
        select: { id: true, name: true, position: true, isTechnician: true },
        orderBy: [{ id: 'asc' }],
      }),
    ]);

    // 服务人员判定与前端 filterTechnicianEmployees 同口径：
    // 优先 isTechnician 标记，历史未回填时回落到职位名匹配门店称呼。
    const technicianLabel = normalizeTechnicianLabel(store?.technicianLabel);

    return {
      services: records
        .filter((record) => record.enabled)
        .map((record) => ({ id: record.id, name: record.name })),
      technicians: employees
        .filter(
          (employee) =>
            employee.isTechnician ||
            employee.position.includes(technicianLabel),
        )
        .map((employee) => ({
          id: employee.id,
          name: employee.name,
          position: employee.position,
        })),
    };
  }

  /** 新增服务配置：同名（未软删）返回 409，服务人员覆盖表须全部存在。 */
  async create(
    user: AuthenticatedUser,
    dto: UpsertCommissionServiceDto,
  ): Promise<CommissionServiceResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'commission:manage',
      '无权配置该门店的提成',
    );

    const overrides = this.toOverrideRecords(dto.overrides ?? []);
    await this.assertNameAvailable(storeId, dto.name.trim(), undefined);
    await this.coreService.resolveTechnicianNames(
      this.prisma,
      storeId,
      overrides.map((override) => override.technicianId),
    );

    const created = await this.prisma.commissionService.create({
      data: {
        storeId,
        name: dto.name.trim(),
        defaultCommission: Money.fromInputYuan(
          dto.defaultCommission,
        ).toDbCents(),
        enabled: dto.enabled,
        sortOrder: dto.sortOrder,
        overrides: this.toPrismaOverrides(overrides),
      },
    });

    return toCommissionServiceResponse(
      this.coreService.toConfigRecord(created),
    );
  }

  /** 更新服务配置：overrides 全量替换，仍需校验服务人员存在与同名校验。 */
  async update(
    user: AuthenticatedUser,
    serviceId: number,
    dto: UpsertCommissionServiceDto,
  ): Promise<CommissionServiceResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'commission:manage',
      '无权配置该门店的提成',
    );

    const existing = await this.prisma.commissionService.findFirst({
      where: { id: serviceId, storeId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('提成服务配置不存在');
    }

    const overrides = this.toOverrideRecords(dto.overrides ?? []);
    await this.assertNameAvailable(storeId, dto.name.trim(), serviceId);
    await this.coreService.resolveTechnicianNames(
      this.prisma,
      storeId,
      overrides.map((override) => override.technicianId),
    );

    const updated = await this.prisma.commissionService.update({
      where: { id: existing.id },
      data: {
        name: dto.name.trim(),
        defaultCommission: Money.fromInputYuan(
          dto.defaultCommission,
        ).toDbCents(),
        enabled: dto.enabled,
        sortOrder: dto.sortOrder,
        overrides: this.toPrismaOverrides(overrides),
      },
    });

    return toCommissionServiceResponse(
      this.coreService.toConfigRecord(updated),
    );
  }

  /** 删除服务配置：软删除（保留历史提成记录引用，同名可复用）。 */
  async remove(user: AuthenticatedUser, serviceId: number): Promise<void> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'commission:manage',
      '无权配置该门店的提成',
    );

    const existing = await this.prisma.commissionService.findFirst({
      where: { id: serviceId, storeId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('提成服务配置不存在');
    }

    await this.prisma.commissionService.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date(),
        enabled: false,
      },
    });
  }

  /** 校验服务名在门店内唯一（忽略已软删记录），冲突时返回 409。 */
  private async assertNameAvailable(
    storeId: number,
    name: string,
    excludeServiceId: number | undefined,
  ): Promise<void> {
    const conflict = await this.prisma.commissionService.findFirst({
      where: {
        storeId,
        name,
        deletedAt: null,
        ...(excludeServiceId !== undefined
          ? { id: { not: excludeServiceId } }
          : {}),
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException('服务名称已存在');
    }
  }

  /** 前端元金额 → 覆盖记录（分）。 */
  private toOverrideRecords(
    overrides: Array<{ technicianId: number; commission: number }>,
  ): CommissionOverrideRecord[] {
    return overrides.map((override) => ({
      technicianId: override.technicianId,
      commission: Money.fromInputYuan(override.commission).toDbCents(),
    }));
  }

  /** 覆盖记录 → Prisma JSON 输入（空数组也写入 []，保证全量替换语义）。 */
  private toPrismaOverrides(
    overrides: CommissionOverrideRecord[],
  ): Prisma.InputJsonValue {
    return overrides as unknown as Prisma.InputJsonValue;
  }
}
