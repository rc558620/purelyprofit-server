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
    del: jest.fn().mockResolvedValue(undefined),
    expire: jest.fn().mockResolvedValue(true),
    exists: jest.fn().mockResolvedValue(true),
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
    expect(redisService.set).toHaveBeenCalledWith(
      expect.stringContaining('print-agent:online:11'),
      expect.any(String),
      expect.any(Number),
    );
    expect(service.getAgentStatus(11)).toEqual({
      online: true,
      lastSeenAt: expect.any(Number),
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
    expect(service.getAgentStatus(11).online).toBe(false);
    expect(redisService.del).toHaveBeenCalledWith(
      expect.stringContaining('print-agent:online:11'),
    );
  });

  it('打印机缓存：setPrinters 后 getPrinters 可读', () => {
    service.setPrinters(11, [{ id: 'RP58', name: 'RP58', type: 'windows' }]);
    expect(service.getPrinters(11)).toEqual([
      { id: 'RP58', name: 'RP58', type: 'windows' },
    ]);
  });
});
