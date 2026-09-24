import { randomUUID } from 'node:crypto';
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
  type SpaceQrTokenKeyConfig,
} from '../../../shared/space-qr-token-codec.utils';
import { buildSpaceQrPayload } from '../scan-qr-payload.utils';

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

@Injectable()
export class SpaceQrCodeService implements OnModuleInit {
  private readonly logger = new Logger(SpaceQrCodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly configService: ConfigService,
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
    // 弹窗图用于海报合成：海报白卡自带 40px 静区，这里 margin:0 与桌码口径一致，
    // 避免“图片静区 + 白卡留白”叠加导致二维码四周留白偏大；独立静区由下载接口保证。
    const imageDataUrl = await QRCode.toDataURL(content, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 512,
    });

    return {
      spaceId: record.space.id,
      spaceName: record.space.name,
      content,
      imageDataUrl,
    };
  }

  async rotate(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceQrCodePreview> {
    const space = await this.getAccessibleSpace(user, spaceId);
    const token = randomUUID();
    const secrets = buildSpaceQrTokenSecrets(token, this.readTokenKeyConfig());
    await this.prisma.spaceQrCode.upsert({
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
    });
    // 明文只在本次轮换的内存里：出图直接用它，不再回读（库里没有明文列）
    const content = this.buildQrContent(token);
    // 同 getPreview：海报合成图不带静区，避免与白卡留白叠加。
    const imageDataUrl = await QRCode.toDataURL(content, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 512,
    });

    return {
      spaceId: space.id,
      spaceName: space.name,
      content,
      imageDataUrl,
    };
  }

  async download(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceQrCodeDownload> {
    const record = await this.getAccessibleQrCode(user, spaceId);
    const png = await QRCode.toBuffer(this.buildQrContent(record.token), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 1024,
      type: 'png',
    });

    return {
      filename: `${this.sanitizeFilename(record.space.store.name)}-${this.sanitizeFilename(record.space.name)}-二维码.png`,
      png,
    };
  }

  private async getAccessibleQrCode(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<{
    token: string;
    space: { id: number; name: string; store: { name: string } };
  }> {
    const space = await this.getAccessibleSpace(user, spaceId);

    const token = randomUUID();
    const qrCode = await this.prisma.spaceQrCode.upsert({
      where: { spaceId: space.id },
      create: {
        spaceId: space.id,
        storeId: space.storeId,
        ...buildSpaceQrTokenSecrets(token, this.readTokenKeyConfig()),
      },
      // 已存在的行不动：预览 / 下载**不会**轮换 token，否则已印物料会凭空失效
      update: {},
      select: { tokenCiphertext: true },
    });

    return { token: this.restoreToken(qrCode.tokenCiphertext), space };
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
      resolveSpaceQrTokenKeys(this.readTokenKeyConfig()),
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

  private readTokenKeyConfig(): SpaceQrTokenKeyConfig {
    return {
      current: this.configService.get<string>('space.qrTokenEncryptionKey'),
      previous: this.configService.get<string>(
        'space.qrTokenEncryptionKeyPrevious',
      ),
      jwtSecret: this.configService.get<string>('jwt.secret'),
    };
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
