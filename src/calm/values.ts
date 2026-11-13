import { CloudAlmError } from "./errors.js";

export type Row = Record<string, unknown>;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A GUID argument, checked before it goes into a path or an OData filter. */
export function guid(value: string, what: string): string {
  if (typeof value !== "string" || !GUID.test(value.trim()))
    throw new CloudAlmError("bad_request", `${what} must be a GUID`);
  return value.trim().toLowerCase();
}

export function str(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()))
    return Number(value);
  return null;
}

export function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function strings(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && !!item)
    .slice(0, max);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Rich text (Cloud ALM stores HTML in descriptions and documents) as plain
 * text: block tags become line breaks, other tags go, entities are decoded,
 * and the result is cut at `max` characters.
 */
export function plainText(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d|\/tr)\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X"))
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      return ENTITIES[code.toLowerCase()] ?? all;
    })
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.length > max
    ? `${text.slice(0, max - 1)}… [cut at ${max} characters]`
    : text;
}

/** The rows of a collection answer: a bare array or OData's `value`. */
export function rowsOf(body: unknown): Row[] {
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as Row).value)
      ? ((body as Row).value as unknown[])
      : null;
  if (!rows)
    throw new CloudAlmError("unavailable", "unexpected answer shape (no list)");
  return rows.filter(
    (row): row is Row =>
      !!row && typeof row === "object" && !Array.isArray(row),
  );
}

export function rowOf(body: unknown): Row {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new CloudAlmError(
      "unavailable",
      "unexpected answer shape (no object)",
    );
  return body as Row;
}

/** OData's `@count` (or `@odata.count`), when the answer has one. */
export function countOf(body: unknown): number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Row;
  return num(record["@count"] ?? record["@odata.count"]);
}
