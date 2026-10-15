import { describe, expect, it } from 'vitest';
import type { Http, PeticionHttp, RespuestaHttp } from '../tipos';
import type { MapeoTms } from './mapeo';
import { paginar, type ConfigPaginacion, type PuntoReanudo } from './paginar';
import { SesionTms } from './sesion';

// Todo sintético: folios y montos inventados. Relojes inyectados: ninguna prueba duerme de verdad.
const BASE = 'https://tms.ejemplo.test';
const LOGIN = { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' };
const CRED = { usuario: 'usuario-sintetico', clave: 'clave-sintetica' };
const VENTANA = { desde: '2026-01-01T00:00:00Z', hasta: '2026-01-31T23:59:59Z' };

const MAPEO: MapeoTms = {
  recurso: 'peajes', ruta: '/api/peajes', metodo: 'GET',
  params: { desde: 'desde', hasta: 'hasta', pagina: 'pagina', tam: 'tam' },
  raiz: 'data.items',
  campos: { folio: 'folio', importe: { fuente: 'importe', transformar: 'numero' } },
  clave_externa: ['folio'], obligatorios: ['folio'],
};
const MAPEO_CURSOR: MapeoTms = { ...MAPEO, params: { desde: 'desde', hasta: 'hasta', cursor: 'cursor', tam: 'tam' } };
const MAPEO_OFFSET: MapeoTms = { ...MAPEO, params: { desde: 'desde', hasta: 'hasta', tam: 'tam' } };

const filasDe = (n: number): { folio: string; importe: number }[] =>
  Array.from({ length: n }, (_, i) => ({ folio: `F-${String(i + 1).padStart(3, '0')}`, importe: 100 + i }));
const folios = (r: { filas: { fila: unknown }[] }): string[] => r.filas.map((f) => (f.fila as { folio: string }).folio);

const json = (estado: number, o: unknown): RespuestaHttp => ({ estado, cuerpo: JSON.stringify(o), encabezados: {} });

interface Opc {
  /** Peticiones de datos (1-based) que contestan estas respuestas en lugar de lo normal. */
  forzar?: Record<number, RespuestaHttp>;
  /** Cada petición de datos mueve el reloj. */
  alAtender?: () => void;
  /** Ignora el avance de página/offset y siempre contesta la primera. */
  ignoraAvance?: boolean;
  /** El cursor siguiente de la primera página apunta a sí mismo. */
  cursorCircular?: boolean;
}

/** Servidor falso mínimo: login + una lista paginada por página, cursor u offset. */
function servidor(todas: { folio: string; importe: number }[], modo: 'pagina' | 'cursor' | 'offset', tam: number, o: Opc = {}) {
  const peticiones: Record<string, string>[] = [];
  const http: Http = async (p: PeticionHttp) => {
    const u = new URL(p.url);
    if (u.pathname === '/api/login') return json(200, { token: 'tok-sintetico' });
    o.alAtender?.();
    const q = Object.fromEntries(u.searchParams);
    peticiones.push(q);
    const n = peticiones.length;
    if (o.forzar?.[n]) return o.forzar[n];
    if (modo === 'pagina') {
      const pag = o.ignoraAvance ? 1 : Number(q.pagina ?? 1);
      return json(200, { data: { items: todas.slice((pag - 1) * tam, pag * tam) } });
    }
    if (modo === 'offset') {
      const off = o.ignoraAvance ? 0 : Number(q.off ?? 0);
      return json(200, { data: { items: todas.slice(off, off + tam) } });
    }
    const ini = q.cursor === undefined ? 0 : Number(q.cursor.replace('c', ''));
    const fin = ini + tam;
    const sig = o.cursorCircular ? 'c0' : (fin < todas.length ? `c${fin}` : null);
    return json(200, { data: { items: todas.slice(ini, fin), siguiente: sig } });
  };
  return { http, peticiones };
}

function reloj(inicio = 1_000_000) {
  let t = inicio;
  return { ahora: () => t, dormir: async (ms: number) => { t += ms; }, avanza: (ms: number) => { t += ms; }, get t() { return t; } };
}
const sesionDe = (http: Http, r: ReturnType<typeof reloj>, venceEn?: number) =>
  new SesionTms({ http, base: BASE, login: LOGIN, credenciales: CRED, reloj: { ahora: r.ahora, dormir: r.dormir, venceEn } });

const PAG = (tamano: number): ConfigPaginacion => ({ tipo: 'pagina', tamano });
const CUR: ConfigPaginacion = { tipo: 'cursor', ruta_siguiente: 'data.siguiente', tamano: 3 };
const OFF = (tamano: number): ConfigPaginacion => ({ tipo: 'offset', param: 'off', tamano });

describe('paginar', () => {
  it('por página: 3 páginas llenas → todas las filas en orden, completa, y llama con los parámetros del mapeo', async () => {
    const r = reloj(); const s = servidor(filasDe(7), 'pagina', 3);
    const out = await paginar(sesionDe(s.http, r), MAPEO, VENTANA, { paginacion: PAG(3) });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(folios(out)).toEqual(filasDe(7).map((f) => f.folio));
    expect(out.completa).toBe(true);
    expect(out.backlog).toBe(false);
    expect(out.paginas).toBe(4); // 3 con filas + la vacía que marca el final
    expect(s.peticiones[0]).toMatchObject({ desde: VENTANA.desde, hasta: VENTANA.hasta, pagina: '1', tam: '3' });
    expect(s.peticiones[2]).toMatchObject({ pagina: '3' });
  });

  it('por cursor: sigue el cursor hasta que no hay siguiente, sin pedir una página de más', async () => {
    const r = reloj(); const s = servidor(filasDe(7), 'cursor', 3);
    const out = await paginar(sesionDe(s.http, r), MAPEO_CURSOR, VENTANA, { paginacion: CUR });
    expect(out.ok && folios(out)).toEqual(filasDe(7).map((f) => f.folio));
    expect(out.ok && out.completa).toBe(true);
    expect(out.ok && out.paginas).toBe(3);
    expect(s.peticiones[0].cursor).toBeUndefined();
    expect(s.peticiones[1].cursor).toBe('c3');
  });

  it('por offset: avanza lo realmente recibido y termina en lista vacía', async () => {
    const r = reloj(); const s = servidor(filasDe(5), 'offset', 2);
    const out = await paginar(sesionDe(s.http, r), MAPEO_OFFSET, VENTANA, { paginacion: OFF(2) });
    expect(out.ok && folios(out)).toEqual(filasDe(5).map((f) => f.folio));
    expect(out.ok && out.completa).toBe(true);
    expect(s.peticiones.map((q) => q.off)).toEqual(['0', '2', '4', '5']);
  });

  it('sin paginación declarada hace UNA sola petición y la da por completa', async () => {
    const r = reloj(); const s = servidor(filasDe(2), 'offset', 10);
    const out = await paginar(sesionDe(s.http, r), MAPEO_OFFSET, VENTANA);
    expect(out.ok && folios(out)).toEqual(['F-001', 'F-002']);
    expect(s.peticiones).toHaveLength(1);
  });

  it('cursor repetido → se detiene con aviso, conserva lo leído y NO se declara completa', async () => {
    const r = reloj(); const s = servidor(filasDe(9), 'cursor', 3, { cursorCircular: true });
    const out = await paginar(sesionDe(s.http, r), MAPEO_CURSOR, VENTANA, { paginacion: CUR });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.completa).toBe(false);
    expect(out.backlog).toBe(false);
    expect(out.avisos.join(' ')).toMatch(/repiti/);
    expect(folios(out)).toEqual(['F-001', 'F-002', 'F-003']);
    expect(out.paginas).toBeLessThanOrEqual(3);
  });

  it('origen que ignora la página y repite lo mismo → aviso y se detiene (sin bucle)', async () => {
    const r = reloj(); const s = servidor(filasDe(9), 'pagina', 3, { ignoraAvance: true });
    const out = await paginar(sesionDe(s.http, r), MAPEO, VENTANA, { paginacion: PAG(3) });
    expect(out.ok && out.completa).toBe(false);
    expect(out.ok && out.avisos.join(' ')).toMatch(/sin filas nuevas/);
    expect(out.ok && folios(out)).toEqual(['F-001', 'F-002', 'F-003']);
    expect(s.peticiones).toHaveLength(2);
  });

  it.each([
    ['pagina', MAPEO, PAG(2)],
    ['cursor', MAPEO_CURSOR, { tipo: 'cursor', ruta_siguiente: 'data.siguiente', tamano: 2 } as ConfigPaginacion],
    ['offset', MAPEO_OFFSET, OFF(2)],
  ] as const)('presupuesto agotado a mitad (%s) → backlog; reanudar entrega el resto SIN duplicados', async (modo, mapeo, cfg) => {
    const todas = filasDe(9);
    const r = reloj();
    const venceEn = r.t + 25; // cada petición de datos cuesta 10 ms: caben 3 páginas
    const s1 = servidor(todas, modo, 2, { alAtender: () => r.avanza(10) });
    const a = await paginar(sesionDe(s1.http, r, venceEn), mapeo, VENTANA, { paginacion: cfg, venceEn, ahora: r.ahora });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.backlog).toBe(true);
    expect(a.completa).toBe(false);
    expect(a.reanudar?.tipo).toBe(modo);
    expect(folios(a)).toEqual(todas.slice(0, 6).map((f) => f.folio));

    // Siguiente ciclo: reloj nuevo, mismo origen, desde el punto guardado (viaja por JSON como lo haría en base de datos).
    const guardado = JSON.parse(JSON.stringify(a.reanudar)) as PuntoReanudo;
    const r2 = reloj();
    const s2 = servidor(todas, modo, 2);
    const b = await paginar(sesionDe(s2.http, r2), mapeo, { ...VENTANA, reanudar: guardado }, { paginacion: cfg });
    expect(b.ok && b.completa).toBe(true);
    if (!b.ok) return;
    expect(folios(b)).toEqual(todas.slice(6).map((f) => f.folio));
    const union = [...folios(a), ...folios(b)];
    expect(union).toEqual(todas.map((f) => f.folio));
    expect(new Set(union).size).toBe(todas.length);
  });

  it('fusible de páginas (maxPaginas) → backlog con punto de reanudación', async () => {
    const r = reloj(); const s = servidor(filasDe(10), 'pagina', 2);
    const out = await paginar(sesionDe(s.http, r), MAPEO, VENTANA, { paginacion: PAG(2), maxPaginas: 2 });
    expect(out.ok && out.backlog).toBe(true);
    expect(out.ok && out.reanudar).toEqual({ tipo: 'pagina', pagina: 3 });
    expect(out.ok && out.avisos.join(' ')).toMatch(/tope/);
    expect(out.ok && folios(out)).toEqual(['F-001', 'F-002', 'F-003', 'F-004']);
  });

  it('misma fila en dos páginas (el origen desplazó filas entre peticiones) → una sola vez', async () => {
    const r = reloj();
    const todas = filasDe(4);
    // La página 2 repite la última fila de la 1: [F1,F2] [F2,F3] [F4]
    const forzar = {
      1: json(200, { data: { items: [todas[0], todas[1]] } }),
      2: json(200, { data: { items: [todas[1], todas[2]] } }),
      3: json(200, { data: { items: [todas[3]] } }),
      4: json(200, { data: { items: [] } }),
    };
    const s = servidor(todas, 'pagina', 2, { forzar });
    const out = await paginar(sesionDe(s.http, r), MAPEO, VENTANA, { paginacion: PAG(2) });
    expect(out.ok && folios(out)).toEqual(['F-001', 'F-002', 'F-003', 'F-004']);
    expect(out.ok && out.duplicadas).toBe(1);
  });

  it('página 2 con 500 → reintenta con backoff y no duplica la página 1', async () => {
    const r = reloj();
    const s = servidor(filasDe(5), 'pagina', 2, { forzar: { 2: json(500, { error: 'x' }) } });
    const out = await paginar(sesionDe(s.http, r), MAPEO, VENTANA, { paginacion: PAG(2) });
    expect(out.ok).toBe(true);
    expect(out.ok && folios(out)).toEqual(filasDe(5).map((f) => f.folio));
    expect(out.ok && out.duplicadas).toBe(0);
    expect(s.peticiones[1].pagina).toBe('2');
    expect(s.peticiones[2].pagina).toBe('2'); // el reintento pidió LA MISMA página, no la siguiente
  });

  it('500 que no cede → falla con lo leído a salvo y el punto exacto para continuar', async () => {
    const r = reloj();
    const forzar = Object.fromEntries([2, 3, 4, 5, 6].map((n) => [n, json(503, {})]));
    const s = servidor(filasDe(6), 'pagina', 2, { forzar });
    const out = await paginar(sesionDe(s.http, r), MAPEO, VENTANA, { paginacion: PAG(2) });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.falla).toBe('proveedor');
    expect(out.backlog).toBe(true);
    expect(folios(out.parcial)).toEqual(['F-001', 'F-002']);
    expect(out.parcial.reanudar).toEqual({ tipo: 'pagina', pagina: 2 });
  });

  it('filas rechazadas por el mapeo no se pierden en silencio y no frenan la paginación', async () => {
    const r = reloj();
    const todas = [{ folio: 'F-001', importe: 1 }, { folio: '', importe: 2 }, { folio: 'F-003', importe: 3 }];
    const s = servidor(todas, 'pagina', 2);
    const out = await paginar(sesionDe(s.http, r), MAPEO, VENTANA, { paginacion: PAG(2) });
    expect(out.ok && folios(out)).toEqual(['F-001', 'F-003']);
    expect(out.ok && out.rechazadas).toHaveLength(1);
    expect(out.ok && out.rechazadas[0].motivo).toMatch(/página 1.*folio/);
  });

  it('403 → falla de credencial; cuerpo que no es JSON → falla de formato', async () => {
    const r = reloj();
    const a = await paginar(sesionDe(servidor(filasDe(2), 'pagina', 2, { forzar: { 1: json(403, {}) } }).http, r), MAPEO, VENTANA, { paginacion: PAG(2) });
    expect(!a.ok && a.falla).toBe('credencial');
    const b = await paginar(sesionDe(servidor(filasDe(2), 'pagina', 2, { forzar: { 1: { estado: 200, cuerpo: '<html>login</html>' } } }).http, r), MAPEO, VENTANA, { paginacion: PAG(2) });
    expect(!b.ok && b.falla).toBe('formato');
  });

  it('configuración incoherente: paginación sin su parámetro en el mapeo, o reanudar de otro tipo → falla clara sin pedir nada', async () => {
    const r = reloj(); const s = servidor(filasDe(2), 'pagina', 2);
    const a = await paginar(sesionDe(s.http, r), MAPEO_OFFSET, VENTANA, { paginacion: PAG(2) });
    expect(!a.ok && a.motivo).toMatch(/params\.pagina/);
    const b = await paginar(sesionDe(s.http, r), MAPEO, { ...VENTANA, reanudar: { tipo: 'offset', offset: 4 } }, { paginacion: PAG(2) });
    expect(!b.ok && b.motivo).toMatch(/reanudación/);
    expect(s.peticiones).toHaveLength(0);
  });
});
