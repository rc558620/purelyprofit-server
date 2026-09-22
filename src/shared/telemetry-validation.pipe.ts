import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

/**
 * 遥测上报类 DTO 的标记字段（静态属性，不参与序列化/校验）。
 * 打了该标记的 DTO 会走 TelemetryValidationPipe 的宽松分支。
 */
export const isTelemetryReportDto = (metatype: unknown): boolean =>
  typeof metatype === 'function' &&
  (metatype as { telemetryReport?: unknown }).telemetryReport === true;

const STRICT_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
} as const;

/**
 * 遥测分支：未知字段只剥离、不拒绝，且校验失败也不丢弃上报。
 *
 * 与严格分支的差异是刻意的：
 * - forbidNonWhitelisted=false —— 前后端独立发版时，前端新增字段不应让整条上报 400；
 * - 校验失败降级而非拒绝 —— 崩溃到拿不到完整上下文的现场恰恰最值得记录，
 *   而且上报失败本身会被前端捕获成新错误再次上报，严格拒绝容易形成自激循环。
 */
const TELEMETRY_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
} as const;

/**
 * 全局校验 pipe：业务接口保持严格校验，遥测上报接口走宽松分支。
 *
 * ⚠️ 为什么必须在全局 pipe 内分发：Nest 的全局 pipe 与 controller / route 级 pipe
 * 是**叠加执行**的（见 @nestjs/core/helpers/context-creator.js 的 createContext），
 * 在遥测 controller 上挂一个宽松 pipe 无法覆盖全局严格 pipe —— 严格 pipe 先跑并直接抛出 400。
 */
export class TelemetryValidationPipe extends ValidationPipe {
  private readonly strictPipe = new ValidationPipe(STRICT_OPTIONS);
  private readonly telemetryPipe = new ValidationPipe(TELEMETRY_OPTIONS);

  async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    if (!isTelemetryReportDto(metadata.metatype)) {
      return this.strictPipe.transform(value, metadata);
    }

    try {
      return await this.telemetryPipe.transform(value, metadata);
    } catch {
      // 校验失败也不丢弃上报：退化为「只做类型转换」，
      // 缺失字段由下游 client-errors builder 的兜底逻辑处理。
      return this.transformWithoutValidation(value, metadata);
    }
  }

  private transformWithoutValidation(
    value: unknown,
    metadata: ArgumentMetadata,
  ): unknown {
    const { metatype } = metadata;
    if (
      typeof metatype !== 'function' ||
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      return {};
    }

    return plainToInstance(metatype, value, {
      enableImplicitConversion: true,
    });
  }
}
