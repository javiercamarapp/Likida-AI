import { beforeEach, describe, expect, it, vi } from 'vitest';

// Guardar la configuración de la salida (T-A3-32): vuelve a resolver la sesión, escribe SIEMPRE con el tenant de la
// sesión, rechaza valores inválidos en español, no deja activar el modo API sin conector y deja bitácora sin correos.
const T = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
const U = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02';
const AJENO = 'dddddddd-dddd-4ddd-8ddd-dddddddddd99';
const sesion = { actual: { tenantId: 't-sesion', userId: 'u-sesion', rol: 'flota_admin' } };
const { resolver, bitacora, puerto } = vi.hoisted(() => ({ resolver: vi.fn(), bitacora: vi.fn(async () => true), puerto: { actual: null as unknown } }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: resolver }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: bitacora }));
vi.mock('@/lib/likida/carta_porte_docs/repo', async () => (await import('@/lib/likida/carta_porte_docs/repo_falso.fixture')).api);
vi.mock('@/lib/likida/carta_porte_docs/worker_envios_deps', () => ({ salidaDeFlota: async () => puerto.actual }));

import { estado, reset } from '@/lib/likida/carta_porte_docs/repo_falso.fixture';
import { CONFIG_SALIDA_ARRANQUE } from '@/lib/likida/carta_porte_docs/salida_config';
import { SIN_TMS } from '@/lib/likida/carta_porte_docs/tms_puerto';
import { guardarConfiguracionSalida, probarConexionSalida } from './actions';
import { textoDeConfig } from './formato';

const forma = (c: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...textoDeConfig({ ...CONFIG_SALIDA_ARRANQUE }), ...c })) f.set(k, v);
  return f;
};
const CONECTOR_CON_PRUEBA = { async cargarPlantilla() { return { ok: true as const, referencia: null, duplicado: false }; }, probar: vi.fn(async () => ({ ok: true, mensaje: 'secreto-del-tms' })) };

beforeEach(() => {
  vi.clearAllMocks(); reset();
  sesion.actual = { tenantId: 't-sesion', userId: 'u-sesion', rol: 'flota_admin' };
  resolver.mockImplementation(async () => sesion.actual);
  puerto.actual = SIN_TMS;
  estado.usuarios.push({ tenantId: 't-sesion', id: U, nombre: 'Ana Ejemplo', email: 'ana@ejemplo.test', rol: 'encargado', telefono: null, activo: true });
});

describe('guardarConfiguracionSalida', () => {
  it('un rol sin permiso (aunque llegue la acción) es rechazado sin escribir', async () => {
    resolver.mockImplementation(async () => ({ ...sesion.actual, rol: 'contador' }));
    expect(await guardarConfiguracionSalida(null, forma())).toEqual({ ok: false, error: 'Tu rol no puede cambiar la configuración de la salida de Carta Porte.' });
    expect(estado.salidaConfigs.size).toBe(0);
    expect(bitacora).not.toHaveBeenCalled();
  });

  it('gatea con la ruta de la configuración y guarda con el tenant de la sesión, no con el del formulario; deja bitácora', async () => {
    const r = await guardarConfiguracionSalida(null, forma({ reintentosMax: '4', frecuenciaMin: '30', destinatarioAlertaCorreo: 'avisos@ejemplo.test', tenant_id: AJENO, tenant: AJENO }));
    expect(r).toEqual({ ok: true, mensaje: 'Configuración guardada.' });
    expect(resolver).toHaveBeenCalledWith('/dashboard/agentes/carta-porte/configuracion', expect.objectContaining({ tenant: AJENO }));
    expect([...estado.salidaConfigs.keys()]).toEqual(['t-sesion']);
    expect(estado.salidaConfigs.get('t-sesion')).toMatchObject({ reintentosMax: 4, frecuenciaMin: 30, destinatarioAlertaCorreo: 'avisos@ejemplo.test', modo: 'descarga' });
    expect(bitacora).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-sesion', accion: 'ccp.salida_config_guardada', detalle: { campos: expect.arrayContaining(['reintentosMax', 'frecuenciaMin', 'destinatarioAlertaCorreo']) } }), expect.anything());
    expect(JSON.stringify(bitacora.mock.calls)).not.toContain('avisos@ejemplo.test');
  });

  it('valores inválidos devuelven el mensaje en español y no escriben', async () => {
    for (const [c, texto] of [
      [{ reintentosMax: '99' }, 'Reintentos: el máximo es 50.'], [{ frecuenciaMin: '1' }, 'Frecuencia: el mínimo es 5 minutos.'],
      [{ reintentosMax: '' }, 'Reintentos: escribe un número.'], [{ destinatarioAlertaCorreo: 'mal' }, 'Correo de la alerta: el correo no es válido.'],
      [{ ventanaInicio: '25:00', ventanaFin: '20:00' }, 'Inicio de la ventana: usa el formato HH:MM (24 horas).'],
    ] as const) {
      expect(await guardarConfiguracionSalida(null, forma(c)), JSON.stringify(c)).toEqual({ ok: false, error: texto });
    }
    expect(estado.salidaConfigs.size).toBe(0);
  });

  it('el modo api no se puede activar sin conector (puerto SIN_TMS) y sí con uno', async () => {
    const sin = await guardarConfiguracionSalida(null, forma({ modo: 'api' }));
    expect(sin).toMatchObject({ ok: false, error: expect.stringMatching(/modo API todavía no se puede activar/) });
    expect(estado.salidaConfigs.size).toBe(0);
    puerto.actual = CONECTOR_CON_PRUEBA;
    expect(await guardarConfiguracionSalida(null, forma({ modo: 'api' }))).toMatchObject({ ok: true });
    expect(estado.salidaConfigs.get('t-sesion')?.modo).toBe('api');
  });

  it('un destinatario interno que no es persona activa de la flota se rechaza', async () => {
    expect(await guardarConfiguracionSalida(null, forma({ destinatarioAlertaUsuario: U }))).toMatchObject({ ok: true });
    estado.salidaConfigs.clear();
    expect(await guardarConfiguracionSalida(null, forma({ destinatarioRevisionUsuario: 'dddddddd-dddd-4ddd-8ddd-ddddddddddaa' }))).toEqual({ ok: false, error: 'El usuario de la revisión no es una persona activa de tu flota.' });
    expect(estado.salidaConfigs.size).toBe(0);
  });

  it('un campo extra (credenciales) en el formulario se ignora: nada de token o contraseña llega a la fila', async () => {
    await guardarConfiguracionSalida(null, forma({ token: 'abc', password: 'x' }));
    expect(JSON.stringify([...estado.salidaConfigs.values()])).not.toMatch(/token|password|abc/);
  });

  it('un fallo de la base devuelve un mensaje llano, no el error crudo', async () => {
    estado.fallar.set('guardarSalidaConfig', new Error('boom interno'));
    const r = await guardarConfiguracionSalida(null, forma({ reintentosMax: '2' }));
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).not.toMatch(/guardarSalidaConfig/);
  });
});

describe('probarConexionSalida', () => {
  it('sin conector no hace nada y lo dice; con conector probable llama probar() y no repite el mensaje del TMS', async () => {
    expect(await probarConexionSalida(null, forma())).toEqual({ ok: false, error: 'Esta flota todavía no tiene conectado el sistema del cliente.' });
    expect(CONECTOR_CON_PRUEBA.probar).not.toHaveBeenCalled();
    puerto.actual = CONECTOR_CON_PRUEBA;
    const r = await probarConexionSalida(null, forma());
    expect(r).toEqual({ ok: true, mensaje: 'La conexión con el sistema del cliente respondió bien.' });
    expect(JSON.stringify(r)).not.toContain('secreto-del-tms');
    expect(bitacora).toHaveBeenCalledWith(expect.objectContaining({ accion: 'ccp.salida_conexion_probada', detalle: { ok: true } }), expect.anything());
  });

  it('un rol sin permiso no prueba nada', async () => {
    resolver.mockImplementation(async () => ({ ...sesion.actual, rol: 'encargado' }));
    puerto.actual = CONECTOR_CON_PRUEBA;
    expect(await probarConexionSalida(null, forma())).toMatchObject({ ok: false });
    expect(CONECTOR_CON_PRUEBA.probar).not.toHaveBeenCalled();
  });
});
