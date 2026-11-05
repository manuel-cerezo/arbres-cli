import { mkdir, readFile, writeFile, stat, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { assertFormat, type DataMeta } from './format.js';

export const DEFAULT_BASE_URL = 'https://arbres.barcelona/data/';
const USER_AGENT = 'arbres-cli/0.1 (+https://github.com/manuel-cerezo/arbres-cli)';
/** Cada cuánto se pregunta a la web si hay datos nuevos. Se publican una vez por semana. */
const META_TTL_MS = 6 * 60 * 60 * 1000;

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
      const meta = JSON.parse(await readFile(join(this.base, 'meta.json'), 'utf8')) as DataMeta;
      assertFormat('meta.json', meta);
      return meta;
    }
    const cached = join(this.cacheDir, 'meta.json');
    let old: DataMeta | null = null;
    let fresh = false;
    try {
      const [text, info] = await Promise.all([readFile(cached, 'utf8'), stat(cached)]);
      old = JSON.parse(text) as DataMeta;
      fresh = Date.now() - info.mtimeMs < META_TTL_MS;
    } catch {
      old = null;
    }
    if (old && (this.offline || (fresh && !this.refresh))) return old;
    if (this.offline) {
      throw new DataUnavailableError('No hay datos guardados y has pedido no usar la red (--sin-red). Ejecuta una consulta con conexión primero.');
    }
    try {
      const body = await this.download('meta.json');
      const meta = JSON.parse(body.toString('utf8')) as DataMeta;
      assertFormat('meta.json', meta);
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(cached, body);
      if (old && old.generated_at !== meta.generated_at) await this.dropVersion(old.generated_at);
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

  private async dropVersion(generatedAt: string): Promise<void> {
    await rm(this.versionDir(generatedAt), { recursive: true, force: true });
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
      try {
        raw = await readFile(path);
      } catch {
        if (this.offline) throw new DataUnavailableError(`El fichero ${file} no está guardado y has pedido no usar la red (--sin-red).`);
        raw = await this.download(file);
        await mkdir(dir, { recursive: true });
        await writeFile(path, raw);
      }
    }
    // Un servidor puede entregar el .gz ya descomprimido: se mira la firma, no la extensión.
    const gz = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    const text = (gz ? gunzipSync(raw) : raw).toString('utf8');
    const value = JSON.parse(text) as T;
    if (checkFormat) assertFormat(file, value);
    return value;
  }

  private async download(file: string): Promise<Buffer> {
    const url = new URL(file, this.base).toString();
    let response: Response;
    try {
      response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json, application/gzip, */*' } });
    } catch (error) {
      throw new DataUnavailableError(`No se ha podido conectar con ${url}: ${(error as Error).message}`);
    }
    if (!response.ok) throw new DataUnavailableError(`${url} ha respondido ${response.status}.`);
    const type = response.headers.get('content-type') ?? '';
    const body = Buffer.from(await response.arrayBuffer());
    // Una ruta que no existe devuelve la página de la web (HTML) en vez de un 404.
    if (type.includes('text/html') || body.subarray(0, 15).toString().trimStart().startsWith('<')) {
      throw new DataUnavailableError(`${url} no es un fichero de datos (la web ha devuelto una página HTML).`);
    }
    return body;
  }

  /** Borra la caché entera. */
  async clear(): Promise<void> {
    if (!existsSync(this.cacheDir)) return;
    for (const entry of await readdir(this.cacheDir)) await rm(join(this.cacheDir, entry), { recursive: true, force: true });
  }
}
