import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { resolveStoreInviteQrPayload } from '../../purely-profit/stores/store-invite-code-qr.utils';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ClubPublicInviteEntryResponseDto,
  ClubResolveScanCodeResponseDto,
} from './dto/club-store.dto';
import { ClubInviteAttributionService } from './club-invite-attribution.service';
import { ClubInviteCodeMapService } from './club-invite-code-map.service';
import { ClubStoreViewService } from './club-store-view.service';

/**
 * 邀请二维码扫码解析服务。
 *
 * 负责把原始扫码内容交给服务端权威解析，返回协议版本、邀请码、
 * 目标门店与下一步动作；公开落地入口（无鉴权）同样走本服务，
 * 只返回必要落地信息，不执行任何状态变更。
 */
@Injectable()
export class ClubInviteScanResolveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeViewService: ClubStoreViewService,
    private readonly inviteCodeMapService: ClubInviteCodeMapService,
    private readonly inviteAttributionService: ClubInviteAttributionService,
  ) {}

  /**
   * 解析并确认邀请二维码（供 purely-club 扫码落地页 / 小程序使用）。
   *
   * 客户端不自行猜测二维码路由，而是把原始扫码内容交给服务端权威解析，
   * 由服务端返回协议版本、邀请码、目标门店与下一步动作。
   */
  async resolveScanCode(
    user: AuthenticatedUser,
    scanCode: string,
  ): Promise<ClubResolveScanCodeResponseDto> {
    const resolveResult = resolveStoreInviteQrPayload(scanCode);

    if (resolveResult.kind === 'unsupported_version') {
      this.inviteAttributionService.logInviteScan(
        user.id,
        null,
        'unsupported_version',
        scanCode,
      );
      return {
        protocolVersion: 'unsupported',
        inviteCode: null,
        store: null,
        status: 'unsupported_version',
        nextAction: 'none',
        message: '当前邀请二维码协议版本暂不支持，请联系商家获取新二维码',
      };
    }

    if (resolveResult.kind === 'unrecognized') {
      this.inviteAttributionService.logInviteScan(
        user.id,
        null,
        'not_found',
        scanCode,
      );
      return {
        protocolVersion: null,
        inviteCode: null,
        store: null,
        status: 'not_found',
        nextAction: 'none',
        message: '扫码结果无效，未识别到门店邀请码',
      };
    }

    const { protocolVersion, inviteCode, issueToken } = resolveResult;
    const store =
      await this.inviteCodeMapService.findStoreByInviteCode(inviteCode);
    if (!store) {
      this.inviteAttributionService.logInviteScan(
        user.id,
        null,
        'inactive',
        scanCode,
      );
      return {
        protocolVersion,
        inviteCode,
        store: null,
        status: 'inactive',
        nextAction: 'none',
        message: '该门店邀请二维码已失效，请联系商家获取新二维码',
      };
    }

    // 渠道二维码归因：已撤销的渠道二维码给出明确停用提示（scanCount 在此递增）
    const attribution =
      await this.inviteAttributionService.resolveIssueScanAttribution(
        issueToken,
        store.id,
      );
    if (!attribution.continueScan) {
      this.inviteAttributionService.logInviteScan(
        user.id,
        store.id,
        'revoked_issue',
        scanCode,
      );
      return {
        protocolVersion,
        inviteCode,
        store: null,
        status: 'inactive',
        nextAction: 'none',
        message: '该渠道二维码已停用，请联系商家获取新二维码',
      };
    }

    const existingMember = await this.prisma.member.findFirst({
      where: {
        storeId: store.id,
        phone: user.phone,
        deletedAt: null,
      },
      select: { id: true },
    });
    const alreadyBound = existingMember !== null;
    this.inviteAttributionService.logInviteScan(
      user.id,
      store.id,
      alreadyBound ? 'already_bound' : 'active',
      scanCode,
    );

    return {
      protocolVersion,
      inviteCode,
      store: await this.storeViewService.toSummary(store),
      status: 'active',
      nextAction: alreadyBound ? 'already_bound' : 'join_store',
      message: alreadyBound
        ? '您已加入该门店，可直接进入'
        : '扫码成功，可加入该门店',
    };
  }

  /**
   * 公开落地入口解析（无鉴权，供 H5 落地页 / 小程序扫码后调用）。
   *
   * 只返回必要落地信息（协议版本、邀请码、门店摘要、状态），
   * 不执行任何状态变更，不泄露商家敏感配置与结算信息。
   */
  async resolvePublicInviteEntry(
    inviteCode: string,
    issueToken?: string | null,
  ): Promise<ClubPublicInviteEntryResponseDto> {
    const normalized = inviteCode.trim().toUpperCase();
    if (!normalized || !/^[A-Z0-9]{6,32}$/.test(normalized)) {
      this.inviteAttributionService.logInviteScan(
        null,
        null,
        'not_found',
        inviteCode,
      );
      return {
        inviteCode: null,
        store: null,
        status: 'not_found',
        message: '扫码结果无效，未识别到门店邀请码',
      };
    }

    const store =
      await this.inviteCodeMapService.findStoreByInviteCode(normalized);
    if (!store) {
      this.inviteAttributionService.logInviteScan(
        null,
        null,
        'inactive',
        inviteCode,
      );
      return {
        inviteCode: normalized,
        store: null,
        status: 'inactive',
        message: '该门店邀请二维码已失效，请联系商家获取新二维码',
      };
    }

    // 渠道二维码归因：已撤销时给出明确停用提示
    const attribution =
      await this.inviteAttributionService.resolveIssueScanAttribution(
        issueToken ?? null,
        store.id,
      );
    if (!attribution.continueScan) {
      this.inviteAttributionService.logInviteScan(
        null,
        store.id,
        'revoked_issue',
        inviteCode,
      );
      return {
        inviteCode: normalized,
        store: null,
        status: 'inactive',
        message: '该渠道二维码已停用，请联系商家获取新二维码',
      };
    }

    this.inviteAttributionService.logInviteScan(
      null,
      store.id,
      'active',
      inviteCode,
    );
    return {
      inviteCode: normalized,
      store: await this.storeViewService.toSummary(store),
      status: 'active',
      message: '邀请二维码有效',
    };
  }
}
