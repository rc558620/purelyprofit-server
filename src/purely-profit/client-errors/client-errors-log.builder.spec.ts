import { buildClientErrorLog } from './client-errors-log.builder';
import type { ClientErrorRequestMeta } from './client-errors.types';
import type { ClientErrorReportDto } from './dto/client-error-report.dto';

describe('buildClientErrorLog', () => {
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

  const requestMeta: ClientErrorRequestMeta = {
    clientIp: '127.0.0.1',
    requestId: 'req-1',
    requestUserAgent: 'Mozilla/5.0 (Macintosh)',
  };

  const defaultConfig = {
    stackMaxLength: 2000,
    detailsMaxLength: 2000,
  };

  it('会为运行时异常构建带顶层检索字段的 error 日志', () => {
    const result = buildClientErrorLog(
      createPayload(),
      requestMeta,
      defaultConfig,
    );

    expect(result.severity).toBe('error');
    expect(result.stackTrace).toBe('Error: boom error\n    at App.tsx:1:1');
    expect(result.logEntry).toMatchObject({
      event: 'client_error_reported',
      domain: 'client_errors',
      severity: 'error',
      logCode: 'runtime_exception',
      alertLevel: 'high',
      aggregationBucket: 'runtime_window_error',
      reportId: 'err_123',
      source: 'window-error',
      pagePathname: '/main/dashboard',
      requestId: 'req-1',
      clientIp: '127.0.0.1',
      userPhoneMasked: '138****1111',
      userVerified: true,
      storeId: 18,
      storeName: '纯利咖啡',
      stackHead: 'Error: boom error',
      messageTag: 'request failed with status code :num',
      statusCodeTag: 'status_code:none',
      businessCodeTag: 'business_code:none',
      aggregateKey:
        'window-error|runtime_exception|status_code:none|business_code:none|request failed with status code :num',
      detailsKeys: [
        'filename',
        'lineno',
        'colno',
        'reasonType',
        'componentStack',
        'trigger',
      ],
      detailFilename: '/src/App.tsx',
      detailLineno: 27,
      detailColno: 13,
      detailReasonType: 'Error',
      detailComponentStack: 'at AppShell (/src/App.tsx:42:3)',
      detailTrigger: 'window-listener',
    });
    expect(result.logEntry.receivedAt).toEqual(expect.any(String));
  });

  it('会为 HTTP 4xx 构建 warning 日志和聚合标签', () => {
    const result = buildClientErrorLog(
      createPayload({
        source: 'http',
        statusCode: 400,
        message: 'Request failed with status code 400',
        businessCode: 'ORDER_4001',
      }),
      {
        requestId: 'req-http-400',
      },
      defaultConfig,
    );

    expect(result.severity).toBe('warning');
    expect(result.logEntry).toMatchObject({
      severity: 'warning',
      logCode: 'upstream_http_warning',
      alertLevel: 'warning',
      aggregationBucket: 'http_4xx',
      source: 'http',
      statusCode: 400,
      statusCodeTag: 'status_code:400',
      businessCode: 'ORDER_4001',
      businessCodeTag: 'business_code:order_4001',
      messageTag: 'request failed with status code :num',
      aggregateKey:
        'http|upstream_http_warning|status_code:400|business_code:order_4001|request failed with status code :num',
      isHttpError: true,
      httpStatusLevel: '4xx',
      requestId: 'req-http-400',
      detailFilename: '/src/App.tsx',
      detailLineno: 27,
      detailColno: 13,
    });
  });

  it('会为 react-render 标记 critical 告警等级', () => {
    const result = buildClientErrorLog(
      createPayload({
        source: 'react-render',
        message: 'Render failed in dashboard',
      }),
      {},
      defaultConfig,
    );

    expect(result.severity).toBe('error');
    expect(result.logEntry).toMatchObject({
      source: 'react-render',
      alertLevel: 'critical',
      aggregationBucket: 'runtime_render',
    });
  });

  it('会按配置裁剪 details 和 stack 长度', () => {
    const result = buildClientErrorLog(
      createPayload({
        details: {
          huge: 'abcdefghijklmnopqrstuvwxyz',
          componentStack:
            'at AppShell (/src/App.tsx:42:3)\n at BrowserRouter (react-router-dom)',
        },
      }),
      {},
      {
        stackMaxLength: 10,
        detailsMaxLength: 12,
      },
    );

    expect(result.logEntry.detailsPreview).toBe('{"huge":"abc...<truncated>');
    expect(result.logEntry.detailComponentStack).toBe(
      'at AppShell (/src/App.tsx:42:3)\n at BrowserRouter (react-router-dom)',
    );
    expect(result.stackTrace).toBe('Error: boo...<truncated>');
  });
});
