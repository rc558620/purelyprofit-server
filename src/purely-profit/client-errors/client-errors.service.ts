import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ClientErrorReportDto,
  ClientErrorSource,
} from './dto/client-error-report.dto';

export interface ClientErrorRequestMeta {
  clientIp?: string;
  requestId?: string;
  requestUserAgent?: string;
}

interface ClientErrorLogSummary {
  reportId: string;
  source: ClientErrorSource;
  message: string;
  errorName: string;
  statusCode?: number;
  businessCode?: string;
  occurredAt: string;
  app: {
    mode: string;
    release?: string;
    pathname: string;
    url: string;
  };
  user?: {
    phoneMasked?: string;
    verified: boolean;
  };
  store?: {
    id?: number;
    storeName?: string;
    storeType?: string;
  };
  request?: {
    clientIp?: string;
    requestId?: string;
    userAgent?: string;
  };
  detailsPreview?: string;
}

@Injectable()
export class ClientErrorsService {
  private readonly logger = new Logger(ClientErrorsService.name);
  private readonly enabled: boolean;
  private readonly stackMaxLength: number;
  private readonly detailsMaxLength: number;

  constructor(private readonly configService: ConfigService) {
    this.enabled =
      this.configService.get<boolean>('app.clientErrorLogEnabled') ?? true;
    this.stackMaxLength = this.readPositiveNumberConfig(
      'app.clientErrorStackMaxLength',
      2000,
    );
    this.detailsMaxLength = this.readPositiveNumberConfig(
      'app.clientErrorDetailsMaxLength',
      2000,
    );
  }

  report(
    payload: ClientErrorReportDto,
    requestMeta: ClientErrorRequestMeta,
  ): void {
    if (!this.enabled) {
      return;
    }

    const logSummary = this.buildLogSummary(payload, requestMeta);
    const logMessage = `[client-errors] ${this.resolveLogCode(payload)} ${JSON.stringify(
      logSummary,
    )}`;
    const stackTrace = this.truncateText(payload.stack, this.stackMaxLength);

    if (this.shouldUseErrorLevel(payload)) {
      if (stackTrace) {
        this.logger.error(logMessage, stackTrace);
        return;
      }

      this.logger.error(logMessage);
      return;
    }

    this.logger.warn(logMessage);
  }

  private readPositiveNumberConfig(configKey: string, fallback: number): number {
    const value = this.configService.get<number>(configKey);
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return Math.floor(value);
  }

  private shouldUseErrorLevel(payload: ClientErrorReportDto): boolean {
    if (payload.source !== 'http') {
      return true;
    }

    return (payload.statusCode ?? 0) >= 500;
  }

  private resolveLogCode(payload: ClientErrorReportDto): string {
    if (payload.source === 'http') {
      return this.shouldUseErrorLevel(payload)
        ? 'upstream_http_error'
        : 'upstream_http_warning';
    }

    return 'runtime_exception';
  }

  private buildLogSummary(
    payload: ClientErrorReportDto,
    requestMeta: ClientErrorRequestMeta,
  ): ClientErrorLogSummary {
    const detailsPreview = this.serializeDetails(payload.details);

    return {
      reportId: this.truncateText(payload.reportId, 80) ?? 'unknown-report',
      source: payload.source,
      message: this.truncateText(payload.message, 300) ?? 'unknown-message',
      errorName:
        this.truncateText(payload.errorName, 120) ?? 'UnknownClientError',
      statusCode: payload.statusCode,
      businessCode: payload.businessCode,
      occurredAt: payload.occurredAt,
      app: {
        mode: this.truncateText(payload.app.mode, 40) ?? 'unknown',
        release: this.truncateText(payload.app.release, 60),
        pathname: this.truncateText(payload.app.pathname, 200) ?? '/',
        url: this.truncateText(payload.app.url, 400) ?? '',
      },
      user: payload.user
        ? {
            phoneMasked: this.maskPhone(payload.user.phone),
            verified: payload.user.verified,
          }
        : undefined,
      store: payload.store
        ? {
            id: payload.store.id,
            storeName: this.truncateText(payload.store.storeName, 80),
            storeType: this.truncateText(payload.store.storeType, 40),
          }
        : undefined,
      request:
        requestMeta.clientIp || requestMeta.requestId || requestMeta.requestUserAgent
          ? {
              clientIp: this.truncateText(requestMeta.clientIp, 80),
              requestId: this.truncateText(requestMeta.requestId, 80),
              userAgent: this.truncateText(requestMeta.requestUserAgent, 180),
            }
          : undefined,
      detailsPreview,
    };
  }

  private serializeDetails(
    details: Record<string, unknown> | undefined,
  ): string | undefined {
    if (!details) {
      return undefined;
    }

    try {
      return this.truncateText(
        JSON.stringify(details),
        this.detailsMaxLength,
      );
    } catch {
      return '[unserializable-details]';
    }
  }

  private truncateText(value: string | undefined, maxLength: number): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return undefined;
    }

    if (normalizedValue.length <= maxLength) {
      return normalizedValue;
    }

    return `${normalizedValue.slice(0, maxLength)}...<truncated>`;
  }

  private maskPhone(phone: string | undefined): string | undefined {
    const normalizedPhone = phone?.trim();
    if (!normalizedPhone) {
      return undefined;
    }

    const digitsOnlyPhone = normalizedPhone.replace(/\D/g, '');
    if (digitsOnlyPhone.length < 7) {
      return this.truncateText(normalizedPhone, 40);
    }

    const prefix = digitsOnlyPhone.slice(0, 3);
    const suffix = digitsOnlyPhone.slice(-4);
    return `${prefix}****${suffix}`;
  }
}
