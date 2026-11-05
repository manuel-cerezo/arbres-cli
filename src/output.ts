import type { DataMeta, MunicipalityId } from './data/format.js';
import { CATEGORIES, SITE, treeUrl, type Tree } from './data/store.js';

export type Lang = 'es' | 'ca';

export interface Answer {
  consulta: string;
  filtros?: Record<string, unknown>;
  resultado: unknown;
  notas?: string[];
  /** Texto para personas; si falta, se imprime el JSON. */
  texto?: string;
  /** Municipios de los que salen los datos, para citar sus fuentes. */
  municipios?: MunicipalityId[];
}

const SOURCES: Record<MunicipalityId, { nombre: string; licencia: string; licenciaUrl: string; url: string }> = {
  bcn: {
    nombre: 'Ajuntament de Barcelona, Open Data BCN (arbrat viari, parcs i zona)',
    licencia: 'CC BY 4.0',
    licenciaUrl: 'https://creativecommons.org/licenses/by/4.0/',
    url: 'https://opendata-ajuntament.barcelona.cat/data/ca/dataset/arbrat-viari',
  },
  lh: {
    nombre: "Ajuntament de L'Hospitalet de Llobregat, dades obertes (arbres)",
    licencia: 'CC BY-ND 4.0',
    licenciaUrl: 'https://creativecommons.org/licenses/by-nd/4.0/',
    url: 'https://dadesobertes.seu-e.cat/dataset/hospitaletdellobregat-arbres',
  },
};

export function envelope(answer: Answer, meta: DataMeta) {
  const municipios = answer.municipios?.length ? answer.municipios : (['bcn', 'lh'] as MunicipalityId[]);
  return {
    consulta: answer.consulta,
    ...(answer.filtros && Object.keys(answer.filtros).length ? { filtros: answer.filtros } : {}),
    resultado: answer.resultado,
    ...(answer.notas?.length ? { notas: answer.notas } : {}),
    datos: { version: meta.version, generado: meta.generated_at, web: SITE },
    fuentes: municipios.map((m) => SOURCES[m]),
  };
}

export function sourceLine(meta: DataMeta, municipios: MunicipalityId[] = ['bcn', 'lh']): string {
  if (!municipios.length) municipios = ['bcn', 'lh'];
  const names = municipios.map((m) => `${SOURCES[m].nombre.split(',')[0]} (${SOURCES[m].licencia})`).join(' · ');
  return `Datos del ${meta.version} · ${names} · ${SITE}`;
}

/** Primer nombre común: «Palo rosa; tipa blanca» → «Palo rosa», «Tilo / Tilo norteño» → «Tilo». */
export function firstName(value: string | null | undefined): string | null {
  return value?.split(/;| \/ /)[0]?.trim() || null;
}

export function speciesName(t: Pick<Tree, 'especie'>, lang: Lang): string {
  const common = firstName(lang === 'ca' ? t.especie.catalan : t.especie.castellano);
  const sci = t.especie.cientifico ?? 'especie sin informar';
  return common ? `${common} (${sci})` : sci;
}

/** Nombre para un grupo de árboles de la misma especie: el de un árbol de la especie base si lo hay. */
export function groupName(trees: Tree[], lang: Lang): string {
  const base = trees.find((t) => t.especie.cientifico === t.especie.grupo) ?? trees[0];
  const common = firstName(lang === 'ca' ? base.especie.catalan : base.especie.castellano);
  const sci = base.especie.grupo ?? base.especie.cientifico ?? 'especie sin informar';
  return common ? `${common} (${sci})` : sci;
}

export function plantingText(t: Tree): string | null {
  const p = t.plantacion;
  if (!p) return null;
  const date = p.precision === 'dia' ? p.fecha.split('-').reverse().join('/') : `año ${p.fecha}`;
  return p.dudosa ? `${date} (fecha dudosa)` : date;
}

export function placeText(t: Tree): string {
  const parts = [t.direccion ?? t.espacioVerde, t.barrio, t.municipio === 'lh' ? "L'Hospitalet" : null].filter(Boolean);
  return parts.join(', ') || 'ubicación sin informar';
}

/** Árbol en el JSON: lo que un agente necesita para contarlo o enlazarlo. */
export function treeJson(t: Tree, lang: Lang, extra: Record<string, unknown> = {}) {
  return {
    codigo: t.ref,
    especie: {
      cientifico: t.especie.cientifico,
      comun: firstName(lang === 'ca' ? t.especie.catalan : t.especie.castellano),
    },
    municipio: t.municipio,
    distrito: t.distrito,
    barrio: t.barrio,
    direccion: t.direccion,
    espacio_verde: t.espacioVerde,
    tipo_espacio: t.tipoEspacio,
    categoria: t.categoria ? { codigo: t.categoria, perimetro: CATEGORIES[t.categoria]?.texto ?? null } : null,
    plantacion: t.plantacion,
    lat: t.lat,
    lng: t.lng,
    url: treeUrl(t),
    ...extra,
  };
}

export function treeLine(t: Tree, lang: Lang): string {
  const planted = plantingText(t);
  return `${speciesName(t, lang)} · ${placeText(t)}${planted ? ` · plantado ${planted}` : ''} · ${treeUrl(t)}`;
}

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null) return '—';
  return n.toLocaleString('es-ES', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
