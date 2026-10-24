import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbMemoria, type DbMemoria, type Fila } from '../e2e/db_memoria.fixture';

// A37-S48-03: un «fin jornada» de hoy NO cierra la jornada abierta de ayer si hoy ya tiene su inicio vivo, y la conformidad no se sella
// sobre un expediente sin fin. Datos sintéticos.
let db: DbMemoria;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { atenderMarcaJornada, atenderConformidadJornada } = await import('./wa');
const { jornadaQueCierra } = await import('./repo');

const T = 'tenant-1';
const OP = 'op-1';
const AYER = '2026-10-01';
const HOY = '2026-10-02';
const ahora = (hhmm: string) => new Date(`${HOY}T${hhmm}:00-06:00`);
const asiento = (jornada: string, tipo: string, momento: string): Fila => ({ id: `a-${jornada}-${tipo}`, tenant_id: T, jornada_id: jornada, tipo, momento, anulado_en: null });

function base(opts: { hoyConInicio: boolean; ayerConFin?: boolean }) {
  const dias: Fila[] = [{ id: 'j-ayer', tenant_id: T, operador_id: OP, dia: AYER, estado: 'abierto', conforme_operador_en: null }];
  const asientos: Fila[] = [asiento('j-ayer', 'inicio_jornada', `${AYER}T18:00:00-06:00`)];
  if (opts.ayerConFin) asientos.push(asiento('j-ayer', 'fin_jornada', `${AYER}T23:00:00-06:00`));
  if (opts.hoyConInicio) {
    dias.push({ id: 'j-hoy', tenant_id: T, operador_id: OP, dia: HOY, estado: 'abierto', conforme_operador_en: null });
    asientos.push(asiento('j-hoy', 'inicio_jornada', `${HOY}T06:00:00-06:00`));
  }
  db = crearDbMemoria({ jornada_dia: dias, jornada_asiento: asientos }, {
    asentar_declaracion_jornada: (a) => {
      db.tablas.jornada_asiento.push({ id: `n-${a.p_jornada_id}-${a.p_tipo}`, tenant_id: a.p_tenant_id, jornada_id: a.p_jornada_id, tipo: a.p_tipo, momento: a.p_momento, anulado_en: null });
      return ['asentado'] as never;
    },
  });
}

beforeEach(() => { base({ hoyConInicio: false }); });

describe('jornadaQueCierra: no atribuye al día anterior si hoy ya tiene inicio vivo', () => {
  it('ayer abierta (20 h) y hoy SIN inicio: sí cierra la de ayer (comportamiento de siempre)', async () => {
    base({ hoyConInicio: false });
    const r = await jornadaQueCierra(T, OP, HOY, ahora('14:00'));
    expect(r.jornada).toEqual({ id: 'j-ayer', dia: AYER });
  });

  it('ayer abierta y hoy YA tiene su inicio: el fin de hoy es de hoy', async () => {
    base({ hoyConInicio: true });
    const r = await jornadaQueCierra(T, OP, HOY, ahora('14:00'));
    expect(r).toEqual({ jornada: null, error: null });
  });
});

describe('atenderMarcaJornada: fin de hoy con inicio de hoy', () => {
  it('el fin se asienta en el expediente de HOY, no en el de ayer', async () => {
    base({ hoyConInicio: true });
    const r = await atenderMarcaJornada({ tenantId: T, operadorId: OP, tipo: 'fin_jornada', momento: ahora('14:00'), texto: 'fin jornada', waMessageId: 'wamid.1' });
    expect(r.resultado).toBe('asentado');
    expect(r.dia).toBe(HOY);
    const fines = db.tablas.jornada_asiento.filter((a) => a.tipo === 'fin_jornada');
    expect(fines).toHaveLength(1);
    expect(fines[0].jornada_id).not.toBe('j-ayer');   // (el doble en memoria no tiene el índice único y crea otro id para el día de hoy: lo que importa es que NO es el de ayer)
    expect(db.tablas.jornada_dia.find((d) => d.id === fines[0].jornada_id)?.dia).toBe(HOY);
  });
});

describe('atenderConformidadJornada: no se sella sobre un expediente sin fin', () => {
  it('hoy con inicio y SIN fin: no sella nada y pide cerrar la jornada primero', async () => {
    base({ hoyConInicio: true });
    const r = await atenderConformidadJornada({ tenantId: T, operadorId: OP, momento: ahora('14:05'), waMessageId: 'wamid.2' });
    expect(r.resultado).toBe('sin_cierre');
    expect(r.respuesta).toMatch(/fin jornada/i);
    expect(db.tablas.jornada_dia.every((d) => d.conforme_operador_en === null)).toBe(true);
  });

  it('con el fin de hoy ya asentado sí sella la de hoy, nunca la de ayer', async () => {
    base({ hoyConInicio: true });
    db.tablas.jornada_asiento.push(asiento('j-hoy', 'fin_jornada', `${HOY}T14:00:00-06:00`));
    const r = await atenderConformidadJornada({ tenantId: T, operadorId: OP, momento: ahora('14:05'), waMessageId: 'wamid.3' });
    expect(r.resultado).toBe('sellada');
    expect(db.tablas.jornada_dia.find((d) => d.id === 'j-hoy')!.conforme_operador_en).not.toBeNull();
    expect(db.tablas.jornada_dia.find((d) => d.id === 'j-ayer')!.conforme_operador_en).toBeNull();
  });

  it('ayer abierta sin fin y hoy sin expediente: tampoco se sella la de ayer', async () => {
    base({ hoyConInicio: false });
    const r = await atenderConformidadJornada({ tenantId: T, operadorId: OP, momento: ahora('14:05'), waMessageId: 'wamid.4' });
    expect(r.resultado).toBe('sin_cierre');
    expect(db.tablas.jornada_dia.every((d) => d.conforme_operador_en === null)).toBe(true);
  });
});
