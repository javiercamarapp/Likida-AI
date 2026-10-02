import { afterEach, describe, expect, it, vi } from 'vitest';

const AHORA = Date.parse('2026-10-02T18:00:00.000Z');
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => AHORA }));

const { makeExecutor, toolSchemas } = await import('@/lib/llm/tool-executor');
const { conPermisos } = await import('./herramientas');
const { ponerFuentes } = await import('./fuentes');
const { crearFuentesEnMemoria, datosVacios, hitosDe, viajeTablero } = await import('./fuentes.fixture');
const { AREA_POR_HERRAMIENTA } = await import('./permisos');

const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
const A = 'flota-a';
const B = 'flota-b';
const futuro = new Date(AHORA + 600 * 60_000).toISOString();

/** Flota A: un viaje sano y uno sin señal de vida (con datos que NO deben salir: contacto en el andén, correo de oficina). */
function mundos() {
  const sano = viajeTablero('a1', { citaOrigenEn: futuro, terminalId: 'tA', terminalNombre: 'Guadalajara', clienteId: 'cA', clienteNombre: 'Cliente Alfa' });
  const mudo = viajeTablero('a2', { aceptadoEn: hace(300), terminalId: 'tB', terminalNombre: 'Monterrey', clienteId: 'cB', clienteNombre: 'Cliente Beta' });
  const hs = [
    ...hitosDe('a1', { llegada_carga: { estado: 'recibido', fuente: 'texto', mensajeEn: hace(50), recibidoEn: hace(50), contactoNombre: 'Recibidor Privado', contactoArea: 'Almacén' } }),
    ...hitosDe('a2'),
  ];
  const ajeno = viajeTablero('b1', { citaOrigenEn: futuro, terminalNombre: 'Tijuana', clienteNombre: 'Cliente de Otra Flota' });
  return {
    [A]: {
      datos: { ...datosVacios(), viajes: [sano, mudo], hitos: hs, acciones: [{ id: 'x', hitoId: 'a2-llegada_carga', accion: 'capturar' as never, usuarioEmail: 'oficina@privado.example', motivo: 'm', horaDeclarada: null, creadaEn: hace(10) } as never] },
      posiciones: { 'u-a1': { lat: 20.6736, lng: -103.3441, medidaEn: hace(3) }, 'u-a2': { lat: 25.6866, lng: -100.3161, medidaEn: hace(900) } },
      terminales: [{ id: 'tA', nombre: 'Guadalajara' }, { id: 'tB', nombre: 'Monterrey' }],
      clientes: [{ id: 'cA', nombre: 'Cliente Alfa' }, { id: 'cB', nombre: 'Cliente Beta' }],
      folios: ['F-a1', 'F-a2'],
    },
    [B]: {
      datos: { ...datosVacios(), viajes: [ajeno], hitos: hitosDe('b1') },
      posiciones: { 'u-b1': { lat: 32.5, lng: -117.0, medidaEn: hace(2) } },
      terminales: [{ id: 'tZ', nombre: 'Tijuana' }], clientes: [], folios: ['F-b1'],
    },
  };
}

function armar(rol: string | undefined, tenantId = A, usuarioId = 'u-1') {
  const m = crearFuentesEnMemoria(mundos());
  ponerFuentes(m.fuentes);
  const exec = conPermisos(rol, makeExecutor({ tenantId, rol, usuarioId, runId: 'r1', conversationId: 'r1' }));
  const llamar = async (nombre: string, args: Record<string, unknown> = {}) => {
    const r = await exec(nombre, args);
    return r.result as Record<string, any>;
  };
  return { m, llamar };
}
afterEach(() => ponerFuentes(null));

describe('contrato de las herramientas', () => {
  const NUEVAS = ['tablero_viajes', 'detalle_viaje', 'estado_vigia', 'estado_buzon', 'estado_cobranza', 'estado_autofactura', 'salud_agentes', 'escalar_a_persona'];

  it('están registradas y ninguna acepta una flota, un tenant ni una consulta como parámetro', () => {
    const esquemas = toolSchemas(NUEVAS);
    expect(esquemas.map((s) => (s as any).function.name)).toEqual(NUEVAS);
    for (const s of esquemas) {
      const p = (s as any).function.parameters;
      expect(p.additionalProperties).toBe(false);
      for (const [k, def] of Object.entries<any>(p.properties)) {
        expect(k).not.toMatch(/tenant|flota_id|sql|query|where|filtro_sql|url|telefono|correo/i);
        // Todo string o es un enum cerrado o está acotado.
        if (def.type === 'string') expect(def.enum !== undefined || typeof def.maxLength === 'number').toBe(true);
      }
    }
  });

  it('todas las herramientas del orquestador tienen área declarada', () => {
    for (const n of NUEVAS) expect(Object.keys(AREA_POR_HERRAMIENTA)).toContain(n);
  });
});

describe('aislamiento de tenant', () => {
  it('el tablero de A solo trae viajes de A y solo se le pregunta a A', async () => {
    const { m, llamar } = armar('encargado', A);
    const r = await llamar('tablero_viajes');
    expect(r.viajes.map((v: any) => v.folio).sort()).toEqual(['F-a1', 'F-a2']);
    expect(JSON.stringify(r)).not.toMatch(/Tijuana|Otra Flota|F-b1/);
    expect(m.llamadas.length).toBeGreaterThan(0);
    expect(m.llamadas.every((l) => l.tenantId === A)).toBe(true);
  });

  it('la misma herramienta con la sesión de B trae solo lo de B', async () => {
    const { m, llamar } = armar('encargado', B);
    const r = await llamar('tablero_viajes');
    expect(r.viajes.map((v: any) => v.folio)).toEqual(['F-b1']);
    expect(m.llamadas.every((l) => l.tenantId === B)).toBe(true);
  });

  it('un modelo que mete un tenant en los argumentos no cambia de flota', async () => {
    const { m, llamar } = armar('encargado', A);
    await llamar('tablero_viajes', { tenant_id: B, tenantId: B, flota: B } as never);
    expect(m.llamadas.every((l) => l.tenantId === A)).toBe(true);
  });

  it('el folio de otra flota no se encuentra (no se filtra ni su existencia)', async () => {
    const { llamar } = armar('encargado', A);
    const r = await llamar('detalle_viaje', { folio: 'F-b1' });
    expect(r.encontrado).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/Tijuana|Otra Flota/);
  });
});

describe('permisos por rol', () => {
  it('el encargado (operación) NO llega a las fuentes de dinero: se niega sin tocar la fuente', async () => {
    const { m, llamar } = armar('encargado');
    for (const t of ['estado_cobranza', 'estado_buzon', 'estado_autofactura']) {
      const r = await llamar(t);
      expect(r.error).toBe('sin_permiso');
    }
    expect(m.llamadas.filter((l) => ['cobranza', 'buzon', 'autofactura'].includes(l.fuente))).toEqual([]);
  });

  it('el contador (dinero) NO ve el tablero ni el Vigía ni la salud', async () => {
    const { m, llamar } = armar('contador');
    for (const t of ['tablero_viajes', 'detalle_viaje', 'estado_vigia', 'salud_agentes']) {
      expect((await llamar(t, { folio: 'F-a1' })).error).toBe('sin_permiso');
    }
    expect(m.llamadas).toEqual([]);
  });

  it('sin rol (o rol desconocido) no se ejecuta nada, ni la acción', async () => {
    for (const rol of [undefined, 'operador', 'inventado']) {
      const { m, llamar } = armar(rol);
      expect((await llamar('tablero_viajes')).error).toBe('sin_permiso');
      expect((await llamar('escalar_a_persona', { destino: 'mesa_de_control', motivo: 'otro', resumen: 'x' })).error).toBe('sin_permiso');
      expect(m.llamadas).toEqual([]);
    }
  });

  it('una herramienta que no existe (p. ej. SQL libre) se rechaza aunque el rol sea el dueño', async () => {
    const { llamar } = armar('flota_admin');
    const r = await makeExecutor({ tenantId: A, rol: 'flota_admin' })('ejecutar_sql', { sql: 'select 1' });
    expect(r.success).toBe(false);
    expect((await llamar('ejecutar_sql', { sql: 'select 1' })).error).toBe('sin_permiso');
  });

  it('el handler se niega aunque el wrapper se saltara (defensa en profundidad)', async () => {
    const m = crearFuentesEnMemoria(mundos());
    ponerFuentes(m.fuentes);
    const r = await makeExecutor({ tenantId: A, rol: 'contador', runId: 'r' })('tablero_viajes', {});
    expect((r.result as any).error).toBe('sin_permiso');
    expect(m.llamadas).toEqual([]);
  });
});

describe('tablero_viajes', () => {
  it('trae lo urgente primero, con antigüedad del GPS y excepciones', async () => {
    const { llamar } = armar('encargado');
    const r = await llamar('tablero_viajes');
    expect(r.gpsDisponible).toBe(true);
    expect(r.viajes[0]).toMatchObject({ folio: 'F-a2', senalDeVida: 'sin_senal' });
    expect(r.viajes[0].gps).toMatchObject({ antiguedadMin: 900, frescura: 'obsoleta' });
    expect(r.viajes[0].excepciones.map((e: any) => e.tipo)).toEqual(expect.arrayContaining(['sin_senal_de_vida', 'gps_obsoleto']));
    expect(r.conteos).toMatchObject({ viajes: 2, sinSenal: 1 });
  });

  it('filtra por terminal y por cliente por NOMBRE; ambiguo o inexistente devuelve opciones, no adivina', async () => {
    const { llamar } = armar('encargado');
    expect((await llamar('tablero_viajes', { terminal: 'guadalajara' })).viajes.map((v: any) => v.folio)).toEqual(['F-a1']);
    expect((await llamar('tablero_viajes', { cliente: 'beta' })).viajes.map((v: any) => v.folio)).toEqual(['F-a2']);
    const x = await llamar('tablero_viajes', { terminal: 'Cancún' });
    expect(x).toMatchObject({ error: 'filtro_sin_resolver', campo: 'terminal' });
    expect(x.opciones).toEqual(['Guadalajara', 'Monterrey']);
    expect(x.viajes).toBeUndefined();
  });

  it('vista=solo_excepciones deja fuera al viaje sano', async () => {
    const { llamar } = armar('flota_admin');
    expect((await llamar('tablero_viajes', { vista: 'solo_excepciones' })).viajes.map((v: any) => v.folio)).toEqual(['F-a2']);
  });

  it('SIN PII de más: ni contacto del andén, ni correo de oficina, ni ids internos, ni coordenadas exactas', async () => {
    const { llamar } = armar('flota_admin');
    const crudo = JSON.stringify([await llamar('tablero_viajes'), await llamar('detalle_viaje', { folio: 'F-a1' })]);
    for (const prohibido of ['Recibidor Privado', 'Almacén', 'oficina@privado.example', '"viajeId"', '"operadorId"', '"unidadId"', 'u-a1', '20.6736', '-103.3441']) {
      expect(crudo).not.toContain(prohibido);
    }
    expect(crudo).toContain('20.67'); // aproximada
  });

  it('sin posiciones (la lectura falló) no afirma «sin señal»: lo declara', async () => {
    const mm = mundos();
    const m = crearFuentesEnMemoria({ ...mm, [A]: { ...mm[A], posiciones: null } });
    ponerFuentes(m.fuentes);
    const exec = conPermisos('encargado', makeExecutor({ tenantId: A, rol: 'encargado' }));
    const r = (await exec('tablero_viajes', {})).result as any;
    expect(r.gpsDisponible).toBe(false);
    expect(r.notaGps).toMatch(/NO afirmes/);
    expect(r.viajes.every((v: any) => v.gps === null)).toBe(true);
    expect(r.viajes.flatMap((v: any) => v.excepciones.map((e: any) => e.tipo))).not.toContain('sin_posicion');
  });
});

describe('detalle_viaje', () => {
  it('trae la línea de hitos y la última posición', async () => {
    const { llamar } = armar('encargado');
    const r = await llamar('detalle_viaje', { folio: 'f-a1' });
    expect(r.encontrado).toBe(true);
    expect(r.linea).toHaveLength(5);
    expect(r.linea[0]).toMatchObject({ estado: 'recibido' });
    expect(r.gps.frescura).toBe('en_vivo');
  });
  it('folio vacío o de un viaje que no está en curso: lo dice', async () => {
    const { llamar } = armar('encargado');
    expect((await llamar('detalle_viaje', { folio: '  ' })).error).toBe('folio_vacio');
    expect((await llamar('detalle_viaje', { folio: 'NO-EXISTE' })).encontrado).toBe(false);
  });
});

describe('escalar_a_persona (la única acción)', () => {
  const ARGS = { destino: 'mesa_de_control', motivo: 'posible_emergencia', viaje_folio: 'F-a2', resumen: 'El chofer no contesta desde hace horas y el GPS está viejo.' };

  it('abre una tarea con el rol y el usuario de la SESIÓN, y le dice a la persona a quién se lo pasó', async () => {
    const { m, llamar } = armar('encargado', A, 'usuario-77');
    const r = await llamar('escalar_a_persona', ARGS);
    expect(r).toMatchObject({ creada: true, destino: 'mesa_de_control' });
    expect(r.mensajeParaLaPersona).toMatch(/la mesa de control/);
    const t = m.tareas.get(A)!;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ pedidaPorRol: 'encargado', usuarioId: 'usuario-77', viajeFolio: 'F-a2', tenantId: A });
    expect(m.tareas.get(B)).toBeUndefined();
  });

  it('preguntar dos veces lo mismo no abre dos tareas', async () => {
    const { m, llamar } = armar('encargado');
    await llamar('escalar_a_persona', ARGS);
    const r2 = await llamar('escalar_a_persona', ARGS);
    expect(r2).toMatchObject({ creada: false, yaAbierta: true });
    expect(m.tareas.get(A)).toHaveLength(1);
  });

  it('el contador también puede escalar una diferencia de liquidación', async () => {
    const { m, llamar } = armar('contador');
    const r = await llamar('escalar_a_persona', { destino: 'liquidacion', motivo: 'diferencia_liquidacion', resumen: 'Diferencia de 1,200 pesos que no cuadra con el anticipo.' });
    expect(r.creada).toBe(true);
    expect(m.tareas.get(A)![0].pedidaPorRol).toBe('contador');
  });

  it('valida con listas cerradas: destino o motivo inventados NO llegan a la fuente', async () => {
    const { m, llamar } = armar('encargado');
    expect((await llamar('escalar_a_persona', { ...ARGS, destino: 'el_director' })).error).toMatch(/destino inválido/);
    expect((await llamar('escalar_a_persona', { ...ARGS, motivo: 'chisme' })).error).toMatch(/motivo inválido/);
    expect((await llamar('escalar_a_persona', { ...ARGS, resumen: '   ' })).error).toMatch(/resumen vacío/);
    expect((await llamar('escalar_a_persona', { ...ARGS, viaje_folio: "x'; drop table viaje;--" })).error).toMatch(/viaje_folio inválido/);
    expect(m.llamadas.filter((l) => l.fuente === 'crearEscalacion')).toEqual([]);
  });

  it('el resumen se limpia: teléfonos, correos y enlaces no se guardan', async () => {
    const { m, llamar } = armar('encargado');
    await llamar('escalar_a_persona', { ...ARGS, resumen: 'Llamar al 55 1234 5678 o a chofer@ejemplo.com, ver https://x.example/ruta?token=abc' });
    const guardado = m.tareas.get(A)![0].resumen;
    expect(guardado).not.toMatch(/1234|@|https/);
    expect(guardado).toContain('[número]');
  });

  it('folio que no existe en la flota → se le pide el correcto; base sin migrar → se dice y se le indica avisar a mano', async () => {
    const { llamar } = armar('encargado');
    expect(await llamar('escalar_a_persona', { ...ARGS, viaje_folio: 'F-b1' })).toMatchObject({ creada: false, error: 'folio_no_encontrado' });
    const mm = mundos();
    ponerFuentes(crearFuentesEnMemoria({ ...mm, [A]: { ...mm[A], escalacionesDisponibles: false } }).fuentes);
    const r = (await conPermisos('encargado', makeExecutor({ tenantId: A, rol: 'encargado' }))('escalar_a_persona', ARGS)).result as any;
    expect(r).toMatchObject({ creada: false, error: 'escalamiento_no_disponible' });
    expect(r.mensajeParaLaPersona).toMatch(/Avisa tú directamente/);
  });
});

describe('salud_agentes: si un agente falla, se reporta', () => {
  it('latido caído y corrida fallida aparecen por agente', async () => {
    const mm = mundos();
    const m = crearFuentesEnMemoria({
      ...mm,
      [A]: { ...mm[A], salud: { ahora: new Date(AHORA), latidos: { 'conductor-hitos': { estado: 'vencido', haceMin: 120, ultimoEstado: 'ok' } }, corridas: { cobranza: [{ estado: 'fallo', inicio: hace(30), fin: hace(29), error: 'Meta rechazó' }] }, enviosSinSalir: { vigiaFallidos24h: 2, buzonEntregasConProblema: 0 } } },
    });
    ponerFuentes(m.fuentes);
    const r = (await conPermisos('encargado', makeExecutor({ tenantId: A, rol: 'encargado' }))('salud_agentes', {})).result as any;
    const por = (id: string) => r.agentes.find((a: any) => a.agente === id);
    expect(por('conductor')).toMatchObject({ estado: 'con_problema' });
    expect(por('cobranza').problemas.join(' ')).toMatch(/falló: Meta rechazó/);
    expect(por('vigia').problemas.join(' ')).toMatch(/2 respuestas a clientes no salieron/);
    expect(r.conProblema).toBe(3);
  });
});
