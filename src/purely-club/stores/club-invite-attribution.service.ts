import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 渠道二维码归因服务。
 *
 * 负责渠道二维码（storeInviteQrIssue）的扫码归因与计数：
 * - 扫码计数 scanCount：每次有效扫码递增；
 * - 拉新计数 joinedCount：仅当会员档案首次创建时递增；
 * - 邀请码扫码日志：用于运营可观测性（协议版本 / 结果分类 / 门店分布）。
 */
@Injectable()
export class ClubInviteAttributionService {
  private readonly logger = new Logger(ClubInviteAttributionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 渠道二维码扫码归因。
   *
   * - 无 token（通用二维码）→ 继续，不计数；
   * - token 对应 active 发行记录 → scanCount+1，继续；
   * - token 对应 revoked 发行记录 → 阻断（该实体二维码已停用）；
   * - token 不存在或不属于该门店 → 忽略归因，不阻断（防止伪造 token 干扰正常扫码）。
   */
  async resolveIssueScanAttribution(
    issueToken: string | null,
    storeId: number,
  ): Promise<{ continueScan: boolean }> {
    if (!issueToken) {
      return { continueScan: true };
    }

    const issue = await this.prisma.storeInviteQrIssue.findUnique({
      where: { publicToken: issueToken },
      select: { id: true, status: true, storeId: true, scanCount: true },
    });
    if (!issue || issue.storeId !== storeId) {
      return { continueScan: true };
    }
    if (issue.status === 'revoked') {
      return { continueScan: false };
    }

    await this.prisma.storeInviteQrIssue.update({
      where: { id: issue.id },
      data: { scanCount: { increment: 1 } },
    });
    return { continueScan: true };
  }

  /** 渠道二维码「拉新」计数：仅在新增会员档案时递增。 */
  async incrementIssueJoinedCount(
    issueToken: string,
    storeId: number,
  ): Promise<void> {
    await this.prisma.storeInviteQrIssue.updateMany({
      where: { publicToken: issueToken, storeId, status: 'active' },
      data: { joinedCount: { increment: 1 } },
    });
  }

  /**
   * 记录邀请二维码扫码解析日志（用于运营可观测性：协议版本 / 结果分类 / 门店分布）。
   * scanCode 仅在日志中保留，用于排查；敏感信息不落日志。
   */
  logInviteScan(
    userId: number | null,
    storeId: number | null,
    status: string,
    scanCode: string,
  ): void {
    this.logger.log(
      `invite-scan userId=${userId ?? '-'} storeId=${storeId ?? '-'} status=${status} scan=${scanCode.length > 64 ? `${scanCode.slice(0, 64)}...` : scanCode}`,
    );
  }
}
