import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tencentcloudSms = require('tencentcloud-sdk-nodejs-sms') as {
  sms: {
    v20210111: {
      Client: new (config: {
        credential: { secretId: string; secretKey: string };
        region: string;
      }) => {
        SendSms: (req: SendSmsRequest) => Promise<SendSmsResponse>;
      };
      Models: {
        SendSmsRequest: SendSmsRequest;
        SendSmsResponse: SendSmsResponse;
      };
    };
  };
};

interface SendSmsRequest {
  SmsSdkAppId: string;
  SignName: string;
  TemplateId: string;
  TemplateParamSet: string[];
  PhoneNumberSet: string[];
}

interface SendSmsResponse {
  RequestId?: string;
  SendStatusSet?: Array<{
    Code?: string;
    Message?: string;
  }>;
}

const SmsClient = tencentcloudSms.sms.v20210111.Client;

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

/**
 * 腾讯云短信服务。
 *
 * 当环境变量未配置腾讯短信凭证时，自动降级为仅打印日志（开发模式），
 * 与开发阶段的空壳行为保持一致，无需额外条件分支。
 */
@Injectable()
export class AuthSmsService {
  private readonly logger = new Logger(AuthSmsService.name);
  private readonly client: InstanceType<typeof SmsClient> | null;
  private readonly sdkAppId: string;
  private readonly signName: string;
  private readonly registerTemplateId: string;
  private readonly loginTemplateId: string;
  private readonly passwordResetTemplateId: string;

  constructor(private readonly configService: ConfigService) {
    const secretId = configService.get<string>('tencentSms.secretId') ?? '';
    const secretKey = configService.get<string>('tencentSms.secretKey') ?? '';
    this.sdkAppId = configService.get<string>('tencentSms.sdkAppId') ?? '';
    this.signName = configService.get<string>('tencentSms.signName') ?? '';
    this.registerTemplateId =
      configService.get<string>('tencentSms.registerTemplateId') ?? '';
    this.loginTemplateId =
      configService.get<string>('tencentSms.loginTemplateId') ?? '';
    this.passwordResetTemplateId =
      configService.get<string>('tencentSms.passwordResetTemplateId') ?? '';

    // 凭证齐全时创建真实客户端，否则降级为日志模式
    if (secretId && secretKey) {
      this.client = new SmsClient({
        credential: { secretId, secretKey },
        region: 'ap-guangzhou',
      });
      this.logger.log('腾讯云短信客户端已初始化');
    } else {
      this.client = null;
      this.logger.warn(
        '腾讯云短信凭证未配置（TENCENT_SMS_SECRET_ID / TENCENT_SMS_SECRET_KEY），短信发送将降级为日志模式',
      );
    }
  }

  async sendPasswordResetCode(
    params: SendPasswordResetCodeParams,
  ): Promise<void> {
    const expireMinutes = Math.ceil(params.expiresInSeconds / 60);

    if (!this.client) {
      this.logger.log(
        `[降级模式] 发送找回密码验证码到 ${params.phone}，验证码 ${params.code}，有效期 ${expireMinutes} 分钟`,
      );
      return;
    }

    await this.sendSms(
      params.phone,
      this.passwordResetTemplateId,
      [params.code, String(expireMinutes)],
      '找回密码',
    );
  }

  async sendRegisterCode(params: SendRegisterCodeParams): Promise<void> {
    const expireMinutes = Math.ceil(params.expiresInSeconds / 60);

    if (!this.client) {
      this.logger.log(
        `[降级模式] 发送注册验证码到 ${params.phone}，验证码 ${params.code}，有效期 ${expireMinutes} 分钟`,
      );
      return;
    }

    await this.sendSms(
      params.phone,
      this.registerTemplateId,
      [params.code, String(expireMinutes)],
      '注册',
    );
  }

  async sendLoginCode(params: SendLoginCodeParams): Promise<void> {
    const expireMinutes = Math.ceil(params.expiresInSeconds / 60);

    if (!this.client) {
      this.logger.log(
        `[降级模式] 发送登录验证码到 ${params.phone}，验证码 ${params.code}，有效期 ${expireMinutes} 分钟`,
      );
      return;
    }

    await this.sendSms(
      params.phone,
      this.loginTemplateId,
      [params.code, String(expireMinutes)],
      '登录',
    );
  }

  /**
   * 统一发送短信底层方法。
   * 腾讯云短信模板参数顺序约定：{1}=验证码，{2}=有效期（分钟）。
   * 实际模板参数需与腾讯云短信控制台中的模板保持一致。
   */
  private async sendSms(
    phone: string,
    templateId: string,
    templateParams: string[],
    sceneLabel: string,
  ): Promise<void> {
    if (!templateId) {
      throw new Error(`腾讯云短信模板 ID 未配置（场景：${sceneLabel}）`);
    }
    if (!this.signName) {
      throw new Error('腾讯云短信签名未配置（TENCENT_SMS_SIGN_NAME）');
    }

    try {
      const req: SendSmsRequest = {
        SmsSdkAppId: this.sdkAppId,
        SignName: this.signName,
        TemplateId: templateId,
        TemplateParamSet: templateParams,
        // 腾讯云要求手机号带 +86 前缀
        PhoneNumberSet: [`+86${phone}`],
      };

      const resp = await this.client!.SendSms(req);

      if (resp.SendStatusSet?.[0]?.Code !== 'Ok') {
        const status = resp.SendStatusSet?.[0];
        throw new Error(
          `短信发送失败 [${status?.Code}]: ${status?.Message ?? '未知错误'}`,
        );
      }

      this.logger.log(
        `${sceneLabel}验证码短信发送成功 → ${phone}，RequestId: ${resp.RequestId}`,
      );
    } catch (error) {
      this.logger.error(`${sceneLabel}验证码短信发送失败 → ${phone}`, error);
      throw error;
    }
  }
}
