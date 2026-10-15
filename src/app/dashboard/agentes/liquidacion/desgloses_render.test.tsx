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

// ═══════════════════════════════════════════════════════════════════════════
// EL DETALLE DE UNA BITÁCORA, LA DESCARGA, EL REENVÍO Y LAS EXCEPCIONES (T-A1-29).
//
// Lo que se fija:
//   · el detalle enseña los dos bloques, los cuatro destinos con su estado (el correo enmascarado) y el historial de envíos;
//   · un envío en curso deshabilita reenviar (y lo dice); un desglose retenido no se reenvía: se libera;
//   · «Liberar envío» solo aparece si la retención la puede decidir una persona;
//   · el resultado de una acción es un CÓDIGO de la URL con texto de la pantalla: un texto inventado no se pinta;
//   · una lectura caída del detalle es una tarjeta de error, no un «no existe»;
//   · ningún texto de la sección menciona el otro canal.
// ═══════════════════════════════════════════════════════════════════════════
import {
  PanelDetalleDesglose, SeccionExcepciones, leerMensajeDesglose, type PanelDetalleProps,
} from './desgloses';
import { armarDetalle, enmascararCorreo, nombreDescarga, leerIdDetalle, type DetalleDesglose, type LecturaDetalle } from './detalle_desglose';
import type { Desglose, Excepcion } from '@/lib/likida/liquidacion_externa/repo_correo';
import type { LiquidacionExterna } from '@/lib/likida/liquidacion_externa/repo';
import type { MotivoRechazo } from '@/lib/likida/liquidacion_externa/reenvio_correo';
import type { MotivoRechazoLiberar } from '@/lib/likida/liquidacion_externa/liberar_envio';

const LIQ_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const liquidacion = (): LiquidacionExterna => ({
  id: LIQ_ID, tenantId: 't-1', claveExterna: 'T1-BIT-1001', huella: 'h'.repeat(64), operadorNombre: 'Operador Sintético Uno', periodoDesde: '2026-09-28',
  periodoHasta: '2026-10-04', total: 2600, moneda: 'MXN',
  conceptos: [
    { clave: null, descripcion: 'Sueldo base', tipo: 'percepcion', monto: 3000 },
    { clave: null, descripcion: 'Taxi aeropuerto', tipo: 'percepcion', monto: 200 },
    { clave: null, descripcion: 'Anticipo', tipo: 'deduccion', monto: 600 },
  ],
} as unknown as LiquidacionExterna);

const cabecera = (retenidaMotivo: string | null = null): Desglose => ({
  liquidacionExternaId: LIQ_ID, bitacora: 'BIT-1001', terminal: 'Terminal Norte', poliza: 'P-1', unidad: '526', tipoOperador: 'foraneo', dias: 7,
  totalOrigen: 'tms', enviadoOrigenEn: null, retenidaMotivo, creadoEn: '2026-10-01T09:00:00Z',
});

const ex = (tipo: Excepcion['tipo'], id = 1, detalle: Record<string, unknown> = {}): Excepcion => ({
  id, claveExterna: 'T1-BIT-1001', tipo, detalle, primeraVez: '2026-10-01T09:00:00Z', ultimaVez: '2026-10-02T09:00:00Z', resueltaEn: null,
});

const cuatro = () => [
  entrega({ liquidacionExternaId: LIQ_ID }),
  entrega({ liquidacionExternaId: LIQ_ID, id: 'e-2', rol: 'coordinador', correo: 'coord.prueba@ejemplo.test', estado: 'enviada', entregadaEn: null }),
  entrega({ liquidacionExternaId: LIQ_ID, id: 'e-3', rol: 'rh', correo: 'rh.prueba@ejemplo.test', estado: 'rebotada', rebotadaEn: '2026-10-01T11:00:00Z', entregadaEn: null }),
  entrega({ liquidacionExternaId: LIQ_ID, id: 'e-4', rol: 'archivo', correo: 'archivo.prueba@ejemplo.test' }),
];

const detalleDe = (o: Partial<Parameters<typeof armarDetalle>[0]> = {}): DetalleDesglose =>
  armarDetalle({ liq: liquidacion(), desglose: cabecera(), entregas: cuatro(), excepciones: [], descargaUrl: 'https://firmada.test/x.xlsx?token=abc', ...o });

const accionesNulas = { reenviar: async () => {}, liberar: async () => {} };

const panel = async (lectura: LecturaDetalle, o: Partial<PanelDetalleProps> = {}) =>
  renderToStaticMarkup(await PanelDetalleDesglose({
    lectura: Promise.resolve(lectura), acciones: accionesNulas, mensaje: null, contexto: [['tenant', 'flota-1']], params: [['des_estado', 'rebotado']], ...o,
  }));

describe('detalle de una bitácora', () => {
  it('muestra los dos bloques de la liquidación y el neto de la fuente', async () => {
    const html = await panel({ estado: 'ok', detalle: detalleDe() });
    for (const t of ['Percepciones', 'Deducciones', 'Sueldo base', 'Taxi aeropuerto', 'Anticipo', '$3,000.00 MXN', '$600.00 MXN', '$2,600.00 MXN', 'Bitácora BIT-1001']) {
      expect(html).toContain(t);
    }
  });

  it('muestra los 4 destinos con su estado, el correo enmascarado y la hora', async () => {
    const html = await panel({ estado: 'ok', detalle: detalleDe() });
    for (const t of ['Operador', 'Coordinador', 'RH', 'Archivo', 'Entregado', 'Enviado', 'No se pudo entregar']) expect(html).toContain(t);
    expect(html).toContain('op***@ejemplo.test');
    expect(html).toContain('rh***@ejemplo.test');
    expect(html).not.toContain('operador.prueba@ejemplo.test');
    expect(html).not.toContain('rh.prueba@ejemplo.test');
  });

  it('el historial cuenta cada envío y de dónde nació', async () => {
    const detalle = detalleDe({ entregas: [...cuatro(), entrega({ id: 'e-5', generacion: 2, disparo: 'reclamo', creadaEn: '2026-10-03T10:00:00Z' })] });
    expect(detalle.generaciones.map((g) => [g.generacion, g.origen, g.entregas])).toEqual([[2, 'reclamo', 1], [1, 'auto', 4]]);
    const html = await panel({ estado: 'ok', detalle });
    expect(html).toContain('Envío 2');
    expect(html).toContain('Reclamo del operador');
    expect(html).toContain('Envío automático');
    expect(html).toContain('4 correos');
  });

  it('una reposición reemplaza a la anterior para ese correo: manda la última generación', () => {
    const d = detalleDe({ entregas: [entrega({ estado: 'rebotada', rebotadaEn: '2026-10-01T11:00:00Z', entregadaEn: null }), entrega({ id: 'e-9', generacion: 2, estado: 'entregada' })] });
    const op = d.destinatarios.filter((x) => x.rol === 'operador');
    expect(op).toHaveLength(1);
    expect(op[0]!.destino.estado).toBe('entregado');
  });

  it('descarga: enlace con el nombre desglose-<bitácora>.xlsx y su vigencia', async () => {
    const html = await panel({ estado: 'ok', detalle: detalleDe() });
    expect(html).toContain('href="https://firmada.test/x.xlsx?token=abc"');
    expect(html).toContain('download="desglose-BIT-1001.xlsx"');
    expect(html).toContain('24 horas');
  });

  it('sin URL firmada lo dice (el detalle sigue) en vez de un enlace roto', async () => {
    const html = await panel({ estado: 'ok', detalle: detalleDe({ descargaUrl: null }) });
    expect(html).toContain('No se pudo preparar la descarga');
    expect(html).not.toContain('Descargar el Excel');
    expect(html).toContain('Sueldo base');
  });

  it('un nombre de bitácora hostil no rompe el nombre del archivo', () => {
    expect(nombreDescarga('../../etc/passwd')).toBe('desglose-.._.._etc_passwd.xlsx');
    expect(nombreDescarga('a b/c"d')).toBe('desglose-a_b_c_d.xlsx');
    expect(nombreDescarga('///')).toBe('desglose-bitacora.xlsx');
  });
});

describe('reenviar', () => {
  it('ofrece operador, coordinador y todos con confirmación que dice a quién', async () => {
    const html = await panel({ estado: 'ok', detalle: detalleDe() });
    for (const t of ['Reenviar al operador', 'Reenviar al coordinador', 'Reenviar a todos', 'Queda registrado quién lo pidió', 'al operador, a su coordinador y a RH']) expect(html).toContain(t);
    expect(html).toContain('name="a" value="todos"');
    expect(html).not.toContain('Hay un envío en curso');
  });

  it('con un envío en curso el botón de ese rol está deshabilitado y la pantalla lo explica', async () => {
    const d = detalleDe({ entregas: [entrega({ rol: 'operador', estado: 'enviando' }), entrega({ id: 'e-2', rol: 'coordinador', correo: 'coord.prueba@ejemplo.test' })] });
    expect(d.enCurso).toEqual({ operador: true, coordinador: false, rh: false });
    const html = await panel({ estado: 'ok', detalle: d });
    expect(html).toContain('Hay un envío en curso: espera a que termine');
    const boton = (etiqueta: string) => html.match(new RegExp(`<button[^>]*>${etiqueta}</button>`))?.[0] ?? '';
    expect(boton('Reenviar al operador')).toContain('disabled=""');
    expect(boton('Reenviar a todos')).toContain('disabled=""');
    expect(boton('Reenviar al coordinador')).not.toContain('disabled=""');
  });

  it('el formulario de corregir el correo trae el campo, el motivo y avisa que se guarda en la ficha', async () => {
    const html = await panel({ estado: 'ok', detalle: detalleDe() });
    expect(html).toContain('name="correo_nuevo"');
    expect(html).toContain('type="email"');
    expect(html).toContain('name="motivo" value="correccion_de_correo"');
    expect(html).toContain('Corregir correo del operador y reenviar');
  });

  it('un desglose retenido no se reenvía: los botones están deshabilitados y dice por qué', async () => {
    const d = detalleDe({ desglose: cabecera('neto negativo: -50.00'), entregas: [], excepciones: [ex('neto_negativo')] });
    const html = await panel({ estado: 'ok', detalle: d });
    expect(html).toContain('primero libera el envío');
    expect(html.match(/<button[^>]*>Reenviar al operador<\/button>/)?.[0]).toContain('disabled=""');
  });
});

describe('excepciones y liberar el envío', () => {
  it('neto negativo: «Liberar envío» con confirmación y la explicación', async () => {
    const d = detalleDe({ desglose: cabecera('neto negativo: -50.00'), entregas: [], excepciones: [ex('neto_negativo')] });
    expect(d.retenido).toEqual({ por: 'neto', liberable: true });
    const html = await panel({ estado: 'ok', detalle: d });
    for (const t of ['Retenido: neto negativo', 'Este desglose no se ha enviado a nadie', 'Liberar envío', 'Queda registrado quién lo liberó']) expect(html).toContain(t);
    expect(html).toContain('Aún no se manda a nadie');
  });

  it('un concepto prohibido NO se libera desde la pantalla', async () => {
    const d = detalleDe({ desglose: cabecera('concepto prohibido'), entregas: [], excepciones: [ex('concepto_prohibido')] });
    expect(d.retenido).toEqual({ por: 'revision', liberable: false });
    const html = await panel({ estado: 'ok', detalle: d });
    expect(html).not.toContain('Liberar envío');
    expect(html).toContain('no se libera desde aquí');
  });

  it('lista las excepciones de la bitácora con una instrucción llana', async () => {
    const html = await panel({ estado: 'ok', detalle: detalleDe({ excepciones: [ex('operador_sin_correo', 1), ex('correccion_pendiente', 2)] }) });
    expect(html).toContain('Operador sin correo');
    expect(html).toContain('Corrección pendiente');
    expect(html).toContain('una persona decide si se manda la corrección');
  });

  it('una excepción ya resuelta no se enseña', () => {
    const d = detalleDe({ excepciones: [{ ...ex('sin_poliza'), resueltaEn: '2026-10-03T00:00:00Z' }] });
    expect(d.excepciones).toEqual([]);
  });

  it('sin excepciones lo dice', async () => {
    expect(await panel({ estado: 'ok', detalle: detalleDe() })).toContain('Sin excepciones abiertas para esta bitácora');
  });
});

describe('estados del panel', () => {
  it('lectura caída ⇒ tarjeta de error con reintento (no «no existe»)', async () => {
    const html = await panel({ estado: 'error' });
    expect(html).toContain('No se pudo leer este desglose');
    expect(html).toContain('Reintentar');
    expect(html).not.toContain('No encontré');
  });

  it('id que no es de la flota ⇒ «no lo encontré»', async () => {
    expect(await panel({ estado: 'no_encontrado' })).toContain('No encontré ese desglose en tu flota');
  });

  it('«Cerrar» conserva el filtro y el contexto', async () => {
    const html = await panel({ estado: 'ok', detalle: detalleDe() });
    expect(html).toMatch(/href="\?tenant=flota-1&amp;des_estado=rebotado#desgloses"[^>]*>Cerrar/);
  });

  it('el mensaje de la última acción se pinta; uno inventado en la URL, no', async () => {
    const ok = await panel({ estado: 'ok', detalle: detalleDe() }, { mensaje: leerMensajeDesglose('reenvio_ok') });
    expect(ok).toContain('el desglose quedó en la cola');
    expect(leerMensajeDesglose('<script>alert(1)</script>')).toBeNull();
    expect(leerMensajeDesglose('constructor')).toBeNull();
    expect(leerMensajeDesglose('__proto__')).toBeNull();
    expect(leerMensajeDesglose(undefined)).toBeNull();
  });

  it('un correo nuevo inválido y cualquier rechazo de la librería tienen mensaje llano', () => {
    expect(leerMensajeDesglose('r_correo_invalido')?.texto).toContain('no parece un correo');
    const motivosReenvio = ['sin_permiso', 'no_encontrada', 'correo_invalido', 'correo_nuevo_no_aplica', 'en_curso', 'limite_diario', 'sin_destinatarios', 'sin_archivo', 'no_disponible'] satisfies MotivoRechazo[];
    const motivosLiberar = ['sin_permiso', 'no_encontrada', 'no_retenida', 'no_liberable', 'sin_destinatarios', 'no_disponible'] satisfies MotivoRechazoLiberar[];
    for (const m of new Set([...motivosReenvio, ...motivosLiberar])) {
      expect(leerMensajeDesglose(`r_${m}`), m).not.toBeNull();
      expect(leerMensajeDesglose(`r_${m}`)!.tono).toBe('bad');
    }
  });

  it('el id del detalle en la URL se valida como uuid', () => {
    expect(leerIdDetalle(LIQ_ID.toUpperCase())).toBe(LIQ_ID);
    expect(leerIdDetalle('1; drop table')).toBeNull();
    expect(leerIdDetalle(undefined)).toBeNull();
  });

  it('enmascarar un correo no filtra la parte local', () => {
    expect(enmascararCorreo('ana.prueba@ejemplo.test')).toBe('an***@ejemplo.test');
    expect(enmascararCorreo('x@ejemplo.test')).toBe('x***@ejemplo.test');
    expect(enmascararCorreo('sin-arroba')).toBe('***');
  });

  it('texto hostil de la bitácora y del operador se escapa', async () => {
    const d = detalleDe({ desglose: { ...cabecera(), bitacora: '<img src=x onerror=1>' } });
    const html = await panel({ estado: 'ok', detalle: d });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('sección de excepciones de la flota', () => {
  const pintarEx = async (excepciones: Excepcion[] | null) =>
    renderToStaticMarkup(await SeccionExcepciones({ excepciones: Promise.resolve(excepciones), contexto: [['tenant', 'flota-1']] }));

  it('lista cada excepción con su bitácora y qué hacer', async () => {
    const html = await pintarEx([ex('sin_poliza', 1, { bitacora: 'BIT-77' }), ex('operador_no_encontrado', 2, { bitacora: 'BIT-78' }), ex('neto_negativo', 3)]);
    for (const t of ['Sin póliza', 'bitácora BIT-77', 'Operador sin alta', 'bitácora BIT-78', 'Retenido: neto negativo', 'bitácora T1-BIT-1001']) expect(html).toContain(t);
  });

  it('sin excepciones lo dice', async () => {
    expect(await pintarEx([])).toContain('Sin excepciones abiertas.');
  });

  it('lectura caída ⇒ error con reintento, jamás «sin excepciones»', async () => {
    const html = await pintarEx(null);
    expect(html).toContain('No se pudieron leer las excepciones');
    expect(html).toContain('Reintentar');
    expect(html).not.toContain('Sin excepciones abiertas');
  });
});

describe('la lista enlaza a su detalle y el texto no habla del otro canal', () => {
  it('cada fila trae «Ver detalle» con el id y conserva filtros', async () => {
    const html = renderToStaticMarkup(await SeccionDesgloses({
      lectura: Promise.resolve({ ok: true, fichas: FICHAS, filas: [fila({ liquidacionId: LIQ_ID })], sinPoliza: [], siguiente: null }),
      filtro: 'entregado', desde: null, hasta: null, contexto: [['tenant', 'flota-1']],
    }));
    expect(html).toContain(`des_det=${LIQ_ID}`);
    expect(html).toContain('des_estado=entregado');
    expect(html).toContain('#detalle-desglose');
  });

  it('ni el panel ni las excepciones mencionan WhatsApp, plantillas ni botones del otro canal', async () => {
    const d = detalleDe({ desglose: cabecera('neto negativo'), entregas: [], excepciones: [ex('neto_negativo'), ex('sin_poliza', 2), ex('correccion_pendiente', 3)] });
    const html = (await panel({ estado: 'ok', detalle: d })) + renderToStaticMarkup(await SeccionExcepciones({ excepciones: Promise.resolve([ex('sin_poliza')]), contexto: [] }));
    expect(html).not.toMatch(/whatsapp|wa_|plantilla meta/i);
  });
});
