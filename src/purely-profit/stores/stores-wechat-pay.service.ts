import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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

/**
 * 全量 APIv3Key 列表的缓存时长。
 *
 * 每次支付回调都要拿到所有门店的密钥去尝试解密，若不缓存会退化为
 * 「一次回调 = 一次全表查询 + 全表解密」。缓存后由
 * {@link StoresWechatPayService.updateWechatPayConfig} 主动失效，
 * 且解密全失败时会强制刷新重试（见 ClubWechatCallbackDecryptorService），
 * 因此多实例部署下最坏只多一次重试，不会长期停留在旧密钥上。
 */
const API_V3_KEY_CACHE_TTL_MS = 30_000;

/** 密文格式 `iv:authTag:ciphertext` 的分段数。 */
const ENCRYPTED_PAYLOAD_PART_COUNT = 3;

/** base64（标准/URL 安全均可）片段判定，用于区分真密文与历史明文。 */
const BASE64_SEGMENT_PATTERN = /^[A-Za-z0-9+/\-_]+={0,2}$/;

@Injectable()
export class StoresWechatPayService {
  private readonly logger = new Logger(StoresWechatPayService.name);

  /** listAllApiV3Keys 的短时缓存。 */
  private apiV3KeyCache: { keys: string[]; expiresAt: number } | null = null;

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
      // 尚未配置过微信收款，返回空状态而非 404，
      // 前端据此展示空表单，仅在显式查询已有配置时才视为异常。
      return { configured: false };
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

    // 查找现有配置，仅用于判断「首次配置」的必填校验强度
    const existing = await this.findWechatPayConfigByStoreId(store.id);

    if (!existing) {
      // 首次配置必须一次给全 mchId / mchName / apiV3Key，否则无法完成收款
      const missingFields: string[] = [];
      if (!dto.mchId) missingFields.push('mchId');
      if (!dto.mchName) missingFields.push('mchName');
      if (!dto.apiV3Key) missingFields.push('apiV3Key');

      if (missingFields.length > 0) {
        throw new BadRequestException(
          `门店微信收款配置不存在，初次配置需提供：${missingFields.join('、')}`,
        );
      }
    }

    // upsert 命中已有记录时应用的增量；未传的字段保持原值
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

    /*
     * 用 upsert 替代「先查再 create/update」：
     * storeId 上有唯一约束，并发写入（多端同时保存、请求重试）会同时查到 null
     * 并各自执行 create，后到者触发 P2002 而抛出未处理的 500。upsert 由数据库
     * 保证原子性，天然免疫该竞态。
     */
    const record = await this.prisma.storeWechatPayConfig.upsert({
      where: { storeId: store.id },
      create: {
        storeId: store.id,
        mchId: dto.mchId ?? '',
        mchName: dto.mchName ?? '',
        apiV3KeyEnc: dto.apiV3Key
          ? this.encryptionService.encrypt(dto.apiV3Key)
          : '',
        configuredAt: configuredAt ?? new Date(),
      },
      update: updateData,
      select: {
        mchId: true,
        mchName: true,
        apiV3KeyEnc: true,
        configuredAt: true,
      },
    });

    // 密钥可能已变更，立即失效回调解密用的密钥缓存
    this.invalidateApiV3KeyCache();

    this.logger.log(
      `门店 ${store.id} 微信收款配置已更新（操作人 userId=${user.id}，` +
        `${existing ? '更新' : '新建'}，含密钥变更=${dto.apiV3Key !== undefined}）`,
    );

    return this.toWechatPayConfigResponse(record);
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
   * 解密后的回调报文里有 mchid 字段，可据此定位到门店的密钥。
   *
   * ⚠️ mchId 在库上没有唯一约束（同一微信商户号可以被多个门店共用），
   * 因此这里**不再**用 `orderBy configuredAt desc` 任取一条：那会让后配置的门店
   * 顶掉先配置者的密钥，等同于可以「抢占」他人商户号使其收款回调解密失败。
   * 出现多门店共用时判定为歧义并返回 null，由调用方回退到
   * {@link StoresWechatPayService.listAllApiV3Keys} 逐个尝试。
   */
  async getApiV3KeyByMchId(mchId: string): Promise<string | null> {
    const records = await this.prisma.storeWechatPayConfig.findMany({
      where: { mchId },
      select: { apiV3KeyEnc: true, storeId: true },
    });

    if (records.length === 0) return null;

    if (records.length > 1) {
      const storeIds = records.map((record) => record.storeId);
      this.logger.warn(
        `微信商户号 ${mchId} 被多个门店共用（storeId=${storeIds.join(',')}），` +
          '无法唯一确定 APIv3Key，返回 null 由调用方回退逐个尝试',
      );
      return null;
    }

    return this.safeDecrypt(records[0].apiV3KeyEnc, records[0].storeId);
  }

  /**
   * 返回系统中所有已配置微信收款的门店的 APIv3Key 列表（去重）。
   * 用于回调解密时逐个尝试，不需要提前知道本次回调属于哪个商户。
   *
   * 结果带 {@link API_V3_KEY_CACHE_TTL_MS} 短时缓存：回调报文在解密前拿不到 mchid，
   * 只能遍历候选密钥，若不缓存则每次回调都要全表扫描并解密全量记录。
   *
   * @param forceRefresh 传 true 时强制回源，用于缓存疑似过期（密钥刚轮换）的重试。
   */
  async listAllApiV3Keys(forceRefresh = false): Promise<string[]> {
    if (
      !forceRefresh &&
      this.apiV3KeyCache &&
      Date.now() < this.apiV3KeyCache.expiresAt
    ) {
      return this.apiV3KeyCache.keys;
    }

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

    this.apiV3KeyCache = {
      keys,
      expiresAt: Date.now() + API_V3_KEY_CACHE_TTL_MS,
    };
    return keys;
  }

  /** 主动失效 APIv3Key 缓存（配置变更后调用）。 */
  private invalidateApiV3KeyCache(): void {
    this.apiV3KeyCache = null;
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
   * 安全解密 apiV3KeyEnc。
   *
   * 仅在确认是「历史明文数据」时才回退返回原始值：明文不含密文分隔符，
   * WechatPayEncryptionService.decrypt 会抛 "Invalid encrypted format"。
   *
   * ⚠️ 若确认是密文却解密失败（主密钥未配置 / 轮换 / 配置错误），必须返回 null
   * 而不是把 `iv:authTag:ciphertext` 当作 APIv3Key 返回 —— 那样会让支付回调
   * 静默解密失败，且日志上表现为「密钥不匹配」，极难定位到真正的主密钥故障。
   */
  private safeDecrypt(apiV3KeyEnc: string, storeId: number): string | null {
    if (!apiV3KeyEnc) return null;
    try {
      return this.encryptionService.decrypt(apiV3KeyEnc);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);

      if (this.looksLikeEncryptedPayload(apiV3KeyEnc)) {
        this.logger.error(
          `门店 ${storeId} 的 apiV3KeyEnc 解密失败，疑似 WECHAT_PAY_KEY_ENCRYPTION_SECRET 配置错误：${reason}`,
        );
        return null;
      }

      // 兼容迁移期间明文存储的历史数据
      this.logger.warn(
        `门店 ${storeId} 的 apiV3KeyEnc 非密文格式，按历史明文数据直接返回原始值`,
      );
      return apiV3KeyEnc;
    }
  }

  /** 判定是否为 `iv:authTag:ciphertext` 形态的密文。 */
  private looksLikeEncryptedPayload(value: string): boolean {
    const parts = value.split(':');
    return (
      parts.length === ENCRYPTED_PAYLOAD_PART_COUNT &&
      parts.every(
        (part) => part.length > 0 && BASE64_SEGMENT_PATTERN.test(part),
      )
    );
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
