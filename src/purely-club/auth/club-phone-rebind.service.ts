import { CLUB_AUTH_ERROR_CODE, clubAuthError } from './club-auth.errors';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthCodeVerifyService } from '../../purely-profit/auth/auth-code-verify.service';
import { AuthAccountLookupService } from '../../purely-profit/auth/auth-account-lookup.service';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import { PrismaService, TX_TIMEOUT_LONG } from '../../prisma/prisma.service';
import { ClubStoreAccessService } from '../stores/club-store-access.service';
import {
  ClubPhoneRebindChange,
  ClubPhoneRebindProfilesService,
} from './club-phone-rebind-profiles.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { RebindPhoneDto } from './dto/rebind-phone.dto';

/** 换绑手机号冷静期（天）：同一账号在该期间内只能换绑一次 */
const CLUB_PHONE_REBIND_COOLDOWN_DAYS = 30;
const CLUB_PHONE_REBIND_COOLDOWN_MS =
  CLUB_PHONE_REBIND_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 手机号换绑：已绑定手机号的用户更换联系方式。
 *
 * 与「首次绑定」（ClubPhoneBindService）的三点关键差异：
 *
 * 1. **不触发账号合并**。新手机号若已属于其他账号，直接拒绝。绑定接口的合并
 *    语义是「找回账号」，换绑的语义是「更新联系方式」——在换绑里合并会吃掉
 *    另一个账号的档案与资产。
 * 2. **只校验新手机号**。用户换号后旧号已经收不到短信，要求校验旧号等于功能
 *    不可用。安全性由「已登录（openid + JWT）」与 30 天冷静期共同保证。
 * 3. **主锚点是 clubUserId，绝不按 phone 批量更新**。旧手机号是真实号码，可能
 *    同时属于其他用户（历史数据、重复导入），按 phone 批量更新会串改他人档案。
 *    `Member` 与 `MarketingCustomer` 现在都有 `clubUserId`（members 那列由迁移
 *    20261007000000 新增、20261007000100 回填，与
 *    `ClubStoreAccessService.buildMemberIdentityWhere` 的第 1 层同源），按它更新
 *    既能覆盖全部门店，也碰不到他人档案。仍无 `clubUserId` 的存量档案才按
 *    `(storeId, phone)` 兜底，且必须「同店唯一命中」才改（见
 *    `ClubPhoneRebindProfilesService.resolveUnboundMemberIds`）。
 *    （首次绑定可以按 phone 更新，是因为占位值 `club_wechat:{openid}` 由 openid
 *    派生、在同一 appid 内天然唯一。）
 *
 * 本类只做「校验 → 事务编排 → 缓存与登录态轮换」；事务内的档案同步（认领孤儿、
 * 门店范围、唯一性校验、批量改号）全部下沉到 `ClubPhoneRebindProfilesService`。
 */
@Injectable()
export class ClubPhoneRebindService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authCodeVerifyService: AuthCodeVerifyService,
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authSessionService: AuthSessionService,
    private readonly storeAccessService: ClubStoreAccessService,
    private readonly profilesService: ClubPhoneRebindProfilesService,
  ) {}

  /**
   * 换绑手机号。
   *
   * 必须同步三处，漏任何一处都会立刻出问题：
   *
   * | 字段 | 漏同步的后果 |
   * |---|---|
   * | `users.wechat_phone` | `needPhoneBind` 判定与后续登录的 phone 来源不更新 |
   * | `Member.phone` | `findAccessibleStores` 的两层匹配（`clubUserId` 优先、`phone` 兜底）里，无主档案只有 `phone` 这条路 → 漏同步就**立刻失去全部门店访问权** |
   * | `MarketingCustomer.phone` | 商家端（purelyProfit）仍展示、检索旧号 |
   *
   * 另外 JWT 的 `phone` 参与 `Member` 匹配，因此成功后必须**重新签发 token**，
   * 并把旧的 access_token / refresh_token 一并作废 —— 只换发新的话，旧的那份
   * 仍能在剩余有效期内带旧号访问（见 `invalidatePreviousSessions` 的说明）。
   */
  async rebindPhone(
    userId: number,
    dto: RebindPhoneDto,
  ): Promise<AuthTokenResponseDto> {
    // 1. 当前用户
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        wechatPhone: true,
        phoneRebindAt: true,
      },
    });
    if (!currentUser) {
      throw new NotFoundException(
        clubAuthError(
          CLUB_AUTH_ERROR_CODE.RESOURCE_USER_NOT_FOUND,
          '用户不存在',
        ),
      );
    }

    const previousPhone = currentUser.wechatPhone?.trim() ?? '';
    if (!previousPhone) {
      // 未绑定过手机号：应走 bindPhone（可能触发账号合并），而不是换绑
      throw new ConflictException(
        clubAuthError(
          CLUB_AUTH_ERROR_CODE.STATUS_PHONE_NOT_BOUND,
          '当前账号尚未绑定手机号，请先绑定手机号',
        ),
      );
    }
    if (previousPhone === dto.phone) {
      throw new ConflictException(
        clubAuthError(
          CLUB_AUTH_ERROR_CODE.PARAM_NEW_PHONE_SAME_AS_CURRENT,
          '新手机号与当前手机号相同',
        ),
      );
    }

    // 2. 新手机号不能已属于其他账号 —— 拒绝，绝不合并（见类注释第 1 点）
    const existingPhoneUser =
      await this.authAccountLookupService.findUserByPhone(
        dto.phone,
        'purely_club',
      );
    if (existingPhoneUser && existingPhoneUser.id !== userId) {
      throw new ConflictException(
        clubAuthError(
          CLUB_AUTH_ERROR_CODE.STATUS_PHONE_BOUND_BY_OTHER_ACCOUNT,
          '该手机号已绑定其他账号，请更换手机号',
        ),
      );
    }

    // 跨产品线唯一：注册 / 登录即注册 / 微信登录都走
    // `assertPhoneNotRegisteredInOtherScope`，换绑原先漏了这一道，于是可以把一个
    // 商家端（purely_profit）在用的号码挂到 club 账号上，同号落进两条产品线。
    // 排在验证码消费之前：它与验证码无关，先消费会白白损失一条短信。
    await this.authAccountLookupService.assertPhoneNotRegisteredInOtherScope(
      dto.phone,
      'purely_club',
    );

    // 3. 冷静期
    this.assertRebindAllowed(currentUser.phoneRebindAt);

    // 4. 校验新手机号归属（一次性消费）。
    //
    // 刻意排在「同号 / 他人占用 / 冷静期」这些**确定性校验之后**：这些失败都与
    // 验证码无关，先消费验证码会让用户白白损失一次短信（必须重新获取才能再试）。
    await this.authCodeVerifyService.ensureRegisterCodeValid(
      dto.phone,
      dto.code,
      'purely_club',
    );
    await this.authCodeVerifyService.clearRegisterCode(
      dto.phone,
      'purely_club',
    );

    // 5. 事务内同步三处。
    //
    // 顺序刻意**先认领 + 校验，再写 users**：任何一步失败都会整事务回滚，
    // 不会出现「users 已换号、顾客档案没跟上」的半截状态。
    const change: ClubPhoneRebindChange = {
      userId,
      previousPhone,
      nextPhone: dto.phone,
    };
    await this.prisma.$transaction(
      async (tx) => {
        const storeIds = await this.profilesService.prepareRebindTargets(
          tx,
          change,
        );

        await tx.user.update({
          where: { id: userId },
          data: { wechatPhone: dto.phone, phoneRebindAt: new Date() },
        });

        await this.profilesService.syncPhoneAcrossProfiles(
          tx,
          change,
          storeIds,
        );
      },
      { timeout: TX_TIMEOUT_LONG },
    );

    // 6. 清「可访问门店」缓存：其内容是按旧手机号匹配 Member 得到的
    await this.storeAccessService.invalidateAccessibleStoresCache(userId);

    // 7. 作废旧登录态，再签发新 token（顺序不能颠倒，理由见方法注释）
    await this.invalidatePreviousSessions(userId);

    return this.authSessionService.signToken(userId, {
      phone: dto.phone,
      email: currentUser.email,
      accountScope: 'purely_club',
    });
  }

  /**
   * 作废旧登录态，为第 7 步的重新签发腾干净场地。
   *
   * JWT 的 `phone` 参与 `Member` 匹配，换绑前的旧 token 带着旧手机号，两条路都要堵：
   *
   * | 遗留物 | 不处理的后果 | 失效手段 |
   * |---|---|---|
   * | 旧 access_token | 7 天内仍带旧号查门店 | `bumpTokenVersion` → JwtStrategy 判定 `sessionVersion` 落后即失效 |
   * | 旧 refresh_token | Redis payload 冻结的是**签发那一刻**的 phone，`refreshAccessToken` 会据此签出一个带旧号的 access_token | `removeAllSessions` → 连同会话一起从 Redis 抹掉 |
   *
   * 只 bump 版本挡不住第二条路：用户会在 access_token 过期后「refresh 成功了，
   * 但依然查不到门店」，而且是静默的——前端 local token 明明已经换成新的。
   * 封禁成员（membership-access.service）面对同样的问题，也是这两步一起做。
   *
   * ⚠️ 顺序必须严格是「先作废、再签发」，反过来会把刚签出来的新 token 连带废掉：
   * - 晚于 `signToken` 的 bump，会让新 access_token 的 `sessionVersion` 落后于
   *   最新版本号，签发出来的瞬间即失效；
   * - `removeAllSessions` 按 userId 删 Redis 里的 refresh_token，晚于 `signToken`
   *   执行会把新的那份一并删除，用户从此再无法续期。
   */
  private async invalidatePreviousSessions(userId: number): Promise<void> {
    await this.authSessionService.bumpTokenVersion(userId);
    await this.authSessionService.removeAllSessions(userId);
  }

  /**
   * 换绑冷静期校验。
   *
   * 换绑只校验新号（旧号可能已作废），因此需要一道频率闸门：账号若被他人短暂
   * 拿到（手机借人、微信仍处于登录态），对方改号后商家端所有触达都会打到对方
   * 手机上。正常用户换号频率极低，30 天限制对真实场景无感。
   */
  private assertRebindAllowed(rebindAt: Date | null): void {
    if (!rebindAt) return;

    const elapsed = Date.now() - rebindAt.getTime();
    if (elapsed >= CLUB_PHONE_REBIND_COOLDOWN_MS) return;

    const remainingDays = Math.ceil(
      (CLUB_PHONE_REBIND_COOLDOWN_MS - elapsed) / MS_PER_DAY,
    );
    throw new ConflictException(
      clubAuthError(
        CLUB_AUTH_ERROR_CODE.RULE_REBIND_COOLDOWN,
        `手机号换绑过于频繁，请 ${remainingDays} 天后再试`,
      ),
    );
  }
}
