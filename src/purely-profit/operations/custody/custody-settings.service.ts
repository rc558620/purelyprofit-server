// 客存门店配置服务：读取与更新门店客存口径（属配置信息，任何写操作都会失效统计缓存）
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../shared/audit-log.service';
import { CustodyCodeService } from '../../../shared/custody/custody-code.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { mapCustodySettings } from './custody.mapper';
import { CustodyReadService } from './custody-read.service';
import type { UpdateCustodySettingsDto } from './dto/custody-request.dto';
import type { CustodySettingsDto } from './dto/custody-response.dto';
import type { CustodyStockModeValue } from './custody.domain';

@Injectable()
export class CustodySettingsService {
  private readonly logger = new Logger(CustodySettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly custodyReadService: CustodyReadService,
    private readonly custodyCodeService: CustodyCodeService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** 读取配置（无记录时返回默认口径） */
  async getSettings(user: AuthenticatedUser): Promise<CustodySettingsDto> {
    const storeId = await this.resolveManageStoreId(user);
    return this.custodyReadService.getSettings(storeId);
  }

  /** 更新配置：一期跨店通取恒为 false，不接受前端覆盖 */
  async updateSettings(
    user: AuthenticatedUser,
    dto: UpdateCustodySettingsDto,
  ): Promise<CustodySettingsDto> {
    const storeId = await this.resolveManageStoreId(user);
    const before = await this.custodyReadService.getSettings(storeId);

    const data: Prisma.CustodySettingUncheckedUpdateInput = {
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.stockMode
        ? { stockMode: dto.stockMode as CustodyStockModeValue }
        : {}),
      ...(dto.defaultExpireDays !== undefined
        ? { defaultExpireDays: dto.defaultExpireDays }
        : {}),
      ...(dto.requireMemberConfirm !== undefined
        ? { requireMemberConfirm: dto.requireMemberConfirm }
        : {}),
      ...(dto.pickupPhoneVerifyEnabled !== undefined
        ? { pickupPhoneVerifyEnabled: dto.pickupPhoneVerifyEnabled }
        : {}),
      // 显式传 null 才能关掉阈值，因此这里判 undefined 而非真值
      ...(dto.pickupPhoneVerifyThreshold !== undefined
        ? { pickupPhoneVerifyThreshold: dto.pickupPhoneVerifyThreshold }
        : {}),
      ...(dto.unitOptions ? { unitOptions: dto.unitOptions } : {}),
    };

    const record = await this.prisma.custodySetting.upsert({
      where: { storeId },
      create: {
        storeId,
        enabled: dto.enabled ?? before.enabled,
        stockMode:
          (dto.stockMode as CustodyStockModeValue | undefined) ??
          before.stockMode,
        defaultExpireDays: dto.defaultExpireDays ?? before.defaultExpireDays,
        requireMemberConfirm:
          dto.requireMemberConfirm ?? before.requireMemberConfirm,
        pickupPhoneVerifyEnabled:
          dto.pickupPhoneVerifyEnabled ?? before.pickupPhoneVerifyEnabled,
        pickupPhoneVerifyThreshold:
          dto.pickupPhoneVerifyThreshold ?? before.pickupPhoneVerifyThreshold,
        unitOptions: dto.unitOptions ?? before.unitOptions,
        // 一期不开放跨店通取：始终保持 false
        allowCrossStorePickup: false,
      },
      update: { ...data, allowCrossStorePickup: false },
    });

    await this.custodyCodeService.invalidateSummaryCache(storeId);
    this.logger.log(`[custody] 配置更新 storeId=${storeId}`);
    this.auditLogService.record({
      userId: user.id,
      action: 'custody.settings.update',
      resourceType: 'custody_setting',
      metadata: { storeId, before, after: mapCustodySettings(record) },
    });

    return mapCustodySettings(record);
  }

  private resolveManageStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'custody:manage',
      '无权管理当前门店的客存配置',
    );
  }
}
