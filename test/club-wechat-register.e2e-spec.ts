import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ClubAuthService } from '../src/purely-club/auth/club-auth.service';
import { ScanOrderingGateway } from '../src/purely-club/scan-ordering/scan-ordering.gateway';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 真实数据库 E2E：微信「登录即注册」完整链路。
 *
 * 这是唯一一个验证「全新 openid 首次调用真的会建号」的自动化测试——
 * 单测里 AuthProductAuthService 是 mock 的，覆盖不到真实注册链路。
 *
 * 装配方式：直接 import ClubAuthModule（内含 AuthModule），
 * 让 Nest 真实注入 AuthProductAuthService → AuthAuthenticationService →
 * AuthWechatLoginService → AuthPasswordService 整条链，
 * 只把微信 HTTP 接口用 global.fetch 拦掉（否则会真的打到 api.weixin.qq.com）。
 *
 * 依赖真实 PostgreSQL + Redis（Redis 用于 code2session 的 session_key 缓存）。
 */
describe('微信静默注册 (e2e, real database + mocked WeChat API)', () => {
  let prisma: PrismaService;
  let service: ClubAuthService;
  let moduleFixture: TestingModule;

  const realFetch = global.fetch;
  const openidPrefix = `e2e_reg_${randomUUID().slice(0, 8)}_`;

  /** 由 code 反推 openid：让用例可以指定「同一个用户」或「新用户」 */
  const openidForCode = (code: string): string =>
    `${openidPrefix}${code.replace(/[^a-zA-Z0-9]/g, '')}`;

  const jsonResponse = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
    }) as unknown as Response;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      // 直接导入 AppModule：AuthModule 依赖链很深（AuditLog / Membership / Code …
      // 逐个补模块会持续漂移），用生产同款装配最稳，也顺带验证了真实依赖图可启动。
      imports: [AppModule],
    })
      // 测试上下文没有 HTTP server / Socket.IO Namespace，
      // 该网关的 bootstrap 钩子会直接抛错；本用例只调 service、不涉及实时推送
      .overrideProvider(ScanOrderingGateway)
      .useValue({
        onApplicationBootstrap: async () => undefined,
        afterInit: () => undefined,
        server: undefined,
      })
      .compile();

    // 必须显式 init：compile() 不触发生命周期钩子，
    // RedisService 等服务的连接是在 onModuleInit 里建立的
    await moduleFixture.init();

    service = moduleFixture.get(ClubAuthService);
    prisma = moduleFixture.get(PrismaService);
  });

  beforeEach(() => {
    // 拦截微信开放接口，其余外部请求一律失败（暴露意外的真实外呼）
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/sns/jscode2session')) {
        const code = new URL(url).searchParams.get('js_code') ?? '';
        return jsonResponse({
          openid: openidForCode(code),
          session_key: 'e2e-session-key',
        });
      }

      if (url.includes('/cgi-bin/token')) {
        return jsonResponse({
          access_token: 'e2e-access-token',
          expires_in: 7200,
        });
      }

      if (url.includes('/wxa/business/getuserphonenumber')) {
        return jsonResponse({
          errcode: 0,
          errmsg: 'ok',
          phone_info: {
            phoneNumber: '+8613800139900',
            purePhoneNumber: '13800139900',
            countryCode: '86',
          },
        });
      }

      throw new Error(`E2E 拦截到未预期的外部请求：${url}`);
    }) as unknown as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = realFetch;

    const created = await prisma.user.findMany({
      where: { wechatOpenid: { startsWith: openidPrefix } },
      select: { id: true },
    });
    if (created.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: created.map((user) => user.id) } },
      });
    }

    await moduleFixture?.close();
  });

  /** 解出 JWT payload（不验签），用于断言服务端签发的 phone 声明 */
  const decodeJwtPayload = (token: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));

  it('全新 openid 首次调用：自动注册并签发 token，标记需要绑定手机号', async () => {
    const code = 'brand-new-user';

    const result = await service.wechatLogin({ code });

    expect(result.access_token).toBeTruthy();
    expect(result.userId).toBeGreaterThan(0);
    // 新账号没有真实手机号 → 前端据此在提交订单前引导绑定
    expect(result.needPhoneBind).toBe(true);

    const user = await prisma.user.findUnique({
      where: { id: result.userId as number },
      select: {
        email: true,
        wechatOpenid: true,
        wechatPhone: true,
        wechatNickname: true,
      },
    });

    // 账号确实落库，且 email 采用 club_wechat_{openid} 占位格式
    expect(user?.wechatOpenid).toBe(openidForCode(code));
    expect(user?.email).toBe(
      `club_wechat_${openidForCode(code)}@purelyprofit.local`,
    );
    expect(user?.wechatPhone).toBeNull();
  });

  it('JWT 的 phone 声明为 openid 派生标识，保证无手机号也能查会员数据', async () => {
    const code = 'phone-claim';
    const openid = openidForCode(code);

    const result = await service.wechatLogin({ code });
    const payload = decodeJwtPayload(result.access_token);

    // ClubStoreAccessService.resolveMemberPhone 直接用这个值查 Member，
    // 必须等于 buildClubWechatMemberPhone(openid)，否则用户查不到自己的门店
    expect(payload.phone).toBe(`club_wechat:${openid}`);
    expect(payload.accountScope).toBe('purely_club');
  });

  it('同一 openid 再次登录：命中已有账号，不重复建号', async () => {
    const code = 'repeat-login';
    const openid = openidForCode(code);

    const first = await service.wechatLogin({ code });
    const second = await service.wechatLogin({ code });

    expect(second.userId).toBe(first.userId);

    const count = await prisma.user.count({ where: { wechatOpenid: openid } });
    expect(count).toBe(1);
  });

  it('传入 phoneCode 时写入真实手机号，并解除 needPhoneBind', async () => {
    // 预演批次 3（getPhoneNumber）：证明「拿到真实手机号」这条路径本身可用。
    // 注意这里只验证写库与标志位，账号合并/占位迁移由 bindPhone 的用例覆盖。
    const result = await service.wechatLogin({
      code: 'with-phone-code',
      phoneCode: 'e2e-phone-code',
    });

    expect(result.needPhoneBind).toBe(false);

    const user = await prisma.user.findUnique({
      where: { id: result.userId as number },
      select: { wechatPhone: true },
    });
    expect(user?.wechatPhone).toBe('13800139900');

    const payload = decodeJwtPayload(result.access_token);
    // 有真实手机号时 phone 声明切换为真实手机号，
    // 这正是「必须先迁移 Member 占位值」的原因
    expect(payload.phone).toBe('13800139900');
  });

  it('code 无效时透传微信错误语义，不产生脏账号', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ errcode: 40029, errmsg: 'invalid code' }),
    ) as unknown as typeof fetch;

    const countBefore = await prisma.user.count({
      where: { wechatOpenid: { startsWith: openidPrefix } },
    });

    await expect(
      service.wechatLogin({ code: 'invalid-code' }),
    ).rejects.toThrow(/微信登录凭证无效/);

    // 失败路径不得落库：账号数与失败前一致
    const countAfter = await prisma.user.count({
      where: { wechatOpenid: { startsWith: openidPrefix } },
    });
    expect(countAfter).toBe(countBefore);
  });
});
