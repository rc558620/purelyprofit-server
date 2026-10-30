/**
 * `alert` 配置块：资金链路告警。
 *
 * 只服务需要人工立刻介入的资金事故（回调重试耗尽、落账失败、验签失败突增）：
 * 这类事件之前只进日志，等到用户投诉「钱扣了没到账」才被发现。
 *
 * 未配置 webhookUrl 时退化为结构化日志（见 AlertService），
 * 本地与未接入告警通道的环境不会因为告警而报错。
 * 对应环境变量：ALERT_WEBHOOK_URL
 * 示例：https://open.feishu.cn/open-apis/bot/v2/hook/xxx
 */
export interface AlertConfig {
  webhookUrl: string;
}

/** 解析 `alert` 配置块。 */
export function resolveAlertConfig(): AlertConfig {
  return {
    webhookUrl: process.env.ALERT_WEBHOOK_URL ?? '',
  };
}
