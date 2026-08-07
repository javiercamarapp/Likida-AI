import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/likida';

// CRÍTICO de la auditoría 5 (fiscal) — y es una REGRESIÓN mía del mismo día.
//
// Por la mañana descubrí que un RFC de empresa mal formado ('TIN010101AAA', el
// del tenant de demo) se usaba para RECHAZAR facturas: toda factura legítima
// salía `rfc_receptor` → no deducible. Lo arreglé descartándolo... y cambié
// "rechaza todo" por "APRUEBA TODO".
//
// El auditor lo reprodujo y yo lo confirmé: un CFDI de $11,600 timbrado a un
// TERCERO salía `deducible $11,600`, `IVA acreditable $1,600`, estatus
// `cuadrada`, cero diferencias. El producto AFIRMABA una deducción inexistente,
// en verde, y el único rastro era un log de servidor que nadie mira.
//
// Aprobar de más es peor que rechazar de más: el cliente responde ante una
// revisión. El estado correcto es el tercero — no se puede confirmar NI
// descartar → a revisión.

const CFDI_DE_TERCERO: Gasto = {
  id: 'g1', concepto: 'factura', monto: 11600, fecha: '2026-07-27',
  cfdiUuid: 'aaaaaaaa-1111-2222-3333-444444444444', estadoSat: 'vigente',
  rfcReceptor: 'ODM950324V2A',   // Office Depot: NO es la flota
  ivaTraslado: 1600, xmlVerificado: true,
};

const cuadrar = (empresaRfc?: string) =>
  cuadrarViaje({ viajeId: 'v', anticipo: 20_000, politica: [], gastos: [CFDI_DE_TERCERO], empresaRfc });

const tipos = (empresaRfc?: string) => (cuadrar(empresaRfc).diferencias ?? []).map((d) => d.tipo);

describe('RFC de la flota mal formado: ni aprueba ni rechaza', () => {
  it('un CFDI de un tercero NO se cuenta como deducible', () => {
    const l = cuadrar('TIN010101AAA');
    expect(l.totalDeducible).toBe(0);
    expect(l.totalPorConfirmar).toBe(11600);
  });

  it('y su IVA NO se acredita', () => {
    expect(cuadrar('TIN010101AAA').ivaAcreditable).toBe(0);
  });

  it('lo dice en el informe, no solo en un log de servidor', () => {
    expect(tipos('TIN010101AAA')).toContain('rfc_receptor_no_verificable');
    const d = (cuadrar('TIN010101AAA').diferencias ?? []).find((x) => x.tipo === 'rfc_receptor_no_verificable');
    expect(d?.nota).toContain('RFC de la flota está mal capturado');
  });

  // Los dos extremos que NO se pueden perder al arreglar el de en medio.
  it('con RFC válido y receptor distinto, sigue siendo NO DEDUCIBLE', () => {
    const l = cuadrar('CCO8605231N4');
    expect(l.totalNoDeducible).toBe(11600);
    expect(tipos('CCO8605231N4')).toContain('rfc_receptor');
  });

  it('con RFC válido y receptor correcto, sigue siendo deducible', () => {
    const propio: Gasto = { ...CFDI_DE_TERCERO, rfcReceptor: 'CCO8605231N4' };
    const l = cuadrarViaje({ viajeId: 'v', anticipo: 20_000, politica: [], gastos: [propio], empresaRfc: 'CCO8605231N4' });
    expect(l.totalDeducible).toBe(11600);
    expect(l.ivaAcreditable).toBe(1600);
  });

  // CERRADO EN LA AUDITORÍA 6. Esto era el hallazgo abierto AL-6: "no configuró
  // RFC" (el genérico del SAT) quedaba fuera del tercer estado, así que por esa
  // puerta un CFDI de TERCERO salía deducible con su IVA acreditable. La
  // exclusión venía de cuando la única alternativa era "rechaza todo"; con el
  // tercer estado ya escrito, no había razón para mantenerla.
  //
  // Y no era un caso raro: `DEMO_CONFIG.empresa.rfc` ES el genérico, o sea la
  // ruta de cualquier tenant que aún no capturó el suyo — el día uno de un
  // cliente, justo después de la demo.
  it('el genérico del SAT también manda a revisión: no se puede verificar receptor', () => {
    expect(tipos('XAXX010101000')).toContain('rfc_receptor_no_verificable');
  });

  it('con el genérico, un CFDI de tercero NO sale deducible ni acredita IVA', () => {
    const l = cuadrar('XAXX010101000');
    expect(l.totalDeducible).toBe(0);
    expect(l.totalPorConfirmar).toBe(11600);
    expect(l.ivaAcreditable).toBe(0);
  });

  it('y el texto dice CAPTURA, no CORRIGE: no es el mismo error', () => {
    // Decirle "está mal capturado" a quien nunca lo capturó lo manda a buscar un
    // error que no existe.
    const nota = cuadrar('XAXX010101000').diferencias.find((d) => d.tipo === 'rfc_receptor_no_verificable')?.nota ?? '';
    expect(nota).toContain('todavía no tiene su RFC capturado');
    expect(nota).toContain('Captura el RFC');
  });

  it('mientras que un RFC mal formado sí dice CORRIGE', () => {
    const nota = cuadrar('TIN010101AAA').diferencias.find((d) => d.tipo === 'rfc_receptor_no_verificable')?.nota ?? '';
    expect(nota).toContain('mal capturado');
    expect(nota).toContain('Corrige el RFC');
  });
});
