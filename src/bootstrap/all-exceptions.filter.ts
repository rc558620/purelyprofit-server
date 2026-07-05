import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * 全局异常过滤器
 *
 * - HttpException：保留原始 statusCode + message，补充 requestId
 * - 非 HttpException（未预期异常）：生产环境隐藏内部细节，仅返回通用错误消息
 * - 所有异常均记录日志（非预期异常记录完整 stack）
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly isProduction: boolean;

  constructor(isProduction: boolean) {
    this.isProduction = isProduction;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const requestId = (request.id as string) ?? 'unknown';
    const timestamp = new Date().toISOString();

    let statusCode: number;
    let message: string;
    let code: string | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        const rawMessage = (exceptionResponse as { message: unknown }).message;
        message = Array.isArray(rawMessage)
          ? rawMessage.join('; ')
          : String(rawMessage);
      } else {
        message = exception.message;
      }

      // 4xx 客户端错误记录 warn 级别，5xx 记录 error 级别
      if (statusCode >= 500) {
        this.logger.error(
          `[${requestId}] ${request.method} ${request.url} → ${statusCode}: ${message}`,
          exception.stack,
        );
      } else {
        this.logger.warn(
          `[${requestId}] ${request.method} ${request.url} → ${statusCode}: ${message}`,
        );
      }
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      message = this.isProduction
        ? '服务器内部错误，请稍后重试'
        : exception instanceof Error
          ? exception.message
          : '未知错误';

      this.logger.error(
        `[${requestId}] Unhandled exception: ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // 业务异常码透传（如 VALIDATION_ERROR、PAYMENT_FAILED 等），
    // 非 HttpException 不设 code，前端按 statusCode 判断即可
    if (
      exception instanceof HttpException &&
      typeof exception.getResponse() === 'object' &&
      exception.getResponse() !== null &&
      'code' in (exception.getResponse() as Record<string, unknown>)
    ) {
      code = String((exception.getResponse() as Record<string, unknown>).code);
    }

    const responseBody: Record<string, unknown> = {
      statusCode,
      message,
      timestamp,
      path: request.url,
      requestId,
    };

    if (code) {
      responseBody.code = code;
    }

    response.status(statusCode).send(responseBody);
  }
}
