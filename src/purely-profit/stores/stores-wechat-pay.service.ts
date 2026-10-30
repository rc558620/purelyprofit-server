import type { StoreWechatPayBindStatus } from '@prisma/client';
import type { WechatPayConfigRecord } from './stores-wechat-pay.types';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoresWechatPayBindService } from './stores-wechat-pay-bind.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { UpdateWechatPayConfigDto } from './dto/wechat-pay-config.dto';
import type { WechatPayConfigResponseDto } from './dto/wechat-pay-config.dto';
import { decryptApiV3KeySafely } from './stores-wechat-pay-key-codec';
import { StoresReadService } from './stores-read.service';
import { WechatPayEncryptionService } from './wechat-pay-encryption.service';

/**
 * 全量 APIv3Key 列表的缓存时长。
 *
 * 仅 **partner.enabled=false 的旧直连链路**使用：那时回调由门店自己的密钥加密，
 * 解密前拿不到 mchid，只能把所有门店密钥都拿去试，不缓存会退化成
 * 「一次回调 = 一次全表查询 + 全表解密」。缓存后由
 * {@link StoresWechatPayService.updateWechatPayConfig} 主动失效，
 * 且解密全失败时会强制刷新重试（见 ClubWechatCallbackDecryptorService），
 * 因此多实例部署下最坏只多一次重试，不会长期停留在旧密钥上。
 */
const API_V3_KEY_CACHE_TTL_MS = 30_000;

@Injectable()
export class StoresWechatPayService {
  private readonly logger = new Logger(StoresWechatPayService.name);

  /** listAllApiV3Keys 的短时缓存。 */
  private apiV3KeyCache: { keys: string[]; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storesReadService: StoresReadService,
    private readonly encryptionService: WechatPayEncryptionService,
    private readonly configService: ConfigService,
    private readonly bindService: StoresWechatPayBindService,
  ) {}

  /** 服务商模式是否开启：决定商家需要提供哪些凭据、以及「已配置」如何判定 */
  private isPartnerMode(): boolean {
    return this.configService.get<boolean>('wechat.partner.enabled') === true;
  }

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
    /*
     * 加密服务只在「本次请求确实要存密钥」时才必需。
     *
     * ⚠️ 不能写成「非服务商模式才检查」：DTO 的 apiV3Key 仍保留（灰度回滚窗口内需要），
     * 任何携带它的请求都会走 encrypt()，而 encrypt 抛的是**普通 Error**而非
     * HttpException，Nest 会直接返回 500。
     * 服务商模式下运维按文档不会配 WECHAT_PAY_KEY_ENCRYPTION_SECRET，
     * 那种写法会让「旧端/脚本仍带 apiV3Key」的保存请求变成 500，
     * 商家看到的是「保存失败」而不是「请先配置加密密钥」。
     *
     * 因此条件拆成两段：
     *   1. 本次要写密钥（dto.apiV3Key 有值）→ 无论哪种模式都必须能用，否则 400；
     *   2. 直连模式（!isPartnerMode）→ 维持改造前的严格口径，回调解密依赖该密钥。
     * 服务商模式下「只改子商户号/名称、不带密钥」的请求不再被这个变量卡住。
     */
    if (
      !this.encryptionService.isAvailable &&
      (dto.apiV3Key !== undefined || !this.isPartnerMode())
    ) {
      throw new BadRequestException(
        '微信支付加密服务未配置（WECHAT_PAY_KEY_ENCRYPTION_SECRET），无法保存收款配置密钥',
      );
    }

    const store = await this.storesReadService.getBoundStoreRecordOrThrow(user);

    const hasNewConfig = dto.mchId !== undefined || dto.apiV3Key !== undefined;
    const configuredAt = hasNewConfig ? new Date() : undefined;

    // 查找现有配置，仅用于判断「首次配置」的必填校验强度
    const existing = await this.findWechatPayConfigByStoreId(store.id);

    if (!existing) {
      const missingFields = this.collectMissingRequiredFields(dto);
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
      subMchId?: string;
      bindStatus?: StoreWechatPayBindStatus;
      bindCheckedAt?: Date | null;
      bindFailReason?: string | null;
      configuredAt?: Date;
    } = {};

    if (dto.mchId !== undefined) {
      updateData.mchId = dto.mchId;
      // 服务商模式下「商户号」即子商户号：两个字段同步写，保证灰度回滚与读取口径一致
      updateData.subMchId = dto.mchId;
      // 商户号一变，之前的绑定校验结论就作废，必须重新校验才能收款
      updateData.bindStatus = 'pending';
      updateData.bindCheckedAt = null;
      updateData.bindFailReason = null;
    }
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
        subMchId: dto.mchId ?? null,
        bindStatus: 'pending',
        configuredAt: configuredAt ?? new Date(),
      },
      update: updateData,
      select: {
        mchId: true,
        mchName: true,
        apiV3KeyEnc: true,
        subMchId: true,
        bindStatus: true,
        bindCheckedAt: true,
        bindFailReason: true,
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
   *
   * ⚠️ 含敏感字段（apiV3Key），仅供内部模块使用，不得暴露给前端。
   *
   * 服务商改造后这里是**门店收款身份的唯一来源**：支付链路（下单 / 查单 / 关单 /
   * 退款）一律经 {@link ClubWechatPayIdentityService} 读它，禁止各自去库里取值，
   * 否则「子商户号回落旧字段」这类灰度口径会在四个调用点之间漂移。
   */
  async getWechatPayConfigForStore(storeId: number): Promise<{
    mchId: string | null;
    mchName: string | null;
    apiV3Key: string | null;
    subMchId: string | null;
    bindStatus: string | null;
    configuredAt: Date | null;
  }> {
    const record = await this.findWechatPayConfigByStoreId(storeId);
    if (!record) {
      return {
        mchId: null,
        mchName: null,
        apiV3Key: null,
        subMchId: null,
        bindStatus: null,
        configuredAt: null,
      };
    }

    return {
      mchId: record.mchId,
      mchName: record.mchName,
      apiV3Key: decryptApiV3KeySafely({
        encryptionService: this.encryptionService,
        apiV3KeyEnc: record.apiV3KeyEnc,
        storeId,
        logger: this.logger,
      }),
      subMchId: record.subMchId,
      bindStatus: record.bindStatus,
      configuredAt: record.configuredAt,
    };
  }

  /**
   * 根据微信商户号（mchId）反查该门店的 APIv3Key，用于微信回调解密。
   *
   * @deprecated 服务商模式下不再需要：回调统一由**服务商** APIv3 密钥加密，
   * 子商户没有自己的密钥。当前仅 partner.enabled=false 的旧直连链路可能用到，
   * 灰度结束后随旧链路一起删除（不要在新代码中调用）。
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

    return decryptApiV3KeySafely({
      encryptionService: this.encryptionService,
      apiV3KeyEnc: records[0].apiV3KeyEnc,
      storeId: records[0].storeId,
      logger: this.logger,
    });
  }

  /**
   * 返回系统中所有已配置微信收款的门店的 APIv3Key 列表（去重）。
   * 用于回调解密时逐个尝试，不需要提前知道本次回调属于哪个商户。
   *
   * @deprecated 服务商模式下**禁止使用**：回调由服务商密钥加密，遍历门店密钥必然失败，
   * 且会把「服务商密钥配错」误报成「报文被篡改」。仅保留给 partner.enabled=false 的
   * 旧直连链路，灰度结束后删除。
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
      const plainKey = decryptApiV3KeySafely({
        encryptionService: this.encryptionService,
        apiV3KeyEnc: record.apiV3KeyEnc,
        storeId: record.storeId,
        logger: this.logger,
      });
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
        subMchId: true,
        bindStatus: true,
        bindCheckedAt: true,
        bindFailReason: true,
        configuredAt: true,
      },
    });
  }

  /**
   * 校验当前门店的子商户号与服务商的绑定关系，并回传最新配置。
   *
   * 具体探测与落库在 {@link StoresWechatPayBindService}：门店取自 JWT 上下文，
   * 不接受门店 ID 入参，天然杜绝越权校验他人的子商户号。
   */
  async verifyWechatPayBind(
    user: AuthenticatedUser,
  ): Promise<WechatPayConfigResponseDto> {
    const { record } = await this.bindService.verifyAndPersist(user);
    return this.toWechatPayConfigResponse(record);
  }

  /**
   * 「已配置」的判定随模式变化，这是最容易做错的一处：
   *
   * - 服务商模式：商家只需提供子商户号，且**必须**通过绑定校验才算可收款。
   *   `configured` = 有子商户号 && bindStatus === 'verified'。
   *   只保存了子商户号而没校验通过时返回 false，前端据此提示「去校验」，
   *   避免出现「配了但一定收不到钱、界面却显示已配置」的静默故障。
   * - 直连模式（旧链路）：维持原判定（有商户号且有 APIv3 密钥）。
   */
  private toWechatPayConfigResponse(
    record: WechatPayConfigRecord,
  ): WechatPayConfigResponseDto {
    const configured = this.isPartnerMode()
      ? !!record.subMchId && record.bindStatus === 'verified'
      : !!(record.mchId && record.apiV3KeyEnc);

    return {
      configured,
      ...(record.mchId ? { mchId: record.mchId } : {}),
      ...(record.mchName ? { mchName: record.mchName } : {}),
      bindStatus: record.bindStatus,
      ...(record.bindCheckedAt
        ? { bindCheckedAt: record.bindCheckedAt.toISOString() }
        : {}),
      ...(record.bindFailReason
        ? { bindFailReason: record.bindFailReason }
        : {}),
      ...(record.configuredAt
        ? { configuredAt: record.configuredAt.toISOString() }
        : {}),
    };
  }

  /** 初次配置缺哪些必填项：服务商模式下不要求 APIv3 密钥（子商户本就没有） */
  private collectMissingRequiredFields(
    dto: UpdateWechatPayConfigDto,
  ): string[] {
    const missingFields: string[] = [];
    if (!dto.mchId) missingFields.push('mchId');
    if (!dto.mchName) missingFields.push('mchName');
    if (!this.isPartnerMode() && !dto.apiV3Key) {
      missingFields.push('apiV3Key');
    }
    return missingFields;
  }
}
