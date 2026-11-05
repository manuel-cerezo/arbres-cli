import type { MunicipalityId } from '../data/format.js';
import { CATEGORIES, areaUrl, type AreaEntry, type Tree } from '../data/store.js';
import { FILTER_OPTIONS, UsageError, buildFilter, parseMunicipality, resolveArea } from '../filters.js';
import { fmt, groupName, treeJson, treeLine, type Answer } from '../output.js';
import { countBy, filterInput, monthsText, municipiosOf } from './basic.js';
import { limit, str, type Command, type Context } from './context.js';

interface RecordDef {
  id: string;
  summary: string;
  extra?: string;
  run(ctx: Context): Promise<Answer>;
}

async function scope(ctx: Context) {
  const trees = await ctx.store.trees();
  const filter = buildFilter(trees, filterInput(ctx), await ctx.store.areaRefs());
  return { trees: trees.filter(filter.test), filter };
}

const exactDate = (t: Tree) => !!t.plantacion && !t.plantacion.dudosa && t.plantacion.precision === 'dia';

function plantingRecord(id: string, newest: boolean): RecordDef {
  return {
    id,
    summary: newest ? 'Los árboles plantados más recientemente' : 'Los árboles con la plantación más antigua registrada',
    async run(ctx) {
      const { trees, filter } = await scope(ctx);
      const dated = trees.filter(exactDate);
      if (!dated.length) throw new UsageError('Ningún árbol de esta selección tiene fecha de plantación.');
      const best = dated.reduce((acc, t) => {
        const f = t.plantacion!.fecha;
        return newest ? (f > acc ? f : acc) : f < acc ? f : acc;
      }, dated[0].plantacion!.fecha);
      const winners = dated.filter((t) => t.plantacion!.fecha === best);
      const n = limit(ctx, 20);
      const doubtful = trees.filter((t) => t.plantacion?.dudosa).length;
      const notas = [
        `Solo ${fmt(dated.length)} de ${fmt(trees.length)} árboles (${fmt((100 * dated.length) / Math.max(1, trees.length), 1)} %) tienen fecha de plantación exacta; el resto no cuenta.`,
        'Es la fecha de plantación en el inventario, no la edad del árbol.',
      ];
      if (!newest) notas.push('Los árboles más viejos no tienen fecha en el inventario: esto es la plantación registrada más antigua, no el árbol más viejo.');
      if (doubtful) notas.push(`Se descartan ${fmt(doubtful)} fechas dudosas: anteriores a 1900, futuras o marcadas como sospechosas por la fuente.`);
      if (winners.length > 1) notas.push(`Hay ${winners.length} árboles empatados con la misma fecha.`);
      const result = {
        fecha: best,
        empatados: winners.length,
        arboles: winners.slice(0, n).map((t) => treeJson(t, ctx.lang)),
        con_fecha: dated.length,
        total_seleccion: trees.length,
      };
      const text = [
        `${newest ? 'Plantación más reciente' : 'Plantación más antigua'}: ${best.split('-').reverse().join('/')}${winners.length > 1 ? ` (${winners.length} árboles empatados)` : ''}`,
        ...winners.slice(0, n).map((t) => `  ${treeLine(t, ctx.lang)}`),
      ].join('\n');
      return { consulta: `record ${id}`, filtros: filter.description, resultado: result, notas, texto: text, municipios: municipiosOf(winners) };
    },
  };
}

/** Árboles por especie (agrupando variedades). Los de especie sin identificar
 *  («Tilia sp.», «Indeterminat Arbre») no cuentan como especie. */
function speciesCount(trees: Tree[]) {
  const map = new Map<string, Tree[]>();
  for (const t of trees) {
    const k = t.especie.grupo;
    if (!k || !t.especie.identificada) continue;
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(t);
  }
  return map;
}


const UNIDENTIFIED_NOTE = (trees: Tree[]) => {
  const n = trees.filter((t) => !t.especie.identificada).length;
  return n ? [`No cuentan ${fmt(n)} árboles sin especie identificada (p. ej. «Tilia sp.», solo con el género).`] : [];
};

function areaRanking(kind: 'barrio' | 'distrito', id: string, most: boolean): RecordDef {
  const label = kind === 'barrio' ? 'barrios' : 'distritos';
  return {
    id,
    summary: `Los ${label} con ${most ? 'más' : 'menos'} árboles (--por total|habitante|km2|especies)`,
    extra: '--por total|habitante|km2|especies',
    async run(ctx) {
      const by = str(ctx, 'por') ?? 'total';
      const keys: Record<string, keyof AreaEntry> = { total: 'trees', habitante: 'per_inhabitant', km2: 'per_km2', especies: 'species_count' };
      const key = keys[by];
      if (!key) throw new UsageError('--por admite total, habitante, km2 o especies.');
      // Estos récords salen de los resúmenes por zona, no del inventario: solo admiten municipio y, para barrios, distrito.
      const allowed = kind === 'barrio' ? ['municipio', 'distrito'] : ['municipio'];
      const ignored = Object.keys(FILTER_OPTIONS).filter((k) => !allowed.includes(k) && str(ctx, k) != null);
      if (ignored.length) throw new UsageError(`${id} no admite ${ignored.map((k) => `--${k}`).join(', ')}: solo ${allowed.map((k) => `--${k}`).join(' y ')}.`);
      const areas = await ctx.store.areas();
      const only = parseMunicipality(str(ctx, 'municipio'));
      const inDistrict = kind === 'barrio' && str(ctx, 'distrito') ? resolveArea([], str(ctx, 'distrito')!, 'distrito', only, await ctx.store.areaRefs()) : null;
      const rows: { entry: AreaEntry; municipio: MunicipalityId; district: string | null }[] = [];
      for (const m of ['bcn', 'lh'] as MunicipalityId[]) {
        const file = areas[m];
        if (!file || (only && m !== only)) continue;
        for (const e of kind === 'barrio' ? file.neighborhoods : file.districts) {
          if (typeof e[key] !== 'number') continue;
          if (inDistrict && (m !== inDistrict.municipio || e.district !== inDistrict.code)) continue;
          rows.push({ entry: e, municipio: m, district: kind === 'barrio' ? (file.districts.find((d) => d.code === e.district)?.name ?? null) : null });
        }
      }
      rows.sort((a, b) => ((b.entry[key] as number) - (a.entry[key] as number)) * (most ? 1 : -1));
      const n = limit(ctx, 10);
      const result = rows.slice(0, n).map((r, i) => ({
        puesto: i + 1,
        nombre: r.entry.name,
        municipio: r.municipio,
        distrito: r.district,
        arboles: r.entry.trees,
        arboles_por_habitante: r.entry.per_inhabitant,
        arboles_por_km2: r.entry.per_km2,
        especies_distintas: r.entry.species_count,
        url: areaUrl(r.municipio, kind, r.entry.slug),
      }));
      const unit: Record<string, (r: (typeof result)[number]) => string> = {
        total: (r) => `${fmt(r.arboles)} árboles`,
        habitante: (r) => `${fmt(r.arboles_por_habitante, 3)} árboles por habitante`,
        km2: (r) => `${fmt(r.arboles_por_km2)} árboles por km²`,
        especies: (r) => `${fmt(r.especies_distintas)} especies`,
      };
      const notas = only || inDistrict ? [] : ['Mezcla Barcelona y L\'Hospitalet; usa --municipio bcn o lh para separarlos.'];
      if (by === 'habitante') notas.push('Padrón municipal del año que cita cada fuente; los barrios con poca población (Montjuïc, parques) salen muy arriba.');
      const text = result.map((r) => `${r.puesto}. ${r.nombre}${r.distrito ? ` (${r.distrito})` : ''}: ${unit[by](r)}`).join('\n');
      const municipios: MunicipalityId[] = inDistrict ? [inDistrict.municipio] : only ? [only] : ['bcn', 'lh'];
      return {
        consulta: `record ${id}`,
        filtros: { por: by, ...(only ? { municipio: only } : {}), ...(inDistrict ? { distrito: inDistrict.name } : {}) },
        resultado: result,
        notas,
        texto: text,
        municipios,
      };
    },
  };
}

const RECORDS: RecordDef[] = [
  plantingRecord('mas-reciente', true),
  plantingRecord('mas-antiguo', false),
  {
    id: 'especie-mas-comun',
    summary: 'Las especies con más ejemplares',
    async run(ctx) {
      const { trees, filter } = await scope(ctx);
      const n = limit(ctx, 10);
      const ranked = [...speciesCount(trees)].sort((a, b) => b[1].length - a[1].length).slice(0, n);
      const result = ranked.map(([ci, list], i) => ({
        puesto: i + 1,
        cientifico: ci,
        comun: groupName(list, ctx.lang),
        ejemplares: list.length,
        porcentaje: Math.round((1000 * list.length) / Math.max(1, trees.length)) / 10,
      }));
      const text = result.map((r) => `${r.puesto}. ${r.comun}: ${fmt(r.ejemplares)} (${fmt(r.porcentaje, 1)} %)`).join('\n');
      return { consulta: 'record especie-mas-comun', filtros: filter.description, resultado: result, notas: UNIDENTIFIED_NOTE(trees), texto: text, municipios: municipiosOf(trees) };
    },
  },
  {
    id: 'especies-unicas',
    summary: 'Especies con un solo ejemplar en la selección',
    async run(ctx) {
      const { trees, filter } = await scope(ctx);
      const singles = [...speciesCount(trees)].filter(([, l]) => l.length === 1).map(([, l]) => l[0]);
      singles.sort((a, b) => (a.especie.cientifico ?? '').localeCompare(b.especie.cientifico ?? ''));
      const n = limit(ctx, 100);
      const result = { total: singles.length, arboles: singles.slice(0, n).map((t) => treeJson(t, ctx.lang)) };
      const text = [`${singles.length} especies con un único ejemplar.`, ...singles.slice(0, n).map((t) => `  ${treeLine(t, ctx.lang)}`)].join('\n');
      return { consulta: 'record especies-unicas', filtros: filter.description, resultado: result, notas: UNIDENTIFIED_NOTE(trees), texto: text, municipios: municipiosOf(singles) };
    },
  },
  {
    id: 'especies-raras',
    summary: 'Especies con menos de N ejemplares (--menos-de, 5 por defecto)',
    extra: '--menos-de N',
    async run(ctx) {
      const max = Number(str(ctx, 'menos-de') ?? 5);
      if (!Number.isInteger(max) || max < 2) throw new UsageError('--menos-de tiene que ser un número entero mayor que 1.');
      const { trees, filter } = await scope(ctx);
      const rare = [...speciesCount(trees)].filter(([, l]) => l.length < max).sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
      const n = limit(ctx, 100);
      const result = {
        total: rare.length,
        especies: rare.slice(0, n).map(([ci, l]) => ({ cientifico: ci, comun: groupName(l, ctx.lang), ejemplares: l.length, codigos: l.map((t) => t.ref) })),
      };
      const text = [`${rare.length} especies con menos de ${max} ejemplares.`, ...result.especies.map((s) => `  ${s.comun}: ${s.ejemplares}`)].join('\n');
      return { consulta: 'record especies-raras', filtros: { ...filter.description, menos_de: max }, resultado: result, notas: UNIDENTIFIED_NOTE(trees), texto: text, municipios: municipiosOf(trees) };
    },
  },
  {
    id: 'mas-gruesos',
    summary: 'Árboles de la categoría de tronco más grueso (más de 110 cm de perímetro)',
    async run(ctx) {
      const { trees, filter } = await scope(ctx);
      const big = trees.filter((t) => t.categoria === 'EXEMPLAR');
      const n = limit(ctx, 20);
      const result = {
        total: big.length,
        especies: countBy(big, (t) => t.especie.grupo).slice(0, 10).map(([k, v]) => ({ cientifico: k, ejemplares: v })),
        arboles: big.slice(0, n).map((t) => treeJson(t, ctx.lang)),
      };
      const notas = [
        `La categoría EXEMPLAR (${CATEGORIES.EXEMPLAR.texto}) es un rango, no una medida: no se puede saber cuál es el más grueso de todos.`,
        "L'Hospitalet no publica esta categoría.",
      ];
      const text = [
        `${fmt(big.length)} árboles con ${CATEGORIES.EXEMPLAR.texto}.`,
        `Especies: ${result.especies.slice(0, 5).map((s) => `${s.cientifico} (${fmt(s.ejemplares)})`).join(', ')}`,
        ...big.slice(0, n).map((t) => `  ${treeLine(t, ctx.lang)}`),
      ].join('\n');
      return { consulta: 'record mas-gruesos', filtros: filter.description, resultado: result, notas, texto: text, municipios: ['bcn'] };
    },
  },
  {
    id: 'mas-alto',
    summary: 'No disponible: los datos ya no traen la altura',
    async run() {
      throw new UsageError(
        'No se puede saber: Open Data BCN dejó de publicar la altura de los árboles y L\'Hospitalet no la publica. ' +
          'Lo más parecido es «arbres record mas-gruesos», que da los árboles con más de 110 cm de perímetro.',
      );
    },
  },
  {
    id: 'florece',
    summary: 'Especies que florecen en un mes y cuántos ejemplares hay (--mes 1-12, este mes por defecto)',
    extra: '--mes N',
    async run(ctx) {
      const month = Number(str(ctx, 'mes') ?? new Date().getMonth() + 1);
      if (!Number.isInteger(month) || month < 1 || month > 12) throw new UsageError('--mes va del 1 al 12.');
      const { trees, filter } = await scope(ctx);
      const rows: { cientifico: string; comun: string; ejemplares: number; meses: number[] }[] = [];
      for (const [ci, list] of speciesCount(trees)) {
        const card = await ctx.store.cardFor(ci);
        const months = card?.traits?.flowering;
        if (months?.includes(month)) rows.push({ cientifico: ci, comun: groupName(list, ctx.lang), ejemplares: list.length, meses: months });
      }
      rows.sort((a, b) => b.ejemplares - a.ejemplares);
      const n = limit(ctx, 20);
      const total = rows.reduce((s, r) => s + r.ejemplares, 0);
      const result = { mes: month, especies: rows.length, ejemplares: total, lista: rows.slice(0, n) };
      const notas = ['Floración según la ficha de cada especie; solo cuentan las especies con ficha. Un árbol concreto puede adelantarse o retrasarse.'];
      const text = [`En ${monthsText([month])} florecen ${rows.length} especies, ${fmt(total)} árboles.`, ...result.lista.map((r) => `  ${r.comun}: ${fmt(r.ejemplares)}`)].join('\n');
      return { consulta: 'record florece', filtros: { ...filter.description, mes: month }, resultado: result, notas, texto: text, municipios: municipiosOf(trees) };
    },
  },
  {
    id: 'alergenos',
    summary: 'Especies con polen de alergenicidad alta o muy alta y cuántos ejemplares hay',
    async run(ctx) {
      const { trees, filter } = await scope(ctx);
      const rows: { cientifico: string; comun: string; ejemplares: number; alergenicidad: number; floracion_meses: number[] | null }[] = [];
      for (const [ci, list] of speciesCount(trees)) {
        const card = await ctx.store.cardFor(ci);
        const p = card?.traits?.pollen;
        if (p != null && p >= 3) rows.push({ cientifico: ci, comun: groupName(list, ctx.lang), ejemplares: list.length, alergenicidad: p, floracion_meses: card?.traits?.flowering ?? null });
      }
      rows.sort((a, b) => b.ejemplares - a.ejemplares);
      const total = rows.reduce((s, r) => s + r.ejemplares, 0);
      const n = limit(ctx, 20);
      const result = { especies: rows.length, ejemplares: total, de: trees.length, lista: rows.slice(0, n) };
      const notas = ['Escala de 0 a 4 de Cariñanos y Marinangeli (2021); aquí se muestran 3 (alta) y 4 (muy alta). Es orientativo, no consejo médico.'];
      const text = [
        `${rows.length} especies con polen muy alergénico: ${fmt(total)} de ${fmt(trees.length)} árboles.`,
        ...result.lista.map((r) => `  ${r.comun}: ${fmt(r.ejemplares)} (nivel ${r.alergenicidad}${r.floracion_meses?.length ? `, florece en ${monthsText(r.floracion_meses)}` : ''})`),
      ].join('\n');
      return { consulta: 'record alergenos', filtros: filter.description, resultado: result, notas, texto: text, municipios: municipiosOf(trees) };
    },
  },
  areaRanking('barrio', 'barrio-mas-arbolado', true),
  areaRanking('barrio', 'barrio-menos-arbolado', false),
  areaRanking('distrito', 'distrito-mas-arbolado', true),
  areaRanking('distrito', 'distrito-menos-arbolado', false),
];

export const RECORD_IDS = RECORDS.map((r) => r.id);

export const record: Command = {
  name: 'record',
  summary: 'Preguntas ya resueltas: más reciente, más antiguo, especie más común, especies únicas…',
  usage: `arbres record <${RECORD_IDS.join('|')}> [filtros]`,
  options: { ...FILTER_OPTIONS, limite: { type: 'string' }, por: { type: 'string' }, mes: { type: 'string' }, 'menos-de': { type: 'string' } },
  async run(ctx) {
    const id = ctx.args[0];
    const def = RECORDS.find((r) => r.id === id);
    if (!def) {
      throw new UsageError(`${id ? `Récord desconocido «${id}». ` : ''}Récords disponibles:\n${RECORDS.map((r) => `  ${r.id.padEnd(24)}${r.summary}`).join('\n')}`);
    }
    return def.run({ ...ctx, args: ctx.args.slice(1) });
  },
};

export function recordHelp(): string {
  return RECORDS.map((r) => `  ${r.id.padEnd(24)}${r.summary}`).join('\n');
}
