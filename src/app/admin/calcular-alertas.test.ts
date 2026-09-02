import { describe, it, expect } from 'vitest';
import { calcularAlertas } from './calcular-alertas';
import type { ResumenNegocio, ConversacionActiva } from '@/lib/admin/negocio';
import type { ConteosEscalaciones } from '@/lib/admin/escalaciones';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, ADM-5 (MEDIO) — "Likida sigue con solo el tenant demo" se
// disparaba con `r.tenants <= 1`: con el PRIMER cliente real dado de alta
// (1 tenant, pero NO el demo) la alerta seguía sonando como si Innovativos
// no existiera. El criterio correcto es el mismo que `esSoloDemo` en
// consola.tsx: el ÚNICO tenant que hay es, de verdad, el tenant demo.
// ═══════════════════════════════════════════════════════════════════════════

const SIN_ESCALACIONES: ConteosEscalaciones = {
  arco: 0, corridasFallo: 0, talachas: 0, facturasProveedor: 0,
  ticketsAbiertos: 0, ticketsVencidos: 0, liquidacionesRevisar: 0,
};

function resumen(flotas: ResumenNegocio['flotas']): ResumenNegocio {
  return {
    tenants: flotas.length, flotas,
    viajesProcesados: 0, costoIaUsd: 0, tokensIn: 0, tokensOut: 0,
    porFase: [], porModelo: [], porDia: [], facturasPorDia: [], facturasTotal: 0,
    tendenciaCosto: null, tendenciaTokens: null,
  };
}

const SIN_CONVERSACIONES: ConversacionActiva[] = [];

// El mismo id que `tenantDemo()` devuelve sin `DEMO_TENANT_ID` en el entorno
// (lib/auth/tenant-demo.ts) — no se mockea el módulo: se usa el default real.
const ID_DEMO = '11111111-1111-1111-1111-111111111111';

describe('calcularAlertas — "solo el tenant demo" ya no se dispara con el primer cliente real', () => {
  it('con 1 tenant REAL (no el demo) NO alerta "solo el tenant demo"', () => {
    const r = resumen([
      { id: 'innovativos', nombre: 'Innovativos', plan: 'pro', viajes: 10, costoIaUsd: 1, politicaPropia: true },
    ]);
    const alertas = calcularAlertas(r, SIN_CONVERSACIONES, SIN_ESCALACIONES);
    expect(alertas.some((a) => a.texto.includes('solo el tenant demo'))).toBe(false);
  });

  it('con SOLO el tenant demo, la alerta SÍ se dispara', () => {
    const r = resumen([
      { id: ID_DEMO, nombre: 'Flota Demo', plan: 'demo', viajes: 0, costoIaUsd: 0, politicaPropia: false },
    ]);
    const alertas = calcularAlertas(r, SIN_CONVERSACIONES, SIN_ESCALACIONES);
    expect(alertas.some((a) => a.texto.includes('solo el tenant demo'))).toBe(true);
  });

  it('con 0 tenants NO alerta "solo el tenant demo" (no hay demo que mostrar)', () => {
    const r = resumen([]);
    const alertas = calcularAlertas(r, SIN_CONVERSACIONES, SIN_ESCALACIONES);
    expect(alertas.some((a) => a.texto.includes('solo el tenant demo'))).toBe(false);
  });

  it('con 2 tenants reales tampoco alerta (nunca lo hizo, pero confirma el AND)', () => {
    const r = resumen([
      { id: 'a', nombre: 'A', plan: 'pro', viajes: 1, costoIaUsd: 0, politicaPropia: false },
      { id: 'b', nombre: 'B', plan: 'pro', viajes: 1, costoIaUsd: 0, politicaPropia: false },
    ]);
    const alertas = calcularAlertas(r, SIN_CONVERSACIONES, SIN_ESCALACIONES);
    expect(alertas.some((a) => a.texto.includes('solo el tenant demo'))).toBe(false);
  });
});
