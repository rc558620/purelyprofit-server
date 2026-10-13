import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { PrintAgentService } from './print-agent.service';
import type { PrintAgentConnection } from './print-agent.service';

describe('PrintAgentService', () => {
  let service: PrintAgentService;

  const prismaService = {
    store: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    printAgent: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const redisService = {
    subscribe: jest.fn().mockResolvedValue(jest.fn()),
    publish: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue(undefined),
    setJson: jest.fn().mockResolvedValue(undefined),
    getJson: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(undefined),
    expire: jest.fn().mockResolvedValue(true),
    exists: jest.fn().mockResolvedValue(true),
    isConnectionClosedError: jest.fn().mockReturnValue(false),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintAgentService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();
    service = module.get<PrintAgentService>(PrintAgentService);
  });

  it('onModuleInit 订阅任务转发频道', async () => {
    await service.onModuleInit();
    expect(redisService.subscribe).toHaveBeenCalledWith(
      expect.stringContaining('print-agent'),
      expect.any(Function),
    );
    await service.onModuleDestroy();
  });

  it('生成绑定码：6 位去混淆字符且写入门店', async () => {
    const code = await service.generateBindCode(11);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(prismaService.store.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { printAgentBindCode: code },
    });
  });

  it('注册（带 deviceId）：按门店+设备 upsert 下发独立令牌，互不覆盖', async () => {
    prismaService.store.findFirst.mockResolvedValue({ id: 11 });
    const result = await service.register(
      'ABC234',
      'dev-1',
      'windows',
      '1.0.0',
    );
    expect(result.storeId).toBe(11);
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(prismaService.printAgent.upsert).toHaveBeenCalledWith({
      where: { storeId_deviceId: { storeId: 11, deviceId: 'dev-1' } },
      create: {
        storeId: 11,
        deviceId: 'dev-1',
        token: result.token,
        platform: 'windows',
        version: '1.0.0',
      },
      update: {
        token: result.token,
        platform: 'windows',
        version: '1.0.0',
      },
    });
    expect(prismaService.store.update).not.toHaveBeenCalled();
  });

  it('注册（无 deviceId）：旧代理兼容，写入门店单 token', async () => {
    prismaService.store.findFirst.mockResolvedValue({ id: 11 });
    const result = await service.register(
      'ABC234',
      undefined,
      'windows',
      '1.0.0',
    );
    expect(result.storeId).toBe(11);
    expect(prismaService.store.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { printAgentToken: result.token },
    });
    expect(prismaService.printAgent.upsert).not.toHaveBeenCalled();
  });

  it('注册：绑定码无效时抛 400', async () => {
    prismaService.store.findFirst.mockResolvedValue(null);
    await expect(
      service.register('INVALID', 'dev-1', 'windows'),
    ).rejects.toThrow(BadRequestException);
  });

  it('isAgentBound：存在设备登记或旧版单 token 均返回 true', async () => {
    prismaService.printAgent.findFirst.mockResolvedValueOnce({ id: 1 });
    expect(await service.isAgentBound(11)).toBe(true);
    prismaService.printAgent.findFirst.mockResolvedValueOnce(null);
    prismaService.store.findUnique.mockResolvedValueOnce({
      printAgentToken: 'token',
    });
    expect(await service.isAgentBound(11)).toBe(true);
    prismaService.printAgent.findFirst.mockResolvedValueOnce(null);
    prismaService.store.findUnique.mockResolvedValueOnce({
      printAgentToken: null,
    });
    expect(await service.isAgentBound(11)).toBe(false);
  });

  it('attach：本 worker 有连接时 dispatch 直接下发并写入在线标记', async () => {
    const socket: PrintAgentConnection = {
      readyState: 1,
      send: jest.fn(),
      close: jest.fn(),
    };
    await service.attach(11, socket);

    const result = await service.dispatch(11, {
      taskId: 't1',
      target: 'kitchen',
      dataBase64: 'AA==',
    });
    expect(result.ok).toBe(true);
    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"print"'),
    );
    // 在线标记改为结构化 JSON（pid + lastSeenAt），供跨 worker 判定在线与恢复最后在线时间
    expect(redisService.setJson).toHaveBeenCalledWith(
      expect.stringContaining('print-agent:online:11'),
      { pid: expect.any(Number), lastSeenAt: expect.any(Number) },
      expect.any(Number),
    );
    expect(await service.getAgentStatus(11)).toEqual({
      online: true,
      lastSeenAt: expect.any(Number),
    });
  });

  it('getAgentStatus：本 worker 无连接但 Redis 在线标记存在时判定在线（cluster 跨 worker）', async () => {
    redisService.getJson.mockResolvedValueOnce({
      pid: 4321,
      lastSeenAt: 1700000000000,
    });
    // 本 worker 未持有连接，且 Redis 在线标记由持有连接的 worker 写入
    expect(await service.getAgentStatus(11)).toEqual({
      online: true,
      lastSeenAt: 1700000000000,
    });
  });

  it('getAgentStatus：本 worker 无连接且无在线标记时判定离线', async () => {
    redisService.getJson.mockResolvedValue(null);
    expect(await service.getAgentStatus(11)).toEqual({
      online: false,
      lastSeenAt: null,
    });
  });

  it('getAgentStatus：Redis 读取异常时降级为离线且不抛错', async () => {
    redisService.getJson.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.getAgentStatus(11)).resolves.toEqual({
      online: false,
      lastSeenAt: null,
    });
  });

  it('dispatch：本 worker 无连接但 Redis 在线标记存在时跨 worker 转发', async () => {
    redisService.exists.mockResolvedValue(true);
    const result = await service.dispatch(11, {
      taskId: 't2',
      target: 'cashier',
      dataBase64: 'AA==',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.forwarded).toBe(true);
    expect(redisService.publish).toHaveBeenCalledWith(
      expect.stringContaining('print-agent'),
      expect.stringContaining('"storeId":11'),
    );
  });

  it('dispatch：无连接且无在线标记时返回 agent-offline', async () => {
    redisService.exists.mockResolvedValue(false);
    const result = await service.dispatch(11, {
      taskId: 't3',
      target: 'cashier',
      dataBase64: 'AA==',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('agent-offline');
  });

  it('detach：移除连接并删除在线标记', async () => {
    const socket: PrintAgentConnection = {
      readyState: 1,
      send: jest.fn(),
      close: jest.fn(),
    };
    await service.attach(11, socket);
    await service.detach(11, socket);
    expect((await service.getAgentStatus(11)).online).toBe(false);
    expect(redisService.del).toHaveBeenCalledWith(
      expect.stringContaining('print-agent:online:11'),
    );
  });

  it('打印机缓存：setPrinters 后 getPrinters 可读且同步写入 Redis', async () => {
    service.setPrinters(11, [{ id: 'RP58', name: 'RP58', type: 'windows' }]);
    await expect(service.getPrinters(11)).resolves.toEqual([
      { id: 'RP58', name: 'RP58', type: 'windows' },
    ]);
    expect(redisService.setJson).toHaveBeenCalledWith(
      expect.stringContaining('print-agent:printers:11'),
      [{ id: 'RP58', name: 'RP58', type: 'windows' }],
      expect.any(Number),
    );
  });

  it('打印机缓存：本 worker 无内存缓存时回退 Redis（cluster 下代理连在其它 worker）', async () => {
    redisService.getJson.mockResolvedValueOnce([
      { id: 'RP58', name: 'RP58', type: 'windows' },
    ]);
    await expect(service.getPrinters(11)).resolves.toEqual([
      { id: 'RP58', name: 'RP58', type: 'windows' },
    ]);
  });

  it('打印机缓存：Redis 读取异常时降级为空数组且不抛错', async () => {
    redisService.getJson.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.getPrinters(11)).resolves.toEqual([]);
  });

  it('detach：同时清理在线标记与打印机列表（离线后不再展示门店打印机）', async () => {
    const socket: PrintAgentConnection = {
      readyState: 1,
      send: jest.fn(),
      close: jest.fn(),
    };
    await service.attach(11, socket);
    service.setPrinters(11, [{ id: 'RP58', name: 'RP58', type: 'windows' }]);
    await service.detach(11, socket);

    await expect(service.getPrinters(11)).resolves.toEqual([]);
    expect(redisService.del).toHaveBeenCalledWith(
      expect.stringContaining('print-agent:printers:11'),
    );
  });
});
