import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { UpdateWechatPayConfigDto } from './dto/wechat-pay-config.dto';
import type { WechatPayConfigResponseDto } from './dto/wechat-pay-config.dto';
import { StoresReadService } from './stores-read.service';
import { WechatPayEncryptionService } from './wechat-pay-encryption.service';

type WechatPayConfigRecord = {
  mchId: string;
  mchName: string;
  apiV3KeyEnc: string;
  configuredAt: Date;
};

@Injectable()
export class StoresWechatPayService {
  private readonly logger = new Logger(StoresWechatPayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storesReadService: StoresReadService,
    private readonly encryptionService: WechatPayEncryptionService,
  ) {}

  async getWechatPayConfig(
    user: AuthenticatedUser,
  ): Promise<WechatPayConfigResponseDto> {
    const store = await this.storesReadService.getBoundStoreRecordOrThrow(user);
    const record = await this.findWechatPayConfigByStoreId(store.id);

    if (!record) {
      throw new NotFoundException('门店微信收款配置未找到');
    }

    return this.toWechatPayConfigResponse(record);
  }

  async updateWechatPayConfig(
    user: AuthenticatedUser,
    dto: UpdateWechatPayConfigDto,
  ): Promise<WechatPayConfigResponseDto> {
    if (!this.encryptionService.isAvailable) {
      throw new BadRequestException(
        '微信支付加密服务未配置（WECHAT_PAY_KEY_ENCRYPTION_SECRET），无法保存收款配置',
      );
    }

    const store = await this.storesReadService.getBoundStoreRecordOrThrow(user);

    const hasNewConfig = dto.mchId !== undefined || dto.apiV3Key !== undefined;
    const configuredAt = hasNewConfig ? new Date() : undefined;

    // 查找现有配置
    const existing = await this.findWechatPayConfigByStoreId(store.id);

    if (!existing) {
      // 新建配置，要求 mchId 和 apiV3Key 都提供
      if (!dto.mchId || !dto.apiV3Key || !dto.mchName) {
        throw new NotFoundException(
          '门店微信收款配置不存在，初次配置需提供 mchId、mchName 和 apiV3Key',
        );
      }

      const apiV3KeyEnc = this.encryptionService.encrypt(dto.apiV3Key);
      const created = await this.prisma.storeWechatPayConfig.create({
        data: {
          storeId: store.id,
          mchId: dto.mchId,
          mchName: dto.mchName,
          apiV3KeyEnc,
          configuredAt: configuredAt!,
        },
        select: {
          mchId: true,
          mchName: true,
          apiV3KeyEnc: true,
          configuredAt: true,
        },
      });
      return this.toWechatPayConfigResponse(created);
    }

    // 更新现有配置
    const updateData: {
      mchId?: string;
      mchName?: string;
      apiV3KeyEnc?: string;
      configuredAt?: Date;
    } = {};

    if (dto.mchId !== undefined) updateData.mchId = dto.mchId;
    if (dto.mchName !== undefined) updateData.mchName = dto.mchName;
    if (dto.apiV3Key !== undefined) {
      updateData.apiV3KeyEnc = this.encryptionService.encrypt(dto.apiV3Key);
    }
    if (configuredAt) updateData.configuredAt = configuredAt;

    const updated = await this.prisma.storeWechatPayConfig.update({
      where: { storeId: store.id },
      data: updateData,
      select: {
        mchId: true,
        mchName: true,
        apiV3KeyEnc: true,
        configuredAt: true,
      },
    });

    return this.toWechatPayConfigResponse(updated);
  }

  /**
   * 供内部模块（如 purely-club 下单）读取门店微信收款配置。
   * ⚠️ 含敏感字段（apiV3Key），仅供内部模块使用，不得暴露给前端。
   */
  async getWechatPayConfigForStore(storeId: number): Promise<{
    mchId: string | null;
    mchName: string | null;
    apiV3Key: string | null;
    configuredAt: Date | null;
  }> {
    const record = await this.findWechatPayConfigByStoreId(storeId);
    if (!record) {
      return { mchId: null, mchName: null, apiV3Key: null, configuredAt: null };
    }

    return {
      mchId: record.mchId,
      mchName: record.mchName,
      apiV3Key: this.safeDecrypt(record.apiV3KeyEnc, storeId),
      configuredAt: record.configuredAt,
    };
  }

  /**
   * 根据微信商户号（mchId）反查该门店的 APIv3Key，用于微信回调解密。
   *
   * 微信回调报文中包含 mchid 字段，通过此方法找到对应门店的密钥进行解密。
   * 若同一 mchId 被多个门店使用（不推荐），取最新配置的一条。
   */
  async getApiV3KeyByMchId(mchId: string): Promise<string | null> {
    const record = await this.prisma.storeWechatPayConfig.findFirst({
      where: { mchId },
      select: { apiV3KeyEnc: true, storeId: true },
      orderBy: { configuredAt: 'desc' },
    });

    if (!record) return null;
    return this.safeDecrypt(record.apiV3KeyEnc, record.storeId);
  }

  /**
   * 返回系统中所有已配置微信收款的门店的 APIv3Key 列表（去重）。
   * 用于回调解密时逐个尝试，不需要提前知道本次回调属于哪个商户。
   */
  async listAllApiV3Keys(): Promise<string[]> {
    const records = await this.prisma.storeWechatPayConfig.findMany({
      select: { apiV3KeyEnc: true, storeId: true },
      orderBy: { configuredAt: 'desc' },
    });

    const seen = new Set<string>();
    const keys: string[] = [];
    for (const record of records) {
      const plainKey = this.safeDecrypt(record.apiV3KeyEnc, record.storeId);
      if (plainKey && !seen.has(plainKey)) {
        seen.add(plainKey);
        keys.push(plainKey);
      }
    }
    return keys;
  }

  private async findWechatPayConfigByStoreId(
    storeId: number,
  ): Promise<WechatPayConfigRecord | null> {
    return this.prisma.storeWechatPayConfig.findUnique({
      where: { storeId },
      select: {
        mchId: true,
        mchName: true,
        apiV3KeyEnc: true,
        configuredAt: true,
      },
    });
  }

  /**
   * 安全解密 apiV3KeyEnc：若解密失败（历史明文数据迁移期间），直接返回原始值。
   * 历史明文存储的情况下，原始值不包含 ':' 分隔符，
   * WechatPayEncryptionService.decrypt 会抛出 "Invalid encrypted format" 错误。
   */
  private safeDecrypt(apiV3KeyEnc: string, storeId: number): string | null {
    if (!apiV3KeyEnc) return null;
    try {
      return this.encryptionService.decrypt(apiV3KeyEnc);
    } catch {
      // 兼容迁移期间明文存储的历史数据
      this.logger.warn(
        `门店 ${storeId} 的 apiV3KeyEnc 解密失败，可能是历史明文数据，直接返回原始值`,
      );
      return apiV3KeyEnc;
    }
  }

  private toWechatPayConfigResponse(
    record: WechatPayConfigRecord,
  ): WechatPayConfigResponseDto {
    const configured = !!(record.mchId && record.apiV3KeyEnc);

    return {
      configured,
      ...(record.mchId ? { mchId: record.mchId } : {}),
      ...(record.mchName ? { mchName: record.mchName } : {}),
      ...(record.configuredAt
        ? { configuredAt: record.configuredAt.toISOString() }
        : {}),
    };
  }
}
