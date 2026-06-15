import { Injectable } from '@nestjs/common';
import { AuthAuthenticationService } from '../../purely-profit/auth/auth-authentication.service';
import { AuthCodeService } from '../../purely-profit/auth/auth-code.service';
import type { AuthProductScope } from './auth-account.types';
import type {
  LoginAuthParams,
  LoginByCodeOrRegisterAuthParams,
  RegisterAuthParams,
  ResetPasswordAuthParams,
  WechatLoginAuthParams,
} from './auth-password.types';
import { normalizePhone } from './auth-phone.utils';

export interface AuthProductLoginOptions {
  productScope: AuthProductScope;
  requireDeveloper?: boolean;
}

export interface AuthPhonePayload {
  phone: string;
}

export interface AuthRegisterPayload extends AuthPhonePayload {
  code: string;
  password: string;
  confirmPassword?: string;
  name?: string;
}

export interface AuthLoginPayload {
  phone?: string;
  account?: string;
  password: string;
}

export interface AuthLoginByCodePayload extends AuthPhonePayload {
  code: string;
}

export interface AuthResetPasswordPayload extends AuthLoginByCodePayload {
  password: string;
  confirmPassword?: string;
}

export interface AuthTokenResult {
  access_token: string;
}

export interface SendRegisterCodeResult {
  message: string;
  expiresInSeconds: number;
  code?: string;
}

export interface SendLoginCodeResult {
  message: string;
  expiresInSeconds: number;
  code?: string;
}

export interface ForgotPasswordResult {
  message: string;
  expiresInSeconds: number;
  resetCode?: string;
}

export interface PasswordOperationResult {
  message: string;
  access_token: string;
}

@Injectable()
export class AuthProductAuthService {
  constructor(
    private readonly authAuthenticationService: AuthAuthenticationService,
    private readonly authCodeService: AuthCodeService,
  ) {}

  async sendRegisterCode(
    payload: AuthPhonePayload,
    productScope: AuthProductScope,
  ): Promise<SendRegisterCodeResult> {
    return this.authCodeService.sendRegisterCode(
      normalizePhone(payload.phone),
      productScope,
    );
  }

  async sendLoginCode(
    payload: AuthPhonePayload,
    productScope: AuthProductScope,
  ): Promise<SendLoginCodeResult> {
    return this.authCodeService.sendLoginCode(
      normalizePhone(payload.phone),
      productScope,
    );
  }

  async register(
    payload: AuthRegisterPayload,
    productScope: AuthProductScope,
  ): Promise<AuthTokenResult> {
    const params: RegisterAuthParams = {
      phone: normalizePhone(payload.phone),
      code: payload.code,
      password: payload.password,
      confirmPassword: payload.confirmPassword,
      name: payload.name,
      productScope,
    };

    return this.authAuthenticationService.register(params);
  }

  async login(
    payload: AuthLoginPayload,
    options: AuthProductLoginOptions,
  ): Promise<AuthTokenResult> {
    const params: LoginAuthParams = {
      loginAccount: payload.phone ?? payload.account,
      password: payload.password,
      productScope: options.productScope,
      requireDeveloper: options.requireDeveloper,
    };

    return this.authAuthenticationService.login(params);
  }

  async loginByCode(
    payload: AuthLoginByCodePayload,
    productScope: AuthProductScope,
  ): Promise<AuthTokenResult> {
    return this.authAuthenticationService.loginByCode({
      phone: normalizePhone(payload.phone),
      code: payload.code,
      productScope,
    });
  }

  async forgotPassword(
    payload: AuthPhonePayload,
    productScope: AuthProductScope,
  ): Promise<ForgotPasswordResult> {
    return this.authCodeService.sendPasswordResetCode(
      normalizePhone(payload.phone),
      productScope,
    );
  }

  async resetPassword(
    payload: AuthResetPasswordPayload,
    productScope: AuthProductScope,
  ): Promise<PasswordOperationResult> {
    const params: ResetPasswordAuthParams = {
      phone: normalizePhone(payload.phone),
      code: payload.code,
      password: payload.password,
      confirmPassword: payload.confirmPassword,
      productScope,
    };

    return this.authAuthenticationService.resetPassword(params);
  }

  /**
   * purely-club 专用：发送登录即注册验证码
   * 无论手机号是否已注册都发送，不暴露注册状态
   */
  async sendClubLoginOrRegisterCode(
    payload: AuthPhonePayload,
  ): Promise<SendLoginCodeResult> {
    return this.authCodeService.sendClubLoginOrRegisterCode(
      normalizePhone(payload.phone),
    );
  }

  /**
   * 手机号验证码登录即注册（purely-club 专用）
   * 验证码有效 → 已有账号则登录，无账号则自动创建
   */
  async loginByCodeOrRegister(
    payload: AuthLoginByCodePayload,
    productScope: AuthProductScope,
  ): Promise<AuthTokenResult> {
    const params: LoginByCodeOrRegisterAuthParams = {
      phone: normalizePhone(payload.phone),
      code: payload.code,
      productScope,
    };

    return this.authAuthenticationService.loginByCodeOrRegister(params);
  }

  /**
   * 微信小程序登录即注册（purely-club 专用）
   * openid 已存在则登录并刷新微信信息；
   * 若传入 phone 且存在对应手机号账号，则绑定 openid（账号合并）；
   * 否则自动注册新账号
   */
  async wechatLogin(
    payload: {
      openid: string;
      unionid?: string;
      nickname?: string;
      avatar?: string;
      /** 微信授权的真实手机号（纯数字格式，如 13800138000） */
      phone?: string;
    },
    productScope: AuthProductScope,
  ): Promise<AuthTokenResult> {
    const params: WechatLoginAuthParams = {
      openid: payload.openid,
      unionid: payload.unionid,
      nickname: payload.nickname,
      avatar: payload.avatar,
      phone: payload.phone,
      productScope,
    };

    return this.authAuthenticationService.wechatLogin(params);
  }
}
