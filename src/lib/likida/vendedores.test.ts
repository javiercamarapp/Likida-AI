import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// LA ZONA DE VENDEDORES (0105). Lo que se fija:
//   · el EMBUDO: qué transiciones existen y que `cerrado` es terminal;
//   · el REPARTO: equilibrado por carga y determinista;
//   · lo que el motor le MANDA a la base (no que el mock funcione — patrón
//     llave-api-escritura.test.ts): cerrar estampa `cerrado_en`, el ancla
//     `soloDeVendedor` viaja en lectura Y escritura, un UPDATE de 0 filas no
//     es éxito, y un error de lectura LANZA en vez de volverse "no hay";
//   · la COMISIÓN: una sola fuente (las constantes), citada por las páginas.
// ═══════════════════════════════════════════════════════════════════════════

type Registro = {
  tabla: string;
  op: string | null;
  payload: unknown;
  eq: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
  dentro: Array<[string, unknown]>;
  select: string | null;
};

const llamadas: Registro[] = [];
// Cola POR TABLA, consumida en orden: la misma tabla se consulta varias
// veces en un flujo (conteos, pendientes, updates) y cada consulta merece su
// propia respuesta.
const respuestas = new Map<string, Array<{ data: unknown; error: { message: string } | null }>>();

function builder(tabla: string) {
  const r: Registro = { tabla, op: null, payload: null, eq: [], is: [], dentro: [], select: null };
  llamadas.push(r);
  const responder = () => {
    const cola = respuestas.get(tabla);
    const res = cola && cola.length > 0 ? cola.shift()! : { data: null, error: null };
    // `count` = filas: así `traerTodo` demuestra la lectura completa en una
    // sola página y cada consulta consume exactamente UNA respuesta de la cola.
    return { ...res, count: Array.isArray(res.data) ? res.data.length : null };
  };
  const b: Record<string, unknown> = {};
  b.insert = (p: unknown) => { r.op = 'insert'; r.payload = p; return b; };
  b.update = (p: unknown) => { r.op = 'update'; r.payload = p; return b; };
  b.select = (cols: string) => { r.select = cols; if (!r.op) r.op = 'select'; return b; };
  b.eq = (c: string, v: unknown) => { r.eq.push([c, v]); return b; };
  b.is = (c: string, v: unknown) => { r.is.push([c, v]); return b; };
  b.in = (c: string, v: unknown) => { r.dentro.push([c, v]); return b; };
  b.order = () => b;
  b.range = () => b;
  b.limit = () => b;
  b.maybeSingle = async () => responder();
  b.single = async () => responder();
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(responder()).then(res, rej);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// `provisionar.ts` arrastra el cliente de Meta; aquí solo importa QUÉ se le
// pide (tenant null, rol vendedor) — se captura la llamada, no se re-prueba.
const provisionar = vi.fn(async () => ({ userId: 'u-nuevo' }));
vi.mock('@/lib/auth/provisionar', () => ({ provisionarUsuario: provisionar }));

const {
  COMISION_PRIMER_MES, COMISION_RECURRENTE, reglaComision,
  ESTADOS_PROSPECTO, TRANSICIONES_PROSPECTO, puedeTransicionar,
  validarProspecto, repartir, agruparConteos, conteosVacios, filtrarProspectosTexto,
  listarVendedores, crearProspecto, asignarProspecto, cambiarEstadoProspecto,
  actualizarNotasProspecto, asignarPendientes, invitarVendedor,
} = await import('./vendedores');
const { DatoInvalido } = await import('./errores');

const P1 = '11111111-2222-4333-8444-555555555555';
const V1 = '22222222-3333-4444-8555-666666666666';

beforeEach(async () => {
  // RES-19: `leerInterruptor` cachea 5 s por instancia y este archivo usa el
  // módulo REAL con una respuesta distinta por prueba — sin tirar la caché, la
  // lectura de una contestaría por la siguiente.
  (await import('@/lib/likida/interruptores')).olvidarInterruptores();
  llamadas.length = 0;
  respuestas.clear();
  provisionar.mockClear();
});

function de(tabla: string, op: string): Registro[] {
  return llamadas.filter((l) => l.tabla === tabla && l.op === op);
}

// ═══════════════════════════════════════════════════════════════════════════
// Dominio puro
// ═══════════════════════════════════════════════════════════════════════════

describe('el embudo: solo transiciones del dominio', () => {
  it('avanza por etapas y puede corregir un paso atrás', () => {
    expect(puedeTransicionar('nuevo', 'contactado')).toBe(true);
    expect(puedeTransicionar('contactado', 'demo')).toBe(true);
    expect(puedeTransicionar('demo', 'negociacion')).toBe(true);
    expect(puedeTransicionar('negociacion', 'cerrado')).toBe(true);
    expect(puedeTransicionar('demo', 'contactado')).toBe(true);
  });

  it('no se salta etapas hacia el cierre', () => {
    expect(puedeTransicionar('nuevo', 'cerrado')).toBe(false);
    expect(puedeTransicionar('contactado', 'cerrado')).toBe(false);
  });

  it('cerrado es TERMINAL: de él cuelgan cerrado_en, el tenant y la comisión', () => {
    for (const e of ESTADOS_PROSPECTO) {
      expect(puedeTransicionar('cerrado', e.valor)).toBe(false);
    }
    expect(TRANSICIONES_PROSPECTO.cerrado).toEqual([]);
  });

  it('perdido se reactiva a contactado (ya se le habló), no a nuevo', () => {
    expect(puedeTransicionar('perdido', 'contactado')).toBe(true);
    expect(puedeTransicionar('perdido', 'nuevo')).toBe(false);
  });

  it('un estado basura no transiciona a nada ni desde nada — fail closed', () => {
    expect(puedeTransicionar('tibio', 'contactado')).toBe(false);
    expect(puedeTransicionar('nuevo', 'tibio')).toBe(false);
  });
});

describe('validarProspecto — la empresa es lo único obligatorio', () => {
  const OK = {
    empresa: 'Transportes del Norte', contactoNombre: '', telefono: '', correo: '',
    ciudad: '', vacante: '', notas: '', vendedorId: '',
  };

  it('sin empresa no hay prospecto', () => {
    expect(() => validarProspecto({ ...OK, empresa: '   ' })).toThrow(DatoInvalido);
  });

  it('los opcionales vacíos quedan en null, no en cadena vacía', () => {
    const v = validarProspecto(OK);
    expect(v.contactoNombre).toBeNull();
    expect(v.correo).toBeNull();
    expect(v.vacante).toBeNull();
    expect(v.vendedorId).toBeNull();
  });

  it('un correo sin arroba se rechaza; un teléfono de 7 dígitos también', () => {
    expect(() => validarProspecto({ ...OK, correo: 'rh.empresa.com' })).toThrow(DatoInvalido);
    expect(() => validarProspecto({ ...OK, telefono: '1234567' })).toThrow(DatoInvalido);
  });

  it('un vendedorId con basura se rechaza antes de llegar a Postgres', () => {
    expect(() => validarProspecto({ ...OK, vendedorId: 'no-es-uuid' })).toThrow(DatoInvalido);
    expect(validarProspecto({ ...OK, vendedorId: V1 }).vendedorId).toBe(V1);
  });
});

describe('repartir — equilibrado por carga y determinista', () => {
  it('el que menos carga viva tiene recibe primero', () => {
    // a arranca en 0, b en 2: a recibe hasta emparejar y el empate lo gana
    // el id menor — cuatro pendientes acaban 3 para a, 1 para b.
    const plan = repartir(['p1', 'p2', 'p3', 'p4'], [{ id: 'a', vivos: 0 }, { id: 'b', vivos: 2 }]);
    expect(plan.get('a')).toEqual(['p1', 'p2', 'p3']);
    expect(plan.get('b')).toEqual(['p4']);
  });

  it('la misma entrada produce el mismo plan — sin suerte de por medio', () => {
    const entrada: [string[], Array<{ id: string; vivos: number }>] =
      [['p1', 'p2', 'p3'], [{ id: 'b', vivos: 1 }, { id: 'a', vivos: 1 }]];
    const uno = repartir(...entrada);
    const dos = repartir(...entrada);
    expect([...uno.entries()]).toEqual([...dos.entries()]);
    // Empate inicial: gana 'a' por id, no 'b' por venir primero en el array.
    expect(uno.get('a')![0]).toBe('p1');
  });

  it('sin vendedores el plan es vacío — repartir a nadie no inventa dueños', () => {
    expect(repartir(['p1'], []).size).toBe(0);
  });
});

describe('agruparConteos y filtro de texto', () => {
  it('cuenta por vendedor y por estado; un estado fuera del dominio se ignora', () => {
    const m = agruparConteos([
      { vendedorId: 'a', estado: 'nuevo' },
      { vendedorId: 'a', estado: 'cerrado' },
      { vendedorId: null, estado: 'nuevo' },
      { vendedorId: 'a', estado: 'tibio' },
    ]);
    expect(m.get('a')).toEqual({ ...conteosVacios(), nuevo: 1, cerrado: 1 });
    expect(m.get(null)).toEqual({ ...conteosVacios(), nuevo: 1 });
  });

  it('el filtro de texto ignora acentos y busca en empresa, vacante y ciudad', () => {
    const filas = [
      { empresa: 'Fletes León', vacante: null, ciudad: null },
      { empresa: 'TDN', vacante: 'Analista de liquidación', ciudad: null },
      { empresa: 'Otro', vacante: null, ciudad: 'Torreón' },
    ];
    expect(filtrarProspectosTexto(filas, 'leon')).toHaveLength(1);
    expect(filtrarProspectosTexto(filas, 'liquidacion')).toHaveLength(1);
    expect(filtrarProspectosTexto(filas, 'torreon')).toHaveLength(1);
    expect(filtrarProspectosTexto(filas, '')).toHaveLength(3);
  });
});

describe('la comisión tiene UNA fuente', () => {
  it('la regla pactada: 50% primer mes, 20% recurrente', () => {
    expect(COMISION_PRIMER_MES).toBe(0.5);
    expect(COMISION_RECURRENTE).toBe(0.2);
  });

  it('las palabras de pantalla salen de las constantes, no de un literal', () => {
    const r = reglaComision();
    expect(r.primerMes).toContain(`${Math.round(COMISION_PRIMER_MES * 100)}%`);
    expect(r.recurrente).toContain(`${Math.round(COMISION_RECURRENTE * 100)}%`);
    // La aclaración es parte de la regla: sin cobros reales no hay cifra.
    expect(r.aclaracion).toMatch(/cobros reales/);
    expect(r.aclaracion).toMatch(/\$0/);
  });

  it('las dos pantallas citan reglaComision() y no tienen un "50%" tecleado', () => {
    // Mismo patrón que tenants_reales.test.ts: contra el código fuente real.
    // Se escanean los componentes EXTRAÍDOS (consola/panel), que son donde la
    // regla se pinta — las páginas quedaron en puro gate (convención de
    // inicio-contenido.tsx para poder montarlas en preview sin sesión).
    for (const ruta of ['../../app/admin/vendedores/consola-vendedores.tsx', '../../app/vendedor/panel-vendedor.tsx']) {
      const src = readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
      expect(src, `${ruta} debe citar reglaComision()`).toMatch(/reglaComision\(\)/);
      expect(src, `${ruta} no debe teclear la comisión a mano`).not.toMatch(/50\s*%|20\s*%/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// IO — qué se le manda a la base
// ═══════════════════════════════════════════════════════════════════════════

describe('crearProspecto', () => {
  it('inserta lo validado con su fuente y devuelve el id', async () => {
    respuestas.set('prospecto', [{ data: { id: 'p-1' }, error: null }]);
    const id = await crearProspecto({
      empresa: 'TDN', contactoNombre: null, telefono: null, correo: null,
      ciudad: 'Nuevo Laredo', vacante: 'Analista de liquidaciones', notas: null, vendedorId: null,
    }, 'manual');
    expect(id).toBe('p-1');
    const [ins] = de('prospecto', 'insert');
    const fila = ins.payload as Record<string, unknown>;
    expect(fila.empresa).toBe('TDN');
    expect(fila.vacante).toBe('Analista de liquidaciones');
    expect(fila.fuente).toBe('manual');
    expect(fila.vendedor_id).toBeNull();
  });

  it('un error del insert LANZA — supabase reporta POR VALOR', async () => {
    respuestas.set('prospecto', [{ data: null, error: { message: 'boom' } }]);
    await expect(crearProspecto({
      empresa: 'TDN', contactoNombre: null, telefono: null, correo: null,
      ciudad: null, vacante: null, notas: null, vendedorId: null,
    })).rejects.toThrow(/crearProspecto: boom/);
  });

  it('con vendedor, primero comprueba que la cuenta SEA vendedor', async () => {
    // app_user vacío = esa cuenta no es un vendedor → ni se toca prospecto.
    respuestas.set('app_user', [{ data: [], error: null }]);
    await expect(crearProspecto({
      empresa: 'TDN', contactoNombre: null, telefono: null, correo: null,
      ciudad: null, vacante: null, notas: null, vendedorId: V1,
    })).rejects.toThrow(DatoInvalido);
    expect(de('prospecto', 'insert')).toHaveLength(0);
  });
});

describe('asignarProspecto', () => {
  it('ancla por id y escribe el vendedor comprobado', async () => {
    respuestas.set('app_user', [{ data: [{ id: V1 }], error: null }]);
    respuestas.set('prospecto', [{ data: [{ id: P1 }], error: null }]);
    await asignarProspecto(P1, V1);
    const [up] = de('prospecto', 'update');
    expect((up.payload as Record<string, unknown>).vendedor_id).toBe(V1);
    expect(up.eq).toContainEqual(['id', P1]);
  });

  it('un UPDATE de 0 filas no es éxito', async () => {
    respuestas.set('prospecto', [{ data: [], error: null }]);
    await expect(asignarProspecto(P1, null)).rejects.toThrow(DatoInvalido);
  });
});

describe('cambiarEstadoProspecto', () => {
  it('al cerrar estampa cerrado_en y ancla al estado leído', async () => {
    respuestas.set('prospecto', [
      { data: { id: P1, estado: 'negociacion' }, error: null },
      { data: [{ id: P1 }], error: null },
    ]);
    await cambiarEstadoProspecto(P1, 'cerrado');
    const [up] = de('prospecto', 'update');
    const fila = up.payload as Record<string, unknown>;
    expect(fila.estado).toBe('cerrado');
    expect(typeof fila.cerrado_en).toBe('string');
    // Anclado al estado que se leyó: si otro lo movió en medio, 0 filas.
    expect(up.eq).toContainEqual(['estado', 'negociacion']);
  });

  it('a un destino no-cerrado, cerrado_en viaja null — nunca queda fecha falsa', async () => {
    respuestas.set('prospecto', [
      { data: { id: P1, estado: 'nuevo' }, error: null },
      { data: [{ id: P1 }], error: null },
    ]);
    await cambiarEstadoProspecto(P1, 'contactado');
    const [up] = de('prospecto', 'update');
    expect((up.payload as Record<string, unknown>).cerrado_en).toBeNull();
  });

  it('una transición fuera del dominio rebota SIN tocar la base', async () => {
    respuestas.set('prospecto', [{ data: { id: P1, estado: 'nuevo' }, error: null }]);
    await expect(cambiarEstadoProspecto(P1, 'cerrado')).rejects.toThrow(DatoInvalido);
    expect(de('prospecto', 'update')).toHaveLength(0);
  });

  it('el ancla soloDeVendedor viaja en la LECTURA y en la ESCRITURA', async () => {
    respuestas.set('prospecto', [
      { data: { id: P1, estado: 'nuevo' }, error: null },
      { data: [{ id: P1 }], error: null },
    ]);
    await cambiarEstadoProspecto(P1, 'contactado', { soloDeVendedor: 'v-sesion' });
    const [lee] = de('prospecto', 'select');
    const [up] = de('prospecto', 'update');
    expect(lee.eq).toContainEqual(['vendedor_id', 'v-sesion']);
    expect(up.eq).toContainEqual(['vendedor_id', 'v-sesion']);
  });

  it('un prospecto ajeno "no existe" para esa sesión', async () => {
    respuestas.set('prospecto', [{ data: null, error: null }]);
    await expect(cambiarEstadoProspecto(P1, 'contactado', { soloDeVendedor: 'v-otro' }))
      .rejects.toThrow(/no existe o no es tuyo/);
  });
});

describe('actualizarNotasProspecto', () => {
  it('ancla al vendedor y "" borra la nota (null), no guarda vacío', async () => {
    respuestas.set('prospecto', [{ data: [{ id: P1 }], error: null }]);
    await actualizarNotasProspecto(P1, '   ', { soloDeVendedor: 'v-1' });
    const [up] = de('prospecto', 'update');
    expect((up.payload as Record<string, unknown>).notas).toBeNull();
    expect(up.eq).toContainEqual(['vendedor_id', 'v-1']);
  });
});

describe('listarVendedores', () => {
  it('arma los conteos reales y la tasa solo con cartera', async () => {
    respuestas.set('app_user', [{ data: [
      { id: 'v1', nombre: 'Ana', email: 'ana@x.mx' },
      { id: 'v2', nombre: null, email: 'beto@x.mx' },
    ], error: null }]);
    respuestas.set('prospecto', [{ data: [
      { id: 'p1', vendedor_id: 'v1', estado: 'nuevo' },
      { id: 'p2', vendedor_id: 'v1', estado: 'cerrado' },
      { id: 'p3', vendedor_id: null, estado: 'nuevo' },
    ], error: null }]);
    const vs = await listarVendedores();
    const ana = vs.find((v) => v.id === 'v1')!;
    expect(ana.asignados).toBe(2);
    expect(ana.vivos).toBe(1);
    expect(ana.cerrados).toBe(1);
    expect(ana.tasaConversion).toBe(0.5);
    // Sin cartera NO hay tasa: null, jamás un 0% con cara de medición.
    const beto = vs.find((v) => v.id === 'v2')!;
    expect(beto.asignados).toBe(0);
    expect(beto.tasaConversion).toBeNull();
  });

  it('una base caída LANZA — no un equipo vacío', async () => {
    respuestas.set('app_user', [{ data: null, error: { message: '503' } }]);
    respuestas.set('prospecto', [{ data: [], error: null }]);
    await expect(listarVendedores()).rejects.toThrow(/503/);
  });
});

describe('invitarVendedor', () => {
  it('provisiona con tenant NULL y rol vendedor — cuenta de Likida', async () => {
    const r = await invitarVendedor(' Amigo@Correo.com ', 'El Amigo');
    expect(r.email).toBe('amigo@correo.com');
    expect(provisionar).toHaveBeenCalledWith(null, 'amigo@correo.com', 'El Amigo', 'vendedor');
  });

  it('un correo malformado rebota sin provisionar nada', async () => {
    await expect(invitarVendedor('no-es-correo', '')).rejects.toThrow(DatoInvalido);
    expect(provisionar).not.toHaveBeenCalled();
  });
});

describe('asignarPendientes — el agente asignador', () => {
  it('reparte equilibrado, ancla contra carreras y anota la corrida con tenant null', async () => {
    respuestas.set('app_user', [{ data: [
      { id: 'v1', nombre: 'Ana', email: 'ana@x.mx' },
      { id: 'v2', nombre: 'Beto', email: 'beto@x.mx' },
    ], error: null }]);
    respuestas.set('prospecto', [
      // 1) conteos de listarVendedores: Ana carga 1 vivo, Beto 0.
      { data: [{ id: 'px', vendedor_id: 'v1', estado: 'demo' }], error: null },
      // 2) pendientes (sin vendedor, en nuevo).
      { data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], error: null },
      // 3) updates en orden del plan: Beto primero (menos carga) con p1 y p3,
      //    luego Ana con p2.
      { data: [{ id: 'p1' }, { id: 'p3' }], error: null },
      { data: [{ id: 'p2' }], error: null },
    ]);
    respuestas.set('agente_corrida', [{ data: null, error: null }]);

    const r = await asignarPendientes();
    expect(r.repartidos).toBe(3);
    expect(r.pendientes).toBe(3);
    expect(r.porVendedor).toEqual([
      { vendedorId: 'v2', nombre: 'Beto', n: 2 },
      { vendedorId: 'v1', nombre: 'Ana', n: 1 },
    ]);

    // Cada update va anclado a "sigue sin vendedor y sigue en nuevo": el
    // asignador JAMÁS pisa una asignación hecha a mano en medio.
    for (const up of de('prospecto', 'update')) {
      expect(up.is).toContainEqual(['vendedor_id', null]);
      expect(up.eq).toContainEqual(['estado', 'nuevo']);
    }

    const [corrida] = de('agente_corrida', 'insert');
    const fila = corrida.payload as Record<string, unknown>;
    expect(fila.tenant_id).toBeNull();
    expect(fila.agente).toBe('ventas');
    expect(fila.estado).toBe('ok');
    expect(fila.tareas_hechas).toBe(3);
    expect(fila.tareas_total).toBe(3);
  });

  it('sin vendedores no reparte, lo dice, y la corrida queda como fallo', async () => {
    respuestas.set('app_user', [{ data: [], error: null }]);
    respuestas.set('prospecto', [
      { data: [], error: null },              // conteos
      { data: [{ id: 'p1' }], error: null },  // un pendiente esperando
    ]);
    respuestas.set('agente_corrida', [{ data: null, error: null }]);

    const r = await asignarPendientes();
    expect(r.sinVendedores).toBe(true);
    expect(r.repartidos).toBe(0);
    expect(de('prospecto', 'update')).toHaveLength(0);

    const [corrida] = de('agente_corrida', 'insert');
    expect((corrida.payload as Record<string, unknown>).estado).toBe('fallo');
  });

  it('sin pendientes la corrida es ok 0/0 — la verdad, no un "0/0" inventado', async () => {
    respuestas.set('app_user', [{ data: [{ id: 'v1', nombre: 'Ana', email: 'a@x.mx' }], error: null }]);
    respuestas.set('prospecto', [
      { data: [], error: null }, // conteos
      { data: [], error: null }, // pendientes
    ]);
    respuestas.set('agente_corrida', [{ data: null, error: null }]);
    const r = await asignarPendientes();
    expect(r.repartidos).toBe(0);
    expect(r.pendientes).toBe(0);
    const [corrida] = de('agente_corrida', 'insert');
    expect((corrida.payload as Record<string, unknown>).estado).toBe('ok');
  });

  // ── El kill switch (0110) — Fase 1 del blueprint, 15-ago-2026 ────────────
  // `agente:ventas` existía en el catálogo y ningún call site lo preguntaba.
  // El módulo `interruptores` aquí es el REAL (el builder le contesta como
  // cualquier tabla): se prueba la cadena completa, no un mock del mock.
  it('APAGADO: no lee vendedores, no reparte, no anota corrida — y lo dice como apagado', async () => {
    respuestas.set('interruptor', [{ data: { apagado: true }, error: null }]);
    const r = await asignarPendientes();
    expect(r.apagado).toBe(true);
    expect(r.repartidos).toBe(0);
    // Ni una lectura ni una escritura después de la palanca:
    expect(de('app_user', 'select')).toHaveLength(0);
    expect(de('prospecto', 'update')).toHaveLength(0);
    expect(de('agente_corrida', 'insert')).toHaveLength(0);
  });

  it('FAIL-CLOSED: la lectura del interruptor que FALLA también detiene el reparto', async () => {
    // Sin mockear estaApagado: el error por valor entra al módulo real y sale
    // como apagado. Si alguien lo "normaliza" (error = encendido), esto cae.
    respuestas.set('interruptor', [{ data: null, error: { message: 'fetch failed' } }]);
    const r = await asignarPendientes();
    expect(r.apagado).toBe(true);
    expect(de('prospecto', 'update')).toHaveLength(0);
    expect(de('agente_corrida', 'insert')).toHaveLength(0);
  });

  it('sin fila del interruptor (el default del catálogo), el reparto corre', async () => {
    respuestas.set('app_user', [{ data: [{ id: 'v1', nombre: 'Ana', email: 'a@x.mx' }], error: null }]);
    respuestas.set('prospecto', [
      { data: [], error: null },
      { data: [], error: null },
    ]);
    const r = await asignarPendientes();
    expect(r.apagado).toBeUndefined();
  });
});
