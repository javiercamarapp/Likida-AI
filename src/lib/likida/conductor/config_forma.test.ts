import { describe, it, expect } from 'vitest';
import { CONFIG_CONDUCTOR_DEFAULT } from './config';
import { cuerpoDesdeFormulario, leerEscalera, leerFilasContacto, llavesCambiadas, mismosContactos, valoresDeForma } from './config_forma';
import { validarCambioConfig } from './lectura';

/** Un FormData de verdad (lo que llega a la acción de servidor) con los valores por omisión de la pantalla. */
function formulario(extra: Record<string, string | null> = {}, contactos: Array<[string, string, string, string]> = []): FormData {
  const fd = new FormData();
  const v = valoresDeForma({ ...CONFIG_CONDUCTOR_DEFAULT });
  for (const [k, val] of Object.entries(v)) fd.set(`f_${k}`, val);
  for (const k of ['activo', 'usarLlm', 'confirmarAlChofer', 'validarUbicacion', 'pedirUbicacion', 'fotoRegistraHito']) fd.set(`f_${k}`, 'si');
  for (const d of [1, 2, 3, 4, 5, 6, 7]) fd.set(`f_dia_${d}`, 'si');
  fd.set('c_filas', String(contactos.length + 3));
  contactos.forEach(([nivel, nombre, tel, patio], i) => {
    fd.set(`c_nivel_${i}`, nivel); fd.set(`c_nombre_${i}`, nombre); fd.set(`c_tel_${i}`, tel); fd.set(`c_patio_${i}`, patio);
  });
  for (const [k, val] of Object.entries(extra)) { if (val === null) fd.delete(k); else fd.set(k, val); }
  return fd;
}

describe('la escalera', () => {
  it('lee minutos separados por coma, espacio o punto y coma', () => {
    expect(leerEscalera('0, 15, 30,45')).toEqual({ ok: [0, 15, 30, 45] });
    expect(leerEscalera('0;20 40')).toEqual({ ok: [0, 20, 40] });
  });
  it('un valor que no es un entero NO se descarta en silencio: se dice', () => {
    for (const mal of ['', 'cero', '0, 15, x', '0, 1.5', '-5, 10', '0, 99999']) expect('error' in leerEscalera(mal), mal).toBe(true);
  });
});

describe('del formulario al cuerpo del PUT (una sola validación para las dos puertas)', () => {
  it('el formulario con los valores por omisión valida y reproduce EXACTAMENTE la config por omisión', () => {
    const c = cuerpoDesdeFormulario(formulario());
    if (!('ok' in c)) throw new Error(c.error);
    // Las casillas que el formulario de prueba no marcó (avisos, foto) son «apagado»: igual que los defaults.
    const v = validarCambioConfig(c.ok, { ...CONFIG_CONDUCTOR_DEFAULT });
    if (!('ok' in v)) throw new Error(v.error);
    expect(v.ok.config).toEqual(CONFIG_CONDUCTOR_DEFAULT);
    expect(v.ok.contactos).toEqual([]);
  });

  it('una casilla sin marcar es APAGADA (un FormData no manda las desmarcadas)', () => {
    const c = cuerpoDesdeFormulario(formulario({ f_activo: null, f_usarLlm: null }));
    if (!('ok' in c)) throw new Error(c.error);
    expect(c.ok).toMatchObject({ activo: false, usarLlm: false, confirmarAlChofer: true });
  });

  it('las alertas de estadía vacías son null (apagadas), no 0; con número se guardan', () => {
    const vacio = cuerpoDesdeFormulario(formulario());
    expect(vacio).toMatchObject({ ok: { estadiaAlertaCargaMin: null, estadiaAlertaDescargaMin: null } });
    const con = cuerpoDesdeFormulario(formulario({ f_estadiaAlertaCargaMin: '180' }));
    expect(con).toMatchObject({ ok: { estadiaAlertaCargaMin: '180' } });
    const v = validarCambioConfig((con as { ok: Record<string, unknown> }).ok, { ...CONFIG_CONDUCTOR_DEFAULT });
    expect(v).toMatchObject({ ok: { config: { estadiaAlertaCargaMin: 180, estadiaAlertaDescargaMin: null } } });
  });

  it('los días salen de las casillas marcadas', () => {
    const fd = formulario({ f_dia_6: null, f_dia_7: null });
    expect(cuerpoDesdeFormulario(fd)).toMatchObject({ ok: { diasSemana: [1, 2, 3, 4, 5] } });
    const ninguno = cuerpoDesdeFormulario(formulario(Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [`f_dia_${d}`, null]))));
    const v = validarCambioConfig((ninguno as { ok: Record<string, unknown> }).ok, { ...CONFIG_CONDUCTOR_DEFAULT });
    expect(v).toMatchObject({ error: expect.stringContaining('al menos un día') });
  });

  it('los números inválidos llegan como texto y la validación única los rechaza en palabras', () => {
    for (const [campo, valor, texto] of [
      ['f_horaInicio', '25', 'hora de inicio'], ['f_topeDiarioChofer', '0', 'tope diario'], ['f_toleranciaUbicacionM', '999999', 'tolerancia'], ['f_escalarTrasMin', '10', 'DESPUÉS del último recordatorio'],
    ] as const) {
      const c = cuerpoDesdeFormulario(formulario({ [campo]: valor }));
      const v = validarCambioConfig((c as { ok: Record<string, unknown> }).ok, { ...CONFIG_CONDUCTOR_DEFAULT });
      expect(v, campo).toMatchObject({ error: expect.stringContaining(texto) });
    }
  });

  it('una escalera que no sube, o que no deja lugar a escalar, se rechaza', () => {
    const c = cuerpoDesdeFormulario(formulario({ f_solicitudesMin: '0, 30, 20' }));
    expect(validarCambioConfig((c as { ok: Record<string, unknown> }).ok, { ...CONFIG_CONDUCTOR_DEFAULT })).toMatchObject({ error: expect.stringContaining('ascendente') });
    expect(cuerpoDesdeFormulario(formulario({ f_solicitudesMin: 'x' }))).toMatchObject({ error: expect.stringContaining('minutos enteros') });
  });
});

describe('los contactos de escalamiento', () => {
  it('lee las filas con datos, salta las vacías y normaliza el patio vacío a null; el teléfono de 10 dígitos se completa con 52', () => {
    const fd = formulario({}, [['1', 'Patio Norte', '3312345678', '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001'], ['2', 'Jefe general', '523398765432', '']]);
    expect(leerFilasContacto(fd)).toHaveLength(2);
    const c = cuerpoDesdeFormulario(fd);
    const v = validarCambioConfig((c as { ok: Record<string, unknown> }).ok, { ...CONFIG_CONDUCTOR_DEFAULT });
    expect(v).toMatchObject({ ok: { contactos: [
      { nivel: 1, nombre: 'Patio Norte', telefono: '523312345678', terminalId: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001' },
      { nivel: 2, nombre: 'Jefe general', telefono: '523398765432', terminalId: null },
    ] } });
  });

  it('vaciar nombre y teléfono de una fila existente la QUITA (la lista reemplaza)', () => {
    const fd = formulario({}, [['1', 'Patio Norte', '3312345678', ''], ['1', '', '', '']]);
    expect(leerFilasContacto(fd)).toHaveLength(1);
  });

  it('una fila a medias NO se descarta: la rechaza la validación (nombre sin teléfono, teléfono corto, repetida)', () => {
    for (const filas of [[['1', 'Patio', '', '']], [['1', '', '3312345678', '']], [['1', 'Patio', '12345', '']], [['1', 'A', '3312345678', ''], ['1', 'B', '3312345678', '']]] as Array<Array<[string, string, string, string]>>) {
      const c = cuerpoDesdeFormulario(formulario({}, filas));
      const v = validarCambioConfig((c as { ok: Record<string, unknown> }).ok, { ...CONFIG_CONDUCTOR_DEFAULT });
      const esperado = filas.length === 2 ? 'repite' : /nombre|telefono/;
      expect('error' in v, JSON.stringify(filas)).toBe(true);
      expect((v as { error: string }).error).toMatch(esperado);
    }
  });

  it('un nivel o un patio inventados no pasan', () => {
    const c = cuerpoDesdeFormulario(formulario({}, [['7', 'X', '3312345678', '']]));
    // El nivel desconocido se lee como 7, que la validación única rechaza.
    expect(validarCambioConfig((c as { ok: Record<string, unknown> }).ok, { ...CONFIG_CONDUCTOR_DEFAULT })).toMatchObject({ error: expect.stringContaining('nivel') });
    const p = cuerpoDesdeFormulario(formulario({}, [['1', 'X', '3312345678', 'no-es-uuid']]));
    expect(validarCambioConfig((p as { ok: Record<string, unknown> }).ok, { ...CONFIG_CONDUCTOR_DEFAULT })).toMatchObject({ error: expect.stringContaining('terminalId') });
  });

  it('mismosContactos compara por contenido, sin importar el orden', () => {
    const a = { nivel: 1 as const, nombre: 'A', telefono: '523300000001', terminalId: null };
    const b = { nivel: 2 as const, nombre: 'B', telefono: '523300000002', terminalId: null };
    expect(mismosContactos([a, b], [b, a])).toBe(true);
    expect(mismosContactos([a], [a, b])).toBe(false);
    expect(mismosContactos([a], [{ ...a, nombre: 'Otro' }])).toBe(false);
  });
});

describe('qué cambió (para la bitácora: llaves, nunca valores personales)', () => {
  it('lista las llaves distintas, ordenadas', () => {
    const despues = { ...CONFIG_CONDUCTOR_DEFAULT, topeDiarioChofer: 8, solicitudesMin: [0, 10, 20, 30], avisarOficinaLlegada: true };
    expect(llavesCambiadas({ ...CONFIG_CONDUCTOR_DEFAULT }, despues)).toEqual(['avisarOficinaLlegada', 'solicitudesMin', 'topeDiarioChofer']);
    expect(llavesCambiadas({ ...CONFIG_CONDUCTOR_DEFAULT }, { ...CONFIG_CONDUCTOR_DEFAULT })).toEqual([]);
  });
});
