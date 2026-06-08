import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ClientErrorsService,
  type ClientErrorRequestMeta,
} from './client-errors.service';
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
  @ApiOperation({ summary: '接收前端全局错误上报' })
  @ApiNoContentResponse({ description: '错误日志接收成功' })
  report(
    @Body() payload: ClientErrorReportDto,
    @Req() request: { ip?: string; headers: Record<string, string | string[] | undefined> },
  ): void {
    const requestMeta: ClientErrorRequestMeta = {
      clientIp: request.ip,
      requestId: readHeaderValue(request.headers['x-request-id']),
      requestUserAgent: readHeaderValue(request.headers['user-agent']),
    };

    this.clientErrorsService.report(payload, requestMeta);
  }
}
