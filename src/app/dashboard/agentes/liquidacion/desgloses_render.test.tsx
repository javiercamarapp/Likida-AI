import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SeccionDesgloses, destinosDe, cumpleFiltro, leerFiltroDesglose, leerDia, rotuloDestino, ayudaDestino,
  type FilaDesglose, type FichasDesgloses, type LecturaDesgloses, type DesglosesProps,
} from './desgloses';
import type { EntregaCorreo } from '@/lib/likida/liquidacion_externa/repo_correo';

// ═══════════════════════════════════════════════════════════════════════════
// LA LISTA DE DESGLOSES POR CORREO.
//
// Lo que se fija es lo que haría FALSA a la pantalla:
//   · una lista que no se pudo leer enseña su error con reintento, NUNCA «aún no hay desgloses»;
//   · un conteo `null` es «—», no un cero; un cero medido sí es cero;
//   · cada destinatario enseña SU estado (el peor de sus correos, de su última generación);
//   · el error de entrega es una frase que dice qué hacer, sin el correo ni el cuerpo del proveedor;
//   · el vacío honesto dice cuándo llegan los desgloses;
//   · el texto de la sección no menciona el otro canal (sin datos sintéticos de personas reales).
// ═══════════════════════════════════════════════════════════════════════════

const entrega = (p: Partial<EntregaCorreo> = {}): EntregaCorreo => ({
  id: 'e-1', tenantId: 't-1', liquidacionExternaId: 'l-1', generacion: 1, rol: 'operador', correo: 'operador.prueba@ejemplo.test',
  estado: 'entregada', intentos: 1, proximoIntentoEn: '2026-10-01T10:00:00Z', claimToken: null, claimExpiraEn: null, resendId: 'r-1',
  ultimoError: null, disparo: 'auto', xlsxRuta: null, xlsxSha256: null, enviadaEn: '2026-10-01T10:00:00Z', entregadaEn: '2026-10-01T10:01:00Z',
  rebotadaEn: null, creadaEn: '2026-10-01T09:59:00Z', ...p,
});

const fila = (p: Partial<FilaDesglose> = {}): FilaDesglose => ({
  liquidacionId: 'l-1', bitacora: 'BIT-1001', operador: 'Operador Sintético Uno', periodoDesde: '2026-09-28', periodoHasta: '2026-10-04',
  neto: 3120.5, moneda: 'MXN', terminal: 'Terminal Norte',
  destinos: destinosDe([entrega(), entrega({ rol: 'coordinador', correo: 'coord.prueba@ejemplo.test' }), entrega({ rol: 'rh', correo: 'rh.prueba@ejemplo.test' })], null),
  ...p,
});

const FICHAS: FichasDesgloses = { recibidosHoy: 4, enviados: 2, entregados: 9, rebotados: 1, retenidos: 1, sinPoliza: 3 };

const pintar = async (lectura: LecturaDesgloses, o: Partial<Omit<DesglosesProps, 'lectura'>> = {}) =>
  renderToStaticMarkup(await SeccionDesgloses({
    lectura: Promise.resolve(lectura), filtro: null, desde: null, hasta: null, contexto: [['tenant', 'flota-1']], ...o,
  }));

const ok = (filas: FilaDesglose[], o: Partial<Extract<LecturaDesgloses, { ok: true }>> = {}): LecturaDesgloses =>
  ({ ok: true, fichas: FICHAS, filas, sinPoliza: [], siguiente: null, ...o });

describe('estados vacíos honestos', () => {
  it('sin desgloses dice cuándo llegan, no un cero mudo', async () => {
    const html = await pintar(ok([]));
    expect(html).toContain('Aún no hay desgloses: llegan cuando una bitácora tiene póliza');
    expect(html).not.toContain('<table');
  });

  it('con un filtro puesto, el vacío habla del filtro (no de que no haya desgloses)', async () => {
    const html = await pintar(ok([]), { filtro: 'rebotado' });
    expect(html).toContain('Ningún desglose cae en ese filtro');
    expect(html).not.toContain('Aún no hay desgloses');
  });

  it('el filtro «sin póliza» lista las bitácoras que esperan y dice qué hacer', async () => {
    const html = await pintar(ok([], { sinPoliza: [{ bitacora: 'BIT-77', desde: '2026-10-01T10:00:00Z', ultimaVez: '2026-10-02T10:00:00Z' }] }), { filtro: 'sin_poliza' });
    expect(html).toContain('BIT-77');
    expect(html).toContain('no se enviarán hasta tener póliza');
  });

  it('«sin póliza» sin nada pendiente lo dice', async () => {
    expect(await pintar(ok([]), { filtro: 'sin_poliza' })).toContain('Ninguna bitácora está esperando póliza');
  });
});

describe('lectura caída: tarjeta de error con reintento, nunca un vacío', () => {
  it('pinta el error y un enlace de reintento que conserva el filtro', async () => {
    const html = await pintar({ ok: false }, { filtro: 'entregado', desde: '2026-10-01' });
    expect(html).toContain('No se pudieron leer los desgloses');
    expect(html).toContain('Reintentar');
    expect(html).toContain('des_estado=entregado');
    expect(html).toContain('des_desde=2026-10-01');
    expect(html).not.toContain('Aún no hay desgloses');
    expect(html).not.toContain('<table');
  });
});

describe('tres estados mezclados', () => {
  const entregado = fila();
  const rebotado = fila({
    liquidacionId: 'l-2', bitacora: 'BIT-1002',
    destinos: destinosDe([
      entrega({ liquidacionExternaId: 'l-2', estado: 'rebotada', rebotadaEn: '2026-10-02T11:00:00Z', entregadaEn: null }),
      entrega({ liquidacionExternaId: 'l-2', rol: 'coordinador', estado: 'enviada', entregadaEn: null }),
    ], null),
  });
  const retenido = fila({ liquidacionId: 'l-3', bitacora: 'BIT-1003', neto: -50, destinos: destinosDe([], 'neto negativo: -50.00') });

  it('cada destinatario enseña su estado con el rótulo del cliente', async () => {
    const html = await pintar(ok([entregado, rebotado, retenido]));
    for (const t of ['BIT-1001', 'BIT-1002', 'BIT-1003', 'Entregado', 'Enviado', 'No se pudo entregar', 'Retenido: neto negativo']) expect(html).toContain(t);
  });

  it('el rebote dice qué hacer, con el rol correcto, y no filtra el correo', async () => {
    const html = await pintar(ok([rebotado]));
    expect(html).toContain('El correo del operador rebotó: corrígelo y reenvía.');
    expect(html).not.toContain('ejemplo.test');
  });

  it('un operador sin correo registrado lo dice llano', async () => {
    const html = await pintar(ok([fila({ destinos: destinosDe([], null) })]));
    expect(html).toContain('Sin correo');
    expect(html).toContain('no tiene correo registrado');
  });

  it('el neto lleva su moneda y un neto desconocido es «—», no cero', async () => {
    const html = await pintar(ok([entregado, fila({ liquidacionId: 'l-4', bitacora: 'BIT-1004', neto: null, operador: null })]));
    expect(html).toContain('$3,120.50 MXN');
    expect(html).not.toContain('$0.00');
  });

  it('un texto hostil se escapa', async () => {
    const html = await pintar(ok([fila({ bitacora: '<img src=x onerror=1>' })]));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('pagina por cursor y conserva filtros y contexto', async () => {
    const html = await pintar(ok([entregado], { siguiente: 'CURSOROPACOabcdefghij' }), { filtro: 'entregado', hasta: '2026-10-05' });
    expect(html).toContain('des_cursor=CURSOROPACOabcdefghij');
    expect(html).toContain('des_estado=entregado');
    expect(html).toContain('des_hasta=2026-10-05');
    expect(html).toContain('tenant=flota-1');
  });

  it('sin siguiente no hay navegación', async () => {
    expect(await pintar(ok([entregado]))).not.toContain('Paginación');
  });
});

describe('las fichas', () => {
  it('con números de verdad los pinta, con los seis rótulos', async () => {
    const html = await pintar(ok([fila()]));
    for (const t of ['Recibidos hoy', 'Enviados', 'Entregados', 'Rebotados', 'Retenidos', 'Sin póliza']) expect(html).toContain(t);
  });

  it('un conteo `null` es «—» con su leyenda, no un cero', async () => {
    const nulos: FichasDesgloses = { recibidosHoy: null, enviados: null, entregados: null, rebotados: null, retenidos: null, sinPoliza: null };
    const html = await pintar(ok([fila()], { fichas: nulos }));
    expect(html).toContain('—');
    expect(html).toContain('no se pudo contar');
    expect(html).not.toMatch(/>0</);
  });

  it('un cero medido sí es cero', async () => {
    const ceros: FichasDesgloses = { recibidosHoy: 0, enviados: 0, entregados: 0, rebotados: 0, retenidos: 0, sinPoliza: 0 };
    const html = await pintar(ok([]), { });
    expect(html).toBeTruthy();
    const conCeros = await pintar(ok([fila()], { fichas: ceros }));
    expect(conCeros).toContain('>0<');
    expect(conCeros).not.toContain('no se pudo contar');
  });
});

describe('el texto de la sección', () => {
  it('no menciona el otro canal en ningún estado de la pantalla', async () => {
    const htmls = [
      await pintar(ok([fila()])), await pintar(ok([])), await pintar({ ok: false }),
      await pintar(ok([], { sinPoliza: [{ bitacora: 'B', desde: '2026-10-01T10:00:00Z', ultimaVez: '2026-10-01T10:00:00Z' }] }), { filtro: 'sin_poliza' }),
    ];
    for (const h of htmls) expect(h).not.toMatch(/whatsapp|wa_|plantilla meta/i);
  });
});

describe('destinosDe: el estado de cada destinatario', () => {
  it('la generación más alta reemplaza a la anterior', () => {
    const d = destinosDe([entrega({ generacion: 1, estado: 'rebotada' }), entrega({ id: 'e-2', generacion: 2, estado: 'entregada' })], null);
    expect(d.operador.estado).toBe('entregado');
  });

  it('con varios correos en un rol manda el peor (RH con dos correos)', () => {
    const d = destinosDe([
      entrega({ rol: 'rh', estado: 'entregada' }),
      entrega({ id: 'e-2', rol: 'rh', correo: 'rh2.prueba@ejemplo.test', estado: 'fallida' }),
    ], null);
    expect(d.rh.estado).toBe('no_entregado');
  });

  it('una queja cuenta como no entregado y pendiente/enviando como por enviar', () => {
    expect(destinosDe([entrega({ estado: 'queja' })], null).operador.estado).toBe('no_entregado');
    expect(destinosDe([entrega({ estado: 'enviando' })], null).operador.estado).toBe('pendiente');
  });

  it('retenido por neto negativo vs retenido por otra regla', () => {
    expect(destinosDe([], 'Neto negativo')).toMatchObject({ operador: { estado: 'retenido', retenidoPor: 'neto' } });
    expect(destinosDe([], 'tipo sin regla')).toMatchObject({ rh: { estado: 'retenido', retenidoPor: 'revision' } });
    expect(rotuloDestino(destinosDe([], 'neto').operador).rotulo).toBe('Retenido: neto negativo');
  });

  it('el rol archivo no se muestra y la ausencia de coordinador/RH no inventa un estado', () => {
    const d = destinosDe([entrega({ rol: 'archivo' })], null);
    expect(d.coordinador.estado).toBe('sin_dato');
    expect(rotuloDestino(d.coordinador).rotulo).toBe('—');
    expect(ayudaDestino('coordinador', d.coordinador)).toBeNull();
  });

  it('el filtro mira a los tres destinatarios', () => {
    const d = destinosDe([entrega({ rol: 'coordinador', estado: 'rebotada' })], null);
    expect(cumpleFiltro(d, 'rebotado')).toBe(true);
    expect(cumpleFiltro(d, 'retenido')).toBe(false);
    expect(cumpleFiltro(d, null)).toBe(true);
    expect(cumpleFiltro(d, 'sin_poliza')).toBe(false);
  });
});

describe('lo que viene de la URL se valida', () => {
  it('filtro de estado: solo los conocidos', () => {
    expect(leerFiltroDesglose('rebotado')).toBe('rebotado');
    expect(leerFiltroDesglose('sin_poliza')).toBe('sin_poliza');
    expect(leerFiltroDesglose('x; drop')).toBeNull();
    expect(leerFiltroDesglose(undefined)).toBeNull();
  });

  it('días: solo AAAA-MM-DD reales', () => {
    expect(leerDia('2026-10-05')).toBe('2026-10-05');
    expect(leerDia('2026-02-30')).toBeNull();
    expect(leerDia('05/10/2026')).toBeNull();
    expect(leerDia(undefined)).toBeNull();
  });
});
