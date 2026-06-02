import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BLOCK_SUB_ACCOUNT_KEY } from '../decorators/block-sub-account.decorator';
import { SubAccountBlockGuard } from './sub-account-block.guard';

describe('SubAccountBlockGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const guard = new SubAccountBlockGuard(reflector);

  const createContext = (subjectType?: string): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            currentMembership: {
              subjectType,
            },
          },
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('未标记 BlockSubAccount 时直接放行', () => {
    reflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce(undefined);

    expect(guard.canActivate(createContext('sub_account'))).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      BLOCK_SUB_ACCOUNT_KEY,
      expect.any(Array),
    );
  });

  it('子账号访问被封接口时返回默认错误文案', () => {
    reflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(undefined);

    expect(() => guard.canActivate(createContext('sub_account'))).toThrow(
      new ForbiddenException('子账号无权访问门店设置'),
    );
  });

  it('子账号访问被封接口时优先返回自定义错误文案', () => {
    reflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce('子账号无权访问平台会员中心');

    expect(() => guard.canActivate(createContext('sub_account'))).toThrow(
      new ForbiddenException('子账号无权访问平台会员中心'),
    );
  });

  it('主账号访问被封接口时允许通过', () => {
    reflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce('子账号无权访问平台会员中心');

    expect(guard.canActivate(createContext('owner'))).toBe(true);
  });
});
