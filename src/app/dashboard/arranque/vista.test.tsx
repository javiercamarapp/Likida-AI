import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaPuestaEnMarcha } from './vista';
import { armarPasos, resumenMarcha, type SenalesMarcha } from '@/lib/likida/puesta_en_marcha';

const VACIO: SenalesMarcha = {
  datosResponsable: false, perfilFiscalListo: false, numeroWhatsApp: { estado: 'sin_configurar' },
  patios: 0, operadores: { activos: 0, pendientesDeInvitar: 0 }, unidadesActivas: 0, politicaPropia: false, jefes: 0,
  primerosPasos: { operadores: 0, viajes: 0, comprobantes: 0, liquidaciones: 0, completado: false },
};

function pintar(s: SenalesMarcha, puedeAdministrar = true) {
  const pasos = armarPasos(s);
  return renderToStaticMarkup(<VistaPuestaEnMarcha pasos={pasos} resumen={resumenMarcha(pasos)} puedeAdministrar={puedeAdministrar} hrefAutomatizacion={{ '/dashboard/agentes/liquidacion': '/dashboard/agentes/liquidacion' }} />);
}

describe('la puesta en marcha', () => {
  it('una flota vacía: 0 de N, barra de progreso accesible, el siguiente paso con su enlace, y todos los grupos', () => {
    const html = pintar(VACIO);
    expect(html).toMatch(/0 de 1\d pasos/);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('Siguiente:');
    expect(html).toContain('Datos del responsable de tu flota');
    for (const g of ['Tu flota y su cuenta', 'Tu gente y tus camiones', 'Tu primera operación']) expect(html).toContain(g);
  });

  it('un paso sin dato dice «No pude comprobarlo» y avisa que el avance es un mínimo (no un pendiente inventado)', () => {
    const html = pintar({ ...VACIO, datosResponsable: null });
    expect(html).toContain('No pude comprobarlo en este momento');
    expect(html).toContain('el avance de arriba es un mínimo');
  });

  it('cada paso lleva su estado también como texto para lector de pantalla (no color solo)', () => {
    const html = pintar({ ...VACIO, unidadesActivas: 5 });
    expect(html).toContain('— hecho');
    expect(html).toContain('— pendiente');
  });

  it('los opcionales se rotulan «(opcional)»', () => {
    expect(pintar(VACIO)).toContain('(opcional)');
  });

  it('el jefe de tráfico ve los pasos de configuración SIN botón («lo hace quien administra») y los de operación CON él', () => {
    const html = pintar(VACIO, false);
    expect(html).toContain('Lo hace quien administra');
    expect(html).toContain('Dar de alta operadores');
  });

  it('completa: lo dice', () => {
    const listo: SenalesMarcha = {
      datosResponsable: true, perfilFiscalListo: true, numeroWhatsApp: { estado: 'configurado', digitos: '525512345678', visible: '+52 55 1234 5678', esPrueba: false },
      patios: 1, operadores: { activos: 5, pendientesDeInvitar: 0 }, unidadesActivas: 5, politicaPropia: true, jefes: 1,
      primerosPasos: { operadores: 5, viajes: 1, comprobantes: 1, liquidaciones: 1, completado: true },
    };
    expect(pintar(listo)).toContain('Tu flota está lista para operar');
  });

  it('las automatizaciones solo enlazan las que el rol ve; las demás van como texto', () => {
    const html = pintar(VACIO);
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/agentes\/liquidacion"[^>]*>Liquidación automática<\/a>/);
    expect(html).not.toMatch(/<a[^>]*>Facturas en automático<\/a>/);
  });
});
