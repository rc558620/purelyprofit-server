import os from 'node:os';

/**
 * 解析 Cluster Worker 数量。
 *
 * 生产环境建议显式设置 CLUSTER_WORKERS，并按 PostgreSQL 连接池预算确定数量。
 * 未设置时回退到 CPU 核数，确保开发环境仍可直接启动。
 */
export const isClusterMode = (): boolean => {
  return Boolean(process.env.CLUSTER_WORKERS);
};

export const resolveClusterWorkerCount = (): number => {
  const rawWorkerCount = process.env.CLUSTER_WORKERS;
  const parsedWorkerCount = Number.parseInt(rawWorkerCount ?? '', 10);

  if (Number.isFinite(parsedWorkerCount) && parsedWorkerCount > 0) {
    return parsedWorkerCount;
  }

  return Math.max(1, os.cpus().length);
};
