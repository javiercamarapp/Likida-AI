import { describe, it, expect } from 'vitest';
import { CONFIG_SIN_ATENDER_POR_OMISION as D, normalizarConfigSinAtender, validarConfigSinAtender } from './config';
import { detectarSinAtender, detectarSinAtenderChat, chatSinEquipoConocido, resumenPorChat } from './detectar';
import { minutosEnHorario } from './horario';
import { chat, cli, eq, T0_MS, ZONA } from './fixtures';
import type { ConfigSinAtender } from './tipos';

const H = { desdeHora: 8, hastaHora: 18 };
const cfg = (p: Partial<ConfigSinAtender> = {}): ConfigSinAtender => normalizarConfigSinAtender({ ...D, ...p }).config;
const min = (m: number) => T0_MS + m * 60_000;
// T0 = miércoles 10:00 México. -660 = martes 23:00.

describe('minutosEnHorario', () => {
  it('descuenta la noche: martes 23:00 a miércoles 10:00 = 120 min (08:00-10:00)', () => {
    expect(minutosEnHorario(min(-660), min(0), H, ZONA, [])).toBe(120);
  });
  it('dentro del horario cuenta todo', () => {
    expect(minutosEnHorario(min(-60), min(0), H, ZONA, [])).toBe(60);
  });
  it('rango vacío o invertido da 0', () => {
    expect(minutosEnHorario(min(0), min(0), H, ZONA, [])).toBe(0);
    expect(minutosEnHorario(min(10), min(0), H, ZONA, [])).toBe(0);
  });
  it('días hábiles: viernes 17:00 a lunes 09:00 con lun-vie = 60 + 60', () => {
    const vie17 = Date.parse('2026-10-16T23:00:00Z'); // viernes 17:00 MX
    const lun9 = Date.parse('2026-10-19T15:00:00Z'); // lunes 09:00 MX
    expect(minutosEnHorario(vie17, lun9, { ...H, diasHabiles: [1, 2, 3, 4, 5] }, ZONA, [])).toBe(120);
    expect(minutosEnHorario(vie17, lun9, H, ZONA, [])).toBe(60 + 600 + 600 + 60);
  });
  it('un festivo no cuenta', () => {
    expect(minutosEnHorario(min(-24 * 60), min(0), H, ZONA, [])).toBe(600);
    expect(minutosEnHorario(min(-24 * 60), min(0), H, ZONA, ['2026-10-13'])).toBe(120);
  });
  it('mes entero termina rápido y de forma finita', () => {
    const t = Date.now();
    const r = minutosEnHorario(min(-60 * 24 * 400), min(0), H, ZONA, []);
    expect(r).toBeGreaterThan(0);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('horario de atención en el motor', () => {
  const noche = chat([eq(-700, 'listo'), cli(-660, 'necesito el estatus del viaje')]);

  it('apagado por omisión: minutos corridos (comportamiento anterior)', () => {
    const a = detectarSinAtenderChat(noche, cfg({ umbralMin: 180 }), min(0)).alertas;
    expect(a).toHaveLength(1);
    expect(a[0].antiguedadMin).toBe(660);
  });
  it('encendido: mensaje de la noche no alerta si apenas pasó una hora de oficina', () => {
    expect(detectarSinAtenderChat(noche, cfg({ umbralMin: 180, horarioAtencion: H }), min(0)).alertas).toEqual([]);
  });
  it('encendido: alerta cuando las horas de oficina superan el umbral y reporta esos minutos', () => {
    const a = detectarSinAtenderChat(noche, cfg({ umbralMin: 60, horarioAtencion: H }), min(0)).alertas;
    expect(a).toHaveLength(1);
    expect(a[0].antiguedadMin).toBe(120);
    expect(a[0].excesoMin).toBe(60);
  });
  it('la insistencia sigue alertando fuera de horario', () => {
    const c = chat([eq(-700, 'ok'), cli(-660, 'hola?'), cli(-655, 'alguien me contesta?')]);
    const a = detectarSinAtenderChat(c, cfg({ umbralMin: 600, horarioAtencion: H }), min(0)).alertas;
    expect(a[0]?.motivos).toContain('insistencia');
  });
  it('config: horario válido se conserva, inválido se ignora con aviso, validar lo rechaza', () => {
    expect(normalizarConfigSinAtender({ horarioAtencion: { desdeHora: 8, hastaHora: 18, diasHabiles: [5, 1, 1] } }).config.horarioAtencion).toEqual({ desdeHora: 8, hastaHora: 18, diasHabiles: [1, 5] });
    const mal = normalizarConfigSinAtender({ horarioAtencion: { desdeHora: 18, hastaHora: 8 } });
    expect(mal.config.horarioAtencion).toBeUndefined();
    expect(mal.avisos.join(' ')).toContain('horario');
    expect(validarConfigSinAtender({ horarioAtencion: { desdeHora: 18, hastaHora: 8 } }).ok).toBe(false);
    expect(validarConfigSinAtender({ horarioAtencion: { desdeHora: 8, hastaHora: 25 } }).ok).toBe(false);
    expect(validarConfigSinAtender({ horarioAtencion: { desdeHora: 8, hastaHora: 18, diasHabiles: [] } }).ok).toBe(false);
    expect(validarConfigSinAtender({ horarioAtencion: H }).ok).toBe(true);
    expect('horarioAtencion' in D).toBe(false);
  });
});

describe('equipo desconocido y resumen', () => {
  const sinEquipo = chat([cli(0, 'hola?'), cli(1, 'alguien?')], { chatId: 'g-sin', nombre: 'Grupo S' });
  it('sin equipo: cero alertas, función verdadera y el resumen lo dice', () => {
    const r = detectarSinAtender([sinEquipo, chat([eq(0, 'x'), cli(1, 'necesito algo')], { chatId: 'g-ok' }), chat([], { chatId: 'g-vacio' })], cfg(), min(999));
    expect(chatSinEquipoConocido(sinEquipo, cfg())).toBe(true);
    expect(r.alertas.map((a) => a.chatId)).toEqual(['g-ok']);
    expect(r.resumen.chatsSinEquipo).toBe(1);
    expect(r.resumen.chatsSinEquipoIds).toEqual(['g-sin']);
  });
  it('resumenPorChat agrupa por chat y ordena por la más antigua', () => {
    const r = detectarSinAtender([
      chat([eq(0, 'x'), cli(5, 'necesito el estatus')], { chatId: 'g1', nombre: 'Grupo B' }),
      chat([eq(0, 'x'), cli(1, 'urgente, dónde está?')], { chatId: 'g2', nombre: 'Grupo A' }),
    ], cfg(), min(100));
    const f = resumenPorChat(r.alertas);
    expect(f.map((x) => x.chatId)).toEqual(['g2', 'g1']);
    expect(f[0]).toMatchObject({ alertas: 1, altas: 1, masAntiguaMin: 99 });
  });
});
