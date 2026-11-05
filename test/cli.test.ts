import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/cli.ts';
import { matchScore, norm } from '../src/data/text.ts';
import { makeFixture } from './fixture.ts';

before(() => {
  process.env.ARBRES_DATA_DIR = makeFixture();
});

async function run(...args: string[]) {
  let out = '';
  let err = '';
  const code = await main(args, (s) => (out += s), (s) => (err += s));
  return { code, out, err, json: args.includes('--json') && out ? JSON.parse(out) : null };
}

test('normaliza nombres con acentos y apóstrofos', () => {
  assert.equal(norm("la Nova Esquerra de l'Eixample"), 'la nova esquerra de leixample');
  assert.equal(matchScore('gracia', 'GRÀCIA'), 3);
  assert.equal(matchScore('pino', 'Espino de Jerusalén'), 0);
  assert.equal(matchScore('pino', 'Pino piñonero'), 1);
});

test('mas-reciente devuelve todos los empatados y cita la fuente', async () => {
  const { code, json } = await run('record', 'mas-reciente', '--json');
  assert.equal(code, 0);
  assert.equal(json.resultado.fecha, '2026-10-30');
  assert.equal(json.resultado.empatados, 2);
  assert.deepEqual(json.resultado.arboles.map((a: { codigo: string }) => a.codigo).sort(), ['A2', 'A3']);
  assert.equal(json.datos.version, '2026-11-03');
  assert.equal(json.fuentes[0].licencia, 'CC BY 4.0');
  assert.ok(json.notas.some((n: string) => n.includes('empatados')));
});

test('mas-antiguo descarta fechas imposibles y las de solo año', async () => {
  const { json } = await run('record', 'mas-antiguo', '--json');
  assert.equal(json.resultado.fecha, '2009-02-01');
  assert.equal(json.resultado.arboles[0].codigo, 'A6');
});

test('en L\'Hospitalet las fechas sospechosas no cuentan', async () => {
  const { json } = await run('record', 'mas-antiguo', '--municipio', 'lh', '--json');
  assert.equal(json.resultado.fecha, '2026-10-29');
  assert.equal(json.fuentes[0].licencia, 'CC BY-ND 4.0');
});

test('un barrio ambiguo pide precisar', async () => {
  const { code, err } = await run('record', 'mas-reciente', '--barrio', 'gracia');
  assert.equal(code, 2);
  assert.match(err, /más de un barrio/);
});

test('filtra por distrito con nombre sin acentos', async () => {
  const { json } = await run('buscar', '--distrito', 'gracia', '--json');
  assert.equal(json.resultado.total, 3);
  assert.equal(json.filtros.distrito, 'Gràcia');
});

test('especie-mas-comun agrupa sinónimos de Barcelona y L\'Hospitalet', async () => {
  const { json } = await run('record', 'especie-mas-comun', '--json');
  assert.equal(json.resultado[0].cientifico, 'Platanus × acerifolia');
  assert.equal(json.resultado[0].ejemplares, 5);
});

test('especie busca por nombre común y no confunde pino con espino', async () => {
  const { json } = await run('especie', 'pino', '--json');
  assert.deepEqual(json.resultado.especies.map((s: { cientifico: string }) => s.cientifico), ['Pinus pinea']);
});

test('cerca ordena por distancia', async () => {
  const { json } = await run('cerca', '41.4036,2.1744', '--radio', '50', '--json');
  assert.equal(json.resultado.total, 2);
  assert.equal(json.resultado.arboles[0].codigo, 'A1');
  assert.equal(json.resultado.arboles[0].distancia_m, 0);
});

test('arbol limpia la dirección y marca la fecha dudosa', async () => {
  const { json } = await run('arbol', 'A4', '--json');
  assert.equal(json.resultado.direccion, 'G.V. Corts Catalanes, 491');
  assert.equal(json.resultado.plantacion.dudosa, true);
  assert.equal(json.resultado.url, 'https://arbres.barcelona/mapa?tree=A4');
  const lh = await run('arbol', 'lh:420001', '--json');
  assert.equal(lh.json.resultado.barrio, 'Centre');
});

test('barrio resume con la posición y el enlace a la web', async () => {
  const { json } = await run('barrio', 'sagrada familia', '--json');
  assert.equal(json.resultado.nombre, 'la Sagrada Família');
  assert.equal(json.resultado.distrito, 'Eixample');
  assert.equal(json.resultado.url, 'https://arbres.barcelona/barrios/la-sagrada-familia');
});

test('mas-alto explica que no hay altura', async () => {
  const { code, json } = await run('record', 'mas-alto', '--json');
  assert.equal(code, 2);
  assert.match(json.error, /altura/);
});

test('florece usa las fichas de especie', async () => {
  const { json } = await run('record', 'florece', '--mes', '4', '--json');
  assert.equal(json.resultado.especies, 1);
  assert.equal(json.resultado.ejemplares, 5);
});

test('un formato desconocido da un error claro', async () => {
  const { writeFileSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = process.env.ARBRES_DATA_DIR!;
  const meta = readFileSync(join(dir, 'meta.json'), 'utf8');
  writeFileSync(join(dir, 'meta.json'), meta.replace('"format":1', '"format":2'));
  try {
    const { code, err } = await run('stats');
    assert.equal(code, 1);
    assert.match(err, /formato 2/);
  } finally {
    writeFileSync(join(dir, 'meta.json'), meta);
  }
});

test('stats no necesita el inventario', async () => {
  const { json } = await run('stats', '--json');
  assert.equal(json.resultado.length, 2);
  assert.equal(json.resultado[0].arboles, 6);
});

test('descarga por HTTP, guarda en caché y funciona sin red', async () => {
  const { createServer } = await import('node:http');
  const { readFileSync, mkdtempSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = process.env.ARBRES_DATA_DIR!;
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    const file = join(dir, (req.url ?? '/').replace(/^\/data\//, ''));
    if (!existsSync(file)) {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Arbres</title>');
      return;
    }
    res.writeHead(200, { 'content-type': file.endsWith('.gz') ? 'application/gzip' : 'application/json' }).end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const saved = { dir: process.env.ARBRES_DATA_DIR, cache: process.env.ARBRES_CACHE_DIR };
  delete process.env.ARBRES_DATA_DIR;
  process.env.ARBRES_DATA_URL = `http://127.0.0.1:${port}/data/`;
  process.env.ARBRES_CACHE_DIR = mkdtempSync(join(tmpdir(), 'arbres-cache-'));
  try {
    const first = await run('record', 'mas-reciente', '--json');
    assert.equal(first.code, 0);
    const afterFirst = hits;
    assert.ok(afterFirst >= 4);
    const second = await run('record', 'mas-reciente', '--json');
    assert.equal(second.json.resultado.fecha, first.json.resultado.fecha);
    assert.equal(hits, afterFirst, 'la segunda consulta sale de la caché');
    server.close();
    const offline = await run('arbol', 'A1', '--sin-red', '--json');
    assert.equal(offline.code, 0);
  } finally {
    server.close();
    process.env.ARBRES_DATA_DIR = saved.dir;
    delete process.env.ARBRES_DATA_URL;
    if (saved.cache) process.env.ARBRES_CACHE_DIR = saved.cache;
    else delete process.env.ARBRES_CACHE_DIR;
  }
});
