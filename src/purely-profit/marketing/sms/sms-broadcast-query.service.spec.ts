import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { maskPhone } from '../marketing.utils';
import { SmsBroadcastQueryService } from './sms-broadcast-query.service';

describe('SmsBroadcastQueryService 列表分页', () => {
  const $queryRaw = jest.fn();
  const findFirst = jest.fn();
  const prisma = {
    $queryRaw,
    smsBroadcastTask: { findFirst },
  } as unknown as PrismaService;
  const service = new SmsBroadcastQueryService(prisma);

  beforeEach(() => {
    $queryRaw.mockReset();
    findFirst.mockReset();
  });

  it('listBroadcasts 单次查询同时返回列表与总数', async () => {
    const createdAt = new Date('2026-10-15T12:30:00.000Z');
    $queryRaw.mockResolvedValueOnce([
      {
        broadcastId: 'bc-1',
        content: '老顾客回馈',
        status: 'sent',
        recipientCount: 20,
        validMobileCount: 18,
        smsSegments: 18,
        successCount: 16,
        failedCount: 2,
        chargedAmountFen: 90,
        refundedAmountFen: 10,
        createdAt,
        _total: 21,
      },
    ]);

    const result = await service.listBroadcasts(18, { page: 1, pageSize: 20 });

    // 合并后不应再单独发一次 count
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([
      {
        broadcastId: 'bc-1',
        content: '老顾客回馈',
        status: 'sent',
        recipientCount: 20,
        validMobileCount: 18,
        smsSegments: 18,
        successCount: 16,
        failedCount: 2,
        chargedAmountFen: 90,
        refundedAmountFen: 10,
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(result.meta).toEqual({
      page: 1,
      pageSize: 20,
      total: 21,
      totalPages: 2,
    });
  });

  it('listBroadcasts 无匹配行时总数与总页数保持安全值', async () => {
    $queryRaw.mockResolvedValueOnce([]);

    const result = await service.listBroadcasts(18, {});

    expect(result.items).toEqual([]);
    expect(result.meta).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
    });
  });

  it('listBroadcasts 按状态筛选时条件仍拼进 SQL 参数', async () => {
    $queryRaw.mockResolvedValueOnce([]);

    await service.listBroadcasts(18, { status: 'failed' });

    const [, ...values] = $queryRaw.mock.calls[0] as unknown[];
    // Prisma 7 的 Prisma.Sql 只是类型，运行时靠 values / strings 属性识别片段
    const hasStatusFilter = values.some((value) => {
      if (value === 'failed') return true;
      if (typeof value !== 'object' || value === null) return false;
      const nested: unknown = Reflect.get(value, 'values');
      return Array.isArray(nested) && nested.includes('failed');
    });
    expect(hasStatusFilter).toBe(true);
  });

  it('listRecipients 单次查询返回脱敏明细与总数', async () => {
    findFirst.mockResolvedValueOnce({ id: 7 });
    $queryRaw.mockResolvedValueOnce([
      {
        id: 1,
        customerId: 9,
        phone: '13800138000',
        status: 'success',
        providerCode: 'Ok',
        providerMessage: null,
        _total: 31,
      },
    ]);

    const result = await service.listRecipients(18, 'bc-1', {
      page: 2,
      pageSize: 20,
    });

    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([
      {
        id: 1,
        customerId: 9,
        phone: maskPhone('13800138000'),
        status: 'success',
        providerCode: 'Ok',
        providerMessage: null,
      },
    ]);
    expect(result.meta).toEqual({
      page: 2,
      pageSize: 20,
      total: 31,
      totalPages: 2,
    });
  });

  it('listRecipients 任务不存在时不发起明细查询', async () => {
    findFirst.mockResolvedValueOnce(null);

    await expect(
      service.listRecipients(18, 'missing', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect($queryRaw).not.toHaveBeenCalled();
  });
});
