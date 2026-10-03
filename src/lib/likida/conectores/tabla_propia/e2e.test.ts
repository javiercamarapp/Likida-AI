/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen fixtures del propio directorio por URL relativa a este archivo, nunca por entrada de usuario. */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluarUbicacion, posicionMasCercanaEnTiempo, type PosicionComparada, type SitioValidable } from '../../conductor/validacion';
import type { Http } from '../tipos';
import { geocercasASitios } from './importar_geocercas';
import { crearLectorTablaPropia, leerPosicionesTablaPropia } from './lector';

// Base en memoria para el asentador real (los 5 casos del E2E de la fila 2): implementa lo que `sincronizarGpsDeFlota` usa de
// PostgREST (select/eq/in/range/order, upsert con onConflict + ignoreDuplicates, update) sobre `unidad`, `viaje`, `posicion`
// y `gps_dispositivo_huerfano`. La llave única de `posicion` (flota, unidad, medida_en) es la de la 0176.
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('../cofre', () => ({ descifrar: (s: string) => JSON.parse(s) as Record<string, string> }));
type Fila = Record<string, unknown>;
const base: { unidad: Fila[]; posicion: Fila[]; huerfano: Fila[] } = { unidad: [], posicion: [], huerfano: [] };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const filtros: Array<[string, unknown]> = []; let dentro: { col: string; vals: unknown[] } | null = null;
      let modo: 'select' | 'upsert' | 'update' = 'select'; let payload: unknown = null; let rango: [number, number] | null = null; let sello: Fila | null = null;
      let opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
      const pasa = (r: Fila) => filtros.every(([c, v]) => r[c] === v) && (!dentro || dentro.vals.includes(r[dentro.col]));
      const resolver = () => {
        if (modo === 'upsert') {
          const filas = payload as Fila[]; const dest = tabla === 'posicion' ? base.posicion : tabla === 'gps_dispositivo_huerfano' ? base.huerfano : [];
          const llave = (opts.onConflict ?? '').split(',');
          const nuevas: Fila[] = [];
          for (const f of filas) { if (!dest.some((x) => llave.every((k) => x[k] === f[k]))) { dest.push({ ...f }); nuevas.push(f); } }
          return { data: nuevas.map((_, i) => ({ id: i })), error: null };
        }
        if (modo === 'update') { for (const u of base.unidad.filter(pasa)) Object.assign(u, sello); return { data: null, error: null }; }
        if (tabla === 'unidad') {
          let filas = base.unidad.filter(pasa); if (rango) filas = filas.slice(rango[0], rango[1] + 1);
          return { data: filas.map((u) => ({ id: u.id, gps_device_id: u.gps_device_id, numero_economico: u.numero_economico })), error: null };
        }
        return { data: [], error: null }; // `viaje` sin viajes vivos: la compuerta de privacidad permite (GPS del camión)
      };
      const f: Record<string, unknown> = {
        select: () => f, eq: (c: string, v: unknown) => { filtros.push([c, v]); return f; }, in: (c: string, vals: unknown[]) => { dentro = { col: c, vals }; return f; },
        order: () => f, range: (a: number, b: number) => { rango = [a, b]; return f; },
        upsert: (filas: unknown, o: typeof opts) => { modo = 'upsert'; payload = filas; opts = o; return f; },
        update: (v: Fila) => { modo = 'update'; sello = v; return f; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resolver()).then(res, rej),
      };
      return f;
    },
  }),
}));
const { sincronizarGpsDeFlota } = await import('../sincronizar_gps');

// ═══════════════════════════════════════════════════════════════════════════
// DE PUNTA A PUNTA, CON FIXTURES DE CONTRATO (sin red, sin base): el archivo de
// SUS posiciones y el de SUS geocercas → el lector → lo que consume el Conductor.
// Es la cadena que hace real «la flota tiene todas sus posiciones en sus tablas»:
//   geocercas de su sistema → sitios;  posiciones de su sistema → `posicion` (UTC);
//   y el Conductor valida la llegada de un hito contra ese sitio con esa posición.
// ═══════════════════════════════════════════════════════════════════════════

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const AHORA = Date.parse('2026-10-20T13:30:00.000Z'); // 07:30 en CDMX
const http = (cuerpo: string): Http => async () => ({ estado: 200, cuerpo });
const reloj = { ahora: () => AHORA, dormir: async () => undefined };

describe('geocercas y posiciones de su sistema alimentan la validación de llegada del Conductor', () => {
  const posiciones = [
    'id_unidad,latitud,longitud,fecha_hora,velocidad_kmh,ignicion',
    'UN-1,25.7801,-100.1899,2026-10-20 07:05:00,0,0', // dentro del patio (≈15 m del centro)
    'UN-2,25.8001,-100.1900,2026-10-20 07:05:00,0,0', // ≈2.2 km del patio
    'UN-3,20.6250,-103.2950,2026-10-20 07:05:00,0,0', // dentro del polígono cuadrado
    'UN-4,20.500810,-103.3000,2026-10-20 07:05:00,0,0', // en la carretera, ≈ 68 m al norte del patio alargado
    'UN-5,20.500050,-103.2990,2026-10-20 07:05:00,0,0', // dentro del patio alargado
  ].join('\n');
  it('la cadena completa', async () => {
    const lg = crearLectorTablaPropia({ modo: 'csv_sftp', base_url: 'https://d.ejemplo.com/p.csv', geocercas_url: 'https://d.ejemplo.com/g.csv' }, { http: http(fx('geocercas.csv')) });
    if (!lg.ok) throw new Error(lg.motivo);
    const geo = await lg.lector.leerGeocercas();
    const s = geocercasASitios(geo.filas);
    expect(s.rechazadas).toEqual([]);
    const sitio = (codigo: string): SitioValidable => {
      const x = s.filas.find((f) => f.codigo === codigo)!;
      return { id: x.codigo, nombre: x.nombre, lat: x.lat, lng: x.lng, radioM: x.radio_m, poligono: x.poligono, aproximada: x.aproximada };
    };

    const r = await leerPosicionesTablaPropia({ modo: 'csv_sftp', base_url: 'https://d.ejemplo.com/p.csv' }, http(posiciones), reloj);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.posiciones.map((p) => p.medidaEn)).toEqual(Array(5).fill('2026-10-20T13:05:00.000Z'));
    const comparada = (deviceId: string): PosicionComparada => {
      const p = r.posiciones.find((x) => x.deviceId === deviceId)!;
      return { lat: p.lat, lng: p.lng, medidaEn: new Date(p.medidaEn), fuente: 'gps' };
    };
    const mensajeEn = new Date('2026-10-20T13:06:00.000Z'); // el chofer escribe a las 07:06 hora local
    const ev = (deviceId: string, codigo: string) => evaluarUbicacion({ sitio: sitio(codigo), posicion: comparada(deviceId), mensajeEn, toleranciaM: 50, ventanaMin: 10 });

    expect(ev('UN-1', 'PATIO-A')).toMatchObject({ resultado: 'validado', fuente: 'gps' });
    expect(ev('UN-2', 'PATIO-A')).toMatchObject({ resultado: 'sin_coincidencia' });
    // el polígono se guarda nativo: un punto DENTRO del polígono valida
    expect(ev('UN-3', 'PL-02')).toMatchObject({ resultado: 'validado', metodo: 'poligono' });
    // P1: el patio alargado de junto a la carretera. Con el círculo que lo contiene la unidad de la carretera «llegaba»; con el polígono no.
    expect(ev('UN-5', 'PATIO-L')).toMatchObject({ resultado: 'validado', metodo: 'poligono' });
    expect(ev('UN-4', 'PATIO-L')).toMatchObject({ resultado: 'sin_coincidencia', metodo: 'poligono' });
    expect(evaluarUbicacion({ sitio: { ...sitio('PATIO-L'), poligono: null }, posicion: comparada('UN-4'), mensajeEn, toleranciaM: 50, ventanaMin: 10 })).toMatchObject({ resultado: 'validado', metodo: 'circulo' });
    // sin el desfase de zona bien resuelto, la misma posición caería fuera de la ventana de 10 min: se prueba que NO
    expect(evaluarUbicacion({ sitio: sitio('PATIO-A'), posicion: comparada('UN-1'), mensajeEn: new Date('2026-10-20T07:06:00.000Z'), toleranciaM: 50, ventanaMin: 10 })).toMatchObject({ motivo: 'ubicacion_fuera_de_ventana' });
    expect(posicionMasCercanaEnTiempo([comparada('UN-1'), comparada('UN-2')], mensajeEn)).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOS 5 CASOS DEL E2E (fila 2 de la re-auditoría, ronda 18): feliz, fallo, duplicado, fuera de orden y otra flota, corriendo
// el ASENTADOR REAL (`sincronizarGpsDeFlota`) sobre fixtures CSV y endpoint, hasta la tabla `posicion` y la validación del
// Conductor. El modo SQL (`pg`) y el SFTP tienen sus propias pruebas y no entran aquí.
// ═══════════════════════════════════════════════════════════════════════════
describe('E2E de la tabla propia: de su archivo o endpoint a `posicion` y a la validación del Conductor', () => {
  const T1 = 't-1'; const T2 = 't-2';
  const CSV = (filas: string[]) => `id_unidad,latitud,longitud,fecha_hora\n${filas.join('\n')}\n`;
  const credCsv = JSON.stringify({ modo: 'csv_sftp', base_url: 'https://datos.ejemplo.com/p.csv' });
  const credEp = JSON.stringify({ modo: 'endpoint', base_url: 'https://api.ejemplo.com/posiciones', mapeo_posiciones: JSON.stringify({ lista: 'data.items', campos: { unidad: 'eco', lat: 'pos.y', lon: 'pos.x', fecha_hora: 'ts', velocidad_kmh: 'vel', ignicion: 'motor' } }), patron: 'bearer', token: 'tok' });
  const sync = (tenant: string, cred: string, cuerpo: string, estado = 200) => sincronizarGpsDeFlota(tenant, 'tabla_propia', cred, (async () => ({ estado, cuerpo })) as Http, () => AHORA, { dormir: async () => undefined });
  const de = (t: string) => base.posicion.filter((p) => p.tenant_id === t);
  const comparada = (p: Fila): PosicionComparada => ({ lat: Number(p.lat), lng: Number(p.lng), medidaEn: new Date(String(p.medida_en)), fuente: 'gps' });
  const PATIO = { id: 'PATIO-A', nombre: 'Patio A', lat: 25.7801, lng: -100.1899, radioM: 100, poligono: null, aproximada: false } as SitioValidable;

  beforeEach(() => {
    base.posicion = []; base.huerfano = [];
    base.unidad = [
      { id: 'u-1', tenant_id: T1, numero_economico: 'UN-001', activo: true, gps_proveedor: null, gps_device_id: null, gps_visto_en: null },
      { id: 'u-2', tenant_id: T1, numero_economico: 'UN-002', activo: true, gps_proveedor: null, gps_device_id: null, gps_visto_en: null },
      { id: 'u-otra', tenant_id: T2, numero_economico: 'UN-001', activo: true, gps_proveedor: null, gps_device_id: null, gps_visto_en: null },
    ];
  });

  it('FELIZ (CSV): el archivo de la flota queda en `posicion` de SUS unidades, en UTC, con gps_visto_en sellado, y el Conductor valida la llegada con esa posición', async () => {
    const r = await sync(T1, credCsv, CSV(['UN-001,25.7801,-100.1899,2026-10-20 07:05:00', 'un 002,25.8001,-100.19,2026-10-20 07:06:00']));
    expect(r).toMatchObject({ leidas: 2, guardadas: 2, huerfanas: 0 });
    expect(r.error).toBeUndefined();
    expect(de(T1).map((p) => [p.unidad_id, p.medida_en])).toEqual([['u-1', '2026-10-20T13:05:00.000Z'], ['u-2', '2026-10-20T13:06:00.000Z']]);
    expect(base.unidad.filter((u) => u.tenant_id === T1).every((u) => typeof u.gps_visto_en === 'string')).toBe(true);
    const mensajeEn = new Date('2026-10-20T13:06:00.000Z');
    expect(evaluarUbicacion({ sitio: PATIO, posicion: comparada(de(T1)[0]), mensajeEn, toleranciaM: 50, ventanaMin: 10 })).toMatchObject({ resultado: 'validado', fuente: 'gps' });
    expect(evaluarUbicacion({ sitio: PATIO, posicion: comparada(de(T1)[1]), mensajeEn, toleranciaM: 50, ventanaMin: 10 })).toMatchObject({ resultado: 'sin_coincidencia' });
  });

  it('FELIZ (endpoint JSON): el fixture del endpoint asienta lo válido por económico normalizado y cuenta la fila (0,0) como inválida', async () => {
    const r = await sync(T1, credEp, fx('endpoint_posiciones.json'));
    expect(r).toMatchObject({ leidas: 2, guardadas: 2, huerfanas: 0, backlog: true }); // la lectura (0,0) se descarta y el poll sale parcial
    expect(r.error).toContain('inválida');
    expect(de(T1).map((p) => p.unidad_id).sort()).toEqual(['u-1', 'u-2']); // «UN-001» y «un 002» ligan con «UN-001» y «UN-002»
    expect(de(T1).find((p) => p.unidad_id === 'u-1')).toMatchObject({ lat: 25.56, lng: -100.94, velocidad: 30, ignicion: true });
  });

  it('FALLO: credencial rechazada, proveedor caído y archivo con otro formato → error con su clase para el backoff y NADA se escribe', async () => {
    expect(await sync(T1, credCsv, '', 401)).toMatchObject({ falla: 'credencial', guardadas: 0 });
    expect(await sync(T1, credCsv, 'x', 500)).toMatchObject({ falla: 'proveedor', backlog: true, guardadas: 0 });
    expect(await sync(T1, credCsv, 'a,b\n1,2\n')).toMatchObject({ falla: 'formato', guardadas: 0 });
    expect(await sync(T1, credEp, '{"otra":1}')).toMatchObject({ falla: 'formato', guardadas: 0 });
    expect(base.posicion).toHaveLength(0);
    expect(base.unidad.every((u) => u.gps_visto_en === null)).toBe(true); // una fuente que falla no se sella como «entrando»
    // y una credencial que no descifra no tumba nada ni toca la red
    expect(await sincronizarGpsDeFlota(T1, 'tabla_propia', 'no-es-json', (async () => { throw new Error('no debía llamarse'); }) as Http, () => AHORA)).toMatchObject({ guardadas: 0 });
  });

  it('DUPLICADO: la misma lectura en la corrida siguiente (camión parado) no se duplica ni cuenta como error', async () => {
    const archivo = CSV(['UN-001,25.7801,-100.1899,2026-10-20 07:05:00']);
    expect(await sync(T1, credCsv, archivo)).toMatchObject({ leidas: 1, guardadas: 1 });
    const r2 = await sync(T1, credCsv, archivo);
    expect(r2).toMatchObject({ leidas: 1, guardadas: 0 });
    expect(r2.error).toBeUndefined();
    expect(de(T1)).toHaveLength(1);
    // la misma lectura repetida DENTRO del mismo archivo tampoco duplica
    base.posicion = [];
    expect(await sync(T1, credCsv, CSV(['UN-001,25.7801,-100.1899,2026-10-20 07:05:00', 'UN-001,25.7801,-100.1899,2026-10-20 07:05:00']))).toMatchObject({ guardadas: 1 });
    expect(de(T1)).toHaveLength(1);
  });

  it('FUERA DE ORDEN: lecturas más viejas que llegan DESPUÉS (o en desorden dentro del archivo) se guardan todas, y el Conductor elige la más cercana en el tiempo al mensaje', async () => {
    await sync(T1, credCsv, CSV(['UN-001,25.8001,-100.19,2026-10-20 07:10:00']));      // llega primero la más nueva: ≈2.2 km del patio
    await sync(T1, credCsv, CSV(['UN-001,25.7801,-100.1899,2026-10-20 07:05:00', 'UN-001,25.7900,-100.1899,2026-10-20 07:08:00'])); // luego dos más viejas, desordenadas
    expect(de(T1).map((p) => p.medida_en).sort()).toEqual(['2026-10-20T13:05:00.000Z', '2026-10-20T13:08:00.000Z', '2026-10-20T13:10:00.000Z']);
    const todas = de(T1).map(comparada);
    const llegada = new Date('2026-10-20T13:05:30.000Z'); // el chofer dice «ya llegué» a las 07:05:30
    const cerca = posicionMasCercanaEnTiempo(todas, llegada)!;
    expect(cerca.medidaEn.toISOString()).toBe('2026-10-20T13:05:00.000Z'); // la de las 07:05, aunque se haya asentado después de la de las 07:10
    expect(evaluarUbicacion({ sitio: PATIO, posicion: cerca, mensajeEn: llegada, toleranciaM: 50, ventanaMin: 10 })).toMatchObject({ resultado: 'validado' });
  });

  it('OTRA FLOTA: el mismo económico de la flota 2 recibe SOLO lo de su archivo, y un archivo no escribe en las unidades de la otra', async () => {
    await sync(T1, credCsv, CSV(['UN-001,25.5,-100.5,2026-10-20 07:20:00']));
    await sync(T2, credCsv, CSV(['UN-001,20.6,-103.3,2026-10-20 07:20:00']));
    expect(de(T1).map((p) => [p.unidad_id, p.lat])).toEqual([['u-1', 25.5]]);
    expect(de(T2).map((p) => [p.unidad_id, p.lat])).toEqual([['u-otra', 20.6]]);
    // una unidad que solo existe en la flota 1 es huérfana para la flota 2: no se «presta»
    const r = await sync(T2, credCsv, CSV(['UN-002,25.5,-100.5,2026-10-20 07:21:00']));
    expect(r).toMatchObject({ guardadas: 0, huerfanas: 1 });
    expect(de(T1)).toHaveLength(1);
    expect(base.huerfano.every((h) => h.tenant_id === T2)).toBe(true);
    expect(base.unidad.find((u) => u.id === 'u-2')!.gps_visto_en).toBeNull();
  });
});
