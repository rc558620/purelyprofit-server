import fs from 'fs';
import path from 'path';

/**
 * f0rest 2026.05 后端规范校验器
 * 目标：通过静态扫描拦截不合规的 NestJS / Prisma / Redis 写法。
 */

const cliArgs = process.argv.slice(2);
const enforceLength = cliArgs.includes('--enforce-length');
const targetFile = cliArgs.find(arg => !arg.startsWith('-') && fs.existsSync(arg));

if (!targetFile) {
  console.error('❌ 请指定要检查的文件路径');
  process.exit(1);
}

const normalizedFile = path.resolve(targetFile);
const fileName = path.basename(normalizedFile);
const extension = path.extname(normalizedFile);
const isCodeFile = ['.ts', '.js', '.mjs', '.cjs'].includes(extension);
const content = fs.readFileSync(normalizedFile, 'utf-8');
const lines = content.split('\n');
const errors = [];
const warnings = [];

const isControllerFile = normalizedFile.endsWith('.controller.ts');
const isDtoFile = normalizedFile.endsWith('.dto.ts');
const isConfigurationFile = normalizedFile.endsWith('src/config/configuration.ts');
const isPrismaConfigFile = normalizedFile.endsWith('prisma.config.ts');
const isRedisServiceFile = normalizedFile.endsWith('src/redis/redis.service.ts');
const isRuleScriptFile = normalizedFile.endsWith('scripts/check-f0rest-rules.mjs');

// 1. 检查文件长度 (Rule 10)
if (lines.length > 400) {
  const msg = `[Rule 10] 文件行数为 ${lines.length}，超过了 400 行。`;
  if (enforceLength) {
    errors.push(`${msg} (当前重构模式：强制执行)`);
  } else {
    warnings.push(`${msg} (当前普通模式：仅作提醒)`);
  }
}

// 2. 检查异步风格 (Rule 7)
if (
  isCodeFile &&
  !isRuleScriptFile &&
  (/\.then\s*\(/.test(content) || /\.catch\s*\(/.test(content))
) {
  errors.push('[Rule 7] 后端异步逻辑统一使用 async/await，禁止新增 .then().catch() 链式调用。');
}

// 3. 检查环境变量读取边界 (Rule 6)
if (
  isCodeFile &&
  !isRuleScriptFile &&
  content.includes('process.env') &&
  !isConfigurationFile &&
  !isPrismaConfigFile
) {
  errors.push('[Rule 6] 业务代码禁止直接读取 process.env。请统一在 configuration.ts 中映射后通过 ConfigService 获取。');
}

// 4. Controller 分层检查 (Rule 4)
if (isControllerFile) {
  if (content.includes('PrismaService')) {
    errors.push('[Rule 4] controller 禁止直接依赖 PrismaService。请将数据库访问下沉到 service。');
  }

  if (content.includes('RedisService')) {
    errors.push('[Rule 4] controller 禁止直接依赖 RedisService。请将缓存读写下沉到 service。');
  }

  if (/bcrypt|hash\(|compare\(/.test(content)) {
    errors.push('[Rule 4] controller 禁止处理密码哈希或密码比对。请下沉到 service。');
  }

  if (!content.includes('@ApiTags(')) {
    errors.push('[Rule 5] controller 必须补充 @ApiTags 注解。');
  }

  const hasRouteDecorator = /@(Get|Post|Put|Patch|Delete)\(/.test(content);
  if (hasRouteDecorator && !content.includes('@ApiOperation(')) {
    errors.push('[Rule 5] controller 存在路由方法时，必须至少补充 @ApiOperation 注解。');
  }

  if (content.includes('JwtAuthGuard') && !content.includes('@ApiBearerAuth(')) {
    errors.push('[Rule 5] 使用 JwtAuthGuard 的 controller 需要补充 @ApiBearerAuth 注解。');
  }
}

// 5. DTO 校验检查 (Rule 5)
if (isDtoFile) {
  const hasValidatorImport = /from ['"]class-validator['"]/.test(content);
  const hasValidatorDecorator = /@(Is|Validate|Matches|Min|Max|Length|Array|IsOptional|IsEnum)/.test(content);
  const hasSwaggerProperty = /@ApiProperty|@ApiPropertyOptional/.test(content);

  if (!hasValidatorImport || !hasValidatorDecorator) {
    errors.push('[Rule 5] DTO 必须使用 class-validator 定义字段校验规则。');
  }

  if (!hasSwaggerProperty) {
    errors.push('[Rule 5] DTO 必须补充 @ApiProperty 或 @ApiPropertyOptional 注解。');
  }
}

// 6. Redis 客户端创建边界 (Rule 8)
if (
  isCodeFile &&
  !isRuleScriptFile &&
  !isRedisServiceFile &&
  /new\s+Redis\s*\(/.test(content)
) {
  errors.push('[Rule 8] 禁止在业务文件里直接 new Redis()。请统一复用 RedisService。');
}

if (warnings.length > 0) {
  console.warn(`⚠️ 在 ${fileName} 中有 ${warnings.length} 条建议：`);
  warnings.forEach(warn => console.warn(`   - ${warn}`));
}

if (errors.length > 0) {
  console.error(`\n❌ 在 ${fileName} 中发现 ${errors.length} 处违规：`);
  errors.forEach(err => console.error(`   - ${err}`));
  process.exit(1);
} else {
  console.log(`\n✅ ${fileName} 合规。`);
  process.exit(0);
}
