import { Test, TestingModule } from '@nestjs/testing';
import type { Namespace } from 'socket.io';
import { RedisService } from '../../redis/redis.service';
import {
  SCAN_ORDERING_NAMESPACE,
  ScanOrderingRealtimeService,
} from './scan-ordering-realtime.service';

/**
 * 等待 fire-and-forget 的 publishAsync / dispatchWhenSocketIoReady 完成。
 */
const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/**
 * 扫码点餐实时事件链路测试：
 * - 发布：publishOrderCreated / publishOrderStatusChanged → Redis 频道（JSON { event, payload }）
 * - 分发：Redis 消息 → store / order / session Socket.IO 房间 + 原生订单订阅者
 * - 防护：无效 id 不广播、非法 JSON 不抛错
 */
describe('ScanOrderingRealtimeService', () => {
  let service: ScanOrderingRealtimeService;

  const redisService = {
    publish: jest.fn(),
    subscribe: jest.fn(),
    checkReadiness: jest.fn(),
  };

  const emit = jest.fn();
  const namespace = { to: jest.fn(() => ({ emit })) } as unknown as Namespace;

  beforeEach(async () => {
    jest.clearAllMocks();
    redisService.publish.mockResolvedValue(1);
    redisService.subscribe.mockImplementation(async () => async () => undefined);
    redisService.checkReadiness.mockResolvedValue(undefined);
    (namespace.to as jest.Mock).mockReturnValue({ emit });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingRealtimeService,
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();
    service = module.get<ScanOrderingRealtimeService>(
      ScanOrderingRealtimeService,
    );
    await service.onModuleInit();
    service.bindNamespace(namespace);
    service.markSocketIoAdapterReady();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  const orderCreatedPayload = {
    storeId: 11,
    orderId: 100,
    sessionId: 55,
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    fulfillmentStatus: 'preparing',
  };

  // ──────────────────────────────────────────────────────────────
  // 常量
  // ──────────────────────────────────────────────────────────────

  it('扫码点餐 namespace 为 /scan-ordering', () => {
    expect(SCAN_ORDERING_NAMESPACE).toBe('/scan-ordering');
  });

  // ──────────────────────────────────────────────────────────────
  // Redis 发布
  // ──────────────────────────────────────────────────────────────

  it('publishOrderCreated 发布到扫码点餐 Redis 频道，消息体为 { event, payload } JSON', async () => {
    service.publishOrderCreated(orderCreatedPayload);
    await flush();

    expect(redisService.publish).toHaveBeenCalledTimes(1);
    expect(redisService.publish).toHaveBeenCalledWith(
      'purelyprofit:scan-ordering:realtime:v1',
      JSON.stringify({ event: 'order.created', payload: orderCreatedPayload }),
    );
  });

  it('publishOrderStatusChanged 发布到同一 Redis 频道', async () => {
    service.publishOrderStatusChanged({
      storeId: 11,
      orderId: 100,
      sessionId: 55,
      status: 'preparing',
      paymentStatus: 'paid',
      fulfillmentStatus: 'preparing',
    });
    await flush();

    expect(redisService.publish).toHaveBeenCalledWith(
      'purelyprofit:scan-ordering:realtime:v1',
      JSON.stringify({
        event: 'order.status_changed',
        payload: {
          storeId: 11,
          orderId: 100,
          sessionId: 55,
          status: 'preparing',
          paymentStatus: 'paid',
          fulfillmentStatus: 'preparing',
        },
      }),
    );
  });

  it('发布失败不抛错（仅记录错误日志，不影响主流程）', async () => {
    redisService.publish.mockRejectedValue(new Error('redis down'));
    const errorSpy = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    expect(() => service.publishOrderCreated(orderCreatedPayload)).not.toThrow();
    await flush();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // ──────────────────────────────────────────────────────────────
  // Redis → Socket.IO 房间分发
  // ──────────────────────────────────────────────────────────────

  it('order.created 消息分发给 store 与 session 房间（不发 order 房间）', async () => {
    const handler = redisService.subscribe.mock.calls[0][1];
    handler(
      JSON.stringify({ event: 'order.created', payload: orderCreatedPayload }),
    );
    await flush();

    expect(namespace.to).toHaveBeenCalledWith('store:11');
    expect(namespace.to).toHaveBeenCalledWith('session:55');
    expect(namespace.to).not.toHaveBeenCalledWith('order:100');
    expect(emit).toHaveBeenCalledWith('order.created', orderCreatedPayload);
  });

  it('order.status_changed 消息分发给 store/order/session 三个房间', async () => {
    const handler = redisService.subscribe.mock.calls[0][1];
    handler(
      JSON.stringify({
        event: 'order.status_changed',
        payload: {
          storeId: 11,
          orderId: 100,
          sessionId: 55,
          status: 'served',
        },
      }),
    );
    await flush();

    expect(namespace.to).toHaveBeenCalledWith('store:11');
    expect(namespace.to).toHaveBeenCalledWith('order:100');
    expect(namespace.to).toHaveBeenCalledWith('session:55');
    expect(emit).toHaveBeenCalledWith(
      'order.status_changed',
      expect.objectContaining({ orderId: 100, status: 'served' }),
    );
  });

  it('无效 storeId/orderId/sessionId 不触发房间分发（防脏数据广播）', async () => {
    const handler = redisService.subscribe.mock.calls[0][1];
    handler(
      JSON.stringify({
        event: 'order.created',
        payload: {
          storeId: 'bad',
          orderId: -1,
          sessionId: 0,
          status: 'pending_payment',
        },
      }),
    );
    await flush();

    expect(namespace.to).not.toHaveBeenCalled();
  });

  it('无效 JSON 消息不抛错（仅记录错误日志）', async () => {
    const handler = redisService.subscribe.mock.calls[0][1];
    const errorSpy = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    expect(() => handler('not-json{{{')).not.toThrow();
    await flush();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // ──────────────────────────────────────────────────────────────
  // 原生订单订阅者（小程序端）
  // ──────────────────────────────────────────────────────────────

  it('order.status_changed 推送给该订单的原生订阅者', async () => {
    const listener = jest.fn();
    service.subscribeNativeOrder(100, listener);

    const handler = redisService.subscribe.mock.calls[0][1];
    handler(
      JSON.stringify({
        event: 'order.status_changed',
        payload: {
          storeId: 11,
          orderId: 100,
          sessionId: 55,
          status: 'served',
        },
      }),
    );
    await flush();

    expect(listener).toHaveBeenCalledWith({
      type: 'order.status_changed',
      payload: expect.objectContaining({ orderId: 100, status: 'served' }),
    });
  });

  it('退订后不再收到该订单事件', async () => {
    const listener = jest.fn();
    const unsubscribe = service.subscribeNativeOrder(100, listener);
    unsubscribe();

    const handler = redisService.subscribe.mock.calls[0][1];
    handler(
      JSON.stringify({
        event: 'order.status_changed',
        payload: {
          storeId: 11,
          orderId: 100,
          sessionId: 55,
          status: 'served',
        },
      }),
    );
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });
});
