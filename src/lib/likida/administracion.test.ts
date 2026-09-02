// ═══════════════════════════════════════════════════════════════════════════
// LAS CUATRO ALTAS QUE ANTES SE HACÍAN CON SQL A MANO.
//
// Cada una tiene un modo de fallo que NO truena y por eso hay que fijarlo:
//
//   · RFC malo      → la validación de receptor queda apagada en silencio y
//                     ninguna factura se rechaza por estar a nombre de otro.
//   · Teléfono repetido en otra flota → `resolveOperador` no filtra por tenant,
//                     así que devuelve una fila arbitraria y el gasto se anota
//                     en la flota equivocada. Dinero de A en los libros de B.
//   · Política guardada de golpe → borra los hermanos de `config` (estímulos,
//                     hidrocarburos) y el motor los lee con `if (x != null)`:
//                     no falla, SE SALTA el tope fiscal.
//   · Reabrir sin borrar la liquidación → el trigger de la 0036 mira si existe
//                     esa fila, no el estatus. Cuatro veces se dijo "ya lo
//                     reabrí" sobre un viaje que no aceptaba ni un gasto.
//
// Los cuatro son silenciosos. Ninguno lanza, ninguno aparece en un log de
// errores, y los cuatro se descubren semanas después mirando cifras raras.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [])), rpc: (...a: unknown[]) => rpc(...a) }),
}));

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

vi.mock('./config', () => ({ getConfig: vi.fn() }));

// `acquireViajeLock`/`releaseViajeLock` se mockean y `variantesTelefono` se deja
// REAL (`crearOperador` lo necesita) — mismo patrón que `xml_race_mutex.test.ts`
// usa para probar el mutex del lado de `processor.ts`.
const acquireViajeLock = vi.fn();
const releaseViajeLock = vi.fn();
vi.mock('./conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  acquireViajeLock: (...a: unknown[]) => acquireViajeLock(...a),
  releaseViajeLock: (...a: unknown[]) => releaseViajeLock(...a),
}));

const { crearFlota, crearOperador, actualizarOperador, guardarPolitica, guardarAjustesOperativos, reabrirViaje, DatoInvalido, armarPolitica, mensajeParaPantalla } =
  await import('./administracion');

/** Nodo encadenable: `.select().eq().in().limit().maybeSingle()` → `resultado`. */
function cadena(resultado: unknown) {
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'limit', 'order']) nodo[m] = () => nodo;
  nodo.maybeSingle = () => Promise.resolve(resultado);
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado).then(r);
  return nodo;
}

beforeEach(() => {
  from.mockReset();
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  for (const f of Object.values(logger)) f.mockReset();
  acquireViajeLock.mockReset().mockResolvedValue(true);
  releaseViajeLock.mockReset();
});

describe('crearFlota', () => {
  it('RECHAZA un RFC con dígito verificador malo, en vez de aceptarlo y apagar la validación', async () => {
    // El modo de fallo que esto impide: `getConfig` detecta el RFC inválido
    // pero para entonces solo puede loguear y seguir con la comprobación de
    // receptor APAGADA. La flota cree que se valida a nombre de quién vienen
    // sus facturas, y no se valida ninguna.
    await expect(crearFlota({ nombre: 'Transportes Prueba', rfc: 'GMX0902279XX' }))
      .rejects.toThrow(DatoInvalido);
    // Y no llegó a tocar la base: se rechaza antes de insertar nada.
    expect(from).not.toHaveBeenCalled();
  });

  it('acepta un RFC válido y crea el tenant', async () => {
    from.mockImplementation((tabla: string) =>
      tabla === 'tenant'
        ? { insert: () => cadena({ data: { id: 't-1' }, error: null }) }
        : { insert: () => Promise.resolve({ error: null }) });

    const r = await crearFlota({ nombre: 'Transportes Prueba', rfc: 'GMX0902279I1' });
    expect(r.tenantId).toBe('t-1');
  });

  it('un nombre de dos letras no pasa', async () => {
    await expect(crearFlota({ nombre: 'AB' })).rejects.toThrow(DatoInvalido);
  });

  // ── LOS CINCO DEL RECEPTOR (20-ago-2026) ─────────────────────────────────
  //
  // El quinto modo de fallo silencioso de esta familia, y el más caro: el alta
  // pedía nombre, RFC y régimen, pero `getFiscalDeFlota` exige CINCO —le faltan
  // razón social, CP fiscal y uso—. Sin los cinco devuelve `falta` y la flota no
  // se registra para facturar. O sea que toda flota nueva nacía sin poder
  // facturar un solo ticket, con el mismo mensaje verde que una completa, y el
  // hueco aparecía semanas después como un cron que no hacía nada.
  it('con los CINCO, el insert los lleva — la flota nace pudiendo facturar', async () => {
    const insert = vi.fn((_fila: Record<string, unknown>) => cadena({ data: { id: 't-1' }, error: null }));
    from.mockImplementation((tabla: string) =>
      tabla === 'tenant' ? { insert } : { insert: () => Promise.resolve({ error: null }) });

    await crearFlota({
      nombre: 'Transportes Prueba', rfc: 'gmx0902279i1', razonSocial: '  FLOTA SA DE CV  ',
      regimenFiscal: '601', codigoPostalFiscal: '36100', usoCfdi: 'G03',
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      rfc: 'GMX0902279I1',
      razon_social: 'FLOTA SA DE CV', // solo se recortan espacios: el SAT compara literal
      regimen_fiscal: '601',
      codigo_postal_fiscal: '36100',
      uso_cfdi: 'G03',
    }));
  });

  // ── FISC-C2-1 (auditoría 18-c2, CRÍTICO) ──────────────────────────────────
  // La RFA 2026 regla 2.9 —ficha `normas/rfa-2026-2.9.yaml`, verificada contra
  // fuente primaria— reserva la facilidad del 15% a quien tribute en «Título II,
  // Capítulo VII o Título IV, Capítulo II, Sección I». Título II Capítulo VII es
  // COORDINADOS (LISR 72-73), que en `c_RegimenFiscal` es la clave **624**; la
  // 601 es Título II en general, la S.A. de C.V. ordinaria. Se habían tomado por
  // la misma cosa, y el motor le concedía a una 601 el diésel pagado en efectivo
  // que la LISR 27-III le niega: $150,000 al tope del ejercicio ≈ $45,000 de ISR
  // declarados de menos, con la cita del artículo impresa al lado.
  it('un régimen 601 NO es elegible para la facilidad del 15%: no es el Capítulo VII', async () => {
    const insert = vi.fn((_fila: Record<string, unknown>) => cadena({ data: { id: 't-1' }, error: null }));
    from.mockImplementation((tabla: string) =>
      tabla === 'tenant' ? { insert } : { insert: () => Promise.resolve({ error: null }) });

    await crearFlota({
      nombre: 'Transportes del Bajío', rfc: 'GMX0902279I1', razonSocial: 'FLOTA SA DE CV',
      regimenFiscal: '601', codigoPostalFiscal: '36100', usoCfdi: 'G03',
      dedicacionExclusivaCarga: true,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      config: { facilidadCombustibleEfectivo: { dedicacionExclusivaCarga: true, regimenElegible: false } },
    }));
  });

  it('una persona física 612 (Título IV Cap. II Secc. I) SÍ es elegible', async () => {
    const insert = vi.fn((_fila: Record<string, unknown>) => cadena({ data: { id: 't-1' }, error: null }));
    from.mockImplementation((tabla: string) =>
      tabla === 'tenant' ? { insert } : { insert: () => Promise.resolve({ error: null }) });

    await crearFlota({
      nombre: 'Fletes Doña Chuy', rfc: 'GMX0902279I1', razonSocial: 'FLOTA SA DE CV',
      regimenFiscal: '612', codigoPostalFiscal: '36100', usoCfdi: 'G03',
      dedicacionExclusivaCarga: true,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      config: { facilidadCombustibleEfectivo: { dedicacionExclusivaCarga: true, regimenElegible: true } },
    }));
  });

  it('un CP de cuatro dígitos se rechaza ANTES de insertar, no deja la flota a medias', async () => {
    // Si la comprobación viviera dentro del update de la pantalla fiscal, este
    // clic ya habría creado el tenant y el error llegaría después del cambio.
    await expect(crearFlota({
      nombre: 'Transportes Prueba', rfc: 'GMX0902279I1', razonSocial: 'FLOTA SA DE CV',
      regimenFiscal: '601', codigoPostalFiscal: '3610', usoCfdi: 'G03',
    })).rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });

  it('un régimen fuera del catálogo que la facturación acepta se rechaza', async () => {
    // 605 (sueldos y salarios) lo ofrecía el <select> del alta y lo rechazaba el
    // validador fiscal: dos catálogos del mismo dato. Ahora la pantalla usa el
    // catálogo bueno, y aquí se fija cuál es el bueno.
    await expect(crearFlota({
      nombre: 'Transportes Prueba', rfc: 'GMX0902279I1', razonSocial: 'FLOTA SA DE CV',
      regimenFiscal: '605', codigoPostalFiscal: '36100', usoCfdi: 'G03',
    })).rejects.toThrow(DatoInvalido);
  });

  it('sin los fiscales se sigue pudiendo dar de alta, y NO se escriben a medias', async () => {
    // Una flota se da de alta para operar viajes y captura lo fiscal después.
    // Lo que ya no pasa es que se capture a medias y parezca completo.
    const insert = vi.fn((_fila: Record<string, unknown>) => cadena({ data: { id: 't-1' }, error: null }));
    from.mockImplementation((tabla: string) =>
      tabla === 'tenant' ? { insert } : { insert: () => Promise.resolve({ error: null }) });

    await crearFlota({ nombre: 'Transportes Prueba', rfc: 'GMX0902279I1', razonSocial: 'FLOTA SA DE CV' });

    const fila = insert.mock.calls[0][0];
    expect(fila.razon_social).toBeUndefined();
    expect(fila.codigo_postal_fiscal).toBeUndefined();
    expect(fila.uso_cfdi).toBeUndefined();
  });
});

describe('crearOperador', () => {
  it('RECHAZA un teléfono que ya existe en OTRA flota', async () => {
    // Es la fuga entre tenants: `resolveOperador` busca por teléfono sin
    // filtrar por tenant, así que con el número repetido el gasto se anota en
    // la flota que salga primero.
    // `activo: true` no es adorno del fixture: desde la auditoría 20 (H2) es
    // LA condición del bloqueo. La columna es `not null default true`, así que
    // en producción toda fila que choca trae la bandera puesta.
    from.mockImplementation(() => cadena({ data: [{ id: 'o-9', tenant_id: 'OTRA', nombre: 'Pedro', activo: true }], error: null }));

    await expect(crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '9993700779' }))
      .rejects.toThrow(/OTRA flota/i);
  });

  it('y también si ya está en LA MISMA flota, con un mensaje distinto', async () => {
    from.mockImplementation(() => cadena({ data: [{ id: 'o-9', tenant_id: 't-1', nombre: 'Pedro', activo: true }], error: null }));

    await expect(crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '9993700779' }))
      .rejects.toThrow(/ya está registrado en esta flota/i);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // AUDITORÍA 20 (H2) — EL TELÉFONO SE LIBERA CON LA BAJA
  //
  // El bloqueo miraba TODAS las filas con ese número, activas o no: más
  // estricto que `uq_operador_telefono_activo` (0024), que es parcial
  // `where activo` y cuyo comentario declara al revés la intención ("un
  // operador dado de baja en la flota A puede reaparecer en la flota B — eso
  // es una rotación normal y sigue permitido").
  //
  // Consecuencia real: el chofer que renunciaba se llevaba su celular a la
  // tumba. Ninguna otra flota podía contratarlo y la única salida era un
  // UPDATE a mano. Lo que NO se relaja: `resolveOperador` sigue buscando
  // `.eq('activo', true)`, así que dos filas ACTIVAS del mismo número —la
  // ambigüedad que anota el gasto en la flota equivocada— siguen prohibidas.
  // ═════════════════════════════════════════════════════════════════════════
  it('BAJA: un teléfono que solo pertenece a un operador INACTIVO de otra flota SÍ se puede dar de alta', async () => {
    const insertados: unknown[] = [];
    from.mockImplementation((tabla: string) => {
      const nodo: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit', 'order']) nodo[m] = () => nodo;
      // Solo la tabla `operador`: el segundo insert de esta llamada es el de
      // `bitacora_auditoria`, que también tiene que ocurrir pero no es lo que
      // se está midiendo aquí.
      nodo.insert = (v: unknown) => { if (tabla === 'operador') insertados.push(v); return nodo; };
      nodo.maybeSingle = () => Promise.resolve(
        insertados.length > 0
          ? { data: { id: 'o-nuevo' }, error: null }
          : { data: [{ id: 'o-9', tenant_id: 'OTRA', nombre: 'Pedro', activo: false }], error: null },
      );
      nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(
        { data: [{ id: 'o-9', tenant_id: 'OTRA', nombre: 'Pedro', activo: false }], error: null },
      ).then(r);
      return nodo;
    });

    const id = await crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '9993700779' });
    expect(id).toBe('o-nuevo');
    // Mutación: sin esta aserción, un `crearOperador` que devolviera un id
    // inventado sin escribir nada pasaría la prueba de arriba.
    expect(insertados).toHaveLength(1);
  });

  it('BAJA: pero si la fila inactiva es de MI PROPIA flota, se pide reactivarla — el otro índice de la 0024 no admite dos fichas', async () => {
    // `uq_operador_tenant_telefono_norm` es POR TENANT y sobre TODAS las
    // filas: dos fichas del mismo número en la misma flota partirían el
    // historial del chofer en dos. Se dice ANTES del insert, y se dice QUÉ
    // HACER, en vez de dejar que Postgres conteste con el nombre del índice.
    from.mockImplementation(() => cadena({ data: [{ id: 'o-9', tenant_id: 't-1', nombre: 'Pedro', activo: false }], error: null }));

    await expect(crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '9993700779' }))
      .rejects.toThrow(/dado de baja en tu flota/i);
  });

  it('BAJA: una fila ACTIVA sigue bloqueando aunque vengan inactivas antes que ella', async () => {
    // El `limit(2)` de antes podía llenarse con dos filas de baja y esconder a
    // la activa que sí choca — el bloqueo se caería justo en el número con más
    // rotación, que es el que más veces se re-captura.
    from.mockImplementation(() => cadena({
      data: [
        { id: 'o-7', tenant_id: 'VIEJA-A', nombre: 'Ana', activo: false },
        { id: 'o-8', tenant_id: 'VIEJA-B', nombre: 'Beto', activo: false },
        { id: 'o-9', tenant_id: 'OTRA', nombre: 'Pedro', activo: true },
      ],
      error: null,
    }));

    await expect(crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '9993700779' }))
      .rejects.toThrow(/OTRA flota/i);
  });

  it('FALLA CERRADO: si no se puede comprobar el duplicado, no da de alta', async () => {
    // Sin esto, un bache de red convertiría la comprobación en un "no hay
    // nadie" y crearía justo el duplicado que evita.
    from.mockImplementation(() => cadena({ data: null, error: { message: 'timeout' } }));

    await expect(crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '9993700779' }))
      .rejects.toThrow(/no se pudo comprobar/i);
  });

  it('normaliza 10 dígitos a la forma que Meta usa para enviar (52 + 10, sin el 1)', async () => {
    let guardado: Record<string, unknown> | undefined;
    from.mockImplementation((tabla: string) => {
      if (tabla === 'operador') {
        return {
          select: () => cadena({ data: [], error: null }),
          insert: (fila: Record<string, unknown>) => { guardado = fila; return cadena({ data: { id: 'o-1' }, error: null }); },
        };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    });

    await crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '999 370 0779' });
    expect(guardado?.telefono).toBe('529993700779');
  });

  it('un teléfono de 7 dígitos se rechaza con el conteo a la vista', async () => {
    await expect(crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '370 0779' }))
      .rejects.toThrow(/7 dígitos/);
  });
});

// El id de un operador de prueba. `actualizarOperador` valida forma de uuid
// ANTES de tocar la base, así que un `'o-1'` de los otros describes no sirve.
const OPERADOR_ID = '11111111-1111-1111-1111-111111111111';

/** Nodo de ESCRITURA: registra cada `.eq()` (para comprobar que el `WHERE`
 *  llevó el tenant) y resuelve en `resultado` al `await` — igual que `cadena`
 *  pero sin `maybeSingle`, porque `actualizarOperador` hace `.select('id')`
 *  sin `.single()` (el punto de la 0-filas es justo poder ver el arreglo vacío). */
function cadenaEscritura(resultado: unknown, eqs: Array<[string, unknown]> = []) {
  const nodo: Record<string, unknown> = {
    eq: (col: string, val: unknown) => { eqs.push([col, val]); return nodo; },
    select: () => nodo,
  };
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado).then(r);
  return nodo;
}

describe('actualizarOperador', () => {
  it('RECHAZA editar un operador de OTRA flota: 0 filas tocadas es error, no éxito silencioso', async () => {
    // El modo de fallo que esto impide: `.update().eq('tenant_id', ...)` de un
    // id que no es de esta flota toca CERO filas y Postgres no lo marca como
    // error — sin mirar `data.length`, la pantalla diría "guardado" sobre un
    // cambio que nunca ocurrió.
    from.mockImplementation((tabla: string) =>
      tabla === 'operador'
        ? { update: () => cadenaEscritura({ data: [], error: null }) }
        : { insert: () => Promise.resolve({ error: null }) });

    await expect(actualizarOperador('t-1', OPERADOR_ID, { licencia: 'ABC123' }))
      .rejects.toThrow(/no se encontró ese operador/i);
  });

  it('actualiza los campos editables, ANCLADO al tenant en el WHERE', async () => {
    let filaGuardada: Record<string, unknown> | undefined;
    const eqs: Array<[string, unknown]> = [];
    from.mockImplementation((tabla: string) =>
      tabla === 'operador'
        ? {
            update: (fila: Record<string, unknown>) => {
              filaGuardada = fila;
              return cadenaEscritura({ data: [{ id: OPERADOR_ID }], error: null }, eqs);
            },
          }
        : { insert: () => Promise.resolve({ error: null }) });

    await actualizarOperador('t-1', OPERADOR_ID, {
      licencia: 'B12345678', licenciaTipo: 'C', licenciaVence: '2027-03-12', rfc: 'gmx0902279i1',
    });

    expect(filaGuardada).toEqual({
      licencia: 'B12345678', licencia_tipo: 'C', licencia_vence: '2027-03-12', rfc: 'GMX0902279I1',
    });
    expect(eqs).toContainEqual(['id', OPERADOR_ID]);
    expect(eqs).toContainEqual(['tenant_id', 't-1']);
  });

  it('rechaza una licencia_vence que no es una fecha, sin tocar la base', async () => {
    await expect(actualizarOperador('t-1', OPERADOR_ID, { licenciaVence: 'ayer' }))
      .rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });

  it('rechaza un RFC con dígito verificador malo, sin tocar la base', async () => {
    await expect(actualizarOperador('t-1', OPERADOR_ID, { rfc: 'GMX0902279XX' }))
      .rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });

  it('rechaza un id de operador que no es un uuid, sin tocar la base', async () => {
    await expect(actualizarOperador('t-1', 'no-es-un-uuid', { licencia: 'ABC' }))
      .rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });

  it('sin ningún cambio, no hay nada que guardar', async () => {
    await expect(actualizarOperador('t-1', OPERADOR_ID, {}))
      .rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · DAT-20 — la mezcla de `tenant.config` se mudó DENTRO del
// UPDATE (`tenant_config_merge`, 0159).
//
// El bug viejo —escribir `{config: {politica}}` de golpe y llevarse por delante
// estímulos e hidrocarburos— ya estaba cerrado leyendo-mezclando-escribiendo.
// Lo que quedaba abierto es que esa mezcla se hacía contra el `config` que se
// LEYÓ, no contra el que hay al escribir: dos ediciones a la vez y la de en
// medio desaparece. Y ahí viven los topes fiscales.
//
// Por eso estas pruebas ya no miran el objeto que se escribe: miran que este
// módulo NO arme la config, que mande su PARCIAL y deje la mezcla a la base.
// Que la mezcla conserve a los hermanos y sea profunda se prueba contra
// Postgres (bloque 131 de verificaciones.sql), que es quien la hace.
// ═══════════════════════════════════════════════════════════════════════════
describe('guardarPolitica', () => {
  it('NO arma la config: manda el parcial y la base mezcla', async () => {
    from.mockImplementation(() => ({ insert: () => Promise.resolve({ error: null }) }));

    await guardarPolitica('t-1', [{ concepto: 'caseta', topeMonto: 1500 }]);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('tenant_config_merge');
    expect(rpc.mock.calls[0][1]).toEqual({
      p_tenant: 't-1',
      p_parcial: { politica: [{ concepto: 'caseta', topeMonto: 1500 }] },
      p_borrar: [],
    });
    // Y NADIE lee `config` para armarla: esa lectura era la mitad de la carrera.
    expect(from).not.toHaveBeenCalledWith('tenant');
  });

  it('rechaza un tope negativo', async () => {
    await expect(guardarPolitica('t-1', [{ concepto: 'diesel', topeMonto: -1 }]))
      .rejects.toThrow(DatoInvalido);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rechaza un renglón sin concepto', async () => {
    await expect(guardarPolitica('t-1', [{ concepto: '  ' }]))
      .rejects.toThrow(DatoInvalido);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('una flota que no existe (CU013) es dato de entrada, no una caída', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'CU013', message: 'flota inexistente' } });
    await expect(guardarPolitica('t-fantasma', [{ concepto: 'caseta' }]))
      .rejects.toThrow(DatoInvalido);
  });

  it('la base caída NO se traga: lanza Error y no anota la bitácora', async () => {
    const anotadas: unknown[] = [];
    from.mockImplementation(() => ({ insert: (f: unknown) => { anotadas.push(f); return Promise.resolve({ error: null }); } }));
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });

    const err = await guardarPolitica('t-1', [{ concepto: 'caseta' }]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DatoInvalido);
    expect(anotadas, 'una política que no se guardó no se anota como editada').toEqual([]);
  });
});

describe('guardarAjustesOperativos', () => {
  it('manda las TRES llaves de negocio como parcial, y ninguna más', async () => {
    // El corte entre "parámetros del negocio" y "parámetros de la ley" es
    // legal, no de interfaz: si aquí se colara una cuarta llave, la pantalla
    // estaría editando topes fiscales.
    from.mockImplementation(() => ({ insert: () => Promise.resolve({ error: null }) }));
    const ajustes = {
      tabulador: { rendimientoPorDefecto: 2.4 },
      catalogoCuentas: { diesel: '601-01' },
      salida: { formato: 'csv' },
    };

    await guardarAjustesOperativos('t-1', ajustes as never);

    expect(rpc.mock.calls[0][0]).toBe('tenant_config_merge');
    expect(Object.keys((rpc.mock.calls[0][1] as { p_parcial: object }).p_parcial).sort())
      .toEqual(['catalogoCuentas', 'salida', 'tabulador']);
  });
});

describe('reabrirViaje', () => {
  /** El `from` de siempre: el viaje se busca por folio, y el resto es plomería. */
  const baseFrom = (viaje: unknown = { data: { id: 'v-1', estatus: 'liquidado' }, error: null }) => {
    from.mockImplementation((tabla: string) => {
      if (tabla === 'viaje') return { select: () => cadena(viaje) };
      if (tabla === 'wa_conversacion') return { update: () => cadena({ error: null }) };
      return { insert: () => Promise.resolve({ error: null }) };
    });
  };

  it('sin confirmar no hace nada: borra un PDF que ya pudo entregarse', async () => {
    await expect(reabrirViaje('t-1', 'VJ-2026-0848', false)).rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('delega en el RPC atómico, anclado al tenant, y devuelve QUÉ PDF se perdió', async () => {
    baseFrom();
    rpc.mockResolvedValue({ data: { pdf_perdido: 'tenant/abc.pdf', hubo_liquidacion: true }, error: null });

    const r = await reabrirViaje('t-1', 'VJ-2026-0848', true);

    expect(rpc.mock.calls[0][0]).toBe('reabrir_viaje_tx');
    expect(rpc.mock.calls[0][1]).toEqual({ p_tenant: 't-1', p_viaje: 'v-1' });
    expect(r.pdfPerdido).toBe('tenant/abc.pdf');
  });

  // ── DAT-06 — EL REBOTE QUE DEJABA UN VIAJE LIQUIDADO SIN LIQUIDACIÓN ──────
  //
  // El orden era: borrar la liquidación, luego abrir el viaje. El segundo paso
  // puede fallar —`uq_viaje_abierto_por_operador` (0029) si el operador ya
  // tiene otro viaje abierto— y para entonces la liquidación ya no existe. La
  // transacción de la 0159 invierte el orden y revierte entera; aquí se prueba
  // que ese 23505 llega a la pantalla como una instrucción, no como un 500.
  it('el operador con otro viaje abierto: se explica qué hacer y se dice que la liquidación NO se tocó', async () => {
    baseFrom();
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_viaje_abierto_por_operador"' } });

    const err = await reabrirViaje('t-1', 'VJ-2026-0848', true).catch((e) => e);
    expect(err).toBeInstanceOf(DatoInvalido);
    expect(err.message).toMatch(/otro viaje abierto/);
    expect(err.message).toMatch(/NO se tocó/);
  });

  it('un folio de otra flota no se reabre', async () => {
    baseFrom({ data: null, error: null });
    await expect(reabrirViaje('t-1', 'VJ-DE-OTRA', true)).rejects.toThrow(/No existe el viaje/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('un viaje que se esfumó entre la búsqueda y el RPC (CU012) también es dato, no caída', async () => {
    baseFrom();
    rpc.mockResolvedValue({ data: null, error: { code: 'CU012', message: 'viaje fuera de la flota' } });
    await expect(reabrirViaje('t-1', 'VJ-2026-0848', true)).rejects.toThrow(/No existe el viaje/);
  });

  it('si el RPC truena, NO promete que no había PDF', async () => {
    baseFrom();
    rpc.mockResolvedValue({ data: null, error: { message: '57014 statement timeout' } });
    await expect(reabrirViaje('t-1', 'VJ-2026-0848', true)).rejects.toThrow(/57014/);
  });

  it('desligar la conversación de WhatsApp es best-effort: su fallo avisa pero no tumba el reabrir', async () => {
    from.mockImplementation((tabla: string) => {
      if (tabla === 'viaje') return { select: () => cadena({ data: { id: 'v-1', estatus: 'liquidado' }, error: null }) };
      if (tabla === 'wa_conversacion') return { update: () => cadena({ error: { message: 'caída' } }) };
      return { insert: () => Promise.resolve({ error: null }) };
    });
    rpc.mockResolvedValue({ data: { pdf_perdido: null, hubo_liquidacion: false }, error: null });

    await expect(reabrirViaje('t-1', 'VJ-2026-0848', true)).resolves.toEqual({ pdfPerdido: null });
    expect(logger.warn).toHaveBeenCalled();
  });

  // ── AUDITORÍA 10 — el mutex sigue, y sigue haciendo falta ─────────────────
  //
  // La transacción de la 0159 protege estas escrituras ENTRE SÍ, pero el cierre
  // calcula el cuadre y genera el PDF FUERA de su transacción: sin el mutex, un
  // "listo" en vuelo puede insertar una liquidación nueva justo después de que
  // ésta se retire, y el viaje queda `abierto` con liquidación viva — la 0036
  // no deja entrar entonces ni un gasto.
  it('toma el mutex del viaje ANTES del RPC y lo libera DESPUÉS', async () => {
    const orden: string[] = [];
    acquireViajeLock.mockImplementation(async () => { orden.push('lock'); return true; });
    releaseViajeLock.mockImplementation(async () => { orden.push('unlock'); });
    baseFrom();
    rpc.mockImplementation(async () => { orden.push('rpc'); return { data: { pdf_perdido: 'x.pdf' }, error: null }; });

    await reabrirViaje('t-1', 'VJ-2026-0848', true);

    expect(acquireViajeLock).toHaveBeenCalledWith('v-1');
    expect(orden).toEqual(['lock', 'rpc', 'unlock']);
  });

  it('con el mutex OCUPADO no se llama al RPC — se evita la carrera en vez de correrla', async () => {
    acquireViajeLock.mockResolvedValue(false);
    baseFrom();

    const err = await reabrirViaje('t-1', 'VJ-2026-0848', true).catch((e) => e);
    expect(err).toBeInstanceOf(DatoInvalido);
    expect((err as Error).message).toMatch(/procesando|un momento|espera/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(releaseViajeLock, 'nunca se tomó: no hay nada que soltar').not.toHaveBeenCalled();
  });

  it('libera el mutex aunque el RPC truene', async () => {
    acquireViajeLock.mockResolvedValue(true);
    baseFrom();
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });

    await expect(reabrirViaje('t-1', 'VJ-2026-0848', true)).rejects.toThrow(/timeout/);
    expect(releaseViajeLock, 'un lock que no se suelta bloquea el próximo reabrir/cierre del mismo viaje').toHaveBeenCalledWith('v-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE LAS PANTALLAS DE ALTA PONEN ENCIMA (4-ago-2026).
//
// Las cuatro funciones de arriba ya existían y estaban probadas; lo que no
// existía era la PANTALLA. Al cablearlas aparecieron dos piezas nuevas con su
// propio modo de fallo silencioso, y las dos viven aquí y no en la vista
// justamente para poder fijarlas.
// ═══════════════════════════════════════════════════════════════════════════

describe('armarPolitica — lo que se guarda es la política ENTERA', () => {
  it('vacío es SIN TOPE y 0 es TOPE DE CERO: no se confunden', () => {
    // Number('') da 0. Si se confundieran, un campo que el dueño dejó en blanco
    // PROHIBIRÍA el concepto entero sin que nadie lo pidiera.
    const r = armarPolitica([
      { concepto: 'caseta', tope: '', exigeCfdi: true },
      { concepto: 'diesel', tope: '0', exigeCfdi: false },
    ]);
    expect(r.find((p) => p.concepto === 'caseta')!.topeMonto).toBeUndefined();
    expect(r.find((p) => p.concepto === 'diesel')!.topeMonto).toBe(0);
  });

  it('CONSERVA las reglas por ruta, que el formulario no manda', () => {
    // fusionarConfig reemplaza el arreglo completo: lo que no vuelva aquí, se
    // borró. Sin esta reposición, guardar cualquier tope le borraba a la flota
    // sus reglas por ruta en silencio.
    const porRuta = [{ concepto: 'caseta', ruta: 'GDL-MTY', topeMonto: 900 }];
    const r = armarPolitica([{ concepto: 'diesel', tope: '5000', exigeCfdi: true }], porRuta);
    expect(r).toContainEqual({ concepto: 'caseta', ruta: 'GDL-MTY', topeMonto: 900 });
    expect(r).toHaveLength(2);
  });

  it('un renglón que no dice nada no se guarda', () => {
    expect(armarPolitica([{ concepto: 'otro', tope: '', exigeCfdi: false }])).toEqual([]);
  });

  it('un tope negativo o no numérico se rechaza con el concepto en el mensaje', () => {
    expect(() => armarPolitica([{ concepto: 'diesel', tope: '-5', exigeCfdi: false }])).toThrow(DatoInvalido);
    expect(() => armarPolitica([{ concepto: 'caseta', tope: 'mil', exigeCfdi: false }])).toThrow(/caseta/);
  });

  it('sin renglones y sin reglas de ruta devuelve una política vacía, no revienta', () => {
    expect(armarPolitica([])).toEqual([]);
  });
});

describe('mensajeParaPantalla — qué ve quien llenó el formulario', () => {
  beforeEach(() => logger.error.mockClear());

  it('un DatoInvalido se enseña VERBATIM: es lo único que dice qué corregir', () => {
    const e = new DatoInvalido('Ese teléfono ya está registrado en OTRA flota.');
    expect(mensajeParaPantalla(e, 'registrar al operador')).toBe('Ese teléfono ya está registrado en OTRA flota.');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('cualquier otro error NO filtra el mensaje de Postgres, pero sí se loguea', () => {
    // El texto crudo describe la forma del esquema y no le dice nada a un dueño
    // de flota. Callarlo del todo sería peor: dejaría a alguien creyendo que el
    // alta se hizo.
    const salida = mensajeParaPantalla(new Error('duplicate key value violates unique constraint "operador_pkey"'), 'registrar al operador');
    expect(salida).not.toMatch(/constraint|duplicate key/);
    expect(salida).toMatch(/registrar al operador/);
    expect(salida).toMatch(/falla del sistema/);
    expect(logger.error).toHaveBeenCalledWith('administracion.falla', expect.objectContaining({
      operacion: 'registrar al operador',
    }));
  });

  it('algo que ni siquiera es Error tampoco tumba la pantalla', () => {
    expect(mensajeParaPantalla('se cayó', 'dar de alta la flota')).toMatch(/dar de alta la flota/);
  });
});
