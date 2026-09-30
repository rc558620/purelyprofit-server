// 客存实时分发单测：覆盖 S11（房间隔离）与 S15（订阅注销后不再投递）
import type { Namespace } from 'socket.io';
import type { RedisService } from '../../redis/redis.service';
import { CustodyRealtimeService } from './custody-realtime.service';

interface Emitted {
  room: string;
  event: string;
  payload: unknown;
}

/** 构造可断言投递目标的命名空间替身 */
const createNamespace = (emitted: Emitted[]): Namespace =>
  ({
    to: (room: string) => ({
      local: {
        emit: (event: string, payload: unknown) => {
          emitted.push({ room, event, payload });
        },
      },
    }),
  }) as unknown as Namespace;

const createService = () => {
  const emitted: Emitted[] = [];
  let handleMessage: ((message: string) => void) | null = null;
  const publish = jest.fn().mockResolvedValue(undefined);
  const subscribe = jest.fn(
    (_channel: string, handler: (message: string) => void) => {
      handleMessage = handler;
      return Promise.resolve(jest.fn().mockResolvedValue(undefined));
    },
  );
  const service = new CustodyRealtimeService({
    publish,
    subscribe,
  } as unknown as RedisService);
  return {
    service,
    namespace: createNamespace(emitted),
    emitted,
    publish,
    dispatch: (
      event: string,
      payload: unknown,
      storeId: number,
      targetMemberId: number | null,
    ) => {
      if (!handleMessage) throw new Error('尚未订阅 Redis 频道');
      handleMessage(
        JSON.stringify({ event, payload, storeId, targetMemberId }),
      );
    },
  };
};

describe('CustodyRealtimeService 房间口径', () => {
  it('门店与会员房间命名带业务前缀，避免跨域串房', () => {
    const { service } = createService();

    expect(service.storeRoom(7)).toBe('custody:store:7');
    expect(service.memberRoom(101)).toBe('custody:member:101');
  });
});

describe('CustodyRealtimeService 投递范围', () => {
  it('store_requested 同时投递门店与指定会员', async () => {
    const { service, namespace, emitted, dispatch } = createService();
    await service.onModuleInit();
    service.bindNamespace(namespace);

    dispatch('custody.store_requested', { custodyOrderId: 1 }, 7, 101);

    expect(emitted.map((item) => item.room)).toEqual([
      'custody:store:7',
      'custody:member:101',
    ]);
  });

  it('store_confirmed 只投递门店，会员侧不串台（S11）', async () => {
    const { service, namespace, emitted, dispatch } = createService();
    await service.onModuleInit();
    service.bindNamespace(namespace);

    dispatch('custody.store_confirmed', { memberId: 101 }, 7, null);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].room).toBe('custody:store:7');
  });

  it('会员房间按 memberId 隔离，其他会员收不到', async () => {
    const { service, namespace, emitted, dispatch } = createService();
    await service.onModuleInit();
    service.bindNamespace(namespace);

    const received: string[] = [];
    service.subscribeMember(101, (event) => received.push(event));

    dispatch('custody.picked', { qty: 1 }, 7, 202);

    expect(received).toEqual([]);
    expect(emitted.some((item) => item.room === 'custody:member:101')).toBe(
      false,
    );
  });

  it('注销订阅后不再收到原生投递（S15）', async () => {
    const { service, namespace, dispatch } = createService();
    await service.onModuleInit();
    service.bindNamespace(namespace);

    const received: string[] = [];
    const unsubscribe = service.subscribeMember(101, (event) =>
      received.push(event),
    );

    dispatch('custody.picked', { qty: 1 }, 7, 101);
    unsubscribe();
    dispatch('custody.voided', { reason: 'x' }, 7, 101);

    expect(received).toEqual(['custody.picked']);
  });

  it('未注入命名空间时仍发布 Redis，不抛异常', async () => {
    const { service, publish } = createService();
    await service.onModuleInit();

    service.publishStoreRequested(7, 101, {
      custodyOrderId: 1,
      orderNo: 'C1',
      storeId: 7,
      storeName: '门店',
      productName: '酒',
      specName: '',
      unit: '瓶',
      qty: 1,
      location: 'A1',
      expireAt: '',
      memberId: 101,
    });

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('Redis 消息非法时忽略且不抛异常', async () => {
    const { service, namespace, emitted } = createService();
    await service.onModuleInit();
    service.bindNamespace(namespace);

    expect(() => {
      // 走同一条订阅回调，模拟脏消息
      const dispatchAny = service as unknown as {
        handleRedisMessage: (raw: string) => void;
      };
      dispatchAny.handleRedisMessage('not-json');
    }).not.toThrow();
    expect(emitted).toEqual([]);
  });
});
