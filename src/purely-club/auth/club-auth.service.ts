import { Injectable } from '@nestjs/common';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { ClubWechatAuthService } from './club-wechat-auth.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { LoginByCodeDto } from './dto/login-by-code.dto';
import { SendLoginCodeResponseDto } from './dto/send-login-code-response.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

@Injectable()
export class ClubAuthService {
  constructor(
    private readonly authProductAuthService: AuthProductAuthService,
    private readonly clubWechatAuthService: ClubWechatAuthService,
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

    return this.authProductAuthService.wechatLogin(
      {
        openid: wechatResult.openid,
        unionid: wechatResult.unionid,
        nickname: dto.nickname,
        avatar: dto.avatar,
        phone,
      },
      'purely_club',
    );
  }
}
