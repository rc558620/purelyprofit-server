import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
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
export class SpaceQrCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly configService: ConfigService,
  ) {}

  async getPreview(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceQrCodePreview> {
    const record = await this.getAccessibleQrCode(user, spaceId);
    const content = this.buildQrContent(record.token);
    const imageDataUrl = await QRCode.toDataURL(content, {
      errorCorrectionLevel: 'M',
      margin: 2,
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
    const qrCode = await this.prisma.spaceQrCode.upsert({
      where: { spaceId: space.id },
      create: {
        spaceId: space.id,
        storeId: space.storeId,
        token,
        rotatedAt: new Date(),
      },
      update: {
        token,
        revokedAt: null,
        rotatedAt: new Date(),
      },
      select: { token: true },
    });
    const content = this.buildQrContent(qrCode.token);
    const imageDataUrl = await QRCode.toDataURL(content, {
      errorCorrectionLevel: 'M',
      margin: 2,
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

    const qrCode = await this.prisma.spaceQrCode.upsert({
      where: { spaceId: space.id },
      create: {
        spaceId: space.id,
        storeId: space.storeId,
        token: randomUUID(),
      },
      update: {},
      select: { token: true },
    });

    return { ...qrCode, space };
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
    return buildSpaceQrPayload(token, {
      baseUrl: this.configService.get<string>('club.scanQrBaseUrl'),
    });
  }

  private sanitizeFilename(value: string): string {
    const normalized = value.replace(/[\\/:*?"<>|\r\n]+/g, '-').trim();
    return normalized.slice(0, 80) || '空间';
  }
}
