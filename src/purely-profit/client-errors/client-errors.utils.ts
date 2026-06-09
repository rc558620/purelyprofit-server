export const truncateText = (
  value: string | undefined,
  maxLength: number,
): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return undefined;
  }

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}...<truncated>`;
};

export const maskPhone = (phone: string | undefined): string | undefined => {
  const normalizedPhone = phone?.trim();
  if (!normalizedPhone) {
    return undefined;
  }

  const digitsOnlyPhone = normalizedPhone.replace(/\D/g, '');
  if (digitsOnlyPhone.length < 7) {
    return truncateText(normalizedPhone, 40);
  }

  const prefix = digitsOnlyPhone.slice(0, 3);
  const suffix = digitsOnlyPhone.slice(-4);
  return `${prefix}****${suffix}`;
};

export const readStringDetail = (
  value: unknown,
  maxLength: number,
): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  return truncateText(value, maxLength) ?? null;
};

export const readNumberDetail = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
};

export const extractStackHead = (stack: string | undefined): string | null => {
  const stackHead = stack?.split('\n')[0];
  return truncateText(stackHead, 200) ?? null;
};

export const extractDetailsKeys = (
  details: Record<string, unknown> | undefined,
): string[] | null => {
  if (!details) {
    return null;
  }

  const keys = Object.keys(details)
    .map((key) => truncateText(key, 60))
    .filter((key): key is string => Boolean(key));

  return keys.length > 0 ? keys : null;
};

export const serializeDetails = (
  details: Record<string, unknown> | undefined,
  detailsMaxLength: number,
): string | undefined => {
  if (!details) {
    return undefined;
  }

  try {
    return truncateText(JSON.stringify(details), detailsMaxLength);
  } catch {
    return '[unserializable-details]';
  }
};
