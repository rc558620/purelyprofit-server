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
    appHosts: ['profit.example.com'],
  };

  it('会为运行时异常构建带顶层检索字段的 error 日志', () => {
    const result = buildClientErrorLog(
      createPayload(),
      requestMeta,
      defaultConfig,
    );

    expect(result.severity).toBe('error');
    expect(result.logEntry.stack).toBe('Error: boom error\n    at App.tsx:1:1');
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
    expect(result.logEntry.receivedAt).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
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
        appHosts: ['profit.example.com'],
      },
    );

    expect(result.logEntry.detailsPreview).toBe('{"huge":"abc...<truncated>');
    expect(result.logEntry.detailComponentStack).toBe(
      'at AppShell (/src/App.tsx:42:3)\n at BrowserRouter (react-router-dom)',
    );
    expect(result.logEntry.stack).toBe('Error: boo...<truncated>');
  });

  it('会脱敏 details 中的敏感字段', () => {
    const result = buildClientErrorLog(
      createPayload({
        details: {
          filename: '/src/App.tsx',
          accessToken: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
          password: 'p@ssw0rd',
          phone: '13800001111',
          requestBody: { smsCode: '123456', amount: 100 },
        },
      }),
      {},
      defaultConfig,
    );

    expect(result.logEntry.detailsPreview).toBe(
      '{"filename":"/src/App.tsx","accessToken":"[redacted]","password":"[redacted]","phone":"[redacted]","requestBody":{"smsCode":"[redacted]","amount":100}}',
    );
    expect(result.logEntry.detailsKeys).toEqual([
      'filename',
      'accessToken',
      'password',
      'phone',
      'requestBody',
    ]);
  });

  it('会限制 details 的 key 数量，避免单条日志被撑爆', () => {
    const hugeDetails: Record<string, unknown> = {};
    for (let index = 0; index < 5000; index += 1) {
      hugeDetails[`key_${index}`] = index;
    }

    const result = buildClientErrorLog(
      createPayload({ details: hugeDetails }),
      {},
      defaultConfig,
    );

    expect(result.logEntry.detailsKeys).toHaveLength(20);
  });

  it('位数不足的手机号不会明文落入日志', () => {
    const result = buildClientErrorLog(
      createPayload({
        user: { name: 'Forest', phone: '138', verified: true },
      }),
      {},
      defaultConfig,
    );

    expect(result.logEntry.userPhoneMasked).toBeNull();
    expect(result.logEntry.detailsPreview).not.toContain('138');
  });

  it('app / user / store 上下文缺失时不会抛异常', () => {
    const brokenPayload = {
      reportId: 'err_broken',
      source: 'window-error',
      message: 'boom',
      errorName: 'Error',
      occurredAt: '2026-06-08T11:20:00.000Z',
    } as unknown as ClientErrorReportDto;

    expect(() =>
      buildClientErrorLog(brokenPayload, {}, defaultConfig),
    ).not.toThrow();

    const result = buildClientErrorLog(brokenPayload, {}, defaultConfig);
    expect(result.logEntry).toMatchObject({
      appMode: 'unknown',
      pagePathname: '/',
      userPhoneMasked: null,
      storeId: null,
      stackHead: null,
      detailsKeys: null,
    });
  });

  it('浏览器扩展抛出的错误会被判为第三方并降级', () => {
    const result = buildClientErrorLog(
      createPayload({
        source: 'window-error',
        stack: 'Error: injected\n    at chrome-extension://abcdef/content.js:12:3',
      }),
      {},
      defaultConfig,
    );

    expect(result.logEntry.errorOrigin).toBe('third-party');
    // 第三方脚本错误不参与 error 级告警，否则会淹没本站错误
    expect(result.severity).toBe('warning');
    expect(result.logEntry.logCode).toBe('third_party_exception');
    expect(result.logEntry.alertLevel).toBe('info');
  });

  it('堆栈 host 与页面域名不符时判为第三方', () => {
    const result = buildClientErrorLog(
      createPayload({
        stack: 'Error: sdk boom\n    at https://cdn.weixin.qq.com/sdk.js:1:1',
      }),
      {},
      defaultConfig,
    );

    expect(result.logEntry.errorOrigin).toBe('third-party');
    expect(result.severity).toBe('warning');
  });

  it('堆栈命中 bundle 独立域名时仍判为本站代码', () => {
    const result = buildClientErrorLog(
      createPayload({
        stack: 'Error: boom\n    at https://static.example.com/assets/index.js:1:1',
      }),
      {},
      { ...defaultConfig, appHosts: ['static.example.com'] },
    );

    expect(result.logEntry.errorOrigin).toBe('app');
    expect(result.severity).toBe('error');
  });

  it('HTTP 请求缺失 statusCode 视为网络层失败，按 error + high 处理', () => {
    const result = buildClientErrorLog(
      createPayload({
        source: 'http',
        statusCode: undefined,
        message: 'Network Error',
      }),
      {},
      defaultConfig,
    );

    expect(result.severity).toBe('error');
    expect(result.logEntry.logCode).toBe('upstream_http_error');
    expect(result.logEntry.alertLevel).toBe('high');
  });

  it('宽松校验下 source 缺失时仍能产出可用聚合键', () => {
    const result = buildClientErrorLog(
      createPayload({ source: undefined as never }),
      {},
      defaultConfig,
    );

    expect(result.logEntry.source).toBe('unknown');
    expect(result.logEntry.aggregateKey).toContain('unknown|runtime_exception');
  });
});
