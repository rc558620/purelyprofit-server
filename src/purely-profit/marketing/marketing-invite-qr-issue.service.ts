import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildStoreInviteQrImageDataUrl,
  buildStoreInviteQrPayload,
} from '../stores/store-invite-code-qr.utils';
import { MarketingSharedService } from './marketing-shared.service';
import type { CreateMarketingInviteQrIssueDto, MarketingInviteQrIssueDto } from './dto/marketing-invite-code-issue.dto';

/** 渠道二维码发行记录服务：创建 / 列表 / 单张撤销。 */
@Injectable()
export class MarketingInviteQrIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  /** 创建一张渠道二维码（绑定当前有效邀请码）。 */
  async createIssue(
    user: AuthenticatedUser,
    storeId: number | undefined,
    dto: CreateMarketingInviteQrIssueDto,
  ): Promise<MarketingInviteQrIssueDto> {
    const resolvedStoreId = await this.resolveManageableStoreId(user, storeId);

    // 渠道二维码依赖稳定公共入口做扫码归因，未配置域名（含生产环境 localhost 被 sanitize 拒绝的情况）时不允许创建
    if (!this.hasPublicBaseUrl()) {
      throw new BadRequestException(
        '请先配置俱乐部公共域名后再创建渠道二维码（渠道二维码依赖稳定入口做扫码归因）',
      );
    }

    const activeCode = await this.prisma.storeInviteCode.findFirst({
      where: { storeId: resolvedStoreId, isActive: true },
      select: { id: true, code: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!activeCode) {
      throw new BadRequestException('请先生成门店邀请码，再创建渠道二维码');
    }

    const issue = await this.prisma.storeInviteQrIssue.create({
      data: {
        storeId: resolvedStoreId,
        inviteCodeId: activeCode.id,
        channel: dto.channel,
        name: dto.name ?? null,
        publicToken: randomUUID(),
        protocolVersion: 'v1',
        createdBy: user.id,
      },
    });

    return this.buildIssueDto(issue, activeCode.code);
  }

  /** 渠道二维码列表（分页，可按渠道/状态筛选）。 */
  async listIssues(
    user: AuthenticatedUser,
    storeId: number | undefined,
    query: { channel?: string; status?: string; page?: number; pageSize?: number },
  ): Promise<{ items: MarketingInviteQrIssueDto[]; total: number }> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (resolvedStoreId === null) {
      return { items: [], total: 0 };
    }

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 20));

    const where = {
      storeId: resolvedStoreId,
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [records, total] = await this.prisma.$transaction([
      this.prisma.storeInviteQrIssue.findMany({
        where,
        include: { inviteCode: { select: { code: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.storeInviteQrIssue.count({ where }),
    ]);

    const items = await Promise.all(
      records.map((record) => this.buildIssueDto(record, record.inviteCode.code)),
    );

    return { items, total };
  }

  /** 撤销单张渠道二维码（不影响该门店通用二维码与其他渠道二维码）。 */
  async revokeIssue(
    user: AuthenticatedUser,
    storeId: number | undefined,
    issueId: number,
  ): Promise<void> {
    const resolvedStoreId = await this.resolveManageableStoreId(user, storeId);

    const issue = await this.prisma.storeInviteQrIssue.findFirst({
      where: { id: issueId, storeId: resolvedStoreId },
      select: { id: true, status: true },
    });
    if (!issue) {
      throw new ForbiddenException('未找到该二维码发行记录');
    }
    if (issue.status === 'revoked') {
      throw new BadRequestException('该二维码已撤销');
    }

    await this.prisma.storeInviteQrIssue.update({
      where: { id: issue.id },
      data: { status: 'revoked', revokedAt: new Date() },
    });
  }

  /**
   * 物理删除单张渠道二维码（不可恢复，前端需二次确认）。
   * 该记录不参与会员权限链路，无外键依赖，可安全物理删除。
   */
  async deleteIssue(
    user: AuthenticatedUser,
    storeId: number | undefined,
    issueId: number,
  ): Promise<void> {
    const resolvedStoreId = await this.resolveManageableStoreId(user, storeId);

    const issue = await this.prisma.storeInviteQrIssue.findFirst({
      where: { id: issueId, storeId: resolvedStoreId },
      select: { id: true },
    });
    if (!issue) {
      throw new ForbiddenException('未找到该二维码发行记录');
    }

    await this.prisma.storeInviteQrIssue.delete({ where: { id: issue.id } });
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

  private async buildIssueDto(
    issue: {
      id: number;
      publicToken: string;
      channel: string;
      name: string | null;
      status: string;
      scanCount: number;
      joinedCount: number;
      issuedAt: Date;
      revokedAt: Date | null;
    },
    inviteCode: string,
  ): Promise<MarketingInviteQrIssueDto> {
    const payload = buildStoreInviteQrPayload(inviteCode, {
      baseUrl: this.configService.get<string>('club.publicBaseUrl'),
      entryPath: this.configService.get<string>('club.storeInviteQrEntryPath'),
      issueToken: issue.publicToken,
    });
    const isV1Url = /^https?:\/\//i.test(payload) && payload.includes('/v1/');

    return {
      id: issue.id,
      channel: issue.channel,
      name: issue.name,
      status: issue.status === 'revoked' ? 'revoked' : 'active',
      scanCount: issue.scanCount,
      joinedCount: issue.joinedCount,
      issuedAt: issue.issuedAt,
      revokedAt: issue.revokedAt,
      inviteCode,
      entryUrl: isV1Url ? payload : null,
      qrCodeImageUrl: isV1Url
        ? await buildStoreInviteQrImageDataUrl(payload)
        : null,
    };
  }

  private hasPublicBaseUrl(): boolean {
    const baseUrl = this.configService.get<string>('club.publicBaseUrl');
    return typeof baseUrl === 'string' && baseUrl.trim().length > 0;
  }
}
