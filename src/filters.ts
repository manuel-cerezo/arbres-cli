import type { MunicipalityId } from './data/format.js';
import { CATEGORIES, type LocationType, type Tree } from './data/store.js';
import { matchScore } from './data/text.js';

export class UsageError extends Error {}

export interface FilterInput {
  municipio?: string;
  barrio?: string;
  distrito?: string;
  especie?: string;
  tipo?: string;
  categoria?: string;
  'plantado-desde'?: string;
  'plantado-hasta'?: string;
  cerca?: string;
  radio?: string;
}

export interface Filter {
  test(tree: Tree): boolean;
  /** Lo que se ha entendido, para devolverlo en la respuesta. */
  description: Record<string, unknown>;
}

const MUNICIPALITIES: Record<string, MunicipalityId> = {
  bcn: 'bcn', barcelona: 'bcn', lh: 'lh', hospitalet: 'lh', lhospitalet: 'lh', "l'hospitalet": 'lh',
};

const TYPES: Record<string, LocationType> = {
  calle: 'calle', calles: 'calle', viari: 'calle', carrer: 'calle',
  parque: 'parque', parques: 'parque', parcs: 'parque', parc: 'parque',
  zona: 'zona verde', 'zona-verde': 'zona verde', zones: 'zona verde', plaza: 'zona verde', placa: 'zona verde',
};

const CATEGORY_ALIASES: Record<string, string> = {
  primera: 'PRIMERA', '1': 'PRIMERA', segona: 'SEGONA', segunda: 'SEGONA', '2': 'SEGONA',
  tercera: 'TERCERA', '3': 'TERCERA', exemplar: 'EXEMPLAR', ejemplar: 'EXEMPLAR', '4': 'EXEMPLAR',
};

export function parseMunicipality(value: string | undefined): MunicipalityId | null {
  if (!value || value === 'todos' || value === 'tots') return null;
  const m = MUNICIPALITIES[value.toLowerCase().replace(/\s+/g, '')];
  if (!m) throw new UsageError(`Municipio desconocido «${value}». Usa bcn, lh o todos.`);
  return m;
}

function parseDate(value: string, end: boolean): string {
  if (/^\d{4}$/.test(value)) return end ? `${value}-12-31` : `${value}-01-01`;
  if (/^\d{4}-\d{2}$/.test(value)) return end ? `${value}-31` : `${value}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  throw new UsageError(`Fecha no válida «${value}». Usa AAAA, AAAA-MM o AAAA-MM-DD.`);
}

export function parsePoint(value: string): { lat: number; lng: number } {
  const parts = value.split(/[,\s]+/).filter(Boolean).map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    throw new UsageError(`Coordenadas no válidas «${value}». Usa lat,lng, por ejemplo 41.403,2.174.`);
  }
  return { lat: parts[0], lng: parts[1] };
}

/** Distancia en metros (equirectangular: sobra para distancias de una ciudad). */
export function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

export function speciesNames(t: Tree): string[] {
  const s = t.especie;
  return [s.cientifico, ...(s.castellano?.split(/;| \/ /) ?? []), ...(s.catalan?.split(/;| \/ /) ?? [])]
    .map((x) => x?.trim())
    .filter((x): x is string => !!x);
}

/** Especies (por nombre científico) que mejor coinciden con lo buscado. */
export function resolveSpecies(trees: Tree[], query: string): string[] {
  const best = new Map<string, number>();
  for (const t of trees) {
    const key = t.especie.cientifico;
    if (!key || best.has(key)) continue;
    best.set(key, Math.max(0, ...speciesNames(t).map((n) => matchScore(query, n))));
  }
  const top = Math.max(0, ...best.values());
  if (top === 0) throw new UsageError(`No hay ninguna especie que coincida con «${query}». Prueba con el nombre científico, en castellano o en catalán.`);
  const chosen = new Set([...best].filter(([, s]) => s === top).map(([k]) => k));
  // Se añaden las variedades y sinónimos de la misma ficha.
  const groups = new Set(trees.filter((t) => t.especie.cientifico && chosen.has(t.especie.cientifico)).map((t) => t.especie.grupo));
  for (const t of trees) if (t.especie.cientifico && groups.has(t.especie.grupo)) chosen.add(t.especie.cientifico);
  return [...chosen].sort();
}

/** Barrio o distrito: debe quedar uno solo, o se pide precisar. */
export interface AreaRef { kind: 'barrio' | 'distrito'; code: number; name: string; municipio: MunicipalityId }

export function resolveArea(trees: Tree[], query: string, kind: 'barrio' | 'distrito', municipio: MunicipalityId | null, known: AreaRef[] = []): { code: number; name: string; municipio: MunicipalityId } {
  const seen = new Map<number, { name: string; municipio: MunicipalityId; score: number }>();
  for (const a of known) {
    if (a.kind !== kind || (municipio && a.municipio !== municipio)) continue;
    seen.set(a.code, { name: a.name, municipio: a.municipio, score: matchScore(query, a.name) });
  }
  for (const t of trees) {
    if (municipio && t.municipio !== municipio) continue;
    const code = kind === 'barrio' ? t.barrioCodigo : t.distritoCodigo;
    const name = kind === 'barrio' ? t.barrio : t.distrito;
    if (code == null || !name || seen.has(code)) continue;
    seen.set(code, { name, municipio: t.municipio, score: matchScore(query, name) });
  }
  const top = Math.max(0, ...[...seen.values()].map((v) => v.score));
  const hits = [...seen].filter(([, v]) => v.score === top && top > 0);
  if (!hits.length) throw new UsageError(`No encuentro ningún ${kind} que se llame «${query}».`);
  if (hits.length > 1 && top < 2) {
    throw new UsageError(
      `«${query}» puede ser más de un ${kind}: ${hits.map(([, v]) => v.name).sort().join(', ')}. Escribe el nombre completo.`,
    );
  }
  const [code, v] = hits[0];
  return { code, name: v.name, municipio: v.municipio };
}

export function buildFilter(trees: Tree[], input: FilterInput, known: AreaRef[] = []): Filter {
  const tests: ((t: Tree) => boolean)[] = [];
  const description: Record<string, unknown> = {};

  const municipio = parseMunicipality(input.municipio);
  if (municipio) {
    tests.push((t) => t.municipio === municipio);
    description.municipio = municipio;
  }
  if (input.distrito) {
    const area = resolveArea(trees, input.distrito, 'distrito', municipio, known);
    tests.push((t) => t.distritoCodigo === area.code);
    description.distrito = area.name;
  }
  if (input.barrio) {
    const area = resolveArea(trees, input.barrio, 'barrio', municipio, known);
    tests.push((t) => t.barrioCodigo === area.code);
    description.barrio = area.name;
  }
  if (input.especie) {
    const set = new Set(resolveSpecies(trees, input.especie));
    tests.push((t) => !!t.especie.cientifico && set.has(t.especie.cientifico));
    description.especie = [...set];
  }
  if (input.tipo) {
    const tipo = TYPES[input.tipo.toLowerCase()];
    if (!tipo) throw new UsageError(`Tipo de espacio desconocido «${input.tipo}». Usa calle, parque o zona.`);
    tests.push((t) => t.tipoEspacio === tipo);
    description.tipo = tipo;
  }
  if (input.categoria) {
    const cat = CATEGORY_ALIASES[input.categoria.toLowerCase()];
    if (!cat) throw new UsageError(`Categoría desconocida «${input.categoria}». Usa primera, segona, tercera o exemplar.`);
    tests.push((t) => t.categoria === cat);
    description.categoria = `${cat} (${CATEGORIES[cat].texto})`;
  }
  const from = input['plantado-desde'] ? parseDate(input['plantado-desde'], false) : null;
  const to = input['plantado-hasta'] ? parseDate(input['plantado-hasta'], true) : null;
  if (from || to) {
    tests.push((t) => {
      const p = t.plantacion;
      if (!p || p.dudosa) return false;
      // Con solo el año, se compara el año.
      const lo = p.precision === 'año' ? `${p.fecha}-12-31` : p.fecha;
      const hi = p.precision === 'año' ? `${p.fecha}-01-01` : p.fecha;
      return (!from || lo >= from) && (!to || hi <= to);
    });
    description.plantado = { desde: from, hasta: to };
  }
  if (input.cerca) {
    const point = parsePoint(input.cerca);
    const radius = input.radio ? Number(input.radio) : 200;
    if (!Number.isFinite(radius) || radius <= 0 || radius > 5000) throw new UsageError('El radio va en metros, entre 1 y 5000.');
    tests.push((t) => distance(point, t) <= radius);
    description.cerca = { ...point, radio_m: radius };
  }
  return { test: (t) => tests.every((fn) => fn(t)), description };
}

export const FILTER_OPTIONS = {
  municipio: { type: 'string' },
  barrio: { type: 'string' },
  distrito: { type: 'string' },
  especie: { type: 'string' },
  tipo: { type: 'string' },
  categoria: { type: 'string' },
  'plantado-desde': { type: 'string' },
  'plantado-hasta': { type: 'string' },
  cerca: { type: 'string' },
  radio: { type: 'string' },
} as const;
