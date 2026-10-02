import { describe, expect, it } from 'vitest';
import type { DatosTablero as DatosVigia } from '../vigia/repo';
import { configApagada } from '../vigia/tipos';
import { resumirAutofactura, resumirBuzon, resumirCobranza, resumirVigia } from './resumenes';
import { resumirSalud, type EntradaSalud } from './salud_agentes';

const AHORA = new Date('2026-10-02T18:00:00.000Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const T = 'tenant-a';

function vigia(p: Partial<DatosVigia> = {}): DatosVigia {
  return {
    config: { ...configApagada(T), habilitado: true, slaRespuestaMin: 30, slaCriticoMin: 10 },
    conversaciones: [], pendientes: [], fallidos: [], contactos: [], eventos: [],
    respuesta: { muestra: 0, promedioMin: null, medianaMin: null }, clientes: [{ id: 'c1', nombre: 'Cliente Crítico' }, { id: 'c2', nombre: 'Cliente Normal' }], gerentes: [], ...p,
  };
}
const conv = (id: string, cliente: string, min: number, extra: Record<string, unknown> = {}) => ({
  id, contactoId: `k-${id}`, contactoNombre: 'Persona Del Cliente', clienteNombre: cliente, control: 'agente' as const, sinRespuestaDesde: hace(min),
  molestiaNivel: 0, molestiaMotivos: [], escalamientoNivel: 0, atendida: false, ultimaEntradaEn: hace(min), ultimoMensajeCliente: 'texto privado del cliente 5512345678', ...extra,
});

describe('resumirVigia', () => {
  it('aplica el plazo corto del cliente con grupo crítico y no filtra PII', () => {
    const d = vigia({
      conversaciones: [conv('a', 'Cliente Crítico', 12), conv('b', 'Cliente Normal', 12), conv('c', 'Cliente Normal', 45, { molestiaNivel: 2 })],
      pendientes: [{ id: 'p', conversacionId: 'a', clienteNombre: 'Cliente Crítico', mensajeCliente: 'secreto', borrador: 'borrador secreto', intencion: 'eta', riesgo: 'bajo', senales: [], adjuntos: [], creadoEn: hace(20) }],
      fallidos: [{ id: 'f', conversacionId: 'a', clienteNombre: 'Cliente Crítico', error: 'x', creadoEn: hace(5) }],
    });
    const r = resumirVigia(d, [{ id: 'g', clienteId: 'c1', clienteNombre: 'Cliente Crítico', nombre: 'Grupo Operaciones', critico: true, importaciones: 1, mensajes: 40, ultimaImportacion: hace(1000) }], AHORA);
    expect(r.esperandoRespuesta).toBe(3);
    expect(r.conPlazoVencido).toBe(2); // el crítico a 12 min (plazo 10) y el normal a 45 (plazo 30)
    expect(r.esperando[0]).toMatchObject({ cliente: 'Cliente Normal', minutosEsperando: 45, vencido: true });
    expect(r.conMolestia).toBe(1);
    expect(r.pendientesDeAprobacion).toEqual({ total: 1, masViejaMin: 20 });
    expect(r.enviosFallidos24h).toBe(1);
    expect(r.grupos).toMatchObject({ disponible: true, total: 1, criticos: 1 });
    const texto = JSON.stringify(r);
    for (const prohibido of ['Persona Del Cliente', 'texto privado', '5512345678', 'borrador secreto', 'secreto']) expect(texto).not.toContain(prohibido);
  });

  it('sin la tabla de grupos lo dice, no inventa cero grupos', () => {
    const r = resumirVigia(vigia(), null, AHORA);
    expect(r.grupos).toMatchObject({ disponible: false });
  });

  it('recorta la lista y dice cuántas quedaron fuera', () => {
    const d = vigia({ conversaciones: Array.from({ length: 14 }, (_, i) => conv(`x${i}`, 'Cliente Normal', 5 + i)) });
    const r = resumirVigia(d, [], AHORA);
    expect(r.esperando).toHaveLength(10);
    expect(r.masNoMostradas).toBe(4);
    expect(r.esperandoRespuesta).toBe(14);
  });
});

describe('resumirBuzon', () => {
  const conteo = { porEstado: { procesada: 5, duplicada: 1, revision: 2, descartada: 0, ignorada: 0, rechazada: 0, error: 1 }, total: 9, ultimaRecepcionEn: hace(300), facturasPorRevisar: 2 };
  it('cuenta, dice cuánto hace de la última recepción y marca problemas de entrega', () => {
    const r = resumirBuzon(conteo, { porEstado: { entregada: 3, fallida: 1, rebotada: 1 }, ultimaEnviadaEn: hace(60) }, AHORA);
    expect(r).toMatchObject({ recibidos: 9, facturasPorRevisar: 2, conError: 1, horasDesdeLaUltimaRecepcion: 5 });
    expect(r.entregaAlContador).toMatchObject({ disponible: true, conProblema: 2 });
  });
  it('sin migración de entregas lo dice', () => {
    expect(resumirBuzon(conteo, null, AHORA).entregaAlContador).toMatchObject({ disponible: false });
  });
  it('no expone destinatarios ni rutas', () => {
    expect(JSON.stringify(resumirBuzon(conteo, { porEstado: {}, ultimaEnviadaEn: null }, AHORA))).not.toMatch(/@|storage|ruta/i);
  });
});

describe('resumirCobranza', () => {
  it('cuenta por tier, ordena por atraso y NO publica teléfonos', () => {
    const r = resumirCobranza({
      vigilados: 40,
      paraContactar: [{ viajeId: 'v1', folio: 'F1', operadorNombre: 'Chofer Uno', operadorTelefono: '5215512345678', dias: 5, tier: 1, contactosPrevios: 0 }],
      sinTelefono: [{ viajeId: 'v2', folio: 'F2', operadorNombre: 'Chofer Dos', operadorTelefono: null, dias: 12, tier: 2, contactosPrevios: 1 }],
    }, null);
    expect(r.masAtrasados.map((x) => x.folio)).toEqual(['F2', 'F1']);
    expect(r.porTier).toEqual([{ tier: 1, viajes: 1 }, { tier: 2, viajes: 1 }]);
    expect(r.sinTelefonoDelChofer).toBe(1);
    expect(r.porGasto).toEqual({ disponible: false });
    expect(JSON.stringify(r)).not.toContain('5215512345678');
  });
});

describe('resumirAutofactura', () => {
  it('apagada por omisión, lotes por vencer, portales por fase', () => {
    const r = resumirAutofactura('sin_fila',
      [{ id: 'l1', comercio: 'Comercio X', gastoIds: ['g1', 'g2'], montoTotal: 500.5, estado: 'propuesto', propuestoEn: hace(10), expiraEn: new Date(AHORA.getTime() + 30 * 60_000).toISOString() }],
      [{ comercio: 'Comercio X', fase: 'supervisada', emisionesConfirmadas: 1, ultimaEmisionEn: null }], AHORA);
    expect(r.emisionReal).toMatchObject({ encendida: false });
    expect(r.lotesPorConfirmar).toMatchObject({ total: 1, porVencerEnUnaHora: 1, montoTotal: 500.5 });
    expect(r.portales).toMatchObject({ total: 1, supervisados: 1 });
  });
  it('si la base no contestó no pinta "sin lotes"', () => {
    const r = resumirAutofactura(null, null, null, AHORA);
    expect(r.lotesPorConfirmar).toEqual({ disponible: false });
    expect(r.emisionReal).toMatchObject({ disponible: false });
  });
});

describe('resumirSalud', () => {
  const base = (p: Partial<EntradaSalud> = {}): EntradaSalud => ({
    ahora: AHORA,
    latidos: {
      'conductor-hitos': { estado: 'ok', haceMin: 3, ultimoEstado: 'ok' }, vigia: { estado: 'ok', haceMin: 2, ultimoEstado: 'ok' },
      'buzon-entrega': { estado: 'ok', haceMin: 10, ultimoEstado: 'ok' }, runner: { estado: 'ok', haceMin: 1, ultimoEstado: 'ok' },
      peajes: { estado: 'ok', haceMin: 5, ultimoEstado: 'ok' }, 'portales-vivos': { estado: 'ok', haceMin: 5, ultimoEstado: 'ok' },
      'liquidaciones-externas': { estado: 'ok', haceMin: 5, ultimoEstado: 'ok' },
    },
    corridas: {}, enviosSinSalir: { vigiaFallidos24h: 0, buzonEntregasConProblema: 0 }, ...p,
  });
  const g = (r: ReturnType<typeof resumirSalud>, id: string) => r.agentes.find((a) => a.agente === id)!;

  it('latido caído y corrida fallida se reportan por agente, con su pantalla', () => {
    const e = base({
      latidos: { ...base().latidos!, 'conductor-hitos': { estado: 'vencido', haceMin: 95, ultimoEstado: 'ok' } },
      corridas: { cobranza: [{ estado: 'fallo', inicio: hace(30), fin: hace(29), error: 'Meta rechazó la plantilla' }] },
    });
    const r = resumirSalud(e);
    expect(g(r, 'conductor')).toMatchObject({ estado: 'con_problema', ver: '/dashboard/agentes/conductores' });
    expect(g(r, 'conductor').problemas[0]).toMatch(/dejó de latir.*95 min/);
    expect(g(r, 'cobranza').problemas.join(' ')).toMatch(/última corrida falló: Meta rechazó la plantilla/);
    expect(r.conProblema).toBe(2);
  });

  it('cola muerta: envíos del Vigía y entregas del buzón que no salieron', () => {
    const r = resumirSalud(base({ enviosSinSalir: { vigiaFallidos24h: 3, buzonEntregasConProblema: 1 } }));
    expect(g(r, 'vigia').problemas.join(' ')).toMatch(/3 respuestas a clientes no salieron/);
    expect(g(r, 'buzon').problemas.join(' ')).toMatch(/1 entregas al contador/);
  });

  it('sin ninguna señal no es «al día»: es «sin datos»; y si no se pudo leer, se dice', () => {
    const r = resumirSalud({ ahora: AHORA, latidos: null, corridas: {}, enviosSinSalir: { vigiaFallidos24h: null, buzonEntregasConProblema: null } });
    expect(r.agentes.every((a) => a.estado === 'con_problema' || a.estado === 'sin_datos')).toBe(true);
    expect(g(r, 'conductor').problemas[0]).toMatch(/no se pudo leer el latido/);
  });

  it('todo sano → al_dia y cero problemas', () => {
    const r = resumirSalud(base({ corridas: { cobranza: [{ estado: 'ok', inicio: hace(60), fin: hace(59), error: null }] } }));
    expect(r.conProblema).toBe(0);
    expect(g(r, 'cobranza').estado).toBe('al_dia');
  });

  it('el error de una corrida se recorta y no filtra más de 140 caracteres', () => {
    const r = resumirSalud(base({ corridas: { peajes: [{ estado: 'fallo', inicio: hace(5), fin: null, error: 'x'.repeat(500) }] } }));
    expect(g(r, 'peajes').ultimaCorrida?.error?.length).toBe(140);
  });
});
