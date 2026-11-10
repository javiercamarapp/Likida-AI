// ═══════════════════════════════════════════════════════════════════════════
// «¿ESTOY LISTO?» del día de la conexión (P0-4). Función PURA: recibe lecturas ya hechas y devuelve la lista de comprobaciones.
//
// Reglas:
//   · Cada lectura que no se pudo hacer vale `null` y su comprobación dice «sin dato». Jamás se convierte en «listo» ni en «pendiente».
//   · Nunca se muestra un valor del cliente (ni URL, ni credencial, ni correo): solo estados y conteos.
//   · «Listo» exige evidencia MEDIDA. Una credencial guardada pero nunca probada no es «lista».
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoComprobacion = 'listo' | 'pendiente' | 'sin_dato';
export type ResponsableListo = 'cliente' | 'dueno' | 'likida';
export type EstadoInterruptorListo = 'encendido' | 'apagado' | 'ilegible';

export interface LecturasListo {
  credencial: { activa: boolean; probadaEn: string | null; ultimoError: string | null } | 'sin_credencial' | null;
  /** ¿hay mapeo ACTIVO del recurso `liquidaciones`? */
  mapeoLiquidaciones: boolean | null;
  operadores: { activos: number; conCorreo: number | null } | null;
  config: {
    activa: boolean; usaCorreo: boolean; remitenteCapturado: boolean; responderAEfectivo: boolean;
    revisores: number; primerMesVigente: boolean; noEnviarAntes: string | null; polizaProvisional: boolean | null;
  } | null;
  interruptores: { global: EstadoInterruptorListo | null; liquidacion: EstadoInterruptorListo | null };
  /** Vivas (no revocadas). */
  llavesApi: number | null;
  entorno: { lector: 'muestra_tms' | 'supuesto' | 'invalido'; banderaMuestra: boolean };
}

export interface Comprobacion {
  id: string;
  titulo: string;
  estado: EstadoComprobacion;
  /** Qué se midió, sin valores del cliente. */
  evidencia: string;
  responsable: ResponsableListo;
  /** Dónde se resuelve (ruta del panel) o `null` si lo hace el equipo de Likida. */
  href: string | null;
}

export const ROTULO_RESPONSABLE: Record<ResponsableListo, string> = { cliente: 'Cliente', dueno: 'Dueño de la flota', likida: 'Equipo de Likida' };
export const ROTULO_COMPROBACION: Record<EstadoComprobacion, string> = { listo: 'Listo', pendiente: 'Pendiente', sin_dato: 'Sin dato' };

const SIN_LECTURA = 'No se pudo comprobar ahora (no es que falte).';

function c(id: string, titulo: string, estado: EstadoComprobacion, evidencia: string, responsable: ResponsableListo, href: string | null): Comprobacion {
  return { id, titulo, estado, evidencia, responsable, href };
}

export function armarListo(l: LecturasListo): Comprobacion[] {
  const salida: Comprobacion[] = [];

  // 1 · credencial probada
  if (l.credencial === null) salida.push(c('credencial', 'Credencial del TMS probada', 'sin_dato', SIN_LECTURA, 'dueno', '/dashboard/conexiones'));
  else if (l.credencial === 'sin_credencial') salida.push(c('credencial', 'Credencial del TMS probada', 'pendiente', 'Aún no hay credencial capturada.', 'dueno', '/dashboard/conexiones'));
  else if (!l.credencial.activa) salida.push(c('credencial', 'Credencial del TMS probada', 'pendiente', 'La credencial está desactivada.', 'dueno', '/dashboard/conexiones'));
  else if (!l.credencial.probadaEn) salida.push(c('credencial', 'Credencial del TMS probada', 'pendiente', 'Capturada, pero nunca probada contra el sistema real.', 'dueno', '/dashboard/conexiones'));
  else if (l.credencial.ultimoError) salida.push(c('credencial', 'Credencial del TMS probada', 'pendiente', 'La última prueba o lectura falló: vuelve a probarla.', 'dueno', '/dashboard/conexiones'));
  else salida.push(c('credencial', 'Credencial del TMS probada', 'listo', 'Activa y probada sin error.', 'dueno', '/dashboard/conexiones'));

  // 2 · mapeo de liquidaciones
  salida.push(l.mapeoLiquidaciones === null
    ? c('mapeo', 'Mapeo de liquidaciones activo', 'sin_dato', SIN_LECTURA, 'likida', null)
    : l.mapeoLiquidaciones
      ? c('mapeo', 'Mapeo de liquidaciones activo', 'listo', 'Hay una versión activa del mapeo.', 'likida', null)
      : c('mapeo', 'Mapeo de liquidaciones activo', 'pendiente', 'Sin mapeo activo: el equipo de Likida lo activa con la prueba en seco aprobada.', 'likida', null));

  // 3 · lector de desgloses (entorno)
  salida.push(l.entorno.lector === 'muestra_tms'
    ? c('lector', 'Lector de desgloses configurado', 'listo', 'El contrato muestra-tms está configurado y es válido.', 'likida', null)
    : l.entorno.lector === 'invalido'
      ? c('lector', 'Lector de desgloses configurado', 'pendiente', 'La configuración del lector no es válida: no se lee nada hasta corregirla.', 'likida', null)
      : c('lector', 'Lector de desgloses configurado', 'pendiente', 'Usa el contrato supuesto: falta configurar muestra-tms (requiere un despliegue).', 'likida', null));
  salida.push(l.entorno.banderaMuestra
    ? c('bandera', 'Recepción de la muestra por API habilitada', 'listo', 'La bandera de la muestra está encendida.', 'likida', null)
    : c('bandera', 'Recepción de la muestra por API habilitada', 'pendiente', 'La bandera de la muestra está apagada (se enciende con un despliegue).', 'likida', null));

  // 4 · llave API
  salida.push(l.llavesApi === null
    ? c('llave', 'Llave de API emitida', 'sin_dato', SIN_LECTURA, 'dueno', '/dashboard/llaves-api')
    : l.llavesApi > 0
      ? c('llave', 'Llave de API emitida', 'listo', `${l.llavesApi} llave(s) vigente(s).`, 'dueno', '/dashboard/llaves-api')
      : c('llave', 'Llave de API emitida', 'pendiente', 'No hay ninguna llave vigente.', 'dueno', '/dashboard/llaves-api'));

  // 5 · operadores con correo
  if (l.operadores === null || l.operadores.conCorreo === null) salida.push(c('operadores', 'Operadores con correo', 'sin_dato', SIN_LECTURA, 'cliente', '/dashboard/operadores'));
  else if (l.operadores.activos === 0) salida.push(c('operadores', 'Operadores con correo', 'pendiente', 'Aún no hay operadores dados de alta.', 'cliente', '/dashboard/operadores'));
  else if (l.operadores.conCorreo < l.operadores.activos) {
    salida.push(c('operadores', 'Operadores con correo', 'pendiente', `${l.operadores.conCorreo} de ${l.operadores.activos} operadores activos tienen correo.`, 'cliente', '/dashboard/operadores'));
  } else salida.push(c('operadores', 'Operadores con correo', 'listo', `Los ${l.operadores.activos} operadores activos tienen correo.`, 'cliente', '/dashboard/operadores'));

  // 6 · revisor designado
  salida.push(l.config === null
    ? c('revisor', 'Revisor designado', 'sin_dato', SIN_LECTURA, 'dueno', '/dashboard/agentes/liquidacion/configuracion')
    : l.config.revisores === 0
      ? c('revisor', 'Revisor designado', 'pendiente', 'No hay revisor: nadie recibe la copia de revisión.', 'dueno', '/dashboard/agentes/liquidacion/configuracion')
      : !l.config.primerMesVigente
        ? c('revisor', 'Revisor designado', 'pendiente', 'Hay revisor, pero el periodo de revisión no está vigente.', 'dueno', '/dashboard/agentes/liquidacion/configuracion')
        : c('revisor', 'Revisor designado', 'listo', `${l.config.revisores} revisor(es) con el periodo de revisión vigente.`, 'dueno', '/dashboard/agentes/liquidacion/configuracion'));

  // 7 · remitente
  salida.push(l.config === null
    ? c('remitente', 'Remitente del correo', 'sin_dato', SIN_LECTURA, 'dueno', '/dashboard/agentes/liquidacion/configuracion')
    : l.config.remitenteCapturado && l.config.responderAEfectivo
      ? c('remitente', 'Remitente del correo', 'listo', 'Hay remitente y dirección de respuesta.', 'dueno', '/dashboard/agentes/liquidacion/configuracion')
      : c('remitente', 'Remitente del correo', 'pendiente', 'Falta el remitente o la dirección de respuesta.', 'dueno', '/dashboard/agentes/liquidacion/configuracion'));

  // 8 · fecha de corte
  salida.push(l.config === null
    ? c('corte', 'Fecha de corte', 'sin_dato', SIN_LECTURA, 'dueno', '/dashboard/agentes/liquidacion/configuracion')
    : l.config.noEnviarAntes
      ? c('corte', 'Fecha de corte', 'listo', 'Hay fecha de corte: lo anterior se guarda sin enviarse.', 'dueno', '/dashboard/agentes/liquidacion/configuracion')
      : c('corte', 'Fecha de corte', 'pendiente', 'Sin fecha de corte: el histórico saldría como correos reales.', 'dueno', '/dashboard/agentes/liquidacion/configuracion'));

  // 9 · póliza
  salida.push(l.config === null || l.config.polizaProvisional === null
    ? c('poliza', 'Póliza provisional', 'sin_dato', SIN_LECTURA, 'dueno', null)
    : l.config.polizaProvisional
      ? c('poliza', 'Póliza provisional', 'listo', 'Encendida: sin póliza se guarda marcado y espera tu revisión; nada sale solo.', 'dueno', null)
      : c('poliza', 'Póliza provisional', 'pendiente', 'Apagada: sin póliza no se guarda ni se envía nada. La muestra del cliente no trae póliza.', 'dueno', null));

  // 10 · interruptores
  const { global, liquidacion } = l.interruptores;
  if (global === null || liquidacion === null || global === 'ilegible' || liquidacion === 'ilegible') {
    salida.push(c('interruptores', 'Interruptores encendidos', 'sin_dato', SIN_LECTURA, 'likida', null));
  } else if (global === 'apagado' || liquidacion === 'apagado') {
    const cuales = [global === 'apagado' ? 'global' : null, liquidacion === 'apagado' ? 'agente de liquidación' : null].filter(Boolean).join(' y ');
    salida.push(c('interruptores', 'Interruptores encendidos', 'pendiente', `Apagado: ${cuales}. Es un freno puesto; se enciende cuando todo lo demás esté listo.`, 'likida', null));
  } else salida.push(c('interruptores', 'Interruptores encendidos', 'listo', 'El global y el del agente de liquidación están encendidos.', 'likida', null));

  // 11 · envío activo
  salida.push(l.config === null
    ? c('envio', 'Envío por correo activado', 'sin_dato', SIN_LECTURA, 'dueno', '/dashboard/agentes/liquidacion/configuracion')
    : l.config.activa && l.config.usaCorreo
      ? c('envio', 'Envío por correo activado', 'listo', 'El envío por correo está activado.', 'dueno', '/dashboard/agentes/liquidacion/configuracion')
      : c('envio', 'Envío por correo activado', 'pendiente', 'El envío está apagado o el canal no es correo. Actívalo al final, con la fecha de corte puesta.', 'dueno', '/dashboard/agentes/liquidacion/configuracion'));

  return salida;
}

export interface ResumenListo { listos: number; total: number; pendientes: number; sinDato: number; todoListo: boolean }
export function resumirListo(cs: readonly Comprobacion[]): ResumenListo {
  const listos = cs.filter((x) => x.estado === 'listo').length;
  const pendientes = cs.filter((x) => x.estado === 'pendiente').length;
  const sinDato = cs.filter((x) => x.estado === 'sin_dato').length;
  return { listos, total: cs.length, pendientes, sinDato, todoListo: listos === cs.length && cs.length > 0 };
}
