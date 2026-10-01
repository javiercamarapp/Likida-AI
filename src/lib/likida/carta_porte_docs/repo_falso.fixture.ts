/* eslint-disable security/detect-possible-timing-attacks -- doble de prueba en memoria: comparar un token aquí no es una frontera de seguridad */
// ═══════════════════════════════════════════════════════════════════════════
// UN `repo.ts` EN MEMORIA, SOLO PARA PRUEBAS.
//
// Implementa el MISMO contrato que repo.ts (la firma y la semántica que importan:
// aislamiento por tenant, unique (tenant, sha256), claim con lease y tope de
// intentos, UPDATE condicional por versión, viaje único por folio y por operador
// abierto). No es Postgres: lo que solo la base demuestra vive en
// supabase/tests/0420_*.sql. Aquí se prueba la LÓGICA de la app.
// ═══════════════════════════════════════════════════════════════════════════

import type * as Real from './repo';
import type { DocumentoFila, MercanciaInsertar, OperadorMin, PerfilFila, ViajeMin } from './repo';

interface Viaje extends ViajeMin { tenantId: string }
interface Mercancia extends MercanciaInsertar { tenantId: string; viajeId: string; documentoId: string | null }
interface Evento { tenantId: string; documentoId: string; tipo: string; actorId: string | null; detalle: Record<string, unknown>; creadoEn: string }
interface Correccion { tenantId: string; documentoId: string; campo: string; renglon: number | null; valorAntes: string | null; valorDespues: string | null }
interface Version { perfilId: string; tenantId: string; version: number; mapeos: unknown[]; ejemplos: unknown[]; nota: string | null }

export const estado = {
  docs: new Map<string, DocumentoFila>(),
  archivos: new Map<string, Uint8Array>(),
  eventos: [] as Evento[],
  correcciones: [] as Correccion[],
  buzones: new Map<string, { tenantId: string; token: string; activo: boolean; remitentesPermitidos: string[] }>(),
  perfiles: new Map<string, { id: string; tenantId: string; clave: string; nombre: string; clienteId: string | null; formato: string; firma: unknown; versionActiva: number; creadaEn: string }>(),
  versiones: [] as Version[],
  exportConfigs: [] as Array<{ tenantId: string; id: string; nombre: string; formato: 'csv' | 'json'; config: Record<string, unknown>; activa: boolean }>,
  viajes: [] as Viaje[],
  mercancias: [] as Mercancia[],
  operadores: [] as Array<OperadorMin & { tenantId: string }>,
  unidades: [] as Array<{ tenantId: string; id: string; placas: string; activo: boolean }>,
  clientes: [] as Array<{ tenantId: string; id: string; nombre: string }>,
  correos: new Map<string, { estado: 'claimed' | 'applied'; token: string }>(),
  /** Para forzar fallos: `fallar.set('subirArchivo', new Error('x'))`. */
  fallar: new Map<string, Error>(),
  reloj: { ahora: () => new Date() },
  seq: 0,
  llamadas: [] as string[],
};

export function reset(): void {
  estado.docs.clear(); estado.archivos.clear(); estado.eventos.length = 0; estado.correcciones.length = 0; estado.buzones.clear();
  estado.perfiles.clear(); estado.versiones.length = 0; estado.exportConfigs.length = 0; estado.viajes.length = 0; estado.mercancias.length = 0;
  estado.operadores.length = 0; estado.unidades.length = 0; estado.clientes.length = 0; estado.correos.clear(); estado.fallar.clear(); estado.llamadas.length = 0;
  estado.seq = 0; estado.reloj.ahora = () => new Date();
}

const ahoraIso = (): string => estado.reloj.ahora().toISOString();
const clon = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
function falla(nombre: string): void {
  estado.llamadas.push(nombre);
  const e = estado.fallar.get(nombre);
  if (e) throw e;
}

export const BUCKET = 'cartaporte-docs';

export const api: typeof Real = {
  BUCKET,
  COLUMNAS_DOC: '',
  COLUMNAS_LISTA: '',
  aDocumento: (r) => r as unknown as DocumentoFila,

  async subirArchivo(ruta, bytes) { falla('subirArchivo'); estado.archivos.set(ruta, new Uint8Array(bytes)); },
  async descargarArchivo(ruta) {
    falla('descargarArchivo');
    const b = estado.archivos.get(ruta);
    if (!b) throw new Error('cartaporte_docs descargar: sin contenido');
    return new Uint8Array(b);
  },
  async firmarArchivo(ruta) { falla('firmarArchivo'); return `https://firmada.test/${ruta}`; },
  async borrarArchivo(ruta) { falla('borrarArchivo'); estado.archivos.delete(ruta); },

  async insertarDocumento(tenantId, d) {
    falla('insertarDocumento');
    for (const x of estado.docs.values()) if (x.tenantId === tenantId && x.sha256 === d.sha256) return { documento: clon(x), duplicado: true };
    const fila: DocumentoFila = {
      id: d.id, tenantId, canal: d.canal, formato: d.formato, nombreArchivo: d.nombreArchivo, mime: d.mime, bytes: d.bytes, sha256: d.sha256,
      storageRuta: d.storageRuta, estado: 'recibido', version: 1, clienteId: d.clienteId, perfilId: null, perfilVersion: null, remitente: d.remitente,
      asunto: d.asunto, remitenteReconocido: d.remitenteReconocido, textoExtracto: null, riesgoInyeccion: false, extraccion: null, validacion: null,
      confianzaMin: null, nivelModelo: null, modelo: null, tokensIn: 0, tokensOut: 0, costoUsd: 0, viajeId: null, procesandoHasta: null, intentos: 0,
      ultimoError: null, abiertoEn: null, revisadoPor: null, aprobadoPor: null, aprobadoEn: null, rechazoMotivo: null, tiempoRevisionSeg: null,
      exportadoEn: null, retenerHasta: d.retenerHasta, purgadoEn: null, createdAt: ahoraIso(), updatedAt: ahoraIso(),
    };
    estado.docs.set(d.id, fila);
    return { documento: clon(fila), duplicado: false };
  },
  async documentoPorHuella(tenantId, sha) {
    for (const x of estado.docs.values()) if (x.tenantId === tenantId && x.sha256 === sha) return clon(x);
    return null;
  },
  async leerDocumento(tenantId, id) {
    falla('leerDocumento');
    const d = estado.docs.get(id);
    return d && d.tenantId === tenantId ? clon(d) : null;
  },
  async listarDocumentos(tenantId, f = {}) {
    let filas = [...estado.docs.values()].filter((d) => d.tenantId === tenantId);
    if (f.estados?.length) filas = filas.filter((d) => f.estados!.includes(d.estado));
    if (f.desde) filas = filas.filter((d) => d.createdAt >= f.desde!);
    filas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { filas: filas.slice(0, f.limite ?? 100).map(clon), total: filas.length };
  },
  async reclamarDocumento(tenantId, id, lease = 120) {
    falla('reclamarDocumento');
    const d = estado.docs.get(id);
    if (!d || d.tenantId !== tenantId || d.purgadoEn || d.intentos >= 5) return null;
    const vencido = d.estado === 'procesando' && d.procesandoHasta !== null && new Date(d.procesandoHasta) < estado.reloj.ahora();
    if (!(d.estado === 'recibido' || d.estado === 'fallido' || vencido)) return null;
    d.estado = 'procesando'; d.procesandoHasta = new Date(estado.reloj.ahora().getTime() + lease * 1000).toISOString();
    d.intentos++; d.version++; d.updatedAt = ahoraIso();
    return { intentos: d.intentos, version: d.version };
  },
  async actualizarDocumento(tenantId, id, versionEsperada, cambios) {
    falla('actualizarDocumento');
    const d = estado.docs.get(id);
    if (!d || d.tenantId !== tenantId || d.version !== versionEsperada) return null;
    const mapa: Record<string, keyof DocumentoFila> = {
      estado: 'estado', formato: 'formato', perfil_id: 'perfilId', perfil_version: 'perfilVersion', texto_extracto: 'textoExtracto',
      riesgo_inyeccion: 'riesgoInyeccion', extraccion: 'extraccion', validacion: 'validacion', confianza_min: 'confianzaMin', nivel_modelo: 'nivelModelo',
      modelo: 'modelo', tokens_in: 'tokensIn', tokens_out: 'tokensOut', costo_usd: 'costoUsd', procesando_hasta: 'procesandoHasta', ultimo_error: 'ultimoError',
      intentos: 'intentos', retener_hasta: 'retenerHasta', abierto_en: 'abiertoEn', revisado_por: 'revisadoPor', aprobado_por: 'aprobadoPor',
      aprobado_en: 'aprobadoEn', rechazo_motivo: 'rechazoMotivo', tiempo_revision_seg: 'tiempoRevisionSeg', exportado_en: 'exportadoEn', viaje_id: 'viajeId',
    };
    for (const [k, v] of Object.entries(cambios)) {
      const campo = mapa[k];
      if (!campo) throw new Error(`repo falso: columna desconocida ${k}`);
      (d as unknown as Record<string, unknown>)[campo] = v === undefined ? null : clon(v);
    }
    // El CHECK de la base: aprobado ⇔ aprobado_en.
    if ((d.estado === 'aprobado') !== (d.aprobadoEn !== null)) throw new Error('repo falso: viola cp_documento_aprobacion_completa');
    d.version = versionEsperada + 1; d.updatedAt = ahoraIso();
    return clon(d);
  },
  async documentosConFolio(tenantId, folio, exceptoId) {
    return [...estado.docs.values()]
      .filter((d) => d.tenantId === tenantId && d.id !== exceptoId && d.estado !== 'rechazado' && d.extraccion?.campos.folio_cliente?.valor === folio)
      .map((d) => ({ id: d.id, estado: d.estado, nombreArchivo: d.nombreArchivo }));
  },
  async registrarEvento(tenantId, documentoId, tipo, actorId, detalle = {}) {
    falla('registrarEvento');
    const d = estado.docs.get(documentoId);
    if (!d || d.tenantId !== tenantId) throw new Error('repo falso: FK compuesta (evento de otra flota)');
    estado.eventos.push({ tenantId, documentoId, tipo, actorId, detalle: clon(detalle), creadoEn: ahoraIso() });
  },
  async listarEventos(tenantId, documentoId) {
    return estado.eventos.filter((e) => e.tenantId === tenantId && e.documentoId === documentoId).map((e) => ({ tipo: e.tipo as never, actorId: e.actorId, detalle: e.detalle, creadoEn: e.creadoEn }));
  },
  async registrarCorrecciones(tenantId, documentoId, _actor, filas) {
    falla('registrarCorrecciones');
    const d = estado.docs.get(documentoId);
    if (!d || d.tenantId !== tenantId) throw new Error('repo falso: FK compuesta (corrección de otra flota)');
    for (const f of filas) estado.correcciones.push({ tenantId, documentoId, ...f });
  },
  async contarCorreccionesPorDocumento(tenantId, ids) {
    const m = new Map<string, number>();
    for (const c of estado.correcciones) if (c.tenantId === tenantId && ids.includes(c.documentoId)) m.set(c.documentoId, (m.get(c.documentoId) ?? 0) + 1);
    return m;
  },

  async buzonDeFlota(tenantId) { const b = estado.buzones.get(tenantId); return b ? clon(b) : null; },
  async buzonPorToken(token) { for (const b of estado.buzones.values()) if (b.token === token) return clon(b); return null; },
  async crearBuzon(tenantId, token) {
    const ya = estado.buzones.get(tenantId);
    if (ya) return clon(ya);
    for (const b of estado.buzones.values()) if (b.token === token) throw new Error('repo falso: token duplicado');
    const b = { tenantId, token, activo: true, remitentesPermitidos: [] as string[] };
    estado.buzones.set(tenantId, b);
    return clon(b);
  },
  async configurarBuzon(tenantId, c) {
    const b = estado.buzones.get(tenantId);
    if (!b) throw new Error('cartaporte_docs buzón: la flota no tiene buzón');
    if (c.activo !== undefined) b.activo = c.activo;
    if (c.remitentesPermitidos) b.remitentesPermitidos = c.remitentesPermitidos;
    if (c.token) b.token = c.token;
  },

  async listarPerfiles(tenantId) {
    return [...estado.perfiles.values()].filter((p) => p.tenantId === tenantId).flatMap((p) => {
      const v = estado.versiones.find((x) => x.perfilId === p.id && x.version === p.versionActiva);
      if (!v) return [];
      return [{
        id: p.id, clave: p.clave, nombre: p.nombre, clienteId: p.clienteId, formato: p.formato, firma: clon(p.firma), versionActiva: p.versionActiva, creadaEn: p.creadaEn,
        activa: { version: v.version, mapeos: clon(v.mapeos), ejemplos: clon(v.ejemplos), nota: v.nota },
      } as unknown as PerfilFila];
    });
  },
  async listarVersionesPerfil(tenantId, perfilId) {
    return estado.versiones.filter((v) => v.tenantId === tenantId && v.perfilId === perfilId).map((v) => ({ version: v.version, nota: v.nota, mapeos: v.mapeos.length, creadaEn: ahoraIso() })).sort((a, b) => b.version - a.version);
  },
  async crearPerfil(tenantId, p) {
    falla('crearPerfil');
    for (const x of estado.perfiles.values()) if (x.tenantId === tenantId && x.clave === p.clave) return null;
    const id = `perfil-${++estado.seq}`;
    estado.perfiles.set(id, { id, tenantId, clave: p.clave, nombre: p.nombre, clienteId: p.clienteId, formato: p.formato, firma: clon(p.firma), versionActiva: 1, creadaEn: ahoraIso() });
    estado.versiones.push({ perfilId: id, tenantId, version: 1, mapeos: clon(p.mapeos), ejemplos: clon(p.ejemplos), nota: p.nota });
    return id;
  },
  async crearVersionPerfil(tenantId, perfilId, versionBase, v) {
    const p = estado.perfiles.get(perfilId);
    if (!p || p.tenantId !== tenantId) return null;
    if (estado.versiones.some((x) => x.perfilId === perfilId && x.version === versionBase + 1)) return null;
    estado.versiones.push({ perfilId, tenantId, version: versionBase + 1, mapeos: clon(v.mapeos), ejemplos: clon(v.ejemplos), nota: v.nota });
    if (p.versionActiva !== versionBase) return null;
    p.versionActiva = versionBase + 1;
    return versionBase + 1;
  },
  async activarVersionPerfil(tenantId, perfilId, version) {
    const p = estado.perfiles.get(perfilId);
    if (!p || p.tenantId !== tenantId || !estado.versiones.some((x) => x.perfilId === perfilId && x.version === version)) return false;
    p.versionActiva = version;
    return true;
  },

  async listarExportConfigs(tenantId) { return estado.exportConfigs.filter((c) => c.tenantId === tenantId).map(({ tenantId: _t, ...c }) => clon(c)); },
  async guardarExportConfig(tenantId, c) {
    const i = estado.exportConfigs.findIndex((x) => x.tenantId === tenantId && x.nombre === c.nombre);
    const fila = { tenantId, id: i >= 0 ? estado.exportConfigs[i].id : `exp-${++estado.seq}`, nombre: c.nombre, formato: c.formato, config: clon(c.config), activa: true };
    if (i >= 0) estado.exportConfigs[i] = fila; else estado.exportConfigs.push(fila);
  },
  async borrarExportConfig(tenantId, id) { estado.exportConfigs = estado.exportConfigs.filter((c) => !(c.tenantId === tenantId && c.id === id)); },

  async viajePorFolio(tenantId, folio) { const v = estado.viajes.find((x) => x.tenantId === tenantId && x.folio === folio); return v ? clon(v) : null; },
  async viajePorId(tenantId, id) { const v = estado.viajes.find((x) => x.tenantId === tenantId && x.id === id); return v ? clon(v) : null; },
  async operadoresDeFlota(tenantId) { return estado.operadores.filter((o) => o.tenantId === tenantId).map(({ tenantId: _t, ...o }) => o); },
  async unidadesPorPlacas(tenantId, placas) {
    return estado.unidades.filter((u) => u.tenantId === tenantId && u.placas.toUpperCase() === placas.toUpperCase()).map((u) => ({ id: u.id, activo: u.activo }));
  },
  async viajeAbiertoDeOperador(tenantId, operadorId) {
    const v = estado.viajes.find((x) => x.tenantId === tenantId && x.operadorId === operadorId && (x.estatus === 'abierto' || x.estatus === 'en_cuadre'));
    return v ? { id: v.id, folio: v.folio } : null;
  },
  async clientePropio(tenantId, clienteId) { return estado.clientes.some((c) => c.tenantId === tenantId && c.id === clienteId); },
  async listarClientes(tenantId) { return estado.clientes.filter((c) => c.tenantId === tenantId).map(({ tenantId: _t, ...c }) => c); },
  async insertarViaje(tenantId, v) {
    falla('insertarViaje');
    if (estado.viajes.some((x) => x.tenantId === tenantId && x.folio === v.folio)) return null;
    if (estado.viajes.some((x) => x.tenantId === tenantId && x.operadorId === v.operadorId && x.estatus === 'abierto')) return null;
    const id = `viaje-${++estado.seq}`;
    estado.viajes.push({
      id, tenantId, folio: v.folio, origen: v.origen, destino: v.destino, fechaInicio: v.fechaInicio, kmRecorridos: v.kmRecorridos, operadorId: v.operadorId, unidadId: v.unidadId, clienteId: v.clienteId,
      ccpOrigenCp: v.ccp.origenCp, ccpDestinoCp: v.ccp.destinoCp, ccpOrigenEstado: v.ccp.origenEstado, ccpDestinoEstado: v.ccp.destinoEstado, ccpRfcDestinatario: v.ccp.rfcDestinatario,
      ccpTranspInternac: v.ccp.transpInternac, estatus: 'abierto',
    });
    return id;
  },
  async completarHuecosViaje(tenantId, viajeId, huecos) {
    const v = estado.viajes.find((x) => x.tenantId === tenantId && x.id === viajeId);
    if (!v) return 0;
    const col: Record<string, keyof Viaje> = {
      origen: 'origen', destino: 'destino', fecha_inicio: 'fechaInicio', km_recorridos: 'kmRecorridos', unidad_id: 'unidadId', cliente_id: 'clienteId',
      ccp_origen_cp: 'ccpOrigenCp', ccp_destino_cp: 'ccpDestinoCp', ccp_origen_estado: 'ccpOrigenEstado', ccp_destino_estado: 'ccpDestinoEstado',
      ccp_rfc_destinatario: 'ccpRfcDestinatario', ccp_transp_internac: 'ccpTranspInternac',
    };
    let n = 0;
    for (const [k, val] of Object.entries(huecos)) {
      const campo = col[k];
      if (!campo) throw new Error(`repo falso: columna de viaje desconocida ${k}`);
      if ((v as unknown as Record<string, unknown>)[campo] === null) { (v as unknown as Record<string, unknown>)[campo] = val; n++; }
    }
    return n;
  },
  async reemplazarMercanciasDeDocumento(tenantId, viajeId, documentoId, filas) {
    falla('reemplazarMercancias');
    estado.mercancias = estado.mercancias.filter((m) => !(m.tenantId === tenantId && m.viajeId === viajeId && m.documentoId === documentoId));
    for (const f of filas) estado.mercancias.push({ ...f, tenantId, viajeId, documentoId });
    return filas.length;
  },
  async vincularViaje(tenantId, id, viajeId) {
    const d = estado.docs.get(id);
    if (!d || d.tenantId !== tenantId) throw new Error('cartaporte_docs vincular: el documento ya no existe');
    d.viajeId = viajeId;
  },

  async marcarExportado(tenantId, ids, ahora = new Date()) {
    let n = 0;
    for (const id of ids) { const d = estado.docs.get(id); if (d && d.tenantId === tenantId && d.estado === 'aprobado') { d.exportadoEn = ahora.toISOString(); n++; } }
    return n;
  },

  async reclamarCorreo(emailId) {
    const c = estado.correos.get(emailId);
    if (c?.estado === 'applied') return { resultado: 'applied' };
    if (c?.estado === 'claimed') return { resultado: 'busy' };
    const token = `tok-${++estado.seq}`;
    estado.correos.set(emailId, { estado: 'claimed', token });
    return { resultado: 'claimed', token };
  },
  async finalizarCorreo(emailId, token, ok) {
    const c = estado.correos.get(emailId);
    if (!c || c.token !== token) return false;
    if (ok) c.estado = 'applied'; else estado.correos.delete(emailId);
    return true;
  },

  async documentosVencidos(limite = 100) {
    const ahora = estado.reloj.ahora().toISOString();
    return [...estado.docs.values()].filter((d) => !d.purgadoEn && d.retenerHasta < ahora).slice(0, limite).map((d) => ({ id: d.id, tenantId: d.tenantId, storageRuta: d.storageRuta }));
  },
  async borrarDocumento(tenantId, id) {
    const d = estado.docs.get(id);
    if (!d || d.tenantId !== tenantId) return false;
    estado.docs.delete(id);
    estado.eventos = estado.eventos.filter((e) => e.documentoId !== id);
    estado.correcciones = estado.correcciones.filter((c) => c.documentoId !== id);
    estado.mercancias.forEach((m) => { if (m.documentoId === id) m.documentoId = null; });
    return true;
  },
  async marcarPurgado(tenantId, id) {
    const d = estado.docs.get(id);
    if (!d || d.tenantId !== tenantId || d.purgadoEn) return false;
    d.storageRuta = null; d.textoExtracto = null; d.purgadoEn = ahoraIso();
    return true;
  },
};
