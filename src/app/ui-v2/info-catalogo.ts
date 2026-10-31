// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE EXPLICACIONES (ⓘ) · un solo lugar, por clave, en español (DIRECTIVA 29-oct, punto 6).
//
// Cada recuadro, tarjeta, gráfica o tabla declara `info="clave"`; el texto NO se escribe en la página.
// Estructura única: Qué es (1 línea) · Cómo se calcula · Fuente y corte · Qué hacer con esto (opcional).
//
// REGLA DE HONESTIDAD: un texto solo afirma lo que el lector del indicador hace y está verificado. Mientras no lo esté,
// la entrada lleva `estado: 'por_confirmar'`: describe la etiqueta del recuadro sin inventar fórmula, algoritmo, regla de
// producto ni sistema de origen, y el ⓘ lo dice a la vista. Al verificar el lector, se pasa a `'verificado'` y se
// precisa «Cómo se calcula» y «Fuente y corte» con lo que de verdad hace.
// ═══════════════════════════════════════════════════════════════════════════

export interface InfoTexto {
  /** Título corto del recuadro (también nombre accesible del botón ⓘ). */
  titulo: string;
  /** `por_confirmar` = descripción provisional (se muestra la marca); `verificado` = respaldada por el lector. */
  estado: 'verificado' | 'por_confirmar';
  /** Qué es: UNA línea. */
  queEs: string;
  comoSeCalcula: string;
  /** Procedencia y corte (fuente + periodo). */
  fuente: string;
  /** Opcional: qué hacer con esta cifra. */
  queHacer?: string;
}

const PENDIENTE_CALCULO = 'Por confirmar: la fórmula exacta se documenta al verificar el lector de este indicador.';
const PENDIENTE_FUENTE = 'Por confirmar: fuente y fecha de corte de este indicador.';
const T = (titulo: string, queEs: string): InfoTexto => ({ titulo, estado: 'por_confirmar', queEs, comoSeCalcula: PENDIENTE_CALCULO, fuente: PENDIENTE_FUENTE });

/** Entrada verificada: el texto describe lo que el lector de la página hace de verdad. */
const V = (titulo: string, queEs: string, comoSeCalcula: string, fuente: string, queHacer?: string): InfoTexto => ({
  titulo, estado: 'verificado', queEs, comoSeCalcula, fuente, ...(queHacer ? { queHacer } : {}),
});

export const INFO = {
  'resumen.monto_comprobado': V(
    'Monto comprobado', 'Dinero de gastos de ruta con comprobante, en el periodo elegido.',
    'Suma del total comprobado de las liquidaciones creadas en el periodo. No cuenta las revisiones rechazadas.',
    'Liquidaciones de tu flota, con corte por la fecha de creación y el periodo de la barra de filtros.',
  ),
  'resumen.por_firmar': V(
    'Por revisar', 'Liquidaciones que el agente dejó esperando una revisión.',
    'Cuenta las liquidaciones del periodo con estatus «revisar». No cuenta las rechazadas.',
    'Liquidaciones de tu flota, periodo de la barra de filtros.',
    'Abre el agente de Liquidación y decide cada una.',
  ),
  'resumen.peajes_periodo': V(
    'Peajes del periodo', 'Gasto en casetas del periodo elegido.',
    'Suma, por semana ISO (lunes a domingo), de los gastos con concepto «caseta». Si la lectura no puede afirmarlo, muestra «—».',
    'Gastos de tu flota agrupados por semana; la semana en curso puede estar incompleta.',
  ),
  'resumen.carta_porte_completas': V(
    'Carta Porte completas', 'Viajes sin cerrar con su Carta Porte completa, junto al total de viajes abiertos.',
    'Cuenta los viajes abiertos o en cuadre cuyo checklist del transportista está listo y sin faltantes del cliente. Si hay más viajes que los leídos, no se afirma y muestra «—».',
    'Viajes abiertos y en cuadre de tu flota, al momento de abrir la página.',
  ),
  'resumen.a_tiempo': {
    titulo: 'A tiempo',
    estado: 'por_confirmar',
    queEs: 'Entregas dentro del compromiso de servicio.',
    comoSeCalcula: 'Aún sin lector verificado: mientras no lo esté, la cifra se muestra como sin dato, no como cero.',
    fuente: PENDIENTE_FUENTE,
  },
  'resumen.liquidaciones_cerradas': V(
    'Liquidaciones cerradas', 'Liquidaciones creadas en el periodo elegido.',
    'Cuenta las liquidaciones del periodo. No cuenta las revisiones rechazadas.',
    'Liquidaciones de tu flota, con corte por la fecha de creación.',
  ),
  'resumen.con_diferencias': V(
    'Con diferencias', 'Liquidaciones del periodo donde el agente encontró diferencias.',
    'Cuenta las liquidaciones del periodo con estatus «con diferencias». No cuenta las rechazadas.',
    'Liquidaciones de tu flota, periodo de la barra de filtros.',
  ),
  'resumen.requiere_atencion': V(
    'Requiere tu atención', 'Lo que espera una decisión o una mirada tuya.',
    'Junta, en este orden: el siguiente paso de la puesta en marcha, las alertas de los agentes, las liquidaciones por revisar y los viajes escalados. Lo que no tiene pendientes se marca como revisado; lo que no se pudo leer lo dice.',
    'Las mismas lecturas de esta página; la puesta en marcha usa lo que declaraste en este navegador.',
    'Abre una fila para ver el detalle y el enlace a la pantalla donde se resuelve.',
  ),
  'resumen.cierres_semana': V(
    'Liquidaciones cerradas por semana', 'Cuántas liquidaciones se crean cada semana.',
    'Cuenta por semana (lunes a domingo, día de México) las liquidaciones de las últimas ocho semanas. No cuenta las rechazadas. La última semana está incompleta y se dibuja con trama.',
    'Liquidaciones de tu flota; no depende del periodo de la barra de filtros.',
  ),
  'resumen.diferencias_recuperado': T('Diferencias vs recuperado', 'Lo que no cuadró frente a lo que ya se recuperó.'),
  'resumen.lo_que_hizo_solo': V(
    'Lo que hizo solo', 'Recordatorios y escalamientos que el agente hizo sin que nadie se lo pidiera.',
    'Lista los cinco más recientes entre los recordatorios de comprobación enviados y los viajes escalados.',
    'Sellos de recordatorio y de escalado guardados en cada viaje de tu flota.',
  ),
  'resumen.siguiente_mejor_accion': V(
    'Siguiente mejor acción', 'La acción sugerida para hoy.',
    'Regla fija, no un modelo: primero el siguiente paso de la puesta en marcha, luego una alerta urgente de un agente, después los viajes escalados y al final las liquidaciones por revisar.',
    'Las mismas lecturas de «Requiere tu atención».',
  ),
} as const satisfies Record<string, InfoTexto>;

export type InfoClave = keyof typeof INFO;

/** Texto de una clave; falla fuerte si no existe (nunca un ⓘ vacío). */
export function infoDe(clave: InfoClave): InfoTexto {
  const t = (INFO as Record<string, InfoTexto | undefined>)[clave];
  if (!t) throw new Error(`Clave de información desconocida: ${clave}`);
  return t;
}
