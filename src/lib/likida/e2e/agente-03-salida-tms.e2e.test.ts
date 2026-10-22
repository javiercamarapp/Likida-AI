import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './reloj_adelantado.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// E2E AGENTE 3 — LA SALIDA AL TMS (T-A3-39): correo → bandeja → revisión → aprobar → prechequeo del reque → envío → TMS.
//
// Cadena REAL: recibirDocumento / procesarDocumento / validación / bandeja (corregir, aprobar, reabrir) / envio.ts (prepara
// el envío bajo el perfil «cinco_agentes») / el MOTOR del worker de envíos (máquina de estados, prechequeo, plantilla XLSX,
// huella, alerta única, traducción de errores del TMS). DOBLES: repo en memoria de documentos (repo_falso) y de envíos
// (repo_envios_falso, con el reclamo con lease de la 0790), el TMS (tms_falso), el modelo de guion, el reloj y la alerta.
// Datos SINTÉTICOS (las formas M3 y M5 del conjunto dorado). Nada de red, ni de PAC, ni de base.
//
// El repo de documentos y el de envíos son dos dobles distintos (en producción son una sola base): `espejar` copia al doble
// del worker el envío que `aprobarDocumento` dejó en `cp_envio_tms`, como lo haría la base.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('../carta_porte_docs/repo', async () => (await import('../carta_porte_docs/repo_falso.fixture')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta suite no toca Supabase'); } }));
// El PAC: si CUALQUIER camino de la salida al TMS lo tocara, estos espías lo dirían.
const { pac } = vi.hoisted(() => ({ pac: { crearProveedorSw: vi.fn(), resolverPac: vi.fn(), estadoPac: vi.fn() } }));
vi.mock('../pac/sw', () => ({ crearProveedorSw: pac.crearProveedorSw, _limpiarTokenSw: () => {} }));
vi.mock('../pac/index', () => ({ resolverPac: pac.resolverPac, estadoPac: pac.estadoPac, MOTIVOS_CANCELACION: [] }));

import { estado, reset } from '../carta_porte_docs/repo_falso.fixture';
import { A, B, ACTOR, sembrarFlotas, sinAgenteApagado, subirYProcesar } from '../carta_porte_docs/escenario.fixture';
import { llmFalso, type LlmFalso } from '../carta_porte_docs/llm_falso.fixture';
import { atenderCorreoCartaPorte, type DepsCorreo } from '../carta_porte_docs/correo_entrante';
import { abrirRevision, aprobarDocumento, corregirCampos, reabrirDocumento, reabrirPorRechazoTms, type CambioCampo } from '../carta_porte_docs/bandeja';
import { detectarFormato, prepararContenido } from '../carta_porte_docs/contenido';
import { fijarGuardiaPerfil } from '../carta_porte_docs/envio';
import { CONFIG_SALIDA_ARRANQUE, type ConfigSalida } from '../carta_porte_docs/salida_config';
import { SIN_TMS, type Existencia, type SalidaTms } from '../carta_porte_docs/tms_puerto';
import { correrWorkerEnvios, SIN_MAS_REVISIONES, type DepsEnvios } from '../carta_porte_docs/worker_envios';
import { estadoEnvios, repoEnviosFalso, resetEnvios, sembrarEnvio } from '../carta_porte_docs/repo_envios_falso.fixture';
import { crearTmsFalso } from '../carta_porte_docs/tms_falso.fixture';
import { catalogoM3, excelM5, guionM3, guionM5, M5, pdfM3, perfilM5, RFC_DORADO } from '../carta_porte_docs/evaluacion/dorado.fixture';
import type { Extraccion } from '../carta_porte_docs/campos';
import type { DocumentoFila } from '../carta_porte_docs/repo';
import * as repo from '../carta_porte_docs/repo';

const TOKEN_A = 'abcdefghjkmnpqrstvwxyz23';
const T0 = Date.parse('2026-10-15T15:00:00Z');
const MIN = 60_000;
const HORIZONTE_MS = 100_000;
const CLIENTE_M3 = 'cli-boreal';

let ahoraMs = T0;
let config: ConfigSalida;
let puertos: Map<string, SalidaTms>;
let alertas: Array<{ tenantId: string; envioId: string; documentoId: string; motivo: string; destinatario: string; mensaje: string }>;

beforeEach(async () => {
  reset(); sembrarFlotas(); resetEnvios();
  ahoraMs = T0;
  estadoEnvios.reloj.ahora = () => new Date(ahoraMs);
  config = { ...CONFIG_SALIDA_ARRANQUE, modo: 'api', destinatarioAlertaCorreo: 'oficina@flota-a.test' };
  puertos = new Map();
  alertas = [];
  pac.crearProveedorSw.mockClear(); pac.resolverPac.mockClear(); pac.estadoPac.mockClear();
  // A está bajo el perfil «cinco_agentes»; B es una flota de siempre.
  fijarGuardiaPerfil(async (t) => t === A);
  process.env.RESEND_API_KEY = 'llave-sintetica';
  await repo.crearBuzon(A, TOKEN_A);
});
afterEach(() => { fijarGuardiaPerfil(); });

// ── Atajos ──────────────────────────────────────────────────────────────────

/** El TMS falso con las consultas OPCIONALES del prechequeo (reque y caja), que el test mueve a voluntad. */
function tmsConReque(modo: Parameters<typeof crearTmsFalso>[0] = 'ok', reque: Existencia = 'existe') {
  const base = crearTmsFalso(modo);
  const valor = { reque, caja: 'existe' as Existencia };
  return Object.assign(base, { consultarReque: async () => valor.reque, consultarCaja: async () => valor.caja, valor });
}

function depsWorker(): DepsEnvios {
  return {
    reclamar: (l) => repoEnviosFalso.reclamar(l),
    leerEnvio: (t, id) => repoEnviosFalso.leer(t, id),
    actualizarEnvio: (t, id, d, c) => repoEnviosFalso.actualizar(t, id, d, c),
    marcarAlerta: (t, id) => repoEnviosFalso.marcarAlerta(t, id),
    liberarAlerta: (t, id) => repoEnviosFalso.liberarAlerta(t, id),
    leerDocumento: (t, id) => repo.leerDocumento(t, id),
    leerConfig: async () => config,
    salida: async (t) => puertos.get(t) ?? SIN_TMS,
    evento: async (t, d, tipo, detalle) => { await repo.registrarEvento(t, d, tipo, null, detalle); },
    // Las MISMAS reaperturas que usa la base real (`worker_envios_deps.ts`), sobre el repo en memoria.
    devolverARevision: async (t, d, v) => { await reabrirDocumento(t, d, v, null); },
    devolverPorRechazo: async (t, d, v, h, u) => { await reabrirPorRechazoTms(t, d, v, h, u); },
    huellasRechazadas: async (t, d) =>
      (await repoEnviosFalso.listarPorDocumento(t, d)).filter((x) => x.estado === 'rechazado_tms' && x.plantillaSha256 !== null).map((x) => x.plantillaSha256 as string),
    alertarEnvio: async (a) => { alertas.push(a); },
    alertarOperador: async () => undefined,
    ahora: () => ahoraMs,
  };
}

/** Copia al doble del worker los envíos que la aprobación dejó en `cp_envio_tms` (y los descartes que hizo una versión nueva). */
async function espejar(tenantId: string, documentoId: string): Promise<void> {
  for (const e of await repo.enviosDeDocumento(tenantId, documentoId)) {
    const previo = await repoEnviosFalso.leer(tenantId, e.id);
    if (!previo) {
      sembrarEnvio(tenantId, { id: e.id, documentoId, versionDoc: e.versionDoc, idempotencyKey: e.idempotencyKey, plantilla: e.plantilla, estado: e.estado, createdAt: new Date(ahoraMs).toISOString() });
    } else if (e.estado === 'descartado' && previo.estado !== 'descartado') {
      await repoEnviosFalso.actualizar(tenantId, e.id, [previo.estado], { estado: 'descartado', proximaRevision: null });
    }
  }
}

/** Una pasada del worker; después, el estado que dejó pasa al doble de documentos (en producción es la misma fila). */
async function pasada() {
  const r = await correrWorkerEnvios(depsWorker(), { venceEn: ahoraMs + HORIZONTE_MS });
  for (const f of estadoEnvios.filas) {
    const fila = estado.envios.find((x) => x.tenantId === f.tenantId && x.id === f.id);
    if (fila) fila.estado = f.estado;
  }
  return r;
}
const avanzar = (min: number) => { ahoraMs += min * MIN; };
const envioDe = async (tenantId: string, documentoId: string) => (await repoEnviosFalso.listarPorDocumento(tenantId, documentoId));
const doc = (id: string): DocumentoFila => estado.docs.get(id)!;
const tipos = (id: string) => estado.eventos.filter((e) => e.documentoId === id).map((e) => e.tipo);

/** La revisión de la oficina: lo que escribe la persona más CONFIRMAR toda duda que quede (los números ambiguos). */
async function revisar(tenantId: string, id: string, cambios: CambioCampo[]): Promise<DocumentoFila> {
  await abrirRevision(tenantId, id, ACTOR.id, new Date('2026-10-02T10:00:00Z'));
  let d = await corregirCampos(tenantId, id, doc(id).version, cambios, ACTOR.id);
  const e = d.extraccion as Extraccion;
  const dudas = (d.validacion?.hallazgos ?? []).filter((h) => h.severidad === 'confirmar' && !cambios.some((c) => c.campo === h.campo && c.renglon === h.renglon));
  if (dudas.length > 0) {
    d = await corregirCampos(tenantId, id, d.version, dudas.map((h) => ({
      campo: h.campo, renglon: h.renglon, confirmar: true,
      valor: (h.renglon === null ? e.campos[h.campo]?.valor : e.mercancias[h.renglon]?.[h.campo]?.valor) ?? null,
    })), ACTOR.id);
  }
  return d;
}

const aprobar = (tenantId: string, id: string) => aprobarDocumento(tenantId, id, doc(id).version, ACTOR, { ahora: new Date('2026-10-02T10:03:00Z') });

const depsCorreo = (bytes: Uint8Array, llm: () => LlmFalso): DepsCorreo => ({
  ...sinAgenteApagado, llm, restanteMs: () => 60_000,
  descargar: async () => ({ ok: true, bytes }),
});

/** M5 (Excel de 2 pestañas, fecha mes/día) entra POR CORREO: el perfil del cliente sabe su fecha; la oficina completa caja y cliente. */
async function m5PorCorreo(): Promise<string> {
  const bytes = excelM5();
  const d = detectarFormato(bytes);
  if (!d.ok) throw new Error('M5 ilegible');
  const p = perfilM5(await prepararContenido(bytes, d.clase));
  await repo.crearPerfil(A, { clave: p.clave, nombre: p.nombre, clienteId: null, formato: p.formato, firma: p.firma, mapeos: p.activa.mapeos, ejemplos: [], nota: null, documentoId: null, actorId: null });
  const r = await atenderCorreoCartaPorte(TOKEN_A, { emailId: 'em-m5', from: 'Logística <plan@cliente.example>', subject: 'Embarque DLV-8001', attachments: [{ id: 'a1', filename: 'dlv-8001.xlsx' }] },
    depsCorreo(bytes, () => llmFalso(guionM5())));
  expect(r).toMatchObject({ status: 200, cuerpo: { ok: true, recibidos: 1 } });
  const doc0 = [...estado.docs.values()].filter((x) => x.tenantId === A && x.canal === 'correo');
  expect(doc0).toHaveLength(1);
  expect(doc0[0].estado).toBe('por_revisar');
  return doc0[0].id;
}

const CAMBIOS_M5: CambioCampo[] = [
  { campo: 'caja_numero', renglon: null, valor: M5.caja },
  { campo: 'numero_cliente_interno', renglon: null, valor: '000123' },
];

/** M5 revisado y aprobado, con su envío ya en el doble del worker. */
async function m5Aprobado(): Promise<{ id: string; envioId: string }> {
  const id = await m5PorCorreo();
  const rev = await revisar(A, id, CAMBIOS_M5);
  expect(rev.validacion).toMatchObject({ bloqueos: 0, listoParaAprobar: true });
  const ap = await aprobar(A, id);
  expect(ap.documento.estado).toBe('aprobado');
  expect(ap.salida).toBeNull();
  expect(ap.envio).toMatchObject({ ok: true, creado: true });
  await espejar(A, id);
  const [envio] = await envioDe(A, id);
  expect(envio).toMatchObject({ estado: 'pendiente_prechequeo', versionDoc: doc(id).version });
  return { id, envioId: envio.id };
}

/** Bajo el perfil, NADA de viaje, borrador ni timbre existe. */
const sinViajeNiPac = () => {
  expect(estado.viajes).toHaveLength(0);
  expect(estado.mercancias).toHaveLength(0);
  expect(pac.crearProveedorSw).not.toHaveBeenCalled();
  expect(pac.resolverPac).not.toHaveBeenCalled();
  expect(pac.estadoPac).not.toHaveBeenCalled();
};

// ═══════════════════════════════════════════════════════════════════════════
// (1) El reque todavía no existe: se espera, se avisa UNA vez y, cuando aparece, sale con UN solo POST.
// ═══════════════════════════════════════════════════════════════════════════
describe('correo con Excel M5 → revisión → aprobar → el requerimiento no existe → reintentos → alerta → enviado', () => {
  it('prechequeo `no existe` ⇒ `pendiente_reque`; 6 reintentos con el reloj; UNA alerta; la persona reaprueba cuando el reque aparece y sale con UN POST', async () => {
    const { id, envioId } = await m5Aprobado();
    const tms = tmsConReque('ok', 'no_existe');
    puertos.set(A, tms);

    // 1.ª pasada: el prechequeo no encuentra el reque. Nada se sube; la oficina ve el motivo.
    expect(await pasada()).toMatchObject({ reclamados: 1, pendientesReque: 1, enviados: 0 });
    expect(await repoEnviosFalso.leer(A, envioId)).toMatchObject({ estado: 'pendiente_reque', intentos: 1, causaPendiente: 'El requerimiento no existe en el TMS.' });

    // No se vuelve a mirar antes de su hora (frecuencia 60 min).
    avanzar(30);
    expect((await pasada()).reclamados).toBe(0);
    avanzar(31);

    // Los 6 REINTENTOS (el 1.º es el de arriba + 6 = 7 revisiones): con el reloj avanzando 61 min entre una y otra.
    for (let i = 1; i <= 6; i++) {
      expect(await pasada(), `reintento ${i}`).toMatchObject({ reclamados: 1, pendientesReque: 1 });
      expect(await repoEnviosFalso.leer(A, envioId), `reintento ${i}`).toMatchObject({ estado: 'pendiente_reque', intentos: i + 1 });
      expect(alertas, `reintento ${i}`).toHaveLength(i === 6 ? 1 : 0);   // la alerta sale al AGOTAR, no antes
      avanzar(61);
    }

    // Agotado: UNA alerta, visible, sin más revisiones automáticas y 0 subidas.
    const agotado = (await repoEnviosFalso.leer(A, envioId))!;
    expect(agotado).toMatchObject({ estado: 'pendiente_reque', proximaRevision: SIN_MAS_REVISIONES });
    expect(agotado.alertaEnviadaEn).not.toBeNull();
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ motivo: 'reque_agotado', destinatario: 'oficina@flota-a.test', envioId, documentoId: id });
    expect(alertas[0].mensaje).not.toMatch(/[A-Z]{3,4}\d{6}/);   // la alerta no lleva RFC
    expect(tms.llamadas).toHaveLength(0);
    expect(tipos(id).filter((t) => t === 'envio_alertado')).toHaveLength(1);

    // Aparece el reque. Nadie reclama lo agotado (la alerta ya avisó): una persona lo retoma reabriendo y reaprobando.
    tms.valor.reque = 'existe';
    avanzar(24 * 60);
    expect((await pasada()).reclamados).toBe(0);
    const reabierto = await reabrirDocumento(A, id, doc(id).version, ACTOR.id);
    expect(reabierto.estado).toBe('por_revisar');
    const ap = await aprobar(A, id);
    expect(ap.envio).toMatchObject({ ok: true, creado: true, descartados: 1 });
    await espejar(A, id);
    expect(await pasada()).toMatchObject({ reclamados: 1, enviados: 1, errores: 0 });

    // UN solo POST en toda la historia, con la llave del envío NUEVO; el viejo quedó descartado.
    expect(tms.llamadas).toHaveLength(1);
    const todos = await envioDe(A, id);
    expect(todos.map((e) => e.estado).sort()).toEqual(['descartado', 'enviado']);
    const nuevo = todos.find((e) => e.estado === 'enviado')!;
    expect(tms.llamadas[0]).toMatchObject({ tenantId: A, idempotencyKey: nuevo.idempotencyKey, plantilla: 'normal' });
    expect(nuevo.idempotencyKey).not.toBe(agotado.idempotencyKey);
    expect(nuevo.referenciaTms).toMatch(/^REF-/);
    expect(alertas).toHaveLength(1);     // sigue siendo UNA
    expect(tipos(id)).toEqual(expect.arrayContaining(['aprobado', 'envio_pendiente_reque', 'envio_alertado', 'reabierto', 'envio_enviado']));

    // Bajo el perfil: ni viaje, ni borrador, ni una llamada al PAC.
    sinViajeNiPac();
  });

  it('si el reque aparece ANTES de agotar los reintentos, el MISMO envío sale solo, con UN POST y sin alerta', async () => {
    const { id, envioId } = await m5Aprobado();
    const tms = tmsConReque('ok', 'no_existe');
    puertos.set(A, tms);
    for (let i = 0; i < 3; i++) { await pasada(); avanzar(61); }
    expect(await repoEnviosFalso.leer(A, envioId)).toMatchObject({ estado: 'pendiente_reque', intentos: 3 });
    tms.valor.reque = 'existe';
    expect(await pasada()).toMatchObject({ reclamados: 1, enviados: 1 });
    expect(tms.llamadas).toHaveLength(1);
    expect(await repoEnviosFalso.leer(A, envioId)).toMatchObject({ estado: 'enviado' });
    expect(alertas).toHaveLength(0);
    expect((await envioDe(A, id))).toHaveLength(1);
    // Ya enviado, ninguna pasada posterior vuelve a subir.
    avanzar(24 * 60);
    expect((await pasada()).reclamados).toBe(0);
    expect(tms.llamadas).toHaveLength(1);
    sinViajeNiPac();
  });

  it('el archivo que sube es una plantilla XLSX real con los datos del embarque, y el TMS recibe la llave de idempotencia', async () => {
    const { envioId } = await m5Aprobado();
    const tms = tmsConReque('ok', 'existe');
    puertos.set(A, tms);
    await pasada();
    expect(tms.llamadas).toHaveLength(1);
    const e = tms.llamadas[0];
    expect(Array.from(e.archivo.slice(0, 2))).toEqual([0x50, 0x4b]);       // ZIP = .xlsx
    expect(e.nombre).toMatch(/\.xlsx$/);
    expect(e.metadatos).toMatchObject({ folio: M5.delivery, clienteInterno: '000123' });
    expect((await repoEnviosFalso.leer(A, envioId))!.plantillaSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(e.idempotencyKey).toBe((await repoEnviosFalso.leer(A, envioId))!.idempotencyKey);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (2) PDF M3 (español, decimales y miles): sin catálogo se queda en revisión y NO sale nada; con el catálogo, llega a `listo`.
// ═══════════════════════════════════════════════════════════════════════════
describe('PDF M3 (forma de remisión de exportación)', () => {
  const sembrarCatalogo = () => {
    const c = catalogoM3();
    estado.catalogoPartes.push(...c.partes.map((p) => ({ ...p, tenantId: A, clienteId: CLIENTE_M3 })));
    estado.catalogoProductos.push(...c.productos.map((p) => ({ ...p, tenantId: A, clienteId: CLIENTE_M3 })));
    estado.catalogoNumeros.push({ tenantId: A, clienteId: CLIENTE_M3, numeroInterno: '000777', numeroPagador: null, activo: true });
  };
  const subirM3 = async () => subirYProcesar(A, await pdfM3(), llmFalso(guionM3()), 'remision.pdf', { canal: 'correo', clienteId: CLIENTE_M3, remitente: 'logistica@cliente.example' });
  const mensajes = (id: string) => (doc(id).validacion?.hallazgos ?? []).filter((h) => h.severidad === 'bloqueo').map((h) => h.mensaje).join(' | ');

  it('SIN catálogo: queda `por_revisar` con bloqueos (claves de producto y RFC del remitente), no se puede aprobar y hay 0 envíos', async () => {
    const r = await subirM3();
    expect(r.proceso).toMatchObject({ ok: true, estado: 'por_revisar', listoParaAprobar: false });
    expect(doc(r.documentoId).validacion!.bloqueos).toBeGreaterThan(14);
    expect(mensajes(r.documentoId)).toMatch(/RFC del remitente/);
    expect(mensajes(r.documentoId)).toMatch(/Mercancía 1 · Clave de producto/);
    await expect(aprobar(A, r.documentoId)).rejects.toThrow(/No se puede aprobar todavía/);
    expect(doc(r.documentoId).estado).toBe('por_revisar');

    // El worker no tiene nada que enviar: 0 reclamos, 0 subidas, ningún envío en la base.
    const tms = tmsConReque('ok', 'existe');
    puertos.set(A, tms);
    expect(await pasada()).toMatchObject({ reclamados: 0, enviados: 0 });
    expect(tms.llamadas).toHaveLength(0);
    expect(estado.envios).toHaveLength(0);
    expect(estadoEnvios.filas).toHaveLength(0);
    sinViajeNiPac();
  });

  it('CON el catálogo del cliente: el RFC del remitente y las 14 claves ya vienen resueltos; con lo que falta, aprueba y el envío llega a `listo` (modo descarga) sin subir nada', async () => {
    sembrarCatalogo();
    const r = await subirM3();
    expect(r.proceso).toMatchObject({ ok: true, estado: 'por_revisar' });
    const falta = mensajes(r.documentoId);
    expect(falta).not.toMatch(/RFC del remitente/);
    expect(falta).not.toMatch(/Clave de producto/);
    expect(falta).toMatch(/RFC del destinatario/);          // lo que el catálogo no sabe lo completa una persona
    expect(doc(r.documentoId).extraccion!.campos.numero_cliente_interno?.valor).toBe('000777');

    const total = (14028.96).toFixed(2);
    const rev = await revisar(A, r.documentoId, [
      { campo: 'origen_cp', renglon: null, valor: '44100' },
      { campo: 'destino_rfc', renglon: null, valor: RFC_DORADO.m5DestinatarioFisica },
      { campo: 'destino_cp', renglon: null, valor: '76000' },
      { campo: 'peso_bruto_total', renglon: null, valor: total },
    ]);
    expect(rev.validacion, mensajes(r.documentoId)).toMatchObject({ bloqueos: 0, listoParaAprobar: true });
    const ap = await aprobar(A, r.documentoId);
    expect(ap.documento.estado).toBe('aprobado');
    expect(ap.envio).toMatchObject({ ok: true, creado: true });
    await espejar(A, r.documentoId);

    // Modo descarga: no hay TMS que consultar ni al que subir; el envío espera a que una persona descargue la plantilla.
    config = { ...config, modo: 'descarga' };
    const tms = tmsConReque('ok', 'no_existe');            // aun si existiera, en modo manual no se consulta
    puertos.set(A, tms);
    expect(await pasada()).toMatchObject({ reclamados: 1, enviados: 0, enEsperaManual: 1 });
    const [envio] = await envioDe(A, r.documentoId);
    expect(envio).toMatchObject({ estado: 'listo', intentos: 0 });
    expect(tms.llamadas).toHaveLength(0);

    // El aviso de ÉXITO en modo manual (`listo_manual`, worker_envios.ts:avisarListoManual): nadie más va a decir que
    // ya se puede subir a mano, así que la cadena REAL tiene que dejarlo en `alertas` con el texto exacto que arma el
    // worker (el texto FORMATEADO del canal real — `textoAlerta('listo_manual', …)` — lo prueba alerta_envio.test.ts;
    // aquí lo que viaja por `DepsEnvios.alertarEnvio` es el mensaje crudo, antes de ese formateo).
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({
      tenantId: A,
      envioId: envio.id,
      documentoId: r.documentoId,
      motivo: 'listo_manual',
      destinatario: 'oficina@flota-a.test',
      mensaje: 'La Carta Porte ya está lista para subir al sistema del cliente.',
    });
    expect(tipos(r.documentoId)).toEqual(expect.arrayContaining(['envio_alertado']));
    sinViajeNiPac();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (3) El TMS rechaza el contenido (`validacion`): vuelve a la bandeja, se corrige y se reenvía con llave NUEVA.
// ═══════════════════════════════════════════════════════════════════════════
describe('el sistema del cliente rechaza la plantilla', () => {
  it('rechazo ⇒ el documento vuelve a revisión con el bloqueo del cliente y UNA alerta; corregir ⇒ reaprobar ⇒ reenvío con llave nueva ⇒ enviado', async () => {
    const { id, envioId } = await m5Aprobado();
    const rechaza = tmsConReque('validacion', 'existe');
    puertos.set(A, rechaza);

    expect(await pasada()).toMatchObject({ reclamados: 1, enviados: 0, rechazados: 1, devueltosARevision: 1, errores: 0 });
    expect(rechaza.llamadas).toHaveLength(1);
    const rechazado = (await repoEnviosFalso.leer(A, envioId))!;
    expect(rechazado).toMatchObject({ estado: 'rechazado_tms' });
    expect(rechazado.plantillaSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ motivo: 'rechazado_tms', envioId, documentoId: id });

    // El documento está de vuelta en la bandeja, con el motivo del cliente como BLOQUEO y la causa del rechazo.
    expect(doc(id)).toMatchObject({ estado: 'por_revisar' });
    expect(estado.docs.get(id)).toMatchObject({ rechazoCausa: 'tms_rechazo' });
    const delTms = doc(id).validacion!.hallazgos.filter((h) => h.origen === 'tms');
    expect(delTms.length).toBeGreaterThan(0);
    expect(delTms.every((h) => h.severidad === 'bloqueo')).toBe(true);
    expect(doc(id).validacion!.listoParaAprobar).toBe(false);
    expect(tipos(id)).toEqual(expect.arrayContaining(['envio_rechazado', 'reabierto']));

    // Confirmar sin corregir NO levanta el bloqueo: no se reaprueba el mismo contenido a ciegas.
    await abrirRevision(A, id, ACTOR.id, new Date('2026-10-02T11:00:00Z'));
    await expect(aprobar(A, id)).rejects.toThrow(/No se puede aprobar todavía/);

    // La persona corrige un dato (el peso del primer renglón) y reaprueba: envío NUEVO, llave NUEVA.
    const pesoAntes = (doc(id).extraccion as Extraccion).mercancias[0].peso_kg.valor;
    expect(pesoAntes).toBe(M5.productos[0].kilos);
    await corregirCampos(A, id, doc(id).version, [{ campo: 'peso_kg', renglon: 0, valor: '11120.6' }], ACTOR.id);
    const rev = doc(id).validacion!;
    expect(rev.listoParaAprobar, JSON.stringify(rev.hallazgos.filter((h) => h.severidad !== 'aviso'))).toBe(true);
    const ap = await aprobar(A, id);
    expect(ap.envio).toMatchObject({ ok: true, creado: true });
    await espejar(A, id);

    const bueno = tmsConReque('ok', 'existe');
    puertos.set(A, bueno);
    expect(await pasada()).toMatchObject({ reclamados: 1, enviados: 1, descartados: 0 });
    expect(bueno.llamadas).toHaveLength(1);
    const todos = await envioDe(A, id);
    expect(todos.map((e) => e.estado).sort()).toEqual(['enviado', 'rechazado_tms']);
    const nuevo = todos.find((e) => e.estado === 'enviado')!;
    expect(nuevo.idempotencyKey).not.toBe(rechazado.idempotencyKey);
    expect(bueno.llamadas[0].idempotencyKey).toBe(nuevo.idempotencyKey);
    expect(nuevo.plantillaSha256).not.toBe(rechazado.plantillaSha256);      // la plantilla cambió de verdad
    expect(todos.find((e) => e.estado === 'rechazado_tms')).toMatchObject({ id: envioId });  // el rechazo viejo queda como historia
    expect(alertas).toHaveLength(1);
    sinViajeNiPac();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (4)+(5) Dos flotas, el MISMO documento: la del perfil prepara el envío; la de siempre crea el viaje.
// ═══════════════════════════════════════════════════════════════════════════
describe('perfil vs. sin perfil', () => {
  it('flota CON perfil: 0 viajes, 0 mercancías de viaje, 0 llamadas al PAC; flota SIN perfil: la salida a viaje de siempre y 0 envíos', async () => {
    const { id } = await m5Aprobado();                    // A (perfil): aprobado ⇒ envío
    expect(estado.viajes).toHaveLength(0);
    expect((await repo.enviosDeDocumento(A, id))).toHaveLength(1);

    // B: otra flota de siempre, un PDF que sí trae operador y unidad (formato Boreal del e2e previo).
    const { pdfBoreal } = await import('../carta_porte_docs/documentos_sinteticos.fixture');
    const { llmBoreal } = await import('../carta_porte_docs/escenario.fixture');
    const rB = await subirYProcesar(B, await pdfBoreal(), llmBoreal(), 'orden.pdf', { clienteId: 'cli-b' });
    expect(rB.proceso).toMatchObject({ ok: true, estado: 'por_revisar' });
    const apB = await aprobarDocumento(B, rB.documentoId, doc(rB.documentoId).version, { id: 'uuuuuuuu-uuuu-4uuu-8uuu-bbbbbbbbbbbb' }, { operadorId: 'op-b1' });
    expect(apB.documento.estado).toBe('aprobado');
    expect(apB.envio).toBeNull();
    expect(apB.salida).toMatchObject({ ok: true, accion: 'creado' });
    expect(estado.viajes.filter((v) => v.tenantId === B)).toHaveLength(1);
    expect(estado.viajes.filter((v) => v.tenantId === A)).toHaveLength(0);
    expect(estado.envios.filter((e) => e.tenantId === B)).toHaveLength(0);

    // Y el worker de envíos no toca a B (no tiene envíos) ni crea viajes para A.
    puertos.set(A, tmsConReque('ok', 'existe'));
    await espejar(A, id);
    await pasada();
    expect(estado.viajes.filter((v) => v.tenantId === A)).toHaveLength(0);
    expect(pac.crearProveedorSw).not.toHaveBeenCalled();
    expect(pac.resolverPac).not.toHaveBeenCalled();
  });
});
