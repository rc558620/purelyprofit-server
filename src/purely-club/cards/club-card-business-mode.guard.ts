import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CLUB_CARD_CATERING_STORE_UNSUPPORTED_MESSAGE } from './club-cards.constants';

/**
 * 守卫读取的请求载荷。
 *
 * `clubCurrentContext` 与 `ClubCurrentContextInterceptor` 共用同一挂载点：
 * 守卫先于拦截器执行，这里解析后回写，拦截器命中即跳过，
 * 一次请求只解析一次门店上下文。
 */
interface ClubCardContextRequest {
  user?: AuthenticatedUser;
  clubCurrentContext?: ClubCurrentContext;
}

/**
 * C 端会员卡入口的业态门禁：餐饮门店不提供会员卡。
 *
 * 与商家端 `@RequireBusinessMode('general')`（purely-profit/member/cards 三个
 * controller + BusinessModeGuard）是同一业务结论：商家端不给餐饮门店建卡模板，
 * C 端也就不应出现可购卡 / 卡包 / 卡详情。门禁放在 guard 而不是 service，
 * 是为了让「绕过前端直接调 API」同样被拦，且不侵入落账链路。
 *
 * 刻意**不**覆盖微信支付回调：回调走 `ClubCardOrderService.confirmOrderPaidByCallback`，
 * 不经过本控制器。用户下单后门店业态变更不应吞掉已扣款订单的落账，
 * 否则会变成「钱已扣、卡未发」。
 */
@Injectable()
export class ClubCardBusinessModeGuard implements CanActivate {
  constructor(
    private readonly clubCurrentStoreContextService: ClubCurrentStoreContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ClubCardContextRequest>();
    const user = request.user;

    // 控制器已挂 ClubJwtAuthGuard，走到这里仍无登录态说明装配顺序有误
    if (!user) {
      throw new ForbiddenException('请先登录后再操作');
    }

    const currentContext =
      request.clubCurrentContext ??
      (await this.clubCurrentStoreContextService.resolveCurrentContext(user));
    request.clubCurrentContext = currentContext;

    if (currentContext.store.businessMode === 'catering') {
      throw new ForbiddenException(
        CLUB_CARD_CATERING_STORE_UNSUPPORTED_MESSAGE,
      );
    }

    return true;
  }
}
