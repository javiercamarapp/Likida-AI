import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  crearDoble, despacharRpc, baseDeDosFlotas, HOY_PRUEBAS, haceDias,
  type Doble, type BaseSintetica,
} from './espejo_0152.pruebas';

// ═══════════════════════════════════════════════════════════════════════════
// ESCALA 50k (mig. 0152): getTableroOperacion, getCargaOperadores y
// getIncidencias pasaron de leer `viaje`/`pod`/`incidencia`/`unidad` ENTEROS a
// `tablero_operacion_tenant`, `carga_operadores_tenant` e `incidencias_tenant`.
//
// Este archivo compara la reducción JS VIEJA (copias congeladas de
// operacion.ts pre-0152) contra las funciones nuevas sobre el MISMO dataset de
// dos flotas. Las diferencias de contrato que la 0152 introduce A PROPÓSITO
// —los liquidados acotados por ventana (FE-3) y las incidencias resueltas
// viejas fuera de la lista— NO se esconden: se prueban una por una, para que
// nadie las descubra en pantalla.
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = new Date(`${HOY_PRUEBAS}T12:00:00Z`);
let doble: Doble = crearDoble(HOY_PRUEBAS);

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => Promise.resolve(despacharRpc(doble, fn, args)),
    from: () => ({}),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./notificar', () => ({ notificarAsignacion: vi.fn() }));

const { getTableroOperacion, getCargaOperadores, getIncidencias, DIAS_LIQUIDADOS_CARGA } = await import('./operacion');

const SIN_CERRAR = new Set(['abierto', 'en_cuadre']);

/** `getTableroOperacion` antes de la 0152. */
function legacyTablero(b: BaseSintetica, t: string) {
  const viajes = b.viaje.filter((v) => v.tenant_id === t);
  const unidades = b.unidad.filter((u) => u.tenant_id === t && (u.activo ?? true));
  const incidencias = b.incidencia.filter((i) => i.tenant_id === t && i.estado !== 'resuelta');
  const pods = b.pod.filter((p) => p.tenant_id === t);
  const conPod = new Set(pods.filter((p) => p.estado === 'subido').map((p) => p.viaje_id));
  const enCurso = viajes.filter((v) => SIN_CERRAR.has(v.estatus));
  return {
    viajesActivos: enCurso.length,
    sinUnidad: enCurso.filter((v) => !v.unidad_id).length,
    unidadesDisponibles: unidades.filter((u) => u.estado === 'disponible').length,
    unidadesEnTaller: unidades.filter((u) => u.estado === 'taller').length,
    incidenciasAbiertas: incidencias.length,
    podPendientes: enCurso.filter((v) => !conPod.has(v.id)).length,
  };
}

/** `getCargaOperadores` antes de la 0152 (sin ventana: todo el histórico). */
function legacyCarga(b: BaseSintetica, t: string) {
  const ops = b.operador.filter((o) => o.tenant_id === t);
  const viajes = b.viaje.filter((v) => v.tenant_id === t);
  const conPod = new Set(b.pod.filter((p) => p.tenant_id === t && p.estado === 'subido').map((p) => p.viaje_id));
  const conIncidencia = new Set(b.incidencia.filter((i) => i.tenant_id === t && i.estado !== 'resuelta').map((i) => i.viaje_id));
  const vacio = () => ({ enCurso: 0, abiertos: 0, enCuadre: 0, liquidados: 0, sinPod: 0, incidenciasAbiertas: 0 });
  const acum = new Map<string, ReturnType<typeof vacio>>();
  for (const v of viajes) {
    const op = v.operador_id;
    if (!op) continue;
    const a = acum.get(op) ?? vacio();
    if (v.estatus === 'abierto') a.abiertos += 1;
    else if (v.estatus === 'en_cuadre') a.enCuadre += 1;
    else if (v.estatus === 'liquidado') a.liquidados += 1;
    if (SIN_CERRAR.has(v.estatus)) {
      a.enCurso += 1;
      if (!conPod.has(v.id)) a.sinPod += 1;
    }
    if (conIncidencia.has(v.id)) a.incidenciasAbiertas += 1;
    acum.set(op, a);
  }
  return ops.map((o) => ({
    operadorId: o.id, nombre: o.nombre, telefono: o.telefono || null, activo: o.activo ?? true,
    ...(acum.get(o.id) ?? vacio()),
  })).sort((x, y) => y.enCurso - x.enCurso || x.nombre.localeCompare(y.nombre));
}

/** `getIncidencias` antes de la 0152 (traía `viaje` y `unidad` enteras). */
function legacyIncidencias(b: BaseSintetica, t: string, ahora: Date) {
  const folioPorViaje = new Map(b.viaje.filter((v) => v.tenant_id === t).map((v) => [v.id, v.folio || null]));
  const ecoPorUnidad = new Map(b.unidad.filter((u) => u.tenant_id === t).map((u) => [u.id, u.numero_economico]));
  return b.incidencia.filter((i) => i.tenant_id === t)
    .sort((x, y) => (x.abierta_en < y.abierta_en ? 1 : x.abierta_en > y.abierta_en ? -1 : x.id.localeCompare(y.id)))
    .map((i) => {
      const fin = i.resuelta_en ? Date.parse(i.resuelta_en) : ahora.getTime();
      const horas = Math.max(0, Math.round((fin - Date.parse(i.abierta_en)) / 3_600_000));
      const sla = i.sla_horas ?? null;
      return {
        id: i.id, viajeId: i.viaje_id || null,
        folio: i.viaje_id ? folioPorViaje.get(i.viaje_id) ?? null : null,
        unidadId: i.unidad_id || null,
        numeroEconomico: i.unidad_id ? ecoPorUnidad.get(i.unidad_id) ?? null : null,
        tipo: i.tipo, prioridad: i.prioridad ?? 'media', estado: i.estado,
        descripcion: i.descripcion || null, slaHoras: sla, abiertaEn: i.abierta_en,
        resueltaEn: i.resuelta_en || null, horasAbierta: horas,
        slaVencido: sla !== null && i.estado !== 'resuelta' && horas > sla,
      };
    });
}

beforeEach(() => { doble = crearDoble(HOY_PRUEBAS); doble.base = baseDeDosFlotas(); });

describe('EQUIVALENCIA getTableroOperacion — JS viejo vs tablero_operacion_tenant', () => {
  it('los seis conteos son idénticos, y ninguno trae nada de la otra flota', async () => {
    const viejo = legacyTablero(doble.base, 't-1');
    expect(await getTableroOperacion('t-1')).toEqual(viejo);
    // Control: la flota ajena da otros números (si no, esto no probaría nada).
    expect(legacyTablero(doble.base, 't-2')).not.toEqual(viejo);
  });

  it('el POD rechazado y el que nadie creó cuentan igual que antes: como pendientes', async () => {
    const t = await getTableroOperacion('t-1');
    // v-4 (sin POD), v-5 (rechazado) — v-3 tiene POD subido.
    expect(t.podPendientes).toBe(2);
    expect(t.viajesActivos).toBe(3);
  });
});

describe('EQUIVALENCIA getCargaOperadores — JS viejo vs carga_operadores_tenant', () => {
  it('todo lo que mira el encargado HOY es idéntico (en curso, sin POD, incidencias)', async () => {
    const viejo = legacyCarga(doble.base, 't-1');
    const nuevo = await getCargaOperadores('t-1', AHORA);
    expect(nuevo.map((o) => o.operadorId)).toEqual(viejo.map((o) => o.operadorId));
    for (const [i, o] of nuevo.entries()) {
      const v = viejo[i];
      expect([o.nombre, o.telefono, o.activo]).toEqual([v.nombre, v.telefono, v.activo]);
      expect([o.enCurso, o.abiertos, o.enCuadre, o.sinPod, o.incidenciasAbiertas])
        .toEqual([v.enCurso, v.abiertos, v.enCuadre, v.sinPod, v.incidenciasAbiertas]);
    }
  });

  it('LA ÚNICA DIFERENCIA es `liquidados`, acotado a la ventana (FE-3), y se ve', async () => {
    const viejo = legacyCarga(doble.base, 't-1').find((o) => o.operadorId === 'o-1')!;
    const nuevo = (await getCargaOperadores('t-1', AHORA)).find((o) => o.operadorId === 'o-1')!;
    // v-1 (hace 40 d) y v-2 (hace 10 d) entran; v-6 (hace 200 d) ya no.
    expect(viejo.liquidados).toBe(3);
    expect(nuevo.liquidados).toBe(2);
    expect(DIAS_LIQUIDADOS_CARGA).toBe(90);
  });

  it('un operador sin un solo viaje sigue apareciendo, en las dos', async () => {
    doble.base.viaje = [];
    const nuevo = await getCargaOperadores('t-1', AHORA);
    expect(nuevo.map((o) => o.nombre)).toEqual(legacyCarga(doble.base, 't-1').map((o) => o.nombre));
    expect(nuevo.every((o) => o.enCurso === 0)).toBe(true);
  });
});

describe('EQUIVALENCIA getIncidencias — JS viejo vs incidencias_tenant (join en SQL)', () => {
  it('cada incidencia listada trae exactamente los mismos campos que antes', async () => {
    const viejo = new Map(legacyIncidencias(doble.base, 't-1', AHORA).map((i) => [i.id, i]));
    const nuevo = await getIncidencias('t-1', AHORA);
    expect(nuevo.length).toBeGreaterThan(0);
    for (const i of nuevo) expect(i).toEqual(viejo.get(i.id));
  });

  it('LA ÚNICA DIFERENCIA son las resueltas viejas, fuera de la ventana de 90 días', async () => {
    const viejo = legacyIncidencias(doble.base, 't-1', AHORA);
    const nuevo = await getIncidencias('t-1', AHORA);
    const fuera = viejo.filter((v) => !nuevo.some((n) => n.id === v.id));
    expect(fuera.map((f) => f.id)).toEqual(['i-2']);
    expect(fuera[0].estado).toBe('resuelta');
    expect(fuera[0].abiertaEn < haceDias(90)).toBe(true);
    // Ninguna ABIERTA se queda fuera, por vieja que sea: son las que se persiguen.
    expect(nuevo.some((n) => n.estado === 'en_proceso')).toBe(true);
  });

  it('el orden es el mismo: lo más reciente primero', async () => {
    const nuevo = await getIncidencias('t-1', AHORA);
    expect(nuevo.map((i) => i.id)).toEqual(
      legacyIncidencias(doble.base, 't-1', AHORA).filter((i) => i.id !== 'i-2').map((i) => i.id),
    );
  });
});
