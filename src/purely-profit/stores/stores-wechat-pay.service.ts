import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { UpdateWechatPayConfigDto } from './dto/wechat-pay-config.dto';
import type { WechatPayConfigResponseDto } from './dto/wechat-pay-config.dto';
import { StoresReadService } from './stores-read.service';

type WechatPayConfigRecord = {
  wechatMchId: string | null;
  wechatMchName: string | null;
  wechatApiV3Key: string | null;
  wechatConfiguredAt: Date | null;
};

@Injectable()
export class StoresWechatPayService {
  private readonly logger = new Logger(StoresWechatPayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storesReadService: StoresReadService,
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
    const store = await this.storesReadService.getBoundStoreRecordOrThrow(user);

    const hasNewConfig = dto.mchId !== undefined || dto.apiV3Key !== undefined;
    const configuredAt = hasNewConfig ? new Date() : undefined;

    try {
      const updated = await this.prisma.store.update({
        where: { id: store.id },
        data: {
          ...(dto.mchId !== undefined ? { wechatMchId: dto.mchId } : {}),
          ...(dto.mchName !== undefined ? { wechatMchName: dto.mchName } : {}),
          ...(dto.apiV3Key !== undefined
            ? { wechatApiV3Key: dto.apiV3Key }
            : {}),
          ...(configuredAt ? { wechatConfiguredAt: configuredAt } : {}),
        },
        select: {
          wechatMchId: true,
          wechatMchName: true,
          wechatApiV3Key: true,
          wechatConfiguredAt: true,
        },
      });

      return this.toWechatPayConfigResponse(updated);
    } catch (error: unknown) {
      this.rethrowIfWechatPaySchemaMissing(
        error,
        `更新门店 ${store.id} 的微信收款配置`,
      );
      throw error;
    }
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
    return this.toWechatPayConfigPayload(record);
  }

  /**
   * 根据微信商户号（mchId）反查该门店的 APIv3Key，用于微信回调解密。
   *
   * 微信回调报文中包含 mchid 字段，通过此方法找到对应门店的密钥进行解密。
   * 若同一 mchId 被多个门店使用（不推荐），取最新配置的一条。
   */
  async getApiV3KeyByMchId(mchId: string): Promise<string | null> {
    try {
      const record = await this.prisma.store.findFirst({
        where: { wechatMchId: mchId },
        select: { wechatApiV3Key: true },
        orderBy: { wechatConfiguredAt: 'desc' },
      });

      return record?.wechatApiV3Key ?? null;
    } catch (error: unknown) {
      if (!this.isMissingWechatPaySchemaError(error)) {
        throw error;
      }

      this.logMissingWechatPaySchema(
        `按商户号 ${mchId} 反查 APIv3Key 时检测到微信收款字段尚未迁移，返回空配置`,
      );
      return null;
    }
  }

  /**
   * 返回系统中所有已配置微信收款的门店的 APIv3Key 列表（去重）。
   * 用于回调解密时逐个尝试，不需要提前知道本次回调属于哪个商户。
   */
  async listAllApiV3Keys(): Promise<string[]> {
    try {
      const records = await this.prisma.store.findMany({
        where: {
          wechatApiV3Key: { not: null },
          wechatMchId: { not: null },
        },
        select: { wechatApiV3Key: true },
        orderBy: { wechatConfiguredAt: 'desc' },
      });

      const seen = new Set<string>();
      const keys: string[] = [];
      for (const record of records) {
        if (record.wechatApiV3Key && !seen.has(record.wechatApiV3Key)) {
          seen.add(record.wechatApiV3Key);
          keys.push(record.wechatApiV3Key);
        }
      }
      return keys;
    } catch (error: unknown) {
      if (!this.isMissingWechatPaySchemaError(error)) {
        throw error;
      }

      this.logMissingWechatPaySchema(
        '枚举门店 APIv3Key 时检测到微信收款字段尚未迁移，返回空列表',
      );
      return [];
    }
  }

  private async findWechatPayConfigByStoreId(
    storeId: number,
  ): Promise<WechatPayConfigRecord | null> {
    try {
      return await this.prisma.store.findUnique({
        where: { id: storeId },
        select: {
          wechatMchId: true,
          wechatMchName: true,
          wechatApiV3Key: true,
          wechatConfiguredAt: true,
        },
      });
    } catch (error: unknown) {
      if (!this.isMissingWechatPaySchemaError(error)) {
        throw error;
      }

      this.logMissingWechatPaySchema(
        `读取门店 ${storeId} 的微信收款配置时检测到微信收款字段尚未迁移，按未配置降级返回`,
      );
      return this.buildEmptyWechatPayConfigRecord();
    }
  }

  private toWechatPayConfigPayload(record: WechatPayConfigRecord | null): {
    mchId: string | null;
    mchName: string | null;
    apiV3Key: string | null;
    configuredAt: Date | null;
  } {
    return {
      mchId: record?.wechatMchId ?? null,
      mchName: record?.wechatMchName ?? null,
      apiV3Key: record?.wechatApiV3Key ?? null,
      configuredAt: record?.wechatConfiguredAt ?? null,
    };
  }

  private buildEmptyWechatPayConfigRecord(): WechatPayConfigRecord {
    return {
      wechatMchId: null,
      wechatMchName: null,
      wechatApiV3Key: null,
      wechatConfiguredAt: null,
    };
  }

  private rethrowIfWechatPaySchemaMissing(
    error: unknown,
    action: string,
  ): asserts error is never {
    if (!this.isMissingWechatPaySchemaError(error)) {
      return;
    }

    this.logMissingWechatPaySchema(`${action}时检测到微信收款字段尚未迁移`);
    throw new ServiceUnavailableException(
      '当前环境尚未完成门店微信收款配置字段迁移，请先执行数据库迁移后再试',
    );
  }

  private isMissingWechatPaySchemaError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

    if (
      !message.includes('wechat_mch_id') &&
      !message.includes('wechat_mch_name') &&
      !message.includes('wechat_api_v3_key') &&
      !message.includes('wechat_configured_at') &&
      !message.includes('wechatmchid') &&
      !message.includes('wechatmchname') &&
      !message.includes('wechatapiv3key')
    ) {
      return false;
    }

    return (
      message.includes('p2022') ||
      message.includes('does not exist') ||
      message.includes("doesn't exist") ||
      message.includes('unknown column') ||
      message.includes('no such column') ||
      message.includes('unknown field') ||
      message.includes('invalid column') ||
      message.includes('column not found') ||
      message.includes('column does not exist')
    );
  }

  private logMissingWechatPaySchema(message: string): void {
    this.logger.warn(
      `${message}；如需启用微信收款，请先执行 migration 20260613120000_add_store_wechat_pay_config`,
    );
  }

  private toWechatPayConfigResponse(
    record: WechatPayConfigRecord,
  ): WechatPayConfigResponseDto {
    const configured = !!(record.wechatMchId && record.wechatApiV3Key);

    return {
      configured,
      ...(record.wechatMchId ? { mchId: record.wechatMchId } : {}),
      ...(record.wechatMchName ? { mchName: record.wechatMchName } : {}),
      ...(record.wechatConfiguredAt
        ? { configuredAt: record.wechatConfiguredAt.toISOString() }
        : {}),
    };
  }
}
