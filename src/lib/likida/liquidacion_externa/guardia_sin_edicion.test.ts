import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// GUARDIA «los importes no se editan; las correcciones se hacen en el origen» (T-A1-39).
//
// El coordinador pidió que modificar un pago sea mancomunado (dos personas) y que el agente solo envíe el desglose: no procesa
// bonos ni condiciones. Mientras el dueño no pida otra cosa, NINGUNA acción de servidor ni ruta `/api/v1/liquidaciones-externas/*`
// puede cambiar `concepto`, `monto`, `total` o `neto` (en base: `conceptos` y `total`) de un desglose ya recibido. Permitido:
// reenviar, corregir el correo del operador, registrar y resolver excepciones, y avanzar el estado de entrega.
//
// Tres capas: (1) escáner estático de las escrituras de TODO el código de la superficie; (2) enumeración de acciones de servidor
// y de verbos de las rutas; (3) una base-doble que anota cada escritura de las funciones permitidas. Más el gancho apagado.
// Todo sintético: ningún nombre, correo ni importe reales.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();
const SUPERFICIE = [
  'src/lib/likida/liquidacion_externa',
  'src/app/api/v1/liquidaciones-externas',
  'src/app/dashboard/agentes/liquidacion',
];

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(join(RAIZ, dir))) {
    const ruta = join(dir, nombre);
    if (statSync(join(RAIZ, ruta)).isDirectory()) salida.push(...archivos(ruta));
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.(test|fixture|e2e\.test)\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida.sort();
}
const FUENTES = SUPERFICIE.flatMap(archivos).map((ruta) => ({ ruta, texto: readFileSync(join(RAIZ, ruta), 'utf8') }));

/** Columnas y claves de importe (la columna es `conceptos`/`total`; en el JSON de cada línea, `concepto`/`monto`). */
const IMPORTE = ['conceptos', 'concepto', 'monto', 'total', 'neto'];
const RE_CLAVE_IMPORTE = new RegExp(
  `(?:["']?\\b(?:${IMPORTE.join('|')})["']?\\s*:)|(?:[{,]\\s*(?:${IMPORTE.join('|')})\\s*[,}])|(?:\\.\\.\\.[\\w.]*\\b(?:${IMPORTE.join('|')})\\b)`,
);

/** El texto entre los paréntesis que abre `desde` (índice del «(»), con conteo simple y sin contar los de las cadenas. */
function argumentos(texto: string, desde: number): string {
  let nivel = 0;
  let comilla: string | null = null;
  for (let i = desde; i < texto.length; i++) {
    const c = texto[i];
    if (comilla) { if (c === '\\') i++; else if (c === comilla) comilla = null; continue; }
    if (c === '"' || c === "'" || c === '`') { comilla = c; continue; }
    if (c === '(') nivel++;
    else if (c === ')' && --nivel === 0) return texto.slice(desde + 1, i);
  }
  return texto.slice(desde + 1);
}

interface Escritura { verbo: string; args: string; antes: string }
/** Todas las escrituras sobre filas existentes: `.update(`, `.upsert(` y `transicionar(` (el UPDATE condicional de `repo.ts`). */
function escrituras(texto: string): Escritura[] {
  const res: Escritura[] = [];
  const re = /\.(update|upsert)\(|\btransicionar\(/g;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const abre = m.index + m[0].length - 1;
    res.push({ verbo: m[1] ?? 'transicionar', args: argumentos(texto, abre), antes: texto.slice(Math.max(0, m.index - 300), m.index) });
  }
  return res;
}

/** Lo que la guardia rechaza de un código fuente: devuelve la lista de motivos (vacía = limpio). */
function violaciones(texto: string): string[] {
  const motivos: string[] = [];
  for (const e of escrituras(texto)) {
    if (e.verbo === 'transicionar' && /export async function\s*$/.test(e.antes.trimEnd().slice(-40))) continue; // la declaración
    if (RE_CLAVE_IMPORTE.test(e.args)) motivos.push(`${e.verbo} con columna de importe: ${e.args.replace(/\s+/g, ' ').slice(0, 80)}`);
    if (e.verbo === 'upsert' && /from\(\s*['"]liquidacion_(externa|desglose)['"]\s*\)\s*$/.test(e.antes.trimEnd())) {
      motivos.push('upsert sobre liquidacion_externa/liquidacion_desglose (pisaría un desglose recibido)');
    }
  }
  return motivos;
}

describe('guardia: el escáner mismo (negativas con código sintético)', () => {
  it('rechaza un update que toca conceptos, total, neto o monto', () => {
    for (const col of ['conceptos', 'total', 'neto', 'monto', 'concepto']) {
      expect(violaciones(`await db.from('liquidacion_externa').update({ ${col}: x }).eq('id', i)`), col).not.toEqual([]);
    }
    expect(violaciones(`db.from('liquidacion_externa').update({ "total": 1 })`)).not.toEqual([]);
  });
  it('rechaza la forma abreviada, el spread y transicionar con importes', () => {
    expect(violaciones(`db.from('t').update({ total, estado })`)).not.toEqual([]);
    expect(violaciones(`db.from('t').update({ ...liq.conceptos })`)).not.toEqual([]);
    expect(violaciones(`await transicionar(t, id, ['pendiente'], { estado: 'x', neto: 5 })`)).not.toEqual([]);
  });
  it('rechaza un upsert sobre las tablas del desglose aunque no nombre columnas', () => {
    expect(violaciones(`supabaseAdmin().from('liquidacion_desglose').upsert(fila)`)).not.toEqual([]);
    expect(violaciones(`supabaseAdmin().from('liquidacion_externa').upsert(fila)`)).not.toEqual([]);
  });
  it('deja pasar lo permitido: correo del operador, retención, estado de entrega y excepciones', () => {
    expect(violaciones(`db.from('operador').update({ correo, correo_rebotado_en: null })`)).toEqual([]);
    expect(violaciones(`db.from('liquidacion_desglose').update({ retenida_motivo: null })`)).toEqual([]);
    expect(violaciones(`await transicionar(t, id, ['pendiente'], { estado: 'enviada', enviada_en: ahora })`)).toEqual([]);
    expect(violaciones(`db.from('liquidacion_excepcion').update({ resuelta_en: x })`)).toEqual([]);
    expect(violaciones(`db.from('liquidacion_pull_estado').upsert(fila, { onConflict: 'tenant_id' })`)).toEqual([]);
  });
});

describe('guardia: ninguna escritura del código real toca un importe', () => {
  it('la superficie incluye los archivos esperados (la guardia no se queda mirando una carpeta vacía)', () => {
    const rutas = FUENTES.map((f) => f.ruta);
    expect(rutas).toContain('src/lib/likida/liquidacion_externa/repo.ts');
    expect(rutas).toContain('src/lib/likida/liquidacion_externa/repo_correo.ts');
    expect(rutas).toContain('src/app/dashboard/agentes/liquidacion/page.tsx');
    expect(rutas).toContain('src/app/api/v1/liquidaciones-externas/desgloses/route.ts');
    const total = FUENTES.reduce((n, f) => n + escrituras(f.texto).length, 0);
    expect(total).toBeGreaterThan(10); // hoy hay ~25 `update`/`upsert`/`transicionar`
  });

  it.each(FUENTES.map((f) => [f.ruta, f.texto] as const))('%s: sin update/upsert/transicionar sobre importes', (_ruta, texto) => {
    expect(violaciones(texto)).toEqual([]);
  });

  it('ninguna ruta ni acción llama a un RPC de escritura que no esté en la lista conocida (ninguna toca importes)', () => {
    const conocidos = new Set([
      'reclamar_copia_jefe', 'cerrar_copia_jefe', 'registrar_acuse_no_coincide', 'reclamar_aviso_discrepancia',
      'cerrar_aviso_discrepancia', 'rearmar_aviso_discrepancia', 'reclamar_entregas_correo',
      // 0857: la recepción del desglose en una transacción. Inserta las MISMAS filas que antes insertaba `recibirDesglose`
      // (con el importe de la fuente, sin recalcular) y solo completa lo que falta con la misma huella; nunca actualiza un importe.
      'recibir_desglose_atomico',
    ]);
    const vistos = new Set<string>();
    for (const f of FUENTES) for (const m of f.texto.matchAll(/\.rpc\(\s*['"]([a-z_0-9]+)['"]/g)) vistos.add(m[1]!);
    expect([...vistos].filter((n) => !conocidos.has(n))).toEqual([]);
  });
});

describe('guardia: enumeración de rutas y acciones de servidor', () => {
  const rutas = FUENTES.filter((f) => /\/route\.ts$/.test(f.ruta));

  it('hay rutas /api/v1/liquidaciones-externas/* y ninguna expone PUT, PATCH ni DELETE', () => {
    expect(rutas.map((r) => relative('src/app/api/v1/liquidaciones-externas', r.ruta)).sort()).toEqual([
      'acuses/confirmar/route.ts', 'acuses/route.ts', 'desgloses/route.ts', 'exportacion/route.ts', 'route.ts',
    ]);
    for (const r of rutas) {
      const verbos = [...r.texto.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      expect(verbos.filter((v) => v !== 'GET' && v !== 'POST'), r.ruta).toEqual([]);
    }
  });

  it('las rutas POST solo crean o confirman: ninguna importa una función que edite importes (no existe ninguna)', () => {
    const nombres = FUENTES.flatMap((f) => [...f.texto.matchAll(/export\s+(?:async\s+)?function\s+((?:editar|modificar|actualizar|corregir|cambiar|ajustar)\w*(?:Importe|Monto|Total|Neto|Concepto)\w*)/gi)].map((m) => m[1]));
    expect(nombres).toEqual([]);
  });

  it('las acciones de servidor son exactamente las revisadas; una nueva obliga a revisar esta guardia', () => {
    const acciones: string[] = [];
    for (const f of FUENTES.filter((x) => x.ruta.startsWith('src/app/dashboard/agentes/liquidacion'))) {
      for (const m of f.texto.matchAll(/async function\s+(\w+)\s*\([^)]*\)[^{]*\{\s*['"]use server['"]/g)) acciones.push(`${relative('src/app/dashboard/agentes/liquidacion', f.ruta)}#${m[1]}`);
    }
    expect(acciones.sort()).toEqual([
      'configuracion/page.tsx#accionGuardar',
      'formato/page.tsx#accionGuardarAjustes',
      'formato/page.tsx#accionGuardarTelefonos',
      'formato/page.tsx#accionQuitar',
      'formato/page.tsx#accionSubirMuestra',
      'page.tsx#buscarFiltro',
      'page.tsx#guardarEstrategia',
      'page.tsx#liberarEnvioExterno',
      'page.tsx#reavisarExterna',
      'page.tsx#reenviarCopiaExterna',
      'page.tsx#reenviarDesgloseExterno',
      'page.tsx#reintentarExterna',
      'page.tsx#subirLiquidacionesExternas',
    ]);
  });

  it('el gancho de aprobación mancomunada no está conectado a nada (apagado, sin pantalla)', () => {
    const importadores = FUENTES.filter((f) => f.ruta !== 'src/lib/likida/liquidacion_externa/aprobacion_mancomunada.ts' && /aprobacion_mancomunada/.test(f.texto));
    expect(importadores.map((f) => f.ruta)).toEqual([]);
  });
});

// ── (3) La base-doble: lo permitido sigue funcionando y solo escribe columnas permitidas ───────────────────────────────────
type Op = [string, ...unknown[]];
interface Llamada { tabla: string; ops: Op[] }
const llamadas: Llamada[] = [];
function constructor(tabla: string) {
  const ll: Llamada = { tabla, ops: [] };
  llamadas.push(ll);
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'is', 'not', 'or', 'neq', 'order', 'limit']) {
    b[m] = (...a: unknown[]) => { ll.ops.push([m, ...a]); return b; };
  }
  const resolver = () => ({ data: [{ id: 1 }], error: null });
  b.maybeSingle = async () => resolver();
  b.single = async () => resolver();
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resolver()).then(res, rej);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: constructor, rpc: async () => ({ data: [], error: null }) }) }));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const repo = await import('./repo');
const repoCorreo = await import('./repo_correo');
const { reenviarDesglose } = await import('./reenvio_correo');
import { CONFIG_CORREO_POR_DEFECTO, type EntregaCorreo, type NuevaEntrega } from './repo_correo';
import type { LiquidacionExterna } from './repo';

const T = 'tenant-sintetico-1';
const LIQ = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** Las columnas que cada UPDATE/UPSERT de la llamada intentó escribir. */
const escritas = (): Array<{ tabla: string; columnas: string[] }> => llamadas.flatMap((l) =>
  l.ops.filter((o) => o[0] === 'update' || o[0] === 'upsert').map((o) => ({ tabla: l.tabla, columnas: Object.keys((o[1] ?? {}) as object) })));

beforeEach(() => { llamadas.length = 0; });

describe('guardia con base-doble: lo permitido funciona y no escribe importes', () => {
  it('positiva: corregir el correo del operador actualiza solo correo y la marca de rebote', async () => {
    await repoCorreo.guardarContactoOperador(T, 'op-1', { correo: 'ana.prueba@ejemplo.test' });
    expect(escritas()).toEqual([{ tabla: 'operador', columnas: ['correo', 'correo_rebotado_en'] }]);
  });

  it('positiva: liberar una retención solo vacía retenida_motivo del encabezado', async () => {
    await expect(repoCorreo.liberarRetencionDesglose(T, LIQ)).resolves.toBe(true);
    expect(escritas()).toEqual([{ tabla: 'liquidacion_desglose', columnas: ['retenida_motivo'] }]);
  });

  it('positiva: resolver una excepción solo escribe resuelta_en', async () => {
    await repoCorreo.resolverExcepcion(T, 7, new Date('2026-10-14T18:30:00.000Z'));
    expect(escritas()).toEqual([{ tabla: 'liquidacion_excepcion', columnas: ['resuelta_en'] }]);
  });

  it('positiva: avanzar el estado de una liquidación escribe estado y updated_at, nunca importes', async () => {
    await repo.transicionar(T, LIQ, ['pendiente'], { estado: 'enviada', enviada_en: '2026-10-14T18:30:00.000Z' });
    const [e] = escritas();
    expect(e?.tabla).toBe('liquidacion_externa');
    expect(e?.columnas.sort()).toEqual(['enviada_en', 'estado', 'updated_at']);
  });

  it('positiva: reenviar y corregir el correo siguen funcionando (nueva generación, correo guardado antes)', async () => {
    const insertadas: NuevaEntrega[] = [];
    const guardados: string[] = [];
    const entrega: EntregaCorreo = {
      id: 'e-1', tenantId: T, liquidacionExternaId: LIQ, generacion: 1, rol: 'operador', correo: 'ana.prueba@ejemplo.test',
      estado: 'rebotada', intentos: 1, proximoIntentoEn: '2026-10-14T08:00:00.000Z', claimToken: null, claimExpiraEn: null,
      resendId: 're_1', ultimoError: null, disparo: 'auto', xlsxRuta: `${T}/x.xlsx`, xlsxSha256: 'abc',
      enviadaEn: '2026-10-14T08:00:00.000Z', entregadaEn: null, rebotadaEn: '2026-10-14T09:00:00.000Z', creadaEn: '2026-10-13T08:00:00.000Z',
    };
    const r = await reenviarDesglose(T, LIQ, { a: 'operador', actor: { userId: 'user-1', rol: 'flota_admin' }, motivo: 'correccion_de_correo', correoNuevo: 'ana.nueva@ejemplo.test' }, {
      ahora: () => new Date('2026-10-14T18:30:00.000Z'),
      leerLiquidacion: async () => ({ id: LIQ, tenantId: T, operadorId: 'op-1' } as unknown as LiquidacionExterna),
      leerConfig: async () => ({ ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true }),
      leerContacto: async () => ({ operadorId: 'op-1', correo: 'ana.prueba@ejemplo.test', correoRebotadoEn: '2026-10-14T09:00:00.000Z', coordinadorId: null }),
      leerCoordinador: async () => null,
      entregas: async () => [entrega],
      guardarCorreoOperador: async (_t, _o, correo) => { guardados.push(correo); },
      insertarEntregas: async (_t, filas) => { insertadas.push(...filas); return filas.length; },
      registrarEvento: async () => undefined,
    });
    expect(r).toMatchObject({ estado: 'reenviado', generacion: 2 });
    expect(guardados).toEqual(['ana.nueva@ejemplo.test']);
    expect(insertadas).toHaveLength(1);
    // La nueva generación es una entrega nueva: el desglose original no se reescribe.
    expect(escritas()).toEqual([]);
  });

  it('negativa: ninguna escritura de las funciones del repositorio llega con columnas de importe', async () => {
    await repoCorreo.guardarContactoOperador(T, 'op-1', { correo: 'a.prueba@ejemplo.test', coordinadorId: 'c-1' });
    await repoCorreo.liberarRetencionDesglose(T, LIQ);
    await repoCorreo.resolverExcepcion(T, 1, new Date());
    await repo.transicionar(T, LIQ, ['fallida'], { estado: 'pendiente' });
    for (const e of escritas()) expect(e.columnas.filter((c) => IMPORTE.includes(c)), e.tabla).toEqual([]);
    expect(escritas().filter((e) => e.tabla === 'liquidacion_desglose' || e.tabla === 'liquidacion_externa').every((e) => !e.columnas.includes('conceptos') && !e.columnas.includes('total'))).toBe(true);
  });
});

describe('gancho aprobacionMancomunada (apagado por defecto)', () => {
  it('apagado ⇒ ni dos personas distintas lo aprueban, y queda en bitácora sin importes', async () => {
    const { CONFIG_APROBACION_MANCOMUNADA_POR_DEFECTO: apagado, evaluarAprobacionMancomunada, crearBitacoraEnMemoria } = await import('./aprobacion_mancomunada');
    expect(apagado.activa).toBe(false);
    const b = crearBitacoraEnMemoria();
    const r = await evaluarAprobacionMancomunada({ config: apagado, bitacora: b.bitacora }, { liquidacionId: LIQ, campo: 'neto', solicitanteId: 'u-1', motivo: 'error de captura' }, ['u-2']);
    expect(r).toEqual({ estado: 'rechazada', motivo: 'apagada' });
    expect(b.eventos).toHaveLength(1);
    expect(b.eventos[0]).toMatchObject({ liquidacionId: LIQ, campo: 'neto', resultado: 'apagada' });
  });

  it('encendido: un actor ⇒ rechaza; dos distintos ⇒ aprueba; el mismo actor dos veces ⇒ rechaza; todo en bitácora', async () => {
    const { evaluarAprobacionMancomunada, crearBitacoraEnMemoria } = await import('./aprobacion_mancomunada');
    const b = crearBitacoraEnMemoria();
    const deps = { config: { activa: true }, bitacora: b.bitacora };
    const sol = { liquidacionId: LIQ, campo: 'total' as const, solicitanteId: 'u-1', motivo: 'error de captura' };

    expect(await evaluarAprobacionMancomunada(deps, sol, [])).toEqual({ estado: 'rechazada', motivo: 'falta_segundo_actor' });
    expect(await evaluarAprobacionMancomunada(deps, sol, ['u-2'])).toEqual({ estado: 'aprobada', actores: ['u-1', 'u-2'] });
    expect(await evaluarAprobacionMancomunada(deps, sol, ['u-1'])).toEqual({ estado: 'rechazada', motivo: 'mismo_actor' });
    expect(await evaluarAprobacionMancomunada(deps, sol, [' U-1 ', 'u-1'])).toEqual({ estado: 'rechazada', motivo: 'mismo_actor' });
    expect(await evaluarAprobacionMancomunada(deps, { ...sol, motivo: '  ' }, ['u-2'])).toEqual({ estado: 'rechazada', motivo: 'motivo_vacio' });
    expect(b.eventos.map((e) => e.resultado)).toEqual(['falta_segundo_actor', 'aprobada', 'mismo_actor', 'mismo_actor', 'motivo_vacio']);
    // Sin cifras: el evento solo tiene estas claves (ni valor anterior ni nuevo).
    for (const ev of b.eventos) expect(Object.keys(ev).sort()).toEqual(['actores', 'campo', 'liquidacionId', 'resultado']);
  });
});
