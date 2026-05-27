function readErrorField(error: unknown, key: string): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const value = (error as Record<string, unknown>)[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export function getCachePrewarmFailedSampleErrorMeta(error: unknown): {
  errorTag: string;
  failedReason: string;
} {
  if (typeof error === 'string') {
    const failedReason = error.trim();
    return {
      errorTag: 'ErrorString',
      failedReason:
        failedReason.length > 0 ? failedReason : 'Unknown error string',
    };
  }

  if (error instanceof Error) {
    return {
      errorTag: error.name.trim() || error.constructor.name || 'Error',
      failedReason: error.message.trim() || 'Unknown error message',
    };
  }

  const errorCode = readErrorField(error, 'code');
  const errorName = readErrorField(error, 'name');
  const errorMessage = readErrorField(error, 'message');

  if (errorCode || errorName || errorMessage) {
    return {
      errorTag: errorCode ?? errorName ?? 'UnknownError',
      failedReason: errorMessage ?? 'Unknown error payload',
    };
  }

  return {
    errorTag: Object.prototype.toString.call(error),
    failedReason: 'Unknown error payload',
  };
}
