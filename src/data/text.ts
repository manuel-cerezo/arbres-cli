/**
 * Minúsculas, sin acentos ni signos: «l'Antiga Esquerra» → «l antiga esquerra»,
 * «Til·ler» → «tiller», «Platanus × acerifolia» → «platanus x acerifolia».
 * El apóstrofo separa palabras para que «Eixample» encuentre «l'Eixample».
 */
export function norm(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[·.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Palabras que no ayudan a distinguir barrios: «la», «el», «de», «i»… */
const STOP = new Set(['el', 'la', 'els', 'les', 'l', 'de', 'del', 'dels', 'd', 'i', 'y', 'the']);

export function words(value: string | null | undefined): string[] {
  return norm(value).split(' ').filter((w) => w && !STOP.has(w));
}

/**
 * Puntuación de coincidencia entre lo que escribe alguien y un nombre.
 * 3 = igual, 2 = mismas palabras significativas, 1 = contiene todas las
 * palabras buscadas, 0 = no coincide.
 */
export function matchScore(query: string, name: string | null | undefined): number {
  if (!name) return 0;
  const q = norm(query);
  const n = norm(name);
  if (!q) return 0;
  if (q === n) return 3;
  const qw = words(query);
  const nw = words(name);
  if (qw.length && qw.join(' ') === nw.join(' ')) return 2;
  if (qw.length && qw.every((w) => nw.some((x) => x.startsWith(w)))) return 1;
  return 0;
}

/** «LA VILA DE GRÀCIA» → «La Vila De Gràcia» (solo para nombres sin versión bonita). */
export function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s\-(/])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}
