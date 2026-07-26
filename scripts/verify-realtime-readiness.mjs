const baseUrl = (process.env.SMOKE_BASE_URL ?? 'http://localhost:3000/api')
  .replace(/\/$/, '');

const requiredDependencies = new Set(['database', 'redis', 'realtime']);

const response = await fetch(`${baseUrl}/readyz`);
if (!response.ok) {
  throw new Error(`就绪检查 HTTP 状态异常: ${response.status}`);
}

const payload = await response.json();
if (payload.status !== 'ok') {
  throw new Error(`服务未就绪: ${JSON.stringify(payload)}`);
}

const unavailable = payload.dependencies.filter(
  (dependency) =>
    requiredDependencies.has(dependency.name) && dependency.status !== 'up',
);
if (unavailable.length > 0) {
  throw new Error(`关键依赖不可用: ${JSON.stringify(unavailable)}`);
}

console.log(
  `实时链路就绪：${payload.dependencies
    .map((dependency) => `${dependency.name}=${dependency.status}`)
    .join(', ')}`,
);
