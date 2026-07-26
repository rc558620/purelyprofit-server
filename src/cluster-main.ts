import cluster, { type Worker } from 'node:cluster';
import { resolveClusterWorkerCount } from './config/cluster.configuration';

/**
 * 实时链路防误改：Cluster Worker 共享同一 HTTP 端口，Redis 负责跨 Worker 业务事件，
 * Socket.IO Redis Adapter 负责跨 Worker 的 /scan-ordering namespace 与房间广播。
 * 启动 Cluster 时不得同时运行 start:dev；端口被旧进程占用会导致 Worker 启动失败。
 */

if (cluster.isPrimary) {
  const workerCount = resolveClusterWorkerCount();
  console.log(
    `[cluster] primary pid=${process.pid} spawning ${workerCount} worker(s)`,
  );

  let aliveWorkers = 0;

  for (let i = 0; i < workerCount; i++) {
    cluster.fork();
  }

  cluster.on('online', (worker) => {
    aliveWorkers += 1;
    console.log(`[cluster] worker pid=${worker.process.pid} online`);
  });

  cluster.on('exit', (worker, code, signal) => {
    aliveWorkers -= 1;
    console.warn(
      `[cluster] worker pid=${worker.process.pid} exited code=${code} signal=${signal} alive=${aliveWorkers}`,
    );
    if (!worker.exitedAfterDisconnect && code !== 0) {
      console.error(
        '[cluster] worker 异常退出；停止自动重启以避免掩盖启动错误。修复错误后请重新启动 Cluster。',
      );
    }
  });

  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`[cluster] received ${signal}, shutting down workers...`);
    for (const worker of Object.values(cluster.workers ?? {})) {
      (worker as Worker | undefined)?.process.kill(signal);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} else {
  // Nest SWC 将 sourceRoot 保留在 dist/src；显式调用 bootstrap，require.main 不等于 main 模块。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { bootstrap } = require('./src/main') as typeof import('./main');
  void bootstrap();
}
