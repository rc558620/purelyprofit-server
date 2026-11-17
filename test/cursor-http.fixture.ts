/**
 * 游标分页 HTTP 层 e2e 的公共装置：应用引导 + 造数/清理 + 请求工具。
 *
 * 与 spec 分离只为守住「单文件 ≤ 400 行」；本文件不含断言流程，
 * 被 test/cursor-pagination-http.e2e-spec.ts 引入（文件名不匹配 e2e testRegex，不会被当成用例）。
 *
 * 真实度取舍：
 * - 真实 Nest 应用：真实 JwtAuthGuard / PermissionsGuard / ValidationPipe / DTO；
 * - 真实 Prisma 与真实查库服务（FinanceCashFlowService / SalesRecordListService）；
 * - 只把「数据范围解析」类协作者（门店归属、会员期裁剪、汇总缓存）固定返回值，
 *   与 test/cursor-pagination-real-db.e2e-spec.ts 的做法一致。
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import configuration from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AccessControlService } from '../src/purely-profit/access-control/access-control.service';
import { PermissionsGuard } from '../src/purely-profit/access-control/guards/permissions.guard';
import { AuthBanGuardService } from '../src/purely-profit/auth/auth-ban-guard.service';
import { AuthMembershipResolverService } from '../src/purely-profit/auth/auth-membership-resolver.service';
import { AuthSessionService } from '../src/purely-profit/auth/auth-session.service';
import { JwtAuthGuard } from '../src/purely-profit/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/purely-profit/auth/strategies/jwt.strategy';
import { FinanceCashFlowService } from '../src/purely-profit/finance/finance-cash-flow.service';
import { FinanceController } from '../src/purely-profit/finance/finance.controller';
import { FinanceService } from '../src/purely-profit/finance/finance.service';
import { SalesRecordListService } from '../src/purely-profit/operations/sales-record/sales-record-list.service';
import { SalesOrdersCompatController } from '../src/purely-profit/operations/sales-record/sales-record.controller';
import { SalesRecordService } from '../src/purely-profit/operations/sales-record/sales-record.service';

const TEST_JWT_SECRET = 'cursor-http-test-secret';
const jwtService = new JwtService({ secret: TEST_JWT_SECRET });

/** 造数标记：唯一前缀，既是隔离键也是清理依据（刻意只用字母数字，避开 LIKE 元字符） */
export const PROBE_TAG = `cursorhttp${Date.now()}`;
/** 3 条记录共用同一排序键：同排序值多行是游标分页唯一会静默漏读的形状 */
export const SAME_SORT_TIME = new Date('2031-03-03T03:00:00.000Z');
const OLDER_SORT_TIME = new Date('2031-03-02T03:00:00.000Z');
/**
 * 筛选窗口刻意选远期（2031-03）：库里不会有其他数据落在该区间，
 * 因此 total 可以断言为「造数条数」，不受存量数据干扰。
 */
const WINDOW_START = Date.UTC(2031, 2, 1);
const WINDOW_END = Date.UTC(2031, 2, 10);
export const SEED_COUNT = 5;
export const PAGE_SIZE = 2;
const USER_ID = 900001;

export interface CursorScenario {
  name: string;
  /** 拼接完整路径（含查询串） */
  path: (params: Record<string, string | number | undefined>) => string;
  seed: () => Promise<number[]>;
  cleanup: (ids: number[]) => Promise<number>;
}

/** 列表响应契约（items/meta + 游标两字段），用于给翻页循环里的 body 定型 */
export interface CursorPageBody {
  items: Array<{ id: string }>;
  meta: { page: number; pageSize: number; total: number };
  hasMore: boolean;
  nextCursor: string | null;
}

let app: INestApplication<App>;
let prisma: PrismaService;
let storeId = 0;
const seededIds = new Map<string, number[]>();

/** 库里没有可用门店时整组用例跳过（空库 / 无种子数据环境） */
export function hasUsableStore(): boolean {
  return storeId !== 0;
}

/** 把查询参数拼成 query string，undefined 直接跳过（模拟前端「非第一页才带 cursor」） */
export function toQuery(
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** 带 token 发起 GET，返回 supertest 链以便继续断言 */
export function get(path: string): request.Test {
  return request(app.getHttpServer())
    .get(path)
    .set('Authorization', `Bearer ${createToken()}`);
}

function createToken(): string {
  return jwtService.sign({
    sub: USER_ID,
    phone: '13800138000',
    sessionVersion: 0,
    accountScope: 'purely_profit',
  });
}

async function seedCashFlowRecords(): Promise<number[]> {
  const buildRow = (seq: number, sortTime: Date) => ({
    storeId,
    direction: 'income' as const,
    category: 'other_income' as const,
    title: `${PROBE_TAG}-cash-${seq}`,
    amount: 1000 + seq,
    payment: 'cash' as const,
    date: sortTime,
    createdAt: sortTime,
  });

  await prisma.financeCashFlowRecord.createMany({
    data: [
      ...[1, 2, 3].map((seq) => buildRow(seq, SAME_SORT_TIME)),
      ...[4, 5].map((seq) => buildRow(seq, OLDER_SORT_TIME)),
    ],
  });

  const rows = await prisma.financeCashFlowRecord.findMany({
    where: { storeId, title: { startsWith: PROBE_TAG } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => row.id);
}

async function seedSaleOrders(): Promise<number[]> {
  const buildRow = (seq: number, sortTime: Date) => ({
    storeId,
    orderNo: `${PROBE_TAG}-order-${seq}`,
    totalRevenue: 1000 + seq,
    totalProfit: 100,
    totalQuantity: 1,
    paymentMethod: 'cash' as const,
    date: sortTime,
  });

  await prisma.saleOrder.createMany({
    data: [
      ...[1, 2, 3].map((seq) => buildRow(seq, SAME_SORT_TIME)),
      ...[4, 5].map((seq) => buildRow(seq, OLDER_SORT_TIME)),
    ],
  });

  const rows = await prisma.saleOrder.findMany({
    where: { storeId, orderNo: { startsWith: PROBE_TAG } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => row.id);
}

/** 被验证的两个列表接口（均为本轮已迁移游标的契约） */
export const SCENARIOS: CursorScenario[] = [
  {
    name: 'GET /finance/cash-flow/records',
    path: (params) => `/finance/cash-flow/records${toQuery(params)}`,
    seed: seedCashFlowRecords,
    cleanup: async (ids) => {
      const result = await prisma.financeCashFlowRecord.deleteMany({
        where: { id: { in: ids } },
      });
      return result.count;
    },
  },
  {
    name: 'GET /sales/orders',
    path: (params) => `/sales/orders${toQuery(params)}`,
    seed: seedSaleOrders,
    cleanup: async (ids) => {
      const result = await prisma.saleOrder.deleteMany({
        where: { id: { in: ids } },
      });
      return result.count;
    },
  },
];

/** 引导完整 HTTP 应用（真实 guard 链 + 真实 ValidationPipe + 真实 DTO）并造数 */
export async function bootstrapCursorHttpApp(): Promise<void> {
  const configModule: TestingModule = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] })],
  }).compile();
  prisma = new PrismaService(configModule.get(ConfigService));
  await prisma.$connect();
  await configModule.close();

  const store = await prisma.store.findFirst({
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  storeId = store?.id ?? 0;

  // 数据范围协作者固定返回本用例的门店与远期窗口：鉴权/裁剪逻辑不是本用例的验证目标
  const clampWindow = () =>
    Promise.resolve({ start: WINDOW_START, end: WINDOW_END, empty: false });
  const financeCashFlowService = new FinanceCashFlowService(
    prisma,
    {
      getOrLoadRefreshableJson: (options: { loadValue: () => unknown }) =>
        options.loadValue(),
    } as never,
    {} as never,
    {
      getFinanceContext: () =>
        Promise.resolve({
          storeId,
          callerIsSubAccount: false,
          clamp: () => ({ start: WINDOW_START, end: WINDOW_END, empty: false }),
        }),
    } as never,
  );
  const salesRecordListService = new SalesRecordListService(
    prisma,
    { resolveViewStoreId: () => Promise.resolve(storeId) } as never,
    { clampHistoryRange: clampWindow } as never,
    {
      getCachedStats: () =>
        Promise.resolve({
          totalRevenue: 0,
          totalProfit: 0,
          orderCount: 0,
          avgOrderValue: 0,
          compareLastPeriod: null,
        }),
    } as never,
    { get: () => undefined } as never,
  );

  // 鉴权链协作方：用户走缓存命中（不造 user 行），membership 固定为 owner + 两个读权限
  const authBanGuardService = { ensureUserNotBanned: jest.fn() };
  const authMembershipResolverService = {
    resolveAuthenticatedMembership: jest.fn(),
  };
  const authSessionService = {
    getTokenVersion: jest.fn(),
    isSessionActive: jest.fn(),
  };
  const redisService = { getJson: jest.fn(), setJson: jest.fn() };

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: [FinanceController, SalesOrdersCompatController],
    providers: [
      JwtStrategy,
      JwtAuthGuard,
      PermissionsGuard,
      AccessControlService,
      {
        provide: FinanceService,
        useValue: {
          listCashFlowRecords: (user: unknown, query: unknown) =>
            financeCashFlowService.listCashFlowRecords(
              user as never,
              query as never,
            ),
        },
      },
      {
        provide: SalesRecordService,
        useValue: {
          listFrontendOrders: (user: unknown, query: unknown) =>
            salesRecordListService.listFrontendOrders(
              user as never,
              query as never,
            ),
        },
      },
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redisService },
      { provide: AuthBanGuardService, useValue: authBanGuardService },
      {
        provide: AuthMembershipResolverService,
        useValue: authMembershipResolverService,
      },
      { provide: AuthSessionService, useValue: authSessionService },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => {
            if (key === 'jwt.secret') {
              return TEST_JWT_SECRET;
            }
            if (key === 'pulse.devAccountEmails') {
              return [];
            }
            return undefined;
          },
        },
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  redisService.getJson.mockImplementation(() =>
    Promise.resolve({
      id: USER_ID,
      email: 'cursor-http-owner@example.com',
      name: '游标验证老板',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      // 每次都给「刚刚活跃」，避免触发 lastActiveAt 回写（用例不造 user 行）
      lastActiveAt: new Date(),
    }),
  );
  redisService.setJson.mockResolvedValue('OK');
  authBanGuardService.ensureUserNotBanned.mockResolvedValue(undefined);
  authSessionService.getTokenVersion.mockResolvedValue(0);
  authSessionService.isSessionActive.mockResolvedValue(true);
  authMembershipResolverService.resolveAuthenticatedMembership.mockImplementation(
    () =>
      Promise.resolve({
        staffId: 1,
        storeId,
        role: 'OWNER',
        permissions: ['finance:view', 'sales:view', 'space:view'],
        isActive: true,
        subjectType: 'owner',
        linkedEmployeeId: null,
        subAccountId: null,
        subAccountRole: null,
        subAccountStatus: null,
        subAccountAssigned: false,
        canAccessHome: true,
        canUseHandover: true,
      }),
  );

  if (!hasUsableStore()) {
    return;
  }
  for (const scenario of SCENARIOS) {
    const ids = await scenario.seed();
    // 造数自检：确实造出 SEED_COUNT 条，否则后续断言都失去意义
    expect(ids).toHaveLength(SEED_COUNT);
    seededIds.set(scenario.name, ids);
  }
}

/** 清理自己造的数据并关闭连接；删除条数必须等于造数条数 */
export async function teardownCursorHttpApp(): Promise<void> {
  for (const scenario of SCENARIOS) {
    const ids = seededIds.get(scenario.name) ?? [];
    if (ids.length === 0) {
      continue;
    }
    expect(await scenario.cleanup(ids)).toBe(ids.length);
  }
  await prisma.$disconnect();
  // app.close() 会一并关闭其 TestingModule，无需重复 close
  await app.close();
}
