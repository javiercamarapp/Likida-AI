import { describe, it, expect } from 'vitest';
import {
  perfilDeDestino, requiereConfirmacionReforzada, confirmacionValida, evaluarConsentimiento,
} from './consentimiento';

describe('perfilDeDestino', () => {
  it('claude.ai y chatgpt.com son conocidos; enseña el host', () => {
    expect(perfilDeDestino('https://claude.ai/api/mcp/auth_callback')).toMatchObject({ host: 'claude.ai', conocido: true, loopback: false });
    expect(perfilDeDestino('https://chatgpt.com/connector_platform_oauth_redirect')).toMatchObject({ host: 'chatgpt.com', conocido: true });
  });
  it('loopback es conocido y se marca como tu propia máquina', () => {
    expect(perfilDeDestino('http://localhost:53124/callback')).toMatchObject({ hostname: 'localhost', host: 'localhost:53124', conocido: true, loopback: true });
  });
  it('un host desconocido NO es conocido y el host se muestra completo', () => {
    expect(perfilDeDestino('https://atacante.tld/cb')).toMatchObject({ host: 'atacante.tld', conocido: false });
  });
  it('un host que solo se PARECE a uno conocido no lo es', () => {
    for (const u of [
      'https://claude.ai.atacante.tld/cb',
      'https://atacante.tld/claude.ai/cb',
      'https://xclaude.ai/cb',
      'https://claude.ai:8443/cb',
      'https://claude.ai.@atacante.tld/cb',
    ]) {
      expect(perfilDeDestino(u)?.conocido, u).toBe(false);
    }
  });
  it('una URL inválida no tiene perfil', () => {
    expect(perfilDeDestino('no-es-url')).toBeNull();
  });
});

describe('confirmación reforzada (alcance de dinero)', () => {
  it('solo el área de dinero la exige', () => {
    expect(requiereConfirmacionReforzada(['operacion', 'dinero'])).toBe(true);
    expect(requiereConfirmacionReforzada(['operacion', 'administracion'])).toBe(false);
    expect(requiereConfirmacionReforzada([])).toBe(false);
  });
  it('exige escribir EXACTAMENTE el host de destino', () => {
    const u = 'https://claude.ai/api/mcp/auth_callback';
    expect(confirmacionValida(u, 'claude.ai')).toBe(true);
    expect(confirmacionValida(u, '  Claude.AI. ')).toBe(true);
    expect(confirmacionValida(u, 'claude')).toBe(false);
    expect(confirmacionValida(u, 'claude.ai.evil.tld')).toBe(false);
    expect(confirmacionValida(u, '')).toBe(false);
    expect(confirmacionValida(u, null)).toBe(false);
    expect(confirmacionValida(u, undefined)).toBe(false);
  });
  it('en loopback vale el nombre de host sin puerto o con él', () => {
    const u = 'http://localhost:53124/cb';
    expect(confirmacionValida(u, 'localhost')).toBe(true);
    expect(confirmacionValida(u, 'localhost:53124')).toBe(true);
    expect(confirmacionValida(u, 'localhost:1')).toBe(false);
  });
});

describe('evaluarConsentimiento (lo que decide el server action)', () => {
  const base = { redirectUri: 'https://claude.ai/api/mcp/auth_callback', areas: ['operacion'], confirmacion: '' };

  it('cliente aprobado, sin dinero: basta el clic', () => {
    expect(evaluarConsentimiento({ ...base, estadoCliente: 'aprobado' })).toEqual({ ok: true });
  });
  it('un cliente pendiente o rechazado NUNCA consiente, aunque lo manden por POST a mano', () => {
    expect(evaluarConsentimiento({ ...base, estadoCliente: 'pendiente' })).toEqual({ ok: false, motivo: 'cliente_no_aprobado' });
    expect(evaluarConsentimiento({ ...base, estadoCliente: 'rechazado' })).toEqual({ ok: false, motivo: 'cliente_no_aprobado' });
  });
  it('con dinero en el alcance y sin confirmación, no pasa', () => {
    expect(evaluarConsentimiento({ ...base, estadoCliente: 'aprobado', areas: ['operacion', 'dinero'] }))
      .toEqual({ ok: false, motivo: 'falta_confirmacion' });
  });
  it('con dinero y el host tecleado bien, pasa; con otro host, no', () => {
    expect(evaluarConsentimiento({ ...base, estadoCliente: 'aprobado', areas: ['dinero'], confirmacion: 'claude.ai' })).toEqual({ ok: true });
    expect(evaluarConsentimiento({ ...base, estadoCliente: 'aprobado', areas: ['dinero'], confirmacion: 'atacante.tld' }))
      .toEqual({ ok: false, motivo: 'falta_confirmacion' });
  });
  it('un destino inválido se niega', () => {
    expect(evaluarConsentimiento({ ...base, estadoCliente: 'aprobado', redirectUri: 'zzz' })).toEqual({ ok: false, motivo: 'destino_invalido' });
  });
});
