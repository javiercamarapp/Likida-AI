import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { altaVoluntarioDelPanel, bajaVoluntarioDelPanel, errorTopeVoluntarios, telefonoDePilotoValido } = await import('./acciones_voluntarios');
type Deps = import('./acciones_voluntarios').DepsVoluntarios;

const OP = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ctx = (rol = 'flota_admin', tenantId = 't1') => ({ tenantId, rol, usuarioId: 'u1', email: 'dueno@flota.test' });
const fd = (operadorId: string) => ({ get: (k: string) => (k === 'operadorId' ? operadorId : null) });

interface OpFalso { id: string; tenant: string; nombre: string; telefono: string; activo: boolean; voluntario: boolean }
interface ViajeFalso { id: string; operadorId: string; abierto: boolean; aceptadoOrigen: 'importacion' | 'chofer' | null; aceptadoEn: string | null }

/** Un mundo en memoria con el mismo contrato que `repo.ts`/0800: todo acotado por flota, `retirar` revierte solo lo importado y abierto. */
function mundo(ops: OpFalso[], viajes: ViajeFalso[] = [], tope = 6) {
  const bitacora = vi.fn(async () => true);
  const deps: Deps = {
    operador: async (t, id) => {
      const o = ops.find((x) => x.id === id && x.tenant === t);
      return o ? { id: o.id, nombre: o.nombre, telefono: o.telefono, activo: o.activo, voluntario: o.voluntario, voluntarioDesde: null } : null;
    },
    contar: async (t) => ops.filter((o) => o.tenant === t && o.voluntario).length,
    tope: async () => tope,
    marcar: async (t, id) => {
      const o = ops.find((x) => x.id === id && x.tenant === t && x.activo && !x.voluntario);
      if (!o) return false;
      o.voluntario = true;
      return true;
    },
    retirar: async (t, id) => {
      const o = ops.find((x) => x.id === id && x.tenant === t);
      if (o) o.voluntario = false;
      let n = 0;
      for (const v of viajes) if (v.operadorId === id && v.abierto && v.aceptadoOrigen === 'importacion') { v.aceptadoOrigen = null; v.aceptadoEn = null; n++; }
      return o ? n : 0;
    },
    bitacora: bitacora as unknown as Deps['bitacora'],
  };
  return { deps, bitacora, ops, viajes };
}
const op = (n: number, extra: Partial<OpFalso> = {}): OpFalso => ({ id: OP(n), tenant: 't1', nombre: `Operador ${n}`, telefono: `33${String(10000000 + n)}`, activo: true, voluntario: false, ...extra });

describe('alta de voluntarios del piloto', () => {
  it('agregar 6 → ok; el 7.º → el error exacto, y no queda marcado', async () => {
    const m = mundo([1, 2, 3, 4, 5, 6, 7].map((n) => op(n)));
    for (let n = 1; n <= 6; n++) {
      const r = await altaVoluntarioDelPanel(ctx(), fd(OP(n)), m.deps);
      expect(r, `operador ${n}`).toEqual({ ok: true, mensaje: `Operador agregado al piloto (${n} de 6).` });
    }
    const r7 = await altaVoluntarioDelPanel(ctx(), fd(OP(7)), m.deps);
    expect(r7).toEqual({ ok: false, error: 'Ya hay 6 operadores en el piloto. Retira uno antes de agregar otro.' });
    expect(m.ops.find((o) => o.id === OP(7))!.voluntario).toBe(false);
    expect(m.ops.filter((o) => o.voluntario)).toHaveLength(6);
  });

  it('el tope sale de la configuración de la flota (no está clavado en 6)', async () => {
    const m = mundo([1, 2, 3].map((n) => op(n)), [], 2);
    await altaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps);
    await altaVoluntarioDelPanel(ctx(), fd(OP(2)), m.deps);
    expect(await altaVoluntarioDelPanel(ctx(), fd(OP(3)), m.deps)).toEqual({ ok: false, error: errorTopeVoluntarios(2) });
    expect(errorTopeVoluntarios(2)).toBe('Ya hay 2 operadores en el piloto. Retira uno antes de agregar otro.');
  });

  it('carrera: si otra alta llenó el cupo entre la lectura y la marca, esta se deshace', async () => {
    const m = mundo([op(1), op(2)], [], 1);
    const marcarReal = m.deps.marcar;
    // Entre el primer conteo y la marca, otro proceso mete al operador 2.
    m.deps.marcar = async (t, id, por, cuando) => { m.ops[1].voluntario = true; return marcarReal(t, id, por, cuando); };
    const r = await altaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps);
    expect(r).toEqual({ ok: false, error: errorTopeVoluntarios(1) });
    expect(m.ops[0].voluntario).toBe(false);
    expect(m.bitacora).not.toHaveBeenCalled();
  });

  it('un operador de OTRA flota se rechaza como «no existe» y no se marca', async () => {
    const m = mundo([op(1, { tenant: 't2' })]);
    expect(await altaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps)).toEqual({ ok: false, error: 'Ese operador no existe en tu flota.' });
    expect(m.ops[0].voluntario).toBe(false);
    expect(m.bitacora).not.toHaveBeenCalled();
  });

  it('sin permiso (jefe de tráfico, contador, rol desconocido, vacío): rechazado y sin tocar nada', async () => {
    for (const rol of ['encargado', 'contador', 'operador', 'inventado', '']) {
      const m = mundo([op(1)]);
      const leer = vi.spyOn(m.deps, 'operador');
      expect(await altaVoluntarioDelPanel(ctx(rol), fd(OP(1)), m.deps), rol).toEqual({ ok: false, error: 'Solo el dueño de la flota cambia quién está en el piloto.' });
      expect(await bajaVoluntarioDelPanel(ctx(rol), fd(OP(1)), m.deps), rol).toMatchObject({ ok: false });
      expect(leer).not.toHaveBeenCalled();
      expect(m.ops[0].voluntario).toBe(false);
    }
  });

  it('rechaza la marca de demo 28999 (con cualquier formato), el teléfono inválido y al operador dado de baja', async () => {
    const m = mundo([
      op(1, { telefono: '289991234567' }), op(2, { telefono: '+28999 123 4567' }), op(3, { telefono: '123' }), op(4, { activo: false }),
    ]);
    expect(await altaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps)).toMatchObject({ ok: false, error: expect.stringContaining('28999') });
    expect(await altaVoluntarioDelPanel(ctx(), fd(OP(2)), m.deps)).toMatchObject({ ok: false, error: expect.stringContaining('28999') });
    expect(await altaVoluntarioDelPanel(ctx(), fd(OP(3)), m.deps)).toMatchObject({ ok: false, error: expect.stringContaining('teléfono de WhatsApp válido') });
    expect(await altaVoluntarioDelPanel(ctx(), fd(OP(4)), m.deps)).toMatchObject({ ok: false, error: expect.stringContaining('dado de baja') });
    expect(m.ops.some((o) => o.voluntario)).toBe(false);
  });

  it('un id que no es uuid o falta: pide elegir uno, sin consultar', async () => {
    const m = mundo([op(1)]);
    const leer = vi.spyOn(m.deps, 'operador');
    for (const malo of ['', 'abc', "x' or 1=1 --"]) {
      expect(await altaVoluntarioDelPanel(ctx(), fd(malo), m.deps)).toEqual({ ok: false, error: 'Elige un operador de la lista.' });
    }
    expect(leer).not.toHaveBeenCalled();
  });

  it('idempotente: volver a agregar a un voluntario no duplica ni gasta cupo', async () => {
    const m = mundo([op(1)]);
    await altaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps);
    expect(await altaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps)).toEqual({ ok: true, mensaje: 'Ese operador ya estaba en el piloto.' });
    expect(m.bitacora).toHaveBeenCalledTimes(1);
  });

  it('la bitácora dice quién y a qué operador (su id), con conteos; nunca nombres ni teléfonos', async () => {
    const m = mundo([op(1, { nombre: 'Persona Sintetica', telefono: '3310000001' })]); // grep-limpio:ok
    await altaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps);
    const [entrada] = m.bitacora.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entrada).toMatchObject({
      tenantId: 't1', actor: { id: 'u1', email: 'dueno@flota.test' }, accion: 'conductor.voluntario_alta', entidad: 'operador', entidadId: OP(1), detalle: { voluntarios: 1, tope: 6 },
    });
    const texto = JSON.stringify(entrada);
    expect(texto).not.toContain('Persona Sintetica');
    expect(texto).not.toContain('3310000001'); // grep-limpio:ok
  });

  it('si la base falla, lo dice en palabras y no finge el alta', async () => {
    const m = mundo([op(1)]);
    m.deps.marcar = async () => { throw new Error('boom'); };
    expect(await altaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps)).toEqual({ ok: false, error: 'No pude guardarlo ahorita. Intenta de nuevo en un momento.' });
    expect(m.bitacora).not.toHaveBeenCalled();
  });
});

describe('baja de voluntarios del piloto', () => {
  const viaje = (id: string, operadorId: string, extra: Partial<ViajeFalso> = {}): ViajeFalso => ({ id, operadorId, abierto: true, aceptadoOrigen: 'importacion', aceptadoEn: '2026-10-14T10:00:00Z', ...extra });

  it('con 1 viaje importado abierto: el viaje vuelve a «sin aceptar» y el mensaje lo dice', async () => {
    const m = mundo([op(1, { voluntario: true })], [viaje('v1', OP(1))]);
    const r = await bajaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps);
    expect(r).toEqual({ ok: true, mensaje: 'Operador retirado del piloto. 1 viaje dejó de seguirse.' });
    expect(m.viajes[0]).toMatchObject({ aceptadoEn: null, aceptadoOrigen: null });
    expect(m.ops[0].voluntario).toBe(false);
  });

  it('solo se desanclan los importados y abiertos: lo que aceptó el chofer o ya cerró se conserva', async () => {
    const m = mundo([op(1, { voluntario: true })], [viaje('v1', OP(1)), viaje('v2', OP(1)), viaje('v3', OP(1), { aceptadoOrigen: 'chofer' }), viaje('v4', OP(1), { abierto: false })]);
    const r = await bajaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps);
    expect(r).toEqual({ ok: true, mensaje: 'Operador retirado del piloto. 2 viajes dejaron de seguirse.' });
    expect(m.viajes.map((v) => v.aceptadoOrigen)).toEqual([null, null, 'chofer', 'importacion']);
  });

  it('sin viajes importados abiertos: lo dice en palabras', async () => {
    const m = mundo([op(1, { voluntario: true })]);
    expect(await bajaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps)).toEqual({ ok: true, mensaje: 'Operador retirado del piloto. Ningún viaje dejó de seguirse.' });
  });

  it('operador de OTRA flota: rechazado, y sus viajes no se tocan', async () => {
    const m = mundo([op(1, { tenant: 't2', voluntario: true })], [viaje('v1', OP(1))]);
    expect(await bajaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps)).toEqual({ ok: false, error: 'Ese operador no existe en tu flota.' });
    expect(m.ops[0].voluntario).toBe(true);
    expect(m.viajes[0].aceptadoOrigen).toBe('importacion');
  });

  it('quien no era voluntario: no hace nada (y no llama a retirar)', async () => {
    const m = mundo([op(1)]);
    const retirar = vi.spyOn(m.deps, 'retirar');
    expect(await bajaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps)).toEqual({ ok: true, mensaje: 'Ese operador ya no estaba en el piloto.' });
    expect(retirar).not.toHaveBeenCalled();
  });

  it('deja bitácora con quién y cuántos viajes dejaron de seguirse', async () => {
    const m = mundo([op(1, { voluntario: true })], [viaje('v1', OP(1))]);
    await bajaVoluntarioDelPanel(ctx(), fd(OP(1)), m.deps);
    const [entrada] = m.bitacora.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entrada).toMatchObject({ accion: 'conductor.voluntario_baja', entidad: 'operador', entidadId: OP(1), actor: { id: 'u1' }, detalle: { viajesDejadosDeSeguir: 1 } });
  });
});

describe('telefonoDePilotoValido', () => {
  it('10 dígitos mexicanos, con o sin 52/521; nada más', () => {
    for (const t of ['3312345678', '523312345678', '5213312345678', '+52 33 1234 5678']) expect(telefonoDePilotoValido(t), t).toBe(true); // grep-limpio:ok
    for (const t of ['', '123', '33123456789', 'abc', '5233123']) expect(telefonoDePilotoValido(t), t).toBe(false);
  });
});
