import { Test, TestingModule } from '@nestjs/testing';
import { ClientErrorsController } from './client-errors.controller';
import { ClientErrorsService } from './client-errors.service';
import type { ClientErrorReportDto } from './dto/client-error-report.dto';

describe('ClientErrorsController', () => {
  let controller: ClientErrorsController;

  const clientErrorsService = {
    report: jest.fn(),
  };

  const payload: ClientErrorReportDto = {
    reportId: 'err_123',
    source: 'window-error',
    message: 'boom',
    errorName: 'Error',
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
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientErrorsController],
      providers: [
        { provide: ClientErrorsService, useValue: clientErrorsService },
      ],
    }).compile();

    controller = module.get<ClientErrorsController>(ClientErrorsController);
  });

  it('会把错误负载和请求元数据透传给 service', () => {
    const request = {
      ip: '127.0.0.1',
      headers: {
        'x-request-id': 'req-1',
        'user-agent': 'Mozilla/5.0 (Macintosh)',
      },
    };

    controller.report(payload, request);

    expect(clientErrorsService.report).toHaveBeenCalledWith(payload, {
      clientIp: '127.0.0.1',
      requestId: 'req-1',
      requestUserAgent: 'Mozilla/5.0 (Macintosh)',
    });
  });

  it('会兼容数组形式的请求头', () => {
    const request = {
      ip: '10.0.0.8',
      headers: {
        'x-request-id': ['req-a', 'req-b'],
        'user-agent': ['Mozilla/5.0 (iPhone)', 'fallback'],
      },
    };

    controller.report(payload, request);

    expect(clientErrorsService.report).toHaveBeenCalledWith(payload, {
      clientIp: '10.0.0.8',
      requestId: 'req-a',
      requestUserAgent: 'Mozilla/5.0 (iPhone)',
    });
  });
});
