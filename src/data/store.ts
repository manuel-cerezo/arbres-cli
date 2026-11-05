import { DATASET_IDS, pick, type DataMeta, type DatasetId, type MunicipalityId, type PackedDataset } from './format.js';
import { DataSource } from './source.js';
import { norm, titleCase } from './text.js';
import type { AreaRef } from '../filters.js';

export const SITE = 'https://arbres.barcelona';

export type LocationType = 'calle' | 'parque' | 'zona verde';

export const LOCATION_OF: Record<DatasetId, LocationType | null> = {
  viari: 'calle',
  parcs: 'parque',
  zona: 'zona verde',
  lh: null,
};

export const MUNICIPALITY_NAME: Record<MunicipalityId, string> = {
  bcn: 'Barcelona',
  lh: "L'Hospitalet de Llobregat",
};

/** Categorías del inventario de Barcelona: rango de perímetro del tronco. */
export const CATEGORIES: Record<string, { orden: number; texto: string }> = {
  PRIMERA: { orden: 1, texto: 'hasta 40 cm de perímetro' },
  SEGONA: { orden: 2, texto: '41–80 cm de perímetro' },
  TERCERA: { orden: 3, texto: '81–110 cm de perímetro' },
  EXEMPLAR: { orden: 4, texto: 'más de 110 cm de perímetro' },
};

export interface Species {
  cientifico: string | null;
  /** Especie de su ficha: agrupa variedades y sinónimos («Platanus hispanica» → «Platanus × acerifolia»). */
  grupo: string | null;
  castellano: string | null;
  catalan: string | null;
}

export interface Planting {
  fecha: string;
  /** «dia» si la fecha es exacta; «año» si solo se conoce el año. */
  precision: 'dia' | 'año';
  /** La fuente la marca como dudosa o es imposible (anterior a 1900 o futura). */
  dudosa: boolean;
}

export interface Tree {
  ref: string;
  codigo: string;
  municipio: MunicipalityId;
  fuente: DatasetId;
  tipoEspacio: LocationType | null;
  especie: Species;
  barrio: string | null;
  barrioCodigo: number | null;
  distrito: string | null;
  distritoCodigo: number | null;
  direccion: string | null;
  espacioVerde: string | null;
  categoria: string | null;
  plantacion: Planting | null;
  lat: number;
  lng: number;
}

export interface AreaFile {
  format: number;
  generated_at: string;
  sources: Record<string, unknown>;
  city: { trees: number; population: number | null; area_ha: number | null; per_inhabitant: number | null; per_km2: number | null };
  districts: AreaEntry[];
  neighborhoods: AreaEntry[];
}

export interface AreaEntry {
  code: number;
  slug: string;
  name: string;
  district?: number;
  trees: number;
  population: number | null;
  area_ha: number | null;
  per_inhabitant: number | null;
  per_km2: number | null;
  species_count: number;
  shannon: number;
  top_species: { nom_cientific: string; nom_castella: string | null; nom_catala: string | null; count: number }[];
  local_species?: number;
  history?: { start: number | null; end: number | null } | null;
}

export interface SpeciesCard {
  ci: string;
  names: string[];
  es: string | null;
  ca: string | null;
  family?: string | null;
  texts?: Record<string, { content: string; source: string; sourceUrl: string; license: string }>;
  traits?: {
    leaf?: string;
    flowering?: number[];
    flowerColor?: { es: string; ca: string };
    fruit?: string;
    origin?: { mediterranean?: boolean; region?: { es: string; ca: string } };
    pollen?: number;
  };
}

const HISTORIC_LIMIT = '1900-01-01';

function planting(raw: string | null, precision: string | null, today: string): Planting | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const fecha = raw.slice(0, 10);
  const year = precision === 'any' || precision === 'sospitosa';
  return {
    fecha: year ? fecha.slice(0, 4) : fecha,
    precision: year ? 'año' : 'dia',
    dudosa: precision === 'sospitosa' || fecha < HISTORIC_LIMIT || fecha > today,
  };
}

export function treeUrl(tree: Pick<Tree, 'ref'>): string {
  return `${SITE}/mapa?tree=${encodeURIComponent(tree.ref)}`;
}

export function areaUrl(municipio: MunicipalityId, kind: 'barrio' | 'distrito', slug: string): string {
  const base = municipio === 'lh' ? '/lhospitalet' : '';
  return `${SITE}${base}/${kind === 'barrio' ? 'barrios' : 'distritos'}/${slug}`;
}

/**
 * Todo lo que se carga para responder. Los ficheros se piden según hagan
 * falta: `stats` no baja el inventario, `arbol` sí.
 */
export class Store {
  readonly source: DataSource;
  private treesPromise: Promise<Tree[]> | null = null;
  private areasPromise: Promise<Record<MunicipalityId, AreaFile | null>> | null = null;
  private cardsPromise: Promise<SpeciesCard[]> | null = null;

  /** Todos los barrios y distritos conocidos, aunque no tengan árboles en el inventario. */
  async areaRefs(): Promise<AreaRef[]> {
    const areas = await this.areas();
    const out: AreaRef[] = [];
    for (const m of ['bcn', 'lh'] as MunicipalityId[]) {
      const file = areas[m];
      if (!file) continue;
      for (const d of file.districts) out.push({ kind: 'distrito', code: d.code, name: d.name, municipio: m });
      for (const n of file.neighborhoods) out.push({ kind: 'barrio', code: n.code, name: n.name, municipio: m });
    }
    return out;
  }

  constructor(source: DataSource) {
    this.source = source;
  }

  meta(): Promise<DataMeta> {
    return this.source.meta();
  }

  areas(): Promise<Record<MunicipalityId, AreaFile | null>> {
    this.areasPromise ??= Promise.all([
      this.source.json<AreaFile>('areas.json', { checkFormat: true }),
      this.source.json<AreaFile>('areas-lh.json', { checkFormat: true }).catch(() => null),
    ]).then(([bcn, lh]) => ({ bcn, lh }));
    return this.areasPromise;
  }

  speciesCards(): Promise<SpeciesCard[]> {
    this.cardsPromise ??= this.source.json<{ cards: SpeciesCard[] }>('species-cards.json').then((f) => f.cards ?? []);
    return this.cardsPromise;
  }

  /** Ficha de especie por nombre científico (incluye variedades y sinónimos). */
  async cardFor(cientifico: string | null): Promise<SpeciesCard | null> {
    if (!cientifico) return null;
    const cards = await this.speciesCards();
    const n = norm(cientifico);
    return cards.find((c) => norm(c.ci) === n || c.names?.some((x) => norm(x) === n)) ?? null;
  }

  trees(): Promise<Tree[]> {
    this.treesPromise ??= this.loadTrees();
    return this.treesPromise;
  }

  private async loadTrees(): Promise<Tree[]> {
    const meta = await this.meta();
    const areas = await this.areas();
    const today = new Date().toISOString().slice(0, 10);
    const cards = await this.speciesCards().catch(() => [] as SpeciesCard[]);
    const groupOf = new Map<string, string>();
    for (const card of cards) for (const name of [card.ci, ...(card.names ?? [])]) groupOf.set(norm(name), card.ci);
    const ids = DATASET_IDS.filter((id) => meta.datasets[id]);
    const files = await Promise.all(
      ids.map((id) => this.source.json<PackedDataset>(`trees-${id}.json.gz`, { checkFormat: true })),
    );
    const out: Tree[] = [];
    for (const file of files) {
      const municipio: MunicipalityId = file.municipi ?? (file.dataset === 'lh' ? 'lh' : 'bcn');
      const area = areas[municipio];
      const offset = municipio === 'lh' ? 1000 : 0;
      const hoodByCode = new Map(area?.neighborhoods.map((n) => [n.code, n]) ?? []);
      const hoodByName = new Map(area?.neighborhoods.map((n) => [norm(n.name), n]) ?? []);
      const distByCode = new Map(area?.districts.map((d) => [d.code, d]) ?? []);

      const species: Species[] = file.species.map((s) => ({
        cientifico: s.ci,
        grupo: s.ci ? (groupOf.get(norm(s.ci)) ?? s.ci) : null,
        castellano: s.es && s.es !== '-' ? s.es : null,
        catalan: s.ca && s.ca !== '-' ? s.ca : null,
      }));
      const empty: Species = { cientifico: null, grupo: null, castellano: null, catalan: null };
      const hoods = file.barris.map((b) => {
        const entry = (b.c != null ? hoodByCode.get(b.c + offset) : undefined) ?? hoodByName.get(norm(b.n));
        return { name: entry?.name ?? (b.n ? titleCase(b.n) : null), code: entry?.code ?? (b.c != null ? b.c + offset : null) };
      });
      const dists = file.districts.map((d) => {
        const code = d.c != null ? d.c + offset : null;
        const entry = code != null ? distByCode.get(code) : undefined;
        return { name: entry?.name ?? (d.n ? titleCase(d.n) : null), code };
      });
      const precisionCol = file.cols.ext?.precisio_plantacio;
      const precisionDict = file.extras?.precisio_plantacio ?? [];
      const c = file.cols;
      for (let i = 0; i < file.count; i++) {
        const hood = pick(hoods, c.barri[i]);
        const dist = pick(dists, c.dist[i]);
        const codigo = c.codi[i];
        out.push({
          ref: municipio === 'bcn' ? codigo : `${municipio}:${codigo}`,
          codigo,
          municipio,
          fuente: file.dataset,
          tipoEspacio: LOCATION_OF[file.dataset] ?? null,
          especie: pick(species, c.sp[i]) ?? empty,
          barrio: hood?.name ?? null,
          barrioCodigo: hood?.code ?? null,
          distrito: dist?.name ?? null,
          distritoCodigo: dist?.code ?? null,
          direccion: cleanAddress(c.adreca[i]),
          espacioVerde: pick(file.espais, c.espai[i]),
          categoria: pick(file.categories, c.cat[i]),
          plantacion: planting(c.plant[i], precisionCol ? pick(precisionDict, precisionCol[i]) : null, today),
          lat: c.lat[i],
          lng: c.lng[i],
        });
      }
    }
    return out;
  }
}

/** «C\ Doctor Pi i Molist, 117» → «C/ Doctor Pi i Molist, 117»; « , 5» → null. */
export function cleanAddress(value: string | null): string | null {
  if (!value) return null;
  const v = value.replace(/\\/g, '/').trim();
  if (!v || /^,?\s*\d*$/.test(v) || v.startsWith(',')) return null;
  return v.replace(/, 0$/, '');
}
