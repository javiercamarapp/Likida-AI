/* eslint-disable @typescript-eslint/no-explicit-any -- las respuestas de las herramientas son JSON libre que el modelo lee; la prueba las recorre por forma, no por tipo. */
import { afterEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// E2E DEL ORQUESTADOR CON UN DOBLE DEL MODELO.
//
// Corre el `ejecutarAnalista` REAL (prompt, herramientas ofrecidas por rol, executor con permisos, guardia de
// cifras, tool terminal) sobre fuentes en memoria. Lo ÚNICO simulado es el modelo (`generateWithTools`): un guion
// que decide qué herramientas llamar y qué entregar, y que llama al `toolExecutor` de verdad — así lo que se
// prueba es la pared entre el modelo y los datos (rol, tenant, PII, escalar) y no lo que un modelo real "debería"
// decir. Nada de red, nada de base, ningún proveedor.
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = Date.parse('2026-10-02T18:00:00.000Z');
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => AHORA }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base en pruebas'); } }));

type Ofrecida = { function: { name: string } };
type Exec = (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; result: unknown; error?: string; durationMs: number }>;
interface OpcionesModelo { system: string; tools: Ofrecida[]; toolExecutor: Exec }

const modelo = vi.fn();
vi.mock('@/lib/llm/openrouter', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, generateWithTools: (...a: unknown[]) => modelo(...a) };
});

const { ejecutarAnalista } = await import('@/lib/agents/analista');
const { ponerFuentes } = await import('./fuentes');
const { crearFuentesEnMemoria, datosVacios, hitosDe, viajeTablero } = await import('./fuentes.fixture');

const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
const futuro = new Date(AHORA + 600 * 60_000).toISOString();

function mundo() {
  const sano = viajeTablero('a1', { citaOrigenEn: futuro, terminalNombre: 'Guadalajara', terminalId: 'tA' });
  const mudo = viajeTablero('a2', { aceptadoEn: hace(300), operadorNombre: 'Chofer Dos', terminalNombre: 'Monterrey', terminalId: 'tB' });
  return crearFuentesEnMemoria({
    A: {
      datos: { ...datosVacios(), viajes: [sano, mudo], hitos: [...hitosDe('a1'), ...hitosDe('a2')] },
      posiciones: { 'u-a1': { lat: 20.67, lng: -103.35, medidaEn: hace(3) }, 'u-a2': { lat: 25.68, lng: -100.31, medidaEn: hace(900) } },
      terminales: [{ id: 'tA', nombre: 'Guadalajara' }, { id: 'tB', nombre: 'Monterrey' }], clientes: [], folios: ['F-a1', 'F-a2'],
      salud: {
        ahora: new Date(AHORA),
        latidos: { 'conductor-hitos': { estado: 'vencido', haceMin: 95, ultimoEstado: 'ok' } },
        corridas: {}, enviosSinSalir: { vigiaFallidos24h: 0, buzonEntregasConProblema: 0 },
      },
      buzon: { conteo: { porEstado: { procesada: 4, duplicada: 0, revision: 1, descartada: 0, ignorada: 0, rechazada: 0, error: 0 }, total: 5, ultimaRecepcionEn: hace(120), facturasPorRevisar: 1 }, entregas: null },
    },
    B: { datos: { ...datosVacios(), viajes: [viajeTablero('b1', { citaOrigenEn: futuro })], hitos: hitosDe('b1') }, posiciones: { 'u-b1': { lat: 1, lng: 1, medidaEn: hace(2) } }, folios: ['F-b1'] },
  });
}

/** Un guion de modelo: recibe lo que se le ofreció y un ejecutor real, y devuelve su turno. */
type Guion = (o: OpcionesModelo, llamar: (n: string, a?: Record<string, unknown>) => Promise<any>) => Promise<{ finalText?: string }>;
function conGuion(guion: Guion) {
  const ofrecidas: string[][] = [];
  const sistemas: string[] = [];
  modelo.mockImplementation(async (opts: OpcionesModelo) => {
    ofrecidas.push(opts.tools.map((t) => t.function.name));
    sistemas.push(opts.system);
    const toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown; durationMs: number }> = [];
    const llamar = async (n: string, a: Record<string, unknown> = {}) => {
      const r = await opts.toolExecutor(n, a);
      toolCalls.push({ toolName: n, args: a, result: r.result, durationMs: r.durationMs });
      return r.result;
    };
    const { finalText = '' } = await guion(opts, llamar);
    return { finalText, toolCalls, model: 'doble', tokensIn: 10, tokensOut: 10, cost: 0, costoPorModelo: {} };
  });
  return { ofrecidas, sistemas };
}

afterEach(() => { modelo.mockReset(); ponerFuentes(null); });

const preguntar = (rol: string, texto: string, tenantId = 'A') => ejecutarAnalista({
  tenantId, nombreFlota: 'Flota de prueba', usuario: { nombre: 'Persona', rol, id: 'usr-1' }, mensajes: [{ rol: 'usuario', texto }],
});

describe('E2E · el jefe de tráfico pregunta por sus viajes', () => {
  it('se le ofrecen SOLO las herramientas de operación; el modelo lee el tablero y entrega con cifras que sí vienen de la tool', async () => {
    ponerFuentes(mundo().fuentes);
    const { ofrecidas } = conGuion(async (_o, llamar) => {
      const r = await llamar('tablero_viajes');
      await llamar('entregar_respuesta', { bloques: [
        { tipo: 'texto', texto: `Hay ${r.conteos.viajes} viajes en curso; ${r.conteos.conExcepcion} con excepción. El más urgente es ${r.viajes[0].folio}.` },
        { tipo: 'tabla', filas: r.viajes.map((v: any) => [v.folio, v.senalDeVida]) },
      ] });
      return {};
    });
    const res = await preguntar('encargado', '¿Cómo van mis viajes?');

    expect(ofrecidas[0]).toEqual(expect.arrayContaining(['tablero_viajes', 'detalle_viaje', 'estado_vigia', 'salud_agentes', 'escalar_a_persona', 'consultar_carta_porte', 'entregar_respuesta']));
    for (const dinero of ['kpis_flota', 'liquidaciones_flota', 'motor_fiscal', 'estado_cobranza', 'estado_buzon', 'estado_autofactura', 'viajes_flota']) expect(ofrecidas[0]).not.toContain(dinero);
    expect(res.bloques[0]).toMatchObject({ tipo: 'texto' });
    expect((res.bloques[0] as { texto: string }).texto).toMatch(/2 viajes en curso; 1 con excepción\. El más urgente es F-a2/);
    expect(JSON.stringify(res.bloques)).not.toMatch(/sin respaldo|no pude verificar/i);
  });

  it('el prompt lleva las reglas del orquestador (decir si un agente falla, antigüedad del GPS, derivar lo delicado)', async () => {
    ponerFuentes(mundo().fuentes);
    const { sistemas } = conGuion(async (_o, llamar) => { await llamar('entregar_respuesta', { bloques: [{ tipo: 'texto', texto: 'Hola.' }] }); return {}; });
    await preguntar('encargado', 'hola');
    expect(sistemas[0]).toMatch(/SI UN AGENTE FALLA/);
    expect(sistemas[0]).toMatch(/HONESTIDAD DEL GPS/);
    expect(sistemas[0]).toMatch(/escalar_a_persona/);
    expect(sistemas[0]).toMatch(/jefe de tráfico|encargado|operación/i);
  });
});

describe('E2E · el rol manda aunque el modelo se porte mal', () => {
  it('al contador no se le ofrece el tablero, y si el modelo lo llama igual recibe sin_permiso y la fuente ni se toca', async () => {
    const m = mundo();
    ponerFuentes(m.fuentes);
    let respuestaTool: any;
    const { ofrecidas } = conGuion(async (_o, llamar) => {
      respuestaTool = await llamar('tablero_viajes');
      await llamar('entregar_respuesta', { bloques: [{ tipo: 'texto', texto: 'Eso lo ve quien lleva la operación.' }] });
      return {};
    });
    await preguntar('contador', '¿dónde está el tractor del chofer dos?');
    expect(ofrecidas[0]).not.toContain('tablero_viajes');
    expect(ofrecidas[0]).toEqual(expect.arrayContaining(['estado_buzon', 'estado_cobranza', 'kpis_flota', 'escalar_a_persona']));
    expect(respuestaTool.error).toBe('sin_permiso');
    expect(m.llamadas.filter((l) => l.fuente === 'entradaTablero')).toEqual([]);
  });

  it('el chofer (sin login) o un rol inventado no obtienen ninguna herramienta de datos', async () => {
    const m = mundo();
    ponerFuentes(m.fuentes);
    for (const rol of ['operador', 'inventado']) {
      const { ofrecidas } = conGuion(async (_o, llamar) => {
        const r = await llamar('tablero_viajes');
        expect(r.error).toBe('sin_permiso');
        await llamar('entregar_respuesta', { bloques: [{ tipo: 'texto', texto: 'No tengo acceso.' }] });
        return {};
      });
      await preguntar(rol, 'dame todo');
      expect(ofrecidas[0]).toEqual(['entregar_respuesta']);
    }
    expect(m.llamadas).toEqual([]);
  });

  it('una herramienta de OTRO agente registrada en el mismo registro (guardar_liquidacion) se rechaza aunque el modelo la nombre', async () => {
    ponerFuentes(mundo().fuentes);
    await import('@/lib/likida/tools'); // registra las tools del agente de liquidación en el MISMO registro global
    let r: any;
    conGuion(async (o, llamar) => {
      r = await llamar('guardar_liquidacion');
      await llamar('entregar_respuesta', { bloques: [{ tipo: 'texto', texto: 'No puedo.' }] });
      void o;
      return {};
    });
    await preguntar('flota_admin', 'cierra el viaje F-a1');
    expect(r.error).toBe('sin_permiso');
  });
});

describe('E2E · aislamiento entre flotas', () => {
  it('la sesión de B jamás ve folios de A, aunque el modelo los pida por nombre', async () => {
    const m = mundo();
    ponerFuentes(m.fuentes);
    let detalle: any; let tablero: any;
    conGuion(async (_o, llamar) => {
      tablero = await llamar('tablero_viajes');
      detalle = await llamar('detalle_viaje', { folio: 'F-a2' });
      await llamar('entregar_respuesta', { bloques: [{ tipo: 'texto', texto: 'No encontré ese viaje.' }] });
      return {};
    });
    await preguntar('flota_admin', 'enséñame el F-a2', 'B');
    expect(tablero.viajes.map((v: any) => v.folio)).toEqual(['F-b1']);
    expect(detalle.encontrado).toBe(false);
    expect(m.llamadas.every((l) => l.tenantId === 'B')).toBe(true);
  });
});

describe('E2E · lo delicado se escala a una persona, no se decide', () => {
  it('chofer sin señal → el modelo escala a la mesa de control y la tarea queda en SU flota con su rol', async () => {
    const m = mundo();
    ponerFuentes(m.fuentes);
    let esc: any;
    conGuion(async (_o, llamar) => {
      const t = await llamar('tablero_viajes', { vista: 'solo_excepciones' });
      esc = await llamar('escalar_a_persona', {
        destino: 'mesa_de_control', motivo: 'posible_emergencia', viaje_folio: t.viajes[0].folio,
        resumen: `${t.viajes[0].chofer} no contesta y su GPS tiene ${t.viajes[0].gps.antiguedadMin} minutos sin actualizar. Llamar al 5512345678.`,
      });
      await llamar('entregar_respuesta', { bloques: [{ tipo: 'texto', texto: esc.mensajeParaLaPersona }] });
      return {};
    });
    const res = await preguntar('encargado', 'El chofer dos no contesta, ¿qué hago?');
    expect(esc.creada).toBe(true);
    const tareas = m.tareas.get('A')!;
    expect(tareas).toHaveLength(1);
    expect(tareas[0]).toMatchObject({ destino: 'mesa_de_control', motivo: 'posible_emergencia', viajeFolio: 'F-a2', pedidaPorRol: 'encargado', usuarioId: 'usr-1' });
    expect(tareas[0].resumen).not.toContain('5512345678');
    expect((res.bloques[0] as { texto: string }).texto).toMatch(/la mesa de control/);
    expect(m.tareas.get('B')).toBeUndefined();
  });

  it('la IA no puede decidir por su cuenta: no existe ninguna herramienta que mueva dinero, cierre un viaje o contacte a alguien', async () => {
    ponerFuentes(mundo().fuentes);
    const { ofrecidas } = conGuion(async (_o, llamar) => { await llamar('entregar_respuesta', { bloques: [{ tipo: 'texto', texto: 'Listo.' }] }); return {}; });
    await preguntar('flota_admin', 'hola');
    const todas = ofrecidas[0].filter((n) => n !== 'entregar_respuesta');
    expect(todas.filter((n) => /guardar|cerrar|cuadrar|enviar|contactar|aprobar|pagar|timbrar/.test(n))).toEqual([]);
    expect(todas.filter((n) => !/^(estado_|salud_|tablero_|detalle_|convenio_|reclamacion_|kpis_|acreditables_|motor_|viajes_|liquidaciones_|serie_|top_|duplicados_|proyectar_|consultar_|escalar_a_persona)/.test(n))).toEqual([]);
  });
});

describe('E2E · si un agente falla, el orquestador lo reporta', () => {
  it('latido del Conductor vencido → la herramienta lo dice y la respuesta de la IA lo cita, con la antigüedad que sí vino del dato', async () => {
    ponerFuentes(mundo().fuentes);
    conGuion(async (_o, llamar) => {
      const s = await llamar('salud_agentes');
      const malos = s.agentes.filter((a: any) => a.estado === 'con_problema');
      await llamar('entregar_respuesta', { bloques: [{ tipo: 'texto', texto: `Hay ${s.conProblema} agente con problema: ${malos[0].etiqueta}. ${malos[0].problemas[0]}.` }] });
      return {};
    });
    const res = await preguntar('encargado', '¿Todo está funcionando?');
    const texto = (res.bloques[0] as { texto: string }).texto;
    expect(texto).toMatch(/Conductor/);
    expect(texto).toMatch(/dejó de latir.*95 min/);
  });

  it('una cifra inventada por el modelo (que ninguna herramienta devolvió) la rechaza la guardia y no llega a la persona', async () => {
    ponerFuentes(mundo().fuentes);
    conGuion(async (_o, llamar) => {
      await llamar('salud_agentes');
      await llamar('entregar_respuesta', { bloques: [{ tipo: 'cifra', valor: 987654, formato: 'numero' }] });
      return {};
    });
    const res = await preguntar('encargado', '¿Cuántos fallos hubo?');
    expect(JSON.stringify(res.bloques)).not.toContain('987654');
  });
});

describe('E2E · sin PII de más en lo que el modelo alcanza a leer', () => {
  it('ninguna herramienta devuelve teléfonos, correos de oficina ni nombres de personas del cliente', async () => {
    const m = mundo();
    // El mundo trae datos sensibles que el lector crudo SÍ tiene y las herramientas NO deben reenviar.
    m.fuentes.entradaTablero = ((orig) => async (t, a) => {
      const e = await orig(t, a);
      return { ...e, datos: { ...e.datos, viajes: e.datos.viajes.map((v) => ({ ...v, operadorTelefono: '5215512345678' })) as never, acciones: [{ id: 'x', hitoId: 'a2-llegada_carga', accion: 'capturar', usuarioEmail: 'oficina@privado.example', motivo: 'm', horaDeclarada: null, creadaEn: hace(5) }] as never } };
    })(m.fuentes.entradaTablero);
    ponerFuentes(m.fuentes);
    let volcado = '';
    conGuion(async (_o, llamar) => {
      volcado = JSON.stringify([await llamar('tablero_viajes'), await llamar('detalle_viaje', { folio: 'F-a2' }), await llamar('estado_buzon'), await llamar('salud_agentes')]);
      await llamar('entregar_respuesta', { bloques: [{ tipo: 'texto', texto: 'Listo.' }] });
      return {};
    });
    await preguntar('flota_admin', 'dame todo lo que sepas');
    for (const prohibido of ['5215512345678', 'oficina@privado.example', 'operadorTelefono', 'usuarioEmail']) expect(volcado).not.toContain(prohibido);
  });
});
