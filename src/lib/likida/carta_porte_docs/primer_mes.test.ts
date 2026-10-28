import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
const bitacora = vi.hoisted(() => ({ anotarBitacora: vi.fn(async (_e: unknown, _o?: unknown) => true) }));
vi.mock('../bitacora_escritura', () => bitacora);
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.test' }));

import { estado, reset } from './repo_falso.fixture';
import { A, ACTOR, sembrarFlotas } from './escenario.fixture';
import { DatoInvalido } from '../errores';
import { guardarPrimerMes, notificarMovimiento, primerMesVigente, revisoresPrimerMes, validarPrimerMes } from './primer_mes';
import { correosAvisoDoc } from './avisos_documento_correo';

beforeEach(() => { reset(); sembrarFlotas(); bitacora.anotarBitacora.mockClear(); });
const REV = [{ departamento: 'Captura', correo: 'Captura@Flota.test' }];

describe('modo primer mes', () => {
  it('valida fecha y correos; guarda en minúsculas y la bitácora no lleva correos', async () => {
    expect(() => validarPrimerMes({ hasta: '2026-13-45', revisores: REV })).toThrow(DatoInvalido);
    expect(() => validarPrimerMes({ hasta: '2026-12-01', revisores: [{ departamento: 'x', correo: 'mal' }] })).toThrow(/correo/);
    expect(() => validarPrimerMes({ hasta: '2026-12-01', revisores: REV, token: 'x' })).toThrow();
    const g = await guardarPrimerMes(A, { hasta: '2026-12-01', revisores: REV }, ACTOR);
    expect(g.revisores[0].correo).toBe('captura@flota.test');
    const detalle = JSON.stringify(bitacora.anotarBitacora.mock.calls[0][0]);
    expect(detalle).not.toContain('flota.test');
    await guardarPrimerMes(A, { hasta: '2026-12-01', revisores: REV }, ACTOR); // idempotente
    expect(bitacora.anotarBitacora).toHaveBeenCalledTimes(1);
  });
  it('vigente solo hasta la fecha límite inclusive (hora de México), con revisores', () => {
    const c = { hasta: '2026-11-10', revisores: [{ departamento: 'a', correo: 'a@x.test' }] };
    expect(primerMesVigente(c, new Date('2026-11-10T20:00:00Z'))).toBe(true);
    expect(primerMesVigente(c, new Date('2026-11-11T20:00:00Z'))).toBe(false);
    expect(primerMesVigente({ ...c, revisores: [] }, new Date('2026-11-01T20:00:00Z'))).toBe(false);
    expect(primerMesVigente(null, new Date())).toBe(false);
  });
  it('sin configuración o sin la migración (null) está apagado', async () => {
    expect(await revisoresPrimerMes(A)).toEqual([]);
    expect(await notificarMovimiento(A, 'doc-1', 'aprobado', 1)).toBe('apagado');
  });
  it('encendido: copia cada movimiento con asunto genérico, código corto y llave por documento+movimiento+versión; otra flota no recibe', async () => {
    estado.primerMes.set(A, { hasta: '2999-01-01', revisores: [{ departamento: 'Captura', correo: 'captura@flota.test' }] });
    const enviar = vi.fn(async () => ({ ok: true as const, destinatarios: 1 }));
    const id = 'a1b2c3d4-0000-4000-8000-000000000001';
    expect(await notificarMovimiento(A, id, 'aprobado', 3, { enviar })).toBe('enviado');
    expect(enviar).toHaveBeenCalledWith(expect.objectContaining({ tenantId: A, para: ['captura@flota.test'], asunto: 'Carta Porte: documento aprobado', referencia: 'a1b2c3d4', clave: `${id}:aprobado:3` }));
    expect(await notificarMovimiento('otra-flota', id, 'aprobado', 3, { enviar })).toBe('apagado');
  });
  it('un fallo del canal no lanza', async () => {
    estado.primerMes.set(A, { hasta: '2999-01-01', revisores: [{ departamento: 'Captura', correo: 'captura@flota.test' }] });
    expect(await notificarMovimiento(A, 'd', 'rechazado', 1, { enviar: async () => { throw new Error('x'); } })).toBe('fallo');
  });
});

describe('correosAvisoDoc', () => {
  it('hallazgos: revisión → alerta; agotado: alerta → revisión; más los revisores del primer mes, sin repetir', async () => {
    estado.salidaConfigs.set(A, { modo: 'descarga', plantillaPorDefecto: 'normal', reintentosMax: 6, frecuenciaMin: 60, ventanaInicio: null, ventanaFin: null, destinatarioAlertaCorreo: 'alerta@flota.test', destinatarioAlertaUsuario: null, destinatarioRevisionUsuario: null, destinatarioRevisionCorreo: 'revision@flota.test', siTmsDesconocido: 'retener', distanciaFormato: 'texto_km' });
    estado.primerMes.set(A, { hasta: '2999-01-01', revisores: [{ departamento: 'Captura', correo: 'alerta@flota.test' }, { departamento: 'Ops', correo: 'ops@flota.test' }] });
    expect(await correosAvisoDoc(A, 'd1', 'hallazgos')).toEqual(['revision@flota.test', 'alerta@flota.test', 'ops@flota.test']);
    expect(await correosAvisoDoc(A, 'd1', 'agotado')).toEqual(['alerta@flota.test', 'ops@flota.test']);
  });
  it('sin configuración ni primer mes: nadie', async () => {
    expect(await correosAvisoDoc(A, 'd1', 'hallazgos')).toEqual([]);
  });
});
