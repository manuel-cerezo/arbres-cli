// Datos de prueba pequeños con el mismo formato que publica arbres.barcelona.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

interface T {
  codi: string; lat: number; lng: number; sp: number; cat: number; dist: number; barri: number;
  plant: string | null; adreca: string | null; prec?: number;
}

function pack(dataset: string, rows: T[], extra: Record<string, unknown>) {
  return {
    format: 1, dataset, version: '2026-11-03', count: rows.length,
    ...extra,
    alcades: [], espais: ['Parc de prova'],
    enums: { amplada_vorera: [], tipus_aigua: [], tipus_reg: [], tipus_superficie: [], tipus_suport: [], cobertura_escocell: [], mida_escocell: [] },
    cols: {
      codi: rows.map((r) => r.codi), lat: rows.map((r) => r.lat), lng: rows.map((r) => r.lng), sp: rows.map((r) => r.sp),
      cat: rows.map((r) => r.cat), alc: rows.map(() => -1), dist: rows.map((r) => r.dist), barri: rows.map((r) => r.barri),
      espai: rows.map(() => -1), plant: rows.map((r) => r.plant), adreca: rows.map((r) => r.adreca),
      det: { amplada_vorera: rows.map(() => -1), tipus_aigua: rows.map(() => -1), tipus_reg: rows.map(() => -1), tipus_superficie: rows.map(() => -1), tipus_suport: rows.map(() => -1), cobertura_escocell: rows.map(() => -1), mida_escocell: rows.map(() => -1) },
      ...(rows.some((r) => r.prec != null) ? { ext: { precisio_plantacio: rows.map((r) => r.prec ?? -1) } } : {}),
    },
  };
}

const area = (code: number, slug: string, name: string, trees: number, extra: Record<string, unknown> = {}) => ({
  code, slug, name, trees, population: 10000, area_ha: 100, per_inhabitant: trees / 10000, per_km2: trees, species_count: 3, shannon: 1,
  top_species: [{ nom_cientific: 'Platanus × acerifolia', nom_castella: 'Plátano', nom_catala: 'Plàtan', count: 2 }], history: { start: 1, end: trees }, ...extra,
});

export function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbres-test-'));
  const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value));
  const gz = (name: string, value: unknown) => writeFileSync(join(dir, name), gzipSync(JSON.stringify(value)));

  write('meta.json', {
    format: 1, version: '2026-11-03', generated_at: '2026-11-03T13:20:47.042Z',
    datasets: { viari: { count: 6, version: '2026-11-03' }, lh: { count: 3, version: '2026-11-03', municipi: 'lh' } },
  });

  gz('trees-viari.json.gz', pack('viari', [
    { codi: 'A1', lat: 41.4036, lng: 2.1744, sp: 0, cat: 0, dist: 0, barri: 0, plant: '2020-05-01', adreca: 'C\\ Mallorca, 401' },
    { codi: 'A2', lat: 41.4037, lng: 2.1745, sp: 0, cat: 3, dist: 0, barri: 0, plant: '2026-10-30', adreca: 'C\\ Mallorca, 403' },
    { codi: 'A3', lat: 41.4100, lng: 2.1800, sp: 1, cat: 1, dist: 0, barri: 1, plant: '2026-10-30', adreca: 'C\\ Provença, 1' },
    { codi: 'A4', lat: 41.4000, lng: 2.1600, sp: 2, cat: 2, dist: 1, barri: 2, plant: '0013-04-22', adreca: 'G.V. Corts Catalanes, 491' },
    { codi: 'A5', lat: 41.4001, lng: 2.1601, sp: 3, cat: 2, dist: 1, barri: 2, plant: null, adreca: ' , 5' },
    { codi: 'A6', lat: 41.4002, lng: 2.1602, sp: 0, cat: 2, dist: 1, barri: 2, plant: '2009-02-01', adreca: null },
  ], {
    species: [
      { id: 1, ci: 'Platanus × acerifolia', es: 'Plátano', ca: 'Plàtan' },
      { id: 2, ci: 'Jacaranda mimosifolia', es: 'Jacaranda', ca: 'Xicranda' },
      { id: 3, ci: 'Pinus pinea', es: 'Pino piñonero', ca: 'Pi pinyer' },
      { id: 4, ci: 'Parkinsonia aculeata', es: 'Espino de Jerusalén', ca: 'Parkinsònia' },
    ],
    districts: [{ c: 2, n: 'EIXAMPLE' }, { c: 4, n: 'GRÀCIA' }],
    barris: [{ c: 6, n: 'LA SAGRADA FAMILIA' }, { c: 9, n: 'LA NOVA ESQUERRA DE LEIXAMPLE' }, { c: 31, n: 'LA VILA DE GRÀCIA' }],
    categories: ['SEGONA', 'PRIMERA', 'TERCERA', 'EXEMPLAR'],
  }));

  gz('trees-lh.json.gz', pack('lh', [
    { codi: '420001', lat: 41.36, lng: 2.10, sp: 0, cat: -1, dist: 0, barri: 0, plant: '2026-10-29', adreca: null, prec: 0 },
    { codi: '420002', lat: 41.36, lng: 2.101, sp: 0, cat: -1, dist: 0, barri: 0, plant: '2005-12-31', adreca: null, prec: 1 },
    { codi: '420003', lat: 41.36, lng: 2.102, sp: 1, cat: -1, dist: 0, barri: 0, plant: '2015-12-31', adreca: null, prec: 2 },
  ], {
    municipi: 'lh',
    species: [
      { id: null, ci: 'Platanus hispanica', es: 'Plátano de sombra / Plátano', ca: 'Plàtan' },
      { id: null, ci: 'Tilia cordata', es: 'Tilo de hoja pequeña / Tilo', ca: 'Til·ler' },
    ],
    districts: [{ c: 1, n: null }],
    barris: [{ c: null, n: 'Centre' }],
    categories: [],
    extras: { precisio_plantacio: ['dia', 'sospitosa', 'any'] },
  }));

  write('areas.json', {
    format: 1, generated_at: '2026-11-03T13:20:47.042Z', sources: {},
    city: { trees: 6, population: 30000, area_ha: 300, per_inhabitant: 0.0002, per_km2: 2 },
    districts: [area(2, 'eixample', 'Eixample', 3), area(4, 'gracia', 'Gràcia', 3)],
    neighborhoods: [
      area(6, 'la-sagrada-familia', 'la Sagrada Família', 2, { district: 2 }),
      area(9, 'la-nova-esquerra-de-leixample', "la Nova Esquerra de l'Eixample", 1, { district: 2 }),
      area(31, 'la-vila-de-gracia', 'la Vila de Gràcia', 3, { district: 4 }),
      area(32, 'el-camp-den-grassot-i-gracia-nova', "el Camp d'en Grassot i Gràcia Nova", 0, { district: 4 }),
    ],
  });
  write('areas-lh.json', {
    format: 1, generated_at: '2026-11-03T13:20:47.042Z', sources: {},
    city: { trees: 3, population: 10000, area_ha: 100, per_inhabitant: 0.0003, per_km2: 3 },
    districts: [area(1001, 'districte-i', 'Districte I', 3)],
    neighborhoods: [area(1001, 'centre', 'Centre', 3, { district: 1001 })],
  });
  write('species-cards.json', {
    cards: [
      { ci: 'Platanus × acerifolia', names: ['Platanus × acerifolia', 'Platanus hispanica'], es: 'Plátano', ca: 'Plàtan', family: 'Platanaceae', traits: { leaf: 'deciduous', flowering: [4, 5], pollen: 3 } },
      { ci: 'Jacaranda mimosifolia', names: ['Jacaranda mimosifolia'], es: 'Jacaranda', ca: 'Xicranda', traits: { flowering: [5, 6], pollen: 1 } },
    ],
  });
  return dir;
}
