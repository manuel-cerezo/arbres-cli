import type { Command } from './context.js';
import { recordHelp } from './records.js';

export const GUIDE = `arbres: pregunta a los árboles de Barcelona y L'Hospitalet (datos de https://arbres.barcelona)

PARA AGENTES
- Ejecuta los comandos con --json: la salida es un objeto con consulta, filtros
  entendidos, resultado, notas, fecha de los datos y fuentes con su licencia.
- Lee siempre "notas": explican límites (fechas que faltan, empates, rangos).
- Cita la fuente al contestar: "Datos del <datos.version>, Ajuntament de
  Barcelona (CC BY 4.0) vía arbres.barcelona". Enlaza el "url" de cada árbol.
- Si un nombre es ambiguo, el comando falla y dice las opciones: elige una y repite.
- La primera consulta descarga unos 5 MB; luego va de la caché local.

COMANDOS
  arbres record <tipo> [filtros]   Preguntas ya resueltas (lista abajo)
  arbres buscar [filtros]          Árboles que cumplen los filtros
  arbres cerca <lat,lng>           Árboles cerca de un punto (--radio metros, 200 por defecto)
  arbres arbol <codigo>            Ficha de un árbol (códigos como 0091136AR o lh:420697)
  arbres especie <nombre>          Cuántos hay de una especie, dónde y sus rasgos
  arbres barrio <nombre>           Resumen de un barrio, con su posición en la ciudad
  arbres distrito <nombre>         Resumen de un distrito
  arbres stats                     Totales por municipio, fuente y distrito
  arbres guia                      Esta guía

RÉCORDS
${recordHelp()}

FILTROS (sirven en record, buscar, cerca y especie)
  --municipio bcn|lh|todos     Barcelona, L'Hospitalet o ambos (por defecto, ambos)
  --distrito <nombre>          p. ej. Eixample, "Sant Martí"
  --barrio <nombre>            p. ej. "el Raval", "la Sagrada Família", Bellvitge
  --especie <nombre>           científico, castellano o catalán; "pino" incluye todos los pinos
  --tipo calle|parque|zona     tipo de espacio (solo Barcelona)
  --categoria primera|segona|tercera|exemplar   perímetro del tronco (solo Barcelona)
  --plantado-desde AAAA[-MM[-DD]]  --plantado-hasta AAAA[-MM[-DD]]
  --cerca <lat,lng> --radio <m>
  --limite N                   cuántos resultados mostrar

  Los récords de barrios y distritos (barrio-mas-arbolado…) salen de los
  resúmenes por zona: admiten --municipio y, los de barrios, --distrito.

OTRAS OPCIONES
  --json            salida para programas y agentes
  --idioma es|ca    nombres comunes en castellano o catalán
  --sin-red         usar solo la copia guardada
  --actualizar      comprobar ahora si hay datos nuevos

EJEMPLOS
  "¿Cuál es el último árbol plantado en Gràcia?"
      arbres record mas-reciente --distrito Gràcia --json
  "¿Qué especie es la más común en L'Hospitalet?"
      arbres record especie-mas-comun --municipio lh --json
  "¿Qué barrio de Gràcia tiene más árboles por km²?"
      arbres record barrio-mas-arbolado --distrito Gràcia --por km2 --json
  "¿Qué florece en abril en el Eixample?"
      arbres record florece --mes 4 --distrito Eixample --json
  "¿Qué árboles hay cerca de la Sagrada Família?"
      arbres cerca 41.4036,2.1744 --radio 150 --json
  "¿Cuántas jacarandas se han plantado desde 2020?"
      arbres buscar --especie jacaranda --plantado-desde 2020 --json

LÍMITES DE LOS DATOS
- No hay altura: Open Data BCN dejó de publicarla. "mas-gruesos" es lo más cercano.
- La fecha de plantación falta en la mayoría de árboles de Barcelona; los récords
  de fecha solo cuentan los que la tienen y descartan fechas imposibles.
- Los datos se actualizan una vez por semana desde los portales municipales.
`;

export const guia: Command = {
  name: 'guia',
  summary: 'Qué se puede preguntar y cómo (pensado para agentes)',
  usage: 'arbres guia',
  async run() {
    return { consulta: 'guia', resultado: { guia: GUIDE }, texto: GUIDE };
  },
};
