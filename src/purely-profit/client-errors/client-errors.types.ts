import type { ClientErrorSource } from './dto/client-error-report.dto';

export interface ClientErrorRequestMeta {
  clientIp?: string;
  requestId?: string;
  requestUserAgent?: string;
}

export type ClientErrorLogSeverity = 'error' | 'warning';
export type ClientErrorHttpStatusLevel = '4xx' | '5xx' | null;
export type ClientErrorAlertLevel = 'critical' | 'high' | 'warning' | 'info';
/**
 * 错误归属：
 * - app：堆栈命中本站域名（或配置的 appHosts），是我们自己的代码问题
 * - third-party：堆栈命中浏览器扩展 / 第三方脚本，通常无需我们处理
 */
export type ClientErrorOrigin = 'app' | 'third-party';

export interface ClientErrorFlattenedDetails {
  detailFilename: string | null;
  detailLineno: number | null;
  detailColno: number | null;
  detailReasonType: string | null;
  detailComponentStack: string | null;
  detailTrigger: string | null;
}

export interface ClientErrorLogEntry extends ClientErrorFlattenedDetails {
  event: 'client_error_reported';
  domain: 'client_errors';
  severity: ClientErrorLogSeverity;
  logCode: string;
  alertLevel: ClientErrorAlertLevel;
  errorOrigin: ClientErrorOrigin;
  aggregationBucket: string;
  reportId: string;
  /** 遥测上报走宽松校验，source 可能缺失 / 不合法 */
  source: ClientErrorSource | 'unknown';
  occurredAt: string;
  receivedAt: string;
  message: string;
  messageTag: string;
  errorName: string;
  statusCode: number | null;
  statusCodeTag: string;
  businessCode: string | null;
  businessCodeTag: string;
  aggregateKey: string;
  isHttpError: boolean;
  httpStatusLevel: ClientErrorHttpStatusLevel;
  appMode: string;
  appRelease: string | null;
  appLanguage: string | null;
  pageUrl: string | null;
  pagePathname: string;
  pageSearch: string | null;
  pageHash: string | null;
  browserUserAgent: string | null;
  userVerified: boolean | null;
  userPhoneMasked: string | null;
  storeId: number | null;
  storeName: string | null;
  storeType: string | null;
  requestId: string | null;
  clientIp: string | null;
  requestUserAgent: string | null;
  /** 完整堆栈（内联在 JSON 内，换行会被转义，保证一行一 JSON） */
  stack: string | null;
  stackHead: string | null;
  detailsKeys: string[] | null;
  detailsPreview: string | null;
}

export interface ClientErrorLogConfig {
  stackMaxLength: number;
  detailsMaxLength: number;
  /** 可信的前端 bundle 域名，用于判定堆栈是否来自本站代码 */
  appHosts: string[];
}
