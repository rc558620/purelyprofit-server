import type {
  ClientErrorReportDto,
  ClientErrorSource,
} from './dto/client-error-report.dto';
import type {
  ClientErrorAlertLevel,
  ClientErrorFlattenedDetails,
  ClientErrorHttpStatusLevel,
  ClientErrorLogConfig,
  ClientErrorLogEntry,
  ClientErrorLogSeverity,
  ClientErrorRequestMeta,
} from './client-errors.types';
import {
  extractDetailsKeys,
  extractStackHead,
  maskPhone,
  readNumberDetail,
  readStringDetail,
  serializeDetails,
  truncateText,
} from './client-errors.utils';

interface ClientErrorAggregateKeyParams {
  source: ClientErrorSource;
  logCode: string;
  messageTag: string;
  statusCodeTag: string;
  businessCodeTag: string;
}

export interface BuiltClientErrorLog {
  severity: ClientErrorLogSeverity;
  logEntry: ClientErrorLogEntry;
  stackTrace?: string;
}

export const buildClientErrorLog = (
  payload: ClientErrorReportDto,
  requestMeta: ClientErrorRequestMeta,
  config: ClientErrorLogConfig,
): BuiltClientErrorLog => {
  const severity = resolveSeverity(payload);
  const logCode = resolveLogCode(payload, severity);
  const alertLevel = resolveAlertLevel(payload);
  const aggregationBucket = resolveAggregationBucket(payload);
  const messageTag = buildMessageTag(payload.message);
  const statusCodeTag = buildStatusCodeTag(payload.statusCode);
  const businessCodeTag = buildBusinessCodeTag(payload.businessCode);
  const flattenedDetails = extractFlattenedDetails(payload.details);

  return {
    severity,
    stackTrace: truncateText(payload.stack, config.stackMaxLength),
    logEntry: {
      event: 'client_error_reported',
      domain: 'client_errors',
      severity,
      logCode,
      alertLevel,
      aggregationBucket,
      reportId: truncateText(payload.reportId, 80) ?? 'unknown-report',
      source: payload.source,
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
          source: payload.source,
          logCode,
          messageTag,
          statusCodeTag,
          businessCodeTag,
        }) ?? 'client_error_aggregate_key',
      isHttpError: payload.source === 'http',
      httpStatusLevel: resolveHttpStatusLevel(payload),
      appMode: truncateText(payload.app.mode, 40) ?? 'unknown',
      appRelease: truncateText(payload.app.release, 60) ?? null,
      appLanguage: truncateText(payload.app.language, 20) ?? null,
      pageUrl: truncateText(payload.app.url, 400) ?? null,
      pagePathname: truncateText(payload.app.pathname, 200) ?? '/',
      pageSearch: truncateText(payload.app.search, 120) ?? null,
      pageHash: truncateText(payload.app.hash, 120) ?? null,
      browserUserAgent: truncateText(payload.app.userAgent, 180) ?? null,
      userVerified: payload.user?.verified ?? null,
      userPhoneMasked: maskPhone(payload.user?.phone) ?? null,
      storeId: payload.store?.id ?? null,
      storeName: truncateText(payload.store?.storeName, 80) ?? null,
      storeType: truncateText(payload.store?.storeType, 40) ?? null,
      requestId: truncateText(requestMeta.requestId, 80) ?? null,
      clientIp: truncateText(requestMeta.clientIp, 80) ?? null,
      requestUserAgent: truncateText(requestMeta.requestUserAgent, 180) ?? null,
      stackHead: extractStackHead(payload.stack),
      detailsKeys: extractDetailsKeys(payload.details),
      detailsPreview:
        serializeDetails(payload.details, config.detailsMaxLength) ?? null,
      ...flattenedDetails,
    },
  };
};

const resolveSeverity = (
  payload: ClientErrorReportDto,
): ClientErrorLogSeverity => {
  if (payload.source !== 'http') {
    return 'error';
  }

  return (payload.statusCode ?? 0) >= 500 ? 'error' : 'warning';
};

const resolveLogCode = (
  payload: ClientErrorReportDto,
  severity: ClientErrorLogSeverity,
): string => {
  if (payload.source !== 'http') {
    return 'runtime_exception';
  }

  return severity === 'error' ? 'upstream_http_error' : 'upstream_http_warning';
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
): ClientErrorAlertLevel => {
  if (payload.source === 'react-render') {
    return 'critical';
  }

  if (payload.source === 'http') {
    if ((payload.statusCode ?? 0) >= 500) {
      return 'high';
    }

    if ((payload.statusCode ?? 0) >= 400) {
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

const buildMessageTag = (message: string): string => {
  const normalizedMessage = message
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
  details: Record<string, unknown> | undefined,
): ClientErrorFlattenedDetails => ({
  detailFilename: readStringDetail(details?.filename, 240),
  detailLineno: readNumberDetail(details?.lineno),
  detailColno: readNumberDetail(details?.colno),
  detailReasonType: readStringDetail(details?.reasonType, 80),
  detailComponentStack: readStringDetail(details?.componentStack, 600),
  detailTrigger: readStringDetail(details?.trigger, 120),
});
