import { Test, TestingModule } from '@nestjs/testing';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { PulseAuthService } from './pulse-auth.service';

describe('PulseAuthService', () => {
  let service: PulseAuthService;
  let authProductAuthService: AuthProductAuthService;

  const loginMock = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseAuthService,
        { provide: AuthProductAuthService, useValue: { login: loginMock } },
      ],
    }).compile();

    service = module.get<PulseAuthService>(PulseAuthService);
    authProductAuthService = module.get<AuthProductAuthService>(
      AuthProductAuthService,
    );
  });

  it('login 应以 productScope=purely_profit 和 requireDeveloper=true 调用 authProductAuthService', async () => {
    const expected = { access_token: 'jwt-token' };
    loginMock.mockResolvedValue(expected);

    const result = await service.login({
      phone: '13800138000',
      password: 'password123',
    });

    expect(result).toBe(expected);
    expect(authProductAuthService.login).toHaveBeenCalledWith(
      { phone: '13800138000', password: 'password123' },
      { productScope: 'purely_profit', requireDeveloper: true },
    );
  });

  it('login 支持使用账号别名登录', async () => {
    const expected = { access_token: 'jwt-token-admin' };
    loginMock.mockResolvedValue(expected);

    const result = await service.login({
      account: 'admin',
      password: 'admin-password',
    });

    expect(result).toBe(expected);
    expect(authProductAuthService.login).toHaveBeenCalledWith(
      { account: 'admin', password: 'admin-password' },
      { productScope: 'purely_profit', requireDeveloper: true },
    );
  });

  it('login 透传 authProductAuthService 抛出的异常', async () => {
    const error = new Error('账号或密码错误');
    loginMock.mockRejectedValue(error);

    await expect(
      service.login({ phone: '13800138000', password: 'wrong' }),
    ).rejects.toThrow('账号或密码错误');
  });
});
