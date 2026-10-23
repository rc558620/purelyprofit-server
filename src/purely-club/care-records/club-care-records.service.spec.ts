import { Test, TestingModule } from '@nestjs/testing';
import { MARKETING_MAX_PAGE_SIZE } from '../../purely-profit/marketing/marketing.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubMemberProfileService } from '../member/member-profile/club-member-profile.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubCareRecordsService } from './club-care-records.service';

const CARE_ROW = {
  id: 35,
  customerId: 55,
  sessionId: 900,
  seq: 2,
  visitAt: new Date(1_761_100_000_000),
  serviceName: '深层清洁',
  amountCents: 29_850,
  content: '本次做了深层清洁',
  photos: ['https://cdn.example.com/1.jpg'],
  technicianName: '李技师',
  updatedAt: new Date(1_761_100_360_000),
};

/** 最早一次有照片的护理：第 1 页通常已翻不到它，只能靠 compareRange 下发 */
const EARLIEST_PHOTO_ROW = {
  ...CARE_ROW,
  id: 12,
  seq: 1,
  visitAt: new Date(1_700_000_000_000),
  photos: ['https://cdn.example.com/earliest.jpg'],
};

/** 默认按「SPA/养生/美容」模式门店（已开通护理档案）构造上下文 */
const buildContext = (memberCareEnabled = true): ClubCurrentContext =>
  ({
    user: { id: 201, phone: '13800138000' },
    store: { id: 11, memberCareEnabled },
  }) as unknown as ClubCurrentContext;

describe('ClubCareRecordsService', () => {
  let service: ClubCareRecordsService;

  const prismaService = {
    careRecord: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
  };
  const clubMemberProfileService = {
    getSnapshotByStoreIdentity: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubCareRecordsService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: ClubMemberProfileService,
          useValue: clubMemberProfileService,
        },
      ],
    }).compile();

    service = module.get<ClubCareRecordsService>(ClubCareRecordsService);

    prismaService.careRecord.findFirst.mockResolvedValue(null);
  });

  it('身份认领走两层锚定（storeId + clubUserId + phone）', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
      memberId: 3,
    });
    prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
    prismaService.careRecord.count.mockResolvedValue(1);

    await service.list(buildContext());

    expect(
      clubMemberProfileService.getSnapshotByStoreIdentity,
    ).toHaveBeenCalledWith(11, 201, '13800138000');
    expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 11, customerId: 55 },
        orderBy: [{ visitAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('默认取第 1 页（每页 10 条，skip 0）并返回分页元信息', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
    });
    prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
    prismaService.careRecord.count.mockResolvedValue(23);

    const result = await service.list(buildContext());

    expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 10 }),
    );
    expect(result.meta).toEqual({
      page: 1,
      pageSize: 10,
      total: 23,
      totalPages: 3,
    });
  });

  it('翻页按页码换算 skip，且不再计算对比首尾', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
    });
    prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
    prismaService.careRecord.count.mockResolvedValue(23);

    const result = await service.list(buildContext(), {
      page: 3,
      pageSize: 10,
    });

    expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(result.compareRange).toBeUndefined();
    expect(prismaService.careRecord.findFirst).not.toHaveBeenCalled();
  });

  it('响应只含会员可见字段，不含 customerId 等商家内部字段', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
    });
    prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
    prismaService.careRecord.count.mockResolvedValue(1);

    const result = await service.list(buildContext());

    expect(Object.keys(result.items[0]).sort()).toEqual([
      'amountYuan',
      'content',
      'id',
      'photos',
      'seq',
      'serviceName',
      'technicianName',
      'visitAt',
    ]);
    expect(result.meta.total).toBe(1);
  });

  it('第 1 页下发对比首尾（最早 / 最近一次有照片的护理）', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
    });
    prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
    prismaService.careRecord.count.mockResolvedValue(1);
    prismaService.careRecord.findFirst
      .mockResolvedValueOnce(EARLIEST_PHOTO_ROW)
      .mockResolvedValueOnce(CARE_ROW);

    const result = await service.list(buildContext());

    expect(prismaService.careRecord.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaService.careRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 11, customerId: 55, photos: { isEmpty: false } },
        orderBy: [{ visitAt: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(result.compareRange?.earliest?.id).toBe('12');
    expect(result.compareRange?.latest?.id).toBe('35');
  });

  it('只有一条有照片的记录时首尾指向同一条（不错位）', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
    });
    prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
    prismaService.careRecord.count.mockResolvedValue(1);
    // 两个 findFirst 都只命中同一条：earliest === latest，映射后必须仍是同一条
    prismaService.careRecord.findFirst.mockResolvedValue(EARLIEST_PHOTO_ROW);

    const result = await service.list(buildContext());

    expect(result.compareRange?.earliest?.id).toBe('12');
    expect(result.compareRange?.latest?.id).toBe('12');
  });

  it('对比首尾同样只含会员可见字段（隐私口径与 items 一致）', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
    });
    prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
    prismaService.careRecord.count.mockResolvedValue(1);
    prismaService.careRecord.findFirst
      .mockResolvedValueOnce(EARLIEST_PHOTO_ROW)
      .mockResolvedValueOnce(CARE_ROW);

    const result = await service.list(buildContext());

    const earliestKeys = Object.keys(
      result.compareRange?.earliest ?? {},
    ).sort();
    expect(earliestKeys).toEqual([
      'amountYuan',
      'content',
      'id',
      'photos',
      'seq',
      'serviceName',
      'technicianName',
      'visitAt',
    ]);
    expect(result.compareRange?.earliest).not.toHaveProperty('customerId');
    expect(result.compareRange?.earliest).not.toHaveProperty('sessionId');
  });

  it('total 与 items 同口径：count 与 findMany 收到同一个 where', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
    });
    prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
    prismaService.careRecord.count.mockResolvedValue(23);

    await service.list(buildContext());

    const findManyWhere =
      prismaService.careRecord.findMany.mock.calls[0][0].where;
    const countWhere = prismaService.careRecord.count.mock.calls[0][0].where;
    expect(countWhere).toEqual(findManyWhere);
    // 分页 where 不含照片过滤：total 是全量护理次数，不是「有照片的次数」
    expect(countWhere).not.toHaveProperty('photos');
  });

  it('page 非法（0 / 负数 / undefined）时归一为第 1 页', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
    });
    prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
    prismaService.careRecord.count.mockResolvedValue(23);

    for (const page of [undefined, 0, -3]) {
      prismaService.careRecord.findMany.mockClear();
      const result = await service.list(buildContext(), { page });

      expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
      expect(result.meta.page).toBe(1);
    }
  });

  it('pageSize 超上限时钳制到 MARKETING_MAX_PAGE_SIZE', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
    });
    prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
    prismaService.careRecord.count.mockResolvedValue(1);

    // DTO 层有 @Max(200)，service 是唯一真兜底：直接传 500 也必须被钳制
    const result = await service.list(buildContext(), { pageSize: 500 });

    expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: MARKETING_MAX_PAGE_SIZE }),
    );
    expect(result.meta.pageSize).toBe(MARKETING_MAX_PAGE_SIZE);
  });

  it('无照片记录参与对比时首尾均为 null', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
    });
    prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
    prismaService.careRecord.count.mockResolvedValue(1);

    const result = await service.list(buildContext());

    expect(result.compareRange).toEqual({ earliest: null, latest: null });
  });

  it('非本店会员（无顾客档案）返回空页，不查护理记录', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue(null);

    await expect(service.list(buildContext())).resolves.toEqual({
      items: [],
      compareRange: { earliest: null, latest: null },
      meta: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
    });
    expect(prismaService.careRecord.findMany).not.toHaveBeenCalled();
  });

  describe('会员护理档案档位门禁', () => {
    it('未开通门店直接 403，且不查护理记录', async () => {
      await expect(service.list(buildContext(false))).rejects.toThrow(
        '当前门店未开通护理档案',
      );
      expect(prismaService.careRecord.findMany).not.toHaveBeenCalled();
      expect(
        clubMemberProfileService.getSnapshotByStoreIdentity,
      ).not.toHaveBeenCalled();
    });

    it('档位缺失（旧缓存未带字段）按未开通处理', async () => {
      const legacyContext = {
        user: { id: 201, phone: '13800138000' },
        store: { id: 11 },
      } as unknown as ClubCurrentContext;

      await expect(service.list(legacyContext)).rejects.toThrow(
        '当前门店未开通护理档案',
      );
    });
  });
});
