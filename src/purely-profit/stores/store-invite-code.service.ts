import { Injectable } from '@nestjs/common';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

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
   * 重新生成门店邀请码（禁用旧码，生成新码）
   */
  async regenerateForStore(storeId: number): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        // 禁用所有旧码
        await tx.storeInviteCode.updateMany({
          where: { storeId },
          data: { isActive: false },
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
}
