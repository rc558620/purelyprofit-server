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
import { PrismaService } from '../../prisma/prisma.service';
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
   * 绑定手机号（微信登录后补绑手机号）
   *
   * 需要 JWT 鉴权。先校验短信验证码，再委托 ClubPhoneBindService 完成绑定。
   *
   * 验证码校验是后续所有合并动作的安全前提：绑定会按手机号查找已有账号并触发
   * 账号合并，若不校验验证码，攻击者填入他人手机号即可把自己的 openid 绑定到
   * 受害者账号上。
   */
  async bindPhone(
    userId: number,
    dto: BindPhoneDto,
  ): Promise<AuthTokenResponseDto> {
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
    return this.clubPhoneBindService.bindVerifiedPhone(userId, dto.phone);
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

    return this.clubPhoneBindService.bindVerifiedPhone(userId, phone);
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
