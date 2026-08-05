import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL VIAJE QUE NADIE ACEPTÓ — y la marca que impide repetir el aviso.
//
// Lo que este archivo protege, en orden de importancia:
//
//   1. SE ESCALA UNA SOLA VEZ. `escalado_en` se marca AUNQUE EL AVISO AL JEFE
//      FALLE, y eso parece un bug hasta que se piensa el caso contrario: con un
//      teléfono de jefe mal capturado, no marcar significa reintentar y fallar
//      cada hora para siempre, y que el registro no distinga "no revisado" de
//      "revisado y no había a quién avisar". La prueba lo fija para que nadie
//      lo "arregle" a la vuelta de seis meses.
//
//   2. UN ERROR NO ES UNA LISTA VACÍA. `viajesSinAceptar` lanza. Sin eso, una
//      base caída se leería como "hoy nadie dejó de aceptar" — el cron correría
//      verde mientras los viajes se pierden, que es el modo de falla que
//      CLAUDE.md manda cerrar con `exigir()`.
//
//   3. EL CORTE DE 5 H SE MIDE CONTRA `ahora` INYECTADO, no contra el reloj de
//      quien corre las pruebas.
//
// Se mockea `sendTemplate`, no `motivoDeFalloWhatsApp`: lo que hace útil un
// fallo es que el código de Meta se traduzca a algo que alguien pueda accionar.
// ═══════════════════════════════════════════════════════════════════════════

const { sendTemplate, avisarAlChofer, telefonosJefe } = vi.hoisted(() => ({
  sendTemplate: vi.fn(),
  avisarAlChofer: vi.fn(),
  telefonosJefe: vi.fn(),
}));

vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sendTemplate,
}));
vi.mock('./operacion', () => ({ avisarAlChofer }));
vi.mock('./contactos', () => ({ telefonosJefe }));

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

// ── La base ────────────────────────────────────────────────────────────────
/** Lo que devuelve el SELECT de viajes vencidos. */
let lectura: { data: unknown; error: { message: string } | null } = { data: [], error: null };
/** Lo que devuelve cada UPDATE, en orden. La última se repite si se acaban. */
let resultadosUpdate: Array<{ error: { message: string } | null }> = [];
/** Cada método de la cadena de lectura, con sus argumentos. */
const filtros: Array<[string, unknown[]]> = [];
/** Cada update ejecutado: qué se escribió y con qué filtro. */
const updates: Array<{ fila: Record<string, unknown>; por: [string, unknown] }> = [];

function cadenaLectura() {
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'not', 'lte', 'gte', 'limit', 'order']) {
    nodo[m] = (...a: unknown[]) => { filtros.push([m, a]); return nodo; };
  }
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(lectura).then(r);
  return nodo;
}

const from = vi.fn((tabla: string) => ({
  select: (...a: unknown[]) => { filtros.push([`select ${tabla}`, a]); return cadenaLectura(); },
  update: (fila: Record<string, unknown>) => ({
    eq: (col: string, val: unknown) => {
      updates.push({ fila, por: [col, val] });
      return Promise.resolve(resultadosUpdate[updates.length - 1] ?? resultadosUpdate.at(-1) ?? { error: null });
    },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }),
}));

const { viajesSinAceptar, armarAvisoJefe, escalarViajesSinAceptar, HORAS_PARA_ESCALAR } =
  await import('./escalar_viaje');

const AHORA = new Date('2026-08-04T18:00:00.000Z');
/** El instante exacto en que un viaje avisado empieza a contar como vencido. */
const LIMITE = '2026-08-04T13:00:00.000Z';

/** Una fila como la devuelve PostgREST para la consulta de `viajesSinAceptar`. */
const fila = (o: Record<string, unknown> = {}) => ({
  id: 'v-1', tenant_id: 't-1', folio: 'VJ-104', operador_id: 'o-1',
  avisado_en: '2026-08-04T08:00:00.000Z', avisos_enviados: 1,
  operador: { nombre: 'Juan Pérez' },
  ...o,
});

beforeEach(() => {
  lectura = { data: [], error: null };
  resultadosUpdate = [{ error: null }];
  filtros.length = 0;
  updates.length = 0;
  from.mockClear();
  sendTemplate.mockReset();
  sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.TEST' });
  avisarAlChofer.mockReset();
  avisarAlChofer.mockResolvedValue(undefined);
  telefonosJefe.mockReset();
  telefonosJefe.mockResolvedValue({});
  for (const f of Object.values(logger)) f.mockReset();
});

/** Los argumentos con que se llamó un método de la cadena. */
const args = (metodo: string) => filtros.filter(([m]) => m === metodo).map(([, a]) => a);

// ═══════════════════════════════════════════════════════════════════════════
// viajesSinAceptar
// ═══════════════════════════════════════════════════════════════════════════

describe('viajesSinAceptar', () => {
  it('pide solo los abiertos, sin aceptar, sin escalar y ya avisados', async () => {
    await viajesSinAceptar(AHORA);
    expect(from).toHaveBeenCalledWith('viaje');
    expect(args('eq')).toContainEqual(['estatus', 'abierto']);
    // Sin `aceptado_en is null` se le insistiría a quien ya contestó.
    expect(args('is')).toContainEqual(['aceptado_en', null]);
    // Sin `escalado_en is null` el jefe recibe el mismo aviso cada hora, que es
    // como se entrena a un canal para que se ignore.
    expect(args('is')).toContainEqual(['escalado_en', null]);
    // Un viaje que nunca se avisó no ha empezado a correr ningún reloj.
    expect(args('not')).toContainEqual(['avisado_en', 'is', null]);
    expect(args('limit')).toContainEqual([100]);
  });

  it('el corte son 5 h EXACTAS contadas desde el `ahora` que se le pasa', async () => {
    await viajesSinAceptar(AHORA);
    const [[columna, limite]] = args('lte') as Array<[string, string]>;
    expect(columna).toBe('avisado_en');
    expect(limite).toBe(LIMITE);
    expect(HORAS_PARA_ESCALAR).toBe(5);

    // El filtro lo aplica PostgREST, así que lo que se puede fijar aquí es el
    // parámetro — y contra él sí se puede comprobar el borde con aritmética de
    // fechas, que es donde vive el error de una hora.
    const avisadoHace = (h: number, m = 0) =>
      new Date(AHORA.getTime() - (h * 3_600_000 + m * 60_000)).toISOString();

    expect(avisadoHace(4, 59) <= limite).toBe(false);   // 4 h 59 → todavía no
    expect(avisadoHace(5, 0) <= limite).toBe(true);     // 5 h en punto → sí (lte)
    expect(avisadoHace(5, 1) <= limite).toBe(true);     // 5 h 01 → sí
  });

  it('sin `ahora` usa el reloj, pero sigue restando 5 h', async () => {
    const antes = Date.now();
    await viajesSinAceptar();
    const [[, limite]] = args('lte') as Array<[string, string]>;
    const delta = antes - Date.parse(limite);
    expect(delta).toBeGreaterThanOrEqual(5 * 3_600_000);
    expect(delta).toBeLessThan(5 * 3_600_000 + 5_000);
  });

  it('UN ERROR NO ES UNA LISTA VACÍA: lanza en vez de decir que no hay viajes', async () => {
    lectura = { data: null, error: { message: 'timeout' } };
    await expect(viajesSinAceptar(AHORA)).rejects.toThrow(/timeout/);
  });

  it('sin filas devuelve [] y no revienta', async () => {
    lectura = { data: null, error: null };
    expect(await viajesSinAceptar(AHORA)).toEqual([]);
  });

  it('mapea el nombre del operador venga como objeto o como arreglo', async () => {
    // PostgREST devuelve la relación embebida como objeto o como arreglo según
    // cómo infiera la cardinalidad; el mismo `select` cambia de forma entre
    // versiones. Si esto se leyera de una sola manera, el aviso al jefe diría
    // "Tu chofer" en vez del nombre, sin fallar.
    lectura = { data: [fila({ id: 'a' }), fila({ id: 'b', operador: [{ nombre: 'Ana Ruiz' }] })], error: null };
    const r = await viajesSinAceptar(AHORA);
    expect(r.map((v) => v.operadorNombre)).toEqual(['Juan Pérez', 'Ana Ruiz']);
  });

  it('lo que no está capturado viaja como null, no como texto inventado', async () => {
    lectura = { data: [fila({ folio: null, operador_id: null, operador: null, avisos_enviados: null })], error: null };
    const [v] = await viajesSinAceptar(AHORA);
    expect(v).toMatchObject({ folio: null, operadorId: null, operadorNombre: null, avisosEnviados: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// armarAvisoJefe
// ═══════════════════════════════════════════════════════════════════════════

const VIAJE = {
  id: 'v-1', tenantId: 't-1', folio: 'VJ-104', operadorId: 'o-1',
  operadorNombre: 'Juan Pérez', avisadoEn: '2026-08-04T08:00:00.000Z', avisosEnviados: 1,
};

describe('armarAvisoJefe', () => {
  it('dice quién, cuál viaje, cuánto lleva y qué puede hacer', () => {
    const t = armarAvisoJefe(VIAJE);
    expect(t).toContain('Juan Pérez');
    expect(t).toContain('VJ-104');
    expect(t).toContain('5 horas');
    // Sin la acción es una notificación; con ella es una decisión que se puede
    // tomar desde el teléfono.
    expect(t).toMatch(/reasignarlo desde Despacho/i);
    expect(t).toMatch(/insistimos/i);
  });

  it('sin nombre capturado no deja un hueco ni escribe "null"', () => {
    const t = armarAvisoJefe({ ...VIAJE, operadorNombre: null });
    expect(t).toMatch(/^El chofer asignado/);
    expect(t).not.toMatch(/null|undefined/);
  });

  it('sin folio se refiere al viaje sin inventarle uno', () => {
    const t = armarAvisoJefe({ ...VIAJE, folio: null });
    expect(t).toContain('el viaje que le asignaste');
    expect(t).not.toMatch(/null|undefined|sin folio/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// escalarViajesSinAceptar
// ═══════════════════════════════════════════════════════════════════════════

const TEL = { 't-1': '529993700779' };

describe('escalarViajesSinAceptar', () => {
  it('insiste al chofer, avisa al jefe y marca el viaje', async () => {
    lectura = { data: [fila()], error: null };
    const r = await escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA });

    expect(avisarAlChofer).toHaveBeenCalledWith('t-1', 'o-1', 'v-1');
    const [to, plantilla, opciones] = sendTemplate.mock.calls[0] as [string, string, { parametros: string[] }];
    expect(to).toBe(TEL['t-1']);
    expect(plantilla).toBe('recordatorio_cierre');
    expect(opciones.parametros).toEqual(['Juan Pérez', 'VJ-104']);

    expect(updates).toHaveLength(1);
    expect(updates[0].por).toEqual(['id', 'v-1']);
    expect(typeof updates[0].fila.escalado_en).toBe('string');
    expect(updates[0].fila.avisos_enviados).toBe(2);   // el que ya llevaba + este
    expect(r).toEqual({ revisados: 1, reintentados: 1, escalados: 1, fallos: [] });
  });

  it('SE MARCA AUNQUE EL AVISO AL JEFE FALLE — y el fallo queda dicho', async () => {
    // Es la decisión del encabezado, y es la que un refactor "de limpieza"
    // rompe primero: sin la marca, un teléfono mal capturado hace que el cron
    // reintente y falle cada hora, para siempre, sobre el mismo viaje.
    sendTemplate.mockResolvedValue({ ok: false, error: 'Template name does not exist', codigo: 132001 });
    lectura = { data: [fila()], error: null };

    const r = await escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA });

    expect(updates).toHaveLength(1);
    expect(updates[0].fila).toHaveProperty('escalado_en');
    expect(r.escalados).toBe(1);
    // Traducido, no en crudo: el 132001 de Meta no le dice nada a nadie.
    expect(r.fallos[0]).toMatch(/no está aprobada/i);
    expect(r.fallos[0]).not.toContain('Template name does not exist');
  });

  it('sin teléfono de jefe se le insiste al chofer, se dice el hueco y SE MARCA igual', async () => {
    lectura = { data: [fila()], error: null };
    const r = await escalarViajesSinAceptar({ telefonoJefePorTenant: {}, ahora: AHORA });

    expect(sendTemplate).not.toHaveBeenCalled();
    expect(avisarAlChofer).toHaveBeenCalledTimes(1);
    expect(r.fallos[0]).toMatch(/no tiene teléfono de jefe registrado/i);
    expect(r.escalados).toBe(1);
  });

  it('si el reaviso al chofer falla, el jefe SE ENTERA igual', async () => {
    // La mitad que importa es la del jefe: es el único que puede cambiar de
    // personal. Que WhatsApp rechace el mensaje del chofer no puede tragarse la
    // decisión que sí se puede tomar.
    avisarAlChofer.mockRejectedValue(new Error('132001 plantilla en revisión'));
    lectura = { data: [fila()], error: null };

    const r = await escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA });

    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(r.reintentados).toBe(0);
    expect(r.escalados).toBe(1);
    expect(r.fallos.join(' ')).toMatch(/reaviso VJ-104: 132001/);
  });

  it('un viaje sin chofer asignado no intenta el reaviso, pero sí avisa y marca', async () => {
    lectura = { data: [fila({ operador_id: null, operador: null })], error: null };
    const r = await escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA });
    expect(avisarAlChofer).not.toHaveBeenCalled();
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ revisados: 1, reintentados: 0, escalados: 1 });
  });

  it('si la marca NO se pudo escribir, no se cuenta como escalado', async () => {
    // Y esto es lo que hace que el reintento de la siguiente corrida sea
    // correcto: el viaje sigue sin `escalado_en`, así que vuelve a salir en la
    // consulta. Contarlo como escalado aquí sería perderlo.
    resultadosUpdate = [{ error: { message: 'deadlock detected' } }];
    lectura = { data: [fila()], error: null };

    const r = await escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA });

    expect(r.escalados).toBe(0);
    expect(r.revisados).toBe(1);
    expect(r.fallos.join(' ')).toMatch(/marcar v-1: deadlock detected/);
  });

  it('una flota con varios viajes vencidos: se procesan todos, y uno malo no tumba al resto', async () => {
    lectura = {
      data: [
        fila({ id: 'v-1', folio: 'VJ-1' }),
        fila({ id: 'v-2', folio: 'VJ-2', operador: { nombre: 'Ana Ruiz' }, avisos_enviados: 3 }),
        fila({ id: 'v-3', folio: 'VJ-3' }),
      ],
      error: null,
    };
    // El del medio no se puede marcar; los otros dos tienen que salir enteros.
    resultadosUpdate = [{ error: null }, { error: { message: 'deadlock' } }, { error: null }];

    const r = await escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA });

    expect(sendTemplate).toHaveBeenCalledTimes(3);
    expect(avisarAlChofer).toHaveBeenCalledTimes(3);
    expect(updates.map((u) => u.por[1])).toEqual(['v-1', 'v-2', 'v-3']);
    // El contador de avisos es POR VIAJE, no global: el segundo llevaba 3.
    expect(updates[1].fila.avisos_enviados).toBe(4);
    expect(r).toMatchObject({ revisados: 3, reintentados: 3, escalados: 2 });
    expect(r.fallos).toHaveLength(1);
  });

  it('cada flota recibe el aviso en SU teléfono, y la que no tiene no le roba el de otra', async () => {
    lectura = {
      data: [fila({ id: 'v-1', tenant_id: 't-1' }), fila({ id: 'v-2', tenant_id: 't-2' })],
      error: null,
    };
    const r = await escalarViajesSinAceptar({
      telefonoJefePorTenant: { 't-1': '5211111111', 't-2': '5222222222' },
      ahora: AHORA,
    });
    expect(sendTemplate.mock.calls.map((c) => c[0])).toEqual(['5211111111', '5222222222']);
    expect(r.fallos).toEqual([]);
  });

  it('sin el mapa de teléfonos lo resuelve él, y solo para las flotas que salieron', async () => {
    // El mapa se deriva de la MISMA lista de viajes a propósito: con dos
    // consultas independientes, un viaje que cruce las 5 h entre una y otra se
    // marcaría como escalado sin que nadie le hubiera avisado al jefe.
    lectura = {
      data: [fila({ id: 'v-1', tenant_id: 't-1' }), fila({ id: 'v-2', tenant_id: 't-2' })],
      error: null,
    };
    telefonosJefe.mockResolvedValue({ 't-1': '5211111111', 't-2': '5222222222' });

    const r = await escalarViajesSinAceptar({ ahora: AHORA });

    expect(telefonosJefe).toHaveBeenCalledWith(['t-1', 't-2']);
    expect(sendTemplate.mock.calls.map((c) => c[0])).toEqual(['5211111111', '5222222222']);
    expect(r.escalados).toBe(2);
  });

  it('una flota sin jefe capturado en la base tampoco bloquea la marca', async () => {
    lectura = { data: [fila()], error: null };
    telefonosJefe.mockResolvedValue({});
    const r = await escalarViajesSinAceptar({ ahora: AHORA });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(r.escalados).toBe(1);
    expect(r.fallos[0]).toMatch(/no tiene teléfono de jefe registrado/i);
  });

  it('un mapa pasado a mano gana: no se consulta la base de contactos', async () => {
    lectura = { data: [fila()], error: null };
    await escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA });
    expect(telefonosJefe).not.toHaveBeenCalled();
  });

  it('sin viajes vencidos no manda nada ni escribe nada', async () => {
    lectura = { data: [], error: null };
    const r = await escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA });
    expect(r).toEqual({ revisados: 0, reintentados: 0, escalados: 0, fallos: [] });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('un error de la base no se traga: la corrida entera falla ruidosamente', async () => {
    lectura = { data: null, error: { message: 'connection refused' } };
    await expect(escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA }))
      .rejects.toThrow(/connection refused/);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('deja en el log el resumen de la corrida', async () => {
    lectura = { data: [fila()], error: null };
    await escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA });
    expect(logger.info).toHaveBeenCalledWith('viaje.escalacion', { revisados: 1, escalados: 1, fallos: 0 });
  });

  it('OJO · el UPDATE no acota por tenant, solo por id', async () => {
    // El resto del repo escribe `.eq('id', …).eq('tenant_id', …)` (ver
    // `reasignarOperador` y `acotada`). Aquí el id es la PK, así que hoy no hay
    // fuga; queda fijado para que se vea la excepción a la regla del repo y no
    // se copie a un update que sí pueda cruzar flotas.
    lectura = { data: [fila()], error: null };
    await escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA });
    expect(updates[0].por).toEqual(['id', 'v-1']);
  });

  it('RIESGO · si `sendTemplate` LANZA, el lote se aborta y el viaje queda sin marcar', async () => {
    // Hoy `sendTemplate` atrapa sus propios errores de red y devuelve
    // `{ok:false}`, así que esto no está pasando en producción. Pero el `await`
    // no tiene try/catch: el día que ese contrato cambie —o que reviente antes
    // del fetch— se pierde la marca del viaje EN CURSO y ninguno de los
    // siguientes se procesa. La invariante "se marca pase lo que pase" solo
    // aguanta los fallos POR VALOR.
    sendTemplate.mockRejectedValue(new Error('socket hang up'));
    lectura = { data: [fila({ id: 'v-1' }), fila({ id: 'v-2' })], error: null };

    await expect(escalarViajesSinAceptar({ telefonoJefePorTenant: TEL, ahora: AHORA }))
      .rejects.toThrow(/socket hang up/);
    expect(updates).toEqual([]);
    expect(avisarAlChofer).toHaveBeenCalledTimes(1);   // el segundo viaje ni se miró
  });
});
