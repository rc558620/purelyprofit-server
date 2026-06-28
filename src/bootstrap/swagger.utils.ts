interface SwaggerOperationLike {
  summary?: string;
  tags?: string[];
}

interface SwaggerTagLike {
  name: string;
  description?: string;
}

interface SwaggerPathItemLike {
  get?: SwaggerOperationLike;
  post?: SwaggerOperationLike;
}

export interface SwaggerDocumentLike {
  paths?: Record<string, SwaggerPathItemLike>;
  tags?: SwaggerTagLike[];
}

const CLUB_MANUAL_CONFIRM_PAID_FALLBACK_TAG = 'Dev Only / Fallback';
const CLUB_MANUAL_CONFIRM_PAID_SWAGGER_PATHS = [
  '/club/orders/{id}/confirm-paid',
  '/club/recharge/orders/{id}/confirm-paid',
] as const;

function ensureSwaggerTag(
  tags: SwaggerTagLike[] | undefined,
  targetTag: SwaggerTagLike,
): SwaggerTagLike[] {
  const normalizedTags = tags ? [...tags] : [];
  const exists = normalizedTags.some((tag) => tag.name === targetTag.name);
  if (!exists) {
    normalizedTags.push(targetTag);
  }
  return normalizedTags;
}

export function filterSwaggerDocumentForEnvironment(
  document: SwaggerDocumentLike,
  options: {
    manualConfirmPaidEnabled: boolean;
  },
): SwaggerDocumentLike {
  if (!document.paths) {
    return document;
  }

  if (!options.manualConfirmPaidEnabled) {
    for (const path of CLUB_MANUAL_CONFIRM_PAID_SWAGGER_PATHS) {
      delete document.paths[path];
    }
    return document;
  }

  document.tags = ensureSwaggerTag(document.tags, {
    name: CLUB_MANUAL_CONFIRM_PAID_FALLBACK_TAG,
    description: '仅开发联调使用的支付兜底接口，生产链路请改用支付回调驱动。',
  });

  for (const path of CLUB_MANUAL_CONFIRM_PAID_SWAGGER_PATHS) {
    const operation = document.paths[path]?.post;
    if (!operation) {
      continue;
    }

    operation.tags = Array.from(
      new Set([
        ...(operation.tags ?? []),
        CLUB_MANUAL_CONFIRM_PAID_FALLBACK_TAG,
      ]),
    );
  }

  return document;
}
