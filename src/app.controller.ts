import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  HealthSnapshot,
  MetricsSnapshot,
  ReadinessSnapshot,
} from './observability';
import { AppService } from './app.service';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: '获取服务健康检查响应' })
  @ApiOkResponse({ description: '服务基础健康状态与进程摘要' })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @ApiOperation({ summary: '获取服务健康状态' })
  @ApiOkResponse({ description: '返回运行时健康状态与关键计数器' })
  @Get('healthz')
  getHealth(): HealthSnapshot {
    return this.appService.getHealth();
  }

  @ApiOperation({ summary: '获取服务就绪状态' })
  @ApiOkResponse({
    description: '返回 PostgreSQL 与 Redis 的 readiness 检查结果',
  })
  @Get('readyz')
  async getReadiness(): Promise<ReadinessSnapshot> {
    return this.appService.getReadiness();
  }

  @ApiOperation({ summary: '获取运行时观测指标快照' })
  @ApiOkResponse({
    description: '返回 HTTP、SQL、Redis、缓存预热任务的实时观测指标聚合',
  })
  @Get('metrics')
  getMetrics(): MetricsSnapshot {
    return this.appService.getMetrics();
  }
}
