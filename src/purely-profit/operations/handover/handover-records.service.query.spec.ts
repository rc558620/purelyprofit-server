import { setupHandoverRecordsSpec } from './handover-records.spec-helpers';

describe('HandoverRecordsService - 查询接口', () => {
  const ctx = setupHandoverRecordsSpec();
  const {
    prismaService,
    storeSubAccountService,
    ownerUser,
    mockRecord,
    mockCandidates,
  } = ctx;

  describe('listHandoverRecords', () => {
    it('成功获取交班记录列表', async () => {
      const records = [mockRecord];
      prismaService.storeHandoverRecord.findMany.mockResolvedValue(records);
      prismaService.storeHandoverRecord.count.mockResolvedValue(1);

      const result = await ctx.service.listHandoverRecords(ownerUser, 10, 0);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(prismaService.storeHandoverRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId: 100 },
          take: 10,
          skip: 0,
        }),
      );
    });
  });

  describe('getHandoverCandidates', () => {
    it('成功获取候选人列表', async () => {
      storeSubAccountService.listAssignableHandoverCandidates.mockResolvedValue(
        mockCandidates,
      );

      const result = await ctx.service.getHandoverCandidates(100);

      expect(result).toHaveLength(2);
      expect(result[0].employeeId).toBe(20);
      expect(result[1].employeeId).toBe(30);
    });
  });

  describe('getMyPendingHandover', () => {
    it('成功获取当前用户待处理的交班', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(mockRecord);

      const result = await ctx.service.getMyPendingHandover(ownerUser);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(1);
      expect(prismaService.storeHandoverRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ fromEmployeeId: 10 }, { toEmployeeId: 10 }],
          }),
        }),
      );
    });

    it('无待处理交班时返回 null', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(null);

      const result = await ctx.service.getMyPendingHandover(ownerUser);

      expect(result).toBeNull();
    });

    it('用户无关联员工时返回 null', async () => {
      const userWithoutEmployee = {
        ...ownerUser,
        currentMembership: {
          ...ownerUser.currentMembership!,
          linkedEmployeeId: null,
        },
      };

      const result =
        await ctx.service.getMyPendingHandover(userWithoutEmployee);

      expect(result).toBeNull();
    });
  });
});
