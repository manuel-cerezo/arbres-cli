#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DataSource, DataUnavailableError } from './data/source.js';
import { FormatError } from './data/format.js';
import { Store } from './data/store.js';
import { UsageError } from './filters.js';
import { envelope, sourceLine, type Lang } from './output.js';
import { arbol, barrio, buscar, cerca, distrito, especie, stats } from './commands/basic.js';
import { guia, GUIDE } from './commands/guia.js';
import { record } from './commands/records.js';
import type { Command } from './commands/context.js';

export const VERSION = '0.1.0';

const COMMANDS: Command[] = [record, buscar, cerca, arbol, especie, barrio, distrito, stats, guia];

const GLOBAL_OPTIONS = {
  json: { type: 'boolean' },
  idioma: { type: 'string' },
  'sin-red': { type: 'boolean' },
  actualizar: { type: 'boolean' },
  ayuda: { type: 'boolean', short: 'h' },
  help: { type: 'boolean' },
  version: { type: 'boolean', short: 'v' },
} as const;

function help(): string {
  return [
    `arbres ${VERSION}: pregunta a los árboles de Barcelona y L'Hospitalet desde la terminal.`,
    '',
    'Uso: arbres <comando> [argumentos] [opciones]',
    '',
    ...COMMANDS.map((c) => `  ${c.name.padEnd(10)}${c.summary}`),
    '  cache     Muestra dónde se guardan los datos (--limpiar para borrarlos)',
    '',
    'Opciones: --json, --idioma es|ca, --sin-red, --actualizar',
    'Ejecuta "arbres guia" para ver filtros, récords y ejemplos.',
  ].join('\n');
}

export async function main(argv: string[], out: (s: string) => void = (s) => process.stdout.write(s), err: (s: string) => void = (s) => process.stderr.write(s)): Promise<number> {
  const name = argv.find((a) => !a.startsWith('-'));
  const json = argv.includes('--json');
  try {
    if (!name || argv.includes('--version') || argv.includes('-v')) {
      if (argv.includes('--version') || argv.includes('-v')) out(`${VERSION}\n`);
      else out(`${help()}\n`);
      return 0;
    }
    if (name === 'cache') {
      const { values } = parseArgs({ args: argv.slice(1), options: { limpiar: { type: 'boolean' }, json: { type: 'boolean' } }, allowPositionals: true });
      const source = new DataSource();
      if (values.limpiar) await source.clear();
      out(json ? `${JSON.stringify({ cache: source.cacheDir, borrada: !!values.limpiar })}\n` : `${values.limpiar ? 'Caché borrada: ' : ''}${source.cacheDir}\n`);
      return 0;
    }
    const command = COMMANDS.find((c) => c.name === name || (name === 'árbol' && c.name === 'arbol') || (name === 'guía' && c.name === 'guia'));
    if (!command) throw new UsageError(`Comando desconocido «${name}».\n\n${help()}`);
    const index = argv.indexOf(name);
    const { values, positionals } = parseArgs({
      args: [...argv.slice(0, index), ...argv.slice(index + 1)],
      options: { ...GLOBAL_OPTIONS, ...(command.options ?? {}) },
      allowPositionals: true,
      strict: true,
    });
    if (values.ayuda || values.help) {
      out(`${command.summary}\n\nUso: ${command.usage}\n\n${command.name === 'guia' ? '' : 'Ejecuta "arbres guia" para ver todos los filtros.\n'}`);
      return 0;
    }
    if (command.name === 'guia' && !json) {
      out(GUIDE);
      return 0;
    }
    const lang = (values.idioma === 'ca' ? 'ca' : 'es') as Lang;
    const store = new Store(new DataSource({ offline: !!values['sin-red'], refresh: !!values.actualizar }));
    const answer = await command.run({ store, lang, args: positionals, values: values as Record<string, string | boolean | undefined> });
    const meta = await store.meta();
    if (json) out(`${JSON.stringify(envelope(answer, meta), null, 2)}\n`);
    else {
      out(`${answer.texto ?? JSON.stringify(answer.resultado, null, 2)}\n`);
      if (answer.notas?.length) out(`\n${answer.notas.map((n) => `Nota: ${n}`).join('\n')}\n`);
      out(`\n${sourceLine(meta, answer.municipios)}\n`);
    }
    return 0;
  } catch (error) {
    const known = error instanceof UsageError || error instanceof DataUnavailableError || error instanceof FormatError;
    const message = known ? error.message : `Error inesperado: ${(error as Error)?.stack ?? String(error)}`;
    const code = error instanceof UsageError ? 2 : 1;
    if ((error as { code?: string })?.code?.startsWith?.('ERR_PARSE_ARGS')) {
      const msg = `${(error as Error).message}\nEjecuta "arbres guia" para ver las opciones.`;
      if (json) out(`${JSON.stringify({ error: msg }, null, 2)}\n`);
      else err(`${msg}\n`);
      return 2;
    }
    if (json) out(`${JSON.stringify({ error: message, tipo: error instanceof UsageError ? 'uso' : error instanceof FormatError ? 'formato' : 'datos' }, null, 2)}\n`);
    else err(`${message}\n`);
    return code;
  }
}

// Si la salida se corta (arbres … | head), se termina sin traza.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const invokedDirectly = process.argv[1] && /(?:cli\.[jt]s|arbres(?:-cli)?)$/.test(process.argv[1].replace(/\\/g, '/'));
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
