import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const execFileAsync = promisify(execFile);

/** 可用的 USB 小票打印机信息。 */
export interface UsbPrinterInfo {
  /** 打印机标识：Linux 设备路径（/dev/usb/lp0）或 CUPS 打印机名。 */
  id: string;
  /** 展示名称。 */
  name: string;
  /** 通道类型：device=Linux USB 设备文件 / cups=CUPS 系统打印机。 */
  type: 'device' | 'cups';
}

interface UsbPrintConfig {
  device: string;
  timeoutMs: number;
}

/**
 * USB 小票打印机硬件层：
 * - Linux：USB 打印类设备直接写 /dev/usb/lp* 设备文件
 * - macOS / Linux：CUPS 系统打印机（lp -o raw）
 * - 支持通过环境变量 USB_PRINT_DEVICE 指定默认打印机
 */
@Injectable()
export class UsbPrintService {
  private readonly config: UsbPrintConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = {
      device: this.configService.get<string>('usbPrint.device') ?? '',
      timeoutMs: this.configService.get<number>('usbPrint.timeoutMs') ?? 10000,
    };
  }

  /** 探测服务器上当前可用的 USB / 系统小票打印机。 */
  async listDevices(): Promise<UsbPrinterInfo[]> {
    const devices: UsbPrinterInfo[] = [];

    // Linux USB 打印类设备：/dev/usb/lp*
    if (process.platform === 'linux') {
      try {
        const entries = await fs.readdir('/dev/usb');
        for (const entry of entries.sort()) {
          if (/^lp\d+$/.test(entry)) {
            devices.push({
              id: `/dev/usb/${entry}`,
              name: entry,
              type: 'device',
            });
          }
        }
      } catch {
        // /dev/usb 不存在时忽略，回退到 CUPS 探测
      }
    }

    // CUPS 系统打印机（macOS / Linux 通用）
    try {
      const { stdout } = await execFileAsync('lpstat', ['-p'], {
        timeout: 3000,
      });
      for (const line of stdout.split('\n')) {
        const match = /^printer\s+(\S+)\s+/.exec(line);
        if (match) {
          devices.push({ id: match[1], name: match[1], type: 'cups' });
        }
      }
    } catch {
      // lpstat 不可用时忽略
    }

    return devices;
  }

  /**
   * 将原始 ESC/POS 字节发送到指定打印机。
   * @param data ESC/POS 字节流
   * @param device 打印机标识：设备路径（/dev/usb/lp0）或 CUPS 打印机名；不传则用配置/自动探测
   * @returns 实际使用的打印机标识
   */
  async printRaw(data: Buffer, device?: string): Promise<string> {
    const resolved = await this.resolveDevice(device);
    if (resolved.type === 'device') {
      await this.writeDevice(resolved.id, data);
    } else {
      await this.writeCups(resolved.id, data);
    }
    return resolved.id;
  }

  private async resolveDevice(device?: string): Promise<UsbPrinterInfo> {
    const id = device?.trim() || this.config.device;
    if (id) {
      return id.startsWith('/')
        ? { id, name: id, type: 'device' }
        : { id, name: id, type: 'cups' };
    }
    const devices = await this.listDevices();
    if (devices.length === 0) {
      throw new ServiceUnavailableException(
        '未检测到可用的 USB 小票打印机，请确认打印机已连接并在打印设置中配置打印机',
      );
    }
    return devices[0];
  }

  private async writeDevice(devicePath: string, data: Buffer): Promise<void> {
    try {
      await fs.writeFile(devicePath, data);
    } catch (error) {
      throw new ServiceUnavailableException(
        `写入 USB 打印机 ${devicePath} 失败：${this.errorMessage(error)}`,
      );
    }
  }

  private async writeCups(printer: string, data: Buffer): Promise<void> {
    const tmpFile = path.join(
      os.tmpdir(),
      `escpos-${Date.now()}-${randomBytes(4).toString('hex')}.bin`,
    );
    try {
      await fs.writeFile(tmpFile, data);
      await execFileAsync('lp', ['-o', 'raw', '-d', printer, tmpFile], {
        timeout: this.config.timeoutMs,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `调用系统打印 ${printer} 失败：${this.errorMessage(error)}`,
      );
    } finally {
      await fs.rm(tmpFile, { force: true }).catch(() => undefined);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '打印机不可用';
  }
}
