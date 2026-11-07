import { describe, expect, it } from 'vitest';
import { configEfectiva, configGuardadaDeFormulario, equipoDeLaRevision, solicitudDeFormulario } from './config_pantalla';
import { copiaConfigGuardadaPorOmision } from '../sin_atender/config_guardada';
import { ZONA_POR_OMISION } from '../turnos';

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const entrada = { plazos: { slaRespuestaMin: 45, slaCriticoMin: 15 }, guardada: null, solicitud: {}, equipoHashes: [], zona: ZONA_POR_OMISION, festivos: [], vistaPreviaMax: 0 };

describe('configuración efectiva', () => {
  it('los plazos de la flota mandan sobre los de arranque; la solicitud sobre ambos', () => {
    const a = configEfectiva(entrada);
    expect(a.ok && a.config).toMatchObject({ umbralMin: 45, umbralCriticoMin: 15 });
    const b = configEfectiva({ ...entrada, solicitud: { umbralMin: 20 } });
    expect(b.ok && b.config.umbralMin).toBe(20);
  });
  it('sin plazos de flota queda lo de arranque', () => {
    const a = configEfectiva({ ...entrada, plazos: null });
    expect(a.ok && a.config.umbralMin).toBeGreaterThan(0);
  });
  it('el formulario: vacío no toca, texto lo rechaza, listas se limpian', () => {
    expect(solicitudDeFormulario(fd({ umbralMin: '' }))).toEqual({ ok: true, valor: {} });
    expect(solicitudDeFormulario(fd({ umbralMin: '1x' })).ok).toBe(false);
    expect(solicitudDeFormulario(fd({ fechaCorte: '2026-13-45' })).ok).toBe(false);
    const r = solicitudDeFormulario(fd({ palabrasClave: ' Embarque, embarque ;\n Retraso ', equipo: 'Operador 1, Operador 2' }));
    expect(r).toEqual({ ok: true, valor: { palabrasClave: ['embarque', 'retraso'], equipoNombres: ['Operador 1', 'Operador 2'] } });
  });
});

describe('configuración efectiva con lo guardado por la flota', () => {
  const guardada = { ...copiaConfigGuardadaPorOmision(), horarioAtencion: { desdeHora: 8, hastaHora: 18 }, palabrasClave: ['retraso'], palabrasUrgentes: ['choque'], insistenciaMin: 4, umbralUrgenteMin: 15 };
  it('lo guardado pisa los de arranque y los plazos; la solicitud de la prueba pisa a lo guardado', () => {
    const a = configEfectiva({ ...entrada, guardada });
    expect(a.ok && a.config).toMatchObject({ umbralMin: 45, insistenciaMin: 4, umbralUrgenteMin: 15, palabrasClave: ['retraso'], palabrasUrgentes: ['choque'], horarioAtencion: { desdeHora: 8, hastaHora: 18 } });
    const b = configEfectiva({ ...entrada, guardada, solicitud: { insistenciaMin: 1, palabrasClave: ['otra'] } });
    expect(b.ok && b.config).toMatchObject({ insistenciaMin: 1, palabrasClave: ['otra'], horarioAtencion: { desdeHora: 8, hastaHora: 18 } });
  });
  it('sin nada guardado: sin horario y con las palabras de arranque', () => {
    const a = configEfectiva({ ...entrada, guardada: copiaConfigGuardadaPorOmision() });
    expect(a.ok && a.config.horarioAtencion).toBeUndefined();
    expect(a.ok && a.config.palabrasClave).toEqual(['embarque', 'embarques']);
  });
  it('el equipo de la revisión une lo guardado con lo escrito, sin repetir', () => {
    expect(equipoDeLaRevision(['Operador 1', 'Operador 2'], ['operador 2', ' Operador 3 ', ''])).toEqual(['Operador 1', 'Operador 2', 'Operador 3']);
    expect(equipoDeLaRevision([], [])).toEqual([]);
  });
});

describe('formulario de la configuración de la flota', () => {
  it('estado completo: casillas sin marcar son apagado y vacío es arranque', () => {
    const r = configGuardadaDeFormulario(fd({}));
    expect(r).toEqual({ ok: true, valor: copiaConfigGuardadaPorOmision() });
  });
  it('arma horario, días, listas y el interruptor del correo', () => {
    const f = fd({ horarioActivo: 'on', desdeHora: '8', hastaHora: '18', insistenciaMin: '3', umbralUrgenteMin: '15', palabrasClave: 'Retraso; embarque', palabrasUrgentes: 'choque', equipo: 'Operador 1, Operador 2', resumenCorreo: 'on' });
    for (const d of ['5', '1', '3']) f.append('diaHabil', d);
    const r = configGuardadaDeFormulario(f);
    expect(r.ok && r.valor).toMatchObject({
      horarioAtencion: { desdeHora: 8, hastaHora: 18, diasHabiles: [1, 3, 5] }, insistenciaMin: 3, umbralUrgenteMin: 15,
      palabrasClave: ['retraso', 'embarque'], palabrasUrgentes: ['choque'], equipoNombres: ['Operador 1', 'Operador 2'], resumenCorreoHabilitado: true,
    });
  });
  it('sin marcar «horario», las horas escritas se ignoran: no hay horario', () => {
    const r = configGuardadaDeFormulario(fd({ desdeHora: '8', hastaHora: '18' }));
    expect(r.ok && r.valor.horarioAtencion).toBeNull();
  });
  it('rechaza números ilegibles, fuera de rango y horario incompleto o al revés', () => {
    expect(configGuardadaDeFormulario(fd({ insistenciaMin: '1x' })).ok).toBe(false);
    expect(configGuardadaDeFormulario(fd({ insistenciaMin: '99' })).ok).toBe(false);
    expect(configGuardadaDeFormulario(fd({ umbralUrgenteMin: '0' })).ok).toBe(false);
    expect(configGuardadaDeFormulario(fd({ horarioActivo: 'on', desdeHora: '8' })).ok).toBe(false);
    expect(configGuardadaDeFormulario(fd({ horarioActivo: 'on', desdeHora: '18', hastaHora: '8' })).ok).toBe(false);
  });
});
