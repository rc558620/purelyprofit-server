// 腾讯云短信**送达状态回执** DTO
//
// ⚠️ 这里是「别人推给我们」的格式，不是我们自己定义的 REST 契约：
//   - 腾讯回执是公网 HTTP POST，body 可能是数组、也可能是对象包裹；
//   - 字段名在不同产品线 / 版本间存在大小写与命名差异（serialNo / SerialNo / serial_no）。
//
// 因此这里**刻意不做 class-validator 强校验**：一旦漏配某个字段名就把合法回执
// 400 掉，回执丢了就等于永远不知道短信有没有送达、钱也退不回去。
// 正确性由 SmsDeliveryCallbackService 里的宽松解析器负责（多套别名逐个尝试），
// 解析不出来的走 WARN 日志，看日志补别名即可，不影响线上资金。

/** 单条送达回执的原始字段（全部可选，兼容多种命名风格） */
export interface RawSmsDeliveryReport {
  /** 发送流水号（回执定位明细的唯一凭据） */
  serialNo?: unknown;
  SerialNo?: unknown;
  serial_no?: unknown;
  /** 送达状态码：SUCCESS / FAIL / DELIVRD / UNDELIV ... */
  status?: unknown;
  reportStatus?: unknown;
  report_status?: unknown;
  originalStatus?: unknown;
  /** 失败原因描述 */
  errMsg?: unknown;
  errmsg?: unknown;
  err_msg?: unknown;
  description?: unknown;
  /** 用户收到时间 */
  userReceiveTime?: unknown;
  user_receive_time?: unknown;
  deliveryTime?: unknown;
  /** 手机号（兜底用，流水号缺失时辅助定位） */
  mobile?: unknown;
  phone_number?: unknown;
}

/** 解析后的单条回执 */
export interface ParsedSmsDeliveryReport {
  serialNo: string;
  /** 归一化的状态码字符串（大写），解析不出时为 null */
  statusCode: string | null;
  message: string | null;
  deliveredAt: Date | null;
}

/** 回执处理结果（回调响应 + 监控用） */
export interface SmsDeliveryCallbackResult {
  /** 本次收到的回执条数 */
  received: number;
  /** 成功定位到明细的条数 */
  matched: number;
  /** 定位不到（流水号缺失 / 查无此号）的条数 */
  unmatched: number;
  /** 送达成功条数 */
  delivered: number;
  /** 送达失败条数（含已自动退费） */
  failed: number;
  /** 重复推送被忽略的条数 */
  duplicated: number;
  /**
   * 状态码解析不出来的条数。
   *
   * 必须单独计数并告警：这类回执定位到了明细、却不知道送达没送达，
   * 商户看到的名单质量数据会失真——需要回来补 SMS_DELIVERY_*_VALUES 的别名。
   */
  unknown: number;
}

/** 回调响应体：腾讯云要求 result=0 表示接收成功，否则会重推 */
export interface SmsDeliveryCallbackResponseDto {
  result: number;
  errmsg: string;
}
