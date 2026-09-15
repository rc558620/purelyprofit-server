import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildBusinessEventLog } from './business-events-log.builder';
import type { BusinessEventReportDto } from './dto/business-event-report.dto';

/**
 * 业务事件接收服务。
 *
 * 与 client-errors 一样只落结构化日志、不落库：
 * 埋点量级远大于错误量，且分析诉求（漏斗、频次）适合交给日志管线聚合，
 * 避免为埋点引入写库压力与数据保留/合规问题。
 *
 * 上线前若需要按事件建索引，再迁移到专用分析存储，接口无需变更。
 */
@Injectable()
export class BusinessEventsService {
  private readonly logger = new Logger(BusinessEventsService.name);
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.enabled =
      this.configService.get<boolean>('app.businessEventLogEnabled') ?? true;
  }

  report(payload: BusinessEventReportDto): void {
    if (!this.enabled) {
      return;
    }

    const logEntry = buildBusinessEventLog(payload);

    // 统一以 log 级别输出：埋点是正常业务信号，不是异常，
    // 用 warn/error 会污染错误告警链路（告警应按日志内容分流，而非按级别）
    this.logger.log(JSON.stringify(logEntry));
  }
}
