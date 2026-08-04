import { Injectable } from '@nestjs/common';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubInviteCodeMapCacheKey } from '../../redis/keys';
import { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import { randomBytes } from 'node:crypto';

/**
 * 邀请码服务（Step 3: 0.4 持久化邀请码）
 *
 * 字符集：23456789ABCDEFGHJKLMNPQRSTUVWXYZ（去除易混淆字符 0/O/I/1）
 * 长度：8 位
 * 生成算法：随机字节映射到字符集，碰撞时重试
 * 碰撞概率：35^8 ≈ 2.25 万亿，实际应用无碰撞风险
 */
@Injectable()
export class StoreInviteCodeService {
  /** 邀请码字符集（去除易混淆字符 0/O/I/1） */
  private readonly CODE_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  private readonly CODE_LENGTH = 8;
  private readonly MAX_RETRY = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 为门店生成并持久化邀请码（注册时调用）
   */
  async generateForStore(storeId: number): Promise<string> {
    for (let attempt = 0; attempt < this.MAX_RETRY; attempt++) {
      const code = this.generateCode();

      try {
        await this.prisma.storeInviteCode.create({
          data: { storeId, code },
        });
        await this.invalidateInviteCodeCaches(storeId);
        return code;
      } catch (error: unknown) {
        // 碰撞检测：P2002 unique constraint violation
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `Failed to generate unique invite code after ${this.MAX_RETRY} attempts`,
    );
  }

  /**
   * 获取门店的活跃邀请码
   */
  async getActiveCode(storeId: number): Promise<string | null> {
    const record = await this.prisma.storeInviteCode.findFirst({
      where: { storeId, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { code: true },
    });
    return record?.code ?? null;
  }

  /**
   * 重新生成门店邀请码（禁用旧码，生成新码）。
   *
   * 轮换后立即失效营销概览缓存与 C 端 inviteCode→storeId 映射缓存，
   * 避免旧二维码在 TTL 内仍被展示或仍可扫码入店。
   *
   * 同时联动失效该门店所有「生效中」的渠道二维码：
   * 渠道二维码 URL 内嵌旧邀请码（{base}/i/v1/{旧码}?t={token}），
   * 旧码停用后其扫码必然失效，因此列表状态应与实际行为一致（显示已停用），
   * 避免运营误以为旧渠道码仍可使用。
   */
  async regenerateForStore(storeId: number): Promise<string> {
    const newCode = await this.prisma.$transaction(
      async (tx) => {
        // 禁用所有旧码
        await tx.storeInviteCode.updateMany({
          where: { storeId },
          data: { isActive: false },
        });

        // 联动失效该门店所有生效中的渠道二维码（URL 内嵌旧邀请码，随旧码一并停用）
        await tx.storeInviteQrIssue.updateMany({
          where: { storeId, status: 'active' },
          data: { status: 'revoked', revokedAt: new Date() },
        });

        // 生成新码
        for (let attempt = 0; attempt < this.MAX_RETRY; attempt++) {
          const code = this.generateCode();
          try {
            await tx.storeInviteCode.create({
              data: { storeId, code },
            });
            return code;
          } catch (error: unknown) {
            if (
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'P2002'
            ) {
              continue;
            }
            throw error;
          }
        }

        throw new Error(
          `Failed to regenerate invite code after ${this.MAX_RETRY} attempts`,
        );
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    await this.invalidateInviteCodeCaches(storeId);
    return newCode;
  }

  /**
   * 停用门店全部邀请码（保留历史记录，仅标记 isActive=false）。
   * 停用后立即失效相关缓存，保证管理端与 C 端不再识别旧码。
   *
   * 与轮换一致，联动失效该门店所有「生效中」的渠道二维码。
   */
  async deactivateForStore(storeId: number): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.storeInviteCode.updateMany({
          where: { storeId, isActive: true },
          data: { isActive: false },
        });

        // 联动失效该门店所有生效中的渠道二维码
        await tx.storeInviteQrIssue.updateMany({
          where: { storeId, status: 'active' },
          data: { status: 'revoked', revokedAt: new Date() },
        });
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );
    await this.invalidateInviteCodeCaches(storeId);
  }

  /**
   * 通过邀请码查询门店（用于注册或绑定场景）
   */
  async findStoreByCode(code: string): Promise<number | null> {
    const record = await this.prisma.storeInviteCode.findUnique({
      where: { code },
      select: { storeId: true, isActive: true },
    });

    return record?.isActive ? record.storeId : null;
  }

  /**
   * 增加邀请码使用次数
   */
  async incrementUsedCount(code: string): Promise<void> {
    await this.prisma.storeInviteCode.updateMany({
      where: { code, isActive: true },
      data: { usedCount: { increment: 1 } },
    });
  }

  /**
   * 生成 8 位邀请码（内部方法）
   */
  private generateCode(): string {
    const bytes = randomBytes(this.CODE_LENGTH);
    let code = '';
    for (let i = 0; i < this.CODE_LENGTH; i++) {
      const idx = bytes[i] % this.CODE_CHARSET.length;
      code += this.CODE_CHARSET[idx];
    }
    return code;
  }

  /**
   * 邀请码状态变更后主动失效依赖缓存：
   * - 营销概览（二维码图缓存于概览响应中，TTL 120s，不能等 TTL 自然过期）；
   * - C 端 inviteCode→storeId 全量映射（TTL 3600s，不失效则旧码扫码仍可入店）。
   */
  private async invalidateInviteCodeCaches(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateMarketingOverview(storeId),
      this.redisService.del(buildClubInviteCodeMapCacheKey()),
    ]);
  }
}
