import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaSinAtender } from './vista';
import { alerta, resultado } from '@/lib/likida/vigia/sin_atender_aviso/fixtures';

const accion = async () => null;
const acciones = { revisar: accion as never, enviar: accion as never };
type P = Parameters<typeof VistaSinAtender>[0];
const base = (p: Partial<P> = {}): P => ({
  sufijo: '', error: null, resultado: resultado([alerta({ nivel: 'alta', motivos: ['urgencia', 'pregunta'], critico: true })]), gruposRevisados: 2, gruposOmitidos: 0,
  destinatarios: [{ nombre: 'Servicio 1', correo: 'servicio1@ejemplo.test', origen: 'servicio' }], correoEncendido: false, puedeEnviar: true, acciones, ...p,
});
const pintar = (p?: Partial<P>) => renderToStaticMarkup(<VistaSinAtender {...base(p)} />);

describe('conversaciones sin atender (pantalla)', () => {
  it('dice que no hay conexión en tiempo real y que la medida es contra la exportación', () => {
    const h = pintar();
    expect(h).toContain('Vigía por exportación de chats: sin conexión en tiempo real con WhatsApp');
    expect(h).toContain('no contra este momento');
  });
  it('lista grupo, prioridad, motivo y tiempo; el correo apagado se dice', () => {
    const h = pintar();
    expect(h).toContain('Grupo A');
    expect(h).toContain('Alta');
    expect(h).toContain('Urgente, Pregunta');
    expect(h).toContain('2 h 0 min');
    expect(h).toContain('apagado');
  });
  it('quien no administra no ve el botón de enviar ni la fecha de corte', () => {
    const h = pintar({ puedeEnviar: false });
    expect(h).not.toContain('Enviar resumen por correo');
    expect(h).not.toContain('name="fechaCorte"');
    expect(h).toContain('Revisar con estos ajustes');
  });
  it('quien administra ve el botón y la fecha de corte; los controles tienen etiqueta', () => {
    const h = pintar();
    expect(h).toContain('Enviar resumen por correo');
    expect(h).toContain('name="fechaCorte"');
    expect(h).toContain('<label>');
  });
  it('sin destinatarios lo dice; con error no enseña un «todo atendido»', () => {
    expect(pintar({ destinatarios: [] })).toContain('Hoy nadie recibiría el resumen');
    const h = pintar({ error: 'No se pudo leer.', resultado: null });
    expect(h).toContain('No se pudo leer.');
    expect(h).not.toContain('Ninguna conversación');
  });
  it('sin alertas: lo dice sin inventar cifras', () => {
    expect(pintar({ resultado: resultado([]) })).toContain('Ninguna conversación pasa de su plazo');
  });
});
