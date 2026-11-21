// 打印编排：状态查询以代理回执为准，提交视图不能遮蔽真实出纸结果
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ScanOrderingPrintDispatchService } from './scan-ordering-print-dispatch.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('ScanOrderingPrintDispatchService', () => {
  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };
  const printSettingsService = {
    getByStoreId: jest.fn(),
  };
  const printTaskService = {
    beginAuto: jest.fn(),
    markPending: jest.fn(),
    markDispatched: jest.fn(),
    markFailed: jest.fn(),
    markUnknown: jest.fn(),
    getLatestState: jest.fn(),
  };
  const cloudPrintService = {
    printSnapshot: jest.fn(),
    testPrintForMerchant: jest.fn(),
  };
  const usbPrintService = {
    printSnapshot: jest.fn(),
    testPrintForMerchant: jest.fn(),
  };
  const printAgentService = {
    findTaskById: jest.fn(),
    findLatestTask: jest.fn(),
  };

  let service: ScanOrderingPrintDispatchService;
  const user = { id: 1, name: '店员' } as AuthenticatedUser;

  const cloudSettings = {
    cashierPrintChannel: 'cloud',
    kitchenPrintChannel: 'cloud',
    cashierCloudPrinterSn: 'SN-1',
    kitchenCloudPrinterSn: 'SN-2',
    cashierUsbPrinter: null,
    kitchenUsbPrinter: null,
  };

  const taskKey = { storeId: 9, orderId: 66, target: 'cashier' as const };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScanOrderingPrintDispatchService(
      commerceAccessService as never,
      printSettingsService as never,
      printTaskService as never,
      cloudPrintService as never,
      usbPrintService as never,
      printAgentService as never,
    );
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(9);
    printSettingsService.getByStoreId.mockResolvedValue(cloudSettings);
    printTaskService.markDispatched.mockResolvedValue(undefined);
    printTaskService.markPending.mockResolvedValue(undefined);
  });

  it('Redis 显示已提交、台账回执失败时以台账为准（不被遮蔽）', async () => {
    printTaskService.getLatestState.mockResolvedValue({
      taskId: 'local-1',
      status: 'dispatched',
      source: 'auto',
      upstreamId: 'agent-1',
      error: null,
      updatedAt: 1000,
    });
    printAgentService.findTaskById.mockResolvedValue({
      taskId: 'agent-1',
      status: 'failed',
      error: '纸尽',
    });

    const result = await service.getTaskStatus(user, {
      orderId: 66,
      target: 'cashier',
    });

    expect(printAgentService.findTaskById).toHaveBeenCalledWith(9, 'agent-1', {
      domain: 'scan',
      saleOrderId: 66,
      target: 'cashier',
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('纸尽');
  });

  it('台账仍是 submitted 时返回 submitted，不能判成失败', async () => {
    printTaskService.getLatestState.mockResolvedValue(null);
    printAgentService.findLatestTask.mockResolvedValue({
      taskId: 'agent-2',
      status: 'submitted',
      error: null,
    });

    const result = await service.getTaskStatus(user, {
      orderId: 66,
      target: 'cashier',
    });

    // 回退查询必须带业务域与票种，避免读到空间小票或后厨票的回执
    expect(printAgentService.findLatestTask).toHaveBeenCalledWith(9, {
      domain: 'scan',
      saleOrderId: 66,
      target: 'cashier',
    });
    expect(result.status).toBe('submitted');
  });

  it('传 taskId 时只核对本次任务，不读同订单最近一条', async () => {
    printAgentService.findTaskById.mockResolvedValue({
      taskId: 'agent-9',
      status: 'submitted',
      error: null,
    });

    const result = await service.getTaskStatus(user, {
      orderId: 66,
      target: 'cashier',
      taskId: 'agent-9',
    });

    expect(printAgentService.findTaskById).toHaveBeenCalledWith(9, 'agent-9', {
      domain: 'scan',
      saleOrderId: 66,
      target: 'cashier',
    });
    expect(printAgentService.findLatestTask).not.toHaveBeenCalled();
    expect(printTaskService.getLatestState).not.toHaveBeenCalled();
    expect(result.status).toBe('submitted');
    expect(result.taskId).toBe('agent-9');
  });

  it('taskId 在台账与任务视图都查不到时返回空状态，不误报其它票的结果', async () => {
    printAgentService.findTaskById.mockResolvedValue(null);
    printTaskService.getLatestState.mockResolvedValue({
      taskId: 'other-task',
      status: 'dispatched',
      source: 'auto',
      upstreamId: 'other-upstream',
      error: null,
      updatedAt: 1000,
    });

    const result = await service.getTaskStatus(user, {
      orderId: 66,
      target: 'cashier',
      taskId: 'agent-9',
    });

    expect(result.status).toBeNull();
    expect(result.taskId).toBe('agent-9');
  });

  it('自动打印命中已有任务时直接返回去重结果，不重复下发', async () => {
    printTaskService.beginAuto.mockResolvedValue({
      acquired: false,
      state: {
        taskId: 'local-1',
        status: 'dispatched',
        source: 'auto',
        upstreamId: 'feie-9',
        error: null,
        updatedAt: 1000,
      },
    });

    const result = await service.printOrder(user, {
      orderId: 66,
      target: 'cashier',
      source: 'auto',
    });

    expect(result.deduped).toBe(true);
    expect(result.taskId).toBe('feie-9');
    expect(cloudPrintService.printSnapshot).not.toHaveBeenCalled();
  });

  it('人工补打写 manual 桶并用自己的任务 ID 记录终态', async () => {
    printTaskService.markPending.mockResolvedValue(undefined);
    printAgentService.findLatestTask.mockResolvedValue(null);
    cloudPrintService.printSnapshot.mockResolvedValue('feie-77');

    const result = await service.printOrder(user, {
      orderId: 66,
      target: 'cashier',
      source: 'manual',
    });

    expect(printTaskService.markPending).toHaveBeenCalledWith(
      taskKey,
      'manual',
      expect.any(String),
    );
    const manualTaskId = printTaskService.markPending.mock.calls[0][2];
    expect(printTaskService.markDispatched).toHaveBeenCalledWith(
      taskKey,
      'manual',
      manualTaskId,
      'feie-77',
    );
    expect(result.status).toBe('dispatched');
  });

  it('通道未启用云/USB 时直接拒绝，不回落到浏览器打印', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      ...cloudSettings,
      cashierPrintChannel: 'off',
    });

    await expect(
      service.printOrder(user, {
        orderId: 66,
        target: 'cashier',
        source: 'auto',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('人工补打时代理仍在自动补打（submitted 且未超窗）则拒绝新任务', async () => {
    printAgentService.findLatestTask.mockResolvedValue({
      taskId: 'agent-7',
      status: 'submitted',
      error: '缺纸',
      createdAt: new Date(),
    });

    await expect(
      service.printOrder(user, {
        orderId: 66,
        target: 'cashier',
        source: 'manual',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(cloudPrintService.printSnapshot).not.toHaveBeenCalled();
  });

  it('人工补打时旧任务已最终失败则允许重新下发', async () => {
    printAgentService.findLatestTask.mockResolvedValue({
      taskId: 'agent-7',
      status: 'failed',
      error: '纸尽',
      createdAt: new Date(),
    });
    printTaskService.markPending.mockResolvedValue(undefined);
    cloudPrintService.printSnapshot.mockResolvedValue('feie-88');

    const result = await service.printOrder(user, {
      orderId: 66,
      target: 'cashier',
      source: 'manual',
    });

    expect(result.status).toBe('dispatched');
    expect(cloudPrintService.printSnapshot).toHaveBeenCalled();
  });
});
