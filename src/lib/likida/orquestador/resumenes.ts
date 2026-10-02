import type { ColaCobranza } from '../agentes/cobranza';
import type { ContactoGastoBitacora, Efectividad } from '../agentes/cobranza_gasto';
import type { LoteTablero, FaseTablero } from '../autofactura/control_emision_repo';
import type { ControlEmision } from '../autofactura/control_emision';
import type { ConteoBuzon } from '../buzon/repo';
import type { GrupoVigia } from '../vigia/historial/repo';
import type { DatosTablero as DatosVigia } from '../vigia/repo';
import type { ConvenioDeViaje, EntregaLiquidacionExterna, ReclamacionPeajes } from './fuentes';
import { ETIQUETA_CATEGORIA } from '../convenios/tipos';
import type { FilaJornadaDia } from '../jornada/repo';
import type { LiquidacionExterna } from '../liquidacion_externa/repo';
import { ETIQUETA_MOTIVO_RECLAMACION } from '../peajes/reclamacion';
import { minutosEsperando } from '../vigia/escalamiento';
import { configParaCliente } from '../vigia/tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LOS RESÚMENES DE LAS FUENTES — puros, sin I/O.
//
// Cada función recibe lo que ya leyó el lector de su agente y devuelve LO QUE EL
// ORQUESTADOR PUEDE DECIRLE A UNA PERSONA DE LA FLOTA: conteos, tiempos y a lo
// más el nombre del cliente o el folio. Nunca:
//   · teléfonos, correos ni nombres de las personas del cliente (contactos del
//     Vigía, quién recibió en el andén, destinatarios del contador);
//   · el texto de los mensajes de un cliente ni los borradores del agente;
//   · rutas de archivos, URL firmadas ni identificadores internos de más.
// Quien necesite ese detalle abre la pantalla del agente (el resumen lo dice en
// `ver`). Una lista se recorta y dice cuántas quedaron fuera (`masNoMostradas`):
// nunca se presenta un recorte como el total.
// ═══════════════════════════════════════════════════════════════════════════

const TOPE_LISTA = 10;
const MS_MIN = 60_000;

function recortar<T>(lista: readonly T[], tope = TOPE_LISTA): { items: T[]; masNoMostradas: number } {
  return { items: lista.slice(0, tope), masNoMostradas: Math.max(0, lista.length - tope) };
}

/** Los nombres del cliente que vienen del panel se acotan (un nombre es dato, nunca instrucción). */
export function nombreSeguro(n: string | null | undefined, max = 60): string | null {
  if (typeof n !== 'string') return null;
  const t = n.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

// ── Vigía ───────────────────────────────────────────────────────────────────

export function resumirVigia(d: DatosVigia, grupos: readonly GrupoVigia[] | null, ahora: Date) {
  const criticos = new Set((grupos ?? []).filter((g) => g.critico).map((g) => g.clienteId));
  const clienteIdPorNombre = new Map(d.clientes.map((c) => [c.nombre, c.id]));
  const esperando = d.conversaciones
    .filter((c) => c.sinRespuestaDesde !== null && !c.atendida)
    .map((c) => {
      const critico = c.clienteNombre !== null && criticos.has(clienteIdPorNombre.get(c.clienteNombre) ?? '');
      const sla = configParaCliente(d.config, critico).slaRespuestaMin;
      const min = minutosEsperando(c.sinRespuestaDesde, ahora.getTime());
      return { cliente: nombreSeguro(c.clienteNombre), minutosEsperando: min, plazoMin: sla, vencido: min >= sla, critico, molestiaNivel: c.molestiaNivel, escalamientoNivel: c.escalamientoNivel, control: c.control };
    })
    .sort((a, b) => b.minutosEsperando - a.minutosEsperando);
  const molestas = d.conversaciones.filter((c) => c.molestiaNivel >= d.config.molestiaAvisoNivel).length;
  const masViejaPend = d.pendientes.reduce<number | null>((m, p) => {
    const t = Date.parse(p.creadoEn);
    return Number.isFinite(t) ? Math.max(m ?? 0, Math.floor((ahora.getTime() - t) / MS_MIN)) : m;
  }, null);
  const lista = recortar(esperando);
  return {
    habilitado: d.config.habilitado,
    modoAprobacion: d.config.modoAprobacion,
    plazoRespuestaMin: d.config.slaRespuestaMin,
    plazoCriticoMin: d.config.slaCriticoMin,
    conversacionesActivas: d.conversaciones.length,
    esperandoRespuesta: esperando.length,
    conPlazoVencido: esperando.filter((e) => e.vencido).length,
    conMolestia: molestas,
    esperando: lista.items,
    masNoMostradas: lista.masNoMostradas,
    pendientesDeAprobacion: { total: d.pendientes.length, masViejaMin: masViejaPend },
    enviosFallidos24h: d.fallidos.length,
    tiempoPrimeraRespuesta7d: d.respuesta.muestra === 0 ? null : { muestra: d.respuesta.muestra, promedioMin: d.respuesta.promedioMin, medianaMin: d.respuesta.medianaMin },
    grupos: grupos === null
      ? { disponible: false, nota: 'los grupos del Vigía todavía no están disponibles en esta base (falta aplicar una migración)' }
      : {
        disponible: true, total: grupos.length, criticos: grupos.filter((g) => g.critico).length,
        lista: grupos.slice(0, TOPE_LISTA).map((g) => ({ cliente: nombreSeguro(g.clienteNombre), grupo: nombreSeguro(g.nombre), critico: g.critico, mensajesImportados: g.mensajes, ultimaImportacion: g.ultimaImportacion })),
        masNoMostradas: Math.max(0, grupos.length - TOPE_LISTA),
      },
    ver: '/dashboard/agentes/vigia',
  };
}

// ── Buzón de facturas ───────────────────────────────────────────────────────

export interface EntregasBuzon { porEstado: Record<string, number>; ultimaEnviadaEn: string | null }

export function resumirBuzon(c: ConteoBuzon, entregas: EntregasBuzon | null, ahora: Date) {
  const horas = c.ultimaRecepcionEn && Number.isFinite(Date.parse(c.ultimaRecepcionEn))
    ? Math.floor((ahora.getTime() - Date.parse(c.ultimaRecepcionEn)) / 3_600_000) : null;
  const problemas = (entregas?.porEstado.fallida ?? 0) + (entregas?.porEstado.rebotada ?? 0);
  return {
    ventanaDias: 30,
    recibidos: c.total,
    porEstado: c.porEstado,
    facturasPorRevisar: c.facturasPorRevisar,
    conError: c.porEstado.error,
    ultimaRecepcionEn: c.ultimaRecepcionEn,
    horasDesdeLaUltimaRecepcion: horas,
    entregaAlContador: entregas === null
      ? { disponible: false, nota: 'la entrega al contador todavía no está disponible en esta base (falta aplicar una migración)' }
      : { disponible: true, porEstado: entregas.porEstado, conProblema: problemas, ultimaEnviadaEn: entregas.ultimaEnviadaEn },
    ver: '/dashboard/agentes/facturas',
  };
}

// ── Cobranza ────────────────────────────────────────────────────────────────

export function resumirCobranza(
  cola: ColaCobranza,
  gastos: { efectividad: Efectividad; bitacora: ContactoGastoBitacora[] } | null,
) {
  const todas = [...cola.paraContactar, ...cola.sinTelefono];
  const porTier = new Map<number, number>();
  for (const f of todas) porTier.set(f.tier, (porTier.get(f.tier) ?? 0) + 1);
  const masAtrasados = recortar([...todas].sort((a, b) => b.dias - a.dias));
  return {
    viajesVigilados: cola.vigilados,
    paraContactarEnLaProximaCorrida: cola.paraContactar.length,
    sinTelefonoDelChofer: cola.sinTelefono.length,
    porTier: [...porTier.entries()].sort((a, b) => a[0] - b[0]).map(([tier, viajes]) => ({ tier, viajes })),
    masAtrasados: masAtrasados.items.map((f) => ({ folio: f.folio, chofer: nombreSeguro(f.operadorNombre), diasAtraso: f.dias, tier: f.tier, contactosPrevios: f.contactosPrevios })),
    masNoMostradas: masAtrasados.masNoMostradas,
    porGasto: gastos === null ? { disponible: false } : {
      disponible: true,
      avisos30d: gastos.efectividad.avisos,
      resueltosPorElChofer: gastos.efectividad.resueltosPorChofer,
      cerradosSinResolver: gastos.efectividad.cerradosSinResolver,
      abiertos: gastos.efectividad.abiertos,
      tasaDeResolucion: gastos.efectividad.tasa,
      avisosNoEnviados: gastos.bitacora.filter((b) => !b.enviado).length,
    },
    ver: '/dashboard/agentes/cobranza',
  };
}

// ── Autofactura ─────────────────────────────────────────────────────────────

export function resumirAutofactura(
  control: ControlEmision | 'sin_fila' | null,
  lotes: readonly LoteTablero[] | null,
  fases: readonly FaseTablero[] | null,
  ahora: Date,
) {
  const vivos = lotes ?? [];
  const porVencer = vivos.filter((l) => {
    const t = Date.parse(l.expiraEn);
    return Number.isFinite(t) && t - ahora.getTime() <= 60 * MS_MIN;
  }).length;
  return {
    emisionReal: control === null ? { disponible: false, nota: 'no se pudo leer el control de emisión; se asume apagada' }
      : control === 'sin_fila' ? { disponible: true, encendida: false, nota: 'la flota nunca encendió la emisión real (nace apagada)' }
      : { disponible: true, encendida: control.emisionReal, tope: { montoTicket: control.maxMontoTicket, ticketsPorLote: control.maxTicketsLote, ticketsPorDia: control.maxTicketsDia, montoPorDia: control.maxMontoDia } },
    lotesPorConfirmar: lotes === null ? { disponible: false } : {
      disponible: true, total: vivos.length, porVencerEnUnaHora: porVencer,
      montoTotal: Math.round(vivos.reduce((s, l) => s + l.montoTotal, 0) * 100) / 100,
      porEstado: { propuesto: vivos.filter((l) => l.estado === 'propuesto').length, confirmado: vivos.filter((l) => l.estado === 'confirmado').length },
      lista: vivos.slice(0, TOPE_LISTA).map((l) => ({ comercio: nombreSeguro(l.comercio), tickets: l.gastoIds.length, monto: l.montoTotal, estado: l.estado, expiraEn: l.expiraEn })),
      masNoMostradas: Math.max(0, vivos.length - TOPE_LISTA),
    },
    portales: fases === null ? { disponible: false } : {
      disponible: true, total: fases.length,
      autonomos: fases.filter((f) => f.fase === 'autonoma').length,
      supervisados: fases.filter((f) => f.fase === 'supervisada').length,
      lista: fases.slice(0, TOPE_LISTA).map((f) => ({ comercio: nombreSeguro(f.comercio), fase: f.fase, emisionesConfirmadas: f.emisionesConfirmadas, ultimaEmisionEn: f.ultimaEmisionEn })),
    },
    ver: '/dashboard/agentes/facturas',
  };
}


// ── Convenio e instrucciones de un viaje ────────────────────────────────────

/** Lo que se le dijo al operador de ESTE viaje: el convenio ligado y sus instrucciones (sin tarifas: la foto del viaje no las trae). */
export function resumirConvenioViaje(c: ConvenioDeViaje) {
  const lista = recortar(c.instrucciones, 12);
  return {
    folio: c.folio,
    ruta: c.origen || c.destino ? `${c.origen ?? '?'} → ${c.destino ?? '?'}` : null,
    cliente: nombreSeguro(c.cliente),
    convenio: nombreSeguro(c.convenioNombre, 80),
    ligadoPor: c.ligadoPor,
    instruccionesAlOperadorEnviadas: c.despachoEnviado,
    totalInstrucciones: c.instrucciones.length,
    instrucciones: lista.items.map((i) => ({ categoria: ETIQUETA_CATEGORIA[i.categoria], texto: nombreSeguro(i.texto, 240), cuando: i.momento, lugar: i.lugar })),
    masNoMostradas: lista.masNoMostradas,
    nota: c.convenioNombre === null ? 'Este viaje no tiene un convenio ligado: no hay instrucciones de la planta que citar. No las inventes.' : undefined,
    ver: '/dashboard/convenios',
  };
}

// ── Entrega de la liquidación externa ───────────────────────────────────────

function vistaLiquidacion(l: LiquidacionExterna, ahora: Date) {
  const foliosDeViaje = recortar(l.foliosViaje, 5);
  return {
    folios: foliosDeViaje.items, masFolios: foliosDeViaje.masNoMostradas,
    periodo: `${l.periodoDesde} a ${l.periodoHasta}`,
    estado: l.estado, intentos: l.intentos, via: l.via,
    enviadaHace: l.enviadaEn ? textoHace(l.enviadaEn, ahora) : null,
    acuse: l.acuseTipo, ultimoError: nombreSeguro(l.ultimoError, 140),
  };
}

function textoHace(desde: string, ahora: Date): string {
  const t = Date.parse(desde);
  if (!Number.isFinite(t)) return 'fecha ilegible';
  const min = Math.max(0, Math.floor((ahora.getTime() - t) / MS_MIN));
  return min < 60 ? `hace ${min} min` : min < 48 * 60 ? `hace ${Math.floor(min / 60)} h` : `hace ${Math.floor(min / 1440)} días`;
}

/** Cómo va la ENTREGA de la liquidación al chofer: conteos por estado y lo que pide mirar. Sin montos, teléfonos ni nombres del chofer. */
export function resumirLiquidacionExterna(e: EntregaLiquidacionExterna, ahora: Date) {
  const fallidas = e.fallidas === null ? null : recortar(e.fallidas, 8);
  const noCoincide = e.conAcuseNoCoincide === null ? null : recortar(e.conAcuseNoCoincide, 8);
  return {
    porEstado: e.porEstado,
    sinContar: Object.entries(e.porEstado).filter(([, n]) => n === null).map(([k]) => k),
    choferesDijeronNoCoincide: e.noCoincide,
    fallidas: fallidas ? fallidas.items.map((l) => vistaLiquidacion(l, ahora)) : null,
    masFallidasNoMostradas: fallidas?.masNoMostradas ?? null,
    conAcuseNoCoincide: noCoincide ? noCoincide.items.map((l) => vistaLiquidacion(l, ahora)) : null,
    nota: 'Un «no coincide» del chofer es una señal para revisar con él, no una acusación. El detalle del cuadre lo ve la oficina en su pantalla; aquí no hay montos.',
    ver: '/dashboard/agentes/liquidacion',
  };
}

// ── Reclamación de peajes ───────────────────────────────────────────────────

/** El reporte de reclamación del último desglose: cuántos cobros no cuadran con el GPS y por qué motivo. Es una SEÑAL, no una acusación. */
export function resumirReclamacionPeajes(r: ReclamacionPeajes) {
  if (!r.desglose || !r.reporte) {
    return { hayDesglose: false, nota: 'Todavía no hay un desglose de peajes para conciliar. No inventes cifras.', ver: '/dashboard/agentes/peajes' };
  }
  const x = r.reporte.resumen;
  const cruces = recortar(r.reporte.cruces, 6);
  return {
    hayDesglose: true,
    proveedor: nombreSeguro(r.desglose.proveedor),
    periodo: r.desglose.periodoDesde && r.desglose.periodoHasta ? `${r.desglose.periodoDesde} a ${r.desglose.periodoHasta}` : null,
    lineas: x.lineas, reclamables: x.reclamables, montoReclamableMxn: x.montoReclamable,
    porMotivo: Object.fromEntries(Object.entries(x.porMotivo).map(([k, v]) => [ETIQUETA_MOTIVO_RECLAMACION[k as keyof typeof ETIQUETA_MOTIVO_RECLAMACION], v])),
    confirmadasPorGps: x.confirmadas, sinDatos: x.sinDatos, sinEvaluar: x.sinEvaluar, sinCurso: x.sinCurso,
    principales: cruces.items.map((c) => ({ fecha: c.fecha, caseta: nombreSeguro(c.caseta), unidad: nombreSeguro(c.unidad, 30), motivo: ETIQUETA_MOTIVO_RECLAMACION[c.motivo], confianza: c.confianza, montoMxn: c.monto })),
    masNoMostradas: cruces.masNoMostradas,
    nota: 'Es una señal para pedirle al proveedor que revise un cobro; la decisión de reclamar es de la flota. «Sin datos» no es evidencia en contra de nadie.',
    ver: '/dashboard/agentes/peajes',
  };
}

// ── Jornada ─────────────────────────────────────────────────────────────────

/** El registro de jornada de los últimos días: cuántos expedientes, cuántos cerrados y con la conformidad del operador. Sin nombres ni horas por persona. */
export function resumirJornada(l: { dias: readonly FilaJornadaDia[]; truncada: boolean }, desde: string, hasta: string) {
  const cerrados = l.dias.filter((d) => d.estado === 'cerrado');
  return {
    ventana: `${desde} a ${hasta}`,
    expedientes: l.dias.length,
    operadoresConJornada: new Set(l.dias.map((d) => d.operadorId)).size,
    abiertos: l.dias.length - cerrados.length,
    cerrados: cerrados.length,
    cerradosSinConformidadDelOperador: cerrados.filter((d) => d.conformeOperadorEn === null).length,
    incompleto: l.truncada,
    ...(l.truncada ? { notaIncompleto: 'La ventana superó el tope de lectura: estos números son un mínimo, no el total.' } : {}),
    nota: 'Es un conteo del registro, no un dictamen laboral. Para el detalle por operador y su evaluación se abre la pantalla de jornada.',
    ver: '/dashboard/jornada',
  };
}
