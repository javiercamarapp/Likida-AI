import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/cuadra';

// EL FALLO QUE ESTO FIJA — encontrado el 28-jul-2026 revisando el tenant de demo.
//
// `getConfig` mete `tenant.rfc` en `empresa.rfc`, y el tenant de demostración
// tiene 'TIN010101AAA', que FALLA el dígito verificador — nuestro propio
// validador lo rechaza. El motor descartaba el RFC genérico del SAT antes de
// validar receptores, pero no los RFC mal formados, así que los usaba.
//
// Efecto: toda factura real cuyo receptor no fuera ese RFC inventado salía
// `rfc_receptor` → NO DEDUCIBLE. En una demostración, enseñar un CFDI legítimo y
// que el sistema lo declare no deducible es peor que no validar nada.
//
// Regla: un RFC de empresa que no pasa el dígito verificador es un dato que
// FALTA, no un dato contra el que comparar.

const CFDI = (rfcReceptor: string): Gasto => ({
  id: 'g1', concepto: 'factura', monto: 1000, fecha: '2026-07-27',
  cfdiUuid: 'b50a0a87-e111-454b-81b9-f72a33e42a8c', rfcReceptor, estadoSat: 'vigente',
});

const rechazos = (empresaRfc: string, receptor: string) =>
  (cuadrarViaje({
    viajeId: 'v', anticipo: 5000, politica: [], gastos: [CFDI(receptor)], empresaRfc,
  }).diferencias ?? []).filter((d) => d.tipo === 'rfc_receptor');

// Dos RFC reales, los dos con dígito verificador correcto.
const EMPRESA_OK = 'CCO8605231N4';
const OTRO_OK = 'ODM950324V2A';

describe('RFC de empresa mal formado', () => {
  it('no se usa para rechazar facturas: es un dato que falta', () => {
    expect(rechazos('TIN010101AAA', OTRO_OK)).toHaveLength(0);
  });

  it('tampoco el genérico del SAT, como ya era', () => {
    expect(rechazos('XAXX010101000', OTRO_OK)).toHaveLength(0);
  });

  // Y lo que NO se puede perder: con un RFC bien formado, la validación sigue
  // siendo estricta. Este es el candado que protege de facturar a nombre ajeno.
  it('un RFC válido sí rechaza a un receptor distinto', () => {
    expect(rechazos(EMPRESA_OK, OTRO_OK)).toHaveLength(1);
  });

  it('y acepta al receptor correcto', () => {
    expect(rechazos(EMPRESA_OK, EMPRESA_OK)).toHaveLength(0);
  });
});
