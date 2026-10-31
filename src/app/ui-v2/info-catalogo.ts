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

import { PENDIENTE, T, V } from './info-textos/constructores';
import { INFO_OPERACION } from './info-textos/operacion';
import { INFO_ADMIN } from './info-textos/administracion';
import { INFO_LIQUIDACION } from './info-textos/liquidacion';
import { INFO_AGENTES } from './info-textos/agentes';

const PENDIENTE_FUENTE = PENDIENTE.PENDIENTE_FUENTE;

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
  // Inicio de una flota con perfil `cinco_agentes` (L11).
  'inicio.agente_liquidacion': V(
    'Liquidaciones', 'Cómo trabajó hoy el agente de Liquidación y cuántas esperan revisión.',
    'El estado sale de su última corrida registrada. La cifra cuenta las liquidaciones en estatus «revisar» del periodo de la barra de filtros.',
    'Corridas del agente y liquidaciones de tu flota; el periodo es el de la barra de filtros.',
    'Abre el agente para decidir las que esperan revisión.',
  ),
  'inicio.agente_peajes': V(
    'Peajes', 'Cómo trabajó el agente de Conciliación de peajes y cuántos cobros extemporáneos son candidatos.',
    'El estado sale de su última corrida. Para dueño y finanzas, la cifra cuenta los cruces con fecha anterior al inicio del periodo de su archivo IAVE (definición provisional); para otros roles, las tareas de la última corrida.',
    'Corridas del agente y reporte IAVE cargado; el periodo se dice en la tarjeta.',
    'Son candidatos a validar con el proveedor, no cobros indebidos.',
  ),
  'inicio.agente_carta_porte': V(
    'Carta Porte', 'Cómo trabajó el agente de Carta Porte y cuántos viajes abiertos tienen su checklist completo.',
    'Cuenta los viajes abiertos con el checklist del transportista listo y sin faltantes del cliente, contra el total de viajes abiertos.',
    'Corridas del agente y viajes abiertos de tu flota, ahora.',
  ),
  'inicio.agente_vigia': V(
    'Servicio al cliente', 'El agente que atiende a los clientes de la flota; una persona aprueba cada respuesta.',
    'Este agente no registra corridas ni tiene todavía un conteo ligero para el Inicio, así que no se muestra ninguna cifra.',
    'Su tablero propio.',
    'Abre su tablero para ver y aprobar las respuestas.',
  ),
  'inicio.agente_conductor': V(
    'Operadores', 'Cómo trabajó el agente de Comunicación con operadores y cuántos viajes escaló.',
    'El estado sale de su última corrida. La cifra cuenta los viajes abiertos con sello de escalado y sin aceptación del operador.',
    'Corridas del agente y viajes de tu flota, ahora.',
    'Abre los viajes escalados y da seguimiento.',
  ),
  'inicio.importe_iave': V(
    'Importe IAVE por decena', 'Lo facturado por casetas en la decena más reciente con archivo IAVE.',
    'Suma el importe de los cruces con fecha dentro de la decena, sin los cobros tardíos. La decena anterior cargada se muestra aparte: son periodos distintos, no una variación.',
    'Reporte IAVE que cargaste; la tarjeta dice periodo, decenas faltantes y cuándo se leyó. Solo dueño y finanzas.',
    'Si faltan decenas, el mes no está completo: cárgalas para cerrarlo.',
  ),
  'inicio.extemporaneos': V(
    'Cobros extemporáneos', 'Cruces del mismo mes con fecha anterior al inicio del periodo de su archivo IAVE.',
    'Suma cantidad e importe de esos cruces en las decenas cargadas. La definición de extemporáneo es provisional, por eso el sello es Estimado.',
    'Reporte IAVE que cargaste; la tarjeta dice periodo y cuándo se leyó. Solo dueño y finanzas.',
    'Son candidatos a validar con el proveedor, no cobros indebidos.',
  ),
  'inicio.hoy': V(
    'Hoy en tu flota', 'Lo que pide tu atención ahora, en máximo tres filas.',
    'Junta las alertas de los agentes, las liquidaciones por revisar, los viajes escalados y los viajes en curso. Lo que no tiene pendientes se marca como revisado. Carta Porte por vencer aún no se mide.',
    'Las mismas lecturas de esta página. En una flota sin actividad se muestran los primeros pasos.',
    'Abre una fila para ver el detalle y el enlace a la pantalla donde se resuelve.',
  ),
  'inicio.puesta_en_marcha': V(
    'Puesta en marcha', 'Los seis pasos para dejar a los agentes operando y quién debe resolver cada uno.',
    'Un segmento por paso crítico; un paso cuenta como listo solo si lo midió la plataforma o lo declaraste. Omitir un paso no lo cuenta como listo.',
    'Señales de tu cuenta y lo que declaraste en este navegador.',
    'Continúa con el siguiente paso que te toca.',
  ),
  'inicio.hizo_solo': V(
    'Lo que hizo solo', 'Escalamientos y recordatorios que el agente hizo sin que nadie se lo pidiera, en las últimas 24 horas.',
    'Lista los hechos más recientes (hasta cinco) que caen dentro de las últimas 24 horas.',
    'Sellos de recordatorio y de escalado guardados en cada viaje de tu flota.',
  ),
  'inicio.atajos': V(
    'Atajos', 'Accesos directos a lo que más se usa para operar.',
    'Muestra solo las pantallas que tu rol puede abrir.',
    'Permisos de tu rol.',
  ),
  // Páginas migradas (L4): un archivo por grupo, claves `<pagina>.<recuadro>`.
  ...INFO_OPERACION,
  ...INFO_ADMIN,
  ...INFO_LIQUIDACION,
  ...INFO_AGENTES,
} as const satisfies Record<string, InfoTexto>;

export type InfoClave = keyof typeof INFO;

/** Texto de una clave; falla fuerte si no existe (nunca un ⓘ vacío). */
export function infoDe(clave: InfoClave): InfoTexto {
  const t = (INFO as Record<string, InfoTexto | undefined>)[clave];
  if (!t) throw new Error(`Clave de información desconocida: ${clave}`);
  return t;
}
