import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientErrorsService } from './client-errors.service';
import type { ClientErrorReportDto } from './dto/client-error-report.dto';

describe('ClientErrorsService', () => {
  const createPayload = (
    overrides: Partial<ClientErrorReportDto> = {},
  ): ClientErrorReportDto => ({
    reportId: 'err_123',
    source: 'window-error',
    message: 'Request failed with status code 500',
    errorName: 'Error',
    stack: 'Error: boom error\n    at App.tsx:1:1',
    occurredAt: '2026-06-08T11:20:00.000Z',
    app: {
      mode: 'production',
      release: '1.0.0',
      userAgent: 'Mozilla/5.0',
      language: 'zh-CN',
      url: 'https://profit.example.com/main/dashboard?tab=today',
      pathname: '/main/dashboard',
      search: '?tab=today',
      hash: '#profit',
    },
    user: {
      name: 'Forest',
      phone: '13800001111',
      verified: true,
    },
    store: {
      id: 18,
      storeName: '纯利咖啡',
      storeType: 'tea',
    },
    details: {
      filename: '/src/App.tsx',
      lineno: 27,
      colno: 13,
      reasonType: 'Error',
      componentStack: 'at AppShell (/src/App.tsx:42:3)',
      trigger: 'window-listener',
    },
    ...overrides,
  });

  const createService = (configMap?: Record<string, boolean | number>) => {
    const configService = {
      get: jest.fn((key: string) => configMap?.[key]),
    } as unknown as ConfigService;
    const service = new ClientErrorsService(configService);
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
    } as unknown as Logger;

    (service as unknown as { logger: Logger }).logger = logger;

    return {
      service,
      logger: logger as unknown as {
        error: jest.Mock;
        warn: jest.Mock;
        log: jest.Mock;
      },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('error 级别会走 logger.error 并附带 stackTrace', () => {
    const { service, logger } = createService();

    service.report(createPayload(), {
      clientIp: '127.0.0.1',
      requestId: 'req-1',
      requestUserAgent: 'Mozilla/5.0 (Macintosh)',
    });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logMessage, stackTrace] = logger.error.mock.calls[0] ?? [];
    expect(typeof logMessage).toBe('string');
    expect(JSON.parse(logMessage as string)).toMatchObject({
      event: 'client_error_reported',
      severity: 'error',
      source: 'window-error',
    });
    expect(stackTrace).toBe('Error: boom error\n    at App.tsx:1:1');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warning 级别会走 logger.warn', () => {
    const { service, logger } = createService();

    service.report(
      createPayload({
        source: 'http',
        statusCode: 400,
        message: 'Request failed with status code 400',
      }),
      {},
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [logMessage] = logger.warn.mock.calls[0] ?? [];
    expect(typeof logMessage).toBe('string');
    expect(JSON.parse(logMessage as string)).toMatchObject({
      event: 'client_error_reported',
      severity: 'warning',
      source: 'http',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('没有 stack 时仍会输出 error 日志', () => {
    const { service, logger } = createService();

    service.report(
      createPayload({
        stack: '   ',
      }),
      {},
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('关闭开关后不会落任何日志', () => {
    const { service, logger } = createService({
      'app.clientErrorLogEnabled': false,
    });

    service.report(createPayload(), {});

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });
});
