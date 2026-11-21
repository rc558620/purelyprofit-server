import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { SpacePrintSettingsService } from './space-print-settings.service';
import { SpacePrintDataService } from './space-print-data.service';
import { FeiePrintService } from '../scan-ordering/feie-print.service';
import { UsbPrintService } from '../scan-ordering/usb-print.service';
import { PrintAgentService } from '../scan-ordering/print-agent.service';
import { EscPosTicketBuilder } from '../scan-ordering/escpos-ticket.builder';
import { SpacePrintService } from './space-print.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/** 本文件固定门店与订单，锁键随之固定，便于断言按「任务」而非「订单」释放。 */
const STORE_ID = 9;
const SALE_ORDER_ID = 66;
const LOCK_KEY = `spaces:print-submit:${STORE_ID}:${SALE_ORDER_ID}`;

/** 商家用户（门店解析由 commerceAccess 替身接管）。 */
const user = { id: 1, name: '收银员' } as AuthenticatedUser;

describe('SpacePrintService 提交占位（防重复下发）', () => {
  let service: SpacePrintService;

  const prismaService = {
    store: { findUnique: jest.fn() },
    saleOrder: { findFirst: jest.fn() },
  };

  const redisService = {
    setIfAbsent: jest.fn(),
    evalScript: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  };
  const commerceAccessService = {
    resolveSingleStoreId: jest.fn().mockResolvedValue(STORE_ID),
    ensureCanAccessStore: jest.fn().mockResolvedValue(undefined),
  };
  const printSettingsService = { getByStoreId: jest.fn() };
  const printDataService = {
    loadOrder: jest.fn(),
    loadSalesReceiptOrder: jest.fn(),
    listRecentSettledOrders: jest.fn(),
  };
  const feiePrintService = { printMessage: jest.fn() };
  const usbPrintService = { printRaw: jest.fn() };
  const agentService = {
    isAgentBound: jest.fn(),
    findRecentActiveTask: jest.fn(),
    findLatestTask: jest.fn(),
    findTaskById: jest.fn(),
    dispatch: jest.fn(),
  };
  const ticketBuilder = { buildSpaceTicket: jest.fn(), buildTest: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    printSettingsService.getByStoreId.mockResolvedValue({
      spacePrintChannel: 'usb',
      spaceCloudPrinterSn: null,
      spaceUsbPrinter: '/dev/usb/lp0',
    });
    printDataService.loadOrder.mockResolvedValue({
      spaceName: 'A 包厢',
      guestName: '张三',
      guestCount: 2,
      items: [],
      operatorName: null,
    });
    prismaService.store.findUnique.mockResolvedValue({ name: '测试门店' });
    ticketBuilder.buildSpaceTicket.mockReturnValue(Buffer.from('ticket'));
    // 占位锁默认空闲：抢锁成功（浏览器与设备共用这一把锁）
    // 用 reset 而非 clear，避免上个用例的 mockResolvedValue(false) 泄漏到下个用例
    redisService.setIfAbsent.mockReset();
    redisService.setIfAbsent.mockResolvedValue(true);
    agentService.isAgentBound.mockResolvedValue(false);
    agentService.findRecentActiveTask.mockResolvedValue(null);
    agentService.findLatestTask.mockResolvedValue(null);
    agentService.findTaskById.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpacePrintService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: SpacePrintSettingsService, useValue: printSettingsService },
        { provide: SpacePrintDataService, useValue: printDataService },
        { provide: FeiePrintService, useValue: feiePrintService },
        { provide: UsbPrintService, useValue: usbPrintService },
        { provide: PrintAgentService, useValue: agentService },
        { provide: EscPosTicketBuilder, useValue: ticketBuilder },
      ],
    }).compile();
    service = module.get<SpacePrintService>(SpacePrintService);
  });

  it('下发成功后把锁值绑定为该任务 ID，便于后续按任务精确释放', async () => {
    redisService.setIfAbsent.mockResolvedValue(true);
    usbPrintService.printRaw.mockResolvedValue('usb-job-1');

    await expect(
      service.printForMerchant(user, SALE_ORDER_ID),
    ).resolves.toEqual({ orderId: 'usb-job-1', channel: 'usb' });

    // 第二个参数是 taskId：锁从「本次请求令牌」升级为「这张票的任务 ID」
    expect(redisService.evalScript).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET', KEYS[1], ARGV[2], 'PX', ttl)"),
      [LOCK_KEY],
      [expect.any(String), 'usb-job-1'],
    );
  });

  it('最近结账列表只做门店解析后交给数据服务，不掺杂打印通道判断', async () => {
    const orders = [
      {
        saleOrderId: 1292,
        spaceName: 'A02（小包）',
        settledAt: '2026-11-20T07:08:08.164Z',
      },
    ];
    printDataService.listRecentSettledOrders.mockResolvedValue(orders);

    // 打印配置刻意保持未启用状态：入口数据与能否打印无关
    printSettingsService.getByStoreId.mockResolvedValue({
      spacePrintChannel: 'off',
      spaceCloudPrinterSn: null,
      spaceUsbPrinter: null,
    });

    await expect(service.listRecentSettledOrders(user, 5)).resolves.toBe(
      orders,
    );
    expect(printDataService.listRecentSettledOrders).toHaveBeenCalledWith(
      STORE_ID,
      5,
    );
  });

  it('锁已到期或无过期时间时放弃绑定，绝不写入无期限的锁', async () => {
    redisService.setIfAbsent.mockResolvedValue(true);
    usbPrintService.printRaw.mockResolvedValue('usb-job-1');

    await service.printForMerchant(user, SALE_ORDER_ID);

    const script = String(redisService.evalScript.mock.calls[0][0]);
    // 回归点：PTTL 返回 0（租约刚到）或 -1（键无过期时间）时若仍 SET 一次，
    // 会把锁变成永久锁（PTTL=-1），这张票即便已打印成功，后续补打也会一直 409。
    expect(script).toMatch(/if ttl <= 0 then\s+return 0/);
    const setCalls = script.match(/redis\.call\('SET'[^)]*\)/g) ?? [];
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toContain("'PX', ttl");
  });

  it('两个终端同时补打时只有一个能穿过，另一个被 409 挡住', async () => {
    // 第一请求抢到锁，第二请求（另一终端）抢不到
    redisService.setIfAbsent
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    usbPrintService.printRaw.mockResolvedValue('usb-job-1');

    await expect(
      service.reprintForMerchant(user, SALE_ORDER_ID),
    ).resolves.toEqual({
      orderId: 'usb-job-1',
      // 服务器本机 USB 没有代理台账，不能拿回执号去查任务：只回「已提交」
      status: 'submitted',
      channel: 'usb',
    });
    // 本机路径不再做无意义的台账查询（查不到还会把已受理打成失败）
    expect(agentService.findTaskById).not.toHaveBeenCalled();
    await expect(
      service.reprintForMerchant(user, SALE_ORDER_ID),
    ).rejects.toBeInstanceOf(ConflictException);

    // 关键回归点：补打过程中不允许按订单直接删锁，否则会删掉对方的锁导致双双下发
    expect(redisService.del).not.toHaveBeenCalled();
  });

  it('代理回执确认最终失败时，按该任务 ID 原子释放锁后立即补打', async () => {
    // 清掉上一用例遗留的 mockResolvedValueOnce 队列，避免下一次占位被误判为「锁被占」
    redisService.setIfAbsent.mockReset();
    redisService.setIfAbsent.mockResolvedValue(true);
    usbPrintService.printRaw.mockResolvedValue('usb-job-2');
    agentService.findLatestTask.mockResolvedValue({
      taskId: 'task-failed',
      status: 'failed',
      error: '缺纸',
      createdAt: new Date(),
    });
    agentService.findTaskById.mockResolvedValue({
      taskId: 'usb-job-2',
      status: 'printed',
      error: null,
    });

    await service.reprintForMerchant(user, SALE_ORDER_ID);

    // 第一次 evalScript 是按「失败那张票的 taskId」比对删除，而不是按订单盲删
    expect(redisService.evalScript).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      [LOCK_KEY],
      ['task-failed'],
    );
    expect(redisService.del).not.toHaveBeenCalled();
  });

  it('云打印超时（结果未知）后立即补打不会删锁，仍被保留的锁挡住', async () => {
    // 上一次下发结果未知，30 秒租约仍在：抢锁失败
    redisService.setIfAbsent.mockResolvedValue(false);

    await expect(
      service.reprintForMerchant(user, SALE_ORDER_ID),
    ).rejects.toBeInstanceOf(ConflictException);

    // 既没有按订单删锁，也没有触发任何释放脚本
    expect(redisService.del).not.toHaveBeenCalled();
    expect(redisService.evalScript).not.toHaveBeenCalled();
  });

  /**
   * 首打入口没有「去重复用」这层兜底：占位锁只活 30 秒，代理自动补打期间锁早过期，
   * 首打接口被重放就会出第二张。与补打共用 assertNoInflightTicket 才能堵住。
   */
  it('结账首打：同订单上一张仍在打印中时拒绝再下发', async () => {
    redisService.setIfAbsent.mockResolvedValue(true);
    usbPrintService.printRaw.mockResolvedValue('usb-job-new');
    agentService.findLatestTask.mockResolvedValue({
      taskId: 'task-inflight',
      status: 'submitted',
      error: null,
      createdAt: new Date(),
    });

    await expect(
      service.printForMerchant(user, SALE_ORDER_ID),
    ).rejects.toBeInstanceOf(ConflictException);

    // 关键回归点：不抢锁、不驱动任何打印设备，否则就是第二张纸
    expect(redisService.setIfAbsent).not.toHaveBeenCalled();
    expect(usbPrintService.printRaw).not.toHaveBeenCalled();
    expect(agentService.dispatch).not.toHaveBeenCalled();
  });

  describe('printSalesReceiptForMerchant（销售记录补打）', () => {
    const snapshot = {
      orderNo: 'SO20261110001',
      storeName: '测试门店',
      spaceName: 'A02（小包）',
      spaceType: '包间',
      guestName: '张三',
      guestCount: 2,
      startTimeLabel: '2026-11-10 19:00',
      endTimeLabel: '2026-11-10 21:00',
      durationLabel: '2 小时',
      billingModeLabel: '计时',
      hourlyRate: 40,
      timeCost: 0,
      timeFeeLabel: '40 元/小时',
      items: [],
      itemsCost: 0,
      renewDeduction: 0,
      prepaidDeduction: 0,
      selfOrderDeduction: 0,
      cardDeduction: 0,
      voucherConsumption: 0,
      totalAmount: 100,
      paymentMethod: 'wechat',
      paymentMethodLabel: '微信支付',
      note: null,
      operatorName: '原收银员',
    };

    it('browser 通道只回权威快照，不下发任何设备任务', async () => {
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'browser',
        spaceCloudPrinterSn: null,
        spaceUsbPrinter: null,
      });
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).resolves.toEqual({
        channel: 'browser',
        status: 'snapshot',
        orderId: null,
        taskId: null,
        snapshot,
      });

      expect(printDataService.loadSalesReceiptOrder).toHaveBeenCalledWith(
        STORE_ID,
        SALE_ORDER_ID,
      );
      expect(usbPrintService.printRaw).not.toHaveBeenCalled();
      expect(feiePrintService.printMessage).not.toHaveBeenCalled();
      expect(agentService.dispatch).not.toHaveBeenCalled();
      // 浏览器补打同样原子占位：只读查锁挡不住「设备刚读完通道、尚未抢锁」
      expect(redisService.setIfAbsent).toHaveBeenCalledTimes(1);
    });

    it('browser 通道：上一张历史 USB 票仍在打印中时拒绝弹浏览器打印', async () => {
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'browser',
        spaceCloudPrinterSn: null,
        spaceUsbPrinter: null,
      });
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      // 台账只记 USB/代理任务：切到 browser 后旧 USB 任务仍在自动补打
      agentService.findLatestTask.mockResolvedValue({
        taskId: 'task-inflight',
        status: 'submitted',
        error: null,
        createdAt: new Date(),
      });

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('browser 通道：设备请求已占住提交锁时拒绝弹浏览器打印', async () => {
      // 设备请求已拿到占位锁、台账还没写（云通道甚至全程无台账），
      // 只查台账会直接放行，设备那张随后照常下发 → 同一张票出两份
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'browser',
        spaceCloudPrinterSn: null,
        spaceUsbPrinter: null,
      });
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      // SET NX 抢不到：设备已经占位
      redisService.setIfAbsent.mockResolvedValue(false);

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(usbPrintService.printRaw).not.toHaveBeenCalled();
      expect(feiePrintService.printMessage).not.toHaveBeenCalled();
    });

    it('browser 通道：占位锁写入不可用时拒绝补打，不静默放过可能重复的票', async () => {
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'browser',
        spaceCloudPrinterSn: null,
        spaceUsbPrinter: null,
      });
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      redisService.setIfAbsent.mockRejectedValue(new Error('redis down'));

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('browser 补打占位后，同一订单的设备补打会 409（两条路径竞争同一把锁）', async () => {
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'browser',
        spaceCloudPrinterSn: null,
        spaceUsbPrinter: null,
      });
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      // 浏览器先抢到锁；随后设备请求抢不到
      redisService.setIfAbsent
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false);

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).resolves.toMatchObject({ status: 'snapshot', channel: 'browser' });

      // 设备紧接着补打同一订单：会被浏览器刚占的锁挡住，不会两边都出票
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'usb',
        spaceCloudPrinterSn: null,
        spaceUsbPrinter: '/dev/usb/lp0',
      });
      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(usbPrintService.printRaw).not.toHaveBeenCalled();
      expect(agentService.dispatch).not.toHaveBeenCalled();
    });

    it('超过自动重试窗口视为链路异常，放行人工补打', async () => {
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'browser',
        spaceCloudPrinterSn: null,
        spaceUsbPrinter: null,
      });
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      agentService.findLatestTask.mockResolvedValue({
        taskId: 'task-stale',
        status: 'submitted',
        error: null,
        createdAt: new Date(Date.now() - 11 * 60 * 1000),
      });

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).resolves.toMatchObject({ status: 'snapshot', channel: 'browser' });
    });

    it('off 通道明确返回已关闭，不读快照、不下发、不回退', async () => {
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'off',
        spaceCloudPrinterSn: null,
        spaceUsbPrinter: null,
      });

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).resolves.toEqual({
        channel: 'off',
        status: 'off',
        orderId: null,
        taskId: null,
        snapshot: null,
      });
      expect(printDataService.loadSalesReceiptOrder).not.toHaveBeenCalled();
      expect(usbPrintService.printRaw).not.toHaveBeenCalled();
      expect(feiePrintService.printMessage).not.toHaveBeenCalled();
    });

    it('cloud 通道复用同一次读取的配置下发，返回 submitted 与飞鹅订单号', async () => {
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'cloud',
        spaceCloudPrinterSn: 'SN-1',
        spaceUsbPrinter: null,
      });
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      printDataService.loadOrder.mockResolvedValue(snapshot);
      feiePrintService.printMessage.mockResolvedValue('feie-order-1');
      redisService.setIfAbsent.mockResolvedValue(true);

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).resolves.toEqual({
        channel: 'cloud',
        status: 'submitted',
        orderId: 'feie-order-1',
        taskId: null,
        snapshot: null,
      });
      expect(feiePrintService.printMessage).toHaveBeenCalledTimes(1);
      // 一次请求只读一次门店配置
      expect(printSettingsService.getByStoreId).toHaveBeenCalledTimes(1);
    });

    it('usb 代理通道返回本次 taskId（只按该任务查回执）', async () => {
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'usb',
        spaceCloudPrinterSn: null,
        spaceUsbPrinter: '/dev/usb/lp0',
      });
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      printDataService.loadOrder.mockResolvedValue(snapshot);
      agentService.isAgentBound.mockResolvedValue(true);
      agentService.dispatch.mockResolvedValue({ ok: true, taskId: 'task-9' });
      agentService.findTaskById.mockResolvedValue({
        taskId: 'task-9',
        status: 'submitted',
      });
      redisService.setIfAbsent.mockResolvedValue(true);

      const result = await service.printSalesReceiptForMerchant(
        user,
        SALE_ORDER_ID,
      );

      expect(result).toEqual({
        channel: 'usb',
        status: 'submitted',
        orderId: 'task-9',
        taskId: 'task-9',
        snapshot: null,
      });
      // 回执查询必须带本次 taskId + 订单 + 业务域，不能拿同单旧任务顶替
      expect(agentService.findTaskById).toHaveBeenCalledWith(
        STORE_ID,
        'task-9',
        { domain: 'space', saleOrderId: SALE_ORDER_ID, target: 'cashier' },
      );
    });

    it('改成云打印后不复用近期 USB 台账任务，也不拿飞鹅订单号查代理台账', async () => {
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'cloud',
        spaceCloudPrinterSn: 'SN-1',
        spaceUsbPrinter: null,
      });
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      printDataService.loadOrder.mockResolvedValue(snapshot);
      // 30s 内存在一张已出票的 USB 任务：它绝不能冒充本次云下发
      agentService.findRecentActiveTask.mockResolvedValue({
        taskId: 'usb-old',
        status: 'printed',
      });
      feiePrintService.printMessage.mockResolvedValue('feie-order-2');
      redisService.setIfAbsent.mockResolvedValue(true);

      const result = await service.printSalesReceiptForMerchant(
        user,
        SALE_ORDER_ID,
      );

      expect(result).toEqual({
        channel: 'cloud',
        status: 'submitted',
        orderId: 'feie-order-2',
        taskId: null,
        snapshot: null,
      });
      // 云打印不复用 USB 台账任务；但仍要确认本单没有「可能还在出纸」的旧任务
      expect(feiePrintService.printMessage).toHaveBeenCalledTimes(1);
      expect(agentService.findRecentActiveTask).not.toHaveBeenCalled();
      expect(agentService.findLatestTask).toHaveBeenCalledTimes(1);
      expect(agentService.findTaskById).not.toHaveBeenCalled();
    });

    it('USB 通道命中去重窗口内已出票的任务时返回 printed，不再谎报已提交', async () => {
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      agentService.findRecentActiveTask.mockResolvedValue({
        taskId: 'usb-fresh',
        status: 'printed',
      });

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).resolves.toEqual({
        channel: 'usb',
        status: 'printed',
        orderId: 'usb-fresh',
        taskId: 'usb-fresh',
        snapshot: null,
      });
      expect(usbPrintService.printRaw).not.toHaveBeenCalled();
    });

    it('云打印占位不可用时拒绝下发，避免没有台账兜底时重复出纸', async () => {
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'cloud',
        spaceCloudPrinterSn: 'SN-1',
        spaceUsbPrinter: null,
      });
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      printDataService.loadOrder.mockResolvedValue(snapshot);
      redisService.setIfAbsent.mockReset();
      redisService.setIfAbsent.mockRejectedValue(new Error('redis down'));

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(feiePrintService.printMessage).not.toHaveBeenCalled();
    });

    it('USB 占位不可用时同样拒绝下发（本机 USB 没有台账兜底）', async () => {
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      redisService.setIfAbsent.mockRejectedValue(new Error('redis down'));

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      // 服务器本机 USB 不落代理台账，放行等于并发时必然打出两张
      expect(usbPrintService.printRaw).not.toHaveBeenCalled();
      expect(agentService.dispatch).not.toHaveBeenCalled();
    });

    it('云打印遇到仍可能出纸的旧 USB 任务时拒绝，避免切通道后重复出票', async () => {
      printSettingsService.getByStoreId.mockResolvedValue({
        spacePrintChannel: 'cloud',
        spaceCloudPrinterSn: 'SN-1',
        spaceUsbPrinter: null,
      });
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      printDataService.loadOrder.mockResolvedValue(snapshot);
      // 台账停在 submitted：代理可能仍在自动补打，30 秒占位锁挡不住（已过期）
      agentService.findLatestTask.mockResolvedValue({
        taskId: 'usb-retrying',
        status: 'submitted',
        error: null,
        createdAt: new Date(),
      });

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(feiePrintService.printMessage).not.toHaveBeenCalled();
    });

    it('代理已接单但回执查询抛错时仍返回 submitted，不把已下发报成失败', async () => {
      printDataService.loadSalesReceiptOrder.mockResolvedValue(snapshot);
      printDataService.loadOrder.mockResolvedValue(snapshot);
      agentService.isAgentBound.mockResolvedValue(true);
      agentService.dispatch.mockResolvedValue({ ok: true, taskId: 'task-err' });
      agentService.findTaskById.mockRejectedValue(new Error('ledger down'));
      redisService.setIfAbsent.mockResolvedValue(true);

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).resolves.toEqual({
        channel: 'usb',
        status: 'submitted',
        orderId: 'task-err',
        taskId: 'task-err',
        snapshot: null,
      });
      // 下发只发生一次：回执不可查不能触发重发
      expect(agentService.dispatch).toHaveBeenCalledTimes(1);
    });

    it('轮询任务状态只校验订单归属，不加载整张小票', async () => {
      prismaService.saleOrder.findFirst.mockResolvedValue({
        id: SALE_ORDER_ID,
      });
      agentService.findTaskById.mockResolvedValue({
        taskId: 'task-1',
        status: 'printed',
        error: null,
      });

      await expect(
        service.getPrintTaskStatus(user, SALE_ORDER_ID, 'task-1'),
      ).resolves.toEqual({
        taskId: 'task-1',
        status: 'printed',
        error: null,
      });
      expect(prismaService.saleOrder.findFirst).toHaveBeenCalledWith({
        where: { id: SALE_ORDER_ID, storeId: STORE_ID },
        select: { id: true },
      });
      expect(printDataService.loadOrder).not.toHaveBeenCalled();
    });

    it('订单不属于当前门店时轮询返回 404，且不读任务台账', async () => {
      prismaService.saleOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.getPrintTaskStatus(user, SALE_ORDER_ID, 'task-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(agentService.findTaskById).not.toHaveBeenCalled();
    });

    it('三项权限按 AND 校验：缺 space:view 直接 403，且不读订单、不下发', async () => {
      commerceAccessService.ensureCanAccessStore.mockRejectedValueOnce(
        new ForbiddenException('无权从销售记录打印空间小票'),
      );

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(printDataService.loadSalesReceiptOrder).not.toHaveBeenCalled();
      expect(printSettingsService.getByStoreId).not.toHaveBeenCalled();
      expect(usbPrintService.printRaw).not.toHaveBeenCalled();
    });

    it('订单不可补打（跨店/未结账/已退款）直接拒绝，不触发设备', async () => {
      printDataService.loadSalesReceiptOrder.mockRejectedValue(
        new NotFoundException('销售订单不存在'),
      );

      await expect(
        service.printSalesReceiptForMerchant(user, SALE_ORDER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(usbPrintService.printRaw).not.toHaveBeenCalled();
      expect(feiePrintService.printMessage).not.toHaveBeenCalled();
      expect(redisService.setIfAbsent).not.toHaveBeenCalled();
    });
  });
});
