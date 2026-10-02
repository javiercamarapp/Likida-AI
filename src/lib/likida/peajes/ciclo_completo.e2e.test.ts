import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila } from './db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// EL CICLO COMPLETO DE LA CONCILIACIÓN DE PEAJES, de punta a punta (con dobles).
//
//   entrada  → CORREO `pj-<token>@…` (webhook ya verificado), PULL de un endpoint
//              de la flota, o el buzón firmado de siempre
//   cola     → `peaje_ingesta_archivo` (huella única por flota) + claim del cron
//   lógica   → importar, casar TAG↔unidad, gasto, GPS por caseta
//   salida   → bitácora conciliada, AVISO a la oficina (una vez), exportación
//              configurable por /v1, ANULACIÓN que libera la huella
//
// Los dobles son los LÍMITES (base en memoria, Meta/Resend, el endpoint de la flota,
// el teléfono de la oficina); todo lo de en medio es el código real. Casos: feliz,
// fallo, duplicado, fuera de orden y otro tenant.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
let apagado = false;
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado: async () => apagado }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async () => {} }));

// El claim del correo (RPC reclamar_correo/finalizar_correo) en memoria.
const correosProcesados = new Set<string>();
const correosEnCurso = new Set<string>();
vi.mock('../carta_porte_docs/repo', () => ({
  reclamarCorreo: async (emailId: string) => {
    if (correosProcesados.has(emailId)) return { resultado: 'applied' };
    if (correosEnCurso.has(emailId)) return { resultado: 'busy' };
    correosEnCurso.add(emailId);
    return { resultado: 'claimed', token: `tok-${emailId}` };
  },
  finalizarCorreo: async (emailId: string, _t: string, ok: boolean) => { correosEnCurso.delete(emailId); if (ok) correosProcesados.add(emailId); return true; },
}));

// La oficina: quién ve dinero y el envío por el selector de WhatsApp.
let telefonoDinero: Record<string, string | null> = {};
vi.mock('../contactos', () => ({ telefonoParaDineroDe: async (t: string) => telefonoDinero[t] ?? null }));
const envios: Array<{ tel: string; texto: string; contexto: unknown }> = [];
let envioOk = true;
vi.mock('@/lib/meta/aviso_oficina', async (orig) => ({
  ...(await orig<typeof import('@/lib/meta/aviso_oficina')>()),
  avisarOficina: async (tel: string, texto: string, o: { contexto?: unknown }) => {
    envios.push({ tel, texto, contexto: o.contexto });
    return envioOk ? { ok: true, via: 'texto', id: 'w' } : { ok: false, motivo: 'plantilla no aprobada', fueraDeVentana: true };
  },
}));

// /v1: la puerta resuelve la flota de la credencial (aquí, por encabezado de prueba).
vi.mock('@/app/api/v1/_comun', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  abrir: async (req: Request) => ({ ok: true, tenantId: req.headers.get('x-test-tenant') ?? T, rol: 'llave:test' }),
}));

// El export del reporte de reclamación: la puerta de sesión resuelve la flota que toque en cada prueba.
let sesionApi: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401; motivo: string } = { ok: true, tenantId: '11111111-1111-4111-8111-111111111111', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => sesionApi }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));

const ingesta = await import('./ingesta');
const { atenderCorreoPeajes } = await import('./correo_entrante');
const { ejecutarPulls } = await import('./pull');
const { avisarDesgloseConciliado, reintentarAvisosPeajes } = await import('./aviso_oficina');
const datos = await import('./datos');
const { GET: v1Desgloses } = await import('@/app/api/v1/peajes/desgloses/route');
const { POST: v1Anular } = await import('@/app/api/v1/peajes/desgloses/[id]/anular/route');
const { GET: v1Exportacion } = await import('@/app/api/v1/peajes/exportacion/route');
const { cifrar } = await import('../conectores/cofre');
const { reporteReclamacion } = await import('./bitacora_conciliada');
const { GET: exportReclamacion } = await import('@/app/api/export/peajes-reclamacion/route');
const XLSX = await import('xlsx');

const T = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'abcdefghjkmnpqrstvwxyz23';
const TOKEN2 = 'bcdefghjkmnpqrstvwxyz234';
const N = { lat: 19.5, lng: -99.2 };
const S = { lat: 19.0, lng: -99.0 };

const ARCHIVO = [
  'Fecha de cobro;Hora;Plaza;Importe;No. TAG',
  '05/08/2026;10:30:00;Caseta Ejemplo Norte;189,50;IMDM 10000001', // gasto + GPS cerca        → cuadra
  '05/08/2026;11:30:00;Caseta Ejemplo Sur;100,00;IMDM 10000002',   // gasto, GPS lejos          → por verificar (GPS no coincide)
  '06/08/2026;09:00:00;Caseta Ejemplo Norte;200,00;IMDM 10000001', // sin gasto, sin posiciones → sin respaldo
].join('\n');
const OTRO_ARCHIVO = ARCHIVO.replace('200,00', '201,00');

const posiciones = [
  { unidad_id: 'u1', lat: N.lat + 0.001, lng: N.lng, medida_en: '2026-08-05T16:30:30.000Z' },
  { unidad_id: 'u2', lat: S.lat + 0.2, lng: S.lng, medida_en: '2026-08-05T17:28:00.000Z' },
  { unidad_id: 'u2', lat: S.lat + 0.2, lng: S.lng + 0.01, medida_en: '2026-08-05T17:32:00.000Z' },
  // la unidad de la flota B, a 22 km de la caseta a la hora del pase: SU cobro del 05/08 10:30 es «el GPS no la ubica en la caseta»
  { unidad_id: 'u3', lat: N.lat + 0.2, lng: N.lng, medida_en: '2026-08-05T16:28:00.000Z' },
  { unidad_id: 'u3', lat: N.lat + 0.2, lng: N.lng + 0.01, medida_en: '2026-08-05T16:32:00.000Z' },
];

function base(): Record<string, Fila[]> {
  return {
    peaje_ingesta_config: [
      { tenant_id: T, rotacion: 1, activa: false, correo_token: TOKEN, correo_activo: true, remitentes_permitidos: [], pull_activo: false, pull_proximo_en: '2000-01-01T00:00:00Z' },
      { tenant_id: T2, rotacion: 1, activa: false, correo_token: TOKEN2, correo_activo: true, remitentes_permitidos: [], pull_activo: false, pull_proximo_en: '2000-01-01T00:00:00Z' },
    ],
    peaje_ingesta_archivo: [],
    unidad: [
      { id: 'u1', tenant_id: T, numero_economico: 'C2-08', placas: null },
      { id: 'u2', tenant_id: T, numero_economico: 'C2-09', placas: null },
      { id: 'u3', tenant_id: T2, numero_economico: 'B-01', placas: null },
    ],
    peaje_tag: [
      { id: 't1', tenant_id: T, tag: 'IMDM10000001', unidad_id: 'u1', activo: true },
      { id: 't2', tenant_id: T, tag: 'IMDM10000002', unidad_id: 'u2', activo: true },
      { id: 't3', tenant_id: T2, tag: 'IMDM10000001', unidad_id: 'u3', activo: true },
    ],
    peaje_caseta: [
      { id: 'cN', tenant_id: T, nombre: 'Caseta Ejemplo Norte', nombre_norm: 'caseta ejemplo norte', alias: [], lat: N.lat, lng: N.lng, radio_m: 300, activa: true },
      { id: 'cS', tenant_id: T, nombre: 'Caseta Ejemplo Sur', nombre_norm: 'caseta ejemplo sur', alias: [], lat: S.lat, lng: S.lng, radio_m: 300, activa: true },
      { id: 'cN2', tenant_id: T2, nombre: 'Caseta Ejemplo Norte', nombre_norm: 'caseta ejemplo norte', alias: [], lat: N.lat, lng: N.lng, radio_m: 300, activa: true },
    ],
    viaje: [
      { id: 'v1', tenant_id: T, folio: 'V-1', unidad_id: 'u1' }, { id: 'v2', tenant_id: T, folio: 'V-2', unidad_id: 'u2' },
      { id: 'vb', tenant_id: T2, folio: 'B-1', unidad_id: null },
    ],
    gasto: [
      { id: 'g1', tenant_id: T, concepto: 'caseta', viaje_id: 'v1', monto: 189.5, fecha: '2026-08-05' },
      { id: 'g2', tenant_id: T, concepto: 'caseta', viaje_id: 'v2', monto: 100, fecha: '2026-08-05' },
      // la flota B tiene SU ticket de caseta del periodo (otro monto): sus líneas quedan «sin respaldo» y el aviso es suyo
      { id: 'gb', tenant_id: T2, concepto: 'caseta', viaje_id: 'vb', monto: 55, fecha: '2026-08-05' },
    ],
  };
}

function claimArchivos(args: Record<string, unknown>): Fila[] {
  const els = db.tablas.peaje_ingesta_archivo.filter((a) => a.contenido != null && a.estado === 'pendiente').slice(0, args.p_limite as number);
  for (const a of els) { a.estado = 'procesando'; a.reclamo = `tok-${a.id}`; a.intentos = (a.intentos as number) + 1; }
  return els.map((a) => ({ id: a.id, tenant_id: a.tenant_id, nombre: a.nombre, proveedor: a.proveedor, intentos: a.intentos, reclamo: a.reclamo, desglose_id: null }));
}
function claimPull(): Fila[] {
  const ahora = new Date().toISOString();
  const els = db.tablas.peaje_ingesta_config.filter((c) => c.pull_activo === true && c.pull_url && String(c.pull_proximo_en) <= ahora);
  for (const c of els) c.pull_proximo_en = new Date(Date.now() + 600_000).toISOString();
  return els.map((c) => ({ tenant_id: c.tenant_id, pull_url: c.pull_url, pull_credencial_cifrada: c.pull_credencial_cifrada ?? null, pull_ultimo_en: c.pull_ultimo_en ?? null, pull_intervalo_min: c.pull_intervalo_min ?? 60 }));
}
const avisosPendientes = (args: Record<string, unknown>): Fila[] =>
  db.tablas.desglose_peaje
    .filter((d) => d.aviso_requerido === true && !d.aviso_oficina_en && !d.anulado_en && ((d.aviso_intentos as number) ?? 0) < (args.p_max_intentos as number))
    .slice(0, args.p_limite as number).map((d) => ({ tenant_id: d.tenant_id, desglose_id: d.id }));
const rpcPosiciones = (args: Record<string, unknown>): Fila[] =>
  (args.p_ventanas as Array<{ linea_id: string; unidad_id: string; desde: string; hasta: string }>).flatMap((v) =>
    posiciones.filter((p) => p.unidad_id === v.unidad_id && p.medida_en >= v.desde && p.medida_en <= v.hasta)
      .map((p) => ({ linea_id: v.linea_id, lat: p.lat, lng: p.lng, medida_en: p.medida_en })));

/** El `avisar` de la cola: en la base real las columnas del aviso tienen default; la falsa no. */
const avisarEnCola = async (tenantId: string, desgloseId: string) => {
  for (const d of db.tablas.desglose_peaje) { d.aviso_intentos ??= 0; d.aviso_requerido ??= false; }
  return avisarDesgloseConciliado(tenantId, desgloseId);
};
const procesar = () => ingesta.procesarColaPeajes({ avisar: avisarEnCola });

const adjuntos = new Map<string, Uint8Array>();
const correo = (id: string, archivos: Array<[string, string]>, from = 'Cortes <cortes@pase.example>') => ({
  emailId: id, from, subject: 'Corte', attachments: archivos.map(([nombre, adj]) => ({ id: adj, filename: nombre })),
});
const deps = { descargar: async (_e: string, adj: string) => (adjuntos.has(adj) ? { ok: true as const, bytes: adjuntos.get(adj)! } : { ok: false as const, transitorio: false }) };
const guardar = (adj: string, contenido: string) => adjuntos.set(adj, new TextEncoder().encode(contenido));

const peticion = (ruta: string, init: RequestInit = {}, tenant = T) =>
  new Request(`https://app.likida.ai/api/v1/peajes/${ruta}`, { ...init, headers: { 'x-test-tenant': tenant, 'content-type': 'application/json', ...(init.headers ?? {}) } });
const idDesglose = (n = 0) => String(db.tablas.desglose_peaje[n].id);

beforeEach(() => {
  db = crearDbFalsa(base(), { peaje_archivo_reclamar: claimArchivos, peaje_pull_reclamar: claimPull, peaje_avisos_pendientes: avisosPendientes, peaje_posiciones_ventana: rpcPosiciones });
  correosProcesados.clear(); correosEnCurso.clear(); adjuntos.clear(); envios.length = 0;
  telefonoDinero = { [T]: '525599990000', [T2]: '525588880000' }; envioOk = true; apagado = false;
  process.env.RESEND_API_KEY = 're_test';
  process.env.LIKIDA_COFRE_LLAVE = 'c'.repeat(40);
  guardar('adj1', ARCHIVO);
});

describe('FELIZ: correo → cola → cruce → aviso → /v1 → anulación', () => {
  it('el correo entra, el cron cruza, la oficina recibe UN aviso, /v1 lista y exporta, anular libera la huella', async () => {
    // 1. entrada por correo
    const r = await atenderCorreoPeajes(TOKEN, correo('e1', [['corte-pase.csv', 'adj1']]), deps);
    expect(r).toMatchObject({ status: 200, cuerpo: { recibidos: 1, duplicados: 0 } });
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ tenant_id: T, origen: 'correo', estado: 'pendiente' });

    // 2. la cola: importa, cruza y avisa
    expect(await procesar()).toMatchObject({ tomados: 1, procesados: 1, fallidos: 0 });
    expect(envios).toHaveLength(1);
    expect(envios[0].tel).toBe('525599990000');
    expect(envios[0].texto).toMatch(/1 cobro donde el GPS no ubica la unidad en la caseta, 1 cobro sin respaldo en tus tickets/);
    expect(envios[0].texto).toMatch(/no afirma que el cobro sea indebido/);
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ aviso_requerido: true, aviso_intentos: 1 });
    expect(db.tablas.desglose_peaje[0].aviso_oficina_en).toBeTruthy();
    expect((envios[0].contexto as { tenantId: string }).tenantId).toBe(T);

    // 3. /v1: la lista y la exportación configurable
    const lista = await (await v1Desgloses(peticion('desgloses'))).json();
    expect(lista.datos).toHaveLength(1);
    expect(lista.datos[0]).toMatchObject({ id: idDesglose(), proveedor: null, resumen: { total: 3, cuadra: 2 } }); // `cuadra` del cruce por gasto: la línea 2 tiene gasto aunque el GPS no la confirme (la bitácora conciliada la pone «por verificar»)
    const exp = await v1Exportacion(peticion(`exportacion?desglose=${idDesglose()}&columnas=linea,fechaCruce,monto,estado,gps&separador=punto_y_coma&decimal=coma&fechas=sap`));
    expect(exp.status).toBe(200);
    expect(await exp.text()).toBe([
      'linea;fechaCruce;monto;estado;gps',
      '1;20260805;189,50;cuadra;confirma',
      '2;20260805;100,00;por verificar;no coincide',
      '3;20260806;200,00;sin respaldo;sin datos',
      '',
    ].join('\n'));
    expect(decodeURIComponent(exp.headers.get('x-likida-leyenda')!)).toMatch(/sin respaldo/i);

    // 4. anular: deja de listarse y de exportarse, y la huella queda libre
    const an = await v1Anular(peticion(`desgloses/${idDesglose()}/anular`, { method: 'POST', body: JSON.stringify({ motivo: 'archivo del periodo equivocado' }) }), { params: Promise.resolve({ id: idDesglose() }) });
    expect(await an.json()).toEqual({ datos: { id: idDesglose(), anulado: true, yaAnulado: false } });
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ anulado_por: 'api:llave:test', anulado_motivo: 'archivo del periodo equivocado' });
    expect((await (await v1Desgloses(peticion('desgloses'))).json()).datos).toHaveLength(0);
    expect((await v1Exportacion(peticion(`exportacion?desglose=${idDesglose()}`))).status).toBe(404);

    // 5. el MISMO archivo, ya corregido su origen, vuelve a entrar como nuevo (no «duplicado»)
    guardar('adj2', ARCHIVO);
    const otra = await atenderCorreoPeajes(TOKEN, correo('e2', [['corte-pase.csv', 'adj2']]), deps);
    expect(otra.cuerpo).toMatchObject({ recibidos: 1, duplicados: 0 });
    expect(await procesar()).toMatchObject({ procesados: 1 });
    expect(db.tablas.desglose_peaje).toHaveLength(2);
  });

  it('el PULL consulta el endpoint de la flota con su token cifrado y lo que trae entra a la misma cola', async () => {
    const cfg = db.tablas.peaje_ingesta_config[0];
    Object.assign(cfg, { pull_activo: true, pull_url: 'https://tms.flota.example/cortes', pull_credencial_cifrada: cifrar({ token: 'secreto-del-endpoint' }), pull_intervalo_min: 60 });
    const peticiones: Array<{ url: string; auth: string | undefined }> = [];
    const http = vi.fn(async (p: { url: string; encabezados?: Record<string, string> }) => {
      peticiones.push({ url: p.url, auth: p.encabezados?.Authorization });
      return { estado: 200, cuerpo: JSON.stringify({ archivos: [{ nombre: 'corte.csv', proveedor: 'PASE', contenido_base64: Buffer.from(ARCHIVO).toString('base64') }] }), encabezados: {} };
    });
    const r = await ejecutarPulls({}, { http: http as never, ahora: () => new Date('2026-10-01T12:00:00Z'), descifrar: (await import('../conectores/cofre')).descifrar });
    expect(r).toMatchObject({ reclamadas: 1, exitosas: 1, recibidos: 1 });
    expect(peticiones).toEqual([{ url: 'https://tms.flota.example/cortes', auth: 'Bearer secreto-del-endpoint' }]);
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ tenant_id: T, origen: 'pull', proveedor: 'PASE' });
    // el cursor avanza y el siguiente turno queda a un intervalo
    expect(cfg.pull_ultimo_en).toBe('2026-10-01T12:00:00.000Z');
    expect(String(cfg.pull_proximo_en) > '2026-10-01T12:59:00').toBe(true);
    expect(await procesar()).toMatchObject({ procesados: 1 });
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ proveedor: 'PASE' });
    // la segunda consulta lleva `desde` y el mismo archivo ya no duplica
    cfg.pull_proximo_en = '2000-01-01T00:00:00Z';
    const r2 = await ejecutarPulls({}, { http: http as never, ahora: () => new Date('2026-10-01T13:05:00Z'), descifrar: (await import('../conectores/cofre')).descifrar });
    expect(r2).toMatchObject({ exitosas: 1, recibidos: 0, duplicados: 1 });
    expect(peticiones[1].url).toBe('https://tms.flota.example/cortes?desde=2026-10-01T12%3A00%3A00.000Z');
  });
});

describe('FALLO', () => {
  it('un archivo ilegible queda `fallida` con el motivo y NO avisa a nadie', async () => {
    guardar('malo', 'esto,no,es,un,desglose\n1,2,3');
    await atenderCorreoPeajes(TOKEN, correo('e1', [['raro.csv', 'malo']]), deps);
    expect(await procesar()).toMatchObject({ tomados: 1, fallidos: 1, procesados: 0 });
    expect(db.tablas.peaje_ingesta_archivo[0].estado).toBe('fallida');
    expect(String(db.tablas.peaje_ingesta_archivo[0].ultimo_error)).toMatch(/leer|encabezados|columna/i);
    expect(envios).toHaveLength(0);
  });

  it('sin destinatario de dinero el aviso NO sale, queda pendiente y el barrido lo manda cuando hay a quién (una vez)', async () => {
    telefonoDinero = { [T]: null };
    await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps);
    await procesar();
    expect(envios).toHaveLength(0);
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ aviso_requerido: true, aviso_intentos: 1 });
    expect(db.tablas.desglose_peaje[0].aviso_oficina_en).toBeUndefined();

    telefonoDinero = { [T]: '525599990000' };
    expect(await reintentarAvisosPeajes(5)).toMatchObject({ revisados: 1, enviados: 1 });
    expect(await reintentarAvisosPeajes(5)).toMatchObject({ revisados: 0 });
    expect(envios).toHaveLength(1);
  });

  it('Meta rechaza el aviso: se reintenta hasta el tope y NO lo manda doble', async () => {
    envioOk = false;
    await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps);
    await procesar();
    for (let i = 0; i < 6; i++) await reintentarAvisosPeajes(5);
    expect(envios).toHaveLength(datos.MAX_INTENTOS_AVISO);   // 5 intentos y se rinde
    expect(db.tablas.desglose_peaje[0].aviso_oficina_en).toBeUndefined();
    expect(await avisarDesgloseConciliado(T, idDesglose())).toBe('agotado');
  });

  it('el endpoint del pull rechaza el token o contesta basura: error dicho, cursor SIN avanzar, y la cola de la flota no se toca', async () => {
    const cfg = db.tablas.peaje_ingesta_config[0];
    Object.assign(cfg, { pull_activo: true, pull_url: 'https://tms.flota.example/cortes', pull_ultimo_en: '2026-09-30T00:00:00.000Z', pull_intervalo_min: 60 });
    const casos: Array<[{ estado: number; cuerpo: string }, RegExp]> = [
      [{ estado: 401, cuerpo: '' }, /rechazó el token/], [{ estado: 500, cuerpo: 'boom' }, /HTTP 500/],
      [{ estado: 200, cuerpo: '<html>' }, /JSON válido/], [{ estado: 200, cuerpo: '{"otra":1}' }, /«archivos»/],
    ];
    for (const [resp, motivo] of casos) {
      cfg.pull_proximo_en = '2000-01-01T00:00:00Z';
      const r = await ejecutarPulls({}, { http: (async () => ({ ...resp, encabezados: {} })) as never, ahora: () => new Date('2026-10-01T12:00:00Z'), descifrar: (await import('../conectores/cofre')).descifrar });
      expect(r).toMatchObject({ fallidas: 1, exitosas: 0 });
      expect(String(cfg.pull_ultimo_error)).toMatch(motivo);
      expect(cfg.pull_ultimo_en).toBe('2026-09-30T00:00:00.000Z');
      expect(String(cfg.pull_ultimo_error)).not.toMatch(/boom|<html>/); // el cuerpo de la respuesta nunca se copia
    }
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(0);
  });

  it('el pull no puede apuntar a una red interna (SSRF): se rechaza al guardar', () => {
    for (const u of ['http://tms.example/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://10.0.0.5/x', 'https://u:p@tms.example/x', 'https://tms/x']) {
      expect(datos.validarUrlPull(u).ok, u).toBe(false);
    }
    expect(datos.validarUrlPull('https://tms.flota.example/cortes').ok).toBe(true);
  });

  it('el correo con el agente apagado o la descarga caída es 503 (Resend reintenta) y no consume el correo', async () => {
    apagado = true;
    expect((await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps)).status).toBe(503);
    apagado = false;
    const caida = { descargar: async () => ({ ok: false as const, transitorio: true }) };
    expect((await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), caida)).status).toBe(503);
    expect(correosProcesados.has('e1')).toBe(false);
    expect((await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps)).cuerpo).toMatchObject({ recibidos: 1 });
  });
});

describe('DUPLICADO', () => {
  it('Resend reintenta el mismo correo, y otro correo trae el mismo archivo: UN desglose y UN aviso', async () => {
    await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps);
    expect((await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps)).cuerpo).toMatchObject({ ignorado: 'ya_procesado' });
    guardar('adj-copia', ARCHIVO);
    expect((await atenderCorreoPeajes(TOKEN, correo('e2', [['renombrado.csv', 'adj-copia']]), deps)).cuerpo).toMatchObject({ recibidos: 0, duplicados: 1 });
    await procesar();
    await procesar();
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(1);
    expect(db.tablas.desglose_peaje).toHaveLength(1);
    expect(envios).toHaveLength(1);
  });

  it('dos procesos avisando el mismo desglose a la vez: el compare-and-set deja pasar UNO', async () => {
    await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps);
    await ingesta.procesarColaPeajes({ avisar: async () => {} }); // procesa SIN avisar
    for (const d of db.tablas.desglose_peaje) { d.aviso_intentos ??= 0; d.aviso_requerido ??= false; }
    const res = await Promise.all([avisarDesgloseConciliado(T, idDesglose()), avisarDesgloseConciliado(T, idDesglose()), avisarDesgloseConciliado(T, idDesglose())]);
    expect(res.filter((x) => x === 'enviado')).toHaveLength(1);
    expect(envios).toHaveLength(1);
  });

  it('anular dos veces es idempotente y conserva a quien lo hizo primero', async () => {
    await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps);
    await procesar();
    const id = idDesglose();
    await datos.anularDesgloseDb(T, id, 'primero', 'ana');
    expect(await datos.anularDesgloseDb(T, id, 'segundo', 'beto')).toBe('ya_anulado');
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ anulado_por: 'ana', anulado_motivo: 'primero' });
  });
});

describe('FUERA DE ORDEN', () => {
  it('anulan el desglose ANTES de que salga el aviso pendiente: el barrido ya no avisa', async () => {
    telefonoDinero = { [T]: null };
    await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps);
    await procesar();
    await datos.anularDesgloseDb(T, idDesglose(), 'subido por error', 'ana');
    telefonoDinero = { [T]: '525599990000' };
    expect(await reintentarAvisosPeajes(5)).toMatchObject({ revisados: 0 });
    expect(await avisarDesgloseConciliado(T, idDesglose())).toBe('anulado');
    expect(envios).toHaveLength(0);
  });

  it('un desglose anulado no se re-concilia ni cuenta en la bitácora fiscal', async () => {
    await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps);
    await procesar();
    await datos.anularDesgloseDb(T, idDesglose(), 'error', 'ana');
    const { conciliarDesglose, bitacoraRmf918, resumenConciliacion } = await import('../intake/desglose_peaje');
    await expect(conciliarDesglose(T, idDesglose(), 'manual')).rejects.toThrow(/anulado/);
    expect(await bitacoraRmf918(T, idDesglose())).toBeNull();
    expect(await resumenConciliacion(T, idDesglose())).toBeNull();
  });

  it('el correo llega con el buzón APAGADO o con un remitente fuera de la lista: se ignora (200), no se encola', async () => {
    Object.assign(db.tablas.peaje_ingesta_config[0], { remitentes_permitidos: ['pase.example'] });
    expect((await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']], 'Intruso <x@malo.example>'), deps)).cuerpo).toMatchObject({ ignorado: 'remitente_no_permitido' });
    expect((await atenderCorreoPeajes(TOKEN, correo('e2', [['corte.csv', 'adj1']], 'Cortes <cortes@pase.example>'), deps)).cuerpo).toMatchObject({ recibidos: 1 });
    db.tablas.peaje_ingesta_config[0].correo_activo = false;
    guardar('adj9', OTRO_ARCHIVO);
    expect((await atenderCorreoPeajes(TOKEN, correo('e3', [['otro.csv', 'adj9']]), deps)).cuerpo).toMatchObject({ ignorado: 'buzon_apagado' });
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(1);
  });
});

describe('OTRO TENANT', () => {
  it('cada flota recibe SU desglose aunque manden el mismo archivo; el aviso va a SU oficina', async () => {
    await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps);
    expect((await atenderCorreoPeajes(TOKEN2, correo('e2', [['corte.csv', 'adj1']]), deps)).cuerpo).toMatchObject({ recibidos: 1 });
    expect(db.tablas.peaje_ingesta_archivo.map((a) => a.tenant_id).sort()).toEqual([T, T2]);
    await procesar();
    expect(envios.map((e) => e.tel).sort()).toEqual(['525588880000', '525599990000']);
  });

  it('un token de correo desconocido o de OTRA flota no escribe nada; /v1 de B no ve, no exporta ni anula lo de A', async () => {
    expect((await atenderCorreoPeajes('zzzzzzzzzzzzzzzzzzzzzzzz', correo('e1', [['corte.csv', 'adj1']]), deps)).cuerpo).toMatchObject({ ignorado: 'buzon_desconocido' });
    await atenderCorreoPeajes(TOKEN, correo('e2', [['corte.csv', 'adj1']]), deps);
    await procesar();
    const id = idDesglose();
    expect((await (await v1Desgloses(peticion('desgloses', {}, T2))).json()).datos).toHaveLength(0);
    expect((await v1Exportacion(peticion(`exportacion?desglose=${id}`, {}, T2))).status).toBe(404);
    const an = await v1Anular(peticion(`desgloses/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo: 'x' }) }, T2), { params: Promise.resolve({ id }) });
    expect(an.status).toBe(404);
    expect(db.tablas.desglose_peaje[0].anulado_en).toBeUndefined();
  });

  it('la anulación de A libera SOLO la huella de A (la de B sigue contando como duplicado)', async () => {
    await atenderCorreoPeajes(TOKEN, correo('e1', [['corte.csv', 'adj1']]), deps);
    await atenderCorreoPeajes(TOKEN2, correo('e2', [['corte.csv', 'adj1']]), deps);
    await procesar();
    await datos.anularDesgloseDb(T, String(db.tablas.desglose_peaje.find((d) => d.tenant_id === T)!.id), 'error', 'ana');
    expect((await atenderCorreoPeajes(TOKEN, correo('e3', [['corte.csv', 'adj1']]), deps)).cuerpo).toMatchObject({ recibidos: 1 });
    expect((await atenderCorreoPeajes(TOKEN2, correo('e4', [['corte.csv', 'adj1']]), deps)).cuerpo).toMatchObject({ duplicados: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL REPORTE DE RECLAMACIÓN, de punta a punta: archivo de pases (PASE, por correo)
// × TAG↔unidad × hora del pase × posiciones GPS × geocercas de la flota →
// los cruces que se le pueden pedir al proveedor, con su porqué y su evidencia,
// en pantalla (el reporte), Excel y PDF.
//
// El proveedor es un DOBLE: el archivo de pases real de la flota es un BLOQUEO
// EXTERNO (docs/operacion/conciliacion-peajes.md); aquí se usa un CSV sintético
// con la forma que el lector tolerante ya reconoce.
// ═══════════════════════════════════════════════════════════════════════════

const PATIO = { lat: 19.3, lng: -99.1 };
// 07/08 08:00 y 08:06 (mismo TAG, misma caseta, 6 min) → doble cobro; 08/08 09:00 en el patio con muestras que no alcanzan para afirmar → zona.
const ARCHIVO_RECLAMACION = [
  'Fecha de cobro;Hora;Plaza;Importe;No. TAG',
  '05/08/2026;10:30:00;Caseta Ejemplo Norte;189,50;IMDM 10000001', // GPS cerca               → NO se reclama
  '05/08/2026;11:30:00;Caseta Ejemplo Sur;100,00;IMDM 10000002',   // GPS a 22 km             → GPS lejos de la caseta
  '06/08/2026;09:00:00;Caseta Ejemplo Norte;200,00;IMDM 10000001', // sin posiciones          → NO se reclama (sin datos)
  '07/08/2026;08:00:00;Caseta Ejemplo Norte;50,00;IMDM 10000001',  // primer cobro
  '07/08/2026;08:06:00;Caseta Ejemplo Norte;50,00;IMDM 10000001',  // 6 min después            → posible doble cobro
  '08/08/2026;09:00:00;Caseta Ejemplo Sur;77,00;IMDM 10000002',    // unidad en su patio       → zona no autorizada
].join('\n');

function conReclamacion() {
  guardar('adjR', ARCHIVO_RECLAMACION);
  db.tablas.geocerca = [{ id: 'g1', tenant_id: T, catalogo: 'peajes', nombre: 'Patio Central', tipo: 'patio', lat: PATIO.lat, lng: PATIO.lng, radio_m: 500, activa: true }];
  // u2 el 08/08: a las 08:56 locales (14:56Z) en el patio y a las 09:10 (15:10Z) ya en carretera: 14 min de hueco → el GPS «no alcanza para concluir»
  (posiciones as Array<Record<string, unknown>>).push(
    { unidad_id: 'u2', lat: PATIO.lat + 0.001, lng: PATIO.lng, medida_en: '2026-08-08T14:56:00.000Z' },
    { unidad_id: 'u2', lat: S.lat + 0.3, lng: S.lng, medida_en: '2026-08-08T15:10:00.000Z' },
  );
}
async function conciliado() {
  conReclamacion();
  await atenderCorreoPeajes(TOKEN, correo('eR', [['corte-pase.csv', 'adjR']]), deps);
  await procesar();
  return idDesglose();
}

describe('RECLAMACIÓN: pases × GPS × geocercas → reporte para el proveedor', () => {
  it('FELIZ: solo entran los cruces con evidencia en contra, cada uno con su motivo, su porqué y su evidencia de GPS', async () => {
    const r = (await reporteReclamacion(T, await conciliado()))!;
    expect(r.resumen).toMatchObject({ lineas: 6, reclamables: 3, montoReclamable: 227, confirmadas: 1 });
    expect(r.cruces.map((c) => [c.indice + 1, c.motivo, c.monto])).toEqual([
      [2, 'gps_lejos_de_caseta', 100],
      [5, 'doble_cobro', 50],
      [6, 'unidad_en_zona_no_autorizada', 77],
    ]);

    const [gps, doble, zona] = r.cruces;
    // TAG↔unidad y hora del PASE: el cruce sabe qué unidad es y a qué hora (la de México) pasó
    expect(gps).toMatchObject({ fecha: '2026-08-05', hora: '11:30:00', caseta: 'Caseta Ejemplo Sur', tag: 'IMDM 10000002', unidad: 'C2-09', confianza: 'alta', radioCasetaM: 300 });
    expect(gps.porQue).toMatch(/la unidad C2-09 no estaba en Caseta Ejemplo Sur a la hora del pase \(11:30\)/);
    expect(gps.distanciaM).toBeGreaterThan(20_000);
    expect(gps.evidencia).toHaveLength(2);
    expect(gps.evidencia.map((e) => e.en)).toEqual(['2026-08-05T17:28:00.000Z', '2026-08-05T17:32:00.000Z']);
    expect(gps.evidencia.every((e) => (e.distanciaCasetaM ?? 0) > 20_000)).toBe(true);

    expect(doble).toMatchObject({ tag: 'IMDM 10000001', unidad: 'C2-08', confianza: 'media', duplicadoDeLinea: 4 });
    expect(zona).toMatchObject({ unidad: 'C2-09', confianza: 'alta', zona: { nombre: 'Patio Central', tipo: 'patio' } });
    expect(zona.evidencia[0].en).toBe('2026-08-08T14:56:00.000Z');
    expect(r.leyendas.join(' ')).toMatch(/La decisión de reclamar es de la flota/);
  });

  it('lo que NO se reclama: GPS que confirma y líneas sin datos (se cuentan, no se acusan)', async () => {
    const r = (await reporteReclamacion(T, await conciliado()))!;
    const lineas = r.cruces.map((c) => c.indice);
    expect(lineas).not.toContain(0); // 05/08 10:30: el GPS la confirma
    expect(lineas).not.toContain(2); // 06/08 09:00: sin posiciones
    expect(r.resumen.sinDatos + r.resumen.confirmadas + r.resumen.sinEvaluar + r.resumen.reclamables).toBe(r.resumen.lineas);
  });

  it('Excel y PDF por la puerta de export: mismo contenido que el reporte, con el total reclamable', async () => {
    const id = await conciliado();
    const x = await exportReclamacion(new Request(`https://app.likida.ai/api/export/peajes-reclamacion?desglose=${id}`));
    expect(x.status).toBe(200);
    const libro = XLSX.read(new Uint8Array(await x.arrayBuffer()), { type: 'array' });
    const m = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets['Reclamación'], { header: 1, defval: null });
    const enc = m.findIndex((f) => f[0] === 'Línea');
    expect(m.slice(enc + 1, enc + 4).map((f) => [f[0], f[5], f[6], f[7], f[8]])).toEqual([
      [2, 'IMDM 10000002', 'C2-09', 100, 'GPS lejos de la caseta'],
      [5, 'IMDM 10000001', 'C2-08', 50, 'Posible doble cobro'],
      [6, 'IMDM 10000002', 'C2-09', 77, 'Unidad en zona no autorizada'],
    ]);
    expect(m.find((f) => f[0] === 'Total reclamable')?.[7]).toBe(227);
    const p = await exportReclamacion(new Request(`https://app.likida.ai/api/export/peajes-reclamacion?desglose=${id}&formato=pdf`));
    expect(p.headers.get('Content-Type')).toBe('application/pdf');
    expect(Buffer.from(await p.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('OTRO TENANT: la flota B no baja el reporte de la flota A (404), ni su Excel', async () => {
    const id = await conciliado();
    expect(await reporteReclamacion(T2, id)).toBeNull();
    sesionApi = { ok: true, tenantId: T2, rol: 'flota_admin' };
    try {
      expect((await exportReclamacion(new Request(`https://app.likida.ai/api/export/peajes-reclamacion?desglose=${id}`))).status).toBe(404);
    } finally { sesionApi = { ok: true, tenantId: T, rol: 'flota_admin' }; }
  });

  it('un desglose ANULADO no tiene reporte (404), y al volver a conciliarlo el reporte vuelve a salir', async () => {
    const id = await conciliado();
    await datos.anularDesgloseDb(T, id, 'periodo equivocado', 'ana');
    expect(await reporteReclamacion(T, id)).toBeNull();
  });

  it('sin geocercas ni posiciones de patio, la línea del patio NO se reclama: el GPS «sin datos» no acusa', async () => {
    conReclamacion();
    db.tablas.geocerca = [];
    await atenderCorreoPeajes(TOKEN, correo('eR', [['corte-pase.csv', 'adjR']]), deps);
    await procesar();
    const r = (await reporteReclamacion(T, idDesglose()))!;
    expect(r.cruces.map((c) => c.motivo)).toEqual(['gps_lejos_de_caseta', 'doble_cobro']);
  });
});
