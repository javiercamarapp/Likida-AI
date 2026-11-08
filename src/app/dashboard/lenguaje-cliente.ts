// Lenguaje del cliente: nada de nombres de tabla, columna ni número de migración en una pantalla de /dashboard.
// Las cifras del módulo de agentes traen una `fuente` técnica pensada para el equipo (se conserva en los datos y en las pruebas
// de cálculo); aquí se traduce a una frase que el contralor pueda leer. Lo que no se reconoce cae a una frase genérica y
// verdadera, nunca al identificador crudo.

const FUENTES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^viaje_hito\.fuente \(/, 'registro de cada hito: quién lo capturó (sistema, botón, texto o ubicación)'],
  [/^viaje_hito\.fuente × agente_conductor_config\./, 'hitos sin intervención por las llamadas por viaje que declaraste'],
  [/^agente_conductor_config\./, 'la línea base que declaraste en Configuración'],
  [/^viaje_hito\.fuente$/, 'registro de cada hito: quién lo capturó'],
  [/^viaje_hito\.estado = escalado/, 'hitos que se escalaron por falta de respuesta'],
  [/^viaje_hito\.estado/, 'estado de cada hito del viaje'],
  [/^viaje_cruce_geocerca\./, 'hora en que el GPS detectó la llegada contra la hora en que se registró'],
  [/^viaje_senal_vida\.aviso_1_en/, 'primer aviso por falta de señal'],
  [/^viaje_senal_vida\.aviso_2_en/, 'segundo aviso por falta de señal'],
  [/^viaje_senal_vida\.escalado_en/, 'aviso al jefe por falta de señal'],
  [/^viaje_senal_vida/, 'episodios de falta de señal del vehículo'],
  [/^reubicacionesPorCliente/, 'reubicaciones registradas en la llegada a cada cliente'],
  [/^mediciones por viaje/, 'mediciones por viaje de la salida de la terminal al primer cliente'],
];

/** Identificador técnico: `snake_case` con al menos un guion bajo, o `tabla.columna` en minúsculas con guion bajo. */
const IDENTIFICADOR = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;

/** Traduce la `fuente` técnica de una cifra a una frase para el cliente. Nunca devuelve un identificador. */
export function fuenteLegible(fuente: string): string {
  for (const [patron, frase] of FUENTES) if (patron.test(fuente)) return frase;
  return IDENTIFICADOR.test(fuente) ? 'registros de la operación' : fuente;
}

export function contieneIdentificadorInterno(texto: string): boolean {
  return IDENTIFICADOR.test(texto);
}
