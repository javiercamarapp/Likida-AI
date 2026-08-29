import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA ALARMA QUE NO SE PODÍA APAGAR — y la prueba de que ya se puede.
//
// El agente de Éxito del cliente (0218) levanta «SIN RESPUESTA» sobre todo
// ticket vivo cuyo hilo no tenga un mensaje PÚBLICO de un autor DISTINTO del
// solicitante (`cuentaComoRespuesta`, `agentes/exito.ts`). La auditoría del
// 29-ago-2026 (H1) midió lo que eso significaba en la práctica:
// `ticket_mensaje` (0051) llevaba desde su migración con CERO escritores en
// todo `src/` — la condición era INSATISFACIBLE POR CONSTRUCCIÓN. La alarma
// no se apagaba nunca, y una alarma que no se puede apagar es una alarma que
// se deja de leer.
//
// Esta prueba no vuelve a escribir la regla: importa la de verdad
// (`cuentaComoRespuesta`) y le da de comer la fila EXACTA que
// `responderTicket` inserta, capturada del mock. Si mañana el escritor deja de
// firmar el `autor_id`, o empieza a escribir todo como interno, esta prueba
// cae — y esa es la única forma de que "el ciclo está conectado" siga siendo
// verdad y no un comentario de hace tres meses.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string } | null };
const respuestas = new Map<string, Resp>();
const filasInsertadas: Array<{ tabla: string; fila: Record<string, unknown> }> = [];

function crearBuilder(tabla: string) {
  let op: 'select' | 'insert' | 'update' = 'select';
  const resp = (): Resp => respuestas.get(`${tabla}#${op}`) ?? { data: null, error: null };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    insert: (fila: Record<string, unknown>) => { op = 'insert'; filasInsertadas.push({ tabla, fila }); return b; },
    update: () => { op = 'update'; return b; },
    eq: () => b, order: () => b, limit: () => b, maybeSingle: () => b, single: () => b,
    then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve().then(() => resp()).then(res, rej),
  });
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
// Las dependencias de `exito.ts` que no tienen nada que ver con esta regla.
// Se mockean para poder IMPORTAR el módulo y usar su función pura, no para
// cambiar lo que hace.
vi.mock('./agentes/corridas', () => ({ registrarCorrida: vi.fn(async () => undefined) }));
vi.mock('./agentes/cola', () => ({ encolarPieza: vi.fn(async () => 'pieza-1') }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: vi.fn(async () => undefined) }));
vi.mock('./contactos', () => ({ telefonosJefe: vi.fn(async () => ({})) }));
vi.mock('@/lib/admin/onboarding', () => ({ getOnboardingFlotas: vi.fn(async () => new Map()) }));
vi.mock('@/lib/saas/transferencia', () => ({ getPorCobrar: vi.fn(async () => []) }));

const { responderTicket } = await import('./soporte');
const { cuentaComoRespuesta } = await import('./agentes/exito');

const SOLICITANTE = 'u-flota';
const TENANT = 'tenant-a';

/** El ticket que la lectura devuelve: lo abrió el cliente, sigue vivo. */
function conTicketAbierto() {
  respuestas.set('ticket_soporte#select', {
    data: {
      id: 'tk-1', tenant_id: TENANT, asunto: 'No baja el PDF', descripcion: null,
      categoria: 'tecnico', prioridad: 'alta', estado: 'abierto', abierto_por: SOLICITANTE,
      asignado_a: null, abierto_en: '2026-08-28T12:00:00Z', vence_en: null, resuelto_en: null,
      asignado: null,
    },
    error: null,
  });
}

/** La fila insertada en `ticket_mensaje`, leída como la lee el agente. */
function comoLaVeElAgente() {
  const f = filasInsertadas.find((x) => x.tabla === 'ticket_mensaje')!.fila;
  return { autorId: (f.autor_id as string | null) ?? null, interna: f.interna === true };
}

beforeEach(() => {
  respuestas.clear();
  filasInsertadas.length = 0;
  respuestas.set('ticket_mensaje#insert', { data: { id: 'msj-1' }, error: null });
  conTicketAbierto();
});

describe('el ciclo de soporte apaga la alarma del agente de Éxito', () => {
  it('la respuesta PÚBLICA de Likida SÍ cuenta — la condición dejó de ser insatisfacible', async () => {
    await responderTicket('tk-1', TENANT, { tipo: 'likida', userId: 'u-likida' }, { cuerpo: 'ya vamos', interna: false });
    expect(cuentaComoRespuesta(comoLaVeElAgente(), SOLICITANTE)).toBe(true);
  });

  it('la NOTA INTERNA no la apaga — el cliente no vio nada', async () => {
    await responderTicket('tk-1', TENANT, { tipo: 'likida', userId: 'u-likida' }, { cuerpo: 'ojo con esta flota', interna: true });
    expect(cuentaComoRespuesta(comoLaVeElAgente(), SOLICITANTE)).toBe(false);
  });

  it('el «¿alguna novedad?» del propio solicitante no la apaga — insistir no es que lo atiendan', async () => {
    await responderTicket('tk-1', TENANT, { tipo: 'flota', userId: SOLICITANTE }, { cuerpo: '¿alguna novedad?', interna: false });
    expect(cuentaComoRespuesta(comoLaVeElAgente(), SOLICITANTE)).toBe(false);
  });

  // La 0051 permite `abierto_por` NULL: "lo abrió Likida a nombre de la flota".
  // Un compañero de la flota que escriba en ese hilo SÍ cuenta como respuesta
  // para el agente — es la semántica que ya tenía y que aquí solo se confirma
  // contra un escritor real, en vez de contra una tabla vacía.
  it('el escritor firma SIEMPRE con un autor: nunca deja el autor_id en null', async () => {
    await responderTicket('tk-1', TENANT, { tipo: 'flota', userId: 'otro-de-la-flota' }, { cuerpo: 'yo también', interna: false });
    const m = comoLaVeElAgente();
    expect(m.autorId).toBe('otro-de-la-flota');
    expect(cuentaComoRespuesta(m, SOLICITANTE)).toBe(true);
  });
});
