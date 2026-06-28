import { bootstrap } from './bootstrap/bootstrap';

export { bootstrap };
export { createRequestIdGenerator } from './bootstrap/request-id.utils';
export { filterSwaggerDocumentForEnvironment } from './bootstrap/swagger.utils';

if (require.main === module) {
  void bootstrap();
}
