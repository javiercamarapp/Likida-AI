import type { Conector } from '@/lib/likida/conexiones';
import { trDashboardAEs } from '@/lib/i18n/tr_dashboard_a';
import type { TrDe } from '@/lib/i18n/tr_tipos';

// ═══════════════════════════════════════════════════════════════════════════
// ALERTAS DE LA FLOTA — el patrón que faltaba en el panel del
// cliente: "lo que requiere a un humano HOY", antes que cualquier gráfica.
//
// El Inicio abre con un banner rojo ("10 credenciales de portal están
// fallando al iniciar sesión") y recién debajo el panorama, con
// dos decisiones propias:
//
//  1. **Cada alerta lleva a SU pantalla.** Una alerta que no se puede resolver
//     de un clic es un regaño, no una alerta. Por eso `href` no es opcional en
//     la práctica: si una señal no tiene pantalla donde resolverse, no se
//     inventa el renglón.
//  2. **Ninguna se calcula de un contador inventado.** Todas salen de una
//     consulta real; cuando no hay condición, la lista va vacía y la pantalla
//     dice "Sin novedades" en vez de rellenar con adorno.
//
// Vive en su propio archivo (no dentro de la página) para que el Server
// Component de la página, la campana (client) y el Inicio usen EXACTAMENTE el
// mismo cálculo — la lección de `admin/calcular-alertas.ts`: dos cálculos
// paralelos divergen y la campana termina diciendo un número que la página
// desmiente.
// ═══════════════════════════════════════════════════════════════════════════

export interface AlertaFlota {
  /** Estable entre corridas — es la llave con la que se marca leída.
   *  Lleva el conteo adentro a propósito: si el número cambia, la alerta
   *  vuelve a contar como nueva (3 huérfanos resueltos y 2 nuevos no es
   *  "ya la vi"). */
  id: string;
  /** `atencion` pinta en rojo y va primero; `aviso` es trabajo normal. */
  tipo: 'atencion' | 'aviso';
  texto: string;
  /** La pantalla donde SE RESUELVE. Nunca el Inicio. */
  href: string;
}

/**
 * Los conteos ya medidos.
 *
 * `null` NO es cero: es "no se pudo leer". `contarEscalados`,
 * `contarHuerfanosPendientes` y compañía devuelven `null` cuando la consulta
 * falla, y aplastar eso a 0 haría que la campana dijera "todo en orden"
 * estando ciega — el modo de falla que el CLAUDE.md llama por su nombre. Aquí
 * un `null` produce su propia alerta, la más honesta de todas: "no pude
 * revisar esto".
 */
export interface SenalesFlota {
  /** Liquidaciones cerradas esperando revisión humana. */
  porRevisar: number | null;
  /** Comprobantes repetidos entre viajes distintos. */
  duplicados: number | null;
  /** Comprobantes que llegaron sin viaje al cual pegarse. */
  huerfanos: number | null;
  /** Viajes que el agente ya escaló porque dejó de avanzar solo. */
  escalados: number | null;
  /** El chasis: conectores con su estado medido. */
  conectores: Conector[] | null;
  /**
   * Tareas que el asistente del panel dejó para una persona y siguen abiertas (orquestador, 0650), ya filtradas por lo que ESTE rol puede
   * leer (una tarea de dinero no la cuenta quien no ve dinero). Opcional: quien no la lee no la manda y la alerta simplemente no existe;
   * `null` sí es «no se pudo leer».
   */
  tareasAsistente?: number | null;
  /** Viajes con excepciones del Conductor (sin señal de vida, llegada sin confirmar, estadía excedida, escalados…). Mismo criterio que `tareasAsistente`. */
  excepcionesConductor?: number | null;
  /** De los anteriores, cuántos están sin señal de vida (sube la urgencia del texto). */
  sinSenalDeVida?: number | null;
}

/** Cómo se llama cada señal cuando hay que confesar que no se pudo leer. El español es la llave estable de `id` (no se traduce);
 *  el rótulo que se lee en pantalla sale del diccionario (`cal.rot.<señal>`). */
const ROTULO: Record<keyof Omit<SenalesFlota, 'sinSenalDeVida'>, string> = {
  tareasAsistente: 'tareas del asistente',
  excepcionesConductor: 'excepciones de viajes en vivo',
  porRevisar: 'liquidaciones por revisar',
  duplicados: 'comprobantes repetidos',
  huerfanos: 'comprobantes sin viaje',
  escalados: 'viajes escalados',
  conectores: 'estado de las conexiones',
};


/**
 * El orden NO es cosmético: es el orden en que un contralor debe atacarlas.
 * Primero lo que tiene al sistema ciego (conectores), luego lo que ya se le
 * escapó a un agente (escalados), luego el dinero sin dueño (huérfanos), y al
 * final el trabajo de revisión normal.
 *
 * @param sufijo El `?tenant=` del superadmin viendo como flota. Sin él, los
 *   links de las alertas lo sacan de la flota que está mirando.
 * @param puedeVer Gate por rol. Una alerta cuyo destino el rol NO puede abrir
 *   es un callejón sin salida: el encargado vería "2 comprobantes sin viaje",
 *   haría clic, y `/dashboard/huerfanos` (área dinero) lo rebotaría al Inicio.
 *   Peor todavía: el conteo mismo es información del área que no le toca. Por
 *   eso se filtra la alerta entera, no solo el link. Sin predicado se enseña
 *   todo — el default sirve al dueño, que ve las tres áreas.
 */
export function calcularAlertasFlota(
  s: SenalesFlota,
  sufijo = '',
  puedeVer: (href: string) => boolean = () => true,
  t: TrDe<'dashboard_a'> = trDashboardAEs,
): AlertaFlota[] {
  const alertas: AlertaFlota[] = [];

  // 0 — LO QUE NO SE PUDO LEER, ANTES QUE NADA. Va primero porque cambia el
  // significado de todo lo de abajo: con una señal caída, "sin novedades" ya
  // no quiere decir "todo en orden", quiere decir "no sé". Callarlo sería la
  // afirmación más cara que puede hacer este producto.
  const ciegasK = (Object.keys(ROTULO) as Array<keyof typeof ROTULO>)
    .filter((k) => s[k] === null);
  const ciegas = ciegasK.map((k) => ROTULO[k]);
  const ciegasTxt = ciegasK.map((k) => t(`cal.rot.${k}` as const));
  if (ciegas.length > 0) {
    alertas.push({
      id: `ilegibles:${ciegas.slice().sort().join('-')}`,
      tipo: 'atencion',
      texto: ciegas.length === 1
        ? t('cal.ciega.una', { que: ciegasTxt[0] })
        : t('cal.ciega.varias', { n: ciegas.length, lista: ciegasTxt.join(', ') }),
      href: '/dashboard/soporte',
    });
  }

  // 1 — El banner rojo. Un conector incompleto NO es "sin
  // configurar": incompleto significa que alguien lo empezó y se quedó a
  // medias, y eso sí es trabajo pendiente de una persona. `sin_configurar`
  // se queda fuera a propósito — una flota que nunca conectó rastreo no
  // tiene un problema, tiene una decisión.
  const rotos = (s.conectores ?? []).filter((c) => c.estado === 'incompleto');
  if (rotos.length > 0) {
    alertas.push({
      id: `conectores:${rotos.map((c) => c.id).sort().join('-')}`,
      tipo: 'atencion',
      texto: rotos.length === 1
        ? t('cal.conector.una', { nombre: rotos[0].nombre, falta: rotos[0].falta[0] ?? t('cal.leFaltaDato') })
        : t('cal.conector.varias', { n: rotos.length, lista: rotos.map((c) => c.nombre).join(', ') }),
      href: '/dashboard/conexiones',
    });
  }

  // 1b — Lo que el asistente derivó a una persona y el Conductor marcó como excepción (P6, orquestador vivo): las dos entran a las
  // notificaciones del panel además del tablero. Llevan al tablero de viajes en vivo, que es donde se atienden.
  if (s.tareasAsistente != null && s.tareasAsistente > 0) {
    alertas.push({
      id: `tareas-asistente:${s.tareasAsistente}`,
      tipo: 'atencion',
      texto: t(s.tareasAsistente === 1 ? 'cal.tareas.uno' : 'cal.tareas.otros', { n: s.tareasAsistente }),
      href: '/dashboard/viajes-en-vivo',
    });
  }
  if (s.excepcionesConductor != null && s.excepcionesConductor > 0) {
    const sinSenal = s.sinSenalDeVida != null && s.sinSenalDeVida > 0 ? s.sinSenalDeVida : 0;
    alertas.push({
      id: `excepciones-conductor:${s.excepcionesConductor}:${s.sinSenalDeVida ?? 0}`,
      tipo: s.sinSenalDeVida != null && s.sinSenalDeVida > 0 ? 'atencion' : 'aviso',
      texto: sinSenal > 0
        ? t(s.excepcionesConductor === 1 ? 'cal.excSin.uno' : 'cal.excSin.otros', { n: s.excepcionesConductor, sin: sinSenal })
        : t(s.excepcionesConductor === 1 ? 'cal.exc.uno' : 'cal.exc.otros', { n: s.excepcionesConductor }),
      href: '/dashboard/viajes-en-vivo',
    });
  }

  // 2 — Lo que un agente ya no pudo solo. Es la señal más cara de ignorar:
  // el viaje dejó de avanzar y nadie se enteró.
  if (s.escalados !== null && s.escalados > 0) {
    alertas.push({
      id: `escalados:${s.escalados}`,
      tipo: 'atencion',
      texto: t(s.escalados === 1 ? 'cal.escalados.uno' : 'cal.escalados.otros', { n: s.escalados }),
      href: '/dashboard/viajes',
    });
  }

  // 3 — Dinero sin viaje al cual pegarse. Va como atención porque cada
  // huérfano es un gasto que hoy NO está en ninguna liquidación.
  if (s.huerfanos !== null && s.huerfanos > 0) {
    alertas.push({
      id: `huerfanos:${s.huerfanos}`,
      tipo: 'atencion',
      texto: t(s.huerfanos === 1 ? 'cal.huerf.uno' : 'cal.huerf.otros', { n: s.huerfanos }),
      href: '/dashboard/huerfanos',
    });
  }

  if (s.duplicados !== null && s.duplicados > 0) {
    alertas.push({
      id: `duplicados:${s.duplicados}`,
      tipo: 'atencion',
      texto: t(s.duplicados === 1 ? 'cal.dup.uno' : 'cal.dup.otros', { n: s.duplicados }),
      href: '/dashboard/huerfanos',
    });
  }

  // 4 — Trabajo de oficina normal, no una urgencia. Por eso `aviso`.
  if (s.porRevisar !== null && s.porRevisar > 0) {
    alertas.push({
      id: `por-revisar:${s.porRevisar}`,
      tipo: 'aviso',
      texto: t(s.porRevisar === 1 ? 'cal.rev.uno' : 'cal.rev.otros', { n: s.porRevisar }),
      href: '/dashboard/viajes',
    });
  }

  // El gate por rol va al FINAL y sobre la ruta base: filtrar antes obligaría
  // a repetir el predicado en cada rama, y pegar el sufijo antes obligaría al
  // llamador a conocer el `?tenant=` para responder si puede ver la ruta.
  return alertas
    .filter((a) => puedeVer(a.href))
    .map((a) => ({ ...a, href: `${a.href}${sufijo}` }));
}

/** Cuántas piden a un humano YA — el número del globito de la campana.
 *  Los `aviso` no cuentan: un globito que nunca llega a cero enseña a
 *  ignorarlo. */
export function cuentaQuePide(alertas: AlertaFlota[]): number {
  return alertas.filter((a) => a.tipo === 'atencion').length;
}
