import { describe, it, expect } from 'vitest';
import {
  prioridadDeConversacion, estadoDeAtencion, filasDeBandeja, ordenarBandeja, filtrarBandeja, filtrosDeUrl, cifrasDeBandeja, responsablesPorNivel, SIN_FILTROS,
} from './bandeja_atencion';
import type { ConversacionTablero, DatosTablero } from './repo';
import { configApagada } from './tipos';

const AHORA = Date.parse('2026-10-01T18:00:00Z');
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
const SLA = 30;

const conv = (e: Partial<ConversacionTablero> = {}): ConversacionTablero => ({
  id: 'c1', contactoId: 'ct1', contactoNombre: 'María', clienteNombre: 'Acme', control: 'agente', sinRespuestaDesde: null, molestiaNivel: 0, molestiaMotivos: [],
  escalamientoNivel: 0, atendida: false, ultimaEntradaEn: null, ultimoMensajeCliente: 'hola', clienteId: 'cl1', ...e,
});
const datos = (e: Partial<DatosTablero> = {}): DatosTablero => ({
  config: { ...configApagada('t'), slaRespuestaMin: SLA }, conversaciones: [], pendientes: [], fallidos: [], contactos: [], eventos: [],
  respuesta: { muestra: 0, promedioMin: null, medianaMin: null }, clientes: [], gerentes: [], ...e,
});

describe('prioridadDeConversacion', () => {
  it('normal: al día o esperando dentro del plazo', () => {
    expect(prioridadDeConversacion(conv(), 0, SLA, AHORA).prioridad).toBe('normal');
    expect(prioridadDeConversacion(conv({ sinRespuestaDesde: hace(10) }), 0, SLA, AHORA)).toMatchObject({ prioridad: 'normal', slaVencido: false });
  });
  it('alta: molesto, plazo vencido, escalada nivel 1, por aprobar o mensaje de prioridad alta', () => {
    expect(prioridadDeConversacion(conv({ molestiaNivel: 2 }), 0, SLA, AHORA).prioridad).toBe('alta');
    expect(prioridadDeConversacion(conv({ sinRespuestaDesde: hace(31) }), 0, SLA, AHORA)).toMatchObject({ prioridad: 'alta', slaVencido: true, motivos: ['sla_vencido'] });
    expect(prioridadDeConversacion(conv({ escalamientoNivel: 1 }), 0, SLA, AHORA).prioridad).toBe('alta');
    expect(prioridadDeConversacion(conv(), 1, SLA, AHORA)).toMatchObject({ prioridad: 'alta', motivos: ['por_aprobar'] });
    expect(prioridadDeConversacion(conv({ prioridad: 2 }), 0, SLA, AHORA).prioridad).toBe('alta');
  });
  it('urgente: muy molesto, nivel 2, o vencido CON molestia o escalamiento', () => {
    expect(prioridadDeConversacion(conv({ molestiaNivel: 3 }), 0, SLA, AHORA).prioridad).toBe('urgente');
    expect(prioridadDeConversacion(conv({ escalamientoNivel: 2 }), 0, SLA, AHORA).prioridad).toBe('urgente');
    expect(prioridadDeConversacion(conv({ molestiaNivel: 2, sinRespuestaDesde: hace(45) }), 0, SLA, AHORA)).toMatchObject({ prioridad: 'urgente', motivos: ['molesto', 'sla_vencido'] });
  });
});

describe('estadoDeAtencion', () => {
  it('toma el más urgente que corresponda', () => {
    expect(estadoDeAtencion(conv({ sinRespuestaDesde: hace(5), escalamientoNivel: 1 }), 1)).toBe('por_aprobar');
    expect(estadoDeAtencion(conv({ sinRespuestaDesde: hace(5), escalamientoNivel: 1 }), 0)).toBe('escalada');
    expect(estadoDeAtencion(conv({ sinRespuestaDesde: hace(5) }), 0)).toBe('sin_responder');
    expect(estadoDeAtencion(conv({ control: 'humano' }), 0)).toBe('con_persona');
    expect(estadoDeAtencion(conv(), 0)).toBe('al_dia');
  });
});

describe('filasDeBandeja, orden y filtros', () => {
  const d = datos({
    gerentes: [{ id: 'u1', nombre: 'Laura', rol: 'encargado' }],
    conversaciones: [
      conv({ id: 'a', clienteId: 'cl1' }),
      conv({ id: 'b', clienteId: 'cl2', sinRespuestaDesde: hace(90), molestiaNivel: 3 }),
      conv({ id: 'c', clienteId: 'cl1', sinRespuestaDesde: hace(40) }),
      conv({ id: 'd', clienteId: 'cl2', control: 'humano', tomadaPor: 'u1' }),
      conv({ id: 'e', clienteId: 'cl2', control: 'humano', tomadaPor: 'desconocido' }),
    ],
    pendientes: [{ id: 'p1', conversacionId: 'a', clienteNombre: 'Acme', mensajeCliente: 'x', borrador: 'y', intencion: null, riesgo: null, senales: [], adjuntos: [], creadoEn: hace(1) }],
  });
  const filas = filasDeBandeja(d, AHORA);

  it('arma cada fila con su responsable (solo si consta quién tomó el hilo)', () => {
    expect(filas.find((f) => f.id === 'a')).toMatchObject({ porAprobar: 1, estado: 'por_aprobar', prioridad: 'alta', control: 'agente', responsableNombre: null });
    expect(filas.find((f) => f.id === 'd')?.responsableNombre).toBe('Laura');
    expect(filas.find((f) => f.id === 'e')?.responsableNombre).toBeNull();
  });
  it('ordena urgente > alta > normal y, dentro, más espera primero; no muta', () => {
    const copia = [...filas];
    expect(ordenarBandeja(filas).map((f) => f.id)).toEqual(['b', 'c', 'a', 'd', 'e']);
    expect(filas).toEqual(copia);
  });
  it('filtra por estado, prioridad y cliente; filtro vacío no filtra', () => {
    expect(filtrarBandeja(filas, SIN_FILTROS)).toHaveLength(5);
    expect(filtrarBandeja(filas, { ...SIN_FILTROS, prioridad: 'urgente' }).map((f) => f.id)).toEqual(['b']);
    expect(filtrarBandeja(filas, { ...SIN_FILTROS, estado: 'con_persona' }).map((f) => f.id)).toEqual(['d', 'e']);
    expect(filtrarBandeja(filas, { ...SIN_FILTROS, clienteId: 'cl1' }).map((f) => f.id)).toEqual(['a', 'c']);
    expect(filtrarBandeja(filas, { estado: 'sin_responder', prioridad: 'alta', clienteId: 'cl1' }).map((f) => f.id)).toEqual(['c']);
  });
  it('cifras: prioridades, sin responder con su tiempo y por aprobar; nadie espera = null (no 0)', () => {
    expect(cifrasDeBandeja(filas)).toEqual({ total: 5, porPrioridad: { urgente: 1, alta: 2, normal: 2 }, sinResponder: 2, fueraDePlazo: 2, porAprobar: 1, masAntiguaMin: 90 });
    expect(cifrasDeBandeja(filasDeBandeja(datos({ conversaciones: [conv()] }), AHORA)).masAntiguaMin).toBeNull();
    expect(cifrasDeBandeja([]).total).toBe(0);
  });
});

describe('filtrosDeUrl', () => {
  it('ignora lo que no es de las listas o no es un uuid', () => {
    expect(filtrosDeUrl({ estado: 'hackeo', prioridad: 'x', cliente: "1' or 1=1" })).toEqual(SIN_FILTROS);
    const u = '11111111-1111-4111-8111-111111111111';
    expect(filtrosDeUrl({ estado: 'escalada', prioridad: 'urgente', cliente: u })).toEqual({ estado: 'escalada', prioridad: 'urgente', clienteId: u });
  });
});

describe('responsablesPorNivel', () => {
  const base = datos({
    gerentes: [{ id: 'g1', nombre: 'Gerardo', rol: 'encargado' }, { id: 'o1', nombre: 'Olga', rol: 'flota_admin' }],
    contactos: [{ id: 'ct1', nombre: 'María', clienteNombre: 'Acme', telefonoTerminacion: '0001', estado: 'activo', consentimientoEn: null, gerenteUserId: 'g1' }, { id: 'ct2', nombre: 'Sin', clienteNombre: 'Acme', telefonoTerminacion: '0002', estado: 'activo', consentimientoEn: null, gerenteUserId: null }],
    directores: [{ id: 'd1', nivel: 2, nombre: 'Director Uno', telefono: null, correo: null }],
    servicio: [{ id: 's1', nombre: 'Servicio A', telefono: null, correo: null, clienteId: 'cl1', activo: true }, { id: 's2', nombre: 'Servicio B', telefono: null, correo: null, clienteId: 'otro', activo: true }, { id: 's3', nombre: 'Inactivo', telefono: null, correo: null, clienteId: null, activo: false }],
  });
  it('nivel 1 = gerente del contacto, nivel 2 = dueño y directores; servicio solo el que aplica al cliente', () => {
    expect(responsablesPorNivel(base, 'ct1', 'cl1')).toEqual({ servicio: ['Servicio A'], nivel1: ['Gerardo'], nivel2: ['Olga', 'Director Uno'], nivel1PorOmision: false });
  });
  it('sin gerente asignado lo dice (nivel 1 por omisión) y no inventa nombres', () => {
    expect(responsablesPorNivel(datos(), 'x', null)).toEqual({ servicio: [], nivel1: [], nivel2: [], nivel1PorOmision: true });
    expect(responsablesPorNivel(base, 'ct2', 'cl1').nivel1PorOmision).toBe(true);
  });
});
