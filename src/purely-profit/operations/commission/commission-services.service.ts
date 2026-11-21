/**
 * 提成服务配置 CRUD：按门店维护「服务 → 默认提成 + 服务人员覆盖表」。
 * 同名校验、服务人员存在性校验、软删除均在此收敛。
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
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
  CreateCommissionServiceDto,
  UpdateCommissionServiceDto,
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

    const [services, store, employees] = await Promise.all([
      this.prisma.commissionService.findMany({
        where: { storeId, enabled: true, deletedAt: null },
        select: { id: true, name: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      }),
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
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
      })),
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
    dto: CreateCommissionServiceDto,
  ): Promise<CommissionServiceResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'commission:manage',
      '无权配置该门店的提成',
    );

    const overrides = this.toOverrideRecords(dto.overrides ?? []);
    await this.assertNameAvailable(storeId, dto.name, undefined);
    await this.coreService.resolveTechnicianNames(
      this.prisma,
      storeId,
      overrides.map((override) => override.technicianId),
    );

    try {
      const created = await this.prisma.commissionService.create({
        data: {
          storeId,
          name: dto.name,
          defaultCommission: Money.fromInputYuan(
            dto.defaultCommission,
          ).toDbCents(),
          enabled: dto.enabled ?? true,
          sortOrder: dto.sortOrder ?? 1,
          overrides: this.toPrismaOverrides(overrides),
        },
      });

      return toCommissionServiceResponse(
        this.coreService.toConfigRecord(created),
      );
    } catch (error) {
      // 并发创建同名服务时由唯一索引兜底，仍需转成 409 而不是 500。
      throw this.toNameConflictIfNeeded(error);
    }
  }

  /**
   * 更新服务配置：只更新显式传入的字段。
   * - 未传 `overrides` 时保持原覆盖表，避免「只切启停」把别人刚改的金额覆盖回去；
   * - 传入 `expectedUpdatedAt` 时做版本校验，旧页面提交返回 412。
   */
  async update(
    user: AuthenticatedUser,
    serviceId: number,
    dto: UpdateCommissionServiceDto,
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

    if (
      dto.expectedUpdatedAt !== undefined &&
      existing.updatedAt.getTime() !== dto.expectedUpdatedAt
    ) {
      throw new PreconditionFailedException(
        '提成配置已被其他成员修改，请刷新后重试',
      );
    }

    const data: Prisma.CommissionServiceUpdateManyMutationInput = {};
    if (dto.name !== undefined) {
      if (dto.name !== existing.name) {
        await this.assertNameAvailable(storeId, dto.name, serviceId);
      }
      data.name = dto.name;
    }
    if (dto.defaultCommission !== undefined) {
      data.defaultCommission = Money.fromInputYuan(
        dto.defaultCommission,
      ).toDbCents();
    }
    if (dto.enabled !== undefined) {
      data.enabled = dto.enabled;
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }
    if (dto.overrides !== undefined) {
      const overrides = this.toOverrideRecords(dto.overrides);
      await this.coreService.resolveTechnicianNames(
        this.prisma,
        storeId,
        overrides.map((override) => override.technicianId),
      );
      data.overrides = this.toPrismaOverrides(overrides);
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('至少需要提交一个待更新字段');
    }

    try {
      // 用 updateMany 限定未软删记录，避免「读取后被执行删除」的窗口里更新脏数据。
      const result = await this.prisma.commissionService.updateMany({
        where: { id: serviceId, storeId, deletedAt: null },
        data,
      });
      if (result.count !== 1) {
        throw new NotFoundException('提成服务配置不存在');
      }
    } catch (error) {
      throw this.toNameConflictIfNeeded(error);
    }

    const updated = await this.prisma.commissionService.findFirstOrThrow({
      where: { id: serviceId, storeId },
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

    const result = await this.prisma.commissionService.updateMany({
      where: { id: serviceId, storeId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        enabled: false,
      },
    });
    if (result.count !== 1) {
      throw new NotFoundException('提成服务配置不存在');
    }
  }

  /** 唯一索引冲突（并发同名）转成 409，其他错误原样抛出。 */
  private toNameConflictIfNeeded(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException('服务名称已存在');
    }
    return error instanceof Error ? error : new Error(String(error));
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
