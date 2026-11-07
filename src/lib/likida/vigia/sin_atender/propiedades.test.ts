import { describe, it, expect } from 'vitest';
import { CONFIG_SIN_ATENDER_POR_OMISION as D, normalizarConfigSinAtender } from './config';
import { detectarSinAtender } from './detectar';
import { barajar, chat, cli, eq, prng, T0_MS } from './fixtures';
import type { ChatEntrada, MensajeChat } from './tipos';

const config = normalizarConfigSinAtender({ ...D, vistaPreviaMax: 60 }).config;

function chatAleatorio(id: string, azar: () => number): ChatEntrada {
  const msgs: MensajeChat[] = [eq(0, 'inicio')];
  for (let i = 1; i < 60; i += 1) {
    const r = azar();
    const min = Math.floor(azar() * 600);
    msgs.push(r < 0.35 ? eq(min, 'atendido') : r < 0.55 ? cli(min, `¿dónde está ${i}?`) : r < 0.65 ? cli(min, 'gracias') : r < 0.75 ? cli(min, 'sobre el embarque') : cli(min, `mensaje ${i}`));
  }
  return chat(msgs, { chatId: id, nombre: `Grupo ${id}`, critico: azar() < 0.3 });
}

describe('propiedades', () => {
  it('invarianza a permutaciones de mensajes y de chats (dedupe incluido)', () => {
    const azar = prng(7);
    const chats = ['a', 'b', 'c', 'd'].map((id) => chatAleatorio(id, azar));
    const ahora = T0_MS + 700 * 60_000;
    const esperado = detectarSinAtender(chats, config, ahora);
    for (let s = 1; s <= 15; s += 1) {
      const a2 = prng(100 + s);
      const mezclados = barajar(chats, a2).map((c) => ({ ...c, mensajes: barajar([...c.mensajes, ...c.mensajes.slice(0, 10)], a2) }));
      const r = detectarSinAtender(mezclados, config, ahora);
      // Los duplicados añadidos solo suben `descartados`; todo lo demás es idéntico.
      expect({ ...r, resumen: { ...r.resumen, descartados: 0 } }).toEqual({ ...esperado, resumen: { ...esperado.resumen, descartados: 0 } });
      expect(r.resumen.descartados).toBeGreaterThanOrEqual(esperado.resumen.descartados);
    }
  });

  it('es determinista: dos corridas iguales dan lo mismo', () => {
    const azar = prng(3);
    const chats = [chatAleatorio('a', azar), chatAleatorio('b', azar)];
    expect(detectarSinAtender(chats, config, T0_MS + 5e6)).toEqual(detectarSinAtender(chats, config, T0_MS + 5e6));
  });

  it('invariantes de cada alerta', () => {
    const azar = prng(11);
    const chats = Array.from({ length: 8 }, (_, i) => chatAleatorio(String(i), azar));
    const r = detectarSinAtender(chats, config, T0_MS + 800 * 60_000);
    for (const a of r.alertas) {
      expect(a.antiguedadMin).toBeGreaterThanOrEqual(0);
      expect(a.excesoMin).toBe(Math.max(0, a.antiguedadMin - a.umbralAplicadoMin));
      expect(a.motivos.length).toBeGreaterThan(0);
      expect(Date.parse(a.desde)).toBeLessThanOrEqual(Date.parse(a.ultimoEn));
      expect(a.vistaPrevia === null || a.vistaPrevia.length <= 60).toBe(true);
    }
    expect(r.resumen.alertas).toBe(r.alertas.length);
    expect(r.resumen.altas + r.resumen.normales).toBe(r.alertas.length);
  });
});
