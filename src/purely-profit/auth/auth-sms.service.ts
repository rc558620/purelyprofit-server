import { Injectable, Logger } from '@nestjs/common';

interface SendPasswordResetCodeParams {
  phone: string;
  code: string;
  expiresInSeconds: number;
}

interface SendRegisterCodeParams {
  phone: string;
  code: string;
  expiresInSeconds: number;
}

interface SendLoginCodeParams {
  phone: string;
  code: string;
  expiresInSeconds: number;
}

@Injectable()
export class AuthSmsService {
  private readonly logger = new Logger(AuthSmsService.name);

  sendPasswordResetCode(params: SendPasswordResetCodeParams): Promise<void> {
    const expireMinutes = Math.ceil(params.expiresInSeconds / 60);

    this.logger.log(
      `发送找回密码验证码到 ${params.phone}，验证码 ${params.code}，有效期 ${expireMinutes} 分钟`,
    );

    return Promise.resolve();
  }

  sendRegisterCode(params: SendRegisterCodeParams): Promise<void> {
    const expireMinutes = Math.ceil(params.expiresInSeconds / 60);

    this.logger.log(
      `发送注册验证码到 ${params.phone}，验证码 ${params.code}，有效期 ${expireMinutes} 分钟`,
    );

    return Promise.resolve();
  }

  sendLoginCode(params: SendLoginCodeParams): Promise<void> {
    const expireMinutes = Math.ceil(params.expiresInSeconds / 60);

    this.logger.log(
      `发送登录验证码到 ${params.phone}，验证码 ${params.code}，有效期 ${expireMinutes} 分钟`,
    );

    return Promise.resolve();
  }
}
