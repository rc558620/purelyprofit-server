import { Injectable } from '@nestjs/common';
import type { HealthSnapshot, MetricsSnapshot } from './observability';
import { getHealthSnapshot, getRuntimeMetricsSnapshot } from './observability';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getHealth(): HealthSnapshot {
    return getHealthSnapshot();
  }

  getMetrics(): MetricsSnapshot {
    return getRuntimeMetricsSnapshot();
  }
}
