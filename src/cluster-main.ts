import cluster, { type Worker } from 'node:cluster';
import os from 'node:os';

function resolveWorkerCount(): number {
  const envCount = process.env.CLUSTER_WORKERS;
  if (envCount) {
    const parsed = parseInt(envCount, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return Math.max(1, os.cpus().length);
}

if (cluster.isPrimary) {
  const workerCount = resolveWorkerCount();
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
    if (!worker.exitedAfterDisconnect) {
      console.log('[cluster] respawning worker...');
      cluster.fork();
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
  void import('./main.js').then(({ bootstrap }) => bootstrap());
}
