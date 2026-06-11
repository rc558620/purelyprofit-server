import { Injectable } from '@nestjs/common';
import { AuthAuthenticationService } from '../../purely-profit/auth/auth-authentication.service';
import { AuthCodeService } from '../../purely-profit/auth/auth-code.service';
import type { AuthProductScope } from './auth-account.types';
import type {
  LoginAuthParams,
  RegisterAuthParams,
  ResetPasswordAuthParams,
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
}
