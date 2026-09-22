import type { ClientErrorReportDto } from './dto/client-error-report.dto';
import type {
  ClientErrorAlertLevel,
  ClientErrorFlattenedDetails,
  ClientErrorHttpStatusLevel,
  ClientErrorLogConfig,
  ClientErrorLogEntry,
  ClientErrorLogSeverity,
  ClientErrorOrigin,
  ClientErrorRequestMeta,
} from './client-errors.types';
import {
  extractDetailsKeys,
  extractStackHead,
  maskPhone,
  readNumberDetail,
  readStringDetail,
  sanitizeDetails,
  serializeDetails,
  truncateText,
} from './client-errors.utils';

interface ClientErrorAggregateKeyParams {
  source: string;
  logCode: string;
  messageTag: string;
  statusCodeTag: string;
  businessCodeTag: string;
}

export interface BuiltClientErrorLog {
  severity: ClientErrorLogSeverity;
  logEntry: ClientErrorLogEntry;
}

/**
 * 遥测上报走宽松校验（见 TelemetryValidationPipe），任意字段都可能缺失或类型不对，
 * 因此这里对所有字段都按「可选」读取并给出兜底值，绝不允许因 payload 残缺抛异常 ——
 * 抛异常会让上报接口 500，而 500 又会被前端捕获成新错误再次上报。
 */
export const buildClientErrorLog = (
  payload: ClientErrorReportDto,
  requestMeta: ClientErrorRequestMeta,
  config: ClientErrorLogConfig,
): BuiltClientErrorLog => {
  const errorOrigin = resolveErrorOrigin(payload, config.appHosts);
  const severity = resolveSeverity(payload, errorOrigin);
  const logCode = resolveLogCode(payload, severity, errorOrigin);
  const alertLevel = resolveAlertLevel(payload, errorOrigin);
  const aggregationBucket = resolveAggregationBucket(payload);
  const messageTag = buildMessageTag(payload.message);
  const statusCodeTag = buildStatusCodeTag(payload.statusCode);
  const businessCodeTag = buildBusinessCodeTag(payload.businessCode);
  // details 是前端任意透传字段：先脱敏 + 限量，再供后续读取
  const sanitizedDetails = sanitizeDetails(payload.details);
  const flattenedDetails = extractFlattenedDetails(sanitizedDetails);
  const app = payload.app;

  return {
    severity,
    logEntry: {
      event: 'client_error_reported',
      domain: 'client_errors',
      severity,
      logCode,
      alertLevel,
      errorOrigin,
      aggregationBucket,
      reportId: truncateText(payload.reportId, 80) ?? 'unknown-report',
      source: payload.source ?? 'unknown',
      occurredAt: payload.occurredAt,
      receivedAt: new Date().toISOString(),
      message: truncateText(payload.message, 300) ?? 'unknown-message',
      messageTag,
      errorName: truncateText(payload.errorName, 120) ?? 'UnknownClientError',
      statusCode: payload.statusCode ?? null,
      statusCodeTag,
      businessCode: payload.businessCode ?? null,
      businessCodeTag,
      aggregateKey:
        buildAggregateKey({
          source: payload.source ?? 'unknown',
          logCode,
          messageTag,
          statusCodeTag,
          businessCodeTag,
        }) ?? 'client_error_aggregate_key',
      isHttpError: payload.source === 'http',
      httpStatusLevel: resolveHttpStatusLevel(payload),
      appMode: truncateText(app?.mode, 40) ?? 'unknown',
      appRelease: truncateText(app?.release, 60) ?? null,
      appLanguage: truncateText(app?.language, 20) ?? null,
      pageUrl: truncateText(app?.url, 400) ?? null,
      pagePathname: truncateText(app?.pathname, 200) ?? '/',
      pageSearch: truncateText(app?.search, 120) ?? null,
      pageHash: truncateText(app?.hash, 120) ?? null,
      browserUserAgent: truncateText(app?.userAgent, 180) ?? null,
      userVerified: payload.user?.verified ?? null,
      userPhoneMasked: maskPhone(payload.user?.phone) ?? null,
      storeId: payload.store?.id ?? null,
      storeName: truncateText(payload.store?.storeName, 80) ?? null,
      storeType: truncateText(payload.store?.storeType, 40) ?? null,
      requestId: truncateText(requestMeta.requestId, 80) ?? null,
      clientIp: truncateText(requestMeta.clientIp, 80) ?? null,
      requestUserAgent: truncateText(requestMeta.requestUserAgent, 180) ?? null,
      // stack 放进 JSON 内（会被转义为 \n），避免作为独立参数输出成多行、
      // 破坏「一行一 JSON」的日志采集结构
      stack: truncateText(payload.stack, config.stackMaxLength) ?? null,
      stackHead: extractStackHead(payload.stack),
      detailsKeys: extractDetailsKeys(sanitizedDetails),
      detailsPreview:
        serializeDetails(sanitizedDetails, config.detailsMaxLength) ?? null,
      ...flattenedDetails,
    },
  };
};

/** 浏览器扩展的堆栈协议前缀：这类错误一律与本站代码无关 */
const EXTENSION_STACK_PREFIXES = [
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
  'safari-web-extension://',
  'edge-extension://',
];

const readHostname = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * 判定错误归属：来自本站代码还是第三方脚本 / 浏览器扩展。
 *
 * 意义在于降噪：浏览器插件、微信 SDK、广告脚本抛错的量级往往远超应用自身错误，
 * 如果和本站错误同等对待，error 级日志会被彻底淹没，真正的问题反而看不见。
 *
 * 判定顺序：
 * 1. 堆栈含扩展协议 → third-party；
 * 2. 堆栈里出现 http(s) URL，且**没有任何一个** host 命中可信域名 → third-party；
 * 3. 其余（堆栈无 URL，如内联 / sourcemap 后的裸文件名）→ 按 app 处理。
 *    宁可多记，也不愿把本站错误误判成第三方而降级掉。
 */
const resolveErrorOrigin = (
  payload: ClientErrorReportDto,
  appHosts: string[],
): ClientErrorOrigin => {
  const stack = payload.stack?.toLowerCase();
  if (!stack) {
    return 'app';
  }

  if (EXTENSION_STACK_PREFIXES.some((prefix) => stack.includes(prefix))) {
    return 'third-party';
  }

  const trustedHosts = new Set(
    (appHosts ?? []).map((host) => host.toLowerCase()),
  );
  const pageHost = payload.app?.url ? readHostname(payload.app.url) : null;
  if (pageHost) {
    trustedHosts.add(pageHost);
  }
  if (trustedHosts.size === 0) {
    return 'app';
  }

  const stackUrls = payload.stack?.match(/https?:\/\/[^\s)'"<>]+/g) ?? [];
  const stackHosts = stackUrls
    .slice(0, 10)
    .map((url) => readHostname(url))
    .filter((host): host is string => Boolean(host));

  if (stackHosts.length === 0) {
    return 'app';
  }

  return stackHosts.some((host) => trustedHosts.has(host))
    ? 'app'
    : 'third-party';
};

const resolveSeverity = (
  payload: ClientErrorReportDto,
  errorOrigin: ClientErrorOrigin,
): ClientErrorLogSeverity => {
  if (payload.source === 'http') {
    // statusCode 缺失 = 网络层失败（断网 / 超时 / CORS），比 4xx 更值得关注
    if (payload.statusCode === undefined) {
      return 'error';
    }

    return payload.statusCode >= 500 ? 'error' : 'warning';
  }

  // 第三方脚本错误降为 warning：不参与 error 级告警，避免淹没本站错误
  return errorOrigin === 'third-party' ? 'warning' : 'error';
};

const resolveLogCode = (
  payload: ClientErrorReportDto,
  severity: ClientErrorLogSeverity,
  errorOrigin: ClientErrorOrigin,
): string => {
  if (payload.source === 'http') {
    return severity === 'error'
      ? 'upstream_http_error'
      : 'upstream_http_warning';
  }

  return errorOrigin === 'third-party'
    ? 'third_party_exception'
    : 'runtime_exception';
};

const resolveHttpStatusLevel = (
  payload: ClientErrorReportDto,
): ClientErrorHttpStatusLevel => {
  if (payload.source !== 'http' || payload.statusCode === undefined) {
    return null;
  }

  if (payload.statusCode >= 500) {
    return '5xx';
  }

  if (payload.statusCode >= 400) {
    return '4xx';
  }

  return null;
};

const resolveAlertLevel = (
  payload: ClientErrorReportDto,
  errorOrigin: ClientErrorOrigin,
): ClientErrorAlertLevel => {
  // 第三方脚本错误一律最低等级：不是我们的代码，不该进告警链路
  if (payload.source !== 'http' && errorOrigin === 'third-party') {
    return 'info';
  }

  if (payload.source === 'react-render') {
    // 渲染崩溃只有来自本站代码才值得 critical（第三方脚本通常由其自身兜底）
    return 'critical';
  }

  if (payload.source === 'http') {
    // statusCode 缺失 = 网络层失败，按 5xx 同等对待
    if (payload.statusCode === undefined || payload.statusCode >= 500) {
      return 'high';
    }

    if (payload.statusCode >= 400) {
      return 'warning';
    }

    return 'info';
  }

  if (
    payload.source === 'window-error' ||
    payload.source === 'unhandledrejection'
  ) {
    return 'high';
  }

  return 'info';
};

const resolveAggregationBucket = (payload: ClientErrorReportDto): string => {
  if (payload.source === 'http') {
    if ((payload.statusCode ?? 0) >= 500) {
      return 'http_5xx';
    }

    if ((payload.statusCode ?? 0) >= 400) {
      return 'http_4xx';
    }

    return 'http_other';
  }

  if (payload.source === 'react-render') {
    return 'runtime_render';
  }

  if (payload.source === 'window-error') {
    return 'runtime_window_error';
  }

  if (payload.source === 'unhandledrejection') {
    return 'runtime_unhandled_rejection';
  }

  return 'runtime_other';
};

const buildMessageTag = (message: string | undefined): string => {
  const normalizedMessage = (message ?? '')
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ':url')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':uuid')
    .replace(/\b\d{3,}\b/g, ':num')
    .replace(/\s+/g, ' ');

  return truncateText(normalizedMessage, 160) ?? 'unknown_message';
};

const buildStatusCodeTag = (statusCode: number | undefined): string => {
  if (statusCode === undefined) {
    return 'status_code:none';
  }

  return `status_code:${statusCode}`;
};

const buildBusinessCodeTag = (businessCode: string | undefined): string => {
  const normalizedCode = businessCode?.trim().toLowerCase();
  if (!normalizedCode) {
    return 'business_code:none';
  }

  const sanitizedCode = normalizedCode.replace(/\s+/g, '_');
  return (
    truncateText(`business_code:${sanitizedCode}`, 120) ??
    'business_code:unknown'
  );
};

const buildAggregateKey = ({
  source,
  logCode,
  messageTag,
  statusCodeTag,
  businessCodeTag,
}: ClientErrorAggregateKeyParams): string | undefined =>
  truncateText(
    [source, logCode, statusCodeTag, businessCodeTag, messageTag].join('|'),
    320,
  );

const extractFlattenedDetails = (
  details: Record<string, unknown> | null,
): ClientErrorFlattenedDetails => ({
  detailFilename: readStringDetail(details?.filename, 240),
  detailLineno: readNumberDetail(details?.lineno),
  detailColno: readNumberDetail(details?.colno),
  detailReasonType: readStringDetail(details?.reasonType, 80),
  detailComponentStack: readStringDetail(details?.componentStack, 600),
  detailTrigger: readStringDetail(details?.trigger, 120),
});
