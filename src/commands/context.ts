import type { Store } from '../data/store.js';
import { UsageError } from '../filters.js';
import type { Answer, Lang } from '../output.js';

export interface Context {
  store: Store;
  lang: Lang;
  args: string[];
  values: Record<string, string | boolean | undefined>;
}

export interface Command {
  name: string;
  summary: string;
  usage: string;
  options?: Record<string, { type: 'string' | 'boolean'; short?: string }>;
  run(ctx: Context): Promise<Answer>;
}

export function str(ctx: Context, key: string): string | undefined {
  const v = ctx.values[key];
  return typeof v === 'string' ? v : undefined;
}

export function limit(ctx: Context, fallback: number, max = 500): number {
  const raw = str(ctx, 'limite');
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--limite tiene que ser un número entero mayor que 0 (has puesto «${raw}»).`);
  return Math.min(n, max);
}
