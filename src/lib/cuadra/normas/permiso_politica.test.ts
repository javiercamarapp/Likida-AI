import { describe, it, expect } from 'vitest';
import { normasDePolitica } from './por_diferencia';
import { normasDeToolCalls, guardiaFundamento } from './fundamento';
import { NORMAS, esVinculante } from './indice';
import { DEMO_CONFIG } from '../config';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 7 · CRÍTICO del rubro agéntico — LA TRAMPA CERRADA SOBRE SÍ MISMA.
//
// `permitidas` salía SOLO de `cuadrar_viaje`, y ahí está el candado:
//
//   turno CON cuadrar_viaje  → guardiaCifras fuerza SIEMPRE el texto
//                            → textoDeterminista = true
//                            → la guardia de fundamento NO CORRE
//   turno SIN cuadrar_viaje  → la guardia SÍ corre, con permitidas = []
//                            → TODA cita cae en CITA_DESCONOCIDA y se borra
//
// El turno que tiene permisos es el turno en que la guardia no corre; el turno
// en que corre nunca tiene permisos. Medido antes del arreglo:
//
//   "…porque el artículo 27, fracción III de la LISR limita a $2,000…"
//   → "…porque el limita a $2,000…"
//   "Te aplica el estímulo conforme al LIF 2026 Art. 20-A."
//   → "Te aplica el estímulo conforme al -A."
//
// El escenario es el de la sala: cerrada la liquidación, el contralor pregunta
// "¿y en qué se basan para no contarme ese diésel?". No hay cifras nuevas que
// cuadrar, así que el agente contesta sin llamar `cuadrar_viaje`.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que `consultar_politica` devuelve hoy, con la política del demo. */
const resultadoDeLaTool = () => {
  const ids = normasDePolitica(DEMO_CONFIG.politica);
  return {
    politica: DEMO_CONFIG.politica,
    fundamentos: ids.map((id) => ({
      norma_id: id,
      cita: NORMAS[id].citas[0],
      jerarquia: NORMAS[id].jerarquia,
      verificada: NORMAS[id].estado !== 'sin_verificar',
      vinculante: esVinculante(NORMAS[id].jerarquia),
    })),
  };
};

describe('consultar_politica trae el permiso de citar, no solo los topes', () => {
  it('emite `norma_id`, que es la llave que la guardia lee', () => {
    // Sin esta llave el permiso no existe: `normasDeToolCalls` busca `norma_id`
    // y nada más.
    const permitidas = normasDeToolCalls([resultadoDeLaTool()]);
    expect(permitidas.length).toBeGreaterThan(0);
  });

  it('incluye las normas de PISO de cualquier política de viáticos', () => {
    const ids = normasDePolitica(DEMO_CONFIG.politica);
    expect(ids).toContain('lisr-27-fr-III');   // efectivo
    expect(ids).toContain('lisr-28-fr-V');     // tope diario de alimentación
  });

  it('el estímulo del diésel solo si la política trae diésel', () => {
    expect(normasDePolitica([{ concepto: 'diesel' }])).toContain('lif-2026-art-20-A');
    expect(normasDePolitica([{ concepto: 'hospedaje' }])).not.toContain('lif-2026-art-20-A');
  });

  it('nunca emite una ficha que el índice no conoce', () => {
    // Dar permiso sobre algo que `guardiaFundamento` no sabe reconocer sería
    // permiso muerto: la cita se borraría igual.
    for (const id of normasDePolitica(DEMO_CONFIG.politica)) {
      expect(NORMAS[id], `${id} no está en el índice`).toBeDefined();
    }
  });
});

describe('con ese permiso, el turno de explicar ya no rompe la frase', () => {
  const permitidas = normasDeToolCalls([resultadoDeLaTool()]);

  const legitimas = [
    'Ese diésel no cuenta porque el artículo 27, fracción III de la LISR limita a $2,000 los pagos en efectivo.',
    'Te aplica el estímulo del diésel conforme al LIF 2026 Art. 20-A.',
    'El tope de alimentación son $750 al día por LISR 28-V.',
  ];
  for (const t of legitimas) {
    it(`sale intacta: "${t.slice(0, 46)}…"`, () => {
      const r = guardiaFundamento(t, permitidas);
      expect(r.forzado, 'la cita legítima se borró').toBe(false);
      expect(r.reply).toBe(t);
    });
  }

  it('y una cita INVENTADA se sigue quitando', () => {
    // El permiso es acotado, no un salvoconducto.
    const r = guardiaFundamento('No aplica por el artículo 45-Z de la LISR.', permitidas);
    expect(r.forzado).toBe(true);
  });

  it('sin llamar la tool no hay permiso, que es la posición segura', () => {
    expect(normasDeToolCalls([{ algo: 'que no es una tool de normas' }])).toEqual([]);
  });
});
