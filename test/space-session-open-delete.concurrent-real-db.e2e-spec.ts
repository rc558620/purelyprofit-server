/**
 * 「开台」与「删除空间」并发写入的真实库验证。
 *
 * 单测只能证明代码里存在「拿到空间行锁后复检 deletedAt」这条语句，
 * 证明不了它在真实 PostgreSQL 下真的生效。这里要验证两个前提：
 *   1. 删除事务提交后，此前已在等行锁的开台事务拿到锁时，
 *      新语句能看到新提交的 deleted_at（ReadCommitted，每条语句新快照）；
 *   2. 因此复检必然拒绝写入，不会把会话写进已删除空间。
 *
 * 运行：node --experimental-vm-modules node_modules/jest/bin/jest.js \
 *        --config ./test/jest-e2e.json --runInBand space-session-open-delete
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import configuration from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import type { AuthenticatedUser } from '../src/purely-profit/auth/strategies/jwt.strategy';
import type { CommerceAccessService } from '../src/purely-profit/commerce/commerce-access.service';
import type { SpaceReservationsStateService } from '../src/purely-profit/operations/spaces/space-reservations-state.service';
import type { RedisLockService } from '../src/redis/redis-lock.service';
import type { ScanOrderingRealtimeService } from '../src/purely-club/scan-ordering/scan-ordering-realtime.service';
import type { CommissionCoreService } from '../src/purely-profit/operations/commission/commission-core.service';
import type { MembershipDowngradeService } from '../src/purely-profit/member/platform-membership/membership-downgrade.service';
import type { CacheInvalidatorService } from '../src/redis/invalidator';
import { SpaceSessionOpenService } from '../src/purely-profit/operations/spaces/space-session-open.service';

const PROBE_TAG = `spaceopen${Date.now()}`;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('开台 vs 删除空间 并发（真实库）', () => {
  let prisma: PrismaService;
  let moduleRef: TestingModule;
  let service: SpaceSessionOpenService;
  let storeId: number | null = null;
  let spaceTypeId: number | null = null;
  const spaceIds: number[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    currentMembership: {
      staffId: 0,
      storeId: 0,
      role: 'owner',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  const commerceAccessService = {
    ensureCanAccessStore: jest.fn().mockResolvedValue(undefined),
    findOperatorStaffIdForStore: jest.fn().mockResolvedValue(null),
  };
  const reservationsStateService = {
    ensureReservationCanBeFulfilled: jest.fn().mockResolvedValue(undefined),
  };
  const redisLockService = {
    acquireLock: jest.fn().mockResolvedValue({ key: 'k', value: 'v' }),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };
  const realtimeService = { notifySessionChanged: jest.fn() };
  const commissionCoreService = { resolveAssignments: jest.fn() };
  const downgradeService = {
    assertSpaceCanOpen: jest.fn().mockResolvedValue(undefined),
  };
  const cacheInvalidatorService = {
    invalidateSpacesReadCaches: jest.fn().mockResolvedValue(undefined),
    invalidateSalesDerived: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      ],
    }).compile();
    const configService = moduleRef.get(ConfigService);
    prisma = new PrismaService(configService);
    await prisma.$connect();

    service = new SpaceSessionOpenService(
      prisma,
      commerceAccessService as unknown as CommerceAccessService,
      reservationsStateService as unknown as SpaceReservationsStateService,
      redisLockService as unknown as RedisLockService,
      realtimeService as unknown as ScanOrderingRealtimeService,
      commissionCoreService as unknown as CommissionCoreService,
      downgradeService as unknown as MembershipDowngradeService,
      cacheInvalidatorService as unknown as CacheInvalidatorService,
    );

    const store = await prisma.store.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    storeId = store?.id ?? null;
    if (storeId === null) {
      return;
    }

    const spaceType = await prisma.spaceType.create({
      data: { storeId, name: `${PROBE_TAG}类型` },
      select: { id: true },
    });
    spaceTypeId = spaceType.id;
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      if (spaceIds.length > 0) {
        await prisma.spaceSession.deleteMany({
          where: { spaceId: { in: spaceIds } },
        });
        await prisma.space.deleteMany({ where: { id: { in: spaceIds } } });
      }
      if (spaceTypeId !== null) {
        await prisma.spaceType.deleteMany({ where: { id: spaceTypeId } });
      }
      await prisma.$disconnect();
    }
    await moduleRef?.close();
  }, 60_000);

  async function createProbeSpace(name: string): Promise<number> {
    if (storeId === null || spaceTypeId === null) {
      throw new Error('缺少探针门店/类型');
    }
    const space = await prisma.space.create({
      data: {
        storeId,
        typeId: spaceTypeId,
        name: `${PROBE_TAG}-${name}`,
        sortOrder: 1,
      },
      select: { id: true },
    });
    spaceIds.push(space.id);
    return space.id;
  }

  it('阳性对照：未删除空间可以正常开台', async () => {
    if (storeId === null) {
      return;
    }
    const spaceId = await createProbeSpace('正常');

    const result = await service.openSession(user, spaceId, {
      billingMode: 'timed',
      hourlyRate: 68,
    });

    expect(result.spaceId).toBe(String(spaceId));
    const activeCount = await prisma.spaceSession.count({
      where: { spaceId, status: 'active' },
    });
    expect(activeCount).toBe(1);
  }, 30_000);

  it('删除事务先提交时，等待行锁的开台必须被拒绝且不落库', async () => {
    if (storeId === null) {
      return;
    }
    const spaceId = await createProbeSpace('并发删除');

    // 用对象持有信号函数：在 Promise 构造器内赋值给局部变量会被 TS 控制流收窄成 never
    const gate: {
      markLockHeld: (() => void) | null;
      releaseDelete: (() => void) | null;
    } = { markLockHeld: null, releaseDelete: null };
    const lockHeld = new Promise<void>((resolve) => {
      gate.markLockHeld = resolve;
    });
    const allowDelete = new Promise<void>((resolve) => {
      gate.releaseDelete = resolve;
    });

    // 删除事务：先拿空间行锁，通知测试已持锁，再等测试放行后软删并提交
    const deleteTx = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id
          FROM spaces
          WHERE id = ${spaceId}
          FOR UPDATE
        `;
        gate.markLockHeld?.();
        await allowDelete;
        await tx.space.update({
          where: { id: spaceId },
          data: { deletedAt: new Date() },
        });
      },
      { timeout: 20_000 },
    );

    await lockHeld;

    // 删除尚未提交：openSession 的入口查询仍能读到 deletedAt = null，
    // 于是进入事务并阻塞在空间行锁上——正是评审指出的 TOCTOU 窗口
    const openPromise = service.openSession(user, spaceId, {
      billingMode: 'timed',
      hourlyRate: 68,
    });
    await delay(150);

    gate.releaseDelete?.();
    await deleteTx;

    await expect(openPromise).rejects.toThrow('空间不存在或已删除');

    const sessionCount = await prisma.spaceSession.count({
      where: { spaceId },
    });
    expect(sessionCount).toBe(0);
  }, 30_000);
});
