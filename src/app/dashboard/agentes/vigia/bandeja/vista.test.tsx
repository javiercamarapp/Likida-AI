import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { ContenidoBandeja, hrefBandeja, type AccionesBandeja } from './vista';
import type { ConversacionTablero, DatosTablero, MensajeHilo } from '@/lib/likida/vigia/repo';
import { configApagada } from '@/lib/likida/vigia/tipos';
import { SIN_FILTROS } from '@/lib/likida/vigia/bandeja_atencion';
import { TR_ES } from '../../i18n-agentes';

const AHORA = Date.parse('2026-10-01T18:00:00Z');
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
const noop = (async () => null) as AccionesBandeja['decidir'];
const acciones: AccionesBandeja = { decidir: noop, conversacion: noop };
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

const conv = (e: Partial<ConversacionTablero> = {}): ConversacionTablero => ({
  id: ID1, contactoId: 'ct', contactoNombre: 'María Pérez', clienteNombre: 'Compras Acme', control: 'agente', sinRespuestaDesde: null, molestiaNivel: 0,
  molestiaMotivos: [], escalamientoNivel: 0, atendida: false, ultimaEntradaEn: hace(5), ultimoMensajeCliente: '¿Dónde va mi viaje?', clienteId: 'cl1', ...e,
});
const datos = (e: Partial<DatosTablero> = {}): DatosTablero => ({
  config: { ...configApagada('t1'), habilitado: true }, conversaciones: [], pendientes: [], fallidos: [], contactos: [], eventos: [],
  respuesta: { muestra: 0, promedioMin: null, medianaMin: null }, clientes: [{ id: 'cl1', nombre: 'Compras Acme' }], gerentes: [], ...e,
});
const hiloDe = (h: MensajeHilo[] | 'error' | null) => Promise.resolve(h);

async function pintar(d: DatosTablero, o: { chat?: string | null; hilo?: MensajeHilo[] | 'error' | null; puedeDecidir?: boolean } = {}): Promise<string> {
  const el: ReactElement = await ContenidoBandeja({
    tr: TR_ES, datos: Promise.resolve(d), hilo: hiloDe(o.hilo ?? null), chat: o.chat ?? null, filtros: SIN_FILTROS, ahoraMs: AHORA,
    puedeDecidir: o.puedeDecidir ?? true, acciones, ocultos: [],
  });
  return renderToStaticMarkup(el);
}

describe('Bandeja de atención · render', () => {
  it('sin conversaciones: estado vacío claro, sin cifras inventadas', async () => {
    const h = await pintar(datos());
    expect(h).toContain('Sin conversaciones activas');
    expect(h).toContain('Elige una conversación');
  });

  it('divide la lista por prioridad con su conteo y muestra quién contesta y cuánto lleva esperando', async () => {
    const d = datos({
      gerentes: [{ id: 'u1', nombre: 'Laura', rol: 'encargado' }],
      conversaciones: [
        conv({ id: ID1, molestiaNivel: 3, sinRespuestaDesde: hace(95) }),
        conv({ id: ID2, clienteNombre: 'Otra', control: 'humano', tomadaPor: 'u1' }),
      ],
    });
    const h = await pintar(d);
    expect(h).toContain('Urgente · 1');
    expect(h).toContain('Normal · 1');
    expect(h).toContain('Espera 1 h 35 min');
    expect(h).toContain('Contesta: el Vigía');
    expect(h).toContain('Contesta: Laura');
    expect(h).toContain(`chat=${ID1}`);
  });

  it('abre un hilo: entrada del cliente, respuesta propuesta y enviada, con la cola de aprobación existente', async () => {
    const d = datos({
      conversaciones: [conv({ sinRespuestaDesde: hace(10) })],
      pendientes: [{ id: ID2, conversacionId: ID1, clienteNombre: 'Compras Acme', mensajeCliente: 'x', borrador: 'Va en Querétaro', intencion: 'ubicacion', riesgo: 'bajo', senales: [], adjuntos: [], creadoEn: hace(1) }],
    });
    const hilo: MensajeHilo[] = [
      { id: 'm1', direccion: 'entrante', autor: 'cliente', texto: '¿Dónde va mi viaje?', estado: 'recibido', intencion: null, riesgo: null, autoenviado: false, editado: false, enviadoEn: null, error: null, creadoEn: hace(10) },
      { id: 'm0', direccion: 'saliente', autor: 'humano', texto: 'Ya lo reviso', estado: 'enviado', intencion: null, riesgo: null, autoenviado: false, editado: false, enviadoEn: hace(8), error: null, creadoEn: hace(8) },
      { id: 'm2', direccion: 'saliente', autor: 'agente', texto: 'Va en Querétaro', estado: 'pendiente_aprobacion', intencion: 'ubicacion', riesgo: 'bajo', autoenviado: false, editado: false, enviadoEn: null, error: null, creadoEn: hace(1) },
    ];
    const h = await pintar(d, { chat: ID1, hilo });
    // El hilo (Bloque/Suspense) se resuelve por separado; aquí se comprueba la ficha y las acciones.
    expect(h).toContain('Quién la contesta');
    expect(h).toContain('Responsable por nivel');
    expect(h).toContain('Asignar a otra persona todavía no existe');
    expect(h).toContain('Yo me encargo');
  });

  it('una conversación que no es de la flota (o ya cerrada) lo dice', async () => {
    const h = await pintar(datos({ conversaciones: [conv()] }), { chat: ID2 });
    expect(h).toContain('Esa conversación ya no está activa');
  });

  it('quien solo mira no ve botones de decisión', async () => {
    const h = await pintar(datos({ conversaciones: [conv()] }), { chat: ID1, puedeDecidir: false });
    expect(h).toContain('Solo el dueño o el encargado pueden responder');
    expect(h).not.toContain('Devolver');
    expect(h).not.toContain('Cerrar');
  });

  it('con el Vigía apagado lo dice; con el tope de 100 avisa que puede haber más', async () => {
    const h = await pintar(datos({ config: { ...configApagada('t1'), habilitado: false } }));
    expect(h).toContain('apagado');
    const muchas = Array.from({ length: 100 }, (_, i) => conv({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    expect(await pintar(datos({ conversaciones: muchas }))).toContain('puede haber más');
  });
});

describe('hrefBandeja', () => {
  it('conserva los filtros y la flota que se ve; sin nada, la ruta pelona', () => {
    expect(hrefBandeja(SIN_FILTROS, {})).toBe('/dashboard/agentes/vigia/bandeja');
    expect(hrefBandeja({ estado: 'escalada', prioridad: 'urgente', clienteId: ID2 }, { chat: ID1, ocultos: [['tenant', 'abc']] }))
      .toBe(`/dashboard/agentes/vigia/bandeja?tenant=abc&estado=escalada&prioridad=urgente&cliente=${ID2}&chat=${ID1}`);
  });
});
