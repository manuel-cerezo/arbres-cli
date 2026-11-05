import type { MunicipalityId } from '../data/format.js';
import type { AreaEntry, AreaFile } from '../data/store.js';
import { matchScore } from '../data/text.js';
import { UsageError } from '../filters.js';

/** Busca un barrio o distrito en los resúmenes por zona (areas*.json). */
export function scoreArea(
  areas: Record<MunicipalityId, AreaFile | null>,
  query: string,
  kind: 'barrio' | 'distrito',
  only: MunicipalityId | null,
): { entry: AreaEntry; municipio: MunicipalityId } {
  const all: { entry: AreaEntry; municipio: MunicipalityId; score: number }[] = [];
  for (const m of ['bcn', 'lh'] as MunicipalityId[]) {
    const file = areas[m];
    if (!file || (only && m !== only)) continue;
    for (const entry of kind === 'barrio' ? file.neighborhoods : file.districts) {
      all.push({ entry, municipio: m, score: Math.max(matchScore(query, entry.name), matchScore(query, entry.slug.replace(/-/g, ' '))) });
    }
  }
  const top = Math.max(0, ...all.map((a) => a.score));
  const hits = all.filter((a) => a.score === top && top > 0);
  if (!hits.length) throw new UsageError(`No encuentro ningún ${kind} que se llame «${query}».`);
  if (hits.length > 1 && top < 2) {
    throw new UsageError(`«${query}» puede ser más de un ${kind}: ${hits.map((h) => h.entry.name).sort().join(', ')}. Escribe el nombre completo.`);
  }
  return hits[0];
}
