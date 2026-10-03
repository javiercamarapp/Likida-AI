import { describe, it, expect, vi } from 'vitest';
import {
  MAX_INTENTOS_AVISO, TOPE_AVISOS_POR_FLOTA_Y_CORRIDA, avisarEscalacion, avisarEscalacionesPendientes, correoDeTarea, esUrgente,
  type DepsAvisoEscalacion, type TareaParaAviso,
} from './aviso_escalacion';
import type { ConfigNotificaciones, UsuarioAvisable } from '../agentes/notificaciones';

// La base en memoria reproduce lo que importa del claim: UPDATE condicional (solo una pendiente, con intentos por debajo del tope, la gana UNA vez
// mientras dure el reclamo) y el cierre que solo toca lo pendiente.
const T = 'f0000000-0000-4000-8000-000000000001';
const USUARIOS: UsuarioAvisable[] = [
  { id: 'u1', nombre: 'Dueño', email: 'dueno@flota.test', rol: 'flota_admin' },
  { id: 'u2', nombre: 'Tráfico', email: 'trafico@flota.test', rol: 'encargado' },
  { id: 'u3', nombre: 'Contador', email: 'conta@flota.test', rol: 'contador' },
];
const CONF_ENCENDIDO: ConfigNotificaciones = { eventos: ['escalado' as never], roles: ['flota_admin', 'encargado'] };

function tarea(sobre: Partial<TareaParaAviso> = {}): TareaParaAviso {
  return { id: 't1', tenantId: T, estado: 'abierta', avisoEstado: 'pendiente', avisoIntentos: 0, destino: 'mesa_de_control', motivo: 'posible_emergencia', viajeFolio: 'VJ-9', resumen: 'El chofer no contesta y el GPS está viejo', ...sobre };
}

function armar(inicial: TareaParaAviso[], sobre: Partial<DepsAvisoEscalacion> & { conf?: ConfigNotificaciones | { error: string }; envio?: () => Promise<{ ok: true } | { ok: false; motivo: string }> } = {}) {
  const filas = new Map(inicial.map((t) => [t.id, { ...t, reclamada: false, detalle: null as string | null }]));
  const enviados: Array<{ a: string[]; asunto: string }> = [];
  const deps: DepsAvisoEscalacion = {
    async leerTarea(_t, id) { const f = filas.get(id); return f ? { ...f } : null; },
    async reclamar(_t, id) {
      const f = filas.get(id);
      if (!f || f.estado !== 'abierta' || f.avisoEstado !== 'pendiente' || f.avisoIntentos >= MAX_INTENTOS_AVISO || f.reclamada) return false;
      f.avisoIntentos++; f.reclamada = true; return true;
    },
    async marcar(_t, id, estado, detalle) {
      const f = filas.get(id);
      if (!f || f.avisoEstado !== 'pendiente') return;
      f.avisoEstado = estado; f.detalle = detalle; if (estado === 'pendiente') f.reclamada = false;
    },
    async config() { return 'error' in (sobre.conf ?? {}) ? (sobre.conf as { error: string }) : { ok: (sobre.conf as ConfigNotificaciones) ?? CONF_ENCENDIDO }; },
    async usuarios() { return USUARIOS; },
    canalListo: () => true,
    async enviar(a, correo) { enviados.push({ a, asunto: correo.asunto }); return sobre.envio ? sobre.envio() : { ok: true }; },
    async nombreFlota() { return 'Flota de prueba'; },
    ahora: () => new Date('2026-10-02T15:00:00Z'),
    ...sobre,
  };
  return { deps, filas, enviados };
}

describe('el aviso de una tarea escalada', () => {
  it('encendido: manda UN correo a quien marcó el dueño y puede abrir la pantalla (el contador no) y deja la tarea enviada', async () => {
    const { deps, filas, enviados } = armar([tarea()]);
    expect(await avisarEscalacion(T, 't1', deps)).toBe('enviado');
    expect(enviados).toHaveLength(1);
    expect(enviados[0].a.sort()).toEqual(['dueno@flota.test', 'trafico@flota.test']);
    expect(filas.get('t1')!.avisoEstado).toBe('enviado');
    expect(await avisarEscalacion(T, 't1', deps)).toBe('ya_avisada');
    expect(enviados).toHaveLength(1);
  });

  it('APAGADO (el default): no manda, la marca omitida y NO la manda tarde cuando alguien lo enciende', async () => {
    const apagado = armar([tarea()], { conf: { eventos: [], roles: ['flota_admin'] } });
    expect(await avisarEscalacion(T, 't1', apagado.deps)).toBe('omitido_apagado');
    expect(apagado.enviados).toHaveLength(0);
    expect(apagado.filas.get('t1')!.avisoEstado).toBe('omitido');
    expect(apagado.filas.get('t1')!.detalle).toMatch(/apagado/);
    // la flota lo enciende después: la tarea vieja ya quedó omitida y no sale
    const encendido = { ...apagado.deps, async config() { return { ok: CONF_ENCENDIDO }; } };
    expect(await avisarEscalacion(T, 't1', encendido)).toBe('ya_avisada');
    expect(apagado.enviados).toHaveLength(0);
  });

  it('dos corridas solapadas mandan UN solo correo (el claim lo gana una)', async () => {
    const { deps, enviados } = armar([tarea()]);
    const r = await Promise.all([avisarEscalacion(T, 't1', deps), avisarEscalacion(T, 't1', deps)]);
    expect(enviados).toHaveLength(1);
    expect(r.filter((x) => x === 'enviado')).toHaveLength(1);
    expect(r.filter((x) => x === 'ocupado' || x === 'ya_avisada')).toHaveLength(1);
  });

  it('una tarea de dinero no llega al encargado: si solo él está marcado, se omite diciendo por qué', async () => {
    const dinero = armar([tarea({ destino: 'liquidacion', motivo: 'diferencia_liquidacion', resumen: 'Diferencia de $45,320' })], { conf: { eventos: ['escalado' as never], roles: ['encargado'] } });
    expect(await avisarEscalacion(T, 't1', dinero.deps)).toBe('omitido_sin_destinatario');
    expect(dinero.enviados).toHaveLength(0);
    // con el dueño marcado, solo el dueño la recibe
    const conDueno = armar([tarea({ destino: 'liquidacion', motivo: 'diferencia_liquidacion' })]);
    expect(await avisarEscalacion(T, 't1', conDueno.deps)).toBe('enviado');
    expect(conDueno.enviados[0].a).toEqual(['dueno@flota.test']);
  });

  it('R09-3: una tarea dirigida al CONTADOR le llega a sus cuentas (con su propio botón) además del dueño; el encargado sigue sin verla', async () => {
    const r = armar([tarea({ destino: 'contador', motivo: 'duda_fiscal', resumen: 'Duda sobre un CFDI' })], { conf: { eventos: ['escalado' as never], roles: ['flota_admin', 'encargado'] } });
    expect(await avisarEscalacion(T, 't1', r.deps)).toBe('enviado');
    expect(r.enviados[0].a.sort()).toEqual(['conta@flota.test', 'dueno@flota.test']);
    expect(correoDeTarea({ destino: 'contador', motivo: 'duda_fiscal', viajeFolio: null, resumen: 'x' }, null).boton?.href).toContain('/dashboard/contador');
    // el destino NO elige a otros: una tarea para liquidación no se la manda al contador, y una operativa tampoco
    const otra = armar([tarea({ destino: 'liquidacion', motivo: 'diferencia_liquidacion' })]);
    await avisarEscalacion(T, 't1', otra.deps);
    expect(otra.enviados[0].a).toEqual(['dueno@flota.test']);
    // sin duplicar el correo si la cuenta del contador ya estaba marcada, ni mandar a un contador sin correo
    const sinCorreo = armar([tarea({ destino: 'contador', motivo: 'duda_fiscal' })], { usuarios: async () => [{ id: 'u1', nombre: 'Dueño', email: 'dueno@flota.test', rol: 'flota_admin' }, { id: 'u3', nombre: 'Conta', email: ' ', rol: 'contador' }] });
    await avisarEscalacion(T, 't1', sinCorreo.deps);
    expect(sinCorreo.enviados[0].a).toEqual(['dueno@flota.test']);
  });

  it('R09-5: si el correo SALIÓ y sellarlo falla, se reintenta el sello y no se lanza ni se reenvía: queda enviado', async () => {
    let fallos = 2; const sellos: string[] = [];
    const r = armar([tarea()], { async marcar(_t, id, estado) { if (estado === 'enviado' && fallos-- > 0) throw new Error('base parpadeó'); sellos.push(`${id}:${estado}`); } });
    expect(await avisarEscalacion(T, 't1', r.deps)).toBe('enviado');
    expect(sellos).toEqual(['t1:enviado']);
    expect(r.enviados).toHaveLength(1);
    // la base no vuelve en los 3 intentos: el aviso salió y se dice, sin lanzar
    fallos = 99;
    const r2 = armar([tarea({ id: 't2' })], { async marcar() { throw new Error('base caída'); } });
    expect(await avisarEscalacion(T, 't2', r2.deps)).toBe('enviado');
    expect(r2.enviados).toHaveLength(1);
  });

  it('sin canal de correo en el entorno: omitida diciéndolo, sin reclamar', async () => {
    const r = armar([tarea()], { canalListo: () => false });
    expect(await avisarEscalacion(T, 't1', r.deps)).toBe('omitido_sin_canal');
    expect(r.filas.get('t1')!.avisoIntentos).toBe(0);
  });

  it('sin config legible no se manda ni se consume el turno: se reintenta después', async () => {
    const r = armar([tarea()], { conf: { error: 'no se pudo leer' } });
    expect(await avisarEscalacion(T, 't1', r.deps)).toBe('sin_config');
    expect(r.filas.get('t1')!.avisoEstado).toBe('pendiente');
    expect(r.filas.get('t1')!.avisoIntentos).toBe(0);
  });

  it('un envío que falla se reintenta, y al tercero queda agotado diciéndolo', async () => {
    const r = armar([tarea()], { envio: async () => ({ ok: false, motivo: 'Resend 429' }) });
    expect(await avisarEscalacion(T, 't1', r.deps)).toBe('reintentara');
    expect(r.filas.get('t1')!.avisoEstado).toBe('pendiente');
    expect(r.filas.get('t1')!.detalle).toMatch(/Resend 429/);
    expect(await avisarEscalacion(T, 't1', r.deps)).toBe('reintentara');
    expect(await avisarEscalacion(T, 't1', r.deps)).toBe('agotado');
    expect(r.filas.get('t1')!.avisoEstado).toBe('agotado');
    expect(r.enviados).toHaveLength(MAX_INTENTOS_AVISO);
    expect(await avisarEscalacion(T, 't1', r.deps)).toBe('ya_avisada');
  });

  it('una tarea atendida, de otra flota o inexistente no avisa', async () => {
    const r = armar([tarea({ estado: 'atendida' }), tarea({ id: 't2', tenantId: 'otra' })]);
    expect(await avisarEscalacion(T, 't1', r.deps)).toBe('no_aplica');
    expect(await avisarEscalacion(T, 't2', r.deps)).toBe('no_aplica');
    expect(await avisarEscalacion(T, 'nada', r.deps)).toBe('no_aplica');
    expect(r.enviados).toHaveLength(0);
  });

  it('nunca lanza: si el envío revienta devuelve error', async () => {
    const r = armar([tarea()], { enviar: async () => { throw new Error('red caída'); } });
    expect(await avisarEscalacion(T, 't1', r.deps)).toBe('error');
  });
});

describe('el barrido de avisos pendientes', () => {
  it('manda a lo más 3 por flota y por corrida; el resto espera a la siguiente sin perderse', async () => {
    const tareas = Array.from({ length: 5 }, (_, i) => tarea({ id: `t${i}`, motivo: 'otro', destino: 'jefe_de_trafico' }));
    const r = armar(tareas);
    const res = await avisarEscalacionesPendientes(tareas.map((t) => ({ tenantId: T, id: t.id })), r.deps);
    expect(res.enviadas).toBe(TOPE_AVISOS_POR_FLOTA_Y_CORRIDA);
    expect(res.topadas).toBe(2);
    expect(r.filas.get('t3')!.avisoEstado).toBe('pendiente');
    const res2 = await avisarEscalacionesPendientes(['t3', 't4'].map((id) => ({ tenantId: T, id })), r.deps);
    expect(res2.enviadas).toBe(2);
  });

  it('el reloj vencido corta ANTES de mandar', async () => {
    const r = armar([tarea()]);
    const res = await avisarEscalacionesPendientes([{ tenantId: T, id: 't1' }], r.deps, { venceEn: Date.now() - 1 });
    expect(res.revisadas).toBe(0);
    expect(r.enviados).toHaveLength(0);
  });
});

describe('el texto del aviso', () => {
  it('dice qué pasó y a quién le toca, con el folio, y la emergencia sale urgente', () => {
    const c = correoDeTarea({ destino: 'mesa_de_control', motivo: 'posible_emergencia', viajeFolio: 'VJ-9', resumen: 'El chofer no contesta' }, 'Flota X');
    expect(c.asunto).toContain('Posible emergencia');
    expect(c.asunto).toContain('VJ-9');
    expect(c.titulo).toContain('la mesa de control');
    expect(c.parrafos.join(' ')).toContain('El chofer no contesta');
    expect(c.tono).toBe('urgente');
    expect(c.boton?.href).toContain('/dashboard/viajes-en-vivo');
    expect(esUrgente('cliente_molesto')).toBe(false);
    expect(correoDeTarea({ destino: 'contador', motivo: 'duda_fiscal', viajeFolio: null, resumen: 'x' }, null).tono).toBe('atencion');
  });
});

vi.mock('@/lib/correo/enviar', () => ({ correoConfigurado: () => true, enviarCorreo: async () => ({ ok: true }) }));
