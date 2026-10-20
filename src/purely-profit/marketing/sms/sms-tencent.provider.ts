/**
 * SmsTencentProvider
 *
 * 群发短信专用通道封装（**不复用 AuthSmsService**，避免动到验证码链路）。
 *
 * 四条硬约束（踩过就是生产事故）：
 * 1. 单次 PhoneNumberSet **最多 200 个**，超出腾讯云直接抛
 *    `LimitExceeded.PhoneNumberCountLimit`，必须切片；
 * 2. 号码必须是 E.164（`+8613xxxxxxxx`）；
 * 3. **境内境外不可混发**——非 +86 号码必须在入库前过滤掉，不能带进请求；
 * 4. **通道不可用时绝不能返回成功**。群发是「先扣费后发送」，一旦把
 *    「没发出去」当成成功，就是扣了商户的钱、短信没到用户手上，而前端
 *    还弹「已发送」——属于静默吞钱。因此生产环境凭证 / 营销模板缺失时
 *    一律按失败返回，只有非生产环境才降级为日志模式（本地联调不阻塞）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConcurrencyLimiter } from '../../../redis/concurrency-limiter.util';
import type { SmsSendResultItem } from './sms.types';
import {
  SMS_DELIVERY_PULL_MAX_LIMIT,
  SMS_NO_PROVIDER_STATUS_CODE,
} from './sms.constants';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tencentcloudSms = require('tencentcloud-sdk-nodejs-sms') as {
  sms: {
    v20210111: {
      Client: new (config: {
        credential: { secretId: string; secretKey: string };
        region: string;
      }) => {
        SendSms: (req: SendSmsRequest) => Promise<SendSmsResponse>;
        PullSmsSendStatus?: (
          req: PullSmsSendStatusRequest,
        ) => Promise<PullSmsSendStatusResponse>;
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

interface SmsSendStatus {
  Code?: string;
  Message?: string;
  PhoneNumber?: string;
  /**
   * 本次发送的流水号。
   *
   * ⚠️ 它和 RequestId 不是一回事：RequestId 是**一次请求**一个，SerialNo 是
   * **一个号码一条**。异步送达回执只带 SerialNo，不留存就永远无法知道
   * 某条短信到底送达没有——"受理成功"和"用户收到"是两件事。
   */
  SerialNo?: string;
}

interface SendSmsResponse {
  RequestId?: string;
  SendStatusSet?: SmsSendStatus[];
}

/** 主动拉取发送状态的入参（回执兜底用） */
interface PullSmsSendStatusRequest {
  SmsSdkAppId: string;
  Limit: number;
  /** 起始时间，秒级时间戳 */
  BeginTime: number;
  /** 结束时间，秒级时间戳 */
  EndTime: number;
}

interface PullSmsSendStatusResponse {
  PullSmsSendStatusSet?: Record<string, unknown>[];
}

const SmsClient = tencentcloudSms.sms.v20210111.Client;

/** 腾讯云 SendSms 单次请求的手机号硬上限 */
const TENCENT_SMS_MAX_PHONE_COUNT = 200;

/**
 * 分片的并发上限。
 *
 * 分片本身必须保留（腾讯云单请求 200 号上限），但没必要串行：一次 2000 人群发
 * = 10 个分片，串行就是 10 次外网 RTT 首尾相接。限并发 5 后墙钟时间约为串行的
 * 1/5，同时不会把通道侧 QPS 打高到触发限流。
 */
const TENCENT_SMS_CHUNK_CONCURRENCY = 5;

/** 凭证缺失时（仅非生产环境）的降级返回码 */
const DEV_MODE_CODE = 'DEV_MODE_NO_CREDENTIAL';

/** 生产环境通道不可用时返回码：与真实失败同口径，便于退费与对账 */
const CHANNEL_UNAVAILABLE_CODE = 'CHANNEL_NOT_CONFIGURED';

// 通道未返回结果的返回码：语义是「不确定」，见 SMS_NO_PROVIDER_STATUS_CODE

@Injectable()
export class SmsTencentProvider {
  private readonly logger = new Logger(SmsTencentProvider.name);
  private readonly client: InstanceType<typeof SmsClient> | null;
  private readonly sdkAppId: string;
  private readonly signName: string;
  private readonly marketingTemplateId: string;
  private readonly isProduction: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isProduction =
      this.configService.get<string>('nodeEnv') === 'production';
    const secretId =
      this.configService.get<string>('tencentSms.secretId') ?? '';
    const secretKey =
      this.configService.get<string>('tencentSms.secretKey') ?? '';
    this.sdkAppId = this.configService.get<string>('tencentSms.sdkAppId') ?? '';
    this.signName = this.configService.get<string>('tencentSms.signName') ?? '';
    this.marketingTemplateId =
      this.configService.get<string>('tencentSms.marketingTemplateId') ?? '';

    if (secretId && secretKey) {
      this.client = new SmsClient({
        credential: { secretId, secretKey },
        region: 'ap-guangzhou',
      });
      this.logger.log('腾讯云短信客户端已初始化（群发通道）');
    } else {
      this.client = null;
      this.logger.warn(
        '腾讯云短信凭证未配置，群发短信将降级为日志模式（不会真正发出）',
      );
    }
  }

  /**
   * 通道是否可用（凭证 + 营销模板都已配置）。
   *
   * 群发在扣费**之前**调用它：不可用时直接拒绝请求，而不是先扣钱再失败。
   */
  isChannelReady(): boolean {
    return Boolean(this.client && this.marketingTemplateId);
  }

  /**
   * 批量发送营销短信。
   *
   * @param mobiles 已归一化的 11 位境内手机号（**必须已过滤非 +86**）
   * @param content 短信正文（作为模板参数 {1}）
   * @returns 逐条结果，顺序与入参一致；整批网络失败时返回全部 failed
   */
  async sendMarketingBatch(
    mobiles: string[],
    content: string,
  ): Promise<SmsSendResultItem[]> {
    if (mobiles.length === 0) {
      return [];
    }

    if (!this.isChannelReady()) {
      // 生产环境：通道不可用 = 发送失败。绝不能返回 ok:true，
      // 否则「扣了费、没发短信、前端显示已发送」，商户的钱被静默吞掉。
      if (this.isProduction) {
        this.logger.error(
          `[通道不可用] 群发短信未发送：${mobiles.length} 个号码。请检查 tencentSms 配置（secretId/secretKey/marketingTemplateId）`,
        );
        return mobiles.map((phone) => ({
          phone,
          ok: false,
          code: CHANNEL_UNAVAILABLE_CODE,
          message: '短信通道未配置，短信未发送',
          requestId: null,
          serialNo: null,
        }));
      }

      this.logger.warn(
        `[降级模式] 群发短信未真正发送：${mobiles.length} 个号码，正文「${content.slice(0, 20)}…」`,
      );
      return mobiles.map((phone) => ({
        phone,
        ok: true,
        code: DEV_MODE_CODE,
        message: '本地降级模式，未真正发送',
        requestId: null,
        serialNo: null,
      }));
    }

    const chunks = this.chunk(mobiles, TENCENT_SMS_MAX_PHONE_COUNT);
    const limiter = new ConcurrencyLimiter(TENCENT_SMS_CHUNK_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunks.map((chunk) => limiter.run(() => this.sendChunk(chunk, content))),
    );

    // Promise.all 按入参顺序收集结果，展开后仍与入参号码顺序一致
    return chunkResults.flat();
  }

  private async sendChunk(
    mobiles: string[],
    content: string,
  ): Promise<SmsSendResultItem[]> {
    const request: SendSmsRequest = {
      SmsSdkAppId: this.sdkAppId,
      SignName: this.signName,
      TemplateId: this.marketingTemplateId,
      TemplateParamSet: [content],
      PhoneNumberSet: mobiles.map((mobile) => `+86${mobile}`),
    };

    try {
      const response = await this.client!.SendSms(request);
      const statusSet = response.SendStatusSet ?? [];
      // RequestId 是事后找腾讯云对账的唯一凭据，成功失败都要落库
      const requestId = response.RequestId ?? null;

      // 逐条解析：腾讯云返回的 PhoneNumber 带 +86，需要剥掉才能对回入参
      const statusByPhone = new Map<string, SmsSendStatus>();
      for (const status of statusSet) {
        const digits = (status.PhoneNumber ?? '').replace(/\D/g, '').slice(-11);
        if (digits) {
          statusByPhone.set(digits, status);
        }
      }

      return mobiles.map((mobile) => {
        /*
         * 只按手机号对回，**不再用 statusSet[index] 位置兜底**：
         * 通道返回的条数或顺序一旦与入参不一致，位置兜底会把 A 的结果
         * 安到 B 头上（明明失败却记成成功）。对不上的号码一律按失败处理，
         * 由补偿任务重发——宁可多发一次，也不能把失败记成成功。
         */
        const status = statusByPhone.get(mobile);
        if (!status) {
          return {
            phone: mobile,
            ok: false,
            code: SMS_NO_PROVIDER_STATUS_CODE,
            message: '通道未返回该号码的投递结果',
            requestId,
            serialNo: null,
          };
        }

        const code = status.Code ?? null;
        return {
          phone: mobile,
          ok: code === 'Ok',
          code,
          message: status.Message ?? null,
          requestId,
          serialNo: status.SerialNo ?? null,
        };
      });
    } catch (error) {
      this.logger.error(
        `群发短信请求失败（${mobiles.length} 个号码）`,
        error instanceof Error ? error.stack : String(error),
      );
      return mobiles.map((phone) => ({
        phone,
        ok: false,
        code: 'REQUEST_FAILED',
        message: error instanceof Error ? error.message : String(error),
        requestId: null,
        serialNo: null,
      }));
    }
  }

  /**
   * **主动**拉取腾讯云短信发送状态（回执兜底用）。
   *
   * 为什么需要：正常流程靠腾讯把回执推到我们的回调地址，但推送可能丢。
   * 回执丢了 → 这条短信永远不知道送达没有 → 该退的钱退不回去（且无人知晓）。
   * 因此每天扫一次「长时间没有回执」的明细，主动向通道问一次。
   *
   * 稳定性约定（这里是外部依赖，必须比内部代码更保守）：
   * - SDK 里没有这个方法就**跳过**，不抛异常、不影响主流程；
   * - 拉取失败一律吞掉并记录，交给下一次扫描；
   * - 返回**原始结构**交给上层宽松解析，字段名变了也只是暂时解析不出来，
   *   不会让整个兜底任务崩掉。
   */
  async pullSmsSendStatus(params: {
    beginTime: Date;
    endTime: Date;
    limit: number;
  }): Promise<Record<string, unknown>[]> {
    if (!this.isChannelReady()) {
      return [];
    }
    if (typeof this.client!.PullSmsSendStatus !== 'function') {
      this.logger.warn(
        '[sms-delivery] 当前 SDK 不支持 PullSmsSendStatus，已跳过主动拉取',
      );
      return [];
    }

    try {
      const response = (await this.client!.PullSmsSendStatus({
        SmsSdkAppId: this.sdkAppId,
        Limit: Math.min(Math.max(params.limit, 1), SMS_DELIVERY_PULL_MAX_LIMIT),
        BeginTime: Math.floor(params.beginTime.getTime() / 1000),
        EndTime: Math.floor(params.endTime.getTime() / 1000),
      })) as { PullSmsSendStatusSet?: unknown } | null;

      const list = response?.PullSmsSendStatusSet;
      return Array.isArray(list)
        ? list.filter(
            (item): item is Record<string, unknown> =>
              typeof item === 'object' && item !== null,
          )
        : [];
    } catch (error) {
      this.logger.error(
        `[sms-delivery] 主动拉取送达状态失败：${error instanceof Error ? error.message : 'UnknownError'}`,
        error instanceof Error ? error.stack : undefined,
      );
      return [];
    }
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }
}
