import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogEntry {
  userId?: number | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 安全审计日志服务
 *
 * 采用 fire-and-forget 模式：写入失败仅记录警告，不阻塞业务流程。
 * 所有审计日志仅追加写入，不做更新/删除。
 *
 * 典型使用场景：
 * - 密码变更/重置
 * - 登录失败锁定
 * - 权限变更（角色调整、子账号分配）
 * - 支付回调接收
 * - 关键数据删除
 * - 封禁/解封操作
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 异步记录审计日志（fire-and-forget）
   *
   * 调用方无需 await，写入失败仅记录 warn 日志。
   * 适合在业务操作成功后追加记录。
   */
  record(entry: AuditLogEntry): void {
    this.prisma.auditLog
      .create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          ip: entry.ip ?? null,
          userAgent: this.truncateUserAgent(entry.userAgent),
          metadata: (entry.metadata as Prisma.InputJsonValue) ?? undefined,
        },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `[audit-log] 写入失败 action=${entry.action}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /**
   * 同步记录审计日志（await 等待写入完成）
   *
   * 仅在必须确保审计记录写入成功的场景使用（如支付回调）。
   */
  async recordAwaitable(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          ip: entry.ip ?? null,
          userAgent: this.truncateUserAgent(entry.userAgent),
          metadata: (entry.metadata as Prisma.InputJsonValue) ?? undefined,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `[audit-log] 写入失败 action=${entry.action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private truncateUserAgent(ua?: string): string | null {
    if (!ua) return null;
    return ua.length > 500 ? ua.slice(0, 500) : ua;
  }
}
