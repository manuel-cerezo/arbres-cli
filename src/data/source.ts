import { mkdir, readFile, writeFile, stat, readdir, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { assertFormat, FormatError, type DataMeta } from './format.js';

export const DEFAULT_BASE_URL = 'https://arbres.barcelona/data/';
const USER_AGENT = 'arbres-cli/0.1 (+https://github.com/manuel-cerezo/arbres-cli)';
/** Cada cuánto se pregunta a la web si hay datos nuevos. Se publican una vez por semana. */
const META_TTL_MS = 6 * 60 * 60 * 1000;
/** Tiempo máximo de una descarga: meta.json es pequeño; el inventario de calles pesa ~2 MB. */
const TIMEOUT_MS = { small: 30_000, large: 120_000 };
/** Carpetas de versión que crea la caché («20261103T132047042Z»). Nada más se borra. */
const VERSION_DIR = /^\d{8}T\d{6,}Z$/;

function validateMeta(file: string, value: unknown): DataMeta {
  assertFormat(file, value);
  const meta = value as Partial<DataMeta>;
  if (typeof meta.generated_at !== 'string' || typeof meta.version !== 'string' || !meta.datasets || typeof meta.datasets !== 'object') {
    throw new FormatError(`El fichero ${file} no tiene la forma esperada (faltan generated_at, version o datasets).`);
  }
  return meta as DataMeta;
}

/** Escribe primero en un fichero temporal y lo renombra: una descarga cortada nunca deja un fichero a medias. */
async function writeAtomic(path: string, data: Buffer): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

function decode<T>(raw: Buffer): T {
  // Un servidor puede entregar el .gz ya descomprimido: se mira la firma, no la extensión.
  const gz = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  return JSON.parse((gz ? gunzipSync(raw) : raw).toString('utf8')) as T;
}

export interface SourceOptions {
  /** URL base de los datos, o carpeta local (ARBRES_DATA_DIR). */
  base?: string;
  cacheDir?: string;
  /** No usar la red: solo la copia guardada. */
  offline?: boolean;
  /** Preguntar a la web aunque la copia sea reciente. */
  refresh?: boolean;
}

export class DataUnavailableError extends Error {}

function defaultCacheDir(): string {
  if (process.env.ARBRES_CACHE_DIR) return process.env.ARBRES_CACHE_DIR;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'arbres-cli');
  const xdg = process.env.XDG_CACHE_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.cache'), 'arbres-cli');
}

/**
 * Lee los ficheros de datos de la web con una caché local. La caché va por
 * versión de los datos (`meta.json → generated_at`): cuando la web publica
 * datos nuevos, la siguiente consulta los baja y borra la copia anterior.
 */
export class DataSource {
  readonly base: string;
  readonly local: boolean;
  readonly cacheDir: string;
  readonly offline: boolean;
  readonly refresh: boolean;
  private metaPromise: Promise<DataMeta> | null = null;
  private memo = new Map<string, Promise<unknown>>();

  constructor(options: SourceOptions = {}) {
    const dir = options.base ?? process.env.ARBRES_DATA_DIR;
    const url = process.env.ARBRES_DATA_URL;
    if (dir && !/^https?:\/\//.test(dir)) {
      this.base = resolve(dir);
      this.local = true;
    } else {
      const b = dir ?? url ?? DEFAULT_BASE_URL;
      this.base = b.endsWith('/') ? b : `${b}/`;
      this.local = false;
    }
    this.cacheDir = options.cacheDir ?? defaultCacheDir();
    this.offline = options.offline ?? false;
    this.refresh = options.refresh ?? false;
  }

  meta(): Promise<DataMeta> {
    this.metaPromise ??= this.loadMeta();
    return this.metaPromise;
  }

  /** Un fichero JSON (o .json.gz) de la carpeta de datos, ya descomprimido. */
  json<T>(file: string, options: { checkFormat?: boolean } = {}): Promise<T> {
    let p = this.memo.get(file) as Promise<T> | undefined;
    if (!p) {
      p = this.loadJson<T>(file, options.checkFormat ?? false);
      this.memo.set(file, p);
    }
    return p;
  }

  private async loadMeta(): Promise<DataMeta> {
    if (this.local) {
      return validateMeta('meta.json', JSON.parse(await readFile(join(this.base, 'meta.json'), 'utf8')));
    }
    const cached = join(this.cacheDir, 'meta.json');
    let old: DataMeta | null = null;
    let fresh = false;
    try {
      const [text, info] = await Promise.all([readFile(cached, 'utf8'), stat(cached)]);
      old = validateMeta('meta.json', JSON.parse(text));
      fresh = Date.now() - info.mtimeMs < META_TTL_MS;
    } catch {
      old = null;
    }
    if (old && (this.offline || (fresh && !this.refresh))) return old;
    if (this.offline) {
      throw new DataUnavailableError('No hay datos guardados y has pedido no usar la red (--sin-red). Ejecuta una consulta con conexión primero.');
    }
    try {
      const body = await this.download('meta.json', TIMEOUT_MS.small);
      const meta = validateMeta('meta.json', decode(body));
      await mkdir(this.cacheDir, { recursive: true });
      await writeAtomic(cached, body);
      if (old?.generated_at !== meta.generated_at) await this.dropOtherVersions(meta.generated_at);
      return meta;
    } catch (error) {
      if (old && error instanceof DataUnavailableError) {
        process.stderr.write(`Aviso: no se ha podido comprobar si hay datos nuevos (${error.message}). Uso la copia del ${old.version}.\n`);
        return old;
      }
      throw error;
    }
  }

  private versionDir(generatedAt: string): string {
    return join(this.cacheDir, generatedAt.replace(/[^0-9A-Za-z]/g, ''));
  }

  /** Borra las copias de versiones anteriores; solo carpetas con nombre de versión. */
  private async dropOtherVersions(current: string): Promise<void> {
    const keep = this.versionDir(current).split(/[\\/]/).pop();
    for (const entry of await readdir(this.cacheDir).catch(() => [] as string[])) {
      if (VERSION_DIR.test(entry) && entry !== keep) await rm(join(this.cacheDir, entry), { recursive: true, force: true });
    }
  }

  private async loadJson<T>(file: string, checkFormat: boolean): Promise<T> {
    let raw: Buffer;
    if (this.local) {
      const path = join(this.base, file);
      if (!existsSync(path)) throw new DataUnavailableError(`Falta el fichero ${file} en ${this.base}.`);
      raw = await readFile(path);
    } else {
      const meta = await this.meta();
      const dir = this.versionDir(meta.generated_at);
      const path = join(dir, file.replace(/\//g, '__'));
      let cached: Buffer | null = null;
      try {
        cached = await readFile(path);
      } catch {
        cached = null;
      }
      if (cached) {
        try {
          const value = decode<T>(cached);
          if (checkFormat) assertFormat(file, value);
          return value;
        } catch (error) {
          if (error instanceof FormatError) throw error;
          // Copia dañada (p. ej. un disco lleno): se descarta y se vuelve a bajar.
          await rm(path, { force: true });
        }
      }
      if (this.offline) throw new DataUnavailableError(`El fichero ${file} no está guardado y has pedido no usar la red (--sin-red).`);
      raw = await this.download(file, file.endsWith('.gz') ? TIMEOUT_MS.large : TIMEOUT_MS.small);
      const value = this.parseDownloaded<T>(file, raw);
      await mkdir(dir, { recursive: true });
      await writeAtomic(path, raw);
      if (checkFormat) assertFormat(file, value);
      return value;
    }
    const value = this.parseDownloaded<T>(file, raw);
    if (checkFormat) assertFormat(file, value);
    return value;
  }

  private parseDownloaded<T>(file: string, raw: Buffer): T {
    try {
      return decode<T>(raw);
    } catch (error) {
      throw new DataUnavailableError(`El fichero ${file} no se ha podido leer (${(error as Error).message}).`);
    }
  }

  private async download(file: string, timeoutMs: number): Promise<Buffer> {
    const url = new URL(file, this.base).toString();
    let body: Buffer;
    let type: string;
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json, application/gzip, */*' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new DataUnavailableError(`${url} ha respondido ${response.status}.`);
      type = response.headers.get('content-type') ?? '';
      body = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof DataUnavailableError) throw error;
      const reason = (error as Error).name === 'TimeoutError' ? `no ha respondido en ${timeoutMs / 1000} s` : (error as Error).message;
      throw new DataUnavailableError(`No se ha podido descargar ${url}: ${reason}`);
    }
    // Una ruta que no existe devuelve la página de la web (HTML) en vez de un 404.
    if (type.includes('text/html') || body.subarray(0, 15).toString().trimStart().startsWith('<')) {
      throw new DataUnavailableError(`${url} no es un fichero de datos (la web ha devuelto una página HTML).`);
    }
    return body;
  }

  /**
   * Borra la caché. Solo toca lo que crea este CLI (meta.json y las carpetas
   * de versión), por si ARBRES_CACHE_DIR apunta a una carpeta con otras cosas.
   */
  async clear(): Promise<void> {
    if (!existsSync(this.cacheDir)) return;
    for (const entry of await readdir(this.cacheDir)) {
      if (entry === 'meta.json' || VERSION_DIR.test(entry) || /^meta\.json\..*\.tmp$/.test(entry)) {
        await rm(join(this.cacheDir, entry), { recursive: true, force: true });
      }
    }
  }
}
