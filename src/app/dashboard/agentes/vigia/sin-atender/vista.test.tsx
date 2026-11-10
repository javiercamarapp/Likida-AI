import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaSinAtender } from './vista';
import { alerta, resultado } from '@/lib/likida/vigia/sin_atender_aviso/fixtures';
import { copiaConfigGuardadaPorOmision } from '@/lib/likida/vigia/sin_atender/config_guardada';

const accion = async () => null;
const acciones = { revisar: accion as never, enviar: accion as never, guardar: accion as never };
type P = Parameters<typeof VistaSinAtender>[0];
const base = (p: Partial<P> = {}): P => ({
  sufijo: '', error: null, resultado: resultado([alerta({ nivel: 'alta', motivos: ['urgencia', 'pregunta'], critico: true })]), gruposRevisados: 2, gruposOmitidos: 0,
  destinatarios: [{ nombre: 'Servicio 1', correo: 'servicio1@ejemplo.test', origen: 'servicio' }], correoEncendido: false, puedeEnviar: true, guardada: copiaConfigGuardadaPorOmision(), configLeida: true, acciones, ...p,
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
    expect(h).toMatch(/<label for="[^"]+"[^>]*>Fecha de corte/); // cada control lleva su etiqueta enlazada
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
  it('el horario de atención se dice respetado SOLO cuando está guardado; sin horario dice minutos corridos', () => {
    const sin = pintar();
    expect(sin).toContain('Sin horario de atención guardado');
    expect(sin).not.toContain('Horario de atención activo');
    const con = pintar({ guardada: { ...copiaConfigGuardadaPorOmision(), horarioAtencion: { desdeHora: 8, hastaHora: 18, diasHabiles: [1, 2, 3, 4, 5] } } });
    expect(con).toContain('Horario de atención activo de 8:00 a 18:00 h (lun, mar, mié, jue, vie)');
    expect(con).not.toContain('Sin horario de atención guardado');
  });
  it('ya no dice que lo escrito «no se guarda» como si no hubiera dónde guardarlo: la prueba se distingue de la configuración', () => {
    const h = pintar();
    expect(h).toContain('es solo una prueba y no se guarda');
    expect(h).toContain('Configuración de tu flota');
    expect(h).toContain('name="resumenCorreo"');
    expect(h).toContain('name="horarioActivo"');
  });
  it('quien no administra no ve la configuración de la flota', () => {
    const h = pintar({ puedeEnviar: false });
    expect(h).not.toContain('Configuración de tu flota');
    expect(h).not.toContain('Guardar configuración');
  });
  it('el correo: plataforma apagada, plataforma encendida pero flota apagada, y encendido para la flota', () => {
    expect(pintar({ correoEncendido: false })).toContain('Pídele a Likida que lo encienda');
    expect(pintar({ correoEncendido: true })).toContain('apagado para tu flota');
    const on = pintar({ correoEncendido: true, guardada: { ...copiaConfigGuardadaPorOmision(), resumenCorreoHabilitado: true } });
    expect(on).toContain('encendido para tu flota');
    expect(on).not.toContain('apagado para tu flota');
  });
  it('los valores guardados se pintan en el formulario y se avisa si no se pudieron leer', () => {
    const g = { ...copiaConfigGuardadaPorOmision(), equipoNombres: ['Operador 1', 'Operador 2'], palabrasClave: ['embarque'], insistenciaMin: 4, resumenCorreoHabilitado: true };
    const h = pintar({ guardada: g });
    expect(h).toContain('Operador 1, Operador 2');
    expect(h).toContain('value="4"');
    expect(h).toMatch(/name="resumenCorreo"[^>]*checked|checked[^>]*name="resumenCorreo"/);
    expect(pintar({ configLeida: false })).toContain('No se pudo leer la configuración guardada');
    expect(pintar()).not.toContain('No se pudo leer la configuración guardada');
  });
});
