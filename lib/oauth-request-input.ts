import { isSafeRelativePath } from "./security.ts";

export const MAX_OAUTH_CONTEXT_VALUES = 12;

export class InvalidOAuthRequestInputError extends Error {
  constructor(message = "invalid OAuth request context") {
    super(message);
    this.name = "InvalidOAuthRequestInputError";
  }
}

export function singleSearchValue(
  params: URLSearchParams,
  key: string,
): string | null {
  const values = params.getAll(key);
  if (values.length > 1) throw new InvalidOAuthRequestInputError();
  return values[0] ?? null;
}

export function repeatedSearchValues(
  params: URLSearchParams,
  key: string,
): string[] {
  const values = params.getAll(key);
  if (
    values.length > MAX_OAUTH_CONTEXT_VALUES ||
    values.some((value) => value.length === 0)
  ) throw new InvalidOAuthRequestInputError();
  return values;
}

export function singleFormString(form: FormData, key: string): string | null {
  const values = form.getAll(key);
  if (values.length > 1) throw new InvalidOAuthRequestInputError();
  if (values.length === 0) return null;
  if (typeof values[0] !== "string") {
    throw new InvalidOAuthRequestInputError();
  }
  return values[0];
}

export function repeatedFormStrings(form: FormData, key: string): string[] {
  const values = form.getAll(key);
  if (
    values.length > MAX_OAUTH_CONTEXT_VALUES ||
    values.some((value) => typeof value !== "string" || value.length === 0)
  ) throw new InvalidOAuthRequestInputError();
  return values as string[];
}

export function plainJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidOAuthRequestInputError();
  }
  return value as Record<string, unknown>;
}

export function optionalJsonString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  if (!Object.hasOwn(record, key)) return null;
  const value = record[key];
  if (typeof value !== "string") throw new InvalidOAuthRequestInputError();
  return value;
}

export function optionalJsonStringList(
  record: Record<string, unknown>,
  key: string,
): string[] | null {
  if (!Object.hasOwn(record, key)) return null;
  const value = record[key];
  const values = typeof value === "string"
    ? [value]
    : Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value as string[]
    : null;
  if (
    !values || values.length === 0 ||
    values.length > MAX_OAUTH_CONTEXT_VALUES ||
    values.some((entry) => entry.length === 0)
  ) throw new InvalidOAuthRequestInputError();
  return values;
}

export function optionalEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | null {
  if (value === null) return null;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new InvalidOAuthRequestInputError();
  }
  return value as T;
}

export function optionalSafeRelativePath(value: string | null): string | null {
  if (value === null) return null;
  if (!isSafeRelativePath(value)) throw new InvalidOAuthRequestInputError();
  return value;
}

/** Authorization context must have one canonical source. */
export function rejectSearchFormOverlap(
  params: URLSearchParams,
  form: FormData,
  keys: readonly string[],
): void {
  if (keys.some((key) => params.has(key) && form.has(key))) {
    throw new InvalidOAuthRequestInputError();
  }
}

export function rejectSearchJsonOverlap(
  params: URLSearchParams,
  record: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (keys.some((key) => params.has(key) && Object.hasOwn(record, key))) {
    throw new InvalidOAuthRequestInputError();
  }
}
