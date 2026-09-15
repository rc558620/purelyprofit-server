import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MEMBERSHIP_EXPIRED_ERROR_CODE,
  MembershipDowngradeService,
} from '../member/platform-membership/membership-downgrade.service';
import { AuthMembershipQueryService } from './auth-membership-query.service';

/**
 * 子账号因主账号会员到期被拒绝登录时的提示文案。
 *
 * 子账号没有续费入口（平台会员中心接口对子账号整体封闭），所以文案必须
 * 明确指向接续方，否则收银员会卡在「登不上去、又不知道找谁」。
 */
export const SUB_ACCOUNT_MEMBERSHIP_EXPIRED_MESSAGE =
  '门店会员已到期，子账号暂时无法登录，请联系主账号续费后再试';

/**
 * 登录前置校验：主账号会员到期后拒绝名下子账号登录。
 *
 * 为什么要在登录入口拦，而不是继续靠业务接口的 403：
 *
 * 1. 子账号拿不到会员态（`/platform-membership/*` 上有 `@BlockSubAccount`），
 *    前端只能落到「免费版」默认值，于是到期横幅、降级提示、路由能力守卫
 *    对子账号全部静默失效——子账号看到的是一个「一切正常」的界面；
 * 2. 直到它真正开台 / 录单时才会被后端按 storeId 拦下，而那句文案是对店主
 *    说的（「续费后可同时开多个台」），子账号既看不懂也无法执行；
 * 3. 子账号自己没有任何续费出路，只能下线找店主。
 *
 * 因此改为登录即拒绝，登录页以 toast 讲清「门店到期了、去找主账号续费」——
 * 文案随 403 响应体返回，前端全局拦截器直接用 message 弹出，无需页面侧定制。
 */
@Injectable()
export class AuthMembershipLoginGuardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membershipQueryService: AuthMembershipQueryService,
    private readonly membershipDowngradeService: MembershipDowngradeService,
  ) {}

  /**
   * 门店会员到期后拒绝子账号登录。
   *
   * 判定沿用封禁检查的约定：只有当用户**全部**子账号门店都已到期时才拒绝，
   * 保证在其它门店仍有有效身份的子账号不受影响。
   */
  async ensureSubAccountLoginAllowed(userId: number): Promise<void> {
    const subAccountStoreIds = await this.findSubAccountStoreIds(userId);
    if (subAccountStoreIds.length === 0) {
      // 纯主账号（或未建成子账号的员工账号）：不受此限制
      return;
    }

    const downgradeStates = await Promise.all(
      subAccountStoreIds.map((storeId) =>
        this.membershipDowngradeService.getDowngradeState(storeId),
      ),
    );

    // 还有未到期的门店：该子账号仍有可用工作台，放行
    if (downgradeStates.some((state) => !state.isExpired)) {
      return;
    }

    // 到期门店的店主必须能登录去续费：避免「本人是多店店主、同时又是某到期
    // 门店的子账号」被锁死在门外
    if (await this.ownsActiveStore(userId)) {
      return;
    }

    throw new ForbiddenException({
      statusCode: 403,
      message: SUB_ACCOUNT_MEMBERSHIP_EXPIRED_MESSAGE,
      code: MEMBERSHIP_EXPIRED_ERROR_CODE,
    });
  }

  /**
   * 找出用户「此刻确实会以子账号身份进入工作台」的门店。
   *
   * 复用会员上下文查询，口径与鉴权保持一致（status=active + 已分配 +
   * 可进首页），历史脏数据不会把主账号误判成子账号。
   */
  private async findSubAccountStoreIds(userId: number): Promise<number[]> {
    const rows =
      await this.membershipQueryService.findMembershipRowsByUserId(userId);

    const storeIds = new Set<number>();
    for (const row of rows) {
      if (row.subAccountId != null) {
        storeIds.add(row.storeId);
      }
    }

    return [...storeIds];
  }

  private async ownsActiveStore(userId: number): Promise<boolean> {
    const ownedStoreCount = await this.prisma.store.count({
      where: { ownerId: userId, deletedAt: null },
    });

    return ownedStoreCount > 0;
  }
}
