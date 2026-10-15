import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { SmsAccountService } from './sms-account.service';
import { SmsBroadcastService } from './sms-broadcast.service';
import { SmsQuoteService } from './sms-quote.service';
import { SmsRefundService } from './sms-refund.service';
import { SmsTencentProvider } from './sms-tencent.provider';

import { SMS_NO_PROVIDER_STATUS_CODE } from './sms.constants';

const STORE_ID = 18;
const UNIT_PRICE_FEN = 5;

type TxClient = {
  storeSmsAccount: {
    upsert: jest.Mock;
    updateMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  smsWalletLog: { create: jest.Mock };
  smsBroadcastTask: { create: jest.Mock };
  smsBroadcastRecipient: { createMany: jest.Mock };
};

describe('SmsBroadcastService', () => {
  let service: SmsBroadcastService;
  let quoteService: SmsQuoteService;
  let prisma: {
    marketingCustomer: { findMany: jest.Mock };
    storeSmsAccount: { updateMany: jest.Mock };
    smsBroadcastTask: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    smsBroadcastRecipient: {
      updateMany: jest.Mock;
      findMany: jest.Mock;
      groupBy: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tx: TxClient;
  let provider: { sendMarketingBatch: jest.Mock; isChannelReady: jest.Mock };
  let refundService: {
    refundUndeliveredFailures: jest.Mock;
    refundRecipient: jest.Mock;
  };
  let accountService: {
    resolveUnitPriceFen: jest.Mock;
    getAccount: jest.Mock;
    ensureAccount: jest.Mock;
  };
  let balanceFen: number;
  let config: { get: jest.Mock };

  const buildCustomers = (count: number, withPhoneFrom = 0) =>
    Array.from({ length: count }, (_unused, index) => ({
      id: index + 1,
      // 前 withPhoneFrom 位故意不给手机号，用于验证「无手机号者被剔除」
      phone:
        index < withPhoneFrom ? null : `138${String(index).padStart(8, '0')}`,
    }));

  const mobileOf = (index: number): string =>
    `138${String(index).padStart(8, '0')}`;

  beforeEach(() => {
    balanceFen = 10_000;

    tx = {
      storeSmsAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 1, storeId: STORE_ID }),
        // 条件更新：余额够才扣，不够返回 count 0
        updateMany: jest.fn().mockImplementation(({ data }) => {
          const decrement = data.balanceFen.decrement as number;
          if (balanceFen < decrement) {
            return Promise.resolve({ count: 0 });
          }
          balanceFen -= decrement;
          return Promise.resolve({ count: 1 });
        }),
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ balanceFen })),
      },
      smsWalletLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      smsBroadcastTask: {
        create: jest.fn().mockResolvedValue({ id: 777 }),
      },
      smsBroadcastRecipient: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma = {
      marketingCustomer: { findMany: jest.fn() },
      storeSmsAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      smsBroadcastTask: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 777 }),
      },
      smsBroadcastRecipient: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        // 派发后按明细重新统计：默认「全部成功」，未决数为 0
        groupBy: jest
          .fn()
          .mockResolvedValue([{ status: 'success', _count: { _all: 20 } }]),
      },
      $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
    };

    accountService = {
      resolveUnitPriceFen: jest.fn().mockReturnValue(UNIT_PRICE_FEN),
      getAccount: jest.fn().mockImplementation(() =>
        Promise.resolve({
          id: 1,
          storeId: STORE_ID,
          balanceFen,
          totalRechargedFen: 0,
          totalConsumedFen: 0,
          sentSmsCount: 0,
        }),
      ),
      ensureAccount: jest
        .fn()
        .mockResolvedValue({ id: 1, storeId: STORE_ID, balanceFen }),
    };

    provider = {
      isChannelReady: jest.fn().mockReturnValue(true),
      sendMarketingBatch: jest.fn().mockImplementation((phones: string[]) =>
        Promise.resolve(
          phones.map((phone) => ({
            phone,
            ok: true,
            code: 'Ok',
            message: null,
            requestId: 'req-test',
          })),
        ),
      ),
    };

    const redisStore = new Map<string, string>();
    const redis = {
      get: jest.fn((key: string) => redisStore.get(key) ?? null),
      set: jest.fn((key: string, value: string) => {
        redisStore.set(key, value);
        return Promise.resolve();
      }),
    };

    config = {
      get: jest.fn(() => undefined),
    };

    quoteService = new SmsQuoteService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      config as never,
      accountService as unknown as SmsAccountService,
    );
    refundService = {
      refundUndeliveredFailures: jest.fn().mockResolvedValue({
        recipients: 0,
        amountFen: 0,
      }),
      refundRecipient: jest.fn().mockResolvedValue(0),
    };

    service = new SmsBroadcastService(
      prisma as unknown as PrismaService,
      config as never,
      quoteService,
      accountService as unknown as SmsAccountService,
      provider as unknown as SmsTencentProvider,
      refundService as unknown as SmsRefundService,
    );
  });

  const quoteAndBroadcast = async (
    customerIds: string[],
    content: string,
    idempotencyKey: string,
  ) => {
    const quote = await quoteService.createQuote(STORE_ID, {
      customerIds,
      content,
    });
    const result = await service.broadcast(STORE_ID, 1, {
      customerIds,
      content,
      quoteId: quote.quoteId,
      idempotencyKey,
    });
    return { quote, result };
  };

  it('先扣费后发送：事务内扣余额、写 consume 流水、建任务与收件人', async () => {
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(20));

    const { quote, result } = await quoteAndBroadcast(
      Array.from({ length: 20 }, (_u, i) => String(i + 1)),
      '老顾客回馈：本周到店满 100 减 20。',
      'idem_charge_once',
    );

    expect(quote.smsSegments).toBe(20);
    expect(quote.estimatedAmountFen).toBe(20 * UNIT_PRICE_FEN);
    expect(result.chargedAmountFen).toBe(20 * UNIT_PRICE_FEN);

    expect(tx.storeSmsAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.smsWalletLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'consume',
          changeFen: -100,
        }),
      }),
    );
    expect(tx.smsBroadcastRecipient.createMany).toHaveBeenCalledTimes(1);
    // 扣费后才发：provider 必须在事务完成后被调用
    expect(provider.sendMarketingBatch).toHaveBeenCalledTimes(1);
    expect(balanceFen).toBe(10_000 - 100);
  });

  it('smsSegments 按总条数计费：71 字正文 × 20 人 = 40 条', async () => {
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(20));

    const { quote, result } = await quoteAndBroadcast(
      Array.from({ length: 20 }, (_u, i) => String(i + 1)),
      '好'.repeat(71),
      'idem_long_content',
    );

    expect(quote.smsSegments).toBe(40);
    expect(result.chargedAmountFen).toBe(40 * UNIT_PRICE_FEN);
  });

  it('余额不足时抛 400 且不发送、不建任务', async () => {
    balanceFen = 50;
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(20));

    await expect(
      quoteAndBroadcast(
        Array.from({ length: 20 }, (_u, i) => String(i + 1)),
        '老顾客回馈',
        'idem_insufficient',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(tx.smsBroadcastTask.create).not.toHaveBeenCalled();
    expect(provider.sendMarketingBatch).not.toHaveBeenCalled();
    expect(balanceFen).toBe(50);
  });

  it('幂等键命中：第二次提交直接返回首次结果，不重复扣费', async () => {
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(20));

    const ids = Array.from({ length: 20 }, (_u, i) => String(i + 1));
    await quoteAndBroadcast(ids, '老顾客回馈', 'idem_cross_page');

    // 模拟跨页续发：钱包页支付成功后回到群发页，用同一个 key 再提交一次
    prisma.smsBroadcastTask.findUnique.mockResolvedValue({
      id: 777,
      storeId: STORE_ID,
      broadcastId: 'bc_existing',
      recipientCount: 20,
      chargedAmountFen: 100,
      status: 'sent',
      updatedAt: new Date(),
    });

    const second = await service.broadcast(STORE_ID, 1, {
      customerIds: ids,
      content: '老顾客回馈',
      quoteId: 'qt_any',
      idempotencyKey: 'idem_cross_page',
    });

    expect(second).toEqual({
      broadcastId: 'bc_existing',
      recipientCount: 20,
      chargedAmountFen: 100,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(provider.sendMarketingBatch).toHaveBeenCalledTimes(1);
  });

  it('收件人明细全部落库（超过 200 时的切片由 provider 负责，见 sms-tencent.provider.spec）', async () => {
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(250));

    await quoteAndBroadcast(
      Array.from({ length: 250 }, (_u, i) => String(i + 1)),
      '大规模群发',
      'idem_chunked',
    );

    const phones = provider.sendMarketingBatch.mock.calls[0][0] as string[];
    expect(phones).toHaveLength(250);
    expect(phones[0]).toBe(mobileOf(0));

    const createdPhones = tx.smsBroadcastRecipient.createMany.mock.calls[0][0]
      .data as { phone: string }[];
    expect(createdPhones).toHaveLength(250);
  });

  it('无手机号的收件人被剔除，不计入 validMobileCount 与计费条数', async () => {
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(20, 5));

    const { quote } = await quoteAndBroadcast(
      Array.from({ length: 20 }, (_u, i) => String(i + 1)),
      '老顾客回馈',
      'idem_missing_phone',
    );

    expect(quote.recipientCount).toBe(20);
    expect(quote.validMobileCount).toBe(15);
    expect(quote.smsSegments).toBe(15);
    expect(quote.estimatedAmountFen).toBe(15 * UNIT_PRICE_FEN);

    const createdPhones = tx.smsBroadcastRecipient.createMany.mock.calls[0][0]
      .data as { phone: string }[];
    expect(createdPhones).toHaveLength(15);
  });

  it('发送失败自动退费：任务转 partial_failed 并触发退费，无需人工介入', async () => {
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(4));
    // 4 条里第 1 条受理失败
    provider.sendMarketingBatch.mockImplementation((phones: string[]) =>
      Promise.resolve(
        phones.map((phone, index) => ({
          phone,
          ok: index !== 0,
          code: index === 0 ? 'LimitExceeded' : 'Ok',
          message: index === 0 ? '号码数量超限' : null,
          requestId: 'req-test',
          serialNo: `sn-${index}`,
        })),
      ),
    );
    // 派发后按明细重新统计：3 成功 / 1 失败 / 0 未决
    prisma.smsBroadcastRecipient.groupBy.mockResolvedValue([
      { status: 'success', _count: { _all: 3 } },
      { status: 'failed', _count: { _all: 1 } },
    ]);

    await quoteAndBroadcast(
      ['1', '2', '3', '4'],
      '老顾客回馈',
      'idem_partial_failed',
    );

    expect(prisma.smsBroadcastTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'partial_failed',
          successCount: 3,
          failedCount: 1,
        }),
      }),
    );
    // 失败的钱自动退回商户，不再依赖运营人工操作
    expect(refundService.refundUndeliveredFailures).toHaveBeenCalledWith(777);
  });

  it('通道未给出明确结果的号码保持 pending：任务不转终态，等重发', async () => {
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(3));
    provider.sendMarketingBatch.mockImplementation((phones: string[]) =>
      Promise.resolve(
        phones.map((phone, index) => ({
          phone,
          ok: index !== 0,
          // 通道响应里缺了这条：发没发出去是未知的
          code: index === 0 ? SMS_NO_PROVIDER_STATUS_CODE : 'Ok',
          message: null,
          requestId: 'req-test',
          serialNo: null,
        })),
      ),
    );
    // 第 1 条没被写回状态（保持 pending），另 2 条成功
    prisma.smsBroadcastRecipient.groupBy.mockResolvedValue([
      { status: 'success', _count: { _all: 2 } },
      { status: 'pending', _count: { _all: 1 } },
    ]);

    await quoteAndBroadcast(['1', '2', '3'], '老顾客回馈', 'idem_unresolved');

    // 有未决明细 → 保持 sending，交给补偿任务重发
    expect(prisma.smsBroadcastTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'sending' }),
      }),
    );
    // 不确定就不能退钱（若其实发了就是白送）
    expect(refundService.refundUndeliveredFailures).not.toHaveBeenCalled();
  });

  describe('Serializable 写冲突（P2034）', () => {
    // 必须是真实的 PrismaClientKnownRequestError：service 用 instanceof 判定
    const buildPrismaError = (
      code: string,
    ): Prisma.PrismaClientKnownRequestError =>
      new Prisma.PrismaClientKnownRequestError(`mock ${code}`, {
        code,
        clientVersion: 'test',
      });

    it('并发写冲突时重试并成功，不会白白失败一次群发', async () => {
      prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(20));
      // 第一次事务被数据库以写冲突拒绝，第二次成功
      prisma.$transaction
        .mockRejectedValueOnce(buildPrismaError('P2034'))
        .mockImplementation((fn: (client: unknown) => unknown) => fn(tx));

      const ids = Array.from({ length: 20 }, (_u, i) => String(i + 1));
      await quoteAndBroadcast(ids, '老顾客回馈', 'idem_retry_p2034');

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(provider.sendMarketingBatch).toHaveBeenCalledTimes(1);
    });

    it('重试耗尽仍冲突时向上抛出，不静默吞掉', async () => {
      prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(20));
      prisma.$transaction.mockRejectedValue(buildPrismaError('P2034'));

      const ids = Array.from({ length: 20 }, (_u, i) => String(i + 1));
      const quote = await quoteService.createQuote(STORE_ID, {
        customerIds: ids,
        content: '老顾客回馈',
      });

      await expect(
        service.broadcast(STORE_ID, 1, {
          customerIds: ids,
          content: '老顾客回馈',
          quoteId: quote.quoteId,
          idempotencyKey: 'idem_retry_exhausted',
        }),
      ).rejects.toThrow();

      // 3 次上限，不做无限重试
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });

    it('余额不足不重试：重试一万次结果也一样', async () => {
      balanceFen = 50;
      prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(20));

      const ids = Array.from({ length: 20 }, (_u, i) => String(i + 1));
      const quote = await quoteService.createQuote(STORE_ID, {
        customerIds: ids,
        content: '老顾客回馈',
      });

      await expect(
        service.broadcast(STORE_ID, 1, {
          customerIds: ids,
          content: '老顾客回馈',
          quoteId: quote.quoteId,
          idempotencyKey: 'idem_no_retry',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  it('生产环境通道不可用：扣费前就拒绝，绝不先扣钱再假装成功', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'nodeEnv' ? 'production' : undefined,
    );
    provider.isChannelReady.mockReturnValue(false);
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(20));

    await expect(
      quoteAndBroadcast(
        Array.from({ length: 20 }, (_u, i) => String(i + 1)),
        '老顾客回馈',
        'idem_channel_down',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(provider.sendMarketingBatch).not.toHaveBeenCalled();
    expect(balanceFen).toBe(10_000);
  });

  it('幂等命中但首次未送达：补发未完成的收件人，且不重复扣费', async () => {
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(3));
    // 首次群发整体失败（钱已扣），跨页续发时用同一个 key 再次提交
    prisma.smsBroadcastTask.findUnique.mockResolvedValue({
      id: 777,
      storeId: STORE_ID,
      broadcastId: 'bc_failed',
      recipientCount: 3,
      chargedAmountFen: 15,
      status: 'failed',
      updatedAt: new Date(),
      content: '老顾客回馈',
      successCount: 0,
      failedCount: 3,
      dispatchAttempts: 1,
    });
    prisma.smsBroadcastRecipient.findMany.mockResolvedValue([
      { phone: mobileOf(0) },
      { phone: mobileOf(1) },
      { phone: mobileOf(2) },
    ]);

    const result = await service.broadcast(STORE_ID, 1, {
      customerIds: ['1', '2', '3'],
      content: '老顾客回馈',
      quoteId: 'qt_any',
      idempotencyKey: 'idem_resume',
    });

    expect(result).toEqual({
      broadcastId: 'bc_failed',
      recipientCount: 3,
      chargedAmountFen: 15,
    });
    // 不重复扣费
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // 补发一次，且只发给还没送达的人
    expect(provider.sendMarketingBatch).toHaveBeenCalledTimes(1);
    expect(provider.sendMarketingBatch.mock.calls[0][0]).toEqual([
      mobileOf(0),
      mobileOf(1),
      mobileOf(2),
    ]);
  });

  it('幂等命中且仍在途：不重复派发，避免同一批人收到两条', async () => {
    prisma.smsBroadcastTask.findUnique.mockResolvedValue({
      id: 777,
      storeId: STORE_ID,
      broadcastId: 'bc_sending',
      recipientCount: 3,
      chargedAmountFen: 15,
      status: 'sending',
      updatedAt: new Date(),
    });

    const result = await service.broadcast(STORE_ID, 1, {
      customerIds: ['1', '2', '3'],
      content: '老顾客回馈',
      quoteId: 'qt_any',
      idempotencyKey: 'idem_in_flight',
    });

    expect(result.broadcastId).toBe('bc_sending');
    expect(provider.sendMarketingBatch).not.toHaveBeenCalled();
  });

  it('sentSmsCount 只累加真实送达条数，不按计费条数虚高', async () => {
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(4));
    provider.sendMarketingBatch.mockImplementation((phones: string[]) =>
      Promise.resolve(
        phones.map((phone, index) => ({
          phone,
          ok: index !== 0,
          code: index === 0 ? 'LimitExceeded' : 'Ok',
          message: null,
          requestId: 'req-test',
        })),
      ),
    );
    // 第一次是幂等查询，第二次是派发后回读任务折算每人分段数
    prisma.smsBroadcastTask.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ smsSegments: 4, validMobileCount: 4 });

    await quoteAndBroadcast(
      ['1', '2', '3', '4'],
      '老顾客回馈',
      'idem_sent_count',
    );

    // 4 人各 1 段，成功 3 人 → 只累加 3
    expect(prisma.storeSmsAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sentSmsCount: { increment: 3 } }),
      }),
    );
  });

  it('售价高于成本时不告警（正常毛利）', async () => {
    // 售价 5 分、成本 3 分 → 每条赚 2 分
    config.get.mockImplementation((key: string) =>
      key === 'sms.costPriceFen' ? 3 : undefined,
    );
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(2));
    const errorSpy = jest.spyOn(
      (service as unknown as { logger: { error: jest.Mock } }).logger,
      'error',
    );

    await quoteAndBroadcast(['1', '2'], '老顾客回馈', 'idem_margin_ok');

    expect(
      errorSpy.mock.calls.every(
        (call) => !String(call[0]).includes('毛利倒挂'),
      ),
    ).toBe(true);
  });

  it('售价低于成本时打 ERROR 告警（发得越多亏得越多）', async () => {
    // 售价 5 分、成本 8 分 → 每条亏 3 分
    config.get.mockImplementation((key: string) =>
      key === 'sms.costPriceFen' ? 8 : undefined,
    );
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(2));
    const logger = (service as unknown as { logger: { error: jest.Mock } })
      .logger;
    const errorSpy = jest.spyOn(logger, 'error');

    await quoteAndBroadcast(['1', '2'], '老顾客回馈', 'idem_margin_bad');

    expect(
      errorSpy.mock.calls.some((call) => String(call[0]).includes('毛利倒挂')),
    ).toBe(true);
  });

  it('未配置成本价时不告警', async () => {
    prisma.marketingCustomer.findMany.mockResolvedValue(buildCustomers(2));
    const logger = (service as unknown as { logger: { error: jest.Mock } })
      .logger;
    const errorSpy = jest.spyOn(logger, 'error');

    await quoteAndBroadcast(['1', '2'], '老顾客回馈', 'idem_no_cost');

    expect(
      errorSpy.mock.calls.some((call) => String(call[0]).includes('毛利倒挂')),
    ).toBe(false);
  });

  it('幂等键格式非法时直接 400', async () => {
    await expect(
      service.broadcast(STORE_ID, 1, {
        customerIds: ['1'],
        content: 'hi',
        quoteId: 'qt_x',
        idempotencyKey: 'bad key!',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
