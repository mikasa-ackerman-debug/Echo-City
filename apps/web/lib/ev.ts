/** Narrow, `any`-free accessors for engine event payloads (`data: Record<string, unknown>`). */

export type Rec = Record<string, unknown>;

export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const bool = (v: unknown): boolean => v === true;
export const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const strs = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string");
export const recs = (v: unknown): Rec[] => list(v).map(rec);
export const numMap = (v: unknown): Record<string, number | null> =>
  Object.fromEntries(Object.entries(rec(v)).map(([k, x]) => [k, num(x) ?? null]));
export const strMap = (v: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(rec(v)).flatMap(([k, x]) => (typeof x === "string" ? [[k, x]] : [])));
export const pos = (v: unknown): [number, number] | undefined => {
  const a = list(v);
  return a.length === 2 && typeof a[0] === "number" && typeof a[1] === "number" ? [a[0], a[1]] : undefined;
};
