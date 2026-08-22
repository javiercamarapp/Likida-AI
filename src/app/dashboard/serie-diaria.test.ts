import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// FE-5 — "Actividad — últimos 7 días" y "Avance de cierre" se bucketeaban EN
// EL NAVEGADOR sobre las 100 filas más recientes de `getViajes`. A 50,000
// viajes/mes esas 100 filas son ~90 minutos de operación: la gráfica rotulada
// "7 días" dibujaba hora y media y seis barras en cero, y nada lo decía.
//
// Aquí se prueba el reemplazo: que la serie salga de la BASE
// (`serie_comparativa_tenant` con ventana de 1 día, mig. 0112 ya aplicada),
// que llegue en el orden en que se dibuja (más viejo primero) y que la vista
// semanal sea la COLA de los mismos 30 buckets — no una segunda consulta.
// ═══════════════════════════════════════════════════════════════════════════

const getSerieComparativa = vi.fn();
vi.mock('@/lib/likida/analytics', () => ({ getSerieComparativa: (...a: unknown[]) => getSerieComparativa(...a) }));

const { getViajesPorDia, sumarUltimos, DIAS_SERIE } = await import('./serie-diaria');

/** Como la devuelve la RPC: paso 0 = el más reciente. */
function paso(desde: string, totalViajes: number, viajesLiquidados: number) {
  return { desde, hasta: desde, gastoTotal: 0, totalViajes, costoPorViaje: null, liquidado: 0, viajesLiquidados };
}

describe('getViajesPorDia', () => {
  // `mockClear`, no `mockReset`: reset deja la implementación en un estado
  // en el que vitest cuenta la promesa rechazada del siguiente test como un
  // error sin dueño y tumba la prueba que sí la atrapa.
  beforeEach(() => { getSerieComparativa.mockClear(); });

  it('pide ventanas de UN día — eso es "contar por día" sin función SQL nueva', async () => {
    getSerieComparativa.mockResolvedValue([]);
    await getViajesPorDia('t-1', '2026-08-22');
    expect(getSerieComparativa).toHaveBeenCalledWith('t-1', 1, DIAS_SERIE, '2026-08-22');
  });

  it('devuelve del más VIEJO al más reciente — la RPC entrega al revés', async () => {
    getSerieComparativa.mockResolvedValue([
      paso('2026-08-22', 5, 2), paso('2026-08-21', 3, 3), paso('2026-08-20', 0, 0),
    ]);
    const r = await getViajesPorDia('t-1', '2026-08-22', 3);
    expect(r.map((d) => d.dia)).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
    expect(r[2]).toEqual({ dia: '2026-08-22', viajes: 5, liquidados: 2 });
  });

  // Fallar CERRADO: `getSerieComparativa` ya lanza ante una forma ajena
  // (0112 sin aplicar). Se propaga: la tarjeta dice "no se pudo cargar" en
  // vez de dibujar una gráfica en ceros, que se lee como flota parada.
  it('un fallo de la lectura se propaga, no se convierte en serie vacía', async () => {
    getSerieComparativa.mockImplementation(() => Promise.reject(new Error('0112 sin aplicar')));
    await expect(getViajesPorDia('t-1', '2026-08-22')).rejects.toThrow('0112 sin aplicar');
  });
});

describe('sumarUltimos', () => {
  const serie = [
    { dia: 'd1', viajes: 10, liquidados: 1 },
    { dia: 'd2', viajes: 20, liquidados: 2 },
    { dia: 'd3', viajes: 30, liquidados: 3 },
  ];

  it('suma la COLA (lo más reciente), que es lo que "últimos N días" significa', () => {
    expect(sumarUltimos(serie, 2)).toEqual({ viajes: 50, liquidados: 5 });
  });

  it('pedir más días que los que hay devuelve la serie entera, no ceros', () => {
    expect(sumarUltimos(serie, 90)).toEqual({ viajes: 60, liquidados: 6 });
  });

  it('serie vacía suma cero sin reventar', () => {
    expect(sumarUltimos([], 7)).toEqual({ viajes: 0, liquidados: 0 });
  });
});
