// ═══════════════════════════════════════════════════════════════════════════
// ESCRITURA DE CREDENCIALES DE CONECTOR (C2, auditoría 4).
//
// Lo que se fija aquí es el contrato del puente entre el formulario y la 0094:
//   · sin LIKIDA_COFRE_LLAVE se lanza DICIENDO qué falta, sin tocar la base;
//   · las requeridas faltantes lanzan ANTES de cifrar nada;
//   · al UPSERT viaja el CIFRADO (jamás un JSON en claro — el CHECK
//     `conector_credencial_no_en_claro` lo rechazaría) y pistas SIN el secreto;
//   · solo los campos DECLARADOS por el conector entran al cofre;
//   · listar jamás selecciona `valores_cifrados`;
//   · desactivar con 0 filas tocadas NO es éxito;
//   · el secreto no viaja a la bitácora ni al logger.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Registro = {
  tabla: string;
  op: string | null;
  payload: unknown;
  opts: unknown;
  eq: Array<[string, unknown]>;
  select: string | null;
  orden: Array<[string, unknown]>;
};

const llamadas: Registro[] = [];
const respuestas = new Map<string, { data: unknown; error: { message: string } | null }>();

function builder(tabla: string) {
  const r: Registro = { tabla, op: null, payload: null, opts: null, eq: [], select: null, orden: [] };
  llamadas.push(r);
  const respuesta = () => respuestas.get(tabla) ?? { data: null, error: null };
  const b: Record<string, unknown> = {};
  b.insert = (p: unknown) => { r.op = 'insert'; r.payload = p; return b; };
  b.upsert = (p: unknown, o: unknown) => { r.op = 'upsert'; r.payload = p; r.opts = o; return b; };
  b.update = (p: unknown) => { r.op = 'update'; r.payload = p; return b; };
  b.select = (cols: string) => { r.select = cols; if (!r.op) r.op = 'select'; return b; };
  b.eq = (c: string, v: unknown) => { r.eq.push([c, v]); return b; };
  b.order = (c: string, o: unknown) => { r.orden.push([c, o]); return b; };
  b.single = async () => respuesta();
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(respuesta()).then(res, rej);
  return b;
}

const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: logs }));

const { guardarCredencial, listarCredenciales, desactivarCredencial } = await import('./credenciales');
const { descifrar } = await import('./cofre');
const { DatoInvalido } = await import('../errores');

const TENANT = 't-flota-1';
const LLAVE = 'una-llave-de-pruebas-suficientemente-larga-1234';
const SECRETO = 'S3cr3t0-de-sap-larguisimo';

// Valores completos para `sap_b1` (requeridas: base_url, company_db, usuario,
// password). Se prueba contra el conector REAL del catálogo, no un stub: si
// SAP cambia sus campos, este test tiene que enterarse.
const VALORES_SAP = {
  base_url: 'https://sap.cliente.mx:50000',
  company_db: 'FLOTA_MX',
  usuario: 'likida',
  password: SECRETO,
};

const llaveOriginal = process.env.LIKIDA_COFRE_LLAVE;
beforeEach(() => {
  llamadas.length = 0;
  respuestas.clear();
  logs.info.mockClear();
  logs.warn.mockClear();
  logs.error.mockClear();
  process.env.LIKIDA_COFRE_LLAVE = LLAVE;
});
afterEach(() => {
  if (llaveOriginal === undefined) delete process.env.LIKIDA_COFRE_LLAVE;
  else process.env.LIKIDA_COFRE_LLAVE = llaveOriginal;
});

function toquesDeCredencial(): Registro[] {
  return llamadas.filter((l) => l.tabla === 'conector_credencial');
}

describe('guardarCredencial — los candados antes de la base', () => {
  it('sin LIKIDA_COFRE_LLAVE lanza diciendo QUÉ falta, sin tocar la base', async () => {
    delete process.env.LIKIDA_COFRE_LLAVE;
    await expect(guardarCredencial(TENANT, 'sap_b1', VALORES_SAP))
      .rejects.toThrow(/LIKIDA_COFRE_LLAVE/);
    await expect(guardarCredencial(TENANT, 'sap_b1', VALORES_SAP))
      .rejects.toBeInstanceOf(DatoInvalido);
    expect(toquesDeCredencial()).toHaveLength(0);
  });

  it('un conector que no está en el catálogo se rechaza', async () => {
    await expect(guardarCredencial(TENANT, 'sap_hana_inventado', VALORES_SAP))
      .rejects.toThrow(DatoInvalido);
    expect(toquesDeCredencial()).toHaveLength(0);
  });

  it('un conector sin credenciales (IAVE va por archivo) se rechaza — no hay nada que guardar', async () => {
    await expect(guardarCredencial(TENANT, 'iave', {}))
      .rejects.toThrow(/no pide credenciales/);
    expect(toquesDeCredencial()).toHaveLength(0);
  });

  it('las requeridas faltantes lanzan con sus RÓTULOS, antes de cifrar nada', async () => {
    await expect(guardarCredencial(TENANT, 'sap_b1', { base_url: 'https://sap.cliente.mx' }))
      .rejects.toThrow(/Faltan datos para guardar SAP Business One/);
    expect(toquesDeCredencial()).toHaveLength(0);
  });
});

describe('guardarCredencial — lo que viaja al UPSERT', () => {
  it('viaja CIFRADO (no empieza con "{") y las pistas no cargan el secreto completo', async () => {
    respuestas.set('conector_credencial', { data: { id: 'cred-1' }, error: null });
    await guardarCredencial(TENANT, 'sap_b1', VALORES_SAP, { id: 'u-1' });

    const [up] = toquesDeCredencial();
    expect(up.op).toBe('upsert');
    // Una credencial por conector y flota: reemplazar, no duplicar.
    expect(up.opts).toEqual({ onConflict: 'tenant_id,conector_id' });

    const fila = up.payload as Record<string, unknown>;
    expect(fila.tenant_id).toBe(TENANT);
    expect(fila.conector_id).toBe('sap_b1');
    // El CHECK `conector_credencial_no_en_claro` rechaza lo que empiece con
    // `{`: si esto fallara, el candado de la base sería la última defensa.
    expect(String(fila.valores_cifrados)).not.toMatch(/^\s*\{/);
    expect(String(fila.valores_cifrados)).not.toContain(SECRETO);
    // Las pistas: el host en claro (no es secreto), del password solo el
    // recorte con los últimos 4.
    const pistas = fila.pistas as Record<string, string>;
    expect(pistas.base_url).toBe(VALORES_SAP.base_url);
    expect(pistas.password).toBe(`…${SECRETO.slice(-4)}`);
    expect(JSON.stringify(pistas)).not.toContain(SECRETO);
    // Guardar NO es conectar: nace sin probar y activa.
    expect(fila.probada_en).toBeNull();
    expect(fila.ultimo_error).toBeNull();
    expect(fila.activo).toBe(true);
    expect(fila.creada_por).toBe('u-1');
  });

  it('solo los campos DECLARADOS entran al cofre — un formulario manipulado no cuela claves extra', async () => {
    respuestas.set('conector_credencial', { data: { id: 'cred-1' }, error: null });
    await guardarCredencial(TENANT, 'sap_b1', { ...VALORES_SAP, campo_colado: 'malicia' });

    const [up] = toquesDeCredencial();
    const guardado = descifrar(String((up.payload as Record<string, unknown>).valores_cifrados));
    expect(guardado).toEqual(VALORES_SAP);
    expect(guardado).not.toHaveProperty('campo_colado');
  });

  it('el secreto NO viaja a la bitácora ni al logger', async () => {
    respuestas.set('conector_credencial', { data: { id: 'cred-1' }, error: null });
    await guardarCredencial(TENANT, 'sap_b1', VALORES_SAP, { id: 'u-1' });

    const bitacoras = llamadas.filter((l) => l.tabla === 'bitacora_auditoria');
    expect(bitacoras).toHaveLength(1);
    const serializada = JSON.stringify(bitacoras[0].payload);
    expect(serializada).not.toContain(SECRETO);
    // Al detalle van NOMBRES de campos — eso sí, para saber qué se capturó.
    expect((bitacoras[0].payload as { detalle: { campos: string[] } }).detalle.campos)
      .toContain('password');

    const logueado = JSON.stringify([logs.info.mock.calls, logs.warn.mock.calls, logs.error.mock.calls]);
    expect(logueado).not.toContain(SECRETO);
  });

  it('un error del upsert LANZA, no devuelve un id a medias', async () => {
    respuestas.set('conector_credencial', { data: null, error: { message: 'fetch failed' } });
    await expect(guardarCredencial(TENANT, 'sap_b1', VALORES_SAP))
      .rejects.toThrow(/guardarCredencial: fetch failed/);
  });

  it('un upsert sin id también lanza — supabase reporta POR VALOR', async () => {
    respuestas.set('conector_credencial', { data: null, error: null });
    await expect(guardarCredencial(TENANT, 'sap_b1', VALORES_SAP))
      .rejects.toThrow(/no devolvió id/);
  });

  it('una bitácora caída NO tira el guardado — la credencial ya está en el cofre', async () => {
    respuestas.set('conector_credencial', { data: { id: 'cred-1' }, error: null });
    respuestas.set('bitacora_auditoria', { data: null, error: { message: 'fetch failed' } });
    await expect(guardarCredencial(TENANT, 'sap_b1', VALORES_SAP)).resolves.toBe('cred-1');
    expect(logs.warn).toHaveBeenCalledWith('conector_credencial.bitacora_no_escribio', expect.anything());
  });
});

describe('listarCredenciales — lo cifrado no viaja al panel', () => {
  it('selecciona SOLO columnas de pantalla — jamás valores_cifrados', async () => {
    respuestas.set('conector_credencial', {
      data: [{
        conector_id: 'sap_b1', pistas: { base_url: 'https://sap.cliente.mx:50000', password: '…simo' },
        activo: true, probada_en: null, ultimo_error: null, creada_en: '2026-08-14T10:00:00Z',
      }],
      error: null,
    });

    const r = await listarCredenciales(TENANT);
    expect(r).toEqual([{
      conectorId: 'sap_b1',
      pistas: { base_url: 'https://sap.cliente.mx:50000', password: '…simo' },
      activo: true,
      // `null` se queda `null`: "sin probar" es un dato, no un hueco.
      probadaEn: null,
      ultimoError: null,
      creadaEn: '2026-08-14T10:00:00Z',
    }]);

    const [sel] = toquesDeCredencial();
    expect(sel.select).not.toContain('valores_cifrados');
    expect(sel.eq).toContainEqual(['tenant_id', TENANT]);
    expect(sel.orden).toContainEqual(['creada_en', { ascending: false }]);
  });

  it('un error de lectura LANZA — no se disfraza de "no tienes credenciales"', async () => {
    respuestas.set('conector_credencial', { data: null, error: { message: 'fetch failed' } });
    await expect(listarCredenciales(TENANT)).rejects.toThrow(/listarCredenciales: fetch failed/);
  });
});

describe('desactivarCredencial — 0 filas no es éxito', () => {
  it('apaga anclado a tenant + conector + activa, mirando las filas', async () => {
    respuestas.set('conector_credencial', { data: [{ id: 'cred-1' }], error: null });
    await desactivarCredencial(TENANT, 'sap_b1', { id: 'u-1' });

    const [upd] = toquesDeCredencial();
    expect(upd.op).toBe('update');
    expect((upd.payload as Record<string, unknown>).activo).toBe(false);
    expect(upd.eq).toContainEqual(['tenant_id', TENANT]);
    expect(upd.eq).toContainEqual(['conector_id', 'sap_b1']);
    // Solo activas: desactivar dos veces no debe verse como que funcionó.
    expect(upd.eq).toContainEqual(['activo', true]);
    expect(upd.select).toBe('id');
  });

  it('0 filas tocadas LANZA: el conector de otra flota o uno ya apagado no es "desactivada"', async () => {
    respuestas.set('conector_credencial', { data: [], error: null });
    await expect(desactivarCredencial(TENANT, 'sap_b1')).rejects.toThrow(DatoInvalido);
  });

  it('un error del UPDATE lanza como fallo del sistema, no como DatoInvalido', async () => {
    respuestas.set('conector_credencial', { data: null, error: { message: 'fetch failed' } });
    await expect(desactivarCredencial(TENANT, 'sap_b1')).rejects.toThrow(/desactivarCredencial: fetch failed/);
  });

  // AUDITORÍA 1, ALTO (Legal): desactivar tiene que cortar el acceso, y una
  // sesión de portal ya iniciada vive en una fila aparte `#sesion`.
  it('TAMBIÉN apaga la sesión de portal cacheada (fila #sesion) — el ToS promete cortar el acceso', async () => {
    respuestas.set('conector_credencial', { data: [{ id: 'cred-1' }], error: null });
    await desactivarCredencial(TENANT, 'portal_facturacion:g500', { id: 'u-1' });

    const updates = toquesDeCredencial().filter((l) => l.op === 'update');
    // Uno apaga la credencial; otro apaga la sesión.
    const sesion = updates.find((u) => u.eq.some(([c, v]) => c === 'conector_id' && v === 'portal_facturacion:g500#sesion'));
    expect(sesion, 'debe haber un update sobre la fila #sesion').toBeTruthy();
    expect((sesion!.payload as Record<string, unknown>).activo).toBe(false);
  });
});
