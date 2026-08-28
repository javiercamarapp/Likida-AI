// ═══════════════════════════════════════════════════════════════════════════
// EL CARRIL COMPLETO — la prueba que faltaba (Fase C, 27-ago-2026).
//
// LO QUE FIJA, y por qué cada cosa:
//
//  1. UNA CORRIDA CON MÁS FOTOS DE LAS QUE CABEN EN EL TIEMPO **CORTA**, y no
//     muere a la mitad. Ésta es la razón entera de que el carril exista: subir
//     `MAX_FOTOS_CARRIL_RAPIDO` de 10 a 91 no habría dado 91 fotos procesadas,
//     habría dado una corrida muerta a media invocación que además mentía.
//  2. LAS QUE NO ALCANZARON TURNO SE **CUENTAN** Y SE **DICEN**, con su
//     número y con su nombre. Es el patrón del PR #152: el runner de
//     producción murió mudo dos veces por motores que iteraban sin mirar el
//     reloj, y lo que lo arregló no fue mirar el reloj — fue mirarlo Y decir
//     quién se quedó sin turno.
//  3. EL AVANCE DE LAS QUE SÍ SE MIDIERON **QUEDA GUARDADO**, foto por foto.
//  4. LA SIGUIENTE PASADA **CONTINÚA SIN REPETIR NINGUNA**. Se verifica sobre
//     los `processInbound` DE VERDAD emitidos: 91 fotos, 91 envíos, cero
//     repetidos. Repetir uno costaría otra llamada al modelo y contaría dos
//     veces el mismo ticket.
//  5. LA IDEMPOTENCIA ES LA RESTRICCIÓN, NO UN `if`: una foto que ya tiene
//     fila no se manda aunque el motor "no la haya visto" — el doble de la
//     base respeta la PK (corrida_id, foto_id) y devuelve 23505, igual que
//     Postgres.
//  6. EL TOPE DE DINERO PARA DE VERDAD, lo dice con la cifra MEDIDA, y
//     CONSERVA el tenant para inspección.
//  7. UNA PASADA QUE MURIÓ CON UNA FOTO EN VUELO deja esa foto en
//     'interrumpida': ni acierto ni fallo, y no se reintenta.
//
// EL DOBLE DE LA BASE respeta las restricciones que IMPORTAN —la PK de
// `qa_corrida_foto` y la de `qa_corrida_paso`—, porque son justamente la
// garantía que la 0240 vino a dar. Un doble que las ignorara probaría el
// doble, no el contrato.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── El reloj de la prueba ───────────────────────────────────────────────────
// Fake sólo de `Date`: `relojAgotado` (agentes/runner.ts) pregunta `Date.now()`
// y nada más, así que controlar el reloj es controlar el corte — sin dormir un
// solo milisegundo real.
const T0 = Date.parse('2026-08-27T15:00:00.000Z');   // 09:00 en México
/** Lo que "tarda" un processInbound en esta prueba. */
const MS_POR_FOTO = 20_000;

type Fila = Record<string, unknown>;
type ErrPg = { code?: string; message: string } | null;

let tablas: Record<string, Fila[]>;
let enviados: Array<{ tipo: string; waMessageId: string; from: string }>;
let costoPorFotoUsd: number;
let seq: number;

/** Las restricciones que la 0185 y la 0240 declaran, respetadas por el doble. */
const UNICO: Record<string, string[]> = {
  qa_foto: ['id'],
  qa_corrida: ['id'],
  qa_corrida_paso: ['corrida_id', 'n'],
  qa_corrida_foto: ['corrida_id', 'foto_id'],
};

const llaveDe = (tabla: string, f: Fila) => (UNICO[tabla] ?? ['id']).map((c) => String(f[c])).join('|');

/** El resultado de un INSERT: el error de Postgres, o LA FILA TAL COMO QUEDÓ.
 *
 *  Devolver la fila guardada —y no el payload— es lo que hace que
 *  `.insert(...).select('id').single()` funcione, que es el patrón con el que
 *  `sembrarTenant` crea tenant, operador, unidad, política y viaje. El default
 *  de la columna `id` lo pone la base, no quien inserta: un doble que
 *  devolviera el payload devolvería una fila SIN id y el `single()` fallaría
 *  con PGRST116 — que fue exactamente lo que pasó antes de este arreglo, y la
 *  siembra entera se caía con «no se obtuvo exactamente una fila». */
type Insercion = { error: ErrPg; fila: Fila | null };

function insertarFila(tabla: string, f: Fila): Insercion {
  const fila = { ...f };
  if (fila.id === undefined && !UNICO[tabla]) fila.id = `${tabla}-${++seq}`;
  if (tabla === 'qa_corrida') {
    fila.creada_en ??= new Date().toISOString();
    fila.latido_en ??= new Date().toISOString();
  }
  if (UNICO[tabla]) {
    const llave = llaveDe(tabla, fila);
    if ((tablas[tabla] ?? []).some((r) => llaveDe(tabla, r) === llave)) {
      return {
        error: { code: '23505', message: `duplicate key value violates unique constraint on ${tabla}` },
        fila: null,
      };
    }
  }
  (tablas[tabla] ??= []).push(fila);
  return { error: null, fila };
}

function dbFalsa(): SupabaseClient {
  const from = (tabla: string) => {
    tablas[tabla] ??= [];
    const preds: Array<(f: Fila) => boolean> = [];
    let modo: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let payload: Fila[] = [];
    let parche: Fila = {};
    let cabeza = false;
    let devolver = false;
    let tope: number | null = null;
    let orden: { col: string; asc: boolean } | null = null;
    let uno: 'single' | 'maybe' | null = null;

    const b: Record<string, unknown> = {};
    const yo = () => b as never;

    b.select = (_cols?: unknown, opts?: { head?: boolean }) => {
      if (modo === 'select') { if (opts?.head) cabeza = true; } else devolver = true;
      return yo();
    };
    b.eq = (c: string, v: unknown) => { preds.push((f) => f[c] === v); return yo(); };
    b.in = (c: string, vs: unknown[]) => { preds.push((f) => vs.includes(f[c])); return yo(); };
    b.lt = (c: string, v: unknown) => {
      preds.push((f) => (typeof v === 'number' ? Number(f[c]) < v : String(f[c]) < String(v)));
      return yo();
    };
    b.gte = (c: string, v: string) => { preds.push((f) => Date.parse(String(f[c])) >= Date.parse(v)); return yo(); };
    b.lte = (c: string, v: string) => { preds.push((f) => Date.parse(String(f[c])) <= Date.parse(v)); return yo(); };
    b.like = (c: string, patron: string) => {
      const re = new RegExp(`^${patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`);
      preds.push((f) => re.test(String(f[c])));
      return yo();
    };
    // El `or` de PostgREST, acotado a las dos formas que `tomarPasada` usa.
    b.or = (expr: string) => {
      const partes = expr.split(',');
      preds.push((f) => partes.some((p) => {
        const i = p.indexOf('.');
        const col = p.slice(0, i);
        const resto = p.slice(i + 1);
        const j = resto.indexOf('.');
        const op = resto.slice(0, j);
        const val = resto.slice(j + 1);
        if (op === 'is' && val === 'null') return f[col] === null || f[col] === undefined;
        if (op === 'lt') return String(f[col] ?? '') < val;
        return false;
      }));
      return yo();
    };
    b.order = (col: string, o?: { ascending?: boolean }) => { orden = { col, asc: o?.ascending !== false }; return yo(); };
    b.limit = (n: number) => { tope = n; return yo(); };
    b.single = () => { uno = 'single'; return yo(); };
    b.maybeSingle = () => { uno = 'maybe'; return yo(); };
    b.insert = (f: Fila | Fila[]) => { modo = 'insert'; payload = Array.isArray(f) ? f : [f]; return yo(); };
    b.upsert = (f: Fila | Fila[]) => { modo = 'upsert'; payload = Array.isArray(f) ? f : [f]; return yo(); };
    b.update = (f: Fila) => { modo = 'update'; parche = f; return yo(); };
    b.delete = () => { modo = 'delete'; return yo(); };

    const filtradas = () => (tablas[tabla] ?? []).filter((f) => preds.every((p) => p(f)));

    const ejecutar = () => {
      let data: Fila[] | null = [];
      let error: ErrPg = null;
      let count: number | null = null;

      if (modo === 'insert') {
        // Las filas COMO QUEDARON, no el payload: con su id puesto por la
        // base. Es lo que un `.select().single()` tras un insert lee.
        const nuevas: Fila[] = [];
        for (const f of payload) {
          const r = insertarFila(tabla, f);
          if (r.error) { error = r.error; data = null; break; }
          nuevas.push(r.fila as Fila);
        }
        if (!error && devolver) data = nuevas;
      } else if (modo === 'upsert') {
        for (const f of payload) {
          const llave = llaveDe(tabla, f);
          const existente = (tablas[tabla] ?? []).find((r) => llaveDe(tabla, r) === llave);
          // ON CONFLICT DO UPDATE SET <columnas del payload>: lo que el
          // payload no trae CONSERVA su valor (por eso `guardarCorrida` no
          // puede pisar `pasada_en_vuelo`).
          if (existente) Object.assign(existente, f);
          else insertarFila(tabla, f);
        }
      } else if (modo === 'update') {
        const tocadas = filtradas();
        for (const f of tocadas) Object.assign(f, parche);
        data = devolver ? tocadas : [];
      } else if (modo === 'delete') {
        const fuera = new Set(filtradas());
        tablas[tabla] = (tablas[tabla] ?? []).filter((f) => !fuera.has(f));
      } else {
        let filas = filtradas();
        if (orden) {
          const o = orden;
          filas = [...filas].sort((a, z) => (String(a[o.col]) < String(z[o.col]) ? -1 : 1) * (o.asc ? 1 : -1));
        }
        if (tope !== null) filas = filas.slice(0, tope);
        count = filas.length;
        data = cabeza ? null : filas;
      }

      if (uno) {
        const filas = (data ?? []) as Fila[];
        if (uno === 'single' && filas.length !== 1) {
          return { data: null, error: { code: 'PGRST116', message: 'no se obtuvo exactamente una fila' }, count };
        }
        return { data: filas[0] ?? null, error, count };
      }
      return { data, error, count };
    };

    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(ejecutar()).then(res, rej);
    return b as never;
  };

  const bucketFalso = () => ({
    download: async () => ({
      data: { arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer },
      error: null,
    }),
    list: async () => ({ data: [], error: null }),
    remove: async () => ({ data: [], error: null }),
    upload: async () => ({ error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: 'https://firmada.example/x' }, error: null }),
  });

  return {
    from,
    storage: {
      from: bucketFalso,
      getBucket: async () => ({ data: { name: 'x' }, error: null }),
      createBucket: async () => ({ error: null }),
    },
  } as unknown as SupabaseClient;
}

// ── Los mocks del entorno del motor ─────────────────────────────────────────
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => dbFalsa() }));

vi.mock('@/lib/likida/processor', () => ({
  processInbound: async (msg: { type: string; waMessageId: string; from: string }) => {
    enviados.push({ tipo: msg.type, waMessageId: msg.waMessageId, from: msg.from });
    // EL TIEMPO PASA. Es lo que hace que el reloj corte de verdad en vez de
    // que la prueba lo simule con un booleano.
    vi.setSystemTime(Date.now() + MS_POR_FOTO);
    const tenant = (tablas.tenant ?? [])[0];
    if (tenant) {
      // El costo MEDIDO que el proveedor reporta, escrito donde el motor lo lee.
      (tablas.llm_costo ??= []).push({
        id: `costo-${enviados.length}`, tenant_id: tenant.id, fase: 'ocr', costo_usd: costoPorFotoUsd,
      });
      if (msg.type === 'text') {
        (tablas.liquidacion ??= []).push({
          id: `liq-${enviados.length}`, tenant_id: tenant.id,
          viaje_id: (tablas.viaje ?? [])[0]?.id,
        });
      }
    }
  },
}));

vi.mock('@/lib/likida/repo', () => ({
  getDatosResponsable: async () => ({ razonSocial: 'ZZZ QA SA DE CV', domicilio: 'QA' }),
}));
vi.mock('@/lib/likida/privacidad', () => ({
  avisoSimplificado: () => 'aviso de privacidad sintético',
  versionAviso: () => 'v-qa',
}));
vi.mock('./qa-oraculos', () => ({
  correrOraculos: async () => ([{
    invariante: '#1  anticipo − gastos = diferencia', oraculo: 'cuadre_balancea (#1)',
    estado: 'ok', severidad: 'CRÍTICO', esperado: 0, real: 0,
  }]),
}));

import { crearCorrida, ejecutarPasada, mezclarEventos } from './qa-motor';
import { guardarCorrida, leerCorrida, leerFotosDeCorrida } from './qa-storage';
import { reservaPorFotoMs, TECHO_PASADA_MS, type ParametrosCorrida } from './qa-tipos';
import { TOPE_CORRIDA_USD } from '../../../scripts/qa-agentes/config.qa';

const uuidFoto = (i: number) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`;

function sembrarBanco(cuantas: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < cuantas; i++) {
    const id = uuidFoto(i);
    ids.push(id);
    (tablas.qa_foto ??= []).push({
      id, hash: `hash-${i}`, path: `banco/hash-${i}.jpg`, mime: 'image/jpeg',
      etiqueta: `ticket-${String(i).padStart(3, '0')}.jpg`, bytes: 100,
      subido_en: new Date().toISOString(), ocr_esperado: null,
    });
  }
  return ids;
}

function parametros(fotoIds: string[]): ParametrosCorrida {
  return {
    anticipo: 10_600, rfcEmpresa: null, ruta: { origen: 'Silao', destino: 'Nuevo Laredo' },
    politica: [{ concepto: 'diesel', topeMonto: 4000 }],
    fotoIds,
    // 'conservar': la limpieza no es lo que esta prueba mide, y conservar
    // mantiene el tenant a la vista como lo haría un aborto real.
    retencion: 'conservar',
  };
}

/** Arranca una corrida del carril completo ya escrita en la base falsa. */
async function nacer(cuantasFotos: number) {
  const ids = sembrarBanco(cuantasFotos);
  const corrida = crearCorrida('demo_guion', parametros(ids), 'completo');
  await guardarCorrida(dbFalsa(), corrida);
  return { corrida, ids };
}

const fotosEnviadas = () => enviados.filter((e) => e.tipo === 'image').map((e) => e.waMessageId);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  tablas = {};
  enviados = [];
  seq = 0;
  costoPorFotoUsd = 0.0005;
});

afterEach(() => {
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════

describe('la reserva de tiempo por foto es MEDIDA, no inventada', () => {
  test('sin ninguna medición reserva el presupuesto que el propio camino declara', () => {
    // 120 s = PRESUPUESTO_WEBHOOK_MS (presupuesto.ts). No es un número de aire:
    // es el techo que processInbound promete para un mensaje entrante.
    expect(reservaPorFotoMs([])).toBe(120_000);
  });

  test('con mediciones reserva el PEOR caso medido por dos, con techo', () => {
    expect(reservaPorFotoMs([5_000, 9_000, 7_000])).toBe(18_000);
    expect(reservaPorFotoMs([90_000])).toBe(120_000);   // el techo manda
    expect(reservaPorFotoMs([0, -3, NaN])).toBe(120_000); // basura ≠ medición
  });
});

describe('91 fotos, un reloj que no alcanza: corta, cuenta, guarda y CONTINÚA', () => {
  test('la pasada 1 corta por reloj, dice cuántas quedaron sin turno y guarda lo medido', async () => {
    const { corrida } = await nacer(91);

    // Un presupuesto de 200 s con fotos de 20 s: no caben las 91 ni de lejos.
    const r1 = await ejecutarPasada(corrida.id, Date.now() + 200_000);

    expect(r1.ok).toBe(true);
    expect(r1.corrio).toBe(true);
    expect(r1.pasada).toBe(1);
    expect(r1.corte).toBe('reloj');
    expect(r1.terminada).toBe(false);

    // CORTÓ: procesó algunas, no todas, y no murió a la mitad.
    expect(r1.fotosProcesadas).toBeGreaterThan(0);
    expect(r1.fotosProcesadas).toBeLessThan(91);

    // LO DICE, con la frase del corte por reloj y con los números medidos.
    expect(r1.motivo).toContain('RELOJ DE LA PASADA 1 agotado');
    expect(r1.motivo).toContain('se quedaron SIN TURNO');
    expect(r1.motivo).toContain('la siguiente pasada continúa desde ahí');
    expect(r1.motivo).toContain(`${Math.round(TECHO_PASADA_MS / 1000)} s`);

    // LAS CUENTA: lo procesado + lo que no tuvo turno = las 91. Ninguna se
    // pierde en el camino, que es lo que un corte mudo sí hace.
    const av = r1.avance!;
    expect(av.total).toBe(91);
    expect(av.ok).toBe(r1.fotosProcesadas);
    expect(av.sinTurno).toBe(91 - r1.fotosProcesadas);
    expect(av.enVuelo).toBe(0);
    expect(av.interrumpidas).toBe(0);
    // Y LAS NOMBRA: los ids de las que faltan, en orden, no sólo un número.
    expect(av.sinTurnoIds).toHaveLength(av.sinTurno);
    expect(av.sinTurnoIds[0]).toBe(uuidFoto(r1.fotosProcesadas));

    // EL AVANCE QUEDÓ GUARDADO, foto por foto, con su costo MEDIDO.
    const filas = await leerFotosDeCorrida(dbFalsa(), corrida.id);
    expect(filas.ok).toBe(true);
    if (!filas.ok) return;
    expect(filas.datos).toHaveLength(r1.fotosProcesadas);
    expect(filas.datos.every((f) => f.estado === 'ok')).toBe(true);
    expect(filas.datos.every((f) => f.costoUsd === costoPorFotoUsd)).toBe(true);
    expect(filas.datos.map((f) => f.n)).toEqual(
      Array.from({ length: r1.fotosProcesadas }, (_, i) => i + 1),
    );

    // La corrida sigue VIVA: un corte por reloj no es un aborto.
    const leida = await leerCorrida(dbFalsa(), corrida.id);
    expect(leida.ok && leida.datos?.estado).toBe('corriendo');
    expect(leida.ok && leida.datos?.corte).toBe('reloj');
    expect(leida.ok && leida.datos?.fase).toBe('fotos');
    // Y la llave quedó SUELTA, para que la siguiente pasada pueda tomarla.
    expect(leida.ok && leida.datos?.pasadaEnVuelo).toBe(null);
  });

  test('la pasada 2 continúa donde quedó — NO repite ni una foto', async () => {
    const { corrida } = await nacer(91);
    const r1 = await ejecutarPasada(corrida.id, Date.now() + 200_000);
    const primeras = fotosEnviadas();
    expect(primeras).toHaveLength(r1.fotosProcesadas);

    const r2 = await ejecutarPasada(corrida.id, Date.now() + 200_000);
    expect(r2.pasada).toBe(2);
    expect(r2.corrio).toBe(true);
    expect(r2.fotosProcesadas).toBeGreaterThan(0);

    const todas = fotosEnviadas();
    // NO SE REPITE NINGUNA: el conjunto crece exactamente en lo que la pasada
    // 2 procesó, y no hay un solo waMessageId duplicado. Repetir uno sería
    // otra llamada al modelo por un ticket ya pagado.
    expect(new Set(todas).size).toBe(todas.length);
    expect(todas.slice(0, primeras.length)).toEqual(primeras);
    expect(todas).toHaveLength(r1.fotosProcesadas + r2.fotosProcesadas);

    // Y el avance guardado es acumulativo, no reiniciado.
    expect(r2.avance!.ok).toBe(r1.fotosProcesadas + r2.fotosProcesadas);
    expect(r2.avance!.sinTurno).toBe(91 - r2.avance!.ok);
  });

  test('con las pasadas que hagan falta llega a las 91 — 91 envíos, cero repetidos', async () => {
    const { corrida } = await nacer(91);

    let pasadas = 0;
    let ultima = await ejecutarPasada(corrida.id, Date.now() + 200_000);
    pasadas += 1;
    // Cota dura para que un bucle que no avance falle en vez de colgarse.
    while (!ultima.terminada && pasadas < 40) {
      ultima = await ejecutarPasada(corrida.id, Date.now() + 200_000);
      pasadas += 1;
    }

    expect(ultima.terminada).toBe(true);
    expect(pasadas).toBeGreaterThan(1);   // de verdad hicieron falta varias

    const imagenes = fotosEnviadas();
    expect(imagenes).toHaveLength(91);
    expect(new Set(imagenes).size).toBe(91);

    const leida = await leerCorrida(dbFalsa(), corrida.id);
    expect(leida.ok).toBe(true);
    if (!leida.ok || !leida.datos) return;
    expect(leida.datos.avance!.ok).toBe(91);
    expect(leida.datos.avance!.sinTurno).toBe(0);
    expect(leida.datos.avance!.interrumpidas).toBe(0);
    expect(leida.datos.fase).toBe('terminada');
    expect(leida.datos.estado).toBe('ok');
    expect(leida.datos.pasadas).toBe(pasadas);
    // El cierre corrió UNA sola vez pese a las N pasadas.
    expect(enviados.filter((e) => e.tipo === 'text')).toHaveLength(1);
  });

  test('una pasada más sobre una corrida terminada no hace nada, y lo dice', async () => {
    const { corrida } = await nacer(3);
    let r = await ejecutarPasada(corrida.id, Date.now() + 600_000);
    while (!r.terminada) r = await ejecutarPasada(corrida.id, Date.now() + 600_000);
    const envios = enviados.length;

    const extra = await ejecutarPasada(corrida.id, Date.now() + 600_000);
    expect(extra.corrio).toBe(false);
    expect(extra.motivo).toContain('ya terminó');
    expect(enviados).toHaveLength(envios);   // ni un envío más
  });
});

describe('la idempotencia es una RESTRICCIÓN, no un `if`', () => {
  test('una foto que ya tiene fila no se manda, aunque el motor no la haya visto antes', async () => {
    const { corrida, ids } = await nacer(4);
    // Otra pasada (o una carrera) ya tomó la foto 2 y la cerró.
    (tablas.qa_corrida_foto ??= []).push({
      corrida_id: corrida.id, foto_id: ids[1], n: 2, estado: 'ok', pasada: 1,
      detalle: null, costo_usd: 0.0005, inicio: new Date().toISOString(), fin: new Date().toISOString(),
    });

    await ejecutarPasada(corrida.id, Date.now() + 600_000);

    // Se mandaron las otras tres y NO la ya tomada.
    const imagenes = fotosEnviadas();
    expect(imagenes).toHaveLength(3);
    const filas = await leerFotosDeCorrida(dbFalsa(), corrida.id);
    expect(filas.ok && filas.datos).toHaveLength(4);
  });

  test('dos pasadas a la vez: la segunda no arranca y dice por qué (la llave la arbitra la base)', async () => {
    const { corrida } = await nacer(3);
    // La corrida quedó tomada por una pasada que acaba de latir.
    const db = dbFalsa();
    await db.from('qa_corrida').update({
      pasada_en_vuelo: 'bbbbbbbb-0000-4000-8000-000000000001',
      latido_en: new Date().toISOString(),
    }).eq('id', corrida.id);

    const r = await ejecutarPasada(corrida.id, Date.now() + 600_000);
    expect(r.ok).toBe(true);
    expect(r.corrio).toBe(false);
    expect(r.motivo).toContain('otra pasada la tiene tomada');
    expect(enviados).toHaveLength(0);   // no gastó un peso
  });

  test('la foto que una pasada muerta dejó en vuelo queda INTERRUMPIDA — ni acierto ni fallo', async () => {
    const { corrida, ids } = await nacer(3);
    (tablas.qa_corrida_foto ??= []).push({
      corrida_id: corrida.id, foto_id: ids[0], n: 1, estado: 'corriendo', pasada: 1,
      detalle: null, costo_usd: null, inicio: new Date().toISOString(), fin: null,
    });
    // La corrida ya estaba sembrada y en fase de fotos (como la dejó la pasada 1).
    await dbFalsa().from('qa_corrida').update({ pasadas: 1, fase: 'fotos', estado: 'corriendo' }).eq('id', corrida.id);

    const r = await ejecutarPasada(corrida.id, Date.now() + 600_000);
    expect(r.ok).toBe(true);

    const filas = await leerFotosDeCorrida(dbFalsa(), corrida.id);
    expect(filas.ok).toBe(true);
    if (!filas.ok) return;
    const primera = filas.datos.find((f) => f.fotoId === ids[0])!;
    expect(primera.estado).toBe('interrumpida');
    expect(primera.detalle).toContain('no se sabe si llegó a procesarse');
    // NO se reintentó: sólo se mandaron las otras dos.
    expect(fotosEnviadas()).toHaveLength(2);
    // Y no se cuenta ni como acierto ni como fallo: renglón propio.
    const leida = await leerCorrida(dbFalsa(), corrida.id);
    expect(leida.ok && leida.datos?.avance?.interrumpidas).toBe(1);
    expect(leida.ok && leida.datos?.avance?.ok).toBe(2);
    expect(leida.ok && leida.datos?.avance?.bad).toBe(0);
    // Lo que la pasada devolvió y lo que quedó en la base dicen LO MISMO — si
    // el parte de vuelta y el estado guardado se separaran, la pantalla y el
    // registro contarían dos historias distintas de la misma corrida.
    expect(r.avance?.interrumpidas).toBe(1);
    expect(r.avance?.ok).toBe(2);
  });
});

describe('el dinero para de verdad, y lo dice con la cifra medida', () => {
  test('al pasar TOPE_CORRIDA_USD: aborta, nombra la cifra, y CONSERVA el tenant', async () => {
    // Una sola foto ya rebasa el tope de $2. El costo lo escribe el mock donde
    // el motor lo lee (llm_costo) — sigue siendo el MEDIDO, no un supuesto.
    costoPorFotoUsd = TOPE_CORRIDA_USD + 0.5;
    const { corrida } = await nacer(10);

    const r = await ejecutarPasada(corrida.id, Date.now() + 600_000);

    expect(r.corte).toBe('dinero');
    expect(r.motivo).toContain('TOPE DE CORRIDA alcanzado');
    expect(r.motivo).toContain(`$${(TOPE_CORRIDA_USD + 0.5).toFixed(4)} USD medidos`);
    expect(r.motivo).toContain(`tope de $${TOPE_CORRIDA_USD.toFixed(2)}`);
    expect(r.motivo).toContain('1 de 10 fotos procesadas y 9 sin procesar');
    expect(r.motivo).toContain('no una estimación');

    const leida = await leerCorrida(dbFalsa(), corrida.id);
    expect(leida.ok).toBe(true);
    if (!leida.ok || !leida.datos) return;
    expect(leida.datos.estado).toBe('abortada');
    expect(leida.datos.corte).toBe('dinero');
    // Un aborto por tope es EVIDENCIA: el tenant se queda para inspección.
    expect(leida.datos.limpieza).toContain('CONSERVADO para inspección');
    expect((tablas.tenant ?? [])).toHaveLength(1);
    // Y no siguió gastando: una foto, un envío.
    expect(fotosEnviadas()).toHaveLength(1);

    // Una pasada más NO revive la corrida abortada.
    const otra = await ejecutarPasada(corrida.id, Date.now() + 600_000);
    expect(otra.corrio).toBe(false);
    expect(fotosEnviadas()).toHaveLength(1);
  });

  test('el tope del DÍA se vuelve a preguntar en cada pasada, no sólo al lanzar', async () => {
    const { corrida } = await nacer(5);
    // Otra corrida del mismo día ya se comió el presupuesto.
    (tablas.qa_corrida ??= []).push({
      id: 'otra-corrida', escenario: 'feliz', carril: 'rapido', parametros: { fotoIds: [] },
      estado: 'ok', tenant_nombre: 'ZZZ QA otra', creada_en: new Date().toISOString(),
      latido_en: new Date().toISOString(), costo_usd_total: 99, turnos: [], pdfs: [],
    });

    const r = await ejecutarPasada(corrida.id, Date.now() + 600_000);
    expect(r.corte).toBe('dinero');
    expect(r.motivo).toContain('TOPE DIARIO DEL PANEL alcanzado');
    expect(fotosEnviadas()).toHaveLength(0);   // ni una foto se mandó
  });
});

describe('la memoria de la corrida', () => {
  test('mezclarEventos no repite y respeta el tope', () => {
    expect(mezclarEventos(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(mezclarEventos(undefined, ['x'])).toEqual(['x']);
    const muchos = Array.from({ length: 900 }, (_, i) => `e${i}`);
    expect(mezclarEventos([], muchos)).toHaveLength(500);
  });

  test('la siembra se recuerda: la pasada 2 NO siembra otro tenant', async () => {
    const { corrida } = await nacer(30);
    await ejecutarPasada(corrida.id, Date.now() + 200_000);
    const tenantsTras1 = (tablas.tenant ?? []).length;
    await ejecutarPasada(corrida.id, Date.now() + 200_000);
    expect((tablas.tenant ?? []).length).toBe(tenantsTras1);
    expect(tenantsTras1).toBe(1);
    // Y el chofer sigue siendo el mismo — todas las fotos entran por un viaje.
    expect(new Set(enviados.map((e) => e.from)).size).toBe(1);
  });
});
