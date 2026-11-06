import { beforeEach, describe, expect, it, vi } from 'vitest';

// CT-A345-29 (correccion post-adversarial): (a) preflightReal juzga la compuerta con la config que se PRETENDE guardar;
// (b) un bache al leer tenant_perfil con instancia fria no apaga la compuerta; (c) bajo cinco_agentes la compuerta no queda inocua.
const estado: { config: Record<string, unknown> | null; perfilFalla: boolean } = { config: null, perfilFalla: false };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (tabla === 'tenant_perfil') return estado.perfilFalla ? { data: null, error: { message: 'bache de red' } } : { data: null, error: null };
            return { data: tabla === 'tenant' ? { zona_horaria: 'America/Mexico_City' } : estado.config, error: null };
          },
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('./repo', async (orig) => ({
  ...(await orig<typeof import('./repo')>()),
  leerDatosPreflight: async () => ({
    config: { activo: true, perfilSeguimiento: 'esenciales', solicitudesMin: [0, 15, 30, 45], cohortePiloto: null, compuertaMovimientoActiva: false },
    zonaDeclarada: 'America/Mexico_City', voluntarios: [], viajes: [], posicionesPorUnidad: {}, contactos: [], aprobadas: [],
    agenteChoferHabilitado: 'habilitado', perfilPlantillas: 'cinco_agentes',
  }),
}));

const { leerConfigConductor } = await import('./repo');
const { preflightReal } = await import('./acciones_config');
const { CONFIG_CONDUCTOR_DEFAULT, aplicarPisoDePerfil } = await import('./config');
const { reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');

const FILA = {
  activo: true, solicitudes_min: [0, 15, 30, 45], escalar_tras_min: 90, segundo_nivel_min: 30, hora_inicio: 6, hora_fin: 22,
  dias_semana: [1, 2, 3, 4, 5, 6, 7], tope_diario_chofer: 12, anticipo_cita_min: 30, espera_sin_cita_min: 120, espera_carga_min: 120,
  trayecto_sin_eta_min: 480, espera_descarga_min: 120, regreso_min: 30, posponer_min: 30, ventana_correccion_min: 60, usar_llm: true,
  avisar_oficina_llegada: false, avisar_oficina_salida: false, confirmar_al_chofer: true, validar_ubicacion: true,
  tolerancia_ubicacion_m: 150, ventana_ubicacion_min: 30, pedir_ubicacion: true, estadia_alerta_carga_min: null,
  estadia_alerta_descarga_min: null, pedir_foto_evidencia: false,
};

beforeEach(() => { estado.config = null; estado.perfilFalla = false; reiniciarCachePerfil(); });

describe('CT-A345-29 (a): preflightReal respeta la compuerta de la config pretendida', () => {
  it('con compuerta encendida el comprobante compuerta_movimiento sale ok', async () => {
    const pf = await preflightReal('t1', { ...CONFIG_CONDUCTOR_DEFAULT, compuertaMovimientoActiva: true });
    const c = pf.comprobaciones.find((x) => x.id === 'compuerta_movimiento');
    expect(c?.estado).toBe('ok');
    expect(pf.bloqueos.map((b) => b.id)).not.toContain('compuerta_movimiento');
  });
  it('con la compuerta apagada sigue bloqueando', async () => {
    const pf = await preflightReal('t1', { ...CONFIG_CONDUCTOR_DEFAULT, compuertaMovimientoActiva: false });
    expect(pf.bloqueos.map((b) => b.id)).toContain('compuerta_movimiento');
  });
});

describe('CT-A345-29 (b): un bache al leer el perfil con instancia fria falla CERRADO', () => {
  it('con fila de config: la compuerta queda encendida', async () => {
    estado.perfilFalla = true;
    estado.config = { ...FILA, compuerta_movimiento_activa: false };
    expect((await leerConfigConductor('t-frio-1')).compuertaMovimientoActiva).toBe(true);
  });
  it('sin fila de config: tambien encendida', async () => {
    estado.perfilFalla = true;
    expect((await leerConfigConductor('t-frio-2')).compuertaMovimientoActiva).toBe(true);
  });
});

describe('CT-A345-29 (c): bajo cinco_agentes la compuerta no queda inocua', () => {
  it('aplicarPisoDePerfil quita sin_gps_permite y acota metros/ventana', () => {
    const c = aplicarPisoDePerfil({ ...CONFIG_CONDUCTOR_DEFAULT, sinGpsPermite: true, detenidaMetros: 5000, detenidaVentanaMin: 60 }, 'cinco_agentes');
    expect(c).toMatchObject({ compuertaMovimientoActiva: true, sinGpsPermite: false, detenidaMetros: 300, detenidaVentanaMin: 15 });
  });
  it('sin perfil no cambia nada', () => {
    const c = { ...CONFIG_CONDUCTOR_DEFAULT, sinGpsPermite: true, detenidaMetros: 5000 };
    expect(aplicarPisoDePerfil(c, null)).toBe(c);
  });
  it('leerConfigConductor con fila de cinco_agentes aplica el piso', async () => {
    estado.perfilFalla = true; // perfil restringido
    estado.config = { ...FILA, compuerta_movimiento_activa: true, sin_gps_permite: true, detenida_metros: 5000, detenida_ventana_min: 60 };
    expect(await leerConfigConductor('t-frio-3')).toMatchObject({ sinGpsPermite: false, detenidaMetros: 300, detenidaVentanaMin: 15 });
  });
  it('valores razonables por debajo del tope se respetan', () => {
    const c = aplicarPisoDePerfil({ ...CONFIG_CONDUCTOR_DEFAULT, detenidaMetros: 100, detenidaVentanaMin: 3 }, 'cinco_agentes');
    expect(c).toMatchObject({ detenidaMetros: 100, detenidaVentanaMin: 3 });
  });
});
