import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BusinessEventsService } from './business-events.service';
import { BusinessEventReportDto } from './dto/business-event-report.dto';

@ApiTags('Business Events')
@Controller('business-events')
export class BusinessEventsController {
  constructor(private readonly businessEventsService: BusinessEventsService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  /**
   * 埋点是无认证写入接口，必须显式设上限：
   * 正常客户端一屏只会产生个位数事件，30 次/分钟足够；
   * 没有上限时被刷会让日志量失控（错误上报低频可以不管，埋点高频不行）。
   */
  @Throttle({ default: { ttl: 60, limit: 30 } })
  @ApiOperation({ summary: '接收前端业务埋点事件' })
  @ApiNoContentResponse({ description: '事件接收成功' })
  report(@Body() payload: BusinessEventReportDto): void {
    this.businessEventsService.report(payload);
  }
}
