import {
  ConflictException,
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthCodeVerifyService } from '../../purely-profit/auth/auth-code-verify.service';
import {
  isMainlandMobilePhone,
  normalizePhone,
} from '../../purely-profit/auth/auth.utils';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { NewCustomerQuotaService } from '../../purely-profit/member/new-customer-quota/new-customer-quota.service';
import type { NewCustomerQuotaCheckResult } from '../../purely-profit/member/new-customer-quota/new-customer-quota.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ClubPhoneBindService } from './club-phone-bind.service';
import { ClubPhoneRebindService } from './club-phone-rebind.service';
import { ClubWechatAuthService } from './club-wechat-auth.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { BindPhoneByWechatCodeDto } from './dto/bind-phone-by-wechat-code.dto';
import { BindPhoneDto } from './dto/bind-phone.dto';
import { LoginByCodeDto } from './dto/login-by-code.dto';
import { RebindPhoneDto } from './dto/rebind-phone.dto';
import { SendLoginCodeResponseDto } from './dto/send-login-code-response.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

/**
 * C 端（purelyClub）认证入口。
 *
 * 本类只做「入口编排」：验证码发送、登录即注册、微信登录、以及把手机号相关的
 * 落库动作委派给专职服务：
 * - `ClubPhoneBindService`：首次绑定（写 wechat_phone / 迁移占位号 / 账号合并）
 * - `ClubPhoneRebindService`：换绑（三处同步 + 冷静期）
 */
@Injectable()
export class ClubAuthService {
  private readonly logger = new Logger(ClubAuthService.name);

  constructor(
    private readonly authProductAuthService: AuthProductAuthService,
    private readonly clubWechatAuthService: ClubWechatAuthService,
    private readonly prisma: PrismaService,
    private readonly authCodeVerifyService: AuthCodeVerifyService,
    private readonly clubPhoneBindService: ClubPhoneBindService,
    private readonly clubPhoneRebindService: ClubPhoneRebindService,
    private readonly configService: ConfigService,
    private readonly quotaService: NewCustomerQuotaService,
    private readonly clubCurrentStoreContextService: ClubCurrentStoreContextService,
  ) {}

  /**
   * 发送登录即注册验证码
   * 无论手机号是否已注册都发送，不暴露注册状态
   */
  sendLoginCode(dto: SendRegisterCodeDto): Promise<SendLoginCodeResponseDto> {
    return this.authProductAuthService.sendClubLoginOrRegisterCode({
      phone: dto.phone,
      captchaToken: dto.captchaToken,
    });
  }

  /**
   * 发送绑定手机号验证码
   * 无论手机号是否已注册都发送，不暴露注册状态
   * 需要 JWT 鉴权，仅允许已登录用户调用
   */
  sendBindPhoneCode(
    dto: SendRegisterCodeDto,
  ): Promise<SendLoginCodeResponseDto> {
    return this.authProductAuthService.sendBindPhoneCode({
      phone: dto.phone,
      captchaToken: dto.captchaToken,
    });
  }

  /**
   * 手机号验证码登录即注册
   * 账号不存在时自动创建，省去单独注册步骤
   */
  loginByCode(dto: LoginByCodeDto): Promise<AuthTokenResponseDto> {
    return this.authProductAuthService.loginByCodeOrRegister(
      dto,
      'purely_club',
    );
  }

  /**
   * 微信小程序登录即注册
   *
   * 流程：
   * 1. code2session：wx.login() 的 code → openid / session_key
   * 2. （可选）getPhoneNumber：phoneCode → 真实手机号（用于账号合并）
   * 3. wechatLogin：openid + 手机号 → 已有账号则登录并合并；无则自动注册
   * 4. 检查是否需要绑定手机号：若账号尚无真实手机号，返回 needPhoneBind=true
   */
  async wechatLogin(dto: WechatLoginDto): Promise<AuthTokenResponseDto> {
    const wechatResult = await this.clubWechatAuthService.code2session(
      dto.code,
    );

    // 若前端传入了手机号授权 code，解密获取真实手机号
    let phone: string | undefined;
    if (dto.phoneCode) {
      const phoneResult = await this.clubWechatAuthService.getPhoneNumber(
        dto.phoneCode,
      );
      phone = phoneResult.purePhoneNumber;
    }

    const result = await this.authProductAuthService.wechatLogin(
      {
        openid: wechatResult.openid,
        unionid: wechatResult.unionid,
        nickname: dto.nickname,
        avatar: dto.avatar,
        phone,
      },
      'purely_club',
    );

    // 登录完成后检查用户是否需要绑定手机号
    const needPhoneBind = result.userId
      ? await this.checkNeedPhoneBind(result.userId)
      : undefined;

    return {
      ...result,
      ...(needPhoneBind !== undefined && { needPhoneBind }),
    };
  }

  /**
   * 绑定手机号（微信登录后补绑手机号，短信验证码链路）
   *
   * 需要 JWT 鉴权。先过新客额度闸门，再校验短信验证码，最后委托
   * ClubPhoneBindService 完成绑定。
   *
   * 验证码校验是后续所有合并动作的安全前提：绑定会按手机号查找已有账号并触发
   * 账号合并，若不校验验证码，攻击者填入他人手机号即可把自己的 openid 绑定到
   * 受害者账号上。
   *
   * ⚠️ 额度闸门**不能省**：微信入口 `auth.wechatPhoneBindEnabled` 未开启时前端会
   * 撤掉一键授权按钮、展开短信表单，若这里不拦，「改走短信」就是一条完整的绕过
   * 路径——额度一旦耗尽仍能建档消费。闸门必须前置到验证码校验之前，避免被拦时
   * 白白消耗掉一次性且按条计费的验证码。
   */
  async bindPhone(
    userId: number,
    dto: BindPhoneDto,
    /** 当前登录用户：用于解析额度归属门店，缺省时不触发额度校验（历史/测试调用路径） */
    currentUser?: AuthenticatedUser,
  ): Promise<AuthTokenResponseDto> {
    const storeId = await this.assertQuotaAvailableForBind(
      currentUser,
      dto.sessionId,
    );

    // 1. 验证短信验证码（一次性消费）
    await this.authCodeVerifyService.ensureRegisterCodeValid(
      dto.phone,
      dto.code,
      'purely_club',
    );
    await this.authCodeVerifyService.clearRegisterCode(
      dto.phone,
      'purely_club',
    );

    // 2. 委托统一绑定实现
    const result = await this.clubPhoneBindService.bindVerifiedPhone(
      userId,
      dto.phone,
    );

    // 3. 绑定成功后扣减：同一顾客在同一门店只扣一次（consume 内部按 clubUserId 幂等）
    if (storeId !== null) {
      await this.consumeQuotaForNewCustomer(
        storeId,
        currentUser?.id ?? userId,
        dto.phone,
      );
    }

    return result;
  }

  /**
   * 微信 getPhoneNumber 一键绑定手机号（批次 3 入口）。
   *
   * 与短信验证码绑定（`bindPhone`）的差异**只在「如何证明手机号归属」**：
   * - `bindPhone`：用户手输号码 + 短信验证码；
   * - 本方法：微信官方授权，服务端用 access_token 换取手机号，**无需短信**。
   *
   * 两者拿到手机号之后走完全相同的 `bindVerifiedPhone`，核心逻辑不重复实现。
   *
   * ⚠️ **不能复用 `login/wechat { phoneCode }`**：那条路对「已存在用户」走的是
   * existingUser 分支，只写 `wechat_phone` 而不迁移占位档案，且签发 token 用的是
   * **更新前**的 phone——会同时踩中批次 2 修好的两个坑（丢门店 + 商家端拿不到手机号）。
   *
   * 为什么这里**不校验短信验证码**：手机号归属由微信背书，服务端用 access_token
   * 才能兑换 code，且本接口要求 JWT 鉴权——攻击者即便拿到自己的 code，
   * 也只能绑定到自己的账号上，无法像短信路径那样「填入他人手机号触发合并」。
   */
  async bindPhoneByWechatCode(
    userId: number,
    dto: BindPhoneByWechatCodeDto,
    /** 当前登录用户：用于解析额度归属门店，缺省时不触发额度校验（历史/测试调用路径） */
    currentUser?: AuthenticatedUser,
  ): Promise<AuthTokenResponseDto> {
    // 该能力要求小程序已通过微信认证（个人主体不可用），默认关闭。
    // 认证通过后只需打开 auth.wechatPhoneBindEnabled，无需改代码。
    const enabled = this.configService.get<boolean>(
      'auth.wechatPhoneBindEnabled',
    );
    if (enabled !== true) {
      throw new NotImplementedException(
        '该入口暂未开放，请使用短信验证码绑定手机号',
      );
    }

    // 新用户额度预检：必须在调用微信 getPhoneNumber 之前完成。
    // 微信按次计费（0.03 元/次），先扣量再调接口才能避免无意义的成本支出。
    //
    // 仅对「本店新客」生效：老顾客换设备 / 重新绑定不应被额度拦住。
    const storeId = await this.assertQuotaAvailableForBind(
      currentUser,
      dto.sessionId,
    );

    const phoneResult = await this.clubWechatAuthService.getPhoneNumber(
      dto.code,
    );
    const phone = normalizePhone(phoneResult.purePhoneNumber);

    // 海外号码 / 异常返回值不进入绑定流程，避免写出不合规的档案
    if (!isMainlandMobilePhone(phone)) {
      this.logger.warn(
        `bindPhoneByWechatCode 获取到非大陆手机号，user ${userId}`,
      );
      throw new ConflictException(
        '未能获取到有效的手机号，请改用短信验证码绑定',
      );
    }

    const result = await this.clubPhoneBindService.bindVerifiedPhone(
      userId,
      phone,
    );

    // 绑定成功后扣减：同一顾客在同一门店只扣一次（consume 内部按 clubUserId 幂等）。
    if (storeId !== null) {
      await this.consumeQuotaForNewCustomer(
        storeId,
        currentUser?.id ?? userId,
        phone,
      );
    }

    return result;
  }

  /**
   * C 端新用户额度预检：告知前端「当前顾客是否本店新客」以及「额度是否阻止其下单」。
   *
   * 关键语义：blocked **只对新客为真**。老顾客已在消耗表中留痕，不应被额度拦住，
   * 否则门店额度一旦耗尽，老客也会被一并挡在门外。
   *
   * @param sessionId 扫码点餐会话 ID。传了就以会话所属门店为准——
   *   「当前选中门店」与「扫码进的那家店」是两回事，用错会把额度算到别的门店。
   */
  async getNewCustomerQuotaStatus(
    user: AuthenticatedUser,
    sessionId?: number | null,
  ): Promise<NewCustomerQuotaCheckResult> {
    const storeId = sessionId
      ? await this.resolveStoreIdBySessionId(sessionId, user.id)
      : await this.resolveQuotaStoreId(user);
    if (storeId === null) {
      return { isNewCustomer: false, blocked: false, remaining: 0 };
    }

    const isNewCustomer = await this.quotaService.isNewCustomer(
      storeId,
      user.id,
    );
    const overview = await this.quotaService.getOverview(storeId);
    return {
      isNewCustomer,
      blocked: isNewCustomer && overview.remaining <= 0,
      remaining: overview.remaining,
    };
  }

  /**
   * 由扫码点餐会话解析门店：会话与 clubUserId 绑定，取到的 storeId 就是
   * 用户扫码进的那家店，不受「当前选中门店」影响。
   *
   * 会话不存在 / 不属于该用户 / 已结束 → 返回 null，按「不拦截」处理。
   */
  private async resolveStoreIdBySessionId(
    sessionId: number,
    clubUserId: number,
  ): Promise<number | null> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        id: sessionId,
        clubUserId,
        status: 'active',
        deletedAt: null,
      },
      select: { storeId: true },
    });
    return session?.storeId ?? null;
  }

  /**
   * 解析额度归属门店。
   *
   * `@param sessionId` 优先：用户可能是在扫码点餐流程中被引导来绑手机的，
   * 此时「当前选中门店」与「扫码进的那家店」是两回事，必须用后者，否则额度
   * 会记到别的门店头上。缺省（从个人中心进入绑定页等）时才退回「当前选中门店」。
   * 两者都取不到（未加入任何门店）时不拦截也不扣减，返回 null。
   */
  private async resolveQuotaStoreId(
    user: AuthenticatedUser,
    sessionId?: number | null,
  ): Promise<number | null> {
    if (sessionId !== null && sessionId !== undefined && sessionId > 0) {
      return this.resolveStoreIdBySessionId(sessionId, user.id);
    }

    try {
      const store =
        await this.clubCurrentStoreContextService.getCurrentStore(user);
      return store.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 绑定前的额度闸门：两条绑定链路（短信 / 微信 getPhoneNumber）共用。
   *
   * 仅对「本店新客」生效，老顾客换设备 / 重新绑定不会被额度拦住。
   *
   * @returns 额度归属门店，供绑定成功后扣减复用；null 表示定位不到门店，
   *   按「不拦截也不扣减」处理（绑定本身是账号级操作，不能因为额度查不到就拒绝）
   */
  private async assertQuotaAvailableForBind(
    currentUser: AuthenticatedUser | undefined,
    sessionId?: number | null,
  ): Promise<number | null> {
    if (currentUser === undefined) return null;

    const storeId = await this.resolveQuotaStoreId(currentUser, sessionId);
    if (storeId === null) return null;

    await this.quotaService.ensureAvailableForNewCustomer(
      storeId,
      currentUser.id,
    );
    return storeId;
  }

  /**
   * 新客扣减：由 `consumeForNewCustomer` 按 clubUserId 保证幂等，
   * 老顾客重复绑定 / 重复下单都不会重复扣；额度意外耗尽时只记日志，不阻断主流程。
   */
  private async consumeQuotaForNewCustomer(
    storeId: number,
    clubUserId: number,
    phone: string,
  ): Promise<void> {
    try {
      await this.quotaService.consumeForNewCustomer(storeId, clubUserId, phone);
    } catch (error) {
      this.logger.warn(
        `新用户额度扣减失败，store ${storeId} user ${clubUserId}：${String(error)}`,
      );
    }
  }

  /** 换绑手机号：完整语义见 ClubPhoneRebindService */
  rebindPhone(
    userId: number,
    dto: RebindPhoneDto,
  ): Promise<AuthTokenResponseDto> {
    return this.clubPhoneRebindService.rebindPhone(userId, dto);
  }

  /**
   * 查询用户是否需要绑定手机号
   * 若查询失败则返回 undefined（不阻断主流程）
   */
  private async checkNeedPhoneBind(
    userId: number,
  ): Promise<boolean | undefined> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { wechatPhone: true },
      });
      if (!user) return undefined;

      // wechatPhone 为空说明尚未绑定真实手机号
      return !user.wechatPhone?.trim();
    } catch (error: unknown) {
      this.logger.warn(
        `检查用户 ${userId} 手机绑定状态失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}
