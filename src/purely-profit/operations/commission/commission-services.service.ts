/**
 * 提成服务配置 CRUD：按门店维护「服务 → 默认提成 + 技师覆盖表」。
 * 同名校验、技师存在性校验、软删除均在此收敛。
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommissionCoreService } from './commission-core.service';
import { toCommissionServiceResponse } from './commission.mapper';
import type {
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

  /** 新增服务配置：同名（未软删）返回 409，技师覆盖表须全部存在。 */
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

  /** 更新服务配置：overrides 全量替换，仍需校验技师存在与同名校验。 */
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
