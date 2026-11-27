// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 48 · FIS-48-02 / A48-API-01 / A48-OP-03 — UN DESGLOSE RECHAZADO
// POR SPF/DKIM DESAPARECÍA DE TODAS LAS PANTALLAS.
//
// La compuerta que entró el 8-nov (`e98d6e02`) devuelve 200 con
// `ignorado: 'remitente_no_autenticado'` y deja como único testigo un
// `logger.warn`. Ese `return` sale 57 líneas ANTES del `registrarCorrida` que
// el mismo archivo usa para el caso MENOR —un adjunto que pasa de 4 MB—, y la
// razón está escrita ahí: «A37-A2-16: lo que NO se recibe se anota con su
// nombre y motivo (la oficina no abre los logs)».
//
// El reenvío automático es la forma NORMAL de entrada en este producto (la
// propia pantalla de Configuración la sugiere), y rompe SPF: el corte del mes
// se descarta, `desglose_peaje` no recibe una fila, y la bitácora de viaje
// conciliada contra el estado de cuenta del TAG que exige la fr. II de la regla
// 9.1.8 de la RMF 2026 no existe para ese periodo — sin que ninguna pantalla lo
// diga. Es la regla que define al producto («nunca inventar una cifra») fallando
// por omisión: los peajes del mes valen menos y el papel no dice qué falta.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const avisos: Array<{ evento: string; datos: unknown }> = [];
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: (evento: string, datos: unknown) => { avisos.push({ evento, datos }); } } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base'); } }));
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado: async () => false }));
const corridas: Array<{ tenantId: string; agente: string; opciones: Record<string, unknown> }> = [];
vi.mock('../agentes/corridas', () => ({
  registrarCorrida: async (tenantId: string, agente: string, opciones: Record<string, unknown>) => { corridas.push({ tenantId, agente, opciones }); },
}));
vi.mock('../carta_porte_docs/repo', () => ({
  reclamarCorreo: async () => ({ resultado: 'claimed', token: 't' }),
  finalizarCorreo: async () => true,
}));
vi.mock('./datos', () => ({ buzonCorreoPeajesPorToken: async () => ({ tenantId: 'T-1', activo: true, remitentes: ['iave.test'] }) }));
vi.mock('./ingesta', () => ({
  MAX_ARCHIVO_INGESTA_BYTES: 4 * 1024 * 1024,
  recibirArchivoPeaje: async () => ({ ok: true, id: 'x', duplicado: false, estado: 'pendiente' }),
}));
process.env.RESEND_API_KEY = 'x';
const { atenderCorreoPeajes } = await import('./correo_entrante');

const TOKEN = 'a'.repeat(24);
const deps = { descargar: async () => ({ ok: true as const, bytes: new Uint8Array([1]) }) };

/** El corte mensual del proveedor de TAG, reenviado por el contralor (rompe SPF). */
const correoReenviado = () => ({
  emailId: 'e-iave-oct',
  from: 'Facturación IAVE <facturacion@iave.test>',
  headers: [{ name: 'Authentication-Results', value: 'mx.resend.com; spf=fail smtp.mailfrom=contralor@flota.test; dkim=fail header.d=iave.test' }],
  attachments: [{ id: 'a1', filename: 'corte_octubre_2026.csv' }, { id: 'a2', filename: 'detalle_casetas_oct.xlsx' }],
}) as never;

beforeEach(() => { avisos.length = 0; corridas.length = 0; });

describe('FIS-48-02 · un correo de peajes rechazado por autenticación queda a la vista de la oficina', () => {
  it('deja corrida con estado «parcial», que es lo que pintan las pantallas', async () => {
    const r = await atenderCorreoPeajes(TOKEN, correoReenviado(), deps);
    expect(r.cuerpo).toMatchObject({ ignorado: 'remitente_no_autenticado' });
    expect(corridas.length, 'el descarte no dejó corrida: la oficina no lo ve en ninguna pantalla').toBe(1);
    expect(corridas[0]).toMatchObject({ tenantId: 'T-1', agente: 'peajes' });
    expect(corridas[0].opciones).toMatchObject({ estado: 'parcial', disparo: 'correo' });
  });

  it('el motivo nombra los archivos que no entraron y por qué', async () => {
    await atenderCorreoPeajes(TOKEN, correoReenviado(), deps);
    const error = String(corridas[0].opciones.error);
    expect(error).toContain('corte_octubre_2026.csv');
    expect(error).toContain('detalle_casetas_oct.xlsx');
    expect(error).toMatch(/SPF|DKIM/);
  });

  it('el motivo NO lleva la dirección del remitente (dato personal, LFPDPPP)', async () => {
    await atenderCorreoPeajes(TOKEN, correoReenviado(), deps);
    expect(JSON.stringify(corridas) + JSON.stringify(avisos)).not.toContain('facturacion@');
    expect(JSON.stringify(corridas) + JSON.stringify(avisos)).not.toContain('contralor@');
  });

  it('un correo que SÍ autentica no deja corrida de descarte', async () => {
    const bueno = { ...(correoReenviado() as object), headers: [{ name: 'Authentication-Results', value: 'mx.resend.com; dkim=pass header.d=iave.test' }] } as never;
    const r = await atenderCorreoPeajes(TOKEN, bueno, deps);
    expect(r.cuerpo).toMatchObject({ recibidos: 2 });
    expect(corridas).toEqual([]);
  });
});
