import { diasEntre, sumarMeses } from './periodo';

// ═══════════════════════════════════════════════════════════════════════════
// EL SEGUIMIENTO DE RECLAMOS Y NOTAS DE CRÉDITO.
//
// El proveedor no atiende por teléfono: el reclamo se hace por su portal y, si
// procede, devuelve una NOTA DE CRÉDITO sin detalle. Finanzas necesita saber:
//   · qué reclamó (cuántos cruces, cuánto dinero) y cuándo;
//   · qué le acreditaron — «no sabes si fueron todos los que reclamaste»;
//   · cuánto falta: si no se reclama dentro de 3 MESES del cobro, ya no hay reclamo.
//
// El plazo de 3 meses cuenta desde la fecha del cobro MÁS ANTIGUO que incluye el
// reclamo (el lado seguro: si el reclamo mezcla cobros de varias fechas, avisa por
// el más urgente). Es una regla del cliente, dicha de palabra, aún sin confirmar por
// escrito con el proveedor: por eso es una constante configurable y el aviso lo dice.
//
// PURO: el reloj se inyecta (`hoy`), para probar con fechas simuladas.
// ═══════════════════════════════════════════════════════════════════════════

/** Meses que el proveedor da para reclamar un cobro. */
export const PLAZO_RECLAMO_MESES = 3;
/** Con esos días o menos para el vencimiento, el reclamo pendiente se marca «por vencer». */
export const DIAS_AVISO_VENCIMIENTO = 30;

export const ESTADOS_RECLAMO = ['preparado', 'enviado', 'acreditado_parcial', 'acreditado', 'rechazado'] as const;
export type EstadoReclamo = (typeof ESTADOS_RECLAMO)[number];

export const ETIQUETA_ESTADO_RECLAMO: Record<EstadoReclamo, string> = {
  preparado: 'Preparado (aún no enviado)',
  enviado: 'Enviado al proveedor',
  acreditado_parcial: 'Acreditado en parte',
  acreditado: 'Acreditado completo',
  rechazado: 'Rechazado por el proveedor',
};

export interface ReclamoSeguimiento {
  id: string;
  estado: EstadoReclamo;
  /** El cobro más antiguo que cubre el reclamo (ISO): de aquí corre el plazo. */
  fechaCobroMasAntiguo: string;
  montoReclamado: number;
  montoAcreditado: number;
}

export type AlertaReclamo = 'ok' | 'por_vencer' | 'vencido' | 'cerrado';

export interface EvaluacionReclamo {
  fechaLimite: string;
  /** Días que faltan (negativo = ya venció hace tantos días). */
  diasRestantes: number;
  alerta: AlertaReclamo;
  pendienteAcreditar: number;
  /** % acreditado del reclamado, o `null` si no se reclamó nada (no hay medición). */
  pctAcreditado: number | null;
  mensaje: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const cierra = (e: EstadoReclamo) => e === 'acreditado' || e === 'rechazado';

/**
 * Evalúa UN reclamo contra el reloj. Un reclamo que ya está acreditado o rechazado queda
 * «cerrado» y no avisa de plazo; uno «preparado» o «enviado» avisa; el que venció sin
 * enviarse se dice con todas sus letras.
 */
export function evaluarReclamo(r: ReclamoSeguimiento, hoy: string): EvaluacionReclamo {
  const fechaLimite = sumarMeses(r.fechaCobroMasAntiguo, PLAZO_RECLAMO_MESES);
  const diasRestantes = diasEntre(hoy, fechaLimite);
  const pendienteAcreditar = r2(Math.max(0, r.montoReclamado - r.montoAcreditado));
  const pctAcreditado = r.montoReclamado > 0 ? Math.round((r.montoAcreditado / r.montoReclamado) * 1000) / 10 : null;

  let alerta: AlertaReclamo;
  let mensaje: string;
  if (cierra(r.estado)) {
    alerta = 'cerrado';
    mensaje = r.estado === 'acreditado' ? 'Acreditado completo.' : 'El proveedor lo rechazó.';
  } else if (r.estado === 'preparado') {
    if (diasRestantes < 0) { alerta = 'vencido'; mensaje = `Venció el ${fechaLimite} sin enviarse: según la regla de ${PLAZO_RECLAMO_MESES} meses ya no hay reclamo (confírmalo con el proveedor).`; }
    else if (diasRestantes <= DIAS_AVISO_VENCIMIENTO) { alerta = 'por_vencer'; mensaje = `Aún no se envía y vence el ${fechaLimite} (${diasRestantes} días).`; }
    else { alerta = 'ok'; mensaje = `Aún no se envía; el plazo corre hasta el ${fechaLimite}.`; }
  } else {
    // enviado / acreditado_parcial: se espera la nota de crédito por lo que falta.
    if (diasRestantes < 0) {
      alerta = 'vencido';
      mensaje = `Se envió, pero el plazo de ${PLAZO_RECLAMO_MESES} meses corrió hasta el ${fechaLimite}. Faltan por acreditar ${pendienteAcreditar.toFixed(2)}: ya no se puede reclamar más.`;
    } else if (diasRestantes <= DIAS_AVISO_VENCIMIENTO) {
      alerta = 'por_vencer';
      mensaje = `Falta acreditar ${pendienteAcreditar.toFixed(2)}; el plazo vence el ${fechaLimite} (${diasRestantes} días).`;
    } else {
      alerta = 'ok';
      mensaje = pendienteAcreditar > 0 ? `Falta acreditar ${pendienteAcreditar.toFixed(2)}; plazo hasta el ${fechaLimite}.` : 'Sin saldo pendiente.';
    }
  }
  return { fechaLimite, diasRestantes, alerta, pendienteAcreditar, pctAcreditado, mensaje };
}

/**
 * El estado que corresponde tras registrar una nota de crédito: si lo acreditado cubre
 * lo reclamado → `acreditado`; si cubre algo → `acreditado_parcial`; si no → se conserva el estado.
 */
export function estadoTrasAcreditar(actual: EstadoReclamo, montoReclamado: number, montoAcreditado: number): EstadoReclamo {
  if (montoAcreditado <= 0) return actual;
  return montoAcreditado + 0.004 >= montoReclamado ? 'acreditado' : 'acreditado_parcial';
}

export interface ResumenSeguimiento {
  /** Todos los reclamos registrados (incluye preparados y rechazados). */
  reclamos: number;
  /** A39-peajes-01: lo que de verdad se le reclamó al proveedor (enviado / acreditado*): sin preparados ni rechazados. */
  montoReclamado: number;
  montoAcreditado: number;
  pendienteAcreditar: number;
  porVencer: number;
  vencidos: number;
  /** A39-peajes-01: reclamos solo PREPARADOS (nunca enviados) y su importe: dinero aún no exigido, rotulado aparte. */
  preparados: number;
  montoPreparado: number;
}

const centavos = (n: number) => Math.round(n * 100);

/**
 * Totales para el tablero. A39-peajes-01 (variante de A37-A2-04): «reclamado» y «por acreditar» cuentan SOLO lo enviado al
 * proveedor y aún abierto; un reclamo solo preparado se suma en `montoPreparado` y uno rechazado no es dinero pendiente.
 * Centavos enteros para que la suma no se desvíe.
 */
export function resumirSeguimiento(reclamos: readonly ReclamoSeguimiento[], hoy: string): ResumenSeguimiento {
  let rec = 0; let acr = 0; let pend = 0; let prep = 0;
  const s: ResumenSeguimiento = {
    reclamos: reclamos.length, montoReclamado: 0, montoAcreditado: 0, pendienteAcreditar: 0, porVencer: 0, vencidos: 0, preparados: 0, montoPreparado: 0,
  };
  for (const r of reclamos) {
    const e = evaluarReclamo(r, hoy);
    if (r.estado === 'preparado') { s.preparados++; prep += centavos(r.montoReclamado); }
    else if (r.estado !== 'rechazado') {
      rec += centavos(r.montoReclamado);
      acr += centavos(r.montoAcreditado);
      if (e.alerta !== 'cerrado') pend += centavos(e.pendienteAcreditar);
    }
    if (e.alerta === 'por_vencer') s.porVencer++;
    if (e.alerta === 'vencido') s.vencidos++;
  }
  s.montoReclamado = rec / 100;
  s.montoAcreditado = acr / 100;
  s.pendienteAcreditar = pend / 100;
  s.montoPreparado = prep / 100;
  return s;
}
