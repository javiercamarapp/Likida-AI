import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
const bitacora = vi.hoisted(() => ({ anotarBitacora: vi.fn(async (_e: unknown, _o?: unknown) => true) }));
vi.mock('../bitacora_escritura', () => bitacora);

import { estado, reset } from './repo_falso.fixture';
import { CONFIG_SALIDA_ARRANQUE, guardarConfigSalida, leerConfigSalida, validarConfigSalida } from './salida_config';
import { DatoInvalido } from '../errores';

const T1 = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';
const U1 = '00000000-0000-4000-8000-0000000000a1';
const actor = { id: U1, email: 'oficina@ejemplo.test' };

beforeEach(() => { reset(); bitacora.anotarBitacora.mockClear(); });

describe('leerConfigSalida', () => {
  it('sin fila devuelve los valores de arranque, nunca un error', async () => {
    expect(await leerConfigSalida(T1)).toEqual({ ...CONFIG_SALIDA_ARRANQUE });
    expect(await leerConfigSalida(T1)).toMatchObject({ modo: 'descarga', reintentosMax: 6, frecuenciaMin: 60, siTmsDesconocido: 'retener' });
  });

  it('un fallo de lectura SÍ lanza: no se vuelve «valores de arranque»', async () => {
    estado.fallar.set('leerSalidaConfig', new Error('base caída'));
    await expect(leerConfigSalida(T1)).rejects.toThrow('base caída');
  });

  it('un tenant ajeno no lee la configuración de otro', async () => {
    await guardarConfigSalida(T1, { modo: 'api', reintentosMax: 3, destinatarioAlertaCorreo: 'a@ejemplo.test' }, actor);
    expect(await leerConfigSalida(T1)).toMatchObject({ modo: 'api', reintentosMax: 3, destinatarioAlertaCorreo: 'a@ejemplo.test' });
    expect(await leerConfigSalida(T2)).toEqual({ ...CONFIG_SALIDA_ARRANQUE });
  });
});

describe('validación (mensajes en español)', () => {
  it('reintentos_max 99 se rechaza', async () => {
    await expect(guardarConfigSalida(T1, { reintentosMax: 99 }, actor)).rejects.toThrow(DatoInvalido);
    await expect(guardarConfigSalida(T1, { reintentosMax: 99 }, actor)).rejects.toThrow('Reintentos: el máximo es 50.');
    expect(estado.salidaConfigs.size).toBe(0);
  });

  it.each([
    [{ reintentosMax: -1 }, 'Reintentos: el mínimo es 0.'],
    [{ reintentosMax: 2.5 }, 'Reintentos: debe ser un número entero.'],
    [{ frecuenciaMin: 4 }, 'Frecuencia: el mínimo es 5 minutos.'],
    [{ frecuenciaMin: 1441 }, 'Frecuencia: el máximo es 1440 minutos (24 horas).'],
    [{ destinatarioAlertaCorreo: 'no-es-correo' }, 'Correo de la alerta: el correo no es válido.'],
    [{ destinatarioRevisionCorreo: 'a@b' }, 'Correo de la revisión: el correo no es válido.'],
    [{ ventanaInicio: '25:00', ventanaFin: '06:00' }, 'Inicio de la ventana: usa el formato HH:MM (24 horas).'],
    [{ ventanaInicio: '22:00' }, 'Ventana horaria: escribe inicio y fin, o deja ambos vacíos.'],
    [{ destinatarioAlertaUsuario: 'abc' }, 'Usuario de la alerta: el usuario no es válido.'],
    [{ modo: 'telepatia' as never }, 'Modo de salida: elige descarga o API.'],
  ])('%j → %s', async (valores, mensaje) => {
    await expect(guardarConfigSalida(T1, valores, actor)).rejects.toThrow(mensaje);
  });

  it('acepta los bordes del rango y una ventana completa', async () => {
    const c = await guardarConfigSalida(T1, { reintentosMax: 0, frecuenciaMin: 1440, ventanaInicio: '22:00', ventanaFin: '06:00' }, actor);
    expect(c).toMatchObject({ reintentosMax: 0, frecuenciaMin: 1440, ventanaInicio: '22:00', ventanaFin: '06:00' });
    expect((await guardarConfigSalida(T1, { reintentosMax: 50, frecuenciaMin: 5 }, actor))).toMatchObject({ reintentosMax: 50, frecuenciaMin: 5 });
  });

  it('GUARDIA: la configuración no admite credenciales (campos desconocidos se rechazan)', () => {
    expect(() => validarConfigSalida({ ...CONFIG_SALIDA_ARRANQUE, token: 'x' })).toThrow('las credenciales no se guardan aquí');
    expect(() => validarConfigSalida({ ...CONFIG_SALIDA_ARRANQUE, password: 'x' })).toThrow(DatoInvalido);
  });
});

describe('guardarConfigSalida', () => {
  it('conserva lo no enviado y es idempotente: la segunda vez no cambia nada ni anota bitácora', async () => {
    const v = { modo: 'api' as const, reintentosMax: 4, destinatarioAlertaCorreo: 'oficina@ejemplo.test' };
    const a = await guardarConfigSalida(T1, v, actor);
    const b = await guardarConfigSalida(T1, v, actor);
    expect(b).toEqual(a);
    expect(a).toMatchObject({ frecuenciaMin: 60, plantillaPorDefecto: 'normal' });
    expect(estado.salidaConfigs.size).toBe(1);
    expect(bitacora.anotarBitacora).toHaveBeenCalledTimes(1);
  });

  it('guardar los valores de arranque en una flota sin fila crea la fila (queda explícita)', async () => {
    await guardarConfigSalida(T1, {}, actor);
    expect(estado.salidaConfigs.get(T1)).toEqual({ ...CONFIG_SALIDA_ARRANQUE });
  });

  it('la bitácora lleva solo los NOMBRES de los campos cambiados, nunca correos', async () => {
    await guardarConfigSalida(T1, { frecuenciaMin: 30, destinatarioAlertaCorreo: 'oficina@ejemplo.test' }, actor);
    const [entrada] = bitacora.anotarBitacora.mock.calls[0] as [{ tenantId: string; accion: string; detalle: { campos: string[] } }];
    expect(entrada).toMatchObject({ tenantId: T1, accion: 'ccp.salida_config_guardada', detalle: { campos: ['frecuenciaMin', 'destinatarioAlertaCorreo'] } });
    expect(JSON.stringify(entrada.detalle)).not.toContain('@');
  });

  it('cada flota guarda lo suyo sin pisar la de otra', async () => {
    await guardarConfigSalida(T1, { reintentosMax: 3 }, actor);
    await guardarConfigSalida(T2, { reintentosMax: 9 }, actor);
    expect((await leerConfigSalida(T1)).reintentosMax).toBe(3);
    expect((await leerConfigSalida(T2)).reintentosMax).toBe(9);
  });
});
