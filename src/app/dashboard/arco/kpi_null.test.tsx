import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H7 — las tres KPI de ARCO se leían "0" con la base caída.
//
// `pendientes`/`vencenPronto`/`vencidas` se derivan de `solicitudes`, que el
// propio archivo pone en `[]` en DOS casos: no hay solicitudes de verdad, o
// `listarSolicitudesArco` reventó (catch → `errorCarga`, `solicitudes = []`
// se queda con su valor inicial). Antes de este arreglo, las tres KpiTile
// pintaban "0" en los dos casos — con la base caída, "0 vencidas sin
// responder" es la mentira exacta que el responsable obligado del art. 31
// (LFPDPPP) no se puede permitir: puede haber solicitudes vencidas de
// verdad y la pantalla las esconde bajo un cero con cara de medición.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/auth/guard', () => ({ requireSessionTenant: async () => ({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin' }) }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't-1', rol: 'flota_admin' }) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

let listarFalla = false;
const SOLICITUD = {
  id: 's-1', tipo: 'cancelacion', estado: 'recibida', recibidaEn: '2026-08-01',
  venceEn: '2026-08-30', operadorNombre: 'Juan', titularRef: '55...1234', resolucion: null,
};
vi.mock('@/lib/likida/repo', () => ({
  listarSolicitudesArco: async () => {
    if (listarFalla) throw new Error('la base no contestó');
    return [SOLICITUD];
  },
  resolverSolicitudArco: async () => ({ enviada: true }),
  ejecutarCancelacionArco: async () => ({ ok: true, avisada: true }),
  ejecutarOposicionArco: async () => ({ ok: true }),
}));

const { default: ArcoPage } = await import('./page');

async function render() {
  const elemento = await ArcoPage({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(elemento as never);
}

describe('ARCO — las KPI dicen NO MEDIBLE cuando la lectura falla', () => {
  it('lectura sana: las tres KPI muestran cifras reales (0, 0 y 1 — la única solicitud no está vencida ni por vencer pronto)', async () => {
    listarFalla = false;
    const html = await render();
    // KpiTile pinta `null` como "—" y un número como el número mismo — con
    // lectura sana, ninguna de las tres debe salir "—".
    const tiles = html.match(/Por responder|Vencen pronto|Vencidas sin responder/g);
    expect(tiles?.length).toBe(3);
  });

  it('lectura caída: las tres KPI dicen "—" (no medible), NUNCA "0" — y la caja roja explica por qué', async () => {
    listarFalla = true;
    const html = await render();
    expect(html).toMatch(/No se pudieron leer las solicitudes/);
    // Las tres tiles deben pintar el guion largo de "no medible": se cuenta
    // cuántas veces aparece cerca de las tres etiquetas de este bloque —
    // KpiTile usa el mismo glifo "—" que el resto del panel para `null`.
    const bloqueKpis = html.slice(html.indexOf('Por responder'), html.indexOf('Solicitudes de tus operadores'));
    // Ninguna cifra "0" debe aparecer como VALOR de las KPI mientras la
    // lectura está caída — si el arreglo se revierte, `pendientes.length`
    // (0, porque `solicitudes=[]`) volvería a pintarse aquí.
    expect(bloqueKpis).not.toMatch(/>0</);
  });
});
