import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientErrorsService } from './client-errors.service';
import type { ClientErrorRequestMeta } from './client-errors.types';
import { ClientErrorReportDto } from './dto/client-error-report.dto';

const readHeaderValue = (
  value: string | string[] | undefined,
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0]?.trim() || undefined;
  }

  return value?.trim() || undefined;
};

@ApiTags('Client Errors')
@Controller('client-errors')
export class ClientErrorsController {
  constructor(private readonly clientErrorsService: ClientErrorsService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  /**
   * 错误上报**不是低频接口**，必须显式设上限，且比埋点更紧：
   * - 渲染死循环 / 轮询接口持续 5xx 会每秒产生几十条上报；
   * - ThrottlerGuard 按 IP 计数，门店共用出口 IP 时，一个人的死循环会挤掉全店配额；
   * - 被 429 拒绝的上报本身又是一条前端错误，不设上限会形成自激循环。
   */
  @Throttle({ default: { ttl: 60, limit: 20 } })
  @ApiOperation({ summary: '接收前端全局错误上报' })
  @ApiNoContentResponse({ description: '错误日志接收成功' })
  report(
    @Body() payload: ClientErrorReportDto,
    @Req()
    request: {
      ip?: string;
      headers: Record<string, string | string[] | undefined>;
    },
  ): void {
    const requestMeta: ClientErrorRequestMeta = {
      clientIp: request.ip,
      requestId: readHeaderValue(request.headers['x-request-id']),
      requestUserAgent: readHeaderValue(request.headers['user-agent']),
    };

    this.clientErrorsService.report(payload, requestMeta);
  }
}
