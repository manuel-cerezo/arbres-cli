// Formato de los ficheros publicados por arbres.barcelona en /data/.
// Copiado de green-barna (apps/web/src/types/staticData.ts y
// scripts/tree-data-format.ts): los datos van en columnas con diccionarios y
// cada columna de baja cardinalidad guarda índices (-1 = null).

/** Versión del formato que entiende este CLI. Si la web la sube, avisamos. */
export const SUPPORTED_FORMAT = 1;

export type DatasetId = 'viari' | 'parcs' | 'zona' | 'lh';
export type MunicipalityId = 'bcn' | 'lh';

export const DATASET_IDS: readonly DatasetId[] = ['viari', 'parcs', 'zona', 'lh'];

export interface SpeciesDictEntry {
  id: number | null;
  ci: string | null;
  es: string | null;
  ca: string | null;
}

export interface CodeNameDictEntry {
  c: number | null;
  n: string | null;
}

export interface PackedDataset {
  format: number;
  dataset: DatasetId;
  municipi?: MunicipalityId;
  version: string;
  count: number;
  species: SpeciesDictEntry[];
  districts: CodeNameDictEntry[];
  barris: CodeNameDictEntry[];
  categories: string[];
  alcades: string[];
  espais: string[];
  enums: Record<string, string[]>;
  extras?: Record<string, string[]>;
  cols: {
    codi: string[];
    lat: number[];
    lng: number[];
    sp: number[];
    cat: number[];
    alc: number[];
    dist: number[];
    barri: number[];
    espai: number[];
    plant: (string | null)[];
    adreca: (string | null)[];
    det: Record<string, number[]>;
    ext?: Record<string, number[]>;
  };
}

export interface DataMeta {
  format: number;
  version: string;
  generated_at: string;
  datasets: Record<string, { count: number; version?: string; contentHash?: string; municipi?: MunicipalityId }>;
}

export class FormatError extends Error {}

/** Comprueba que un fichero tiene el formato que sabemos leer. */
export function assertFormat(file: string, value: unknown): void {
  const format = (value as { format?: unknown } | null)?.format;
  if (format !== SUPPORTED_FORMAT) {
    throw new FormatError(
      `El fichero ${file} tiene el formato ${String(format)} y este CLI solo entiende el ${SUPPORTED_FORMAT}. ` +
        'Actualiza arbres-cli (npx arbres-cli@latest) o avisa en https://github.com/manuel-cerezo/arbres-cli/issues.',
    );
  }
}

export function pick<T>(dict: T[], index: number | undefined): T | null {
  return index != null && index >= 0 ? (dict[index] ?? null) : null;
}
