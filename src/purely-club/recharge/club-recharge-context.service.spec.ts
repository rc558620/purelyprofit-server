import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubRechargeContextService } from './club-recharge-context.service';

describe('ClubRechargeContextService', () => {
  let service: ClubRechargeContextService;

  const prismaService = {
    marketingCustomer: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubRechargeContextService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<ClubRechargeContextService>(ClubRechargeContextService);
  });

  it('已绑定档案时直接复用，不再查孤儿', async () => {
    prismaService.marketingCustomer.findFirst.mockResolvedValue({ id: 36 });

    await expect(
      service.requireCurrentCustomer(11, 301, '13800138000'),
    ).resolves.toEqual({ id: 36 });

    expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledWith({
      where: { storeId: 11, clubUserId: 301, deletedAt: null },
      select: { id: true },
    });
    expect(prismaService.marketingCustomer.upsert).not.toHaveBeenCalled();
  });

  it('命中同号孤儿档案时认领并落上 clubUserId', async () => {
    prismaService.marketingCustomer.findFirst
      .mockResolvedValueOnce(null) // 稳定键未命中
      .mockResolvedValueOnce({ id: 88 }); // 孤儿档案
    prismaService.marketingCustomer.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.requireCurrentCustomer(11, 301, '13800138000'),
    ).resolves.toEqual({ id: 88 });

    // 认领必须写 clubUserId：否则换绑手机号时 syncPhoneAcrossProfiles
    // 只按 clubUserId 定位会整店漏同步，用户当场失去这家门店
    expect(prismaService.marketingCustomer.updateMany).toHaveBeenCalledWith({
      where: { id: 88, clubUserId: null },
      data: { clubUserId: 301 },
    });
    expect(prismaService.marketingCustomer.upsert).not.toHaveBeenCalled();
  });

  it('认领被并发抢走时回退到 upsert 建档（不撞唯一索引）', async () => {
    prismaService.marketingCustomer.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 88 });
    // 并发写入让认领命中 0 行
    prismaService.marketingCustomer.updateMany.mockResolvedValue({ count: 0 });
    prismaService.user.findUnique.mockResolvedValue({
      name: '张三',
      wechatPhone: '13800138000',
    });
    prismaService.marketingCustomer.upsert.mockResolvedValue({ id: 99 });

    await expect(
      service.requireCurrentCustomer(11, 301, '13800138000'),
    ).resolves.toEqual({ id: 99 });

    expect(prismaService.marketingCustomer.upsert).toHaveBeenCalledWith({
      where: { storeId_clubUserId: { storeId: 11, clubUserId: 301 } },
      create: {
        storeId: 11,
        clubUserId: 301,
        name: '张三',
        phone: '13800138000',
      },
      update: {},
      select: { id: true },
    });
  });

  it('无绑定也无孤儿时 upsert 建档', async () => {
    prismaService.marketingCustomer.findFirst.mockResolvedValue(null);
    prismaService.user.findUnique.mockResolvedValue({
      name: null,
      wechatPhone: null,
    });
    prismaService.marketingCustomer.upsert.mockResolvedValue({ id: 100 });

    await expect(
      service.requireCurrentCustomer(11, 301, 'club_wechat:oOPENID123'),
    ).resolves.toEqual({ id: 100 });

    expect(prismaService.marketingCustomer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          name: 'Club 顾客',
          phone: null,
        }),
      }),
    );
  });
});
