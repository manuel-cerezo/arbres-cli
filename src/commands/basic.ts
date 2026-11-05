import type { MunicipalityId } from '../data/format.js';
import { CATEGORIES, MUNICIPALITY_NAME, areaUrl, type AreaEntry, type Tree } from '../data/store.js';
import { FILTER_OPTIONS, UsageError, buildFilter, distance, parseMunicipality, parsePoint, resolveSpecies } from '../filters.js';
import { firstName, fmt, speciesName, treeJson, treeLine, type Answer } from '../output.js';
import { scoreArea } from './areaMatch.js';
import { limit, str, type Command, type Context } from './context.js';

const LIMIT_OPTION = { limite: { type: 'string' } } as const;

function filterInput(ctx: Context) {
  return Object.fromEntries(Object.keys(FILTER_OPTIONS).map((k) => [k, str(ctx, k)]));
}

function municipiosOf(trees: Tree[]): MunicipalityId[] {
  const set = new Set(trees.map((t) => t.municipio));
  return (['bcn', 'lh'] as MunicipalityId[]).filter((m) => set.has(m));
}

function countBy<T>(items: T[], key: (item: T) => string | null): [string, number][] {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export const stats: Command = {
  name: 'stats',
  summary: 'Totales por municipio, tipo de espacio y distrito',
  usage: 'arbres stats [--municipio bcn|lh]',
  options: { municipio: { type: 'string' } },
  async run(ctx) {
    const meta = await ctx.store.meta();
    const areas = await ctx.store.areas();
    const only = parseMunicipality(str(ctx, 'municipio'));
    const municipios = (['bcn', 'lh'] as MunicipalityId[]).filter((m) => (!only || m === only) && areas[m]);
    const result = municipios.map((m) => {
      const a = areas[m]!;
      const datasets = Object.entries(meta.datasets)
        .filter(([id, d]) => (d.municipi ?? (id === 'lh' ? 'lh' : 'bcn')) === m)
        .map(([id, d]) => ({ fuente: id, arboles: d.count }));
      return {
        municipio: m,
        nombre: MUNICIPALITY_NAME[m],
        arboles: a.city.trees,
        habitantes: a.city.population,
        arboles_por_habitante: a.city.per_inhabitant,
        arboles_por_km2: a.city.per_km2,
        por_fuente: datasets,
        distritos: a.districts.map((d) => ({ nombre: d.name, arboles: d.trees, especies: d.species_count })).sort((x, y) => y.arboles - x.arboles),
      };
    });
    const text = result
      .map((r) =>
        [
          `${r.nombre}: ${fmt(r.arboles)} árboles (${fmt(r.arboles_por_km2)} por km², ${fmt(r.arboles_por_habitante, 3)} por habitante)`,
          `  Por fuente: ${r.por_fuente.map((d) => `${d.fuente} ${fmt(d.arboles)}`).join(' · ')}`,
          ...r.distritos.map((d) => `  ${d.nombre}: ${fmt(d.arboles)} árboles, ${d.especies} especies`),
        ].join('\n'),
      )
      .join('\n\n');
    return { consulta: 'stats', resultado: result, texto: text, municipios };
  },
};

export const arbol: Command = {
  name: 'arbol',
  summary: 'Ficha de un árbol por su código',
  usage: 'arbres arbol <codigo>   (p. ej. 0091136AR o lh:420697)',
  async run(ctx) {
    const code = ctx.args[0]?.trim();
    if (!code) throw new UsageError('Falta el código del árbol. Ejemplo: arbres arbol 0091136AR');
    const trees = await ctx.store.trees();
    const lower = code.toLowerCase();
    const tree =
      trees.find((t) => t.ref.toLowerCase() === lower) ?? trees.find((t) => t.codigo.toLowerCase() === lower.replace(/^[a-z]+:/, ''));
    if (!tree) throw new UsageError(`No hay ningún árbol con el código «${code}» en los datos actuales. Puede que se haya retirado.`);
    const card = await ctx.store.cardFor(tree.especie.cientifico);
    const sameSpecies = trees.filter((t) => t.especie.grupo && t.especie.grupo === tree.especie.grupo);
    const inHood = sameSpecies.filter((t) => t.barrioCodigo === tree.barrioCodigo).length;
    const result = treeJson(tree, ctx.lang, {
      ejemplares_de_la_especie: { total: sameSpecies.length, en_el_barrio: inHood },
      especie_ficha: card ? speciesTraits(card, ctx.lang) : null,
    });
    const lines = [
      treeLine(tree, ctx.lang),
      tree.categoria ? `Categoría: ${tree.categoria} (${CATEGORIES[tree.categoria]?.texto ?? '—'})` : null,
      `Hay ${fmt(sameSpecies.length)} ejemplares de la especie en los datos, ${fmt(inHood)} en el barrio.`,
      card?.traits?.flowering?.length ? `Florece: ${monthsText(card.traits.flowering)}` : null,
    ].filter(Boolean);
    return { consulta: `arbol ${code}`, resultado: result, texto: lines.join('\n'), municipios: [tree.municipio] };
  },
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function monthsText(months: number[]): string {
  return months.map((m) => MONTHS[m - 1]).join(', ');
}

const LEAF: Record<string, string> = { deciduous: 'caduca', evergreen: 'perenne', 'semi-evergreen': 'semiperenne' };
const POLLEN = ['nula', 'baja', 'moderada', 'alta', 'muy alta'];

export function speciesTraits(card: import('../data/store.js').SpeciesCard, lang: 'es' | 'ca') {
  const t = card.traits ?? {};
  const text = card.texts?.[lang] ?? card.texts?.es;
  return {
    familia: card.family ?? null,
    hoja: t.leaf ? (LEAF[t.leaf] ?? t.leaf) : null,
    floracion_meses: t.flowering ?? null,
    color_flor: t.flowerColor?.[lang] ?? null,
    origen: t.origin?.region?.[lang] ?? null,
    mediterranea: t.origin?.mediterranean ?? null,
    alergenicidad_polen: t.pollen != null ? { escala_0_4: t.pollen, texto: POLLEN[t.pollen] ?? null } : null,
    descripcion: text ? { texto: text.content, fuente: text.source, url: text.sourceUrl, licencia: text.license } : null,
  };
}

export const especie: Command = {
  name: 'especie',
  summary: 'Cuántos hay de una especie, dónde y sus rasgos',
  usage: 'arbres especie <nombre> [filtros]',
  options: { ...FILTER_OPTIONS },
  async run(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) throw new UsageError('Falta la especie. Ejemplo: arbres especie jacaranda');
    const trees = await ctx.store.trees();
    const names = resolveSpecies(trees, query);
    const filter = buildFilter(trees, { ...filterInput(ctx), especie: undefined }, await ctx.store.areaRefs());
    const set = new Set(names);
    const all = trees.filter((t) => t.especie.cientifico && set.has(t.especie.cientifico));
    const hits = all.filter(filter.test);
    const species = names.map((ci) => {
      const own = hits.filter((t) => t.especie.cientifico === ci);
      return { cientifico: ci, comun: own[0] ? speciesName(own[0], ctx.lang) : ci, ejemplares: own.length };
    }).sort((a, b) => b.ejemplares - a.ejemplares);
    const cards = await Promise.all(names.slice(0, 5).map((n) => ctx.store.cardFor(n)));
    const dated = hits.filter((t) => t.plantacion && !t.plantacion.dudosa && t.plantacion.precision === 'dia');
    dated.sort((a, b) => a.plantacion!.fecha.localeCompare(b.plantacion!.fecha));
    const result = {
      especies: species,
      ejemplares: hits.length,
      por_municipio: countBy(hits, (t) => t.municipio).map(([k, v]) => ({ municipio: k, ejemplares: v })),
      barrios_con_mas: countBy(hits, (t) => t.barrio).slice(0, 10).map(([k, v]) => ({ barrio: k, ejemplares: v })),
      calles_con_mas: countBy(hits.filter((t) => t.direccion), (t) => t.direccion!.replace(/,\s*\d+\w*$/, '')).slice(0, 5).map(([k, v]) => ({ calle: k, ejemplares: v })),
      plantacion: dated.length
        ? { con_fecha: dated.length, primera: dated[0].plantacion!.fecha, ultima: dated.at(-1)!.plantacion!.fecha }
        : null,
      rasgos: cards.filter(Boolean).map((c) => ({ cientifico: c!.ci, ...speciesTraits(c!, ctx.lang), descripcion: undefined })),
    };
    const lines = [
      `${fmt(hits.length)} ejemplares${names.length > 1 ? ` de ${names.length} especies` : ''}.`,
      ...species.slice(0, 10).map((s) => `  ${s.comun}: ${fmt(s.ejemplares)}`),
      result.barrios_con_mas.length ? `Barrios con más: ${result.barrios_con_mas.slice(0, 5).map((b) => `${b.barrio} (${fmt(b.ejemplares)})`).join(', ')}` : null,
      result.plantacion ? `Plantaciones con fecha: ${fmt(result.plantacion.con_fecha)}, de ${result.plantacion.primera} a ${result.plantacion.ultima}` : null,
      ...result.rasgos.slice(0, 1).map((r) =>
        [r.hoja ? `hoja ${r.hoja}` : null, r.floracion_meses?.length ? `florece en ${monthsText(r.floracion_meses)}` : null, r.origen ? `origen: ${r.origen}` : null]
          .filter(Boolean)
          .join(' · '),
      ),
    ].filter(Boolean);
    return { consulta: `especie ${query}`, filtros: filter.description, resultado: result, texto: lines.join('\n'), municipios: municipiosOf(hits) };
  },
};

function areaCommand(kind: 'barrio' | 'distrito'): Command {
  return {
    name: kind,
    summary: kind === 'barrio' ? 'Resumen de un barrio' : 'Resumen de un distrito',
    usage: `arbres ${kind} <nombre> [--municipio bcn|lh]`,
    options: { municipio: { type: 'string' } },
    async run(ctx) {
      const query = ctx.args.join(' ').trim();
      if (!query) throw new UsageError(`Falta el nombre del ${kind}. Ejemplo: arbres ${kind} ${kind === 'barrio' ? '"el Raval"' : 'Eixample'}`);
      const areas = await ctx.store.areas();
      const only = parseMunicipality(str(ctx, 'municipio'));
      const found = scoreArea(areas, query, kind, only);
      const { entry, municipio } = found;
      const a = areas[municipio]!;
      const parent = kind === 'barrio' ? a.districts.find((d) => d.code === entry.district) : null;
      const list = kind === 'barrio' ? a.neighborhoods : a.districts;
      const rank = (key: keyof AreaEntry) =>
        [...list].filter((x) => typeof x[key] === 'number').sort((x, y) => (y[key] as number) - (x[key] as number)).findIndex((x) => x.code === entry.code) + 1;
      const result = {
        nombre: entry.name,
        municipio,
        distrito: parent?.name ?? null,
        arboles: entry.trees,
        habitantes: entry.population,
        superficie_ha: entry.area_ha,
        arboles_por_habitante: entry.per_inhabitant,
        arboles_por_km2: entry.per_km2,
        media_municipio: { arboles_por_habitante: a.city.per_inhabitant, arboles_por_km2: a.city.per_km2 },
        posicion: { por_arboles: rank('trees'), por_habitante: rank('per_inhabitant'), por_km2: rank('per_km2'), de: list.length },
        especies_distintas: entry.species_count,
        especies_mas_comunes: entry.top_species.slice(0, 5).map((s) => ({ cientifico: s.nom_cientific, comun: firstName(ctx.lang === 'ca' ? s.nom_catala : s.nom_castella), ejemplares: s.count })),
        cambio_desde_primer_trimestre: entry.history ?? null,
        url: areaUrl(municipio, kind, entry.slug),
      };
      const lines = [
        `${entry.name}${parent ? ` (${parent.name})` : ''}: ${fmt(entry.trees)} árboles, ${fmt(entry.species_count)} especies.`,
        `${fmt(entry.per_km2)} por km² y ${fmt(entry.per_inhabitant, 3)} por habitante (media: ${fmt(a.city.per_km2)} y ${fmt(a.city.per_inhabitant, 3)}).`,
        `Puesto ${result.posicion.por_arboles} de ${list.length} por número de árboles, ${result.posicion.por_habitante} por habitante.`,
        `Más comunes: ${result.especies_mas_comunes.map((s) => `${s.comun ?? s.cientifico} (${fmt(s.ejemplares)})`).join(', ')}`,
        result.url,
      ];
      return { consulta: `${kind} ${query}`, resultado: result, texto: lines.join('\n'), municipios: [municipio] };
    },
  };
}

export const barrio = areaCommand('barrio');
export const distrito = areaCommand('distrito');

const ORDERS = ['plantacion', '-plantacion', 'especie', 'barrio'] as const;

function sortTrees(trees: Tree[], order: string | undefined): Tree[] {
  if (!order) return trees;
  if (!(ORDERS as readonly string[]).includes(order)) throw new UsageError(`Orden desconocido «${order}». Usa ${ORDERS.join(', ')}.`);
  const date = (t: Tree) => (t.plantacion && !t.plantacion.dudosa ? t.plantacion.fecha : null);
  const sorted = [...trees];
  if (order === 'plantacion' || order === '-plantacion') {
    const dir = order === 'plantacion' ? 1 : -1;
    sorted.sort((a, b) => {
      const x = date(a), y = date(b);
      if (x === y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return x.localeCompare(y) * dir;
    });
  } else if (order === 'especie') {
    sorted.sort((a, b) => (a.especie.cientifico ?? '~').localeCompare(b.especie.cientifico ?? '~'));
  } else {
    sorted.sort((a, b) => (a.barrio ?? '~').localeCompare(b.barrio ?? '~'));
  }
  return sorted;
}

export const buscar: Command = {
  name: 'buscar',
  summary: 'Árboles que cumplen unos filtros',
  usage: 'arbres buscar [filtros] [--orden plantacion|-plantacion|especie|barrio] [--limite N]',
  options: { ...FILTER_OPTIONS, ...LIMIT_OPTION, orden: { type: 'string' } },
  async run(ctx) {
    const trees = await ctx.store.trees();
    const filter = buildFilter(trees, filterInput(ctx), await ctx.store.areaRefs());
    if (!Object.keys(filter.description).length) throw new UsageError('Pon al menos un filtro, por ejemplo --especie jacaranda o --barrio "el Raval".');
    const hits = sortTrees(trees.filter(filter.test), str(ctx, 'orden'));
    const n = limit(ctx, 20);
    const shown = hits.slice(0, n);
    const result = {
      total: hits.length,
      mostrados: shown.length,
      especies: countBy(hits, (t) => t.especie.grupo).slice(0, 10).map(([k, v]) => ({ cientifico: k, ejemplares: v })),
      arboles: shown.map((t) => treeJson(t, ctx.lang)),
    };
    const text = [`${fmt(hits.length)} árboles${hits.length > n ? `; muestro ${n}` : ''}.`, ...shown.map((t) => `  ${treeLine(t, ctx.lang)}`)].join('\n');
    return { consulta: 'buscar', filtros: filter.description, resultado: result, texto: text, municipios: municipiosOf(hits) };
  },
};

export const cerca: Command = {
  name: 'cerca',
  summary: 'Árboles cerca de un punto, del más cercano al más lejano',
  usage: 'arbres cerca <lat,lng> [--radio metros] [filtros] [--limite N]',
  options: { ...FILTER_OPTIONS, ...LIMIT_OPTION },
  async run(ctx) {
    const raw = ctx.args.join(',');
    if (!raw) throw new UsageError('Faltan las coordenadas. Ejemplo: arbres cerca 41.4036,2.1744 --radio 150');
    const point = parsePoint(raw);
    const trees = await ctx.store.trees();
    const filter = buildFilter(trees, { ...filterInput(ctx), cerca: `${point.lat},${point.lng}` }, await ctx.store.areaRefs());
    const hits = trees.filter(filter.test).map((t) => ({ t, d: distance(point, t) })).sort((a, b) => a.d - b.d);
    const n = limit(ctx, 20);
    const shown = hits.slice(0, n);
    const result = {
      total: hits.length,
      especies: countBy(hits.map((h) => h.t), (t) => t.especie.grupo).slice(0, 10).map(([k, v]) => ({ cientifico: k, ejemplares: v })),
      arboles: shown.map(({ t, d }) => treeJson(t, ctx.lang, { distancia_m: Math.round(d) })),
    };
    const text = [`${fmt(hits.length)} árboles en ${(filter.description.cerca as { radio_m: number }).radio_m} m.`, ...shown.map(({ t, d }) => `  ${Math.round(d)} m · ${treeLine(t, ctx.lang)}`)].join('\n');
    return { consulta: `cerca ${raw}`, filtros: filter.description, resultado: result, texto: text, municipios: municipiosOf(hits.map((h) => h.t)) };
  },
};

export { countBy, filterInput, municipiosOf };
