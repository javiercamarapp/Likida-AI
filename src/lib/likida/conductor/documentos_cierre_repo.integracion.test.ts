import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria, type RestriccionUnica } from '@/lib/pruebas/tablas_en_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-53/54 (0823) — LOS DOCUMENTOS DE CIERRE CONTRA UNA BASE «REAL» (en memoria, con los UNIQUE
// y los filtros de verdad), NO contra un mock de `repo_validacion.ts`.
//
// Por qué existe: las 3 pruebas que tocan este flujo (route.test.ts de /v1/evidencias,
// processor_hitos.test.ts, documentos_cierre.test.ts) mockean COMPLETO `conductor/repo_validacion.ts` o
// prueban solo la lógica pura sin I/O. `supabase/tests/0823_documentos_cierre_evidencia.sql` prueba el
// esquema en Postgres real, pero nunca ejercita el código TypeScript. Nada corre las funciones REALES de
// `repo_validacion.ts` (`crearSolicitudDocumentosCierre`, `leerDocumentosCierre`,
// `guardarEvidenciaDocumentoCierre`, `documentoCierreDeLaFoto`, `registrarFotoDocumentoCierre`) contra algo
// que aplique columnas, filtros y restricciones UNIQUE de verdad: un desajuste real entre las queries y el
// esquema de las migraciones 0809/0823 pasaría `npx vitest run` completo sin que ninguna prueba lo note.
//
// Este archivo tapa ese hueco con `tablas_en_memoria.fixture.ts` (la misma base en memoria que ya usa
// `trabajo_reparto.test.ts` para el reparto del Conductor): aplica `select/insert/update`, `eq/in/order`,
// y hace cumplir el UNIQUE real de `viaje_documento_cierre` (viaje_id, documento_requerido_id) — el que
// vuelve idempotente a `crearSolicitudDocumentosCierre` — y el de `viaje_hito_evidencia` (viaje_hito_id,
// ciclo, sha256) — el que detecta la foto duplicada. Las columnas y los nombres de tabla son los de las
// migraciones 0809_catalogo_documentos_cliente.sql y 0823_documentos_cierre_evidencia.sql; un cambio de
// columna en una sin el otro hace tronar esta prueba, no solo producción.
// ═══════════════════════════════════════════════════════════════════════════

const estado: { db: BaseEnMemoria } = { db: undefined as unknown as BaseEnMemoria };
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger }));

const {
  crearSolicitudDocumentosCierre, leerDocumentosCierre, guardarEvidenciaDocumentoCierre,
  guardarEvidenciaDocumentoCierreSinCategoria, documentoCierreDeLaFoto, registrarFotoDocumentoCierre,
} = await import('./repo_validacion');
const { MENSAJE_SIN_CATEGORIA_DOCUMENTO, MENSAJE_FOTO_DOCUMENTO_FALLO } = await import('./documentos_cierre');

// El UNIQUE real de cada tabla (0809/0823): sin ellos, la base en memoria no detectaría la duplicación
// que SÍ detecta Postgres, y la prueba certificaría una idempotencia que no existe.
const RESTRICCIONES: RestriccionUnica[] = [
  { tabla: 'viaje_documento_cierre', nombre: 'viaje_documento_cierre_unico', columnas: ['viaje_id', 'documento_requerido_id'] },
  { tabla: 'viaje_hito_evidencia', nombre: 'viaje_hito_evidencia_unica', columnas: ['viaje_hito_id', 'ciclo', 'sha256'] },
];

const T = 'ten-a';
const VIAJE = 'viaje-1';
const CLIENTE = 'cli-1';
const AHORA = new Date('2026-10-20T12:00:00Z');
const HITO = { id: 'hito-1', viajeId: VIAJE, ciclo: 1 };

/**
 * Una fila del catálogo del cliente (0809), tal cual la deja `cliente_documento_requerido`. Lleva su propio `id`
 * porque este fixture (a diferencia de la base real) solo lo genera en un INSERT por la Consulta, no cuando la
 * prueba empuja la fila directo al arreglo — sin `id`, `filaADocumento` (repo.ts) la descarta por silenciosa.
 */
let idDoc = 0;
const docCatalogo = (nombre: string, tipo: 'basico' | 'complementario', extra: Record<string, unknown> = {}) => ({
  id: `pdc-${(idDoc += 1)}`, tenant_id: T, cliente_id: CLIENTE, nombre, tipo, requiere_firma: false, requiere_sello: false, ...extra,
});

beforeEach(() => {
  logger.info.mockClear(); logger.warn.mockClear(); logger.error.mockClear();
  estado.db = crearBaseEnMemoria({}, RESTRICCIONES);
});

describe('crearSolicitudDocumentosCierre + leerDocumentosCierre (0809 → 0823)', () => {
  it('sin clienteId no pide nada y no toca la base', async () => {
    const r = await crearSolicitudDocumentosCierre(T, VIAJE, null, AHORA);
    expect(r).toEqual([]);
    expect(estado.db.tabla('viaje_documento_cierre')).toHaveLength(0);
  });

  it('cliente sin catálogo (sin filas en cliente_documento_requerido) tampoco pide nada', async () => {
    const r = await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    expect(r).toEqual([]);
    expect(estado.db.tabla('viaje_documento_cierre')).toHaveLength(0);
  });

  it('con catálogo (básicos primero, luego complementarios) arma el snapshot — nombre/tipo exactos de la 0809', async () => {
    estado.db.tabla('cliente_documento_requerido').push(
      docCatalogo('Pedimento', 'complementario'),
      docCatalogo('Carta porte firmada y sellada', 'basico'),
      docCatalogo('DODA', 'complementario'),
      // De OTRO cliente de la misma flota: no debe filtrarse al snapshot de CLIENTE.
      docCatalogo('Factura cliente B', 'basico', { cliente_id: 'cli-2' }),
    );
    const r = await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    expect(r.map((d) => d.nombreSolicitado)).toEqual(['Carta porte firmada y sellada', 'DODA', 'Pedimento']);
    expect(r.every((d) => d.tenantId === T && d.viajeId === VIAJE && d.estado === 'pendiente' && d.recibidoEn === null)).toBe(true);
    expect(r.find((d) => d.nombreSolicitado === 'Pedimento')?.tipoSolicitado).toBe('complementario');

    // La fila REAL en la tabla, con las columnas de la migración 0823 (snake_case, el snapshot).
    const filas = estado.db.tabla('viaje_documento_cierre');
    expect(filas).toHaveLength(3);
    expect(filas[0]).toMatchObject({ tenant_id: T, viaje_id: VIAJE, estado: 'pendiente', solicitado_en: AHORA.toISOString() });

    // leerDocumentosCierre, independiente, ve EXACTAMENTE lo mismo (mismo orden: nombre, luego id).
    expect((await leerDocumentosCierre(T, VIAJE)).map((d) => d.id)).toEqual(r.map((d) => d.id));
  });

  it('es idempotente: llamarla dos veces NO duplica (el UNIQUE real de viaje_id+documento_requerido_id)', async () => {
    estado.db.tabla('cliente_documento_requerido').push(docCatalogo('Carta porte firmada y sellada', 'basico'));
    const r1 = await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    const r2 = await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, new Date('2026-10-21T00:00:00Z'));
    expect(estado.db.tabla('viaje_documento_cierre')).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r2[0].id).toBe(r1[0].id);
    expect(r2[0].solicitadoEn).toBe(r1[0].solicitadoEn); // la segunda llamada NO reescribió el snapshot
  });

  it('leerDocumentosCierre no inventa nada de otro viaje o de otra flota', async () => {
    estado.db.tabla('cliente_documento_requerido').push(docCatalogo('Carta porte firmada y sellada', 'basico'));
    await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    expect(await leerDocumentosCierre(T, 'otro-viaje')).toEqual([]);
    expect(await leerDocumentosCierre('otra-flota', VIAJE)).toEqual([]);
  });
});

describe('documentoCierreDeLaFoto', () => {
  beforeEach(async () => {
    estado.db.tabla('cliente_documento_requerido').push(
      docCatalogo('Carta porte firmada y sellada', 'basico'),
      docCatalogo('Pedimento', 'complementario'),
    );
    await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
  });

  it('sin solicitud viva (otro viaje) devuelve null: la foto sigue su camino normal', async () => {
    expect(await documentoCierreDeLaFoto(T, 'sin-solicitud', 'Pedimento')).toBeNull();
  });

  it('caption que calza con un pendiente: devuelve ese documentoId y la lista de pendientes', async () => {
    const r = await documentoCierreDeLaFoto(T, VIAJE, 'Pedimento');
    expect(r).not.toBeNull();
    expect(r!.pendientes).toHaveLength(2);
    const esperado = r!.pendientes.find((p) => p.nombreSolicitado === 'Pedimento')!.documentoRequeridoId;
    expect(r!.documentoId).toBe(esperado);
  });

  it('caption que NO calza con ningún pendiente: documentoId null, pero sigue trayendo los pendientes (queda «por revisar»)', async () => {
    const r = await documentoCierreDeLaFoto(T, VIAJE, 'una foto cualquiera');
    expect(r).toMatchObject({ documentoId: null });
    expect(r!.pendientes).toHaveLength(2);
  });

  it('cuando ya no queda ningún pendiente, devuelve null', async () => {
    const [pod] = await leerDocumentosCierre(T, VIAJE);
    await guardarEvidenciaDocumentoCierre({
      tenantId: T, hito: HITO, documentoCierreId: pod.id, documentoRequeridoId: pod.documentoRequeridoId,
      ruta: `${T}/foto1.jpg`, sha256: 'a'.repeat(64), waMessageId: 'wa-1', accion: 'aceptar_ok', intentos: 0, ahora: AHORA,
    });
    const [otro] = (await leerDocumentosCierre(T, VIAJE)).filter((d) => d.id !== pod.id);
    await guardarEvidenciaDocumentoCierre({
      tenantId: T, hito: HITO, documentoCierreId: otro.id, documentoRequeridoId: otro.documentoRequeridoId,
      ruta: `${T}/foto2.jpg`, sha256: 'b'.repeat(64), waMessageId: 'wa-2', accion: 'aceptar_ok', intentos: 0, ahora: AHORA,
    });
    expect(await documentoCierreDeLaFoto(T, VIAJE, 'cualquiera')).toBeNull();
  });
});

describe('guardarEvidenciaDocumentoCierre — escritura real contra viaje_hito_evidencia + viaje_documento_cierre', () => {
  it('ruta de OTRA flota se rechaza SIN tocar la base (defensa de tenant)', async () => {
    estado.db.tabla('cliente_documento_requerido').push(docCatalogo('Carta porte firmada y sellada', 'basico'));
    const [pod] = await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    const r = await guardarEvidenciaDocumentoCierre({
      tenantId: T, hito: HITO, documentoCierreId: pod.id, documentoRequeridoId: pod.documentoRequeridoId,
      ruta: 'otra-flota/foto.jpg', sha256: 'a'.repeat(64), waMessageId: 'wa-1', accion: 'aceptar_ok', intentos: 0, ahora: AHORA,
    });
    expect(r).toBe('fallo');
    expect(estado.db.tabla('viaje_hito_evidencia')).toHaveLength(0);
    expect(estado.db.tabla('viaje_documento_cierre')[0].estado).toBe('pendiente');
  });

  it('`aceptar_ok`: guarda la evidencia con documento_requerido_id y CIERRA la fila (estado recibido, recibido_en, viaje_hito_evidencia_id)', async () => {
    estado.db.tabla('cliente_documento_requerido').push(docCatalogo('Carta porte firmada y sellada', 'basico'));
    const [pod] = await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    const r = await guardarEvidenciaDocumentoCierre({
      tenantId: T, hito: HITO, documentoCierreId: pod.id, documentoRequeridoId: pod.documentoRequeridoId,
      ruta: `${T}/foto.jpg`, sha256: 'a'.repeat(64), waMessageId: 'wa-1', accion: 'aceptar_ok', intentos: 0, ahora: AHORA,
    });
    expect(r).toBe('ok');

    const [ev] = estado.db.tabla('viaje_hito_evidencia');
    expect(ev).toMatchObject({
      tenant_id: T, viaje_id: VIAJE, viaje_hito_id: HITO.id, ciclo: HITO.ciclo, tipo: 'documento_cierre',
      ruta: `${T}/foto.jpg`, sha256: 'a'.repeat(64), wa_message_id: 'wa-1', documento_requerido_id: pod.documentoRequeridoId,
    });

    const [fila] = await leerDocumentosCierre(T, VIAJE);
    expect(fila).toMatchObject({ estado: 'recibido', recibidoEn: AHORA.toISOString(), viajeHitoEvidenciaId: ev.id as string, intentosLegibilidad: 0 });
  });

  it('`pedir_repetir`: la evidencia SÍ se guarda (nunca se pierde la foto), pero la fila sigue `pendiente` sin recibido_en, con el intento anotado', async () => {
    estado.db.tabla('cliente_documento_requerido').push(docCatalogo('Carta porte firmada y sellada', 'basico'));
    const [pod] = await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    const r = await guardarEvidenciaDocumentoCierre({
      tenantId: T, hito: HITO, documentoCierreId: pod.id, documentoRequeridoId: pod.documentoRequeridoId,
      ruta: `${T}/chica.jpg`, sha256: 'c'.repeat(64), waMessageId: 'wa-2', accion: 'pedir_repetir', intentos: 1, ahora: AHORA,
    });
    expect(r).toBe('ok');
    expect(estado.db.tabla('viaje_hito_evidencia')).toHaveLength(1);
    const [fila] = await leerDocumentosCierre(T, VIAJE);
    expect(fila).toMatchObject({ estado: 'pendiente', recibidoEn: null, intentosLegibilidad: 1 });
  });

  it('misma foto (viaje_hito_id + ciclo + sha256) dos veces: la SEGUNDA es `duplicada` y no deja una segunda fila de evidencia ni reabre el documento', async () => {
    estado.db.tabla('cliente_documento_requerido').push(docCatalogo('Carta porte firmada y sellada', 'basico'));
    const [pod] = await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    const sha = 'd'.repeat(64);
    const uno = await guardarEvidenciaDocumentoCierre({
      tenantId: T, hito: HITO, documentoCierreId: pod.id, documentoRequeridoId: pod.documentoRequeridoId,
      ruta: `${T}/foto.jpg`, sha256: sha, waMessageId: 'wa-3', accion: 'aceptar_ok', intentos: 0, ahora: AHORA,
    });
    expect(uno).toBe('ok');
    const dos = await guardarEvidenciaDocumentoCierre({
      tenantId: T, hito: HITO, documentoCierreId: pod.id, documentoRequeridoId: pod.documentoRequeridoId,
      ruta: `${T}/foto.jpg`, sha256: sha, waMessageId: 'wa-4', accion: 'aceptar_ok', intentos: 0, ahora: AHORA,
    });
    expect(dos).toBe('duplicada');
    expect(estado.db.tabla('viaje_hito_evidencia')).toHaveLength(1);
  });
});

describe('registrarFotoDocumentoCierre — el camino completo, foto → clasificación → cierre', () => {
  it('sin categoría clara (documentoId null): la guarda SIN documento_requerido_id y responde el acuse de «sin categoría»', async () => {
    const msg = await registrarFotoDocumentoCierre({
      tenantId: T, hito: HITO, documentoId: null, pendientes: [], ruta: `${T}/foto.jpg`, sha256: 'e'.repeat(64), waMessageId: 'wa-5', ahora: AHORA,
    });
    expect(msg).toBe(MENSAJE_SIN_CATEGORIA_DOCUMENTO);
    expect(estado.db.tabla('viaje_hito_evidencia')[0]).toMatchObject({ documento_requerido_id: null, tipo: 'documento_cierre' });
  });

  it('round-trip real: catálogo → solicitud → caption calza → foto legible → la fila queda `recibido` y leerDocumentosCierre lo confirma', async () => {
    estado.db.tabla('cliente_documento_requerido').push(docCatalogo('Carta porte firmada y sellada', 'basico'));
    await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);

    const previo = await documentoCierreDeLaFoto(T, VIAJE, 'Carta porte firmada y sellada');
    expect(previo).not.toBeNull();
    expect(previo!.documentoId).not.toBeNull();

    const msg = await registrarFotoDocumentoCierre({
      tenantId: T, hito: HITO, documentoId: previo!.documentoId, pendientes: previo!.pendientes,
      ruta: `${T}/carta-porte.jpg`, sha256: 'f'.repeat(64), waMessageId: 'wa-6', ahora: AHORA,
    });
    expect(msg).toBe('Recibí tu foto de Carta porte firmada y sellada ✅.');

    const [fila] = await leerDocumentosCierre(T, VIAJE);
    expect(fila).toMatchObject({ estado: 'recibido', intentosLegibilidad: 0 });
    expect(fila.viajeHitoEvidenciaId).not.toBeNull();
  });

  it('foto chica (metadatos reales) en una fila que YA llevaba un intento: pide repetir y la deja `pendiente`, contador en 2 en el SEGUNDO fallo acepta `revisar`', async () => {
    estado.db.tabla('cliente_documento_requerido').push(docCatalogo('Carta porte firmada y sellada', 'basico'));
    await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    const previo1 = await documentoCierreDeLaFoto(T, VIAJE, 'Carta porte firmada y sellada');

    const msg1 = await registrarFotoDocumentoCierre({
      tenantId: T, hito: HITO, documentoId: previo1!.documentoId, pendientes: previo1!.pendientes,
      ruta: `${T}/chica1.jpg`, sha256: '1'.repeat(64), waMessageId: 'wa-7', metadatos: { anchoPx: 100 }, ahora: AHORA,
    });
    expect(msg1).toMatch(/se ve chica, oscura o borrosa/);
    let [fila] = await leerDocumentosCierre(T, VIAJE);
    expect(fila).toMatchObject({ estado: 'pendiente', intentosLegibilidad: 1 });

    // Segundo intento, fila YA pendiente con 1 intento previo: `decidirFotoDocumento` acepta con `revisar`.
    const previo2 = await documentoCierreDeLaFoto(T, VIAJE, 'Carta porte firmada y sellada');
    const msg2 = await registrarFotoDocumentoCierre({
      tenantId: T, hito: HITO, documentoId: previo2!.documentoId, pendientes: previo2!.pendientes,
      ruta: `${T}/chica2.jpg`, sha256: '2'.repeat(64), waMessageId: 'wa-8', metadatos: { anchoPx: 100 }, ahora: AHORA,
    });
    expect(msg2).toMatch(/la dejo así/);
    [fila] = await leerDocumentosCierre(T, VIAJE);
    expect(fila).toMatchObject({ estado: 'revisar', intentosLegibilidad: 2 });
    expect(estado.db.tabla('viaje_hito_evidencia')).toHaveLength(2); // las DOS fotos quedaron guardadas, ninguna se perdió
  });

  it('carrera: el documento ya no está pendiente (otra foto lo resolvió primero) — responde «sin categoría», nunca lanza', async () => {
    estado.db.tabla('cliente_documento_requerido').push(docCatalogo('Carta porte firmada y sellada', 'basico'));
    const [pod] = await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    // Alguien más ya lo cerró entre que se leyó `pendientes` y que llega esta foto.
    const msg = await registrarFotoDocumentoCierre({
      tenantId: T, hito: HITO, documentoId: pod.documentoRequeridoId, pendientes: [], ruta: `${T}/tarde.jpg`, sha256: '3'.repeat(64), waMessageId: 'wa-9', ahora: AHORA,
    });
    expect(msg).toBe(MENSAJE_SIN_CATEGORIA_DOCUMENTO);
  });

  it('un fallo de la base (select de viaje_documento_cierre) nunca lanza: responde el acuse de fallo', async () => {
    estado.db.tabla('cliente_documento_requerido').push(docCatalogo('Carta porte firmada y sellada', 'basico'));
    const [pod] = await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    estado.db.fallarProxima('viaje_documento_cierre', 'update', { message: 'conexión perdida' });
    const msg = await registrarFotoDocumentoCierre({
      tenantId: T, hito: HITO, documentoId: pod.documentoRequeridoId, pendientes: [pod], ruta: `${T}/foto.jpg`, sha256: '4'.repeat(64), waMessageId: 'wa-10', ahora: AHORA,
    });
    // `guardarEvidenciaDocumentoCierre` solo LOGUEA si el update final falla (el insert de la evidencia sí quedó) — sigue devolviendo el acuse normal.
    expect(msg).toBe('Recibí tu foto de Carta porte firmada y sellada ✅.');
    expect(logger.warn).toHaveBeenCalledWith('conductor.documento_cierre_estado_no_anotado', expect.objectContaining({ documento: pod.id }));
  });
});

// Confirma que `guardarEvidenciaDocumentoCierreSinCategoria` también respeta el UNIQUE real (no solo su envoltura).
describe('guardarEvidenciaDocumentoCierreSinCategoria', () => {
  it('la misma foto (hito+ciclo+sha) sin categoría, dos veces, es `duplicada` la segunda', async () => {
    const sha = '5'.repeat(64);
    const uno = await guardarEvidenciaDocumentoCierreSinCategoria({ tenantId: T, hito: HITO, ruta: `${T}/a.jpg`, sha256: sha, waMessageId: 'wa-11' });
    const dos = await guardarEvidenciaDocumentoCierreSinCategoria({ tenantId: T, hito: HITO, ruta: `${T}/a.jpg`, sha256: sha, waMessageId: 'wa-12' });
    expect(uno).toBe('ok');
    expect(dos).toBe('duplicada');
    expect(estado.db.tabla('viaje_hito_evidencia')).toHaveLength(1);
  });
});

// Se evita el falso positivo contrario: que todo pase porque el acuse de fallo nunca se activó en la prueba de arriba.
describe('MENSAJE_FOTO_DOCUMENTO_FALLO sigue siendo alcanzable (red de seguridad real)', () => {
  it('si el INSERT de la evidencia mismo falla por una causa que no es 23505, responde el acuse de fallo', async () => {
    estado.db.tabla('cliente_documento_requerido').push(docCatalogo('Carta porte firmada y sellada', 'basico'));
    const [pod] = await crearSolicitudDocumentosCierre(T, VIAJE, CLIENTE, AHORA);
    estado.db.fallarProxima('viaje_hito_evidencia', 'insert', { message: 'disco lleno' });
    const msg = await registrarFotoDocumentoCierre({
      tenantId: T, hito: HITO, documentoId: pod.documentoRequeridoId, pendientes: [pod], ruta: `${T}/foto.jpg`, sha256: '6'.repeat(64), waMessageId: 'wa-13', ahora: AHORA,
    });
    expect(msg).toBe(MENSAJE_FOTO_DOCUMENTO_FALLO);
  });
});
