import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  const mockPrisma = {
    auditLog: {
      create: jest.fn<Promise<{ id: number }>, [Prisma.AuditLogCreateArgs]>(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({ id: 1 });
    service = new AuditLogService(mockPrisma as unknown as PrismaService);
  });

  describe('record (fire-and-forget)', () => {
    it('写入审计日志', () => {
      service.record({
        userId: 1,
        action: 'password.change',
        resourceType: 'user',
        resourceId: '1',
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 1,
          action: 'password.change',
          resourceType: 'user',
          resourceId: '1',
        }),
      });
    });

    it('userId 为 null 时正常写入', () => {
      service.record({
        action: 'login.fail.lock',
        resourceType: 'user',
        resourceId: 'admin',
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
          action: 'login.fail.lock',
        }),
      });
    });

    it('写入失败不抛异常（静默 warn）', () => {
      mockPrisma.auditLog.create.mockRejectedValueOnce(new Error('DB error'));

      // 不应抛出
      expect(() => {
        service.record({
          action: 'test.action',
        });
      }).not.toThrow();
    });

    it('metadata 正确传递', () => {
      service.record({
        action: 'login.fail.lock',
        metadata: { failCount: 10, productScope: 'purely_profit' },
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'login.fail.lock',
        }),
      });

      // 验证 metadata 被传递（作为 Prisma.InputJsonValue）
      const callData = mockPrisma.auditLog.create.mock.calls[0][0].data;
      expect(callData.metadata).toEqual({
        failCount: 10,
        productScope: 'purely_profit',
      });
    });
  });

  describe('recordAwaitable', () => {
    it('成功时正常完成', async () => {
      await expect(
        service.recordAwaitable({
          userId: 1,
          action: 'payment.callback',
        }),
      ).resolves.toBeUndefined();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('写入失败时不抛异常', async () => {
      mockPrisma.auditLog.create.mockRejectedValueOnce(
        new Error('Connection lost'),
      );

      await expect(
        service.recordAwaitable({
          action: 'test.fail',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('User-Agent 截断', () => {
    it('超过 500 字符的 User-Agent 被截断', () => {
      const longUA = 'A'.repeat(600);

      service.record({
        action: 'test.ua',
        userAgent: longUA,
      });

      const callData = mockPrisma.auditLog.create.mock.calls[0][0].data;
      expect(callData.userAgent).toHaveLength(500);
    });

    it('未提供 User-Agent 时为 null', () => {
      service.record({ action: 'test.no-ua' });

      const callData = mockPrisma.auditLog.create.mock.calls[0][0].data;
      expect(callData.userAgent).toBeNull();
    });
  });
});
