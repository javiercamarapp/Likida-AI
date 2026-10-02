import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionExternas, leerFiltroExterno, leerMensajeExterno, type FichasExternas, type PaginaExternas } from './externas';
import type { LiquidacionExterna } from '@/lib/likida/liquidacion_externa/repo';

// ═══════════════════════════════════════════════════════════════════════════
// EL TABLERO DE LIQUIDACIONES EXTERNAS.
//
// Lo que se fija es lo que haría FALSA a la pantalla:
//   · un conteo que no se pudo leer NO es un cero: se pinta «—» y se dice;
//   · lo que pide a una persona (No coincide, Fallaron) va primero y resaltado;
//   · el error de entrega se enseña como FRASE, nunca el cuerpo crudo de Meta;
//   · las cifras llevan su moneda, y el rótulo dice que son de tu sistema;
//   · «Reintentar» solo aparece en una fallida (reintentar una que sí salió
//     sería mandarle dos veces el mismo pago al chofer);
//   · un texto hostil se escapa, no se inyecta.
// ═══════════════════════════════════════════════════════════════════════════

const fila = (p: Partial<LiquidacionExterna> = {}): LiquidacionExterna => ({
  id: '11111111-1111-4111-8111-111111111111', tenantId: 't-1', claveExterna: 'SAP-1', huella: 'h'.repeat(64),
  sistemaOrigen: 'SAP', operadorId: 'o-1', operadorNombre: 'Juan Pérez', operadorTelefono: '525512345678',
  foliosViaje: ['VJ-1'], viajeIds: [], periodoDesde: '2026-09-01', periodoHasta: '2026-09-07', conceptos: [],
  total: 2499.75, moneda: 'MXN', pdfRuta: 't-1/externas/x.pdf', pdfOrigen: 'generado', estado: 'enviada', via: 'sesion',
  generacion: 1, intentos: 1, proximoIntentoEn: 'x', ultimoError: null, wamid: 'w', enviadaEn: '2026-09-08T16:00:00Z',
  acuseTipo: null, acuseEn: null, acuseConfirmadoEn: null, creadaEn: '2026-09-08T15:00:00Z', ...p,
});

const FICHAS: FichasExternas = {
  porEstado: { pendiente: 1, en_cola: 2, enviada: 3, acusada: 4, fallida: 0 }, noCoincide: 1,
};
const reintentar = vi.fn(async (_fd: FormData) => {});

const pintar = async (filas: LiquidacionExterna[], o: {
  fichas?: FichasExternas; total?: number | null; filtro?: Parameters<typeof SeccionExternas>[0]['filtroEstado'];
  mensaje?: Parameters<typeof SeccionExternas>[0]['mensaje']; siguiente?: string | null; puedeReintentar?: boolean;
  formato?: { excel: boolean; copia: boolean } | null;
} = {}) => renderToStaticMarkup(await SeccionExternas({
  fichas: Promise.resolve(o.fichas ?? FICHAS),
  pagina: Promise.resolve<PaginaExternas>({ filas, hayMas: o.siguiente != null, siguiente: o.siguiente ?? null, total: o.total === undefined ? filas.length : o.total }),
  filtroEstado: o.filtro ?? null, contexto: [['tenant', 'flota-1']], mensaje: o.mensaje ?? null,
  puedeReintentar: o.puedeReintentar ?? true, reintentar,
  ...(o.formato !== undefined ? { formato: Promise.resolve(o.formato), reenviarCopia: async () => {} } : {}),
}));

describe('lo que dice la sección', () => {
  it('declara que las cifras son de TU sistema y que Likida solo entrega', async () => {
    const html = await pintar([fila()]);
    expect(html).toContain('Calculadas por el sistema de tu empresa');
    expect(html).toContain('no las recalcula');
    expect(html).toContain('Total (de tu sistema)');
  });

  it('la cifra lleva su moneda (un «$» a secas es ambiguo en un documento de pago)', async () => {
    const html = await pintar([fila(), fila({ id: '22222222-2222-4222-8222-222222222222', claveExterna: 'SAP-2', moneda: 'USD', total: 80 })]);
    expect(html).toContain('$2,499.75 MXN');
    expect(html).toContain('US$80.00 USD');
  });
});

describe('las fichas: un conteo que no se pudo leer NO es cero', () => {
  it('con números de verdad los pinta', async () => {
    const html = await pintar([fila()]);
    expect(html).toContain('No coincide');
    expect(html).toMatch(/Fallaron/);
  });

  it('con un conteo `null` pinta «—» y dice que no se pudo contar', async () => {
    const html = await pintar([fila()], { fichas: { porEstado: { pendiente: null, en_cola: null, enviada: null, acusada: null, fallida: null }, noCoincide: null } });
    expect(html).toContain('—');
    expect(html).toContain('no se pudo contar');
    expect(html).not.toMatch(/>0</);
  });

  it('un cero MEDIDO sí se pinta como cero', async () => {
    const html = await pintar([fila()], { fichas: { porEstado: { pendiente: 0, en_cola: 0, enviada: 0, acusada: 0, fallida: 0 }, noCoincide: 0 } });
    expect(html).toContain('>0<');
    expect(html).not.toContain('no se pudo contar');
  });

  it('«No coincide» y «Fallaron» con casos se resaltan; con cero no', async () => {
    const con = await pintar([fila()]);
    expect(con).toMatch(/border-color:var\(--bad\)/);
    const sin = await pintar([fila()], { fichas: { porEstado: { pendiente: 0, en_cola: 0, enviada: 0, acusada: 0, fallida: 0 }, noCoincide: 0 } });
    expect(sin).not.toMatch(/border-color:var\(--bad\)/);
  });

  it('cada ficha filtra: sus links llevan el estado y conservan el contexto (tenant)', async () => {
    const html = await pintar([fila()]);
    expect(html).toContain('ext_estado=no_coincide');
    expect(html).toContain('ext_estado=fallida');
    expect(html).toMatch(/href="\?tenant=flota-1&amp;ext_estado=fallida"/);
  });
});

describe('la tabla', () => {
  it('una disputa se ve: fila resaltada y «No coincide» en rojo', async () => {
    const html = await pintar([fila({ estado: 'acusada', acuseTipo: 'no_coincide', acuseEn: '2026-09-09T10:00:00Z' })]);
    expect(html).toMatch(/background:var\(--badbg\)/);
    expect(html).toContain('No coincide');
  });

  it('«Recibida» y «Sin respuesta» se distinguen', async () => {
    expect(await pintar([fila({ estado: 'acusada', acuseTipo: 'recibida', acuseEn: '2026-09-09T10:00:00Z' })])).toContain('Recibida');
    expect(await pintar([fila()])).toContain('Sin respuesta');
  });

  it('el error de entrega sale como FRASE; el cuerpo crudo de Meta no cruza', async () => {
    const html = await pintar([fila({ estado: 'fallida', ultimoError: 'terminal:HTTP 400: {"error":{"code":131030,"fbtrace_id":"AbCdEf"}}' })]);
    expect(html).toContain('no está autorizado en la cuenta de WhatsApp');
    expect(html).not.toContain('fbtrace');
    expect(html).not.toContain('terminal:');
  });

  it('un error interno (con nombres de tablas) tampoco cruza', async () => {
    const html = await pintar([fila({ estado: 'pendiente', ultimoError: 'relation "liquidacion_externa" does not exist' })]);
    expect(html).not.toContain('relation');
    expect(html).toContain('problema interno');
  });

  it('por plantilla se dice (fuera de las 24 h)', async () => {
    expect(await pintar([fila({ via: 'plantilla' })])).toContain('por plantilla');
  });

  it('«Reintentar» solo en una FALLIDA, y solo si el rol puede', async () => {
    expect(await pintar([fila({ estado: 'fallida' })])).toContain('Reintentar');
    for (const estado of ['pendiente', 'en_cola', 'enviada', 'acusada'] as const) {
      expect(await pintar([fila({ estado })]), estado).not.toContain('Reintentar');
    }
    expect(await pintar([fila({ estado: 'fallida' })], { puedeReintentar: false })).not.toContain('Reintentar');
  });

  it('el PDF se baja por la ruta de export CON el tenant del contexto', async () => {
    const html = await pintar([fila()]);
    expect(html).toContain('/api/export/liquidaciones-externas?tenant=flota-1&amp;pdf=11111111-1111-4111-8111-111111111111');
  });

  it('sin PDF no hay link de PDF', async () => {
    expect(await pintar([fila({ pdfRuta: null })])).not.toContain('pdf=');
  });

  it('un nombre o folio hostil se ESCAPA (no se inyecta HTML)', async () => {
    const html = await pintar([fila({ operadorNombre: '<img src=x onerror=alert(1)>', claveExterna: '"><script>alert(1)</script>', sistemaOrigen: '<b>x</b>' })]);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img');
  });

  it('sin operador conocido, «—» y no un nombre inventado', async () => {
    expect(await pintar([fila({ operadorNombre: null })])).toContain('—');
  });
});

describe('vacíos y paginación', () => {
  it('sin ninguna liquidación y sin filtro explica CÓMO llegan, no dice «no hay nada»', async () => {
    const html = await pintar([], { total: 0 });
    expect(html).toContain('POST /v1/liquidaciones-externas');
  });

  it('un filtro que no devuelve nada lo dice distinto', async () => {
    const html = await pintar([], { total: 0, filtro: 'fallida' });
    expect(html).toContain('Ninguna liquidación cae en ese estado');
    expect(html).not.toContain('POST /v1/liquidaciones-externas');
  });

  it('un total que no se pudo contar se dice (no «0 en total»)', async () => {
    const html = await pintar([fila()], { total: null });
    expect(html).toContain('Total no disponible');
  });

  it('«Siguiente» lleva el cursor, el filtro y el contexto', async () => {
    const html = await pintar([fila()], { siguiente: 'CURSOR123', filtro: 'enviada' });
    expect(html).toContain('ext_cursor=CURSOR123');
    expect(html).toContain('ext_estado=enviada');
    expect(html).toContain('tenant=flota-1');
    expect(html).toContain('rel="next"');
  });

  it('sin siguiente no hay link de siguiente', async () => {
    expect(await pintar([fila()])).not.toContain('rel="next"');
  });
});

describe('exportar y mensajes', () => {
  it('el CSV pide un periodo (desde/hasta) y apunta a la ruta de export', async () => {
    const html = await pintar([fila()]);
    expect(html).toContain('action="/api/export/liquidaciones-externas"');
    expect(html).toContain('name="desde"');
    expect(html).toContain('name="hasta"');
  });

  it('el CSV conserva el filtro: estado normal o «no coincide»', async () => {
    expect(await pintar([fila()], { filtro: 'fallida' })).toContain('name="estado" value="fallida"');
    expect(await pintar([fila()], { filtro: 'no_coincide' })).toContain('name="respuestaChofer" value="no_coincide"');
  });

  it('el mensaje de la última acción se muestra, con su tono', async () => {
    const ok = await pintar([fila()], { mensaje: 'reintentada' });
    expect(ok).toContain('la entrega se reintentó');
    const mal = await pintar([fila()], { mensaje: 'no_aplica' });
    expect(mal).toContain('no se mandó otra vez');
  });

  it('leerMensajeExterno / leerFiltroExterno solo aceptan lo conocido (el valor viene de la URL)', () => {
    expect(leerMensajeExterno('reintentada')).toBe('reintentada');
    expect(leerMensajeExterno('<script>')).toBeNull();
    expect(leerMensajeExterno(undefined)).toBeNull();
    expect(leerFiltroExterno('fallida')).toBe('fallida');
    expect(leerFiltroExterno('no_coincide')).toBe('no_coincide');
    expect(leerFiltroExterno('drop table')).toBeNull();
    expect(leerFiltroExterno(undefined)).toBeNull();
  });
});

describe('el formato de la flota (0564)', () => {
  it('enlaza a la pantalla del formato, conservando el contexto', async () => {
    const html = await pintar([fila()]);
    expect(html).toContain('/dashboard/agentes/liquidacion/formato?tenant=flota-1');
    expect(html).toContain('Formato de las liquidaciones');
  });

  it('con formato configurado, las generadas por Likida enseñan «Excel» (apunta al export, con el id)', async () => {
    const html = await pintar([fila()], { formato: { excel: true, copia: false } });
    expect(html).toContain('/api/export/liquidaciones-externas?tenant=flota-1&amp;excel=11111111-1111-4111-8111-111111111111');
    expect(html).not.toContain('Copia al jefe');
  });

  it('el PDF que adjuntó el cliente NO tiene Excel, aunque la flota tenga formato', async () => {
    const html = await pintar([fila({ pdfOrigen: 'adjunto' })], { formato: { excel: true, copia: true } });
    expect(html).not.toContain('excel=');
  });

  it('«Copia al jefe» solo con jefe designado y solo en las que ya salieron (no pendientes ni fallidas)', async () => {
    const html = await pintar([
      fila(), fila({ id: '22222222-2222-4222-8222-222222222222', estado: 'pendiente' }), fila({ id: '33333333-3333-4333-8333-333333333333', estado: 'fallida' }),
    ], { formato: { excel: true, copia: true } });
    expect(html.match(/Copia al jefe/g)).toHaveLength(1); // solo la enviada: ni la pendiente ni la fallida
    const sin = await pintar([fila()], { formato: { excel: true, copia: false } });
    expect(sin).not.toContain('Copia al jefe');
  });

  it('sin poder leer el formato (null) no se pinta ningún enlace de más', async () => {
    const html = await pintar([fila()], { formato: null });
    expect(html).not.toContain('excel=');
    expect(html).not.toContain('Copia al jefe');
  });

  it('los mensajes de la copia se leen de la URL y los desconocidos se ignoran', () => {
    expect(leerMensajeExterno('copia_enviada')).toBe('copia_enviada');
    expect(leerMensajeExterno('copia_fallo')).toBe('copia_fallo');
    expect(leerMensajeExterno('toString')).toBeNull();
    expect(leerMensajeExterno('<script>')).toBeNull();
  });
});

describe('subir el archivo de liquidaciones desde el panel', () => {
  const base = (o: Partial<Parameters<typeof SeccionExternas>[0]>) => SeccionExternas({
    fichas: Promise.resolve(FICHAS),
    pagina: Promise.resolve<PaginaExternas>({ filas: [], hayMas: false, siguiente: null, total: 0 }),
    filtroEstado: null, contexto: [], mensaje: null, puedeReintentar: true, reintentar, ...o,
  });
  it('el control de subida solo sale si el host lo entrega (rol que administra)', async () => {
    expect(renderToStaticMarkup(await base({}))).not.toContain('type="file"');
    const html = renderToStaticMarkup(await base({ subirArchivo: async () => {} }));
    expect(html).toContain('type="file"');
    expect(html).toContain('Subir liquidaciones');
  });
  it('dice cuántas entraron, cuántas ya estaban y cuáles fallaron; el detalle hostil se escapa', async () => {
    const html = renderToStaticMarkup(await base({ mensaje: 'importada', importacion: { conteo: '2.1.1', detalle: 'LQ-3: <script>x</script>' } }));
    expect(html).toContain('2 liquidación(es) recibida(s)');
    expect(html).toContain('1 ya estaban');
    expect(html).toContain('1 con problemas');
    expect(html).not.toContain('<script>x');
  });
  it('un conteo malformado de la URL no se pinta', async () => {
    const html = renderToStaticMarkup(await base({ mensaje: 'importada', importacion: { conteo: '<b>', detalle: undefined } }));
    expect(html).toContain('Archivo procesado.');
    expect(html).not.toContain('<b>');
  });
});

