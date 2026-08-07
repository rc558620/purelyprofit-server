import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { UsbPrintService } from './usb-print.service';

jest.mock('node:fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn(),
  rm: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

const execFileMock = execFile as unknown as jest.Mock;

/** 以 callback 风格模拟 execFile（promisify 需要回调触发 resolve）。 */
function mockExecFile(impl: (cmd: string, args: string[]) => unknown): void {
  execFileMock.mockImplementation(
    (
      cmd: string,
      args: string[],
      _options: unknown,
      callback: (err: Error | null, result: { stdout: string }) => void,
    ) => {
      callback(null, { stdout: impl(cmd, args) ?? '' });
    },
  );
}

describe('UsbPrintService', () => {
  let service: UsbPrintService;
  const configService = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) => {
      const map: Record<string, unknown> = {
        'usbPrint.device': '',
        'usbPrint.timeoutMs': 10000,
      };
      return map[key];
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsbPrintService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    service = module.get<UsbPrintService>(UsbPrintService);
  });

  it('printRaw 指定设备路径时直接写入文件', async () => {
    const data = Buffer.from([0x1b, 0x40]);
    const result = await service.printRaw(data, '/dev/usb/lp0');

    expect(result).toBe('/dev/usb/lp0');
    expect(fs.writeFile).toHaveBeenCalledWith('/dev/usb/lp0', data);
  });

  it('printRaw 指定 CUPS 打印机名时调用 lp -o raw', async () => {
    const data = Buffer.from([0x1b, 0x40]);
    mockExecFile(() => '');
    const result = await service.printRaw(data, 'RP58');

    expect(result).toBe('RP58');
    expect(execFileMock).toHaveBeenCalledWith(
      'lp',
      expect.arrayContaining(['-o', 'raw', '-d', 'RP58']),
      expect.anything(),
      expect.anything(),
    );
  });

  it('printRaw 未指定打印机时自动探测 CUPS 打印机', async () => {
    mockExecFile((cmd) => {
      if (cmd === 'lpstat')
        return 'printer RP58 is idle\nprinter Kitchen80 is enabled';
      return '';
    });
    const result = await service.printRaw(Buffer.from([0x1b, 0x40]));

    expect(result).toBe('RP58');
    expect(execFileMock).toHaveBeenCalledWith(
      'lp',
      expect.arrayContaining(['-d', 'RP58']),
      expect.anything(),
      expect.anything(),
    );
  });

  it('未探测到打印机时抛 503', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _options: unknown,
        callback: (err: Error | null) => void,
      ) => {
        callback(new Error('lpstat not found'));
      },
    );
    await expect(service.printRaw(Buffer.from([0x1b, 0x40]))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('写入设备文件失败时抛 503', async () => {
    (fs.writeFile as jest.Mock).mockRejectedValueOnce(new Error('EACCES'));
    await expect(
      service.printRaw(Buffer.from([0x1b]), '/dev/usb/lp0'),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('listDevices 在 Linux 下同时探测设备文件与 CUPS', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    (fs.readdir as jest.Mock).mockResolvedValue(['lp0', 'lp1']);
    mockExecFile((cmd) => (cmd === 'lpstat' ? 'printer RP58 is idle' : ''));

    try {
      const devices = await service.listDevices();
      expect(devices).toContainEqual({
        id: '/dev/usb/lp0',
        name: 'lp0',
        type: 'device',
      });
      expect(devices).toContainEqual({
        id: 'RP58',
        name: 'RP58',
        type: 'cups',
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
