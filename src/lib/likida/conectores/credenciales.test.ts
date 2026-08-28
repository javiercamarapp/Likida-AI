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
  /** Los `.not(col, op, valor)` de la consulta. Se registran —y no se ignoran
   *  como hace el mock compartido del repo— porque de uno de ellos depende que
   *  las filas `#sesion` del cofre no se pinten como credenciales (c7-21). */
  not: Array<[string, string, unknown]>;
};

const llamadas: Registro[] = [];
const respuestas = new Map<string, { data: unknown; error: { message: string } | null }>();
/** Respuestas por `tabla:operacion`. Existe desde que `probarCredencial` hace
 *  DOS viajes a la misma tabla en una sola llamada —un SELECT para leer la
 *  credencial y un UPDATE para sellar el veredicto— y cada uno espera una
 *  forma distinta (`{…}` contra `[{id}]`). Sin esto, una sola respuesta por
 *  tabla obligaría a que la lectura y la escritura mintieran la una por la
 *  otra. Cae de vuelta a `respuestas` cuando no hay entrada específica. */
const respuestasPorOp = new Map<string, { data: unknown; error: { message: string } | null }>();

function builder(tabla: string) {
  const r: Registro = { tabla, op: null, payload: null, opts: null, eq: [], select: null, orden: [], not: [] };
  llamadas.push(r);
  const respuesta = () => respuestasPorOp.get(`${tabla}:${r.op}`)
    ?? respuestas.get(tabla) ?? { data: null, error: null };
  const b: Record<string, unknown> = {};
  b.insert = (p: unknown) => { r.op = 'insert'; r.payload = p; return b; };
  b.upsert = (p: unknown, o: unknown) => { r.op = 'upsert'; r.payload = p; r.opts = o; return b; };
  b.update = (p: unknown) => { r.op = 'update'; r.payload = p; return b; };
  b.select = (cols: string) => { r.select = cols; if (!r.op) r.op = 'select'; return b; };
  b.eq = (c: string, v: unknown) => { r.eq.push([c, v]); return b; };
  b.not = (c: string, op: string, v: unknown) => { r.not.push([c, op, v]); return b; };
  b.order = (c: string, o: unknown) => { r.orden.push([c, o]); return b; };
  b.single = async () => respuesta();
  // `leerCredencial` usa `maybeSingle`: «no hay fila» tiene que poder llegar
  // como `data: null` SIN error, que es el caso que distingue «esta flota no
  // capturó ese sistema» de «la base falló».
  b.maybeSingle = async () => respuesta();
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(respuesta()).then(res, rej);
  return b;
}

const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: logs }));

const {
  guardarCredencial, listarCredenciales, desactivarCredencial,
  leerCredencial, marcarProbada, probarCredencial, SUFIJO_SESION_PORTAL,
} = await import('./credenciales');
const { descifrar, cifrar } = await import('./cofre');
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
  respuestasPorOp.clear();
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

  // ═════════════════════════════════════════════════════════════════════════
  // c7-21 · LA PRUEBA QUE FALTABA: la sesión de un portal NO es una credencial.
  //
  // `seccion-credenciales.test.tsx` alimentaba la lista con filas fabricadas a
  // mano; nadie metía una fila `#sesion` por el camino real. Por ahí se coló:
  // en cuanto una flota vinculaba un portal, Conexiones pintaba un renglón
  // fantasma «portal_facturacion:g500#sesion» con un botón **Desactivar** que
  // SÍ funcionaba y apagaba la sesión del portal sin decirlo.
  // ═════════════════════════════════════════════════════════════════════════

  it('c7-21 · las filas `#sesion` no salen de aquí — ni por la consulta ni por el mapeo', async () => {
    respuestas.set('conector_credencial', {
      data: [
        { conector_id: 'portal_facturacion:g500#sesion', pistas: {}, activo: true, probada_en: null, ultimo_error: null, creada_en: '2026-08-27T10:00:00Z' },
        { conector_id: 'samsara', pistas: { token: '…argo' }, activo: true, probada_en: null, ultimo_error: null, creada_en: '2026-08-26T10:00:00Z' },
      ],
      error: null,
    });

    const r = await listarCredenciales(TENANT);

    // (1) El filtro va en la BASE: lo que no viaja no se puede pintar.
    const [sel] = toquesDeCredencial();
    expect(sel.not).toContainEqual(['conector_id', 'like', '%#sesion']);
    // (2) Y el cinturón sobre el tirante: aunque la fila llegue, no sale.
    expect(r.map((c) => c.conectorId)).toEqual(['samsara']);
  });

  it('c7-21 · el sufijo declarado aquí es el MISMO con el que se guarda la sesión', async () => {
    // Dos constantes en dos módulos que tienen que coincidir o el filtro deja
    // de filtrar en silencio. Se comparan contra la función pública que las
    // usa, no copiando el literal.
    const { idSesion } = await import('../facturacion/sesion_portal');
    expect(idSesion('portal_facturacion:g500')).toBe(`portal_facturacion:g500${SUFIJO_SESION_PORTAL}`);
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

// ═══════════════════════════════════════════════════════════════════════════
// PROBAR DE VERDAD — el tramo que faltaba (agosto-2026).
//
// `probar()` estaba escrito en los 19 conectores y NADIE lo llamaba: no había
// quien leyera la credencial guardada ni quien sellara el veredicto, así que
// `probada_en` se quedaba en null para siempre. Lo que se fija aquí:
//   · leer devuelve los valores DESCIFRADOS, y `null` solo significa «no hay
//     fila» — un error de base LANZA, nunca se aplasta a null;
//   · un fallo BORRA la `probada_en` anterior (fail-closed) y guarda el motivo
//     TAL CUAL lo escribió el adaptador;
//   · un veredicto nuestro («no está en el catálogo») NO se sella como si el
//     proveedor hubiera rechazado la credencial;
//   · el secreto no entra a la bitácora.
// ═══════════════════════════════════════════════════════════════════════════

/** Un `Http` de mentira que devuelve lo que se le diga y apunta lo que le
 *  pidieron. Es el mismo truco que usan los tests de los adaptadores: se
 *  ejercita el ciclo entero sin red y sin una cuenta real. */
function httpFalso(estado: number, cuerpo: string) {
  const vistas: Array<{ url: string; encabezados?: Record<string, string> }> = [];
  const http = async (p: { url: string; encabezados?: Record<string, string> }) => {
    vistas.push({ url: p.url, encabezados: p.encabezados });
    return { estado, cuerpo };
  };
  return { http, vistas };
}

describe('leerCredencial — el único lugar donde el secreto vuelve a existir', () => {
  it('descifra lo guardado y ancla tenant, conector y activo', async () => {
    respuestas.set('conector_credencial', { data: { valores_cifrados: cifrar(VALORES_SAP) }, error: null });
    const v = await leerCredencial(TENANT, 'sap_b1');
    expect(v).toEqual(VALORES_SAP);

    const [lectura] = toquesDeCredencial();
    expect(lectura.select).toBe('valores_cifrados');
    expect(lectura.eq).toEqual([['tenant_id', TENANT], ['conector_id', 'sap_b1'], ['activo', true]]);
  });

  it('sin fila devuelve null — que NO es lo mismo que «no se pudo leer»', async () => {
    respuestas.set('conector_credencial', { data: null, error: null });
    expect(await leerCredencial(TENANT, 'sap_b1')).toBeNull();
  });

  it('un error de base LANZA: aplastarlo a null diría «nunca capturaste eso»', async () => {
    respuestas.set('conector_credencial', { data: null, error: { message: 'fetch failed' } });
    await expect(leerCredencial(TENANT, 'sap_b1')).rejects.toThrow(/leerCredencial: fetch failed/);
  });

  it('un cifrado que el cofre no puede abrir se dice, no se devuelve a medias', async () => {
    respuestas.set('conector_credencial', { data: { valores_cifrados: 'v1.aa.bb.cc' }, error: null });
    await expect(leerCredencial(TENANT, 'sap_b1')).rejects.toBeInstanceOf(DatoInvalido);
    await expect(leerCredencial(TENANT, 'sap_b1')).rejects.toThrow(/capturar el acceso de nuevo/);
  });
});

describe('marcarProbada — el sello que convierte «se probó» en algo legible mañana', () => {
  it('éxito: fecha en probada_en y ultimo_error LIMPIO', async () => {
    respuestas.set('conector_credencial', { data: [{ id: 'cred-1' }], error: null });
    await marcarProbada(TENANT, 'sap_b1', { ok: true, detalle: 'SAP contestó 200.', verificadoContra: 'https://x/Login' });

    const [w] = toquesDeCredencial();
    expect(w.op).toBe('update');
    const p = w.payload as { probada_en: unknown; ultimo_error: unknown };
    expect(typeof p.probada_en).toBe('string');
    expect(p.ultimo_error).toBeNull();
  });

  it('fallo: BORRA la probada_en anterior y guarda el motivo TAL CUAL', async () => {
    respuestas.set('conector_credencial', { data: [{ id: 'cred-1' }], error: null });
    const motivo = 'Samsara rechazó la credencial (401). Hay que revisarla o generarla de nuevo.';
    await marcarProbada(TENANT, 'samsara', { ok: false, detalle: motivo, verificadoContra: null });

    const p = toquesDeCredencial()[0].payload as { probada_en: unknown; ultimo_error: unknown };
    // Fail-closed: una credencial que ayer sirvió y hoy la rechazan no puede
    // seguir diciendo «probada el …». La columna cuenta la ÚLTIMA prueba.
    expect(p.probada_en).toBeNull();
    expect(p.ultimo_error).toBe(motivo);
  });

  it('un motivo larguísimo se recorta: la columna se pinta en un renglón', async () => {
    respuestas.set('conector_credencial', { data: [{ id: 'cred-1' }], error: null });
    await marcarProbada(TENANT, 'samsara', { ok: false, detalle: 'x'.repeat(900) });
    const p = toquesDeCredencial()[0].payload as { ultimo_error: string };
    expect(p.ultimo_error).toHaveLength(500);
  });

  it('0 filas tocadas NO es éxito: el conector de otra flota no sella nada', async () => {
    respuestas.set('conector_credencial', { data: [], error: null });
    await expect(marcarProbada(TENANT, 'sap_b1', { ok: true, detalle: 'ok' }))
      .rejects.toBeInstanceOf(DatoInvalido);
  });

  it('a la bitácora van el veredicto y el endpoint, jamás el secreto', async () => {
    respuestas.set('conector_credencial', { data: [{ id: 'cred-1' }], error: null });
    await marcarProbada(TENANT, 'sap_b1', { ok: true, detalle: 'ok', verificadoContra: 'https://sap/Login' });
    const bitacora = llamadas.filter((l) => l.tabla === 'bitacora_auditoria');
    const texto = JSON.stringify(bitacora);
    expect(texto).not.toContain(SECRETO);
  });
});

describe('probarCredencial — el ciclo completo, sin red', () => {
  it('llama al proveedor con la credencial guardada y sella el éxito', async () => {
    // `samsara` porque su `probar()` es un GET con Bearer: se ve el token
    // viajando en la cabecera, que es la prueba de que NO es un ping falso.
    respuestasPorOp.set('conector_credencial:select', { data: { valores_cifrados: cifrar({ token: 'tok-samsara-largo' }) }, error: null });
    respuestasPorOp.set('conector_credencial:update', { data: [{ id: 'cred-1' }], error: null });
    const { http, vistas } = httpFalso(200, '{"data":{"id":"org-1"}}');

    const r = await probarCredencial(TENANT, 'samsara', { id: 'u-1' }, http);
    expect(r.ok).toBe(true);
    expect(r.verificadoContra).toBe('https://api.samsara.com/me');
    expect(vistas[0].encabezados?.Authorization).toBe('Bearer tok-samsara-largo');

    // Y el sello: el UPDATE existe y trae fecha.
    const update = toquesDeCredencial().find((l) => l.op === 'update')!;
    expect((update.payload as { probada_en: unknown }).probada_en).toBeTruthy();
  });

  it('un 401 del proveedor se devuelve TAL CUAL y se sella como fallo', async () => {
    respuestasPorOp.set('conector_credencial:select', { data: { valores_cifrados: cifrar({ token: 'tok-samsara-largo' }) }, error: null });
    respuestasPorOp.set('conector_credencial:update', { data: [{ id: 'cred-1' }], error: null });
    const { http } = httpFalso(401, 'unauthorized');

    const r = await probarCredencial(TENANT, 'samsara', undefined, http);
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/rechazó la credencial \(401\)/);

    const update = toquesDeCredencial().find((l) => l.op === 'update')!;
    expect((update.payload as { ultimo_error: string }).ultimo_error).toBe(r.detalle);
  });

  it('un 500 dice que NO se puede afirmar nada de la credencial — no manda a regenerar el token', async () => {
    respuestasPorOp.set('conector_credencial:select', { data: { valores_cifrados: cifrar({ token: 'tok-samsara-largo' }) }, error: null });
    respuestasPorOp.set('conector_credencial:update', { data: [{ id: 'cred-1' }], error: null });
    const { http } = httpFalso(503, 'maintenance');
    const r = await probarCredencial(TENANT, 'samsara', undefined, http);
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/NO dice nada sobre la credencial/);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // c7-12 · LA PRUEBA QUE FALTABA: un fallo NUESTRO no se sella como un
  // veredicto sobre la credencial del cliente.
  //
  // La prueba del 503 de aquí arriba solo miraba el TEXTO del `detalle`, nunca
  // que la fila no se tocara — y no había ni un caso donde `http` lanzara. Por
  // ahí se coló el bug: `marcarProbada` con `ok: false` escribe `probada_en:
  // null`, así que un 503 o un timeout de VPN BORRABAN la fecha de la última
  // verificación buena y pintaban el badge en «la última prueba FALLÓ», en
  // rojo, como si el cliente hubiera hecho algo mal.
  // ═════════════════════════════════════════════════════════════════════════

  it('c7-12 · el 503 del proveedor NO toca la fila: `probada_en` conserva su fecha', async () => {
    respuestasPorOp.set('conector_credencial:select', { data: { valores_cifrados: cifrar({ token: 'tok-samsara-largo' }) }, error: null });
    respuestasPorOp.set('conector_credencial:update', { data: [{ id: 'cred-1' }], error: null });
    const { http } = httpFalso(503, 'maintenance');

    const r = await probarCredencial(TENANT, 'samsara', undefined, http);

    expect(r.sobreLaCredencial).toBe('no_se_sabe');
    expect(
      toquesDeCredencial().some((l) => l.op === 'update'),
      'el servicio del proveedor está caído: eso no dice nada de la credencial',
    ).toBe(false);
    expect(logs.warn).toHaveBeenCalledWith('conector.prueba_sin_veredicto', expect.anything());
  });

  it('c7-12 · un error de RED (el `http` lanza) tampoco se sella', async () => {
    respuestasPorOp.set('conector_credencial:select', { data: { valores_cifrados: cifrar({ token: 'tok-samsara-largo' }) }, error: null });
    respuestasPorOp.set('conector_credencial:update', { data: [{ id: 'cred-1' }], error: null });
    const http = async () => { throw new Error('fetch failed'); };

    const r = await probarCredencial(TENANT, 'samsara', undefined, http);

    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/Un error de red NO significa que la credencial sea mala/);
    expect(r.sobreLaCredencial).toBe('no_se_sabe');
    expect(toquesDeCredencial().some((l) => l.op === 'update')).toBe(false);
  });

  it('c7-12 · un 200 con basura («no se puede afirmar que la credencial sirva») tampoco se sella', async () => {
    respuestasPorOp.set('conector_credencial:select', { data: { valores_cifrados: cifrar({ token: 'tok-wialon-largo', base_url: 'https://hst-api.wialon.com' }) }, error: null });
    respuestasPorOp.set('conector_credencial:update', { data: [{ id: 'cred-1' }], error: null });
    const { http } = httpFalso(200, '<html>portal de login</html>');

    const r = await probarCredencial(TENANT, 'wialon', undefined, http);

    expect(r.detalle).toMatch(/NO se puede afirmar que la credencial sirva/);
    expect(toquesDeCredencial().some((l) => l.op === 'update')).toBe(false);
  });

  it('c7-12 · pero un RECHAZO de verdad SÍ se sella: el badge tiene que poder ponerse rojo', async () => {
    // El otro lado del candado. Si el arreglo hubiera sido «no sellar nunca un
    // fallo», el cliente jamás vería que su token caducó.
    respuestasPorOp.set('conector_credencial:select', { data: { valores_cifrados: cifrar({ token: 'tok-wialon-largo', base_url: 'https://hst-api.wialon.com' }) }, error: null });
    respuestasPorOp.set('conector_credencial:update', { data: [{ id: 'cred-1' }], error: null });
    // Wialon contesta 200 con `{"error":8}` cuando el token no sirve.
    const { http } = httpFalso(200, '{"error":8}');

    const r = await probarCredencial(TENANT, 'wialon', undefined, http);

    expect(r.sobreLaCredencial).toBe('no_sirve');
    const update = toquesDeCredencial().find((l) => l.op === 'update')!;
    expect((update.payload as { probada_en: unknown }).probada_en).toBeNull();
    expect((update.payload as { ultimo_error: string }).ultimo_error).toBe(r.detalle);
  });

  it('sin credencial activa dice que hay que capturarla y NO toca la fila', async () => {
    respuestas.set('conector_credencial', { data: null, error: null });
    const { http, vistas } = httpFalso(200, '{}');
    const r = await probarCredencial(TENANT, 'samsara', undefined, http);

    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/Captúrala antes de probar/);
    // Ni se llamó al proveedor ni se selló nada: un fallo NUESTRO no se
    // escribe como si el proveedor hubiera rechazado la credencial.
    expect(vistas).toHaveLength(0);
    expect(toquesDeCredencial().some((l) => l.op === 'update')).toBe(false);
  });

  it('un conector fuera del catálogo no toca la base', async () => {
    const { http } = httpFalso(200, '{}');
    const r = await probarCredencial(TENANT, 'sap_hana_inventado', undefined, http);
    expect(r.ok).toBe(false);
    expect(toquesDeCredencial()).toHaveLength(0);
  });

  it('un conector que no pide credenciales lo dice en vez de fingir una prueba', async () => {
    const { http } = httpFalso(200, '{}');
    const r = await probarCredencial(TENANT, 'iave', undefined, http);
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/no hay nada que probar/);
    expect(toquesDeCredencial()).toHaveLength(0);
  });
});
