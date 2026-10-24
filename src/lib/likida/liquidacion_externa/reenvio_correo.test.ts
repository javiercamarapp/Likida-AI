import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { reenviarDesglose, MAX_REENVIOS_POR_DIA, type DependenciasReenvio, type OpcionesReenvio } from './reenvio_correo';
import { CONFIG_CORREO_POR_DEFECTO, type EntregaCorreo, type NuevaEntrega } from './repo_correo';
import type { LiquidacionExterna } from './repo';

// Datos 100 % sintéticos. 2026-10-14 18:30 UTC = 12:30 en México.
const TENANT = '11111111-1111-4111-8111-111111111111';
const LIQ = '22222222-2222-4222-8222-222222222222';
const OPERADOR = '33333333-3333-4333-8333-333333333333';
const AHORA = new Date('2026-10-14T18:30:00.000Z');
const ACTOR = { userId: 'user-1', rol: 'flota_admin' };

function entrega(extra: Partial<EntregaCorreo> = {}): EntregaCorreo {
  return {
    id: 'e-1', tenantId: TENANT, liquidacionExternaId: LIQ, generacion: 1, rol: 'operador', correo: 'ana.prueba@ejemplo.test',
    estado: 'enviada', intentos: 1, proximoIntentoEn: '2026-10-14T08:00:00.000Z', claimToken: null, claimExpiraEn: null,
    resendId: 're_1', ultimoError: null, disparo: 'auto', xlsxRuta: `${TENANT}/x.xlsx`, xlsxSha256: 'abc',
    enviadaEn: '2026-10-14T08:00:00.000Z', entregadaEn: null, rebotadaEn: null, creadaEn: '2026-10-13T08:00:00.000Z', ...extra,
  };
}

interface Estado {
  entregas: EntregaCorreo[] | null;
  insertadas: NuevaEntrega[];
  correosGuardados: string[];
  eventos: Array<{ tipo: string; detalle?: Record<string, unknown> }>;
  orden: string[];
}

function montar(sobre: {
  entregas?: EntregaCorreo[] | null;
  contacto?: { correo: string | null; correoRebotadoEn: string | null; coordinadorId: string | null } | null;
  liquidacion?: boolean;
  /** A37-A1-liquidaciones-08: encabezado del desglose (`null` = no se pudo leer; `{retenidaMotivo}` = lo que dice la base). */
  desglose?: { existe: boolean; retenidaMotivo: string | null } | null;
} = {}) {
  const e: Estado = { entregas: sobre.entregas === undefined ? [entrega()] : sobre.entregas, insertadas: [], correosGuardados: [], eventos: [], orden: [] };
  const contacto = sobre.contacto === undefined ? { correo: 'ana.prueba@ejemplo.test', correoRebotadoEn: null, coordinadorId: 'c-1' } : sobre.contacto;
  const deps: DependenciasReenvio = {
    ahora: () => AHORA,
    leerLiquidacion: async () => (sobre.liquidacion === false ? null : ({ id: LIQ, tenantId: TENANT, operadorId: OPERADOR } as unknown as LiquidacionExterna)),
    leerConfig: async () => ({ ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true, rhCorreos: ['rh.prueba@ejemplo.test'] }),
    leerContacto: async () => (contacto ? { operadorId: OPERADOR, ...contacto } : null),
    leerCoordinador: async () => ({ id: 'c-1', nombre: 'Coord Prueba', correo: 'coord.prueba@ejemplo.test', activo: true }),
    entregas: async () => e.entregas,
    guardarCorreoOperador: async (_t, _o, correo) => { e.orden.push('guardar'); e.correosGuardados.push(correo); },
    insertarEntregas: async (_t, filas) => { e.orden.push('insertar'); e.insertadas.push(...filas); return filas.length; },
    registrarEvento: async (_t, _l, tipo, detalle) => { e.eventos.push({ tipo, detalle }); },
    leerDesglose: async () => (sobre.desglose === undefined ? { existe: true, retenidaMotivo: null } : sobre.desglose),
    rutaXlsx: (t, clave, huella) => `${t}/${clave}/${huella}.xlsx`,
  };
  return { e, deps };
}

const op = (extra: Partial<OpcionesReenvio> = {}): OpcionesReenvio => ({ a: 'operador', actor: ACTOR, motivo: 'reclamo', ...extra });

describe('reenviarDesglose', () => {
  it('reenvío a operador tras rebote con correo corregido ⇒ nueva fila generacion+1, correo guardado antes', async () => {
    const { e, deps } = montar({
      entregas: [entrega({ estado: 'rebotada', rebotadaEn: '2026-10-14T09:00:00.000Z' })],
      contacto: { correo: 'ana.prueba@ejemplo.test', correoRebotadoEn: '2026-10-14T09:00:00.000Z', coordinadorId: 'c-1' },
    });
    const r = await reenviarDesglose(TENANT, LIQ, op({ correoNuevo: '  Ana.Nueva@Ejemplo.test ', motivo: 'correccion_de_correo' }), deps);
    expect(r).toMatchObject({ estado: 'reenviado', generacion: 2, entregas: 1, roles: ['operador'] });
    expect(e.correosGuardados).toEqual(['ana.nueva@ejemplo.test']);
    expect(e.orden).toEqual(['guardar', 'insertar']);
    expect(e.insertadas).toEqual([expect.objectContaining({
      liquidacionExternaId: LIQ, generacion: 2, rol: 'operador', correo: 'ana.nueva@ejemplo.test',
      disparo: 'manual', pedidoPor: 'user-1', xlsxRuta: `${TENANT}/x.xlsx`, xlsxSha256: 'abc',
    })]);
  });

  it('motivo reclamo ⇒ disparo reclamo; el evento de auditoría lleva actor y motivo, sin correos completos', async () => {
    const { e, deps } = montar();
    await reenviarDesglose(TENANT, LIQ, op(), deps);
    expect(e.insertadas[0]?.disparo).toBe('reclamo');
    expect(e.eventos).toHaveLength(1);
    expect(e.eventos[0]).toMatchObject({ tipo: 'reintento_manual', detalle: { actor: 'user-1', motivo: 'reclamo', generacion: 2, a: 'operador' } });
    expect(JSON.stringify(e.eventos[0])).not.toContain('@');
  });

  it('reenviar mientras hay una entrega pendiente/enviando de ese rol ⇒ rechaza con motivo y no escribe', async () => {
    for (const estado of ['pendiente', 'enviando'] as const) {
      const { e, deps } = montar({ entregas: [entrega({ estado })] });
      const r = await reenviarDesglose(TENANT, LIQ, op(), deps);
      expect(r).toMatchObject({ estado: 'rechazado', motivo: 'en_curso' });
      expect(e.insertadas).toHaveLength(0);
      expect(e.eventos).toHaveLength(0);
    }
  });

  it('una entrega en curso de OTRO rol no bloquea el reenvío al operador', async () => {
    const { e, deps } = montar({ entregas: [entrega(), entrega({ id: 'e-2', rol: 'coordinador', correo: 'coord.prueba@ejemplo.test', estado: 'pendiente' })] });
    const r = await reenviarDesglose(TENANT, LIQ, op(), deps);
    expect(r.estado).toBe('reenviado');
    expect(e.insertadas).toHaveLength(1);
  });

  it('«todos» con una en curso ⇒ rechaza completo (no reenvía a medias)', async () => {
    const { e, deps } = montar({ entregas: [entrega(), entrega({ id: 'e-2', rol: 'coordinador', correo: 'coord.prueba@ejemplo.test', estado: 'enviando' })] });
    const r = await reenviarDesglose(TENANT, LIQ, op({ a: 'todos' }), deps);
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'en_curso' });
    expect(e.insertadas).toHaveLength(0);
  });

  it('correo inválido ⇒ error llano y no se escribe nada', async () => {
    const { e, deps } = montar();
    const r = await reenviarDesglose(TENANT, LIQ, op({ correoNuevo: 'ana@' }), deps);
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'correo_invalido' });
    expect(r.estado === 'rechazado' && r.mensaje).toMatch(/correo/);
    expect(e.correosGuardados).toHaveLength(0);
    expect(e.insertadas).toHaveLength(0);
  });

  it('correo nuevo con destino coordinador ⇒ rechaza (el correo nuevo es del operador)', async () => {
    const { e, deps } = montar();
    const r = await reenviarDesglose(TENANT, LIQ, op({ a: 'coordinador', correoNuevo: 'otro@ejemplo.test' }), deps);
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'correo_nuevo_no_aplica' });
    expect(e.correosGuardados).toHaveLength(0);
  });

  it('el 6.º reenvío del día ⇒ rechaza; los de ayer no cuentan', async () => {
    const hoy = (g: number) => entrega({ id: `h${g}`, generacion: g, disparo: 'manual', estado: 'entregada', creadaEn: '2026-10-14T15:00:00.000Z' });
    const ayer = entrega({ id: 'a', generacion: 1, disparo: 'manual', creadaEn: '2026-10-13T15:00:00.000Z' });
    const cinco = [2, 3, 4, 5, 6].map(hoy);
    const { e, deps } = montar({ entregas: [ayer, ...cinco] });
    const r = await reenviarDesglose(TENANT, LIQ, op(), deps);
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'limite_diario' });
    expect(MAX_REENVIOS_POR_DIA).toBe(5);
    expect(e.insertadas).toHaveLength(0);

    // Con 4 de hoy (más la de ayer) todavía se puede: el 5.º.
    const { e: e2, deps: d2 } = montar({ entregas: [ayer, ...cinco.slice(0, 4)] });
    const r2 = await reenviarDesglose(TENANT, LIQ, op(), d2);
    expect(r2).toMatchObject({ estado: 'reenviado', generacion: 6 });
    expect(e2.insertadas).toHaveLength(1);
  });

  it('una generación con varios roles cuenta como UN reenvío', async () => {
    const g = (rol: 'operador' | 'coordinador', id: string) => entrega({ id, rol, generacion: 2, disparo: 'manual', creadaEn: '2026-10-14T15:00:00.000Z' });
    const { deps } = montar({ entregas: [entrega(), g('operador', 'x'), g('coordinador', 'y')] });
    expect((await reenviarDesglose(TENANT, LIQ, op(), deps)).estado).toBe('reenviado');
  });

  it('solo administra la flota: otros roles se rechazan sin leer ni escribir', async () => {
    for (const rol of ['encargado', 'contador', 'operador', 'rol_raro']) {
      const { e, deps } = montar();
      const r = await reenviarDesglose(TENANT, LIQ, op({ actor: { userId: 'u', rol } }), deps);
      expect(r).toMatchObject({ estado: 'rechazado', motivo: 'sin_permiso' });
      expect(e.insertadas).toHaveLength(0);
      expect(e.eventos).toHaveLength(0);
    }
    const { deps } = montar();
    expect((await reenviarDesglose(TENANT, LIQ, op({ actor: { userId: 'u', rol: 'superadmin' } }), deps)).estado).toBe('reenviado');
  });

  it('operador con el correo rebotado y sin correo nuevo ⇒ rechaza pidiendo uno nuevo', async () => {
    const { e, deps } = montar({ contacto: { correo: 'ana.prueba@ejemplo.test', correoRebotadoEn: '2026-10-14T09:00:00.000Z', coordinadorId: null } });
    const r = await reenviarDesglose(TENANT, LIQ, op(), deps);
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'sin_destinatarios' });
    expect(r.estado === 'rechazado' && r.mensaje).toMatch(/rebot/);
    expect(e.insertadas).toHaveLength(0);
  });

  it('operador sin correo ⇒ rechaza; «todos» sí llega al coordinador, RH', async () => {
    const { deps } = montar({ contacto: { correo: null, correoRebotadoEn: null, coordinadorId: 'c-1' } });
    expect(await reenviarDesglose(TENANT, LIQ, op(), deps)).toMatchObject({ estado: 'rechazado', motivo: 'sin_destinatarios' });
    const m = montar({ contacto: { correo: null, correoRebotadoEn: null, coordinadorId: 'c-1' } });
    const r = await reenviarDesglose(TENANT, LIQ, op({ a: 'todos' }), m.deps);
    expect(r).toMatchObject({ estado: 'reenviado', roles: ['coordinador', 'rh'] });
  });

  it('a: rh ⇒ solo rh; a: todos ⇒ operador, coordinador y rh con la misma generación', async () => {
    const m = montar();
    const rh = await reenviarDesglose(TENANT, LIQ, op({ a: 'rh' }), m.deps);
    expect(rh).toMatchObject({ estado: 'reenviado', roles: ['rh'] });
    const t = montar();
    const todos = await reenviarDesglose(TENANT, LIQ, op({ a: 'todos' }), t.deps);
    expect(todos).toMatchObject({ estado: 'reenviado', generacion: 2, roles: ['operador', 'coordinador', 'rh'] });
    expect(new Set(t.e.insertadas.map((f) => f.generacion))).toEqual(new Set([2]));
  });

  it('desglose inexistente, entregas ilegibles o sin archivo ⇒ rechazo, nunca «no hay entregas»', async () => {
    expect(await reenviarDesglose(TENANT, LIQ, op(), montar({ liquidacion: false }).deps)).toMatchObject({ motivo: 'no_encontrada' });
    const ilegible = montar({ entregas: null });
    expect(await reenviarDesglose(TENANT, LIQ, op(), ilegible.deps)).toMatchObject({ motivo: 'no_disponible' });
    expect(ilegible.e.insertadas).toHaveLength(0);
    expect(await reenviarDesglose(TENANT, LIQ, op(), montar({ entregas: [entrega({ xlsxRuta: null })] }).deps)).toMatchObject({ motivo: 'sin_archivo' });
  });

  it('si la fila ya existía (doble clic) no se duplica y avisa', async () => {
    const m = montar();
    m.deps.insertarEntregas = async () => 0;
    const r = await reenviarDesglose(TENANT, LIQ, op(), m.deps);
    expect(r).toMatchObject({ estado: 'reenviado', entregas: 0 });
    expect(r.estado === 'reenviado' && r.avisos.length).toBe(1);
  });
});


describe('A37-A1-liquidaciones-08: reenviar cuando la recepción no creó ninguna entrega', () => {
  const sinEntregas = (extra: Parameters<typeof montar>[0] = {}) => montar({ entregas: [], ...extra });
  const conHuella = (deps: DependenciasReenvio): DependenciasReenvio => ({
    ...deps,
    leerLiquidacion: async () => ({ id: LIQ, tenantId: TENANT, operadorId: OPERADOR, claveExterna: 'BIT-T01-1228', huella: 'h'.repeat(64) } as unknown as LiquidacionExterna),
  });

  it('primer día sin RH ni correos: con RH ya configurado, usa el Excel ya guardado (ruta por clave+huella) y crea la generación 1', async () => {
    const { e, deps } = sinEntregas();
    const r = await reenviarDesglose(TENANT, LIQ, op({ a: 'todos', motivo: 'manual' }), conHuella(deps));
    expect(r).toMatchObject({ estado: 'reenviado', generacion: 1 });
    expect(e.insertadas.length).toBeGreaterThan(0);
    for (const f of e.insertadas) {
      expect(f.xlsxRuta).toBe(`${TENANT}/BIT-T01-1228/${'h'.repeat(64)}.xlsx`);
      expect(f.xlsxSha256 ?? null).toBeNull();
      expect(f.generacion).toBe(1);
    }
  });

  it('un desglose RETENIDO no se reenvía por aquí (se libera con su decisión humana): no escribe nada', async () => {
    const { e, deps } = sinEntregas({ desglose: { existe: true, retenidaMotivo: 'El neto es negativo.' } });
    const r = await reenviarDesglose(TENANT, LIQ, op({ a: 'todos' }), conHuella(deps));
    expect(r.estado).toBe('rechazado');
    expect(e.insertadas).toHaveLength(0);
    expect(e.eventos).toHaveLength(0);
  });

  it('si no se puede leer el encabezado (¿retenido?) NO se adivina: rechaza y no escribe', async () => {
    const { e, deps } = sinEntregas({ desglose: null });
    const r = await reenviarDesglose(TENANT, LIQ, op({ a: 'todos' }), conHuella(deps));
    expect(r.estado).toBe('rechazado');
    expect(e.insertadas).toHaveLength(0);
  });

  it('sin encabezado de desglose (no hay Excel que reenviar) sigue siendo sin_archivo', async () => {
    const { deps } = sinEntregas();
    const r = await reenviarDesglose(TENANT, LIQ, op({ a: 'todos' }), { ...conHuella(deps), leerDesglose: async () => ({ existe: false, retenidaMotivo: null }) });
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'sin_archivo' });
  });
});
