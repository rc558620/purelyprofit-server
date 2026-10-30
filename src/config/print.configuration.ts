import { parseIntValue } from './env.utils';

/**
 * `printAgent` 配置块：扫码点餐打印代理发布配置。
 *
 * 发版时同步更新 latestVersion（与 print-agent 源码 Version 常量一致），
 * 商家端设置页据此提示客户下载新版代理。
 */
export interface PrintAgentConfig {
  /** 最新可下载的代理版本号（与 Go 代理 Version 常量保持一致） */
  latestVersion: string;
}

/**
 * `feiePrint` 配置块：飞鹅云打印（商家扫码点餐云打印通道）。
 * 未配置时云打印接口降级为不可用，不影响浏览器打印通道。
 */
export interface FeiePrintConfig {
  /** 飞鹅云后台注册的开发者账号名 */
  user: string;
  /** 飞鹅云后台注册后生成的 UKEY（签名用，严禁泄露） */
  ukey: string;
  /** 飞鹅开放接口地址（中国站正式地址；业务按接口名在其后拼接路径） */
  apiUrl: string;
  /** 单次飞鹅接口请求超时（毫秒）：云端挂起时快速失败，避免拖到全局 HTTP 超时 */
  timeoutMs: number;
}

/**
 * `usbPrint` 配置块：USB 小票打印机（扫码点餐 usb 打印通道）。
 *
 * 打印机需连接在服务器本机；Linux 走 /dev/usb/lp* 设备文件，macOS/Linux 走 CUPS（lp -o raw）。
 */
export interface UsbPrintConfig {
  /** 默认打印机标识：Linux 设备路径（如 /dev/usb/lp0）或 CUPS 打印机名；留空自动探测 */
  device: string;
  /** 小票文本编码：gbk（默认，兼容国产热敏机）/ utf8 */
  encoding: string;
  /** 调用系统打印命令超时（毫秒） */
  timeoutMs: number;
}

/** 打印通道配置：打印代理 / 飞鹅云打印 / USB 打印。 */
export interface PrintConfig {
  printAgent: PrintAgentConfig;
  feiePrint: FeiePrintConfig;
  usbPrint: UsbPrintConfig;
}

/** 解析 `printAgent` 配置块。 */
export function resolvePrintAgentConfig(): PrintAgentConfig {
  return {
    /** 最新可下载的代理版本号（与 Go 代理 Version 常量保持一致） */
    latestVersion: process.env.PRINT_AGENT_LATEST_VERSION ?? '0.1.0',
  };
}

/** 解析 `feiePrint` 配置块。 */
export function resolveFeiePrintConfig(): FeiePrintConfig {
  return {
    /** 飞鹅云后台注册的开发者账号名 */
    user: process.env.FEIE_PRINT_USER ?? '',
    /** 飞鹅云后台注册后生成的 UKEY（签名用，严禁泄露） */
    ukey: process.env.FEIE_PRINT_UKEY ?? '',
    /** 飞鹅开放接口地址（中国站正式地址；2026-01 起官方按接口路径分流，此处为 base，业务按接口名拼接路径） */
    apiUrl:
      process.env.FEIE_PRINT_API_URL ?? 'https://api.feieyun.cn/Api/Open/',
    /** 单次飞鹅接口请求超时（毫秒）：云端挂起时快速失败，避免拖到全局 HTTP 超时 */
    timeoutMs: parseIntValue(process.env.FEIE_PRINT_TIMEOUT_MS, 10000),
  };
}

/** 解析 `usbPrint` 配置块。 */
export function resolveUsbPrintConfig(): UsbPrintConfig {
  return {
    /** 默认打印机标识：Linux 设备路径（如 /dev/usb/lp0）或 CUPS 打印机名；门店未配置时使用，留空自动探测 */
    device: process.env.USB_PRINT_DEVICE ?? '',
    /** 小票文本编码：gbk（默认，兼容国产热敏机）/ utf8 */
    encoding: process.env.USB_PRINT_ENCODING ?? 'gbk',
    /** 调用系统打印命令超时（毫秒） */
    timeoutMs: parseIntValue(process.env.USB_PRINT_TIMEOUT_MS, 10000),
  };
}

/** 解析打印通道配置（printAgent / feiePrint / usbPrint）。 */
export function resolvePrintConfig(): PrintConfig {
  return {
    printAgent: resolvePrintAgentConfig(),
    feiePrint: resolveFeiePrintConfig(),
    usbPrint: resolveUsbPrintConfig(),
  };
}
