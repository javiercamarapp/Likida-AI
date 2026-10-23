import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

// ═══════════════════════════════════════════════════════════════════════════
// EL SDR (0217) — el contrato es la CADENCIA que se detiene sola:
//  · una respuesta del prospecto lo saca (el humano toma la conversación);
//  · un rebote o una queja lo sacan (no se insiste a un buzón quemado);
//  · +3/+7 días desde la PRIMERA salida, y dos seguimientos son el final;
//  · el historial ilegible NO decide a ciegas: LANZA.
// ═══════════════════════════════════════════════════════════════════════════

// A37-S28-02: la búsqueda pagina y lee en LOTE (`.in`), así que ya no sirve una cola de respuestas fijas por
// tabla: se usa una base en memoria que FILTRA y ORDENA de verdad (db_falsa.fixture.ts).
import { crearDbFalsa, type Tablas } from './db_falsa.fixture';
const TABLAS: Tablas = {};
const consultas: string[] = [];
let leerFalla: { tabla: string; mensaje: string } | null = null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const db = crearDbFalsa(TABLAS, consultas);
    return {
      from: (t: string) => {
        const q = db.from(t) as { then: (...a: unknown[]) => unknown };
        if (leerFalla && leerFalla.tabla === t) {
          const msg = leerFalla.mensaje;
          q.then = (res: (x: unknown) => unknown) => Promise.resolve({ data: null, error: { message: msg } }).then(res);
        }
        return q;
      },
    };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const generar = vi.fn();
vi.mock('@/lib/llm/openrouter', () => ({ generateResponse: (...a: unknown[]) => generar(...(a as [])) }));
const encolar = vi.fn(async () => 'pieza-1');
vi.mock('./cola', () => ({
  encolarPieza: (...a: unknown[]) => encolar(...(a as [])),
  // El verificador real vive en cola.ts (c5-14); aquí su réplica mínima.
  verificarFormatoCampana: (t: string) => {
    if (/clientes?\s+reales/i.test(t)) throw new Error('clientes reales');
    if (t.includes('—')) throw new Error('guion largo');
  },
}));
vi.mock('./corridas', () => ({ registrarCorrida: vi.fn() }));
vi.mock('../interruptores', () => ({ estaApagado: async () => false }));

const { candidatosDeSeguimiento, correrSdr } = await import('./sdr');

const PROSPECTO = { id: 'pr-1', empresa: 'Transportes X', contacto_nombre: null };
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

/** Siembra la base en memoria: prospectos `contactado` con su historial. */
function sembrar(o: {
  prospectos: Array<{ id: string; empresa?: string; contacto_nombre?: string | null }>;
  contactos?: Array<{ prospecto_id: string; direccion: 'salida' | 'respuesta'; ocurrio_en: string }>;
  rebotadas?: string[];
}) {
  TABLAS.prospecto = o.prospectos.map((p, i) => ({
    empresa: 'Transportes X', contacto_nombre: null, estado: 'contactado', duplicado_de: null,
    updated_at: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`, ...p,
  }));
  TABLAS.prospecto_contacto = (o.contactos ?? []).map((c, i) => ({ id: `c${i}`, ...c }));
  TABLAS.cola_aprobacion = (o.rebotadas ?? []).map((id, i) => ({ id: `m${i}`, prospecto_id: id, entrega_estado: 'rebotado' }));
}

beforeEach(() => {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  consultas.length = 0;
  leerFalla = null;
});

describe('candidatosDeSeguimiento', () => {
  it('una salida hace 4 días sin respuesta: toca el seguimiento 1', async () => {
    sembrar({ prospectos: [PROSPECTO], contactos: [{ prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(4) }] });
    const r = await candidatosDeSeguimiento(5);
    expect(r).toHaveLength(1);
    expect(r[0].numeroSeguimiento).toBe(1);
  });

  it('con RESPUESTA del prospecto: fuera — el humano toma la conversación', async () => {
    sembrar({
      prospectos: [PROSPECTO],
      contactos: [
        { prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(5) },
        { prospecto_id: 'pr-1', direccion: 'respuesta', ocurrio_en: hace(3) },
      ],
    });
    expect(await candidatosDeSeguimiento(5)).toHaveLength(0);
  });

  it('con REBOTE o QUEJA de cualquier pieza: fuera — no se insiste a un buzón quemado', async () => {
    sembrar({ prospectos: [PROSPECTO], contactos: [{ prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(5) }], rebotadas: ['pr-1'] });
    expect(await candidatosDeSeguimiento(5)).toHaveLength(0);
  });

  it('la salida es de hace 2 días: aún no toca (+3)', async () => {
    sembrar({ prospectos: [PROSPECTO], contactos: [{ prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(2) }] });
    expect(await candidatosDeSeguimiento(5)).toHaveLength(0);
  });

  it('dos salidas hace 8 días: toca el seguimiento 2 (+7); TRES salidas: la cadencia terminó', async () => {
    sembrar({
      prospectos: [PROSPECTO, { ...PROSPECTO, id: 'pr-2' }],
      contactos: [
        { prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(8) }, { prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(4) },
        { prospecto_id: 'pr-2', direccion: 'salida', ocurrio_en: hace(20) }, { prospecto_id: 'pr-2', direccion: 'salida', ocurrio_en: hace(15) },
        { prospecto_id: 'pr-2', direccion: 'salida', ocurrio_en: hace(10) },
      ],
    });
    const r = await candidatosDeSeguimiento(5);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'pr-1', numeroSeguimiento: 2 });
  });

  it('historial ilegible: LANZA — la cadencia no se decide a ciegas', async () => {
    sembrar({ prospectos: [PROSPECTO] });
    leerFalla = { tabla: 'prospecto_contacto', mensaje: 'db down' };
    await expect(candidatosDeSeguimiento(5)).rejects.toThrow(/historial/);
  });

  it('una lectura de historial que llega al tope pudo truncarse: LANZA, no decide', async () => {
    sembrar({
      prospectos: [PROSPECTO],
      contactos: Array.from({ length: 1_000 }, () => ({ prospecto_id: 'pr-1', direccion: 'salida' as const, ocurrio_en: hace(4) })),
    });
    await expect(candidatosDeSeguimiento(5)).rejects.toThrow(/truncarse/);
  });
});

describe('c5-14 — el formato se verifica sobre el TEXTO FINAL, asunto incluido', () => {
  const candidato = () => sembrar({ prospectos: [PROSPECTO], contactos: [{ prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(4) }] });

  it('un guion largo en el ASUNTO descarta la pieza — antes salía igual', async () => {
    candidato();
    generar.mockResolvedValue({ text: '**Asunto:** Seguimiento — liquidación\nLe escribí hace unos días. ¿Le vienen bien 15 minutos?', cost: 0.001 });
    const r = await correrSdr('cron', 5);
    expect(r.piezas).toBe(0);
    expect(r.saltados).toBe(1);
    expect(encolar).not.toHaveBeenCalled();
  });

  it('el asunto y cuerpo limpios sí encolan', async () => {
    candidato();
    generar.mockResolvedValue({ text: '**Asunto:** Sobre la liquidacion de viajes\nLe escribí hace unos días sobre la liquidación. ¿Le vienen bien 15 minutos esta semana?', cost: 0.001 });
    const r = await correrSdr('cron', 5);
    expect(r.piezas).toBe(1);
    expect(encolar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'correo_seguimiento' }));
  });
});

describe('AGB-9 (auditoría 24) — 0 medido ≠ costo desconocido', () => {
  const candidato = () => sembrar({ prospectos: [PROSPECTO], contactos: [{ prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(4) }] });

  it('con `usage` medido y cost real (incluido 0), costoUsd es el número — nunca null', async () => {
    candidato();
    generar.mockResolvedValue({ text: '**Asunto:** Seguimiento\nLe escribí hace unos días. ¿Le vienen bien 15 minutos?', cost: 0 });
    const r = await correrSdr('cron', 5);
    expect(r.piezas).toBe(1);
    expect(r.costoUsd).toBe(0);
  });

  it('con `noMedido: true` (el proveedor omitió usage), costoUsd sale NULL — no el 0/la reserva disfrazados de cifra', async () => {
    candidato();
    generar.mockResolvedValue({ text: '**Asunto:** Seguimiento\nLe escribí hace unos días. ¿Le vienen bien 15 minutos?', cost: 0.002, noMedido: true });
    const r = await correrSdr('cron', 5);
    expect(r.piezas).toBe(1);
    expect(r.costoUsd).toBeNull();
  });

  it('null es PEGAJOSO: una sola llamada sin medir vuelve incierta la corrida entera, aunque las demás sí midieron', async () => {
    sembrar({
      prospectos: [{ ...PROSPECTO, id: 'pr-1' }, { ...PROSPECTO, id: 'pr-2' }],
      contactos: [
        { prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(4) },
        { prospecto_id: 'pr-2', direccion: 'salida', ocurrio_en: hace(4) },
      ],
    });
    generar
      .mockResolvedValueOnce({ text: '**Asunto:** Seguimiento\nLe escribí hace unos días. ¿Le vienen bien 15 minutos?', cost: 0.001 })
      .mockResolvedValueOnce({ text: '**Asunto:** Seguimiento\nLe escribí hace unos días. ¿Le vienen bien 15 minutos?', cost: 0.003, noMedido: true });
    const r = await correrSdr('cron', 5);
    expect(r.piezas).toBe(2);
    expect(r.costoUsd).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL RELOJ TAMBIÉN EN LA BÚSQUEDA (auditoría ciclo 7, c7-1).
//
// El `for` de `correrSdr` ya preguntaba la hora al FABRICAR (#152), pero la
// BÚSQUEDA que lo alimenta no la preguntaba nunca — y cuesta: la sobre-lectura
// es ×5 (25 filas para 5 candidatos) y cada fila son DOS idas a la base (el
// historial de contactos y la revisión de rebote/queja). Con la cola llena de
// prospectos que ya contestaron o ya rebotaron, esas 50 consultas se gastan
// enteras ANTES de que el reloj del lote llegue a preguntar por primera vez.
// Es el mismo hueco que la #158 cerró en `candidatoFicha` de `leads.ts`.
// ═══════════════════════════════════════════════════════════════════════════

describe('el reloj de la vuelta corta también la BÚSQUEDA del SDR (c7-1)', () => {
  const RELOJ_VENCIDO = () => Date.now() - 1;

  it('la búsqueda con el reloj vencido no gasta ni una consulta de historial', async () => {
    sembrar({
      prospectos: [PROSPECTO, { ...PROSPECTO, id: 'pr-2' }],
      contactos: [{ prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(4) }],
    });

    const r = await candidatosDeSeguimiento(5, RELOJ_VENCIDO());

    expect(r).toEqual([]);
    // CORTA de verdad: ni la página de prospectos ni el historial se leyeron.
    expect(consultas).toEqual([]);
  });

  it('un corte en la BÚSQUEDA no puede ser mudo: la corrida lo reporta como sinTurno, no como «no había a quién»', async () => {
    // El `beforeEach` de este archivo solo limpia `respuestas`; el contador del
    // modelo se arrastra de las pruebas de arriba y aquí se afirma sobre él.
    generar.mockClear();
    sembrar({ prospectos: [PROSPECTO], contactos: [{ prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(4) }] });

    const r = await correrSdr('cron', 5, RELOJ_VENCIDO());

    // La búsqueda devolvió CERO candidatos porque el reloj la cortó, no porque
    // no hubiera a quién. Sin el piso de 1, `sinTurno` sería 0 y el resultado
    // —`piezas: 0, sinTurno: 0`— sería indistinguible del estado sano: el
    // runner no metería al SDR en `saltadosPorReloj` y el latido diría 'ok'.
    // Ése es exactamente el 28-ago-2026: 32 corridas en 'ok' y ni un latido.
    expect(r.candidatos).toBe(0);
    expect(r.piezas).toBe(0);
    expect(r.sinTurno).toBeGreaterThanOrEqual(1);
    expect(generar).not.toHaveBeenCalled();
  });

  it('sin reloj la búsqueda corre entera — el parámetro es opcional a propósito', async () => {
    sembrar({ prospectos: [PROSPECTO], contactos: [{ prospecto_id: 'pr-1', direccion: 'salida', ocurrio_en: hace(4) }] });
    const r = await candidatosDeSeguimiento(5);
    expect(r).toHaveLength(1);
  });
});

describe('AGB-2 — el SYSTEM del SDR no nombra a ningún prospecto', () => {
  it('no contiene el nombre de un prospecto ni "Grupo GAL"', () => {
    const fuente = readFileSync('src/lib/likida/agentes/sdr.ts', 'utf8');
    expect(fuente).not.toContain('Innova' + 'tivos');
    expect(fuente).not.toContain('Grupo GAL');
  });
});
