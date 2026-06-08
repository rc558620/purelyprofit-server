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
    message: 'boom error',
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

    (
      service as unknown as { logger: Logger }
    ).logger = logger;

    return {
      service,
      logger,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('运行时异常会上报 error 级别日志，并带脱敏后的上下文', () => {
    const { service, logger } = createService();

    service.report(createPayload(), {
      clientIp: '127.0.0.1',
      requestId: 'req-1',
      requestUserAgent: 'Mozilla/5.0 (Macintosh)',
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('[client-errors] runtime_exception'),
      'Error: boom error\n    at App.tsx:1:1',
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('138****1111'),
      'Error: boom error\n    at App.tsx:1:1',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('HTTP 4xx 错误会降级为 warn 日志', () => {
    const { service, logger } = createService();

    service.report(
      createPayload({
        source: 'http',
        statusCode: 400,
        message: 'Bad Request',
        businessCode: '4001',
      }),
      {
        requestId: 'req-http-400',
      },
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[client-errors] upstream_http_warning'),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('会按配置裁剪 details 和 stack 长度', () => {
    const { service, logger } = createService({
      'app.clientErrorStackMaxLength': 10,
      'app.clientErrorDetailsMaxLength': 12,
    });

    service.report(
      createPayload({
        details: {
          huge: 'abcdefghijklmnopqrstuvwxyz',
        },
      }),
      {},
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('...<truncated>'),
      'Error: boo...<truncated>',
    );
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
