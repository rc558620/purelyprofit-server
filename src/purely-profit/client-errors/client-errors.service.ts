import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildClientErrorLog } from './client-errors-log.builder';
import type { ClientErrorReportDto } from './dto/client-error-report.dto';
import type { ClientErrorRequestMeta } from './client-errors.types';

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

    const { severity, logEntry, stackTrace } = buildClientErrorLog(
      payload,
      requestMeta,
      {
        stackMaxLength: this.stackMaxLength,
        detailsMaxLength: this.detailsMaxLength,
      },
    );
    const logMessage = JSON.stringify(logEntry);

    if (severity === 'error') {
      if (stackTrace) {
        this.logger.error(logMessage, stackTrace);
        return;
      }

      this.logger.error(logMessage);
      return;
    }

    this.logger.warn(logMessage);
  }

  private readPositiveNumberConfig(
    configKey: string,
    fallback: number,
  ): number {
    const value = this.configService.get<number>(configKey);
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return Math.floor(value);
  }
}
