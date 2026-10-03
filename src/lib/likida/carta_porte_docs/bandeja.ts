// ═══════════════════════════════════════════════════════════════════════════
// BANDEJA DE REVISIÓN — corregir, confirmar, aprobar, rechazar y reabrir.
//
// Una persona revisa el documento al lado de lo extraído, corrige campo a campo y
// aprueba. Lo que hace este módulo seguro:
//
//   · NADA se aprueba con un bloqueo vivo ni con un campo crítico dudoso sin
//     confirmar: `aprobarDocumento` revalida SIEMPRE en el servidor (la pantalla
//     puede estar vieja o haber sido manipulada).
//   · Cada cambio exige la `version` que el revisor VIO: dos revisores sobre el
//     mismo documento no se pisan (el segundo recibe «otra persona lo cambió»).
//   · Corregir es distinto de confirmar: una corrección cambia el valor y queda en
//     `cp_correccion` (alimenta el aprendizaje y la métrica «% sin corrección»);
//     confirmar deja el valor y solo lo marca revisado por un humano.
//   · Todo deja evento en la bitácora del documento, sin el contenido de los campos.
//   · Al aprobar, el perfil del cliente-formato aprende (salvo documentos con
//     riesgo de inyección) y se intenta la salida al viaje.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { anotarBitacora } from '../bitacora_escritura';
import { DatoInvalido } from '../errores';
import { CAMPOS_DOC, CAMPOS_MERCANCIA, MAX_MERCANCIAS, campoDoc, campoMercancia, etiquetaCampo, type CampoValor, type Extraccion } from './campos';
import { detectarFormato, prepararContenido, type ContenidoDoc } from './contenido';
import { completarDerivados } from './derivar';
import { normalizarValor } from './normalizar';
import { aprender, claveDePerfil, dominioDe, firmaDe } from './perfiles';
import { aplicarSalidaViaje, type ResultadoSalida } from './salida';
import { DIAS_RETENCION, validarDocumento } from './servicio';
import { confianzaMinimaCritica } from './validacion';
import * as repo from './repo';
import type { CorreccionFila, DocumentoFila } from './repo';

export class ConflictoDeVersion extends DatoInvalido {
  constructor() { super('Otra persona cambió este documento mientras lo revisabas. Recarga la pantalla y vuelve a intentarlo.'); }
}

/** Más que esto entre abrir y aprobar no es «tiempo de revisión»: es una pestaña olvidada. */
export const MAX_SEGUNDOS_REVISION_MEDIBLE = 2 * 3600;

export interface CambioCampo {
  campo: string;
  /** Índice del renglón de mercancía; `null` = campo del documento; igual al número de renglones = renglón NUEVO. */
  renglon: number | null;
  /** El valor que la persona dejó en el campo. Vacío = «el documento no lo trae». */
  valor: string | null;
  /** Marcar este campo como revisado aunque no cambie. */
  confirmar?: boolean;
}

export interface ResultadoCambios { extraccion: Extraccion; correcciones: CorreccionFila[]; confirmados: number }

const copiar = (e: Extraccion): Extraccion => JSON.parse(JSON.stringify(e)) as Extraccion;

/** Aplica los cambios de la persona a la extracción. PURA. Lanza `DatoInvalido` con una frase si algo no se entiende. */
export function aplicarCambiosAExtraccion(base: Extraccion, cambios: CambioCampo[]): ResultadoCambios {
  const e = copiar(base);
  const correcciones: CorreccionFila[] = [];
  let confirmados = 0;

  for (const c of cambios) {
    const def = c.renglon === null ? campoDoc(c.campo) : campoMercancia(c.campo);
    if (!def) throw new DatoInvalido(`«${c.campo}» no es un campo del ${c.renglon === null ? 'documento' : 'renglón de mercancía'}.`);
    if (c.renglon !== null) {
      if (!Number.isInteger(c.renglon) || c.renglon < 0 || c.renglon > e.mercancias.length) throw new DatoInvalido(`El renglón ${(c.renglon ?? 0) + 1} no existe.`);
      if (c.renglon === e.mercancias.length) {
        if ((c.valor ?? '').trim() === '') continue; // un renglón nuevo sin dato no se crea
        if (e.mercancias.length >= MAX_MERCANCIAS) throw new DatoInvalido(`Un documento admite hasta ${MAX_MERCANCIAS} mercancías.`);
        e.mercancias.push({});
      }
    }
    const destino: Record<string, CampoValor> = c.renglon === null ? e.campos : e.mercancias[c.renglon];
    const actual = destino[c.campo];
    const crudo = (c.valor ?? '').trim();
    const rotulo = etiquetaCampo(c.campo, c.renglon);

    if (crudo === '') {
      if (actual && actual.valor !== null && actual.valor !== '') {
        delete destino[c.campo];
        correcciones.push({ campo: c.campo, renglon: c.renglon, valorAntes: actual.valor, valorDespues: null });
      }
      continue;
    }
    const n = normalizarValor(def, crudo);
    if (n.valor === null) throw new DatoInvalido(`${rotulo}: no entendí «${crudo.slice(0, 40)}».`);
    if (n.valor === actual?.valor) {
      if (c.confirmar && actual.origen !== 'humano') {
        destino[c.campo] = { ...actual, confianza: 1, origen: 'humano', notas: [...(actual.notas ?? []), 'Confirmado por una persona.'] };
        confirmados++;
      }
      continue; // sin cambio: no se toca (enviar la forma entera no «confirma» todo)
    }
    destino[c.campo] = { valor: n.valor, confianza: 1, evidencia: actual?.evidencia ?? null, origen: 'humano', notas: ['Corregido por una persona.'] };
    correcciones.push({ campo: c.campo, renglon: c.renglon, valorAntes: actual?.valor ?? null, valorDespues: n.valor });
  }
  // Una mercancía que quedó sin ningún campo no es un renglón.
  e.mercancias = e.mercancias.filter((f) => Object.keys(f).length > 0);
  return { extraccion: completarDerivados(e), correcciones, confirmados };
}

/** Quita un renglón de mercancía (otra clase de corrección: se registra con el campo `mercancia`). PURA. */
export function quitarRenglonDeExtraccion(base: Extraccion, renglon: number): ResultadoCambios {
  if (!Number.isInteger(renglon) || renglon < 0 || renglon >= base.mercancias.length) throw new DatoInvalido(`El renglón ${renglon + 1} no existe.`);
  const e = copiar(base);
  const [quitado] = e.mercancias.splice(renglon, 1);
  return {
    extraccion: completarDerivados(e),
    correcciones: [{ campo: 'mercancia', renglon, valorAntes: quitado.descripcion?.valor ?? `renglón ${renglon + 1}`, valorDespues: null }],
    confirmados: 0,
  };
}

async function cargar(tenantId: string, id: string): Promise<DocumentoFila> {
  const d = await repo.leerDocumento(tenantId, id);
  if (!d) throw new DatoInvalido('Ese documento no está en tu flota, o alguien lo borró. Recarga la pantalla.');
  return d;
}

function exigirEditable(d: DocumentoFila): void {
  if (d.estado !== 'por_revisar') {
    throw new DatoInvalido(d.estado === 'aprobado' ? 'El documento ya está aprobado. Reábrelo para corregirlo.' : `El documento está «${d.estado}»: solo se corrigen los que están por revisar.`);
  }
  if (!d.extraccion) throw new DatoInvalido('El documento todavía no tiene extracción.');
}

/** Marca la PRIMERA apertura (idempotente): es el inicio del tiempo de revisión medido. No cambia la versión. */
export async function abrirRevision(tenantId: string, id: string, actorId: string | null, ahora = new Date()): Promise<DocumentoFila> {
  const d = await cargar(tenantId, id);
  if (d.estado !== 'por_revisar' || d.abiertoEn) return d;
  const r = await repo.actualizarDocumento(tenantId, id, d.version, { abierto_en: ahora.toISOString(), revisado_por: actorId });
  if (!r) return (await repo.leerDocumento(tenantId, id)) ?? d; // otro lo abrió primero: da igual quién
  await repo.registrarEvento(tenantId, id, 'revision_abierta', actorId, {});
  return r;
}

export async function corregirCampos(
  tenantId: string, id: string, versionVista: number, cambios: CambioCampo[], actorId: string | null,
): Promise<DocumentoFila> {
  const d = await cargar(tenantId, id);
  exigirEditable(d);
  if (d.version !== versionVista) throw new ConflictoDeVersion();
  const r = aplicarCambiosAExtraccion(d.extraccion as Extraccion, cambios);
  return guardarRevision(tenantId, d, versionVista, r, actorId);
}

export async function quitarRenglon(tenantId: string, id: string, versionVista: number, renglon: number, actorId: string | null): Promise<DocumentoFila> {
  const d = await cargar(tenantId, id);
  exigirEditable(d);
  if (d.version !== versionVista) throw new ConflictoDeVersion();
  return guardarRevision(tenantId, d, versionVista, quitarRenglonDeExtraccion(d.extraccion as Extraccion, renglon), actorId);
}

async function guardarRevision(tenantId: string, d: DocumentoFila, versionVista: number, r: ResultadoCambios, actorId: string | null): Promise<DocumentoFila> {
  if (r.correcciones.length === 0 && r.confirmados === 0) return d;
  const validacion = await validarDocumento(tenantId, d, r.extraccion);
  const guardada = await repo.actualizarDocumento(tenantId, d.id, versionVista, {
    extraccion: { campos: r.extraccion.campos, mercancias: r.extraccion.mercancias, meta: d.extraccion?.meta },
    validacion, confianza_min: confianzaMinimaCritica(r.extraccion), revisado_por: actorId,
  });
  if (!guardada) throw new ConflictoDeVersion();
  // Primero la corrección (alimenta métricas y aprendizaje), después el evento: sin rastro no hay cambio que valga.
  await repo.registrarCorrecciones(tenantId, d.id, actorId, r.correcciones);
  await repo.registrarEvento(tenantId, d.id, 'campo_corregido', actorId, {
    corregidos: r.correcciones.length, confirmados: r.confirmados,
    campos: [...new Set(r.correcciones.map((c) => c.campo))].slice(0, 30),
  });
  return guardada;
}

// ── Aprobar ─────────────────────────────────────────────────────────────────

export interface ResultadoAprobacion {
  documento: DocumentoFila;
  salida: ResultadoSalida | null;
  perfil: { accion: 'creado' | 'nueva_version' | 'sin_cambios' | 'omitido'; version?: number; cambios?: string[]; motivo?: string };
}

/** Los motivos por los que NO se puede aprobar, en frases (los 5 primeros). */
export function motivosDeBloqueo(d: DocumentoFila): string[] {
  const v = d.validacion;
  if (!v) return ['El documento todavía no se ha validado.'];
  return v.hallazgos.filter((h) => h.severidad !== 'aviso').map((h) => h.mensaje).slice(0, 5);
}

async function contenidoDeDocumento(d: DocumentoFila): Promise<ContenidoDoc | null> {
  if (!d.storageRuta) return null;
  try {
    const bytes = await repo.descargarArchivo(d.storageRuta);
    const f = detectarFormato(bytes);
    return f.ok ? await prepararContenido(bytes, f.clase) : null;
  } catch {
    return null;
  }
}

const FORMATOS_APRENDIBLES = new Set(['excel', 'csv', 'xml', 'pdf_texto', 'correo']);

/** Aprende el mapeo de lo que la persona aprobó. NUNCA lanza: el aprendizaje no puede tumbar una aprobación. */
async function aprenderDeAprobado(tenantId: string, d: DocumentoFila, actorId: string | null): Promise<ResultadoAprobacion['perfil']> {
  try {
    if (!FORMATOS_APRENDIBLES.has(d.formato)) return { accion: 'omitido', motivo: 'Fotos y escaneos no tienen columnas ni etiquetas que aprender.' };
    if (d.riesgoInyeccion) return { accion: 'omitido', motivo: 'El documento traía texto con forma de instrucción: no se aprende de él.' };
    const contenido = await contenidoDeDocumento(d);
    if (!contenido) return { accion: 'omitido', motivo: 'No se pudo volver a leer el archivo.' };
    const perfiles = await repo.listarPerfiles(tenantId);
    const existente = d.perfilId ? perfiles.find((p) => p.id === d.perfilId) : undefined;
    const final = d.extraccion as Extraccion;
    const r = aprender({ contenido, final, previa: existente?.activa ?? null, riesgoInyeccion: false });
    if (r.cambios.length === 0) return { accion: 'sin_cambios' };
    const nota = r.cambios.join(' · ').slice(0, 300);

    if (existente) {
      const version = await repo.crearVersionPerfil(tenantId, existente.id, existente.versionActiva, { mapeos: r.mapeos, ejemplos: r.ejemplos, nota, documentoId: d.id, actorId });
      if (version === null) return { accion: 'omitido', motivo: 'Otra aprobación actualizó el perfil al mismo tiempo; la siguiente lo reintenta.' };
      await repo.registrarEvento(tenantId, d.id, 'perfil_aprendido', actorId, { perfilId: existente.id, version, cambios: r.cambios.length });
      return { accion: 'nueva_version', version, cambios: r.cambios };
    }
    if (r.mapeos.length < 3) return { accion: 'omitido', motivo: 'Con menos de tres campos reconocidos todavía no hay un formato que recordar.' };
    const clientes = d.clienteId ? await repo.listarClientes(tenantId) : [];
    const cliente = clientes.find((c) => c.id === d.clienteId)?.nombre ?? dominioDe(d.remitente) ?? 'cliente';
    const baseClave = claveDePerfil(`${cliente}-${d.formato}`);
    for (let i = 0; i < 5; i++) {
      const clave = i === 0 ? baseClave : `${baseClave.slice(0, 55)}-${i + 1}`;
      const id = await repo.crearPerfil(tenantId, {
        clave, nombre: `${cliente} · ${d.formato}`.slice(0, 120), clienteId: d.clienteId, formato: contenido.formato,
        firma: firmaDe(contenido, d.remitente), mapeos: r.mapeos, ejemplos: r.ejemplos, nota, documentoId: d.id, actorId,
      });
      if (id) {
        await repo.registrarEvento(tenantId, d.id, 'perfil_aprendido', actorId, { perfilId: id, version: 1, cambios: r.cambios.length });
        return { accion: 'creado', version: 1, cambios: r.cambios };
      }
    }
    return { accion: 'omitido', motivo: 'No se pudo asignar una clave libre al perfil.' };
  } catch (e) {
    logger.warn('carta_porte_docs.aprendizaje_fallo', { documentoId: d.id, err: e instanceof Error ? e.message : String(e) });
    return { accion: 'omitido', motivo: 'El aprendizaje falló; la aprobación sí quedó.' };
  }
}

export async function aprobarDocumento(
  tenantId: string, id: string, versionVista: number, actor: { id: string | null; email?: string },
  opciones: { operadorId?: string | null; aprender?: boolean; ahora?: Date } = {},
): Promise<ResultadoAprobacion> {
  const ahora = opciones.ahora ?? new Date();
  const d = await cargar(tenantId, id);
  exigirEditable(d);
  if (d.version !== versionVista) throw new ConflictoDeVersion();

  // SIEMPRE se revalida en el servidor: lo que la pantalla creía hace tres minutos no es lo que hay ahora.
  const validacion = await validarDocumento(tenantId, d, d.extraccion as Extraccion);
  if (!validacion.listoParaAprobar) {
    const motivos = validacion.hallazgos.filter((h) => h.severidad !== 'aviso').map((h) => h.mensaje).slice(0, 5);
    throw new DatoInvalido(`No se puede aprobar todavía: ${motivos.join(' ')}`);
  }
  const segundos = d.abiertoEn ? Math.round((ahora.getTime() - new Date(d.abiertoEn).getTime()) / 1000) : null;
  const medible = segundos !== null && segundos >= 0 && segundos <= MAX_SEGUNDOS_REVISION_MEDIBLE ? segundos : null;
  const aprobado = await repo.actualizarDocumento(tenantId, id, versionVista, {
    estado: 'aprobado', validacion, aprobado_en: ahora.toISOString(), aprobado_por: actor.id, revisado_por: actor.id,
    tiempo_revision_seg: medible, retener_hasta: new Date(ahora.getTime() + DIAS_RETENCION.aprobado * 86_400_000).toISOString(),
  });
  if (!aprobado) throw new ConflictoDeVersion();
  await repo.registrarEvento(tenantId, id, 'aprobado', actor.id, { revisionSeg: medible, avisos: validacion.hallazgos.length });

  const perfil = opciones.aprender === false ? { accion: 'omitido' as const, motivo: 'Aprendizaje desactivado.' } : await aprenderDeAprobado(tenantId, aprobado, actor.id);
  const salida = await intentarSalida(tenantId, aprobado, actor, opciones.operadorId ?? null);
  return { documento: (await repo.leerDocumento(tenantId, id)) ?? aprobado, salida, perfil };
}

/** La salida al viaje de un documento YA aprobado (también se llama sola desde «Crear viaje» cuando faltaba el operador). */
export async function intentarSalida(
  tenantId: string, d: DocumentoFila, actor: { id: string | null; email?: string }, operadorId: string | null,
): Promise<ResultadoSalida | null> {
  try {
    const r = await aplicarSalidaViaje(tenantId, d, { operadorId, actor: { id: actor.id ?? undefined, email: actor.email } });
    if (r.ok) await repo.registrarEvento(tenantId, d.id, 'salida_viaje', actor.id, { accion: r.accion, mercancias: r.mercancias, columnasCompletadas: r.columnasCompletadas });
    return r;
  } catch (e) {
    // El documento YA está aprobado: un fallo de la salida no lo deshace, se dice y se puede reintentar.
    logger.error('carta_porte_docs.salida_fallo', { documentoId: d.id, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, motivo: 'datos_invalidos', mensaje: 'No se pudo crear el viaje por un error del sistema. El documento sigue aprobado; reintenta desde su pantalla.' };
  }
}

export async function crearViajeDeDocumento(
  tenantId: string, id: string, actor: { id: string | null; email?: string }, operadorId: string | null,
): Promise<ResultadoSalida> {
  const d = await cargar(tenantId, id);
  if (d.estado !== 'aprobado') throw new DatoInvalido('Solo se crea el viaje de un documento aprobado.');
  return (await intentarSalida(tenantId, d, actor, operadorId)) as ResultadoSalida;
}

export async function rechazarDocumento(
  tenantId: string, id: string, versionVista: number, motivo: string, actorId: string | null, ahora = new Date(),
): Promise<DocumentoFila> {
  const m = motivo.replace(/\s+/g, ' ').trim();
  if (m.length < 3 || m.length > 500) throw new DatoInvalido('Escribe el motivo del rechazo (entre 3 y 500 caracteres).');
  const d = await cargar(tenantId, id);
  if (d.estado !== 'por_revisar' && d.estado !== 'fallido') throw new DatoInvalido(`Un documento «${d.estado}» no se rechaza.`);
  if (d.version !== versionVista) throw new ConflictoDeVersion();
  const r = await repo.actualizarDocumento(tenantId, id, versionVista, {
    estado: 'rechazado', rechazo_motivo: m, revisado_por: actorId, retener_hasta: new Date(ahora.getTime() + DIAS_RETENCION.cerrado * 86_400_000).toISOString(),
  });
  if (!r) throw new ConflictoDeVersion();
  await repo.registrarEvento(tenantId, id, 'rechazado', actorId, { motivo: m });
  return r;
}

/** Reabre un aprobado o rechazado: vuelve a «por revisar» sin tocar el viaje que ya se haya creado. */
export async function reabrirDocumento(tenantId: string, id: string, versionVista: number, actorId: string | null): Promise<DocumentoFila> {
  const d = await cargar(tenantId, id);
  if (d.estado !== 'aprobado' && d.estado !== 'rechazado') throw new DatoInvalido('Solo se reabren los documentos aprobados o rechazados.');
  if (!d.extraccion) throw new DatoInvalido('Este documento no tiene extracción que revisar.');
  if (d.version !== versionVista) throw new ConflictoDeVersion();
  const r = await repo.actualizarDocumento(tenantId, id, versionVista, {
    estado: 'por_revisar', aprobado_en: null, aprobado_por: null, rechazo_motivo: null, tiempo_revision_seg: null, exportado_en: null,
    abierto_en: null, revisado_por: actorId,
    retener_hasta: new Date(Date.now() + DIAS_RETENCION.recibido * 86_400_000).toISOString(),
  });
  if (!r) throw new ConflictoDeVersion();
  await repo.registrarEvento(tenantId, id, 'reabierto', actorId, { teniaViaje: d.viajeId !== null });
  return r;
}

/**
 * Elimina un documento y su archivo (derecho de cancelación del titular, o un documento subido por error). Primero el
 * archivo: si Storage no lo borra, la fila se queda (declarar eliminado un archivo que sigue ahí sería mentir).
 * No se elimina uno que se está leyendo. Los renglones de mercancía que ya pasaron al viaje se conservan (son datos
 * del viaje), sin la liga al documento.
 */
export async function eliminarDocumento(tenantId: string, id: string, actor: { id: string | null; email?: string }): Promise<void> {
  const d = await cargar(tenantId, id);
  if (d.estado === 'procesando' && d.procesandoHasta && new Date(d.procesandoHasta) > new Date()) {
    throw new DatoInvalido('El documento se está leyendo ahora mismo. Espera un momento y vuelve a intentarlo.');
  }
  // Un archivo dividido (0670): sus hijos contienen los MISMOS datos personales y la base los arrastra en cascada, pero sus
  // archivos en Storage no: se borran uno por uno ANTES, o quedarían huérfanos con datos de terceros.
  let hijosBorrados = 0;
  if (d.estado === 'dividido') {
    for (const h of await repo.hijosDeDocumento(tenantId, id)) {
      if (h.documento.estado === 'procesando' && h.documento.procesandoHasta && new Date(h.documento.procesandoHasta) > new Date()) {
        throw new DatoInvalido('Uno de los embarques de este archivo se está leyendo ahora mismo. Espera un momento y vuelve a intentarlo.');
      }
    }
    for (const h of await repo.hijosDeDocumento(tenantId, id)) {
      if (h.documento.storageRuta) await repo.borrarArchivo(h.documento.storageRuta);
      if (await repo.borrarDocumento(tenantId, h.documento.id)) hijosBorrados++;
    }
  }
  if (d.storageRuta) await repo.borrarArchivo(d.storageRuta);
  if (!(await repo.borrarDocumento(tenantId, id))) throw new DatoInvalido('Ese documento ya no existe.');
  await anotarBitacora(
    { tenantId, actor: { id: actor.id ?? undefined, email: actor.email }, accion: 'ccp.documento_eliminado', entidad: 'tenant', entidadId: tenantId, detalle: { documentoId: id, formato: d.formato, estado: d.estado, conViaje: d.viajeId !== null, ...(d.estado === 'dividido' ? { hijosBorrados } : {}) } },
    { evento: 'carta_porte_docs.bitacora_no_escribio' },
  );
}

/** Lo que la pantalla de revisión necesita para pintar los rótulos de los campos. */
export const CAMPOS_PANTALLA = { doc: CAMPOS_DOC, mercancia: CAMPOS_MERCANCIA } as const;
