import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildStoreInviteQrImageDataUrl,
  buildStoreInviteQrPayload,
  STORE_INVITE_QR_PROTOCOL_LEGACY,
  STORE_INVITE_QR_PROTOCOL_V1,
} from '../stores/store-invite-code-qr.utils';
import { StoreInviteCodeService } from '../stores/store-invite-code.service';
import { MarketingSharedService } from './marketing-shared.service';
import type { MarketingInviteCodeDto } from './dto/marketing-invite-code.dto';

/**
 * 营销中心邀请码二维码管理服务。
 *
 * 职责：
 * - 查询门店当前有效邀请码并生成二维码图（与营销概览同源）；
 * - 轮换邀请码（禁用旧码、生成新码，并主动失效营销概览 / C 端映射缓存）；
 * - 停用邀请码。
 *
 * 邀请码的持久化与缓存失效逻辑收敛在 StoreInviteCodeService，
 * 本服务只负责营销域的权限校验与门店解析。
 */
@Injectable()
export class MarketingInviteCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
    private readonly inviteCodeService: StoreInviteCodeService,
    private readonly configService: ConfigService,
  ) {}

  /** 查询门店当前有效邀请码二维码。 */
  async getInviteCode(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingInviteCodeDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (resolvedStoreId === null) {
      return this.buildEmptyInviteCodeDto();
    }

    const record = await this.findActiveInviteCode(resolvedStoreId);
    if (!record) {
      return this.buildEmptyInviteCodeDto();
    }

    return this.buildActiveInviteCodeDto(record.code);
  }

  /** 轮换门店邀请码：旧码立即失效，返回新码及其二维码图。 */
  async rotateInviteCode(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingInviteCodeDto> {
    const resolvedStoreId = await this.resolveManageableStoreId(user, storeId);
    const newCode = await this.inviteCodeService.regenerateForStore(
      resolvedStoreId,
    );

    return this.buildActiveInviteCodeDto(newCode);
  }

  /** 停用门店全部邀请码：旧二维码不再可扫码入店。 */
  async deactivateInviteCode(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingInviteCodeDto> {
    const resolvedStoreId = await this.resolveManageableStoreId(user, storeId);
    await this.inviteCodeService.deactivateForStore(resolvedStoreId);

    return this.buildEmptyInviteCodeDto();
  }

  private async findActiveInviteCode(storeId: number): Promise<{
    code: string;
  } | null> {
    return this.prisma.storeInviteCode.findFirst({
      where: { storeId, isActive: true },
      select: { code: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 无有效邀请码时的空态响应。 */
  private buildEmptyInviteCodeDto(): MarketingInviteCodeDto {
    return {
      inviteCode: null,
      inviteCodeQrCodeImageUrl: null,
      isActive: false,
      inviteQrPayloadVersion: null,
      inviteQrEntryUrl: null,
    };
  }

  /** 基于邀请码构建有效响应：二维码图 + 载荷版本 + 可复制稳定入口 URL。 */
  private async buildActiveInviteCodeDto(
    inviteCode: string,
  ): Promise<MarketingInviteCodeDto> {
    const payload = buildStoreInviteQrPayload(inviteCode, {
      baseUrl: this.configService.get<string>('club.publicBaseUrl'),
      entryPath: this.configService.get<string>('club.storeInviteQrEntryPath'),
    });
    const isV1Url = payload !== inviteCode;

    return {
      inviteCode,
      inviteCodeQrCodeImageUrl: await buildStoreInviteQrImageDataUrl(payload),
      isActive: true,
      inviteQrPayloadVersion: isV1Url
        ? STORE_INVITE_QR_PROTOCOL_V1
        : STORE_INVITE_QR_PROTOCOL_LEGACY,
      inviteQrEntryUrl: isV1Url ? payload : null,
    };
  }

  private async resolveManageableStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
  ): Promise<number> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (resolvedStoreId === null) {
      throw new ForbiddenException('无权操作该门店的营销数据');
    }
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      resolvedStoreId,
      'marketing:manage',
    );
    return resolvedStoreId;
  }
}
