import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClubDevLoginGuard } from './club-dev-login.guard';

/**
 * purely-club dev-only 登录守卫。
 *
 * 这里是「生产环境手机号验证码登录不可达」红线的执行点：
 * C 端生产身份完全由微信静默登录决定，登录页在前端生产构建下已不可达，
 * 但接口本身仍可被直接调用，缺少服务端守卫会留下一条后门通道。
 * 守卫必须在参数校验管道之前就把请求拦成 404，
 * 否则生产环境携带非法 body 的探测会拿到 400，反而坐实路由存在。
 */
describe('ClubDevLoginGuard', () => {
  const buildGuard = (nodeEnv: string | undefined): ClubDevLoginGuard =>
    new ClubDevLoginGuard({
      get: jest.fn(() => nodeEnv),
    } as unknown as ConfigService);

  it('生产环境伪装为路由不存在', () => {
    const guard = buildGuard('production');

    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });

  it('未配置 nodeEnv 时按非生产环境放行', () => {
    const guard = buildGuard(undefined);

    expect(guard.canActivate()).toBe(true);
  });

  it('开发与测试环境放行', () => {
    expect(buildGuard('development').canActivate()).toBe(true);
    expect(buildGuard('test').canActivate()).toBe(true);
  });
});
