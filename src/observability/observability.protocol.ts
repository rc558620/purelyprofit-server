export type ObservabilityProcessSnapshot = {
  pid: number;
  nodeVersion: string;
  uptimeSeconds: number;
  cpuUsedMs: number;
  approxCpuUtilizationPercent: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
};

export type HealthStatus = 'ok';

export type HealthCountersSnapshot = {
  httpRequests: number;
  sqlQueries: number;
  redisCalls: number;
};

export type HealthSnapshot = {
  status: HealthStatus;
  generatedAt: string;
  process: ObservabilityProcessSnapshot;
  counters: HealthCountersSnapshot;
};
