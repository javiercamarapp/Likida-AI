// ═══════════════════════════════════════════════════════════════════════════
// GENERADOR DE ESCALA (T-A2-32): un estado de cuenta sintético de decenas de miles de filas, EN MEMORIA
// (nunca se escribe a disco). Reutiliza la forma del generador existente (`generar_desglose_iave.ts`:
// cabeceras con espacios, serial de Excel, hora en fracción, columnas sin cabecera, hoja secundaria) y
// añade lo que la carga a 60 000 líneas necesita: el rango de fechas se ensancha para repartir los cruces
// en varios periodos (dos meses ≈ 60 mil) sin cambiar la forma de la fila. Ningún dato es real.
// ═══════════════════════════════════════════════════════════════════════════
import { generarFilasIave, generarLibroIave, type EsperadoFixtureIave, type OpcionesFixtureIave } from './generar_desglose_iave';

export type { EsperadoFixtureIave };

/** Matriz de filas (cabecera + `filas` cruces), lista para `parsearDesgloseHoja`. */
export function generarFilasEscala(filas: number, op: OpcionesFixtureIave = {}) {
  return generarFilasIave({ hojaSecundaria: false, extemporaneos: 0, ...op, filas });
}

/** El libro xlsx completo en un Buffer (sigue en memoria), para `importarDesglose`. */
export function generarLibroEscala(filas: number, op: OpcionesFixtureIave = {}) {
  return generarLibroIave({ hojaSecundaria: false, extemporaneos: 0, ...op, filas });
}
