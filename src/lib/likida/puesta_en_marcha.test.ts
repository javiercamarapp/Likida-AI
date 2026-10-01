import { describe, it, expect } from 'vitest';
import { armarPasos, resumenMarcha, type SenalesMarcha } from './puesta_en_marcha';

const LISTO: SenalesMarcha = {
  datosResponsable: true, perfilFiscalListo: true,
  numeroWhatsApp: { estado: 'configurado', digitos: '525512345678', visible: '+52 55 1234 5678', esPrueba: false },
  patios: 2, operadores: { activos: 250, pendientesDeInvitar: 0 }, unidadesActivas: 250, politicaPropia: true, jefes: 3,
  primerosPasos: { operadores: 250, viajes: 10, comprobantes: 40, liquidaciones: 8, completado: true },
};
const VACIO: SenalesMarcha = {
  datosResponsable: false, perfilFiscalListo: false, numeroWhatsApp: { estado: 'sin_configurar' },
  patios: 0, operadores: { activos: 0, pendientesDeInvitar: 0 }, unidadesActivas: 0, politicaPropia: false, jefes: 0,
  primerosPasos: { operadores: 0, viajes: 0, comprobantes: 0, liquidaciones: 0, completado: false },
};
const NADA: SenalesMarcha = {
  datosResponsable: null, perfilFiscalListo: null, numeroWhatsApp: { estado: 'sin_configurar' },
  patios: null, operadores: null, unidadesActivas: null, politicaPropia: null, jefes: null, primerosPasos: null,
};
const estado = (s: SenalesMarcha, id: string) => armarPasos(s).find((p) => p.id === id)!.estado;

describe('armarPasos — cada paso sale de una señal REAL', () => {
  it('una flota lista: todo hecho y el resumen dice completo', () => {
    const pasos = armarPasos(LISTO);
    expect(pasos.every((p) => p.estado === 'hecho')).toBe(true);
    const r = resumenMarcha(pasos);
    expect(r).toMatchObject({ hechos: r.total, siguiente: null, completo: true, hayDatoFaltante: false });
  });

  it('una flota vacía: todo pendiente, el siguiente es el primero que cuenta, y nada se palomea por cortesía', () => {
    const pasos = armarPasos(VACIO);
    expect(pasos.filter((p) => p.estado === 'hecho')).toEqual([]);
    const r = resumenMarcha(pasos);
    expect(r.hechos).toBe(0);
    expect(r.siguiente?.id).toBe('datos_responsable');
    expect(r.completo).toBe(false);
  });

  it('SIN LECTURA no es pendiente ni hecho: es «sin_dato» (no pude comprobarlo)', () => {
    const pasos = armarPasos(NADA);
    for (const id of ['datos_responsable', 'perfil_fiscal', 'politica', 'patios', 'jefes', 'operadores', 'invitaciones', 'unidades', 'primer_viaje', 'primer_comprobante', 'primera_liquidacion']) {
      expect(pasos.find((p) => p.id === id)!.estado, id).toBe('sin_dato');
    }
    expect(resumenMarcha(pasos).hayDatoFaltante).toBe(true);
  });

  it('el siguiente paso NO es uno sin dato (no se manda al dueño a «completar» lo que no se pudo leer)', () => {
    const r = resumenMarcha(armarPasos({ ...VACIO, datosResponsable: null, perfilFiscalListo: null }));
    expect(r.siguiente?.id).toBe('whatsapp');
  });

  it('WhatsApp: configurado y real = hecho; de PRUEBA = pendiente (y lo dice); inválido o ausente = pendiente', () => {
    expect(estado(LISTO, 'whatsapp')).toBe('hecho');
    const prueba = armarPasos({ ...LISTO, numeroWhatsApp: { estado: 'configurado', digitos: '5255', visible: '+52 55', esPrueba: true } }).find((p) => p.id === 'whatsapp')!;
    expect(prueba.estado).toBe('pendiente');
    expect(prueba.detalle).toMatch(/PRUEBA/);
    expect(armarPasos({ ...LISTO, numeroWhatsApp: { estado: 'invalido', motivo: 'x' } }).find((p) => p.id === 'whatsapp')!.estado).toBe('pendiente');
  });

  it('operadores: «hecho» es tener activos (los de baja no cuentan; el servidor ya manda solo activos)', () => {
    expect(estado({ ...LISTO, operadores: { activos: 1, pendientesDeInvitar: 1 } }, 'operadores')).toBe('hecho');
    expect(estado({ ...LISTO, operadores: { activos: 0, pendientesDeInvitar: 0 } }, 'operadores')).toBe('pendiente');
  });

  it('invitaciones: pendientes de invitar = pendiente; todos invitados = hecho; sin operadores = pendiente (no «hecho» por vacío)', () => {
    expect(estado({ ...LISTO, operadores: { activos: 250, pendientesDeInvitar: 37 } }, 'invitaciones')).toBe('pendiente');
    expect(estado({ ...LISTO, operadores: { activos: 250, pendientesDeInvitar: 0 } }, 'invitaciones')).toBe('hecho');
    expect(estado({ ...LISTO, operadores: { activos: 0, pendientesDeInvitar: 0 } }, 'invitaciones')).toBe('pendiente');
    expect(armarPasos({ ...LISTO, operadores: { activos: 250, pendientesDeInvitar: 37 } }).find((p) => p.id === 'invitaciones')!.detalle).toMatch(/37 de 250/);
  });

  it('política: la HEREDADA no se palomea (solo la que la flota declaró)', () => {
    expect(estado({ ...LISTO, politicaPropia: false }, 'politica')).toBe('pendiente');
    expect(estado({ ...LISTO, politicaPropia: true }, 'politica')).toBe('hecho');
  });

  it('los pasos de la operación salen de lo que de verdad existe (viajes, tickets, liquidaciones)', () => {
    const p = { operadores: 5, viajes: 1, comprobantes: 0, liquidaciones: 0, completado: false };
    const s = { ...LISTO, primerosPasos: p };
    expect(estado(s, 'primer_viaje')).toBe('hecho');
    expect(estado(s, 'primer_comprobante')).toBe('pendiente');
    expect(estado(s, 'primera_liquidacion')).toBe('pendiente');
  });
});

describe('resumenMarcha — lo opcional no cuenta', () => {
  it('patios y jefes son opcionales: una flota de un solo patio puede estar «completa» sin ellos', () => {
    const pasos = armarPasos({ ...LISTO, patios: 0, jefes: 0 });
    expect(pasos.find((p) => p.id === 'patios')!.opcional).toBe(true);
    expect(pasos.find((p) => p.id === 'jefes')!.opcional).toBe(true);
    expect(resumenMarcha(pasos).completo).toBe(true);
  });

  it('el sufijo del superadmin viaja en cada enlace, y el ancla de alta se conserva', () => {
    const pasos = armarPasos(VACIO, '?tenant=t-1');
    expect(pasos.every((p) => p.href.includes('?tenant=t-1'))).toBe(true);
    expect(pasos.find((p) => p.id === 'operadores')!.href).toBe('/dashboard/operadores#alta?tenant=t-1');
  });
});
