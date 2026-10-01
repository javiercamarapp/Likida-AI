import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import {
  BloqueEstadoYKpis, BloqueAprobacion, BloqueExcepciones, BloqueConversaciones, BloqueConfiguracion, BloqueBitacora, BloqueContactos,
  minutosDeEspera, duracion, motivosDeExcepcion, type AccionesVigia,
} from './vista';
import type { DatosTablero, ConversacionTablero } from '@/lib/likida/vigia/repo';
import { configApagada } from '@/lib/likida/vigia/tipos';

// ═══════════════════════════════════════════════════════════════════════════
// El tablero del Vigía dice la VERDAD: «—/sin datos» donde no hay medición, el
// teléfono completo nunca se pinta, el contador no ve botones, y cada excepción
// (molesto, sin respuesta, escalada) se nombra con su causa.
// `renderToStaticMarkup` no monta <Bloque> (Suspense de servidor): se llaman las
// piezas async directamente con la promesa ya resuelta (mismo patrón que Conductores).
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = Date.parse('2026-10-01T18:00:00Z');
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
const noop = (async () => null) as AccionesVigia['decidir'];
const acciones: AccionesVigia = { decidir: noop, conversacion: noop, config: noop, alta: noop, contacto: noop };

const conv = (extra: Partial<ConversacionTablero> = {}): ConversacionTablero => ({
  id: '11111111-1111-4111-8111-111111111111', contactoId: 'ct', contactoNombre: 'María Pérez', clienteNombre: 'Compras Acme', control: 'agente',
  sinRespuestaDesde: null, molestiaNivel: 0, molestiaMotivos: [], escalamientoNivel: 0, atendida: false, ultimaEntradaEn: hace(5),
  ultimoMensajeCliente: '¿Dónde va mi viaje?', ...extra,
});

const base = (extra: Partial<DatosTablero> = {}): DatosTablero => ({
  config: { ...configApagada('t1'), habilitado: true },
  conversaciones: [], pendientes: [], fallidos: [], contactos: [], eventos: [],
  respuesta: { muestra: 0, promedioMin: null, medianaMin: null }, clientes: [{ id: 'c1', nombre: 'Compras Acme' }], gerentes: [],
  ...extra,
});

async function pintar(el: Promise<ReactElement>): Promise<string> {
  return renderToStaticMarkup(await el);
}

describe('helpers puros', () => {
  it('minutosDeEspera: enteros, 0 sin espera o con fecha basura', () => {
    expect(minutosDeEspera(hace(47), AHORA)).toBe(47);
    expect(minutosDeEspera(null, AHORA)).toBe(0);
    expect(minutosDeEspera('basura', AHORA)).toBe(0);
  });
  it('duracion: minutos, horas y horas con minutos', () => {
    expect(duracion(45)).toBe('45 min');
    expect(duracion(120)).toBe('2 h');
    expect(duracion(135)).toBe('2 h 15 min');
  });
  it('motivosDeExcepcion nombra cada causa; una conversación sana no es excepción', () => {
    expect(motivosDeExcepcion(conv(), 30, AHORA)).toEqual([]);
    expect(motivosDeExcepcion(conv({ molestiaNivel: 2 }), 30, AHORA)).toEqual(['Molesto']);
    expect(motivosDeExcepcion(conv({ molestiaNivel: 3 }), 30, AHORA)).toEqual(['Muy molesto']);
    expect(motivosDeExcepcion(conv({ sinRespuestaDesde: hace(29) }), 30, AHORA)).toEqual([]);
    expect(motivosDeExcepcion(conv({ sinRespuestaDesde: hace(75) }), 30, AHORA)).toEqual(['Sin respuesta 1 h 15 min']);
    expect(motivosDeExcepcion(conv({ escalamientoNivel: 2, molestiaNivel: 2, sinRespuestaDesde: hace(40) }), 30, AHORA))
      .toEqual(['Molesto', 'Sin respuesta 40 min', 'Escalada a nivel 2']);
  });
});

describe('estado y KPIs', () => {
  it('apagado: lo dice (y que nadie recibe respuesta), no pinta un panel «normal»', async () => {
    const html = await pintar(BloqueEstadoYKpis({ datos: Promise.resolve(base({ config: configApagada('t1') })), ahoraMs: AHORA }));
    expect(html).toContain('El Vigía está apagado para tu flota');
  });
  it('sin respuestas medidas: «sin datos todavía», NUNCA un 0 min que parezca medición', async () => {
    const html = await pintar(BloqueEstadoYKpis({ datos: Promise.resolve(base()), ahoraMs: AHORA }));
    expect(html).toContain('sin datos todavía');
    expect(html).not.toContain('mediana 0');
  });
  it('con muestra: mediana, promedio y de cuántas respuestas salen', async () => {
    const html = await pintar(BloqueEstadoYKpis({ datos: Promise.resolve(base({ respuesta: { muestra: 12, promedioMin: 25, medianaMin: 70 } })), ahoraMs: AHORA }));
    expect(html).toContain('mediana 1 h 10 min');
    expect(html).toContain('promedio 25 min');
    expect(html).toContain('últimas 12 respuestas enviadas (7 días)');
  });
  it('cuenta activas, por aprobar, vencidas contra el SLA de la flota y molestas/escaladas', async () => {
    const d = base({
      conversaciones: [conv(), conv({ id: '2' }), conv({ id: '3', sinRespuestaDesde: hace(31) }), conv({ id: '4', molestiaNivel: 2 }), conv({ id: '5', escalamientoNivel: 1 })],
      pendientes: [{ id: 'p', conversacionId: '1', clienteNombre: 'x', mensajeCliente: 'm', borrador: 'b', intencion: 'eta', riesgo: 'bajo', senales: [], creadoEn: hace(1) }],
    });
    const html = await pintar(BloqueEstadoYKpis({ datos: Promise.resolve(d), ahoraMs: AHORA }));
    expect(html).toContain('Sin respuesta (SLA 30 min)');
    // activas 5, por aprobar 1, vencidas 1, molestas/escaladas 2
    const cifras = [...html.matchAll(/cifra-mono text-\[20px\] font-medium mt-1"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(cifras).toEqual(['5', '1', '1', '2']);
  });
});

describe('cola de aprobación', () => {
  const pend = { id: '22222222-2222-4222-8222-222222222222', conversacionId: '1', clienteNombre: 'Compras Acme', mensajeCliente: '¿A qué hora llega?',
    borrador: 'Todavía no tengo registrada una hora estimada.', intencion: 'eta' as const, riesgo: 'medio' as const, senales: ['inyeccion', 'folio_ajeno'], creadoEn: hace(2) };

  it('vacía: lo dice', async () => {
    expect(await pintar(BloqueAprobacion({ datos: Promise.resolve(base()), puedeDecidir: true, acciones }))).toContain('Nada por aprobar');
  });
  it('muestra el mensaje del cliente, el borrador editable, el riesgo y las señales', async () => {
    const html = await pintar(BloqueAprobacion({ datos: Promise.resolve(base({ pendientes: [pend] })), puedeDecidir: true, acciones }));
    expect(html).toContain('¿A qué hora llega?');
    expect(html).toContain('Todavía no tengo registrada una hora estimada.');
    expect(html).toContain('A qué hora llega');
    expect(html).toContain('Riesgo medio');
    expect(html).toContain('Mensaje con instrucciones raras');
    expect(html).toContain('Preguntó por un folio que no es suyo');
    expect(html).toContain('value="aprobar"');
    expect(html).toContain('value="rechazar"');
    expect(html).toContain('value="tomar"');
    expect(html).toContain(pend.id);
  });
  it('quien solo mira (contador) ve el texto pero NO los botones de enviar', async () => {
    const html = await pintar(BloqueAprobacion({ datos: Promise.resolve(base({ pendientes: [pend] })), puedeDecidir: false, acciones }));
    expect(html).toContain('Todavía no tengo registrada una hora estimada.');
    expect(html).not.toContain('value="aprobar"');
    expect(html).not.toContain('<textarea');
  });
  it('un mensaje de un archivo sin texto lo dice', async () => {
    const html = await pintar(BloqueAprobacion({ datos: Promise.resolve(base({ pendientes: [{ ...pend, mensajeCliente: null }] })), puedeDecidir: true, acciones }));
    expect(html).toContain('archivo o mensaje sin texto');
  });
});

describe('excepciones', () => {
  it('sin ninguna: lo dice', async () => {
    expect(await pintar(BloqueExcepciones({ datos: Promise.resolve(base({ conversaciones: [conv()] })), ahoraMs: AHORA, puedeDecidir: true, acciones }))).toContain('Sin excepciones');
  });
  it('lista molestos, sin respuesta, escaladas y envíos fallidos; ofrece «Yo me encargo»', async () => {
    const d = base({
      conversaciones: [conv({ molestiaNivel: 3, sinRespuestaDesde: hace(90), escalamientoNivel: 2 })],
      fallidos: [{ id: 'f', conversacionId: '1', clienteNombre: 'Otro Cliente', error: 'número inválido', creadoEn: hace(10) }],
    });
    const html = await pintar(BloqueExcepciones({ datos: Promise.resolve(d), ahoraMs: AHORA, puedeDecidir: true, acciones }));
    expect(html).toContain('Muy molesto');
    expect(html).toContain('Sin respuesta 1 h 30 min');
    expect(html).toContain('Escalada a nivel 2');
    expect(html).toContain('Falló un envío');
    expect(html).toContain('número inválido');
    expect(html).toContain('Yo me encargo');
  });
  it('un hilo ya tomado por una persona no ofrece volver a tomarlo', async () => {
    const d = base({ conversaciones: [conv({ control: 'humano', molestiaNivel: 2, atendida: true })] });
    const html = await pintar(BloqueExcepciones({ datos: Promise.resolve(d), ahoraMs: AHORA, puedeDecidir: true, acciones }));
    expect(html).toContain('Atendida');
    expect(html).not.toContain('Yo me encargo');
  });
});

describe('conversaciones activas y toma de control', () => {
  it('el hilo del Vigía ofrece «Yo me encargo»; el de una persona ofrece responder y devolver', async () => {
    const d = base({ conversaciones: [conv(), conv({ id: '33333333-3333-4333-8333-333333333333', control: 'humano' })] });
    const html = await pintar(BloqueConversaciones({ datos: Promise.resolve(d), ahoraMs: AHORA, puedeDecidir: true, acciones }));
    expect(html).toContain('Lo lleva el Vigía');
    expect(html).toContain('Lo lleva una persona');
    expect(html).toContain('Yo me encargo');
    expect(html).toContain('Devolver al Vigía');
    expect(html).toContain('Responder al cliente');
    expect(html).toContain('Al día');
  });
  it('quien solo mira no ve ninguna acción', async () => {
    const d = base({ conversaciones: [conv({ control: 'humano' })] });
    const html = await pintar(BloqueConversaciones({ datos: Promise.resolve(d), ahoraMs: AHORA, puedeDecidir: false, acciones }));
    expect(html).not.toContain('Yo me encargo');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('Cerrar');
  });
  it('el que espera pasado el SLA se marca; el que no, no', async () => {
    const d = base({ conversaciones: [conv({ sinRespuestaDesde: hace(10) }), conv({ id: 'b', sinRespuestaDesde: hace(50) })] });
    const html = await pintar(BloqueConversaciones({ datos: Promise.resolve(d), ahoraMs: AHORA, puedeDecidir: true, acciones }));
    expect(html).toContain('Espera 10 min');
    expect(html).toContain('Espera 50 min');
    expect(html.match(/color:var\(--bad\)/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
  it('vacío: lo dice', async () => {
    expect(await pintar(BloqueConversaciones({ datos: Promise.resolve(base()), ahoraMs: AHORA, puedeDecidir: true, acciones }))).toContain('Ningún cliente tiene un hilo abierto');
  });
});

describe('configuración, bitácora y contactos', () => {
  it('el dueño ve el formulario con los valores actuales; los demás ven un resumen de solo lectura', async () => {
    const d = base({ config: { ...configApagada('t1'), habilitado: true, slaRespuestaMin: 45, retencionDias: 90 } });
    const dueno = await pintar(BloqueConfiguracion({ datos: Promise.resolve(d), puedeAdministrar: true, acciones }));
    expect(dueno).toContain('value="45"');
    expect(dueno).toContain('value="90"');
    expect(dueno).toContain('Guardar');
    const otro = await pintar(BloqueConfiguracion({ datos: Promise.resolve(d), puedeAdministrar: false, acciones }));
    expect(otro).not.toContain('Guardar');
    expect(otro).toContain('SLA de respuesta: 45 min');
    expect(otro).toContain('Solo el dueño de la flota cambia esto');
  });

  it('la bitácora nombra los eventos y declara que no guarda textos ni teléfonos', async () => {
    const html = await pintar(BloqueBitacora({ datos: Promise.resolve(base({ eventos: [
      { id: 2, tipo: 'escalada', nivel: 2, creadoEn: hace(3), conversacionId: null }, { id: 1, tipo: 'optout', nivel: null, creadoEn: hace(9), conversacionId: null },
    ] })) }));
    expect(html).toContain('Escalamiento (nivel 2)');
    expect(html).toContain('Un cliente pidió su baja');
    expect(html).toContain('No guarda el texto de los clientes ni sus teléfonos');
  });

  it('contactos: solo las últimas 4 cifras (jamás el teléfono completo), consentimiento fechado y acciones solo para el dueño', async () => {
    const d = base({ contactos: [
      { id: '44444444-4444-4444-8444-444444444444', nombre: 'María', clienteNombre: 'Compras Acme', telefonoTerminacion: '0001', estado: 'activo', consentimientoEn: hace(1000), gerenteUserId: null },
      { id: '55555555-5555-4555-8555-555555555555', nombre: null, clienteNombre: 'Otro', telefonoTerminacion: '9999', estado: 'baja', consentimientoEn: null, gerenteUserId: null },
    ] });
    const dueno = await pintar(BloqueContactos({ datos: Promise.resolve(d), puedeAdministrar: true, acciones }));
    expect(dueno).toContain('…0001');
    expect(dueno).not.toMatch(/5255\d{8}/);
    expect(dueno).toContain('Activo');
    expect(dueno).toContain('Dado de baja');
    expect(dueno).toContain('Consentimiento:');
    expect(dueno).toContain('Suprimir sus datos (ARCO)');
    expect(dueno).toContain('autorizó recibir mensajes por WhatsApp');
    expect(dueno).toContain('Dar de baja');
    // un contacto ya dado de baja no ofrece «Dar de baja» otra vez, pero sí suprimir (ARCO)
    const filaBaja = dueno.split('…9999')[1] ?? '';
    expect(filaBaja).toContain('Suprimir sus datos (ARCO)');
    expect(filaBaja).not.toContain('value="baja"');
    const otro = await pintar(BloqueContactos({ datos: Promise.resolve(d), puedeAdministrar: false, acciones }));
    expect(otro).not.toContain('Suprimir');
    expect(otro).not.toContain('Autorizar contacto');
    expect(otro).toContain('Solo el dueño de la flota autoriza');
  });

  it('sin clientes en el catálogo, manda a darlos de alta primero', async () => {
    const html = await pintar(BloqueContactos({ datos: Promise.resolve(base({ clientes: [] })), puedeAdministrar: true, acciones }));
    expect(html).toContain('Primero da de alta al cliente');
  });
});
