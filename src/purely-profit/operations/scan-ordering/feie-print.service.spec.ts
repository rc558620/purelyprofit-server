import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { FeiePrintService } from './feie-print.service';

describe('FeiePrintService', () => {
  let service: FeiePrintService;
  const configService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) => {
      const map: Record<string, string> = {
        'feiePrint.user': 'dev-user',
        'feiePrint.ukey': 'dev-ukey',
        'feiePrint.apiUrl': 'https://api.de.feieyun.com/Api/Open/',
      };
      return map[key] ?? '';
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeiePrintService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    service = module.get<FeiePrintService>(FeiePrintService);
  });

  it('配置完整时 enabled 为 true', () => {
    expect(service.enabled).toBe(true);
  });

  it('未配置账号时 enabled 为 false 且打印抛 503', async () => {
    configService.get.mockReturnValue('');
    const freshService = new FeiePrintService(configService as unknown as ConfigService);
    expect(freshService.enabled).toBe(false);
    await expect(freshService.printMessage('SN', 'content')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('缺少打印机 SN 时抛 400', async () => {
    await expect(service.printMessage('', 'content')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('调用飞鹅成功返回订单 ID', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ ret: 0, msg: 'ok', data: 'order-123' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.printMessage('SN123', 'hello<BR>', 1);

    expect(result).toBe('order-123');
    // 校验表单提交参数
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.de.feieyun.com/Api/Open/');
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get('apiname')).toBe('Open_printMsg');
    expect(body.get('sn')).toBe('SN123');
    expect(body.get('content')).toBe('hello<BR>');
    expect(body.get('user')).toBe('dev-user');
    expect(body.get('sig')).toMatch(/^[a-f0-9]{40}$/);
  });

  it('飞鹅返回错误时抛 503', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ ret: -2, msg: '参数错误', data: null }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(service.printMessage('SN123', 'hello')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
