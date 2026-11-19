import { BadRequestException, ConflictException } from '@nestjs/common';
import { PurchasesIdempotencyService } from './purchases-idempotency.service';

describe('PurchasesIdempotencyService', () => {
  const prismaService = {
    idempotencyRecord: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const service = new PurchasesIdempotencyService(
    prismaService as unknown as ConstructorParameters<
      typeof PurchasesIdempotencyService
    >[0],
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizeKey 对未传值返回 null（保留旧客户端行为）', () => {
    expect(service.normalizeKey(undefined)).toBeNull();
    expect(service.normalizeKey('   ')).toBeNull();
  });

  it('normalizeKey 对过短的键返回 400', () => {
    expect(() => service.normalizeKey('short')).toThrow(BadRequestException);
  });

  it('hashRequest 对相同内容稳定、对不同内容不一致', () => {
    const base = { storeId: 18, dto: { items: [{ productId: 1, quantity: 2 }] } };

    expect(service.hashRequest(base)).toBe(service.hashRequest({ ...base }));
    expect(service.hashRequest(base)).not.toBe(
      service.hashRequest({ ...base, dto: { items: [{ productId: 1, quantity: 3 }] } }),
    );
  });

  it('ensureSameRequest 拒绝同一 key 复用于不同内容', () => {
    expect(() =>
      service.ensureSameRequest({ requestHash: 'abc' }, 'def'),
    ).toThrow(ConflictException);
    expect(() =>
      service.ensureSameRequest({ requestHash: 'abc' }, 'abc'),
    ).not.toThrow();
  });

  it('resolveReplay 仅对 succeeded 且带快照的记录回放', () => {
    const snapshot = { id: '11' };

    expect(
      service.resolveReplay({
        status: 'succeeded',
        requestHash: 'abc',
        responseSnapshot: snapshot,
      }),
    ).toEqual(snapshot);

    // 首次请求仍在写入：提示稍后重试，而不是回放空数据或重复建单
    expect(() =>
      service.resolveReplay({
        status: 'processing',
        requestHash: 'abc',
        responseSnapshot: null,
      }),
    ).toThrow(ConflictException);
  });
});
