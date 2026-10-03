import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoPublico } from './datos';

// ═══════════════════════════════════════════════════════════════════════════
// /estado (E4) — la página PÚBLICA. Lo que se vigila:
//   · nada de verde sin medición (un componente sin dato dice «Sin medición»);
//   · un estado actual viejo NO se muestra como actual;
//   · SOLO lectura: ningún formulario, botón, enlace de acción ni script;
//   · sin datos de flotas, ni nombres de crons, ni versiones, ni motivos.
// ═══════════════════════════════════════════════════════════════════════════

const dia = (n: number) => new Date(Date.UTC(2026, 8, 4 + n)).toISOString().slice(0, 10);
const resumen = (componente: EstadoPublico['resumen'][number]['componente'], celda: 'ok' | 'caido' | 'sin_medicion', pct: number | null) => ({
  componente,
  dias: Array.from({ length: 30 }, (_, i) => ({ dia: dia(i), celda: i === 29 ? celda : 'sin_medicion' as const })),
  muestras: pct === null ? 0 : 288, diasMedidos: pct === null ? 0 : 1, disponibilidadPct: pct,
});

let estado: EstadoPublico | Error;
vi.mock('./datos', () => ({ cargarEstadoPublico: async () => { if (estado instanceof Error) throw estado; return estado; } }));

const { default: PaginaEstado } = await import('./page');
const html = async () => renderToStaticMarkup(await PaginaEstado());

const sano = (): EstadoPublico => ({
  reciente: true, ultimaMedicion: '2026-10-03T17:55:00Z', latidoIlegible: false, historialIlegible: false,
  actual: { app: 'ok', base: 'ok', crons: 'ok', whatsapp: 'ok', correo: null },
  resumen: [resumen('app', 'ok', 100), resumen('base', 'ok', 99.65), resumen('crons', 'ok', 100), resumen('whatsapp', 'ok', 100), resumen('correo', 'sin_medicion', null)],
});

beforeEach(() => { estado = sano(); });

describe('la página pública de estado', () => {
  it('muestra los cinco componentes, su disponibilidad medida y 30 celdas por componente', async () => {
    const h = await html();
    for (const n of ['Aplicación', 'Base de datos', 'Procesos programados', 'WhatsApp', 'Correo']) expect(h).toContain(n);
    expect(h).toContain('Disponibilidad medida: 99.65 %');
    expect((h.match(/<li /g) ?? []).length).toBe(5 * 30);
    expect(h).toContain('Todos los componentes medidos operan con normalidad');
  });

  it('un componente sin medición dice «Sin medición» — jamás «Operativo» ni 100 %', async () => {
    const h = await html();
    const correo = h.slice(h.indexOf('id="c-correo"'));
    expect(correo).toContain('Sin medición');
    expect(correo).toContain('Sin mediciones en los últimos 30 días.');
    expect(correo.slice(0, correo.indexOf('</section>'))).not.toContain('Operativo');
  });

  it('una interrupción en curso encabeza la página; una degradación también', async () => {
    estado = { ...sano(), actual: { ...sano().actual, base: 'caido' } };
    expect(await html()).toContain('Hay una interrupción en curso');
    estado = { ...sano(), actual: { ...sano().actual, crons: 'degradado' } };
    expect(await html()).toContain('Rendimiento degradado');
  });

  it('con la medición vieja NO se enseña estado actual: «Sin medición reciente» y lo dice', async () => {
    estado = { ...sano(), reciente: false, actual: { app: null, base: null, crons: null, whatsapp: null, correo: null } };
    const h = await html();
    expect(h).toContain('Sin medición reciente');
    expect(h).toContain('no se muestra como estado actual');
    expect(h).not.toContain('Operativo');
  });

  it('si el historial no se pudo leer, lo dice en vez de pintar treinta días en blanco', async () => {
    estado = { ...sano(), historialIlegible: true };
    expect(await html()).toContain('No se pudo leer el historial.');
  });

  it('si ni siquiera se pudo armar, la página lo dice y NO pinta un verde por omisión', async () => {
    estado = new Error('base caída');
    const h = await html();
    expect(h).toContain('No pudimos leer las mediciones');
    expect(h).not.toContain('Operativo');
  });

  it('SOLO LECTURA: sin formularios, botones, campos ni scripts (la CSP con nonce no tiene nada que estampar)', async () => {
    const h = await html();
    for (const prohibido of ['<form', '<button', '<input', '<script', 'onclick', 'javascript:']) expect(h.toLowerCase()).not.toContain(prohibido);
  });

  it('no filtra detalle explotable: ni nombres de cron, ni versión, ni rutas internas, ni flotas', async () => {
    const h = await html();
    for (const filtrado of ['wa-outbox', 'wa-pendientes', 'cron_latido', 'api/cron', 'api/health', 'migracion', 'supabase', 'tenant', 'sha', 'CRON_SECRET']) {
      expect(h, filtrado).not.toContain(filtrado);
    }
  });
});
