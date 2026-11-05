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

const CACHE_OPTIONS = { limpiar: { type: 'boolean' } } as const;

/** Todas las opciones de todos los comandos: sirve para saber qué palabra es el comando
 *  aunque haya opciones con valor delante («arbres --idioma ca record …»). */
const ALL_OPTIONS = Object.assign({}, GLOBAL_OPTIONS, CACHE_OPTIONS, ...COMMANDS.map((c) => c.options ?? {}));

function commandName(argv: string[]): string | undefined {
  try {
    return parseArgs({ args: argv, options: ALL_OPTIONS, allowPositionals: true, strict: false }).positionals[0];
  } catch {
    return argv.find((a) => !a.startsWith('-'));
  }
}

function errorJson(message: string, tipo: 'uso' | 'datos' | 'formato' | 'interno'): string {
  return `${JSON.stringify({ error: message, tipo }, null, 2)}\n`;
}

export async function main(argv: string[], out: (s: string) => void = (s) => process.stdout.write(s), err: (s: string) => void = (s) => process.stderr.write(s)): Promise<number> {
  const name = commandName(argv);
  const json = argv.includes('--json');
  try {
    if (argv.includes('--version') || argv.includes('-v')) {
      out(`${VERSION}\n`);
      return 0;
    }
    if (!name) {
      out(`${help()}\n`);
      return 0;
    }
    if (name === 'cache') {
      const { values } = parseArgs({ args: argv, options: { ...CACHE_OPTIONS, json: { type: 'boolean' } }, allowPositionals: true });
      const source = new DataSource();
      if (values.limpiar) await source.clear();
      out(json ? `${JSON.stringify({ cache: source.cacheDir, borrada: !!values.limpiar })}\n` : `${values.limpiar ? 'Caché borrada: ' : ''}${source.cacheDir}\n`);
      return 0;
    }
    const command = COMMANDS.find((c) => c.name === name || (name === 'árbol' && c.name === 'arbol') || (name === 'guía' && c.name === 'guia'));
    if (!command) throw new UsageError(`Comando desconocido «${name}».\n\n${help()}`);
    const parsed = parseArgs({
      args: argv,
      options: { ...GLOBAL_OPTIONS, ...(command.options ?? {}) },
      allowPositionals: true,
      strict: true,
    });
    const values = parsed.values;
    // El primer argumento suelto es el nombre del comando.
    const positionals = parsed.positionals.slice(1);
    if (values.ayuda || values.help) {
      out(`${command.summary}\n\nUso: ${command.usage}\n\n${command.name === 'guia' ? '' : 'Ejecuta "arbres guia" para ver todos los filtros.\n'}`);
      return 0;
    }
    if (command.name === 'guia') {
      // La guía no necesita datos: funciona sin red y sin caché.
      out(json ? `${JSON.stringify({ consulta: 'guia', resultado: { guia: GUIDE } }, null, 2)}\n` : GUIDE);
      return 0;
    }
    if (values.idioma !== undefined && values.idioma !== 'es' && values.idioma !== 'ca') {
      throw new UsageError(`Idioma desconocido «${String(values.idioma)}». Usa es o ca.`);
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
    if ((error as { code?: string })?.code?.startsWith?.('ERR_PARSE_ARGS')) {
      const msg = `${(error as Error).message}\nEjecuta "arbres guia" para ver las opciones.`;
      if (json) out(errorJson(msg, 'uso'));
      else err(`${msg}\n`);
      return 2;
    }
    const tipo = error instanceof UsageError ? 'uso' : error instanceof FormatError ? 'formato' : error instanceof DataUnavailableError ? 'datos' : 'interno';
    const message = tipo === 'interno' ? `Error inesperado: ${(error as Error)?.stack ?? String(error)}` : (error as Error).message;
    if (json) out(errorJson(message, tipo));
    else err(`${message}\n`);
    return tipo === 'uso' ? 2 : 1;
  }
}
