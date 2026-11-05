# arbres

Pregunta a los árboles de Barcelona y L'Hospitalet desde la terminal o desde tu agente.

`arbres` lee los datos que publica [arbres.barcelona](https://arbres.barcelona): unos 260.000 árboles de los inventarios municipales, con su especie, barrio, calle y fecha de plantación cuando la hay, más las fichas de especie y los resúmenes por barrio. No necesita servidor ni cuenta: la primera consulta descarga unos 5 MB y las siguientes salen de una copia local, que se renueva cuando la web publica datos nuevos (una vez por semana).

```
$ arbres record mas-reciente --distrito Gràcia
Plantación más reciente: 30/10/2026 (3 árboles empatados)
  Arce plateado fastigiata (Acer saccharinum 'Pyramidale') · Pl Alfonso Comín, 16, Vallcarca i els Penitents · plantado 30/10/2026 · https://arbres.barcelona/mapa?tree=0270869AR
  …

Nota: Solo 2263 de 11.401 árboles (19,8 %) tienen fecha de plantación exacta; el resto no cuenta.
```

## Instalación

Hace falta [Node.js](https://nodejs.org) 22 o posterior.

```sh
npx github:manuel-cerezo/arbres-cli guia      # sin instalar nada
npm install -g github:manuel-cerezo/arbres-cli  # para tener el comando «arbres»
```

Cuando se publique en npm bastará con `npx arbres-cli …` o `npm install -g arbres-cli`.

## Qué se puede preguntar

| Pregunta | Comando |
|---|---|
| ¿Cuál es el último árbol plantado? | `arbres record mas-reciente` |
| ¿Y el más antiguo con fecha? | `arbres record mas-antiguo` |
| ¿Qué especie es la más común en L'Hospitalet? | `arbres record especie-mas-comun --municipio lh` |
| ¿Qué especies tienen un solo ejemplar? | `arbres record especies-unicas` |
| ¿Qué barrio tiene más árboles por habitante? | `arbres record barrio-mas-arbolado --por habitante` |
| ¿Y dentro de Gràcia, por km²? | `arbres record barrio-mas-arbolado --distrito Gràcia --por km2` |
| ¿Qué florece en abril en el Eixample? | `arbres record florece --mes 4 --distrito Eixample` |
| ¿Cuántos árboles tienen polen muy alergénico? | `arbres record alergenos` |
| ¿Qué árboles hay cerca de mí? | `arbres cerca 41.4036,2.1744 --radio 150` |
| ¿Cuántas jacarandas se han plantado desde 2020? | `arbres buscar --especie jacaranda --plantado-desde 2020` |
| ¿Cómo es el árbol 0091136AR? | `arbres arbol 0091136AR` |
| ¿Cuántos pinos hay y dónde? | `arbres especie pino` |
| ¿Cómo está de arbolado el Raval? | `arbres barrio "el Raval"` |

`arbres guia` explica todos los comandos, filtros y récords.

Filtros comunes: `--municipio bcn|lh`, `--distrito`, `--barrio`, `--especie`, `--tipo calle|parque|zona`, `--categoria`, `--plantado-desde`, `--plantado-hasta`, `--cerca lat,lng --radio m` y `--limite N`. Los nombres se escriben como quieras: «gracia», «Gràcia» o «GRÀCIA». Si un nombre puede ser más de un barrio, el comando lo dice y pide el nombre completo.

## Desde un agente

Todo comando acepta `--json`. La salida siempre tiene la misma forma:

```json
{
  "consulta": "record mas-reciente",
  "filtros": { "distrito": "Gràcia" },
  "resultado": { "fecha": "2026-10-30", "empatados": 3, "arboles": [ … ] },
  "notas": ["Solo 2263 de 11.401 árboles (19,8 %) tienen fecha de plantación exacta; el resto no cuenta."],
  "datos": { "version": "2026-11-03", "generado": "2026-11-03T13:20:47.042Z", "web": "https://arbres.barcelona" },
  "fuentes": [{ "nombre": "Ajuntament de Barcelona, Open Data BCN …", "licencia": "CC BY 4.0", … }]
}
```

Si hay un error, la salida es `{ "error": "…", "tipo": "uso" | "datos" | "formato" | "interno" }` y el código de salida es distinto de 0 (2 si es un error de uso, como un barrio ambiguo; 1 en los demás casos).

**Agentes que ejecutan comandos** (Claude Code, Codex, Cursor, Gemini CLI…): añade esto a sus instrucciones (`CLAUDE.md`, `AGENTS.md`…):

```
Para preguntas sobre árboles de Barcelona o L'Hospitalet, usa el CLI «arbres»
(npx github:manuel-cerezo/arbres-cli). Ejecuta primero «arbres guia» y después
los comandos con --json. Lee las notas y cita la fuente y la fecha de los datos.
```

**Asistentes de chat** (Claude Desktop, ChatGPT…): habrá un servidor MCP (`arbres mcp`) en una próxima versión.

## Límites de los datos

- **No hay altura.** Open Data BCN dejó de publicarla. `record mas-gruesos` da los árboles con más de 110 cm de perímetro, que es un rango y no una medida.
- **La fecha de plantación falta en la mayoría de árboles de Barcelona** (la tiene menos de uno de cada cuatro). Los récords de fecha solo cuentan los que la tienen y descartan fechas imposibles (anteriores a 1900 o futuras) y las que L'Hospitalet marca como sospechosas.
- Es la fecha de plantación en el inventario, no la edad del árbol.
- La floración y la alergenicidad del polen salen de las fichas de especie de arbres.barcelona: son orientativas.
- Los árboles sin especie identificada («Tilia sp.», «Indeterminat Arbre») no cuentan en los récords de especies.

## Datos y licencias

El código es MIT. Los datos no: son de los ayuntamientos y tienen su propia licencia. Ver [DATOS.md](DATOS.md).

## Opciones

| Opción | Para qué |
|---|---|
| `--json` | Salida para programas y agentes |
| `--idioma es\|ca` | Nombres comunes en castellano o catalán |
| `--sin-red` | Usar solo la copia guardada |
| `--actualizar` | Comprobar ahora si hay datos nuevos (si no, se comprueba cada 6 horas) |
| `arbres cache [--limpiar]` | Dónde se guardan los datos, o borrarlos |

Variables de entorno: `ARBRES_CACHE_DIR` cambia la carpeta de la caché y `ARBRES_DATA_DIR` lee los datos de una carpeta local (útil para desarrollar con una copia de `apps/web/public/data`).

## Desarrollo

```sh
npm install
npm test          # tests con datos de prueba, sin red
npm run build
ARBRES_DATA_DIR=../green-barna/apps/web/public/data npm run dev -- record mas-reciente
```

El formato de los ficheros es el de `green-barna` (`apps/web/src/types/staticData.ts`). Si la web cambia el número de formato, el CLI se niega a leerlo y lo dice, en vez de dar respuestas equivocadas.

---

**Català.** `arbres` respon preguntes sobre els arbres de Barcelona i L'Hospitalet amb les dades d'[arbres.barcelona](https://arbres.barcelona). Fes servir `--idioma ca` per veure els noms comuns en català i `arbres guia` per veure-ho tot.
