import { NotFoundException } from '@nestjs/common';
import { EmployeeShiftType, HandoverStatus, Prisma } from '@prisma/client';
import { setupHandoverRecordsSpec } from './handover-records.spec-helpers';

describe('HandoverRecordsService - 详情与摘要', () => {
  const ctx = setupHandoverRecordsSpec();
  const { prismaService, ownerUser, mockRecord } = ctx;

  describe('getHandoverRecord', () => {
    it('成功获取单条记录', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(mockRecord);
      prismaService.employeeShift.findMany.mockResolvedValue([
        {
          employeeId: 10,
          employeeName: '老板',
          shiftType: EmployeeShiftType.morning,
          shiftName: '早班',
          startTime: '09:00',
          endTime: '17:00',
        },
      ]);

      const result = await ctx.service.getHandoverRecord(ownerUser, 1);

      expect(result.id).toBe(1);
      expect(result.shiftInfo).toMatchObject({
        operatorName: '老板',
        shiftType: EmployeeShiftType.morning,
        shiftLabel: '早班',
      });
      expect(result.additionalItems).toEqual([]);
      expect(result.revenueSummary).toMatchObject({
        totalRevenue: 0,
        orderCount: 0,
      });
      expect(result.paymentItems).toEqual([]);
      expect(result.orderItems).toEqual([]);
    });

    it('记录缺少 fromEmployeeId 时也应按当天已完成顺序还原班次信息', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue({
        ...mockRecord,
        id: 2,
        fromEmployeeId: null,
        fromEmployee: null,
        actorStaffId: 2,
        status: HandoverStatus.completed,
        handoverAt: new Date('2026-06-04T11:10:28.523Z'),
        createdAt: new Date('2026-06-04T11:10:28.601Z'),
        additionalValues: [
          {
            id: 11,
            itemId: 101,
            value: '534535',
            createdAt: new Date('2026-06-04T11:10:28.601Z'),
            updatedAt: new Date('2026-06-04T11:10:28.601Z'),
            item: { id: 101, name: '交接备注' },
          },
        ],
      });
      prismaService.employeeShift.findMany.mockResolvedValue([
        {
          employeeId: 1,
          employeeName: '收银员1',
          shiftType: EmployeeShiftType.morning,
          shiftName: '早班',
          startTime: '09:00',
          endTime: '19:10',
        },
        {
          employeeId: 2,
          employeeName: '收银员2',
          shiftType: EmployeeShiftType.late,
          shiftName: '晚班',
          startTime: '17:00',
          endTime: '23:00',
        },
      ]);
      prismaService.storeHandoverRecord.findMany.mockResolvedValue([{ id: 2 }]);
      prismaService.employee.findUnique.mockResolvedValueOnce({
        linkedStaffId: 2,
        avatar: 'https://cdn.example.com/cashier-1.png',
        linkedStaff: {
          user: {
            avatar: 'https://cdn.example.com/user-cashier-1.png',
          },
        },
      });
      prismaService.saleOrderItem.findMany.mockResolvedValue([
        {
          id: 21,
          productName: '台位费（1分钟）',
          salePrice: new Prisma.Decimal('555.00'),
          quantity: 1,
          product: null,
          order: {
            id: 8,
            date: new Date('2026-06-04T11:00:00.000Z'),
            paymentMethod: 'wechat',
            spaceSession: null,
          },
        },
      ]);
      prismaService.saleOrder.count.mockResolvedValue(1);
      prismaService.saleOrder.aggregate
        .mockResolvedValueOnce({
          _sum: { totalRevenue: new Prisma.Decimal('555.00') },
        })
        .mockResolvedValueOnce({
          _sum: { totalRevenue: null },
        });

      const result = await ctx.service.getHandoverRecord(ownerUser, 2);

      expect(result.shiftInfo).toMatchObject({
        operatorName: '收银员1',
        operatorAvatar: 'https://cdn.example.com/cashier-1.png',
        avatar: 'https://cdn.example.com/cashier-1.png',
        shiftType: EmployeeShiftType.morning,
        shiftLabel: '早班',
        startTime: '09:00',
        endTime: '19:10',
      });
      expect(result.additionalItems).toEqual([
        expect.objectContaining({
          itemId: 101,
          itemName: '交接备注',
          value: '534535',
        }),
      ]);
      expect(result.revenueSummary).toMatchObject({
        totalRevenue: 555,
        additionalRevenue: 555,
        orderCount: 1,
      });
      expect(result.paymentItems).toEqual([
        expect.objectContaining({
          method: 'wechat',
          amount: 555,
          ratio: 1,
        }),
      ]);
      expect(result.orderItems).toEqual([
        expect.objectContaining({
          id: '21',
          productName: '台位费（1分钟）',
          totalRevenue: 555,
        }),
      ]);
      expect(prismaService.saleOrder.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            operatorStaffId: 2,
          }),
        }),
      );
    });

    it('班次超时后才交班时详情仍应统计超时阶段新增的消费', async () => {
      const overdueHandoverAt = new Date(2026, 5, 4, 20, 30, 0);
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue({
        ...mockRecord,
        id: 3,
        fromEmployeeId: 10,
        actorStaffId: 101,
        status: HandoverStatus.completed,
        handoverAt: overdueHandoverAt,
        createdAt: overdueHandoverAt,
        additionalValues: [],
      });
      prismaService.employeeShift.findMany.mockResolvedValue([
        {
          employeeId: 10,
          employeeName: '收银员1',
          shiftType: EmployeeShiftType.morning,
          shiftName: '早班',
          startTime: '09:00',
          endTime: '18:00',
        },
      ]);
      prismaService.storeHandoverRecord.findMany.mockResolvedValue([{ id: 3 }]);
      prismaService.employee.findUnique.mockResolvedValueOnce({
        linkedStaffId: 101,
        avatar: 'https://cdn.example.com/cashier-1.png',
        linkedStaff: {
          user: {
            avatar: 'https://cdn.example.com/user-cashier-1.png',
          },
        },
      });
      prismaService.saleOrderItem.findMany.mockResolvedValue([
        {
          id: 31,
          productName: '加钟费用',
          salePrice: new Prisma.Decimal('88.00'),
          quantity: 1,
          product: null,
          order: {
            id: 18,
            date: new Date('2026-06-04T20:10:00.000Z'),
            paymentMethod: 'cash',
            spaceSession: null,
          },
        },
      ]);
      prismaService.saleOrder.count.mockResolvedValue(1);
      prismaService.saleOrder.aggregate
        .mockResolvedValueOnce({
          _sum: { totalRevenue: new Prisma.Decimal('88.00') },
        })
        .mockResolvedValueOnce({
          _sum: { totalRevenue: null },
        });

      const result = await ctx.service.getHandoverRecord(ownerUser, 3);

      expect(result.revenueSummary).toMatchObject({
        totalRevenue: 88,
        additionalRevenue: 88,
        orderCount: 1,
      });
      expect(prismaService.saleOrder.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            operatorStaffId: 101,
            date: {
              gte: new Date(2026, 5, 4, 9, 0, 0),
              lte: overdueHandoverAt,
            },
          }),
        }),
      );
    });

    it('排班被删除后仍应优先使用交班记录快照还原详情', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue({
        ...mockRecord,
        id: 4,
        fromEmployeeId: 20,
        fromEmployee: null,
        actorStaffId: 2,
        status: HandoverStatus.completed,
        handoverAt: new Date(2026, 5, 5, 17, 5, 0),
        createdAt: new Date(2026, 5, 5, 17, 5, 0),
        fromEmployeeNameSnapshot: '收银员1',
        shiftTypeSnapshot: EmployeeShiftType.custom,
        shiftNameSnapshot: '新早班',
        shiftStartTimeSnapshot: '16:01',
        shiftEndTimeSnapshot: '17:03',
        additionalValues: [],
      });
      prismaService.employee.findUnique.mockResolvedValueOnce({
        linkedStaffId: 2,
        avatar: 'https://cdn.example.com/cashier-1.png',
        linkedStaff: {
          user: {
            avatar: 'https://cdn.example.com/user-cashier-1.png',
          },
        },
      });
      prismaService.saleOrder.count.mockResolvedValue(1);
      prismaService.saleOrder.aggregate
        .mockResolvedValueOnce({
          _sum: { totalRevenue: new Prisma.Decimal('567.00') },
        })
        .mockResolvedValueOnce({
          _sum: { totalRevenue: null },
        });
      prismaService.saleOrderItem.findMany.mockResolvedValue([
        {
          id: 41,
          productName: '台位费（1分钟）',
          salePrice: new Prisma.Decimal('567.00'),
          quantity: 1,
          product: null,
          order: {
            id: 28,
            date: new Date(2026, 5, 5, 16, 55, 0),
            paymentMethod: 'wechat',
            spaceSession: null,
          },
        },
      ]);

      const result = await ctx.service.getHandoverRecord(ownerUser, 4);

      expect(result.shiftInfo).toMatchObject({
        operatorName: '收银员1',
        operatorAvatar: 'https://cdn.example.com/cashier-1.png',
        shiftType: EmployeeShiftType.custom,
        shiftLabel: '新早班',
        startTime: '16:01',
        endTime: '17:03',
      });
      expect(result.revenueSummary).toMatchObject({
        totalRevenue: 567,
        additionalRevenue: 567,
        orderCount: 1,
      });
      expect(prismaService.employeeShift.findMany).not.toHaveBeenCalled();
      expect(prismaService.saleOrder.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            operatorStaffId: 2,
            date: {
              gte: new Date(2026, 5, 5, 16, 1, 0),
              lte: new Date(2026, 5, 5, 17, 5, 0),
            },
          }),
        }),
      );
    });

    it('记录不存在应抛出 NotFoundException', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(null);

      await expect(
        ctx.service.getHandoverRecord(ownerUser, 999),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listHandoverRecordSummaries', () => {
    it('返回交班记录弹窗摘要列表', async () => {
      prismaService.storeHandoverRecord.findMany.mockResolvedValue([
        {
          ...mockRecord,
          status: HandoverStatus.completed,
          handoverAt: new Date(2026, 5, 5, 17, 0, 0),
        },
      ]);
      prismaService.storeHandoverRecord.count.mockResolvedValue(1);
      prismaService.employeeShift.findMany.mockResolvedValue([
        {
          employeeId: 10,
          employeeName: '老板',
          shiftType: EmployeeShiftType.morning,
          shiftName: '早班',
          startTime: '09:00',
          endTime: '17:00',
        },
      ]);
      prismaService.employee.findUnique.mockResolvedValueOnce({
        linkedStaffId: 1,
        avatar: 'https://cdn.example.com/owner.png',
        linkedStaff: {
          user: {
            avatar: 'https://cdn.example.com/user-owner.png',
          },
        },
      });
      prismaService.saleOrder.aggregate
        .mockResolvedValueOnce({
          _sum: { totalRevenue: new Prisma.Decimal('1004.65') },
        })
        .mockResolvedValueOnce({
          _sum: { totalRevenue: null },
        });

      const result = await ctx.service.listHandoverRecordSummaries(ownerUser, {
        preset: 'today',
        limit: 20,
        offset: 0,
      });

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 1,
        operatorName: '老板',
        operatorAvatar: 'https://cdn.example.com/owner.png',
        avatar: 'https://cdn.example.com/owner.png',
        shiftType: EmployeeShiftType.morning,
        shiftLabel: '早班',
        totalRevenue: 1004.65,
        displayStatus: 'done',
      });
      expect(result.items[0].timeDesc).toContain('09:00–17:00');
      expect(prismaService.storeHandoverRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            storeId: 100,
            status: HandoverStatus.completed,
            createdAt: expect.any(Object),
          }),
          take: 20,
          skip: 0,
        }),
      );
    });

    it('排班被删除后摘要列表也应展示交班时的快照班次', async () => {
      prismaService.storeHandoverRecord.findMany.mockResolvedValue([
        {
          ...mockRecord,
          id: 5,
          fromEmployeeId: 20,
          fromEmployee: null,
          actorStaffId: 2,
          status: HandoverStatus.completed,
          handoverAt: new Date(2026, 5, 5, 17, 5, 0),
          createdAt: new Date(2026, 5, 5, 17, 5, 0),
          fromEmployeeNameSnapshot: '收银员1',
          shiftTypeSnapshot: EmployeeShiftType.custom,
          shiftNameSnapshot: '新早班',
          shiftStartTimeSnapshot: '16:01',
          shiftEndTimeSnapshot: '17:03',
          additionalValues: [],
        },
      ]);
      prismaService.storeHandoverRecord.count.mockResolvedValue(1);
      prismaService.employee.findUnique.mockResolvedValueOnce({
        linkedStaffId: 2,
        avatar: 'https://cdn.example.com/cashier-1.png',
        linkedStaff: {
          user: {
            avatar: 'https://cdn.example.com/user-cashier-1.png',
          },
        },
      });
      prismaService.saleOrder.aggregate
        .mockResolvedValueOnce({
          _sum: { totalRevenue: new Prisma.Decimal('567.00') },
        })
        .mockResolvedValueOnce({
          _sum: { totalRevenue: null },
        });

      const result = await ctx.service.listHandoverRecordSummaries(ownerUser, {
        date: '2026-06-05',
      });

      expect(result.items[0]).toMatchObject({
        id: 5,
        operatorName: '收银员1',
        operatorAvatar: 'https://cdn.example.com/cashier-1.png',
        shiftType: EmployeeShiftType.custom,
        shiftLabel: '新早班',
        startTime: '16:01',
        endTime: '17:03',
        totalRevenue: 567,
      });
      expect(result.items[0].timeDesc).toContain('16:01–17:03');
      expect(prismaService.employeeShift.findMany).not.toHaveBeenCalled();
    });

    it('未完成交班不应进入历史摘要列表', async () => {
      prismaService.storeHandoverRecord.findMany.mockResolvedValue([]);
      prismaService.storeHandoverRecord.count.mockResolvedValue(0);

      await ctx.service.listHandoverRecordSummaries(ownerUser, {
        preset: 'today',
      });

      expect(prismaService.storeHandoverRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: HandoverStatus.completed,
          }),
        }),
      );
    });

    it('指定 date 时优先按日期过滤', async () => {
      prismaService.storeHandoverRecord.findMany.mockResolvedValue([]);
      prismaService.storeHandoverRecord.count.mockResolvedValue(0);

      await ctx.service.listHandoverRecordSummaries(ownerUser, {
        preset: '30d',
        date: '2026-06-02',
      });

      expect(prismaService.storeHandoverRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: new Date(2026, 5, 2, 0, 0, 0, 0),
              lte: new Date(2026, 5, 2, 23, 59, 59, 999),
            }),
          }),
        }),
      );
    });
  });
});
