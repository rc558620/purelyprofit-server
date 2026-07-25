import * as childProcess from 'node:child_process';

interface ListenAddressInUseError extends Error {
  code?: string;
}

interface ListeningProcessInfo {
  command: string;
  pid: number;
  port: number;
}

function isListenAddressInUseError(
  error: unknown,
): error is ListenAddressInUseError {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as ListenAddressInUseError).code === 'EADDRINUSE'
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseListeningProcesses(rawOutput: string): ListeningProcessInfo[] {
  return rawOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(
        /^([^\s]+)\s+(\d+)\s+.*TCP .*:(\d+) \(LISTEN\)$/,
      );

      if (!match) {
        return null;
      }

      const [, command, processIdRaw, portRaw] = match;
      const processId = Number.parseInt(processIdRaw, 10);
      const port = Number.parseInt(portRaw, 10);

      if (!Number.isInteger(processId) || processId <= 0) {
        return null;
      }

      if (!Number.isInteger(port) || port <= 0) {
        return null;
      }

      return {
        command,
        pid: processId,
        port,
      } satisfies ListeningProcessInfo;
    })
    .filter((item): item is ListeningProcessInfo => item !== null)
    .filter((item) => item.pid !== process.pid);
}

function findListeningProcesses(): ListeningProcessInfo[] {
  if (process.platform === 'win32') {
    return [];
  }

  const result = childProcess.spawnSync(
    'lsof',
    ['-nP', '-iTCP', '-sTCP:LISTEN'],
    {
      encoding: 'utf8',
    },
  );

  if (result.error) {
    return [];
  }

  return parseListeningProcesses(String(result.stdout ?? ''));
}

function findNodeProcessIdsListeningOnPort(port: number): number[] {
  return findListeningProcesses()
    .filter((processInfo) => processInfo.command === 'node')
    .filter((processInfo) => processInfo.port === port)
    .map((processInfo) => processInfo.pid);
}

async function waitForPortToBeReleased(
  port: number,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (findNodeProcessIdsListeningOnPort(port).length === 0) {
      return true;
    }

    await delay(pollIntervalMs);
  }

  return findNodeProcessIdsListeningOnPort(port).length === 0;
}

function forceStopProcessIds(
  processIds: number[],
  signal: NodeJS.Signals,
): void {
  for (const processId of processIds) {
    try {
      process.kill(processId, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.warn(
        `[bootstrap] 发送 ${signal} 给进程 ${processId} 失败: ${message}`,
      );
    }
  }
}

async function terminateProcessesListeningOnPort(
  port: number,
): Promise<boolean> {
  const processIds = findNodeProcessIdsListeningOnPort(port);

  if (processIds.length === 0) {
    return false;
  }

  console.warn(
    `[bootstrap] 端口 ${port} 已被占用，尝试停止旧进程: ${processIds.join(', ')}`,
  );

  forceStopProcessIds(processIds, 'SIGTERM');

  if (await waitForPortToBeReleased(port, 1500, 150)) {
    console.warn(`[bootstrap] 端口 ${port} 的旧进程已停止，重新尝试监听`);
    return true;
  }

  console.warn(
    `[bootstrap] 端口 ${port} 的旧进程未及时退出，升级为 SIGKILL 强制停止`,
  );
  forceStopProcessIds(processIds, 'SIGKILL');

  if (await waitForPortToBeReleased(port, 1500, 150)) {
    console.warn(`[bootstrap] 端口 ${port} 的旧进程已强制停止，重新尝试监听`);
    return true;
  }

  console.warn(
    `[bootstrap] 端口 ${port} 的旧进程未在超时内退出，继续尝试其他端口策略`,
  );
  return false;
}

export async function terminateNodeProcessesInPortRange(
  startPort: number,
  endPort: number,
): Promise<number[]> {
  const targetProcesses = findListeningProcesses()
    .filter((processInfo) => processInfo.command === 'node')
    .filter((processInfo) => processInfo.port >= startPort)
    .filter((processInfo) => processInfo.port <= endPort);

  if (targetProcesses.length === 0) {
    return [];
  }

  const processIds = Array.from(
    new Set(targetProcesses.map((item) => item.pid)),
  );
  const descriptors = targetProcesses.map((item) => `${item.pid}@${item.port}`);

  console.warn(
    `[bootstrap] 启动前清理 ${startPort}-${endPort} 端口残留进程: ${descriptors.join(', ')}`,
  );

  forceStopProcessIds(processIds, 'SIGTERM');
  await delay(1200);

  const remainingProcesses = findListeningProcesses()
    .filter((processInfo) => processInfo.command === 'node')
    .filter((processInfo) => processInfo.port >= startPort)
    .filter((processInfo) => processInfo.port <= endPort);

  if (remainingProcesses.length > 0) {
    const remainingIds = Array.from(
      new Set(remainingProcesses.map((processInfo) => processInfo.pid)),
    );
    console.warn(
      `[bootstrap] ${startPort}-${endPort} 仍有残留端口，占用进程升级为 SIGKILL: ${remainingIds.join(', ')}`,
    );
    forceStopProcessIds(remainingIds, 'SIGKILL');
    await delay(1200);
  }

  const finalRemainingProcesses = findListeningProcesses()
    .filter((processInfo) => processInfo.command === 'node')
    .filter((processInfo) => processInfo.port >= startPort)
    .filter((processInfo) => processInfo.port <= endPort);

  if (finalRemainingProcesses.length > 0) {
    console.warn(
      `[bootstrap] 启动前仍有端口残留: ${finalRemainingProcesses
        .map((item) => `${item.pid}@${item.port}`)
        .join(', ')}`,
    );
  }

  return processIds;
}

export async function listenWithPortFallback(
  app: { listen(port: number, host: string): Promise<unknown> },
  preferredPort: number,
  host: string,
  autoTerminateEnabled: boolean,
  autoShiftEnabled: boolean,
  maxOffset: number,
): Promise<number> {
  const safeMaxOffset = Math.max(0, maxOffset);
  let offset = 0;

  while (offset <= safeMaxOffset) {
    const currentPort = preferredPort + offset;

    try {
      await app.listen(currentPort, host);
      return currentPort;
    } catch (error) {
      const isAddressInUse = isListenAddressInUseError(error);
      const terminatedExistingProcess =
        autoTerminateEnabled &&
        isAddressInUse &&
        (await terminateProcessesListeningOnPort(currentPort));

      if (terminatedExistingProcess) {
        continue;
      }

      const canRetry =
        autoShiftEnabled && isAddressInUse && offset < safeMaxOffset;

      if (!canRetry) {
        throw error;
      }

      console.warn(
        `[bootstrap] 端口 ${currentPort} 已被占用，自动尝试 ${currentPort + 1}`,
      );
      offset += 1;
    }
  }

  throw new Error('服务启动失败：未找到可用监听端口');
}
