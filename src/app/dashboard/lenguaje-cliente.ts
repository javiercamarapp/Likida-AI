// Lenguaje del cliente: nada de nombres de tabla, columna ni número de migración en una pantalla de /dashboard.
// Las cifras del módulo de agentes traen una `fuente` técnica pensada para el equipo (se conserva en los datos y en las pruebas
// de cálculo); aquí se traduce a una frase que el contralor pueda leer. Lo que no se reconoce cae a una frase genérica y
// verdadera, nunca al identificador crudo. Las frases salen del diccionario `dashboard_a` (`len.*`): sin traductor hablan español.

import { trDashboardAEs } from '@/lib/i18n/tr_dashboard_a';
import type { TrDe } from '@/lib/i18n/tr_tipos';

type ClaveFuente = Parameters<TrDe<'dashboard_a'>>[0];

const FUENTES: ReadonlyArray<readonly [RegExp, ClaveFuente]> = [
  [/^viaje_hito\.fuente \(/, 'len.hitoQuien'],
  [/^viaje_hito\.fuente × agente_conductor_config\./, 'len.hitoSinIntervencion'],
  [/^agente_conductor_config\./, 'len.lineaBase'],
  [/^viaje_hito\.fuente$/, 'len.hitoQuienCorto'],
  [/^viaje_hito\.estado = escalado/, 'len.hitoEscalado'],
  [/^viaje_hito\.estado/, 'len.hitoEstado'],
  [/^viaje_cruce_geocerca\./, 'len.geocerca'],
  [/^viaje_senal_vida\.aviso_1_en/, 'len.aviso1'],
  [/^viaje_senal_vida\.aviso_2_en/, 'len.aviso2'],
  [/^viaje_senal_vida\.escalado_en/, 'len.avisoJefe'],
  [/^viaje_senal_vida/, 'len.senal'],
  [/^reubicacionesPorCliente/, 'len.reubicaciones'],
  [/^mediciones por viaje/, 'len.mediciones'],
];

/** Identificador técnico: `snake_case` con al menos un guion bajo, o `tabla.columna` en minúsculas con guion bajo. */
// eslint-disable-next-line security/detect-unsafe-regex -- se aplica a textos cortos de la propia aplicación (nombres de fuente), sin entrada del usuario.
const IDENTIFICADOR = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;

/** Traduce la `fuente` técnica de una cifra a una frase para el cliente. Nunca devuelve un identificador. */
export function fuenteLegible(fuente: string, t: TrDe<'dashboard_a'> = trDashboardAEs): string {
  for (const [patron, clave] of FUENTES) if (patron.test(fuente)) return t(clave);
  return IDENTIFICADOR.test(fuente) ? t('len.generico') : fuente;
}

export function contieneIdentificadorInterno(texto: string): boolean {
  return IDENTIFICADOR.test(texto);
}
