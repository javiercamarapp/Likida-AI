// ═══════════════════════════════════════════════════════════════════════════
// SALIDA — del documento aprobado al viaje en el formato interno de Likida.
//
// Crea (o completa) el viaje y sus renglones de `viaje_mercancia`, y evalúa el
// borrador del complemento Carta Porte 3.1 con el checklist y los validadores SAT
// que YA existen (`getBorradorViaje` → `armarBorrador` → `validarComplemento`).
//
// ESTE MÓDULO NO TIMBRA y no importa nada del camino del timbre (PAC, CFDI,
// `carta_porte_timbre`): una prueba lo vigila leyendo los imports. Un documento
// de un cliente, aunque lo apruebe un humano, produce un BORRADOR; emitir el
// complemento sigue siendo el acto separado y supervisado de siempre.
//
// ── LO QUE SE RESPETA DEL VIAJE EXISTENTE ───────────────────────────────────
//   · Si ya hay un viaje con ese folio, SOLO se llenan sus huecos (columnas
//     nulas): lo que el despachador capturó no se pisa, y lo que difiere se
//     reporta como advertencia.
//   · Los renglones de mercancía que se reemplazan son los que NACIERON de este
//     mismo documento; los capturados a mano no se tocan.
//   · Un viaje nuevo exige operador (`viaje.operador_id` es NOT NULL desde la
//     0001) y un operador solo puede tener UN viaje abierto (0029). Si el
//     documento no permite resolverlo sin adivinar, la salida se detiene y dice
//     qué falta: nunca se asigna «el que más se parezca».
//   · NO se avisa al chofer: esto no es despacho (importar_viajes.ts hace lo mismo).
// ═══════════════════════════════════════════════════════════════════════════

import { llaveTexto } from './catalogos';
import { normalizarNumero } from './normalizar';
import type { Extraccion } from './campos';
import { DatoInvalido } from '../errores';
import { getBorradorViaje, validarMercancia } from '../carta_porte_datos';
import { anotarBitacora } from '../bitacora_escritura';
import * as repo from './repo';
import type { DocumentoFila, MercanciaInsertar, OperadorMin } from './repo';

const valorDe = (e: Extraccion, k: string): string | null => {
  const v = e.campos[k]?.valor;
  return v === undefined || v === null || v === '' ? null : v;
};

export interface PlanViaje {
  folio: string;
  origen: string | null;
  destino: string | null;
  /** AAAA-MM-DD (la columna `viaje.fecha_inicio` es `date`). */
  fechaInicio: string | null;
  kmRecorridos: number | null;
  operadorNombre: string | null;
  placas: string | null;
  ccp: { origenCp: string | null; destinoCp: string | null; origenEstado: string | null; destinoEstado: string | null; rfcDestinatario: string | null; transpInternac: boolean | null };
  mercancias: MercanciaInsertar[];
  advertencias: string[];
}

const compone = (nombre: string | null, domicilio: string | null, cp: string | null, estado: string | null): string | null => {
  const partes = [domicilio ?? nombre, cp ? `CP ${cp}` : null, estado].filter((x): x is string => !!x);
  return partes.length > 0 ? partes.join(' · ').slice(0, 300) : null;
};

/** El folio del viaje: el del cliente, o uno derivado del documento (estable: el mismo documento da el mismo folio). */
export function folioDelViaje(doc: Pick<DocumentoFila, 'id' | 'sha256'>, e: Extraccion): string {
  const f = valorDe(e, 'folio_cliente');
  return (f ?? `CP-${doc.sha256.slice(0, 10).toUpperCase()}`).slice(0, 40);
}

export type ResultadoPlan = { ok: true; plan: PlanViaje } | { ok: false; errores: string[] };

/** Valida y convierte la extracción aprobada al formato del viaje. Usa las MISMAS reglas que la captura manual. */
export function planDeViaje(doc: Pick<DocumentoFila, 'id' | 'sha256'>, e: Extraccion): ResultadoPlan {
  const errores: string[] = [];
  const advertencias: string[] = [];
  const mercancias: MercanciaInsertar[] = [];
  e.mercancias.forEach((f, i) => {
    try {
      const sx = (k: string): string => f[k]?.valor ?? '';
      const peligroso = sx('material_peligroso');
      const m = validarMercancia({
        descripcion: sx('descripcion'), bienesTransp: sx('bienes_transp'), cantidad: sx('cantidad'), claveUnidad: sx('clave_unidad'),
        pesoKg: sx('peso_kg'), materialPeligroso: peligroso === 'true' ? 'si' : peligroso === 'false' ? 'no' : '',
      });
      mercancias.push(m);
    } catch (err) {
      errores.push(`Mercancía ${i + 1}: ${err instanceof DatoInvalido ? err.message : 'no se pudo convertir'}`);
    }
  });
  if (mercancias.length === 0 && errores.length === 0) errores.push('El documento no trae ninguna mercancía.');

  const fecha = valorDe(e, 'fecha_salida');
  const km = normalizarNumero(valorDe(e, 'distancia_km') ?? '').valor;
  const intl = valorDe(e, 'transp_internac');
  const origenEstado = valorDe(e, 'origen_estado'); const destinoEstado = valorDe(e, 'destino_estado');
  if (errores.length > 0) return { ok: false, errores };
  return {
    ok: true,
    plan: {
      folio: folioDelViaje(doc, e),
      origen: compone(valorDe(e, 'origen_nombre'), valorDe(e, 'origen_domicilio'), valorDe(e, 'origen_cp'), origenEstado),
      destino: compone(valorDe(e, 'destino_nombre'), valorDe(e, 'destino_domicilio'), valorDe(e, 'destino_cp'), destinoEstado),
      fechaInicio: fecha ? fecha.slice(0, 10) : null,
      kmRecorridos: km !== null && km > 0 && km < 100_000 ? Math.round(km) : null,
      operadorNombre: valorDe(e, 'operador_nombre'),
      placas: valorDe(e, 'unidad_placas'),
      ccp: {
        origenCp: valorDe(e, 'origen_cp'), destinoCp: valorDe(e, 'destino_cp'), origenEstado, destinoEstado,
        rfcDestinatario: valorDe(e, 'destino_rfc'),
        // Nunca «nacional» por defecto: solo lo que el documento (o un humano) dijo.
        transpInternac: intl === 'true' ? true : intl === 'false' ? false : null,
      },
      mercancias,
      advertencias,
    },
  };
}

/** El operador cuyo nombre coincide EXACTO (sin acentos ni mayúsculas) y es único entre los activos. */
export function operadorPorNombre(operadores: OperadorMin[], nombre: string | null): OperadorMin | null {
  if (!nombre) return null;
  const k = llaveTexto(nombre);
  const hits = operadores.filter((o) => o.activo && llaveTexto(o.nombre) === k);
  return hits.length === 1 ? hits[0] : null;
}

export type MotivoSinViaje = 'falta_operador' | 'operador_ocupado' | 'operador_invalido' | 'datos_invalidos' | 'carrera';

export interface BorradorCcp {
  armado: boolean;
  faltantes: string[];
  advertencias: string[];
  fallas: Array<{ campo: string; detalle: string }>;
  transportistaListo: boolean;
  faltanCliente: number;
  faltanTransportista: number;
}

export type ResultadoSalida =
  | {
    ok: true; accion: 'creado' | 'actualizado'; viajeId: string; folio: string; mercancias: number;
    columnasCompletadas: number; advertencias: string[]; borrador: BorradorCcp | null;
  }
  | { ok: false; motivo: MotivoSinViaje; mensaje: string; folio?: string; errores?: string[] };

async function evaluarBorrador(tenantId: string, viajeId: string): Promise<BorradorCcp | null> {
  try {
    const v = await getBorradorViaje(tenantId, viajeId);
    if (!v) return null;
    return {
      armado: v.borrador.borrador !== null,
      faltantes: v.borrador.faltantes,
      advertencias: v.borrador.advertencias,
      fallas: v.borrador.fallas.map((f) => ({ campo: f.campo, detalle: f.detalle })),
      transportistaListo: v.checklist.transportistaListo,
      faltanCliente: v.checklist.faltanCliente,
      faltanTransportista: v.checklist.faltanTransportista,
    };
  } catch {
    // El borrador es informativo: si no se pudo evaluar, la salida del viaje ya ocurrió y se dice «sin evaluar».
    return null;
  }
}

/**
 * Crea o completa el viaje del documento APROBADO. Idempotente: aplicarla dos veces deja el mismo
 * viaje y los mismos renglones (los del documento se reemplazan, no se acumulan).
 */
export async function aplicarSalidaViaje(
  tenantId: string, doc: DocumentoFila, opciones: { operadorId?: string | null; actor?: { id?: string; email?: string } } = {},
): Promise<ResultadoSalida> {
  if (doc.estado !== 'aprobado' || !doc.extraccion) {
    return { ok: false, motivo: 'datos_invalidos', mensaje: 'Solo se puede crear el viaje de un documento aprobado.' };
  }
  const p = planDeViaje(doc, doc.extraccion);
  if (!p.ok) return { ok: false, motivo: 'datos_invalidos', mensaje: p.errores.join(' '), errores: p.errores };
  const plan = p.plan;
  const advertencias = [...plan.advertencias];

  let unidadId: string | null = null;
  if (plan.placas) {
    const hits = await repo.unidadesPorPlacas(tenantId, plan.placas);
    if (hits.length === 1 && hits[0].activo) unidadId = hits[0].id;
    else advertencias.push(hits.length === 0 ? `No hay una unidad con placas ${plan.placas}: el viaje queda sin unidad.` : `Las placas ${plan.placas} no identifican una sola unidad activa: el viaje queda sin unidad.`);
  }
  if (doc.clienteId && !(await repo.clientePropio(tenantId, doc.clienteId))) {
    return { ok: false, motivo: 'datos_invalidos', mensaje: 'El cliente del documento ya no pertenece a esta flota.' };
  }

  const completar = async (viajeId: string): Promise<ResultadoSalida> => {
    const existente = await repo.viajePorId(tenantId, viajeId);
    if (!existente) return { ok: false, motivo: 'carrera', mensaje: 'El viaje desapareció mientras se completaba. Vuelve a intentarlo.' };
    const huecos: Record<string, unknown> = {};
    const poner = (col: string, actual: unknown, nuevo: unknown, rotulo: string): void => {
      if (nuevo === null || nuevo === undefined) return;
      if (actual === null || actual === undefined) huecos[col] = nuevo;
      else if (String(actual) !== String(nuevo)) advertencias.push(`El viaje ya tenía ${rotulo} «${String(actual)}» y el documento dice «${String(nuevo)}»: no se cambió.`);
    };
    poner('origen', existente.origen, plan.origen, 'el origen');
    poner('destino', existente.destino, plan.destino, 'el destino');
    poner('fecha_inicio', existente.fechaInicio, plan.fechaInicio, 'la fecha de salida');
    poner('km_recorridos', existente.kmRecorridos, plan.kmRecorridos, 'los km');
    poner('unidad_id', existente.unidadId, unidadId, 'la unidad');
    poner('cliente_id', existente.clienteId, doc.clienteId, 'el cliente');
    poner('ccp_origen_cp', existente.ccpOrigenCp, plan.ccp.origenCp, 'el CP de origen');
    poner('ccp_destino_cp', existente.ccpDestinoCp, plan.ccp.destinoCp, 'el CP de destino');
    poner('ccp_origen_estado', existente.ccpOrigenEstado, plan.ccp.origenEstado, 'el estado de origen');
    poner('ccp_destino_estado', existente.ccpDestinoEstado, plan.ccp.destinoEstado, 'el estado de destino');
    poner('ccp_rfc_destinatario', existente.ccpRfcDestinatario, plan.ccp.rfcDestinatario, 'el RFC del destinatario');
    poner('ccp_transp_internac', existente.ccpTranspInternac, plan.ccp.transpInternac, 'el transporte internacional');
    const columnasCompletadas = await repo.completarHuecosViaje(tenantId, existente.id, huecos);
    const mercancias = await repo.reemplazarMercanciasDeDocumento(tenantId, existente.id, doc.id, plan.mercancias);
    return { ok: true, accion: 'actualizado', viajeId: existente.id, folio: plan.folio, mercancias, columnasCompletadas, advertencias, borrador: null };
  };

  let resultado: ResultadoSalida;
  const yaExiste = await repo.viajePorFolio(tenantId, plan.folio);
  if (yaExiste) {
    resultado = await completar(yaExiste.id);
  } else {
    // Un viaje nuevo necesita operador. Primero el que eligió la persona; si no, el nombre EXACTO del documento.
    const operadores = await repo.operadoresDeFlota(tenantId);
    let operador: OperadorMin | null = null;
    if (opciones.operadorId) {
      operador = operadores.find((o) => o.id === opciones.operadorId) ?? null;
      if (!operador || !operador.activo) return { ok: false, motivo: 'operador_invalido', mensaje: 'Ese operador no está en tu flota o está dado de baja.', folio: plan.folio };
    } else {
      operador = operadorPorNombre(operadores, plan.operadorNombre);
    }
    if (!operador) {
      return {
        ok: false, motivo: 'falta_operador', folio: plan.folio,
        mensaje: plan.operadorNombre
          ? `No encontré un operador activo llamado «${plan.operadorNombre}» (o hay más de uno). Elige quién maneja este viaje para crearlo.`
          : 'El documento no dice quién maneja. Elige el operador para crear el viaje.',
      };
    }
    const ocupado = await repo.viajeAbiertoDeOperador(tenantId, operador.id);
    if (ocupado) {
      return { ok: false, motivo: 'operador_ocupado', folio: plan.folio, mensaje: `${operador.nombre} ya tiene un viaje abierto${ocupado.folio ? ` (${ocupado.folio})` : ''}. Un operador solo puede tener uno: ciérralo o elige otro operador.` };
    }
    const id = await repo.insertarViaje(tenantId, {
      folio: plan.folio, origen: plan.origen, destino: plan.destino, fechaInicio: plan.fechaInicio, kmRecorridos: plan.kmRecorridos,
      operadorId: operador.id, unidadId, clienteId: doc.clienteId, ccp: plan.ccp,
    });
    // `null` = 23505: el folio ya existe, o el operador acaba de abrir otro viaje (uq_viaje_abierto_por_operador).
    if (id === null) {
      const ahora = await repo.viajePorFolio(tenantId, plan.folio);
      if (ahora) resultado = await completar(ahora.id);
      else return { ok: false, motivo: 'carrera', mensaje: 'Otro viaje se abrió para ese operador mientras se creaba este. Vuelve a intentarlo.', folio: plan.folio };
    } else {
      const mercancias = await repo.reemplazarMercanciasDeDocumento(tenantId, id, doc.id, plan.mercancias);
      resultado = { ok: true, accion: 'creado', viajeId: id, folio: plan.folio, mercancias, columnasCompletadas: 0, advertencias, borrador: null };
    }
  }

  if (!resultado.ok) return resultado;
  await repo.vincularViaje(tenantId, doc.id, resultado.viajeId);
  await anotarBitacora(
    { tenantId, actor: opciones.actor ?? 'sistema', accion: 'ccp.documento_aplicado', entidad: 'viaje', entidadId: resultado.viajeId,
      detalle: { documentoId: doc.id, accion: resultado.accion, mercancias: resultado.mercancias, columnasCompletadas: resultado.columnasCompletadas } },
    { evento: 'carta_porte_docs.bitacora_no_escribio' },
  );
  resultado.borrador = await evaluarBorrador(tenantId, resultado.viajeId);
  return resultado;
}
