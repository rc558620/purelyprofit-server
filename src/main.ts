// 固定进程时区为上海（UTC+8），避免容器/海外服务器默认 UTC 导致
// 所有基于 Date 本地方法（setHours/getFullYear 等）的业务日边界整体偏移 8 小时。
// 必须在任何模块产生 Date 之前执行，因此置于 import 之上。
process.env.TZ ??= 'Asia/Shanghai';

import { bootstrap } from './bootstrap/bootstrap';

export { bootstrap };
export { createRequestIdGenerator } from './bootstrap/request-id.utils';
export { filterSwaggerDocumentForEnvironment } from './bootstrap/swagger.utils';

if (require.main === module) {
  void bootstrap();
}
