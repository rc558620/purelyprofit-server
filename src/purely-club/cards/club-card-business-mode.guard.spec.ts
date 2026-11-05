// C 端会员卡业态门禁：餐饮门店整块 403，非餐饮门店放行且复用已解析上下文
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCardBusinessModeGuard } from './club-card-business-mode.guard';
import type { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CLUB_CARD_CATERING_STORE_UNSUPPORTED_MESSAGE } from './club-cards.constants';

const USER = { id: 11, phone: '13800000000' } as AuthenticatedUser;

const buildContext = (
  businessMode: 'catering' | 'general',
): ClubCurrentContext =>
  ({
    user: USER,
    store: { id: 9, name: '测试门店', businessMode },
  }) as unknown as ClubCurrentContext;

/** 只实现 guard 用到的 switchToHttp().getRequest() */
const buildExecutionContext = (request: {
  user?: AuthenticatedUser;
  clubCurrentContext?: ClubCurrentContext;
}): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const buildGuard = (currentContext: ClubCurrentContext) => {
  const resolveCurrentContext = jest.fn().mockResolvedValue(currentContext);
  const guard = new ClubCardBusinessModeGuard({
    resolveCurrentContext,
  } as unknown as ClubCurrentStoreContextService);

  return { guard, resolveCurrentContext };
};

describe('ClubCardBusinessModeGuard', () => {
  it('非餐饮门店放行，并把上下文回写给后续拦截器', async () => {
    const { guard } = buildGuard(buildContext('general'));
    const request: {
      user?: AuthenticatedUser;
      clubCurrentContext?: ClubCurrentContext;
    } = { user: USER };

    await expect(
      guard.canActivate(buildExecutionContext(request)),
    ).resolves.toBe(true);
    expect(request.clubCurrentContext?.store.businessMode).toBe('general');
  });

  it('餐饮门店抛 403 并使用统一文案', async () => {
    const { guard } = buildGuard(buildContext('catering'));

    await expect(
      guard.canActivate(buildExecutionContext({ user: USER })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      guard.canActivate(buildExecutionContext({ user: USER })),
    ).rejects.toThrow(CLUB_CARD_CATERING_STORE_UNSUPPORTED_MESSAGE);
  });

  it('已由上游挂载上下文时不重复解析门店', async () => {
    const { guard, resolveCurrentContext } = buildGuard(
      buildContext('general'),
    );
    const request = { user: USER, clubCurrentContext: buildContext('general') };

    await guard.canActivate(buildExecutionContext(request));

    expect(resolveCurrentContext).not.toHaveBeenCalled();
  });

  it('无登录态时拒绝，不触发门店解析', async () => {
    const { guard, resolveCurrentContext } = buildGuard(
      buildContext('general'),
    );

    await expect(
      guard.canActivate(
        buildExecutionContext({ clubCurrentContext: undefined }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(resolveCurrentContext).not.toHaveBeenCalled();
  });
});
