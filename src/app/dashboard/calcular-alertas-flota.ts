import type { Conector } from '@/lib/likida/conexiones';

// ═══════════════════════════════════════════════════════════════════════════
// ALERTAS DE LA FLOTA — el patrón de Handle que faltaba en el panel del
// cliente: "lo que requiere a un humano HOY", antes que cualquier gráfica.
//
// Handle abre su Inicio con un banner rojo ("10 credenciales de portal están
// fallando al iniciar sesión") y recién debajo el panorama. Aquí es igual, con
// dos diferencias que son nuestras:
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
}

/** Cómo se llama cada señal cuando hay que confesar que no se pudo leer. */
const ROTULO: Record<keyof Omit<SenalesFlota, 'conectores'> | 'conectores', string> = {
  porRevisar: 'liquidaciones por revisar',
  duplicados: 'comprobantes repetidos',
  huerfanos: 'comprobantes sin viaje',
  escalados: 'viajes escalados',
  conectores: 'estado de las conexiones',
};

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

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
): AlertaFlota[] {
  const alertas: AlertaFlota[] = [];

  // 0 — LO QUE NO SE PUDO LEER, ANTES QUE NADA. Va primero porque cambia el
  // significado de todo lo de abajo: con una señal caída, "sin novedades" ya
  // no quiere decir "todo en orden", quiere decir "no sé". Callarlo sería la
  // afirmación más cara que puede hacer este producto.
  const ciegas = (Object.keys(ROTULO) as Array<keyof SenalesFlota>)
    .filter((k) => s[k] === null)
    .map((k) => ROTULO[k]);
  if (ciegas.length > 0) {
    alertas.push({
      id: `ilegibles:${ciegas.slice().sort().join('-')}`,
      tipo: 'atencion',
      texto: ciegas.length === 1
        ? `No se pudo revisar ${ciegas[0]} — el dato de abajo está incompleto, no en cero.`
        : `No se pudieron revisar ${ciegas.length} señales (${ciegas.join(', ')}) — lo de abajo está incompleto, no en cero.`,
      href: '/dashboard/soporte',
    });
  }

  // 1 — El banner rojo de Handle. Un conector incompleto NO es "sin
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
        ? `${rotos[0].nombre} está a medias: ${rotos[0].falta[0] ?? 'le falta un dato'}.`
        : `${rotos.length} conexiones están a medias (${rotos.map((c) => c.nombre).join(', ')}).`,
      href: '/dashboard/conexiones',
    });
  }

  // 2 — Lo que un agente ya no pudo solo. Es la señal más cara de ignorar:
  // el viaje dejó de avanzar y nadie se enteró.
  if (s.escalados !== null && s.escalados > 0) {
    alertas.push({
      id: `escalados:${s.escalados}`,
      tipo: 'atencion',
      texto: `${s.escalados} ${plural(s.escalados, 'viaje escalado', 'viajes escalados')} — el agente dejó de avanzar y espera a una persona.`,
      href: '/dashboard/viajes',
    });
  }

  // 3 — Dinero sin viaje al cual pegarse. Va como atención porque cada
  // huérfano es un gasto que hoy NO está en ninguna liquidación.
  if (s.huerfanos !== null && s.huerfanos > 0) {
    alertas.push({
      id: `huerfanos:${s.huerfanos}`,
      tipo: 'atencion',
      texto: `${s.huerfanos} ${plural(s.huerfanos, 'comprobante llegó', 'comprobantes llegaron')} sin viaje al cual pegarse.`,
      href: '/dashboard/huerfanos',
    });
  }

  if (s.duplicados !== null && s.duplicados > 0) {
    alertas.push({
      id: `duplicados:${s.duplicados}`,
      tipo: 'atencion',
      texto: `${s.duplicados} ${plural(s.duplicados, 'comprobante repetido', 'comprobantes repetidos')} entre viajes distintos.`,
      href: '/dashboard/huerfanos',
    });
  }

  // 4 — Trabajo de oficina normal, no una urgencia. Por eso `aviso`.
  if (s.porRevisar !== null && s.porRevisar > 0) {
    alertas.push({
      id: `por-revisar:${s.porRevisar}`,
      tipo: 'aviso',
      texto: `${s.porRevisar} ${plural(s.porRevisar, 'liquidación lista', 'liquidaciones listas')} para tu revisión.`,
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
