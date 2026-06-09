import type { ClientErrorSource } from './dto/client-error-report.dto';

export interface ClientErrorRequestMeta {
  clientIp?: string;
  requestId?: string;
  requestUserAgent?: string;
}

export type ClientErrorLogSeverity = 'error' | 'warning';
export type ClientErrorHttpStatusLevel = '4xx' | '5xx' | null;
export type ClientErrorAlertLevel = 'critical' | 'high' | 'warning' | 'info';

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
  aggregationBucket: string;
  reportId: string;
  source: ClientErrorSource;
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
  stackHead: string | null;
  detailsKeys: string[] | null;
  detailsPreview: string | null;
}

export interface ClientErrorLogConfig {
  stackMaxLength: number;
  detailsMaxLength: number;
}
