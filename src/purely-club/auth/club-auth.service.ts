import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthCodeService } from '../../purely-profit/auth/auth-code.service';
import { AuthAccountLookupService } from '../../purely-profit/auth/auth-account-lookup.service';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatAuthService } from './club-wechat-auth.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { BindPhoneDto } from './dto/bind-phone.dto';
import { LoginByCodeDto } from './dto/login-by-code.dto';
import { SendLoginCodeResponseDto } from './dto/send-login-code-response.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

const CLUB_WECHAT_PHONE_PREFIX = 'club_wechat:';

@Injectable()
export class ClubAuthService {
  constructor(
    private readonly authProductAuthService: AuthProductAuthService,
    private readonly clubWechatAuthService: ClubWechatAuthService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly authCodeService: AuthCodeService,
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  /**
   * 发送登录即注册验证码
   * 无论手机号是否已注册都发送，不暴露注册状态
   */
  sendLoginCode(dto: SendRegisterCodeDto): Promise<SendLoginCodeResponseDto> {
    return this.authProductAuthService.sendClubLoginOrRegisterCode(dto);
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
    const needPhoneBind = await this.checkNeedPhoneBind(result.access_token);

    return {
      ...result,
      ...(needPhoneBind !== undefined && { needPhoneBind }),
    };
  }

  /**
   * 绑定手机号（微信登录后补绑手机号）
   *
   * 需要 JWT 鉴权。验证短信验证码后：
   * - 若手机号已有账号 → 将当前微信 openid 合并到手机号账号
   * - 若手机号无账号 → 给当前用户写入 wechatPhone
   * 绑定成功后签发新 token
   */
  async bindPhone(
    userId: number,
    dto: BindPhoneDto,
  ): Promise<AuthTokenResponseDto> {
    // 1. 验证短信验证码
    await this.authCodeService.ensureRegisterCodeValid(
      dto.phone,
      dto.code,
      'purely_club',
    );
    await this.authCodeService.clearRegisterCode(dto.phone, 'purely_club');

    // 2. 查询当前用户
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        wechatOpenid: true,
        wechatUnionid: true,
        wechatNickname: true,
        wechatAvatar: true,
      },
    });
    if (!currentUser) {
      throw new NotFoundException('用户不存在');
    }

    // 3. 检查手机号是否已有账号
    const existingPhoneUser =
      await this.authAccountLookupService.findUserByPhone(
        dto.phone,
        'purely_club',
      );

    if (existingPhoneUser && existingPhoneUser.id !== userId) {
      // 手机号已有其他账号：将 openid 合并到手机号账号
      await this.authAccountLookupService.bindWechatToUser(
        existingPhoneUser.id,
        {
          openid: currentUser.wechatOpenid!,
          unionid: currentUser.wechatUnionid ?? undefined,
          nickname: currentUser.wechatNickname ?? undefined,
          avatar: currentUser.wechatAvatar ?? undefined,
          phone: dto.phone,
        },
      );

      // 签发新 token（以手机号账号身份登录）
      return this.authSessionService.signToken(existingPhoneUser.id, {
        phone: dto.phone,
        email: existingPhoneUser.email,
        accountScope: 'purely_club',
      });
    }

    // 4. 手机号无其他账号：直接绑定到当前用户
    await this.prisma.user.update({
      where: { id: userId },
      data: { wechatPhone: dto.phone },
    });

    // 5. 签发新 token（phone 更新为真实手机号）
    return this.authSessionService.signToken(userId, {
      phone: dto.phone,
      email: currentUser.email,
      accountScope: 'purely_club',
    });
  }

  /**
   * 解码 JWT 并查询用户，判断是否需要绑定手机号
   * 若 JWT 无效或查询失败则返回 undefined（不阻断主流程）
   */
  private async checkNeedPhoneBind(
    accessToken: string,
  ): Promise<boolean | undefined> {
    try {
      const decoded = this.jwtService.decode(accessToken) as {
        sub?: number;
      } | null;
      if (!decoded?.sub) return undefined;

      const user = await this.prisma.user.findUnique({
        where: { id: decoded.sub },
        select: { wechatPhone: true },
      });
      if (!user) return undefined;

      // wechatPhone 为空说明尚未绑定真实手机号
      return !user.wechatPhone?.trim();
    } catch {
      return undefined;
    }
  }
}
