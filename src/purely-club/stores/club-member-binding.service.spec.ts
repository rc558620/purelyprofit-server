import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubMemberBindingService } from './club-member-binding.service';

/**
 * 入店建档的两个关键字段。
 *
 * 核心风险：`club_user_id` 缺失会让顾客档案只靠手机号关联，而换绑手机号
 * （ClubAuthService.syncPhoneAcrossProfiles）恰恰**只按 clubUserId 定位** ——
 * 漏写等于这家店在换绑时被整店跳过。因此这里逐条锁定 clubUserId 的写入条件。
 */
describe('ClubMemberBindingService', () => {
  let service: ClubMemberBindingService;

  const prismaService = {
    member: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    marketingCustomer: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaService) => Promise<unknown>) =>
        callback(prismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubMemberBindingService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get(ClubMemberBindingService);
  });

  it('可正常注入依赖', () => {
    expect(service).toBeDefined();
  });

  it('新建档案时写入 clubUserId', async () => {
    prismaService.member.findFirst.mockResolvedValue(null);
    prismaService.member.create.mockResolvedValue({ id: 1 });
    prismaService.marketingCustomer.findFirst.mockResolvedValue(null);
    prismaService.marketingCustomer.create.mockResolvedValue({ id: 2 });

    await service.upsertMemberAndCustomer(18, '13800138000', '俱乐部用户', 42);

    expect(prismaService.marketingCustomer.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '俱乐部用户',
        phone: '13800138000',
        clubUserId: 42,
      },
    });
  });

  it('既有档案缺 clubUserId 时补齐，否则换绑会漏掉这家店', async () => {
    prismaService.member.findFirst.mockResolvedValue({ id: 10 });
    // 按 clubUserId 查不到 —— 正是缺失 club_user_id 的历史档案
    prismaService.marketingCustomer.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        'clubUserId' in (args.where ?? {})
          ? null
          : { id: 20, phone: '13800138000', clubUserId: null },
    );

    await service.upsertMemberAndCustomer(18, '13800138000', '俱乐部用户', 42);

    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: {
        name: '俱乐部用户',
        // phone 已有真实值，绝不覆盖
        clubUserId: 42,
      },
    });
  });

  it('档案已归属其他 club 用户时不动 clubUserId，避免抢绑他人档案', async () => {
    prismaService.member.findFirst.mockResolvedValue({ id: 10 });
    prismaService.marketingCustomer.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        'clubUserId' in (args.where ?? {})
          ? null
          : { id: 20, phone: '13800138000', clubUserId: 99 },
    );

    await service.upsertMemberAndCustomer(18, '13800138000', '俱乐部用户', 42);

    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { name: '俱乐部用户' },
    });
  });

  it('未传 clubUserId 时保持原行为：只改名，不写 clubUserId', async () => {
    prismaService.member.findFirst.mockResolvedValue({ id: 10 });
    prismaService.marketingCustomer.findFirst.mockResolvedValue({
      id: 20,
      phone: '13800138000',
      clubUserId: null,
    });

    await service.upsertMemberAndCustomer(18, '13800138000', '俱乐部用户');

    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { name: '俱乐部用户' },
    });
  });

  it('phone 为 null 的旧档案：补齐 phone 的同时写入 clubUserId', async () => {
    prismaService.member.findFirst.mockResolvedValue({ id: 10 });
    prismaService.marketingCustomer.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        'clubUserId' in (args.where ?? {})
          ? null
          : { id: 20, phone: null, clubUserId: null },
    );

    await service.upsertMemberAndCustomer(18, '13800138000', '俱乐部用户', 42);

    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { name: '俱乐部用户', phone: '13800138000', clubUserId: 42 },
    });
  });
});
