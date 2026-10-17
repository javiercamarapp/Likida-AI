import { beforeEach, describe, expect, it, vi } from 'vitest';

// T-A5-64: la marca de cohorte esta CABLEADA: se lee de la fila de la flota (`leerConfigConductor`) y llega al preflight
// real (`preflightReal`), sin inyectarla a mano en el fixture.
const estado: { config: Record<string, unknown> | null } = { config: null };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tabla === 'tenant' ? { zona_horaria: 'America/Mexico_City' } : estado.config, error: null }) }) }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { leerConfigConductor } from './repo';
import { evaluarPreflight } from './preflight_piloto';

const FILA = {
  activo: true, solicitudes_min: [0, 15, 30, 45], escalar_tras_min: 90, segundo_nivel_min: 30, hora_inicio: 6, hora_fin: 22,
  dias_semana: [1, 2, 3, 4, 5, 6, 7], tope_diario_chofer: 12, anticipo_cita_min: 30, espera_sin_cita_min: 120, espera_carga_min: 120,
  trayecto_sin_eta_min: 480, espera_descarga_min: 120, regreso_min: 30, posponer_min: 30, ventana_correccion_min: 60, usar_llm: true,
  avisar_oficina_llegada: false, avisar_oficina_salida: false, confirmar_al_chofer: true, validar_ubicacion: true,
  tolerancia_ubicacion_m: 150, ventana_ubicacion_min: 30, pedir_ubicacion: true, estadia_alerta_carga_min: null,
  estadia_alerta_descarga_min: null, pedir_foto_evidencia: false,
};

describe('cohorte del piloto: lectura de la fila', () => {
  beforeEach(() => { estado.config = null; });

  it('la fila con cohorte_piloto valida la entrega en la config', async () => {
    estado.config = { ...FILA, cohorte_piloto: 'sin_tableta_ni_macros' };
    expect((await leerConfigConductor('t1')).cohortePiloto).toBe('sin_tableta_ni_macros');
  });

  it('base sin la columna: sin cohorte definida (no truena)', async () => {
    estado.config = { ...FILA };
    expect((await leerConfigConductor('t1')).cohortePiloto ?? null).toBeNull();
  });

  it('valor fuera del catalogo: sin cohorte, y el resto de la config NO cae a defaults', async () => {
    estado.config = { ...FILA, cohorte_piloto: 'todas', tope_diario_chofer: 7 };
    const c = await leerConfigConductor('t1');
    expect(c.cohortePiloto ?? null).toBeNull();
    expect(c.topeDiarioChofer).toBe(7);
  });

  it('la cohorte leida de la fila pone en verde la comprobacion `cohorte` del preflight; sin ella, en rojo', async () => {
    const base = { zonaDeclarada: 'America/Mexico_City', voluntarios: [], viajes: [], posicionesPorUnidad: {}, contactos: [], aprobadas: [] };
    estado.config = { ...FILA, cohorte_piloto: 'voluntarios_abiertos' };
    const con = await leerConfigConductor('t1');
    const pfCon = evaluarPreflight({ ...base, config: { activo: con.activo, perfilSeguimiento: con.perfilSeguimiento, solicitudesMin: con.solicitudesMin, cohortePiloto: con.cohortePiloto ?? null } });
    expect(pfCon.comprobaciones.find((x) => x.id === 'cohorte')?.estado).toBe('ok');
    estado.config = { ...FILA };
    const sin = await leerConfigConductor('t1');
    const pfSin = evaluarPreflight({ ...base, config: { activo: sin.activo, perfilSeguimiento: sin.perfilSeguimiento, solicitudesMin: sin.solicitudesMin, cohortePiloto: sin.cohortePiloto ?? null } });
    expect(pfSin.comprobaciones.find((x) => x.id === 'cohorte')?.estado).toBe('falta');
  });
});
