import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubMemberBindingService } from './club-member-binding.service';

/**
 * 入店建档的两个关键字段。
 *
 * 核心风险：`club_user_id` 缺失会让顾客档案只靠手机号关联，而换绑手机号
 * （ClubPhoneRebindProfilesService.syncPhoneAcrossProfiles）恰恰**只按 clubUserId 定位** ——
 * 漏写等于这家店在换绑时被整店跳过。因此这里逐条锁定 clubUserId 的写入条件。
 *
 * 取数方式：按 (clubUserId OR phone) 一次查回候选档案，再在内存里按
 * 「已绑定优先、手机号兜底」定序，因此用例统一 mock `findMany` 的返回顺序。
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
      findMany: jest.fn(),
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
    prismaService.marketingCustomer.findMany.mockResolvedValue([]);
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
    // 按 clubUserId 查不到，只按手机号命中 —— 正是缺失 club_user_id 的历史档案
    prismaService.marketingCustomer.findMany.mockResolvedValue([
      { id: 20, phone: '13800138000', clubUserId: null },
    ]);

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
    prismaService.marketingCustomer.findMany.mockResolvedValue([
      { id: 20, phone: '13800138000', clubUserId: 99 },
    ]);

    await service.upsertMemberAndCustomer(18, '13800138000', '俱乐部用户', 42);

    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { name: '俱乐部用户' },
    });
  });

  it('已绑定档案与手机号历史档案并存时，优先命中已绑定档案', async () => {
    prismaService.member.findFirst.mockResolvedValue({ id: 10 });
    // 查询已按 clubUserId ASC（NULLS LAST）排序：已绑定档案在前
    prismaService.marketingCustomer.findMany.mockResolvedValue([
      { id: 30, phone: '13800138000', clubUserId: 42 },
      { id: 20, phone: '13800138000', clubUserId: null },
    ]);

    await service.upsertMemberAndCustomer(18, '13800138000', '新昵称', 42);

    expect(prismaService.marketingCustomer.update).toHaveBeenCalledTimes(1);
    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 30 },
      data: { name: '新昵称' },
    });
  });

  it('未传 clubUserId 时保持原行为：只改名，不写 clubUserId', async () => {
    prismaService.member.findFirst.mockResolvedValue({ id: 10 });
    prismaService.marketingCustomer.findMany.mockResolvedValue([
      { id: 20, phone: '13800138000', clubUserId: null },
    ]);

    await service.upsertMemberAndCustomer(18, '13800138000', '俱乐部用户');

    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { name: '俱乐部用户' },
    });
  });

  it('phone 为 null 且未绑定 clubUserId 的档案不会被手机号误认领，改走新建', async () => {
    prismaService.member.findFirst.mockResolvedValue({ id: 10 });
    prismaService.marketingCustomer.findMany.mockResolvedValue([
      { id: 20, phone: null, clubUserId: null },
    ]);
    prismaService.marketingCustomer.create.mockResolvedValue({ id: 2 });

    await service.upsertMemberAndCustomer(18, '13800138000', '俱乐部用户', 42);

    // 该行既不匹配 clubUserId 也不匹配手机号：按原语义不能认领，
    // 否则会把别人的档案改成本次入店的手机号。
    expect(prismaService.marketingCustomer.update).not.toHaveBeenCalled();
    expect(prismaService.marketingCustomer.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '俱乐部用户',
        phone: '13800138000',
        clubUserId: 42,
      },
    });
  });
});
