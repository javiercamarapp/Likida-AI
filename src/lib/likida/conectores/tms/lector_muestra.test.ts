import { describe, it, expect, vi } from 'vitest';
import { crearServidorTmsFalso, comoHttpDeConector, type BitacoraMuestraSintetica, type ConfigMuestraFalsa } from './falso/servidor';
import { BITACORA_MUESTRA, PADRON_MUESTRA } from '../../liquidacion_externa/desglose_muestra_tms.fixture';
import { CONFIG_PULL_MUESTRA_TMS, type ConfigPullMuestraTms } from '../../liquidacion_externa/desglose_muestra_pull_config';
import { TmsCredenciales, TmsNoDisponible } from '../../liquidacion_externa/desglose_puerto';
import { pullDesgloses, type DependenciasPull } from '../../liquidacion_externa/pull_desglose';
import type { ResultadoDesglose } from '../../liquidacion_externa/desglose_recibir';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const { crearLectorMuestraTms } = await import('./lector_muestra');
const { lectoresDesglosesTms } = await import('./lector_desgloses');
const { SesionTms } = await import('./sesion');

const AHORA = Date.parse('2026-10-15T18:00:00.000Z');
const base = (id: number, extra: Record<string, unknown> = {}): BitacoraMuestraSintetica => ({
  ...(JSON.parse(JSON.stringify(BITACORA_MUESTRA)) as BitacoraMuestraSintetica), BitacoraID: id,
  Fecha: { Inicia: '2026-10-13 06:00:00', Termina: `2026-10-14 ${String(8 + (id % 10)).padStart(2, '0')}:00:00` }, ...extra,
});

function montar(bitacoras: BitacoraMuestraSintetica[], cfg: Partial<ConfigPullMuestraTms> = {}, muestra: ConfigMuestraFalsa = {}, reloj: () => number = () => AHORA) {
  const servidor = crearServidorTmsFalso({ bitacorasMuestra: bitacoras, muestra, reloj, vigenciaTokenMs: 3_600_000 });
  const sesion = new SesionTms({
    http: comoHttpDeConector(servidor), base: 'https://tms.ejemplo.test', login: { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' },
    credenciales: { usuario: 'usuario-sintetico', clave: 'clave-sintetica' }, reloj: { ahora: () => AHORA, dormir: async () => undefined },
  });
  const config: ConfigPullMuestraTms = { ...CONFIG_PULL_MUESTRA_TMS, ruta: '/api/bitacoras', ...cfg };
  const lector = crearLectorMuestraTms({ sesion, ahora: () => AHORA, config, padron: async () => PADRON_MUESTRA });
  return { servidor, lector };
}
const leer = (l: ReturnType<typeof montar>['lector'], limite = 50) => l.listar({ tenantId: 't', cursor: null, limite });
const ENVUELTO: Partial<ConfigPullMuestraTms> = { envoltorio: 'envuelto', rutaLista: 'data.items', rutaTotalPaginas: 'data.total_paginas', rutaTotalRegistros: 'data.total', tamano: 2 };

describe('lector muestra-tms por consulta', () => {
  it('lectura completa con arreglo directo: resuelve el operador por nombre y no inventa póliza', async () => {
    const { lector } = montar([base(1), base(2)]);
    const p = await leer(lector);
    expect(p.items.map((d) => d.bitacora)).toEqual(['1', '2']);
    expect(p.items[0]).toMatchObject({ poliza: null, operador: { numeroEmpleado: '1001' }, desde: '2026-10-13', hasta: '2026-10-14' });
    expect(p.rechazadas ?? []).toEqual([]);
    expect(p.hayMas).toBe(false);
  });

  it('con envoltorio, paginado (varias páginas) y totales: lee TODAS las páginas', async () => {
    const { lector, servidor } = montar([1, 2, 3, 4, 5].map((i) => base(i)), ENVUELTO, { envoltorio: 'items', conTotales: true });
    const p = await leer(lector);
    expect(p.items.map((d) => d.bitacora)).toEqual(['1', '2', '3', '4', '5']);
    expect(servidor.solicitudesDatos).toBe(3);
  });

  it('envoltorio `{ data: [...] }` sin totales: sigue hasta una página corta', async () => {
    const { lector } = montar([1, 2, 3].map((i) => base(i)), { envoltorio: 'envuelto', rutaLista: 'data', tamano: 2 }, { envoltorio: 'data' });
    expect((await leer(lector)).items).toHaveLength(3);
  });

  it('idempotencia al reintentar: dos lecturas dan lo mismo y el pull no recibe dos veces (clave estable)', async () => {
    const { lector } = montar([base(1, { Operador: 'Operador Ficticio Dos' })]);
    const a = await leer(lector); const b = await leer(lector);
    expect(b.items).toEqual(a.items);
    expect(b.siguiente).toEqual(a.siguiente);
  });

  it('operador homónimo y ausente: rechazadas como operador_no_encontrado, sin nombres en el detalle', async () => {
    const { lector } = montar([base(1, { Operador: 'Homónimo Ficticio' }), base(2, { Operador: 'Nadie Conocido' })]);
    const p = await leer(lector);
    expect(p.items).toEqual([]);
    expect(p.rechazadas).toHaveLength(2);
    expect(p.rechazadas?.map((r) => r.tipo)).toEqual(['operador_no_encontrado', 'operador_no_encontrado']);
    expect(p.rechazadas?.map((r) => r.detalle?.motivo)).toEqual(['nombre_ambiguo', 'nombre_sin_alta']);
    expect(JSON.stringify(p.rechazadas)).not.toMatch(/Hom|Nadie/);
    expect(p.rechazadas?.[0].detalle?.desde).toEqual(expect.any(String));
  });

  it('monto con más de 2 decimales: rechazada con el nombre del campo, sin el valor', async () => {
    const mala = base(1); mala.Percepciones[0] = { Descripcion: 'Sueldo semanal', Monto: 100.505 };
    const p = await leer(montar([mala]).lector);
    expect(p.items).toEqual([]);
    expect(p.rechazadas?.[0]).toMatchObject({ clave: 'BIT-1', campo: 'Percepciones[0].Monto' });
    expect(JSON.stringify(p.rechazadas)).not.toContain('100.505');
  });

  it('fecha inválida: rechazada visible en la primera lectura y no mueve el cursor', async () => {
    const mala = base(1, { Fecha: { Inicia: '2026-10-13 06:00:00', Termina: 'ayer por la tarde' } });
    // el servidor falso filtra por fecha ilegible (NaN) y no la entrega: se sirve cruda con un servidor propio
    const p = await crearLectorCrudo([mala, base(2)]).listar({ tenantId: 't', cursor: null, limite: 10 });
    expect(p.items.map((d) => d.bitacora)).toEqual(['2']);
    expect(p.rechazadas).toEqual([{ clave: 'BIT-1', campo: 'Fecha.Termina' }]);
    expect(p.siguiente?.despuesDe).toBe('BIT-2');
  });

  it('BitacoraID repetida con contenido distinto: ambas a revisión; idéntica: una sola', async () => {
    const a = base(1); const b = base(1, { Unidad: '0999' });
    const p = await crearLectorCrudo([a, b]).listar({ tenantId: 't', cursor: null, limite: 10 });
    expect(p.items).toEqual([]);
    expect(p.rechazadas).toHaveLength(2);
    const q = await crearLectorCrudo([a, JSON.parse(JSON.stringify(a))]).listar({ tenantId: 't', cursor: null, limite: 10 });
    expect(q.items).toHaveLength(1);
  });

  it('401 por token vencido a media lectura: UN re-login y sigue', async () => {
    let t = AHORA;
    const { lector, servidor } = montar([base(1), base(2)], {}, {}, () => t);
    // el token se emite con vigencia 3.6e6 ms; se adelanta el reloj del servidor para vencerlo
    await leer(lector);
    t += 4_000_000;
    const p = await leer(lector);
    expect(p.items).toHaveLength(2);
    expect(servidor.logins).toBe(2);
  });

  it('403: TmsCredenciales sin filtrar la clave', async () => {
    const e = await leer(montar([base(1)], {}, { prohibido: true }).lector).catch((x: Error) => x);
    expect(e).toBeInstanceOf(TmsCredenciales);
    expect(String((e as Error).message)).not.toContain('clave-sintetica');
  });

  it('error a media paginación: lanza y NO devuelve datos a medias', async () => {
    const { lector } = montar([1, 2, 3, 4, 5].map((i) => base(i)), ENVUELTO, { envoltorio: 'items', conTotales: true, falla503DesdePagina: 2 });
    await expect(leer(lector)).rejects.toBeInstanceOf(TmsNoDisponible);
  });

  it('paginación incompleta: página vacía antes del total, o total declarado distinto: lanza', async () => {
    const cinco = [1, 2, 3, 4, 5].map((i) => base(i));
    await expect(leer(montar(cinco, ENVUELTO, { envoltorio: 'items', conTotales: true, paginaVaciaEn: 2 }).lector)).rejects.toThrow(/incompleta/);
    await expect(leer(montar(cinco, ENVUELTO, { envoltorio: 'items', conTotales: true, totalDeclaradoExtra: 3 }).lector)).rejects.toThrow(/incompleta/);
  });

  it('tope de páginas excedido: no se declara completa', async () => {
    const { lector } = montar([1, 2, 3, 4, 5].map((i) => base(i)), { ...ENVUELTO, rutaTotalPaginas: null, rutaTotalRegistros: null, maxPaginas: 2 }, { envoltorio: 'items' });
    await expect(leer(lector)).rejects.toThrow(/tope/);
  });

  it('respuesta sin la lista esperada: lanza con frase propia', async () => {
    const { lector } = montar([base(1)], { envoltorio: 'envuelto', rutaLista: 'data.items' }, { envoltorio: 'arreglo' });
    await expect(leer(lector)).rejects.toThrow(/no trae la lista/);
  });

  it('padrón que falla: la lectura falla (cursor intacto)', async () => {
    const servidor = crearServidorTmsFalso({ bitacorasMuestra: [base(1)], reloj: () => AHORA });
    const sesion = new SesionTms({ http: comoHttpDeConector(servidor), base: 'https://tms.ejemplo.test', login: { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' }, credenciales: { usuario: 'usuario-sintetico', clave: 'clave-sintetica' }, reloj: { ahora: () => AHORA, dormir: async () => undefined } });
    const l = crearLectorMuestraTms({ sesion, ahora: () => AHORA, config: { ...CONFIG_PULL_MUESTRA_TMS, ruta: '/api/bitacoras' }, padron: async () => { throw new Error('base caída'); } });
    await expect(leer(l)).rejects.toThrow('base caída');
  });

  it('parámetros de fecha configurables (hora de México) y solo se hacen GET', async () => {
    const vistos: Array<{ metodo: string; url: string }> = [];
    const servidor = crearServidorTmsFalso({ bitacorasMuestra: [base(1)], reloj: () => AHORA });
    const http = comoHttpDeConector(servidor);
    const sesion = new SesionTms({
      http: async (p) => { vistos.push({ metodo: p.metodo, url: p.url }); return http(p); }, base: 'https://tms.ejemplo.test',
      login: { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' }, credenciales: { usuario: 'usuario-sintetico', clave: 'clave-sintetica' },
      reloj: { ahora: () => AHORA, dormir: async () => undefined },
    });
    const l = crearLectorMuestraTms({ sesion, ahora: () => AHORA, config: { ...CONFIG_PULL_MUESTRA_TMS, ruta: '/api/bitacoras', params: { desde: 'FechaIni', hasta: 'FechaFin', pagina: null, tam: null }, formatoFechaParam: 'fecha_hora_mx' }, padron: async () => PADRON_MUESTRA });
    await leer(l);
    const datos = vistos.find((v) => v.url.includes('/api/bitacoras'))!;
    expect(datos.url).toContain('FechaFin=2026-10-15+12%3A00%3A00'); // 18:00Z = 12:00 en México
    expect(vistos.filter((v) => v.metodo !== 'GET').every((v) => v.url.endsWith('/api/login'))).toBe(true);
  });
});

/** Servidor que devuelve EXACTAMENTE estas filas crudas (el falso filtra por fecha y no deja probar un campo ilegible). */
function crearLectorCrudo(items: unknown[]) {
  const s = crearServidorTmsFalso({ reloj: () => AHORA, vigenciaTokenMs: 3_600_000 });
  const b = comoHttpDeConector(s);
  const http: typeof b = async (sol) => (new URL(sol.url).pathname === '/api/bitacoras'
    ? { estado: 200, encabezados: { 'content-type': 'application/json' }, cuerpo: JSON.stringify(items) } : b(sol));
  const sesion = new SesionTms({ http, base: 'https://tms.ejemplo.test', login: { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' }, credenciales: { usuario: 'usuario-sintetico', clave: 'clave-sintetica' }, reloj: { ahora: () => AHORA, dormir: async () => undefined } });
  return crearLectorMuestraTms({ sesion, ahora: () => AHORA, config: { ...CONFIG_PULL_MUESTRA_TMS, ruta: '/api/bitacoras', params: { desde: 'desde', hasta: 'hasta', pagina: null, tam: null } }, padron: async () => PADRON_MUESTRA });
}

describe('pull con muestra-tms: sin póliza ⇒ retenida, operador ⇒ revisión, idempotente', () => {
  it('no recibe nada sin póliza, abre las excepciones y, al reintentar, no duplica', async () => {
    const excepciones: Array<{ clave: string; tipo: string; detalle: Record<string, unknown> }> = [];
    const recibidos: string[] = [];
    const deps: DependenciasPull = {
      ahora: () => new Date(AHORA), leerEstado: async () => ({ cursor: null, leidas: 0, importadas: 0, excepciones: 0, ultimoExito: null, ultimaCorrida: null, ultimoError: null }) as never,
      guardarEstado: async () => undefined,
      recibir: async (_t, d): Promise<ResultadoDesglose> => { recibidos.push(d.bitacora); return { estado: 'idempotente', liquidacionId: 'x', claveExterna: `BIT-${d.bitacora}` }; },
      abrirExcepcion: async (_t, clave, tipo, detalle) => {
        const previa = excepciones.find((e) => e.clave === clave && e.tipo === tipo);
        if (!previa) excepciones.push({ clave, tipo, detalle });
        return { id: excepciones.length, nueva: !previa };
      },
      excepcionesSinPoliza: async () => new Map(), resolverExcepcion: async () => false, entregasDe: async () => [],
    };
    const { lector } = montar([base(1), base(2, { Operador: 'Nadie Conocido' })]);
    await pullDesgloses('t', lector, deps);
    await pullDesgloses('t', lector, deps);
    expect(recibidos).toEqual([]); // la muestra no trae póliza: retenida, jamás se inventa
    expect(excepciones.map((e) => `${e.clave}:${e.tipo}`).sort()).toEqual(['BIT-1:sin_poliza', 'BIT-2:operador_no_encontrado']);
    expect(JSON.stringify(excepciones)).not.toMatch(/Nadie/);
  });
});

describe('selección y apagado por defecto', () => {
  const ok = { valores: { base_url: 'https://tms.ejemplo.test', usuario: 'u', clave: 'c' }, probadaEn: '2026-10-01T00:00:00Z', ultimoError: null };
  const deps = { ahora: () => AHORA, tenantsConEnvioActivo: async () => ['t1'], canalDeEntrega: async () => 'correo' as const, credencial: async () => ok };
  it('muestra-tms sin habilitar ⇒ ningún lector; habilitado ⇒ uno; contrato inválido ⇒ ninguno', async () => {
    const sel = { contrato: 'muestra-tms' as const, config: CONFIG_PULL_MUESTRA_TMS };
    expect(await lectoresDesglosesTms({ ...deps, seleccion: sel, muestraHabilitada: async () => false })).toHaveLength(0);
    expect(await lectoresDesglosesTms({ ...deps, seleccion: sel, muestraHabilitada: async () => true, padron: async () => [] })).toHaveLength(1);
    expect(await lectoresDesglosesTms({ ...deps, seleccion: { contrato: 'invalido', motivo: 'x' } })).toHaveLength(0);
    expect(await lectoresDesglosesTms({ ...deps, seleccion: { contrato: 'supuesto' } })).toHaveLength(1);
  });
  it('sin bandera de plataforma la habilitación real es falsa (apagado por defecto)', async () => {
    const sel = { contrato: 'muestra-tms' as const, config: CONFIG_PULL_MUESTRA_TMS };
    const prev = process.env.LIKIDA_TMS_MUESTRA; delete process.env.LIKIDA_TMS_MUESTRA;
    try { expect(await lectoresDesglosesTms({ ...deps, seleccion: sel })).toHaveLength(0); } finally { if (prev !== undefined) process.env.LIKIDA_TMS_MUESTRA = prev; }
  });
});
