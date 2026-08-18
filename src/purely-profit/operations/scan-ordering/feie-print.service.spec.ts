import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
        'feiePrint.apiUrl': 'https://api.feieyun.cn/Api/Open/',
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
    const freshService = new FeiePrintService(
      configService as unknown as ConfigService,
    );
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

  it('调用飞鹅成功返回订单 ID，且使用路径化接口地址', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: jest
        .fn()
        .mockResolvedValue({ ret: 0, msg: 'ok', data: 'order-123' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.printMessage('SN123', 'hello<BR>', 1);

    expect(result).toBe('order-123');
    // 校验使用分流改造后的路径化接口地址
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.feieyun.cn/Api/Open/printMsg');
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get('apiname')).toBe('Open_printMsg');
    expect(body.get('sn')).toBe('SN123');
    expect(body.get('content')).toBe('hello<BR>');
    expect(body.get('user')).toBe('dev-user');
    expect(body.get('sig')).toMatch(/^[a-f0-9]{40}$/);
  });

  it('base URL 无尾部斜杠时自动补齐后再拼接接口路径', async () => {
    configService.get.mockImplementation((key: string) => {
      const map: Record<string, string> = {
        'feiePrint.user': 'dev-user',
        'feiePrint.ukey': 'dev-ukey',
        'feiePrint.apiUrl': 'https://api.feieyun.cn/Api/Open',
      };
      return map[key] ?? '';
    });
    const freshService = new FeiePrintService(
      configService as unknown as ConfigService,
    );
    const fetchMock = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ ret: 0, msg: 'ok', data: 'order-1' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await freshService.printMessage('SN123', 'hello');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.feieyun.cn/Api/Open/printMsg');
  });

  it('飞鹅返回错误时抛 503', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: jest
        .fn()
        .mockResolvedValue({ ret: -2, msg: '参数错误', data: null }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(service.printMessage('SN123', 'hello')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('查询打印机状态为在线时归一化为 online', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        ret: 0,
        msg: 'ok',
        data: '在线，工作状态正常。',
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(service.queryPrinterStatus('SN123')).resolves.toBe('online');
    // 校验使用路径化状态查询接口
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.feieyun.cn/Api/Open/queryPrinterStatus');
  });

  it('查询打印机状态为离线时归一化为 offline', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ ret: 0, msg: 'ok', data: '离线。' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(service.queryPrinterStatus('SN123')).resolves.toBe('offline');
  });

  it('查询订单已打印返回 true，未打印返回 false', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({ ret: 0, msg: 'ok', data: true }),
      })
      .mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({ ret: 0, msg: 'ok', data: false }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(service.queryOrderState('order-1')).resolves.toBe(true);
    await expect(service.queryOrderState('order-1')).resolves.toBe(false);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.feieyun.cn/Api/Open/queryOrderState');
  });
});
