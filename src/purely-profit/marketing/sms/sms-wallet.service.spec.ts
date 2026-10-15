import { PrismaService } from '../../../prisma/prisma.service';
import { SmsAccountService } from './sms-account.service';
import { SmsWalletService } from './sms-wallet.service';

const STORE_ID = 18;

describe('SmsWalletService', () => {
  let service: SmsWalletService;
  let accountService: {
    getAccount: jest.Mock;
    resolveUnitPriceFen: jest.Mock;
    resolveWarningThresholdFen: jest.Mock;
    resolveRechargeTiers: jest.Mock;
  };
  let prisma: {
    smsWalletLog: { findMany: jest.Mock; count: jest.Mock };
  };

  beforeEach(() => {
    accountService = {
      getAccount: jest.fn().mockResolvedValue({
        id: 1,
        storeId: STORE_ID,
        balanceFen: 1200,
        totalRechargedFen: 5000,
        totalConsumedFen: 3800,
        sentSmsCount: 760,
      }),
      resolveUnitPriceFen: jest.fn().mockReturnValue(5),
      resolveWarningThresholdFen: jest.fn().mockReturnValue(500),
      resolveRechargeTiers: jest.fn().mockReturnValue([
        { amountFen: 1000, amountDisplay: '¥10' },
        { amountFen: 5000, amountDisplay: '¥50' },
      ]),
    };
    prisma = {
      smsWalletLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 2,
            type: 'consume',
            changeFen: -25,
            balanceAfterFen: 1200,
            description: '群发短信扣费',
            createdAt: new Date('2026-10-15T00:00:00.000Z'),
          },
          {
            id: 1,
            type: 'recharge',
            changeFen: 1000,
            balanceAfterFen: 1225,
            description: '微信充值 ¥10',
            createdAt: new Date('2026-10-14T00:00:00.000Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(42),
      },
    };

    service = new SmsWalletService(
      prisma as unknown as PrismaService,
      accountService as unknown as SmsAccountService,
    );
  });

  it('概览返回前端要的 6 个字段', async () => {
    const wallet = await service.getWallet(STORE_ID);

    expect(wallet).toEqual({
      balanceFen: 1200,
      unitPriceFen: 5,
      warningThresholdFen: 500,
      totalRechargedFen: 5000,
      totalConsumedFen: 3800,
      sentSmsCount: 760,
    });
  });

  it('档位由后端下发展示文案，且不含任何赠送字段', () => {
    const tiers = service.getRechargeTiers();

    expect(tiers.tiers).toEqual([
      { amountFen: 1000, amountDisplay: '¥10' },
      { amountFen: 5000, amountDisplay: '¥50' },
    ]);
    // 赠送由 purelyPulse 侧发放计入 grant 流水，档位里不能出现 bonus
    for (const tier of tiers.tiers) {
      expect(tier).not.toHaveProperty('bonus');
    }
  });

  it('流水按时间倒序分页，createdAt 传 ISO 字符串（前端自行格式化上海时间）', async () => {
    const logs = await service.listWalletLogs(STORE_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(logs.items).toHaveLength(2);
    expect(logs.items[0]).toEqual({
      id: 2,
      type: 'consume',
      changeFen: -25,
      balanceAfterFen: 1200,
      description: '群发短信扣费',
      createdAt: '2026-10-15T00:00:00.000Z',
    });
    expect(logs.meta).toEqual({
      page: 1,
      pageSize: 20,
      total: 42,
      totalPages: 3,
    });
    expect(prisma.smsWalletLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: STORE_ID },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('页大小超过上限时被钳制（与营销域分页口径一致）', async () => {
    const logs = await service.listWalletLogs(STORE_ID, {
      page: 1,
      pageSize: 9999,
    });

    expect(logs.meta.pageSize).toBe(200);
  });

  it('未知流水类型兜底为 admin_adjust，不把 null 透给前端', async () => {
    prisma.smsWalletLog.findMany.mockResolvedValue([
      {
        id: 3,
        type: 'some_future_type',
        changeFen: 100,
        balanceAfterFen: 1300,
        description: '未来新增类型',
        createdAt: new Date('2026-10-15T00:00:00.000Z'),
      },
    ]);

    const logs = await service.listWalletLogs(STORE_ID, { page: 1 });

    expect(logs.items[0].type).toBe('admin_adjust');
  });
});
