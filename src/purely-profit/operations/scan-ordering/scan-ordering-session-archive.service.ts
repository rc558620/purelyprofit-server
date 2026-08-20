import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

const ARCHIVE_AFTER_MS = 2 * 60 * 60 * 1000;
const AUTO_ARCHIVE_BATCH_SIZE = 100;
@Injectable()
export class ScanOrderingSessionArchiveService {
  private readonly logger = new Logger(ScanOrderingSessionArchiveService.name);

  constructor(private readonly prisma: PrismaService) {}

  async archiveEligibleSessions(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_MS);
    const sessions = await this.prisma.scanOrderingSession.findMany({
      where: { status: 'active', deletedAt: null },
      select: { id: true, storeId: true, tableId: true },
      take: AUTO_ARCHIVE_BATCH_SIZE,
      orderBy: { id: 'asc' },
    });
    let archived = 0;
    for (const session of sessions) {
      if (
        await this.archiveSessionIfEligible(
          session.id,
          session.storeId,
          session.tableId,
          cutoff,
          now,
        )
      )
        archived += 1;
    }
    if (archived > 0) this.logger.log(`已自动归档 ${archived} 个扫码点餐会话`);
    return archived;
  }

  private async archiveSessionIfEligible(
    sessionId: number,
    storeId: number,
    tableId: number | null,
    cutoff: Date,
    now: Date,
  ): Promise<boolean> {
    if (!tableId) return false;
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.scanOrderingSession.findFirst({
        where: { id: sessionId, status: 'active', deletedAt: null },
        select: { id: true },
      });
      if (!session) return false;
      const orders = await tx.scanOrders.findMany({
        where: { sessionId, deletedAt: null },
        select: { id: true, status: true, servedAt: true },
      });
      if (
        orders.length === 0 ||
        orders.some((order) => order.status !== 'served')
      )
        return false;
      const servedAtValues = orders
        .map((order) => order.servedAt)
        .filter((value): value is Date => value !== null);
      const lastServedAt = servedAtValues.reduce<Date | null>(
        (latest, value) => (!latest || value > latest ? value : latest),
        null,
      );
      if (
        servedAtValues.length !== orders.length ||
        !lastServedAt ||
        lastServedAt > cutoff
      )
        return false;
      const updated = await tx.scanOrderingSession.updateMany({
        where: { id: sessionId, status: 'active' },
        data: {
          status: 'checked_out',
          endedAt: now,
          archiveReason: 'auto_timeout',
        },
      });
      if (updated.count === 0) return false;
      await tx.scanOrderingCartItem.updateMany({
        where: { sessionId, status: 'active' },
        data: { status: 'removed' },
      });
      // 归档会话的同时闭环已出餐订单（served → completed）：
      // 出餐后商家长时间未确认完成时，订单随会话一并自动完成，
      // 避免产生「会话已结束但订单仍为 served」的孤儿单导致清桌/列表长期滞留。
      await tx.scanOrders.updateMany({
        where: { sessionId, deletedAt: null, status: 'served' },
        data: { status: 'completed', completedAt: now },
      });
      await tx.scanOrderStatusHistory.createMany({
        data: orders
          .filter((order) => order.status === 'served')
          .map((order) => ({
            orderId: order.id,
            storeId,
            fromStatus: 'served',
            toStatus: 'completed',
            operatorType: 'system',
            reason: '会话超时归档，订单自动完成',
          })),
      });
      const otherActiveSessions = await tx.scanOrderingSession.count({
        where: { storeId, tableId, status: 'active', deletedAt: null },
      });
      if (otherActiveSessions === 0)
        await tx.scanOrderingTable.updateMany({
          where: { id: tableId, storeId, status: { not: 'disabled' } },
          data: { status: 'empty', version: { increment: 1 } },
        });
      return true;
    });
  }
}
