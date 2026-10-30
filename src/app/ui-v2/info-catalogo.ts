// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE EXPLICACIONES (ⓘ) · un solo lugar, por clave, en español (DIRECTIVA 29-oct, punto 6).
//
// Cada recuadro, tarjeta, gráfica o tabla declara `info="clave"`; el texto NO se escribe en la página.
// Estructura única: Qué es (1 línea) · Cómo se calcula · Fuente y corte · Qué hacer con esto (opcional).
// Regla del producto: ninguna explicación inventa una cifra ni promete lo que el lector no verificó;
// lo que no se sabe se dice («aún sin lector verificado»).
// ═══════════════════════════════════════════════════════════════════════════

export interface InfoTexto {
  /** Título corto del recuadro (también nombre accesible del botón ⓘ). */
  titulo: string;
  /** Qué es: UNA línea. */
  queEs: string;
  comoSeCalcula: string;
  /** Procedencia y corte (fuente + periodo). */
  fuente: string;
  /** Opcional: qué hacer con esta cifra. */
  queHacer?: string;
}

const T = (t: InfoTexto): InfoTexto => t;

export const INFO = {
  'resumen.monto_comprobado': T({
    titulo: 'Monto comprobado',
    queEs: 'Dinero de gastos de ruta que ya tiene comprobante.',
    comoSeCalcula: 'Suma de los gastos de los viajes del periodo que cuadran contra su comprobante y su política.',
    fuente: 'Sistema de transporte y comprobantes recibidos; corte al último archivo leído.',
    queHacer: 'Si baja contra el periodo anterior, revisa los viajes con diferencias.',
  }),
  'resumen.por_firmar': T({
    titulo: 'Por firmar',
    queEs: 'Liquidaciones listas que esperan tu firma.',
    comoSeCalcula: 'Conteo y monto de liquidaciones cuadradas que todavía no se firman.',
    fuente: 'Liquidaciones del periodo; se actualiza con cada cierre.',
    queHacer: 'Revísalas una por una: nunca se firma en lote.',
  }),
  'resumen.peajes_periodo': T({
    titulo: 'Peajes del periodo',
    queEs: 'Gasto en casetas de los viajes del periodo.',
    comoSeCalcula: 'Suma de cruces de caseta conciliados contra los viajes; los no conciliados no se suman.',
    fuente: 'Importación de casetas; corte a la última semana cargada.',
  }),
  'resumen.carta_porte_completas': T({
    titulo: 'Carta Porte completas',
    queEs: 'Documentos de Carta Porte sin faltantes, de los que se esperan.',
    comoSeCalcula: 'Se cuentan los documentos completos y se muestran junto al total esperado («n de N»).',
    fuente: 'Documentos de clientes y viajes del periodo; corte de hoy.',
    queHacer: 'Abre los incompletos para ver qué dato falta.',
  }),
  'resumen.a_tiempo': T({
    titulo: 'A tiempo',
    queEs: 'Entregas dentro del compromiso de servicio.',
    comoSeCalcula: 'Entregas a tiempo entre entregas con fecha de compromiso y de llegada.',
    fuente: 'Aún sin lector verificado: mientras no lo esté, la cifra se muestra como sin dato, no como cero.',
  }),
  'resumen.requiere_atencion': T({
    titulo: 'Requiere tu atención',
    queEs: 'Lo que espera una decisión tuya, ordenado por urgencia.',
    comoSeCalcula: 'Los avisos abiertos de los agentes, con el punto de color según quién debe actuar.',
    fuente: 'Avisos de los agentes; se actualizan al cerrar cada corrida.',
    queHacer: 'Atiende primero los de punto burdeos: son acciones tuyas.',
  }),
  'resumen.cierres_semana': T({
    titulo: 'Liquidaciones cerradas por semana',
    queEs: 'Cuántas liquidaciones se cierran cada semana.',
    comoSeCalcula: 'Conteo por semana natural; una semana sin dato queda como hueco, no como cero.',
    fuente: 'Liquidaciones cerradas; la última semana puede estar incompleta.',
  }),
  'resumen.diferencias_recuperado': T({
    titulo: 'Diferencias vs recuperado',
    queEs: 'Lo que no cuadró frente a lo que ya se recuperó.',
    comoSeCalcula: 'Diferencia detectada entre anticipo y comprobantes, junto al monto ya aclarado.',
    fuente: 'Cuadre de liquidaciones; son candidatos a revisión, no acusaciones.',
    queHacer: 'Habla con el operador antes de actuar sobre una diferencia.',
  }),
  'resumen.lo_que_hizo_solo': T({
    titulo: 'Lo que hizo solo',
    queEs: 'Tareas que los agentes resolvieron sin intervención.',
    comoSeCalcula: 'Conteo de acciones automáticas completadas en el periodo.',
    fuente: 'Bitácora de los agentes; corte de hoy.',
  }),
  'resumen.siguiente_mejor_accion': T({
    titulo: 'Siguiente mejor acción',
    queEs: 'La acción con más efecto que hoy puedes tomar.',
    comoSeCalcula: 'Se elige entre los avisos abiertos el de mayor monto o riesgo.',
    fuente: 'Avisos abiertos de los agentes.',
    queHacer: 'Ábrela y confirma; nada se ejecuta sin tu confirmación.',
  }),
} as const satisfies Record<string, InfoTexto>;

export type InfoClave = keyof typeof INFO;

/** Texto de una clave; falla fuerte si no existe (nunca un ⓘ vacío). */
export function infoDe(clave: InfoClave): InfoTexto {
  const t = (INFO as Record<string, InfoTexto | undefined>)[clave];
  if (!t) throw new Error(`Clave de información desconocida: ${clave}`);
  return t;
}
