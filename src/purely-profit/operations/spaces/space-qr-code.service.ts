import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { isProductionEnvironment } from '../../../shared/qr-public-url.utils';
import { reportScanQrBaseUrlStatus } from '../../../shared/scan-qr-base-url-status.utils';
import {
  buildSpaceQrTokenSecrets,
  decryptSpaceQrToken,
  resolveSpaceQrTokenKeys,
} from '../../../shared/space-qr-token-codec.utils';
import {
  buildCacheRefreshTaskKey,
  buildSpaceQrImageCacheKey,
} from '../../../redis/cache-keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { buildSpaceQrPayload } from '../scan-qr-payload.utils';
import { readSpaceQrTokenKeyConfig } from './spaces.shared';

export interface SpaceQrCodePreview {
  spaceId: number;
  spaceName: string;
  content: string;
  imageDataUrl: string;
}

export interface SpaceQrCodeDownload {
  filename: string;
  png: Buffer;
}

/** 二维码纠错等级：M 兼顾容错与图案密度，弹窗图与下载图保持一致 */
const QR_ERROR_CORRECTION_LEVEL = 'M' as const;
/** 弹窗预览图：512px、静区 0（海报白卡自带 40px 静区，避免叠加留白） */
const QR_PREVIEW_WIDTH = 512;
const QR_PREVIEW_MARGIN = 0;
/** 下载图：1024px、静区 2（独立物料需要自带静区保证可扫） */
const QR_DOWNLOAD_WIDTH = 1024;
const QR_DOWNLOAD_MARGIN = 2;

/**
 * 二维码图片产物缓存 TTL（秒）。
 *
 * 产物由「token + 尺寸 + 静区」唯一确定，缓存键的版本段是 tokenHash，
 * 轮换后键必然变化，因此 TTL 只承担「回收 Redis 内存」，不承担一致性责任。
 * 取 30 分钟：覆盖一次「批量出海报 + 逐台预览」的操作窗口，同时避免
 * 1024px PNG（base64 约 40~80KB）在 Redis 长期堆积。
 */
const SPACE_QR_IMAGE_CACHE_TTL_SECONDS = 1800;
/** 提前刷新窗口：命中超过 10 分钟时后台重渲染，摊开失效时刻 */
const SPACE_QR_IMAGE_CACHE_REFRESH_AFTER_MS = 600_000;

@Injectable()
export class SpaceQrCodeService implements OnModuleInit {
  private readonly logger = new Logger(SpaceQrCodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly configService: ConfigService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  /**
   * 启动期把「已印刷空间码」相关的配置风险显式暴露出来。
   *
   * 只告警不阻断启动：域名目前允许缺省（缺省即回退历史 `purelyclub://` 格式），
   * 但它一旦配置错，后果是**已印刷物料不可逆失效**，必须能被看见。
   *
   * 与桌码共用 `reportScanQrBaseUrlStatus`（同一份 `SCAN_QR_BASE_URL`），
   * 按域名取值去重，两处 service 只播报一次。
   */
  onModuleInit(): void {
    reportScanQrBaseUrlStatus(
      this.logger,
      this.configService.get<string>('club.scanQrBaseUrl'),
    );
    this.reportEncryptionKeyStatus();
  }

  /**
   * 空间码加密密钥状态。
   *
   * 未显式配置 `SPACE_QR_TOKEN_ENCRYPTION_KEY` 时密钥由 JWT_SECRET 派生，
   * JWT_SECRET 轮换会让历史空间码的密文全部解不开 —— 扫码不受影响（走摘要），
   * 但商家端「预览 / 下载」会退化到历史明文列；等明文列删除后就无法再出图。
   */
  private reportEncryptionKeyStatus(): void {
    if (this.configService.get<string>('space.qrTokenEncryptionKey')) {
      return;
    }

    const message =
      '未配置 SPACE_QR_TOKEN_ENCRYPTION_KEY，空间码加密密钥由 JWT_SECRET 派生：' +
      'JWT_SECRET 轮换后历史空间码将无法解密，商家端重新出图会回退历史明文列。' +
      '请显式配置 32 字节 Base64 密钥（轮换期间可用 ' +
      'SPACE_QR_TOKEN_ENCRYPTION_KEY_PREVIOUS 保留旧密钥）';

    if (isProductionEnvironment()) {
      this.logger.error(message);
      return;
    }
    this.logger.warn(message);
  }

  async getPreview(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceQrCodePreview> {
    const record = await this.getAccessibleQrCode(user, spaceId);
    const content = this.buildQrContent(record.token);

    return {
      spaceId: record.space.id,
      spaceName: record.space.name,
      content,
      imageDataUrl: await this.loadPreviewImage(
        { spaceId: record.space.id, tokenHash: record.tokenHash },
        content,
      ),
    };
  }

  async rotate(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceQrCodePreview> {
    const space = await this.getAccessibleSpace(user, spaceId);
    const token = randomUUID();
    const secrets = buildSpaceQrTokenSecrets(
      token,
      readSpaceQrTokenKeyConfig(this.configService),
    );
    // 轮换后 tokenHash 必然变化 → 图片缓存键随之变化：
    // 这里不需要显式失效，旧键已不可能再被读到，随 TTL 自然回收。
    const rotated = await this.prisma.spaceQrCode.upsert({
      where: { spaceId: space.id },
      create: {
        spaceId: space.id,
        storeId: space.storeId,
        ...secrets,
        rotatedAt: new Date(),
      },
      update: {
        ...secrets,
        revokedAt: null,
        rotatedAt: new Date(),
      },
      select: { tokenHash: true },
    });
    // 明文只在本次轮换的内存里：出图直接用它，不再回读（库里没有明文列）
    const content = this.buildQrContent(token);

    return {
      spaceId: space.id,
      spaceName: space.name,
      content,
      imageDataUrl: await this.loadPreviewImage(
        { spaceId: space.id, tokenHash: rotated.tokenHash },
        content,
      ),
    };
  }

  async download(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceQrCodeDownload> {
    const record = await this.getAccessibleQrCode(user, spaceId);

    return {
      filename: `${this.sanitizeFilename(record.space.store.name)}-${this.sanitizeFilename(record.space.name)}-二维码.png`,
      png: await this.loadDownloadPng(
        { spaceId: record.space.id, tokenHash: record.tokenHash },
        this.buildQrContent(record.token),
      ),
    };
  }

  /**
   * 出图缓存统一入口（弹窗图与下载图共用）。
   *
   * 安全边界：
   * - 缓存的**值与键都不含明文 token**：键的版本段是 tokenHash（sha256 摘要），
   *   值是 base64 图片产物；
   * - tokenHash 缺失（该字段上线前的历史行）时**不缓存**，直接渲染 ——
   *   宁可多花一次 CPU，也不能用可能不变的键把图片缓存住导致轮换后出旧图；
   * - 后台刷新闭包会持有本次请求的明文 token（渲染入参），只存活在进程内存的
   *   定时任务里，不写 Redis、不写日志。
   */
  private async loadQrImage(
    target: { spaceId: number; tokenHash: string | null },
    variant: { width: number; margin: number },
    render: () => Promise<string>,
  ): Promise<string> {
    if (!target.tokenHash) {
      return render();
    }

    const cacheKey = buildSpaceQrImageCacheKey(target.spaceId, {
      version: target.tokenHash,
      width: variant.width,
      margin: variant.margin,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: SPACE_QR_IMAGE_CACHE_TTL_SECONDS,
      refreshAfterMs: SPACE_QR_IMAGE_CACHE_REFRESH_AFTER_MS,
      loadValue: render,
    });
  }

  /** 弹窗预览图：海报合成用，不带静区（静区由海报白卡提供） */
  private async loadPreviewImage(
    target: { spaceId: number; tokenHash: string | null },
    content: string,
  ): Promise<string> {
    return this.loadQrImage(
      target,
      { width: QR_PREVIEW_WIDTH, margin: QR_PREVIEW_MARGIN },
      () =>
        QRCode.toDataURL(content, {
          errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
          margin: QR_PREVIEW_MARGIN,
          width: QR_PREVIEW_WIDTH,
        }),
    );
  }

  /** 下载图：独立物料，自带静区；缓存 base64 而非 Buffer，避免 JSON 序列化膨胀 */
  private async loadDownloadPng(
    target: { spaceId: number; tokenHash: string | null },
    content: string,
  ): Promise<Buffer> {
    const base64 = await this.loadQrImage(
      target,
      { width: QR_DOWNLOAD_WIDTH, margin: QR_DOWNLOAD_MARGIN },
      async () =>
        (
          await QRCode.toBuffer(content, {
            errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
            margin: QR_DOWNLOAD_MARGIN,
            width: QR_DOWNLOAD_WIDTH,
            type: 'png',
          })
        ).toString('base64'),
    );

    return Buffer.from(base64, 'base64');
  }

  private async getAccessibleQrCode(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<{
    token: string;
    /** 图片缓存版本段：tokenHash 变化即换键，保证轮换后不会复用旧图 */
    tokenHash: string | null;
    space: { id: number; name: string; store: { name: string } };
  }> {
    const space = await this.getAccessibleSpace(user, spaceId);

    // 读路径不写库：已存在直接读密文；不存在才补建（历史空间建码遗漏的兜底）。
    // 旧实现用 upsert(update: {})，行已存在时仍会执行 SELECT + UPDATE
    // （还会推 updated_at），预览/下载这类高频读操作不应产生写放大。
    const qrCode = await this.findOrCreateQrCodeCiphertext(space);

    return {
      token: this.restoreToken(qrCode.tokenCiphertext),
      tokenHash: qrCode.tokenHash,
      space,
    };
  }

  /**
   * 读取空间码密文；缺失时补建一条（token 只进内存，不出现在返回值里）。
   *
   * 并发补建用 P2002（spaceId 唯一约束）兜底：输掉竞争的一方回读已建行，
   * 不会重复建码，也不会让已印物料失效。
   */
  private async findOrCreateQrCodeCiphertext(space: {
    id: number;
    storeId: number;
  }): Promise<{ tokenCiphertext: string | null; tokenHash: string | null }> {
    const existing = await this.prisma.spaceQrCode.findUnique({
      where: { spaceId: space.id },
      select: { tokenCiphertext: true, tokenHash: true },
    });

    if (existing) {
      return existing;
    }

    const token = randomUUID();
    try {
      return await this.prisma.spaceQrCode.create({
        data: {
          spaceId: space.id,
          storeId: space.storeId,
          ...buildSpaceQrTokenSecrets(
            token,
            readSpaceQrTokenKeyConfig(this.configService),
          ),
        },
        select: { tokenCiphertext: true, tokenHash: true },
      });
    } catch (error) {
      const isDuplicate =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002';
      if (!isDuplicate) {
        throw error;
      }

      const raced = await this.prisma.spaceQrCode.findUnique({
        where: { spaceId: space.id },
        select: { tokenCiphertext: true, tokenHash: true },
      });
      return raced ?? { tokenCiphertext: null, tokenHash: null };
    }
  }

  /**
   * 从密文还原明文 token —— 库里已无明文列，密文是唯一来源。
   *
   * 解不开必须显式报错而不是出图：密钥轮换后静默出一张空/错内容的图，
   * 商家端显示成功、印出来才扫不出来，那是最难排查的一类事故。
   */
  private restoreToken(tokenCiphertext: string | null): string {
    if (!tokenCiphertext) {
      throw new InternalServerErrorException(
        '空间码密文缺失，无法重新出图，请轮换空间码后重新下载',
      );
    }

    const token = decryptSpaceQrToken(
      tokenCiphertext,
      resolveSpaceQrTokenKeys(readSpaceQrTokenKeyConfig(this.configService)),
    );
    if (!token) {
      throw new InternalServerErrorException(
        '空间码密文无法解密：密钥可能已轮换，请检查 ' +
          'SPACE_QR_TOKEN_ENCRYPTION_KEY / SPACE_QR_TOKEN_ENCRYPTION_KEY_PREVIOUS ' +
          '配置，或轮换空间码后重新下载',
      );
    }
    return token;
  }

  private async getAccessibleSpace(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<{
    id: number;
    name: string;
    storeId: number;
    store: { name: string };
  }> {
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, deletedAt: null },
      select: {
        id: true,
        name: true,
        storeId: true,
        store: { select: { name: true } },
      },
    });
    if (!space) {
      throw new NotFoundException('空间不存在或已删除');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:view',
      '无权查看该门店空间二维码',
    );

    return space;
  }

  private buildQrContent(token: string): string {
    // 稳定 URL 优先（微信不识别非 http/https 的自定义协议），
    // 未配置 SCAN_QR_BASE_URL 时回退历史 purelyclub:// 格式，旧物料仍可扫。
    const payload = buildSpaceQrPayload(token, {
      baseUrl: this.configService.get<string>('club.scanQrBaseUrl'),
    });
    // 空载荷说明 token 形态非法：必须拦住，否则会出一张扫不出来的图，
    // 而失效发生在已印刷物料上是不可逆的。
    if (!payload) {
      throw new InternalServerErrorException(
        '空间码内容生成失败，请重新轮换空间码',
      );
    }
    return payload;
  }

  private sanitizeFilename(value: string): string {
    const normalized = value.replace(/[\\/:*?"<>|\r\n]+/g, '-').trim();
    return normalized.slice(0, 80) || '空间';
  }
}
