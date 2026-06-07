export function trimOptionalString(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
