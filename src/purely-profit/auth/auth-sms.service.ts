import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthSmsModeService } from './auth-sms-mode.service';
import { maskPhone } from './auth.utils';
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

/** 验证码有效期由秒换算为分钟（向上取整），与短信模板 {2} 参数口径一致。 */
const toExpireMinutes = (expiresInSeconds: number): number =>
  Math.ceil(expiresInSeconds / 60);

/**
 * 发送验证码短信的统一入参。
 *
 * `shouldSendLive` 由 `AuthCodeService` 在本次发码前**统一裁决一次**后传入：
 * 「是否真实发送」与「是否在响应中暴露明文验证码」必须复用同一结论，
 * 否则两次独立裁决之间若发生模式切换，会出现
 * 「真实发送了短信、同时把验证码明文回传前端」的不一致结果。
 */
interface SendSmsCodeParams {
  phone: string;
  code: string;
  expiresInSeconds: number;
  /** 本次是否真实发送短信（已由 AuthCodeService 裁决） */
  shouldSendLive: boolean;
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
  private readonly bindPhoneTemplateId: string;
  private readonly passwordResetTemplateId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly authSmsModeService: AuthSmsModeService,
  ) {
    const secretId = configService.get<string>('tencentSms.secretId') ?? '';
    const secretKey = configService.get<string>('tencentSms.secretKey') ?? '';
    this.sdkAppId = configService.get<string>('tencentSms.sdkAppId') ?? '';
    this.signName = configService.get<string>('tencentSms.signName') ?? '';
    this.registerTemplateId =
      configService.get<string>('tencentSms.registerTemplateId') ?? '';
    this.loginTemplateId =
      configService.get<string>('tencentSms.loginTemplateId') ?? '';
    this.bindPhoneTemplateId =
      configService.get<string>('tencentSms.bindPhoneTemplateId') ?? '';
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

  async sendPasswordResetCode(params: SendSmsCodeParams): Promise<void> {
    if (!this.resolveSendLive(params, '找回密码')) {
      return;
    }

    await this.sendSms(
      params.phone,
      this.passwordResetTemplateId,
      [params.code, String(toExpireMinutes(params.expiresInSeconds))],
      '找回密码',
    );
  }

  async sendRegisterCode(params: SendSmsCodeParams): Promise<void> {
    if (!this.resolveSendLive(params, '注册')) {
      return;
    }

    await this.sendSms(
      params.phone,
      this.registerTemplateId,
      [params.code, String(toExpireMinutes(params.expiresInSeconds))],
      '注册',
    );
  }

  async sendLoginCode(params: SendSmsCodeParams): Promise<void> {
    if (!this.resolveSendLive(params, '登录')) {
      return;
    }

    await this.sendSms(
      params.phone,
      this.loginTemplateId,
      [params.code, String(toExpireMinutes(params.expiresInSeconds))],
      '登录',
    );
  }

  /**
   * 发送绑定 / 换绑手机号验证码。
   *
   * 独立成方法而非复用 sendLoginCode，是为了让「绑定手机号」拥有自己的模板：
   * 复用登录模板会让用户执行绑定操作时收到「您正在登录账号」的文案，
   * 与实际操作不符，既影响体验也易被运营商判定为业务不符。
   */
  async sendBindPhoneCode(params: SendSmsCodeParams): Promise<void> {
    if (!this.resolveSendLive(params, '绑定手机号')) {
      return;
    }

    await this.sendSms(
      params.phone,
      this.resolveBindPhoneTemplateId(),
      [params.code, String(toExpireMinutes(params.expiresInSeconds))],
      '绑定手机号',
    );
  }

  /**
   * 解析绑定手机号场景使用的模板 ID。
   *
   * 未单独配置 TENCENT_SMS_BIND_PHONE_TEMPLATE_ID 时回落登录模板：
   * 腾讯云模板需单独申请审核，「提前接线 + 按需启用」可避免模板尚未
   * 申请时绑定功能被空模板 ID 阻断，申请通过后再配置即可生效，无需改代码。
   * @returns 绑定手机号场景使用的模板 ID
   */
  private resolveBindPhoneTemplateId(): string {
    return this.bindPhoneTemplateId || this.loginTemplateId;
  }

  /**
   * 判断是否真实发送短信，并为降级场景输出**原因可区分**的日志。
   *
   * 真实发送需同时满足：
   * 1. 腾讯云凭证已配置（客户端初始化成功）；
   * 2. 调用方裁决为 live（由 AuthCodeService 综合通道模式与手机号白名单得出）。
   *
   * 「凭证缺失」与「主动测试模式」必须打不同级别的日志：
   * 否则切到 live 后因凭证缺失而没真发时，日志仍显示“测试模式”，
   * 会被误判成开关失效，白白增加排查成本。
   * @returns 是否真实发送短信
   */
  private resolveSendLive(
    params: SendSmsCodeParams,
    sceneLabel: string,
  ): boolean {
    const expireMinutes = toExpireMinutes(params.expiresInSeconds);
    const maskedPhone = maskPhone(params.phone);

    if (!this.client) {
      this.logger.warn(
        `[凭证缺失] ${sceneLabel}验证码未真实发送 → ${maskedPhone}，` +
          `验证码 ${params.code}，有效期 ${expireMinutes} 分钟（腾讯云凭证未配置）`,
      );
      return false;
    }

    if (!params.shouldSendLive) {
      this.logger.log(
        `[测试模式] ${sceneLabel}验证码未真实发送 → ${maskedPhone}，` +
          `验证码 ${params.code}，有效期 ${expireMinutes} 分钟`,
      );
      return false;
    }

    return true;
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
        `${sceneLabel}验证码短信发送成功 → ${maskPhone(phone)}，RequestId: ${resp.RequestId}`,
      );
    } catch (error) {
      this.logger.error(
        `${sceneLabel}验证码短信发送失败 → ${maskPhone(phone)}`,
        error,
      );
      throw error;
    }
  }
}
