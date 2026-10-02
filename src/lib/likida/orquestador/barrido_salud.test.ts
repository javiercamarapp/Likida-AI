import { describe, it, expect } from 'vitest';
import { PREFIJO_BARRIDO, barrerSaludDeFlota, llaveBarrido, planBarrido, type DepsBarrido, type TareaDeSistema } from './barrido_salud';
import { AGENTES_VIGILADOS, resumirSalud, type EntradaSalud, type LatidoVisto } from './salud_agentes';
import { DESTINOS } from './escalamiento';

const AHORA = new Date('2026-10-02T15:00:00Z');
const T = 'f0000000-0000-4000-8000-000000000001';
const ok = (haceMin = 3): LatidoVisto => ({ estado: 'ok', haceMin, ultimoEstado: 'ok' });

/** Una flota sana: todos los latidos al día, sin fallas. */
function sana(sobre: Partial<EntradaSalud> = {}): EntradaSalud {
  const latidos: Record<string, LatidoVisto> = {};
  for (const a of AGENTES_VIGILADOS) if (a.cron) latidos[a.cron] = ok();
  return { ahora: AHORA, latidos, corridas: {}, enviosSinSalir: { vigiaFallidos24h: 0, buzonEntregasConProblema: 0 }, ...sobre };
}

/** La base de tareas en memoria: la unicidad de «una abierta por llave» es la del índice de la 0650. */
function armar(entradas: EntradaSalud[]) {
  let i = 0;
  const abiertas = new Map<string, TareaDeSistema & { nota?: string }>();
  const cerradas: string[] = [];
  const deps: DepsBarrido = {
    async salud() { return entradas[Math.min(i++, entradas.length - 1)]; },
    async abrirTarea(_t, t) { if (abiertas.has(t.dedupe)) return 'ya_abierta'; abiertas.set(t.dedupe, t); return 'creada'; },
    async tareasAbiertas() { return [...abiertas.keys()]; },
    async cerrarTarea(_t, dedupe, nota) { if (!abiertas.has(dedupe)) return false; abiertas.delete(dedupe); cerradas.push(`${dedupe}|${nota}`); return true; },
  };
  return { deps, abiertas, cerradas };
}

describe('qué agentes vigila el barrido', () => {
  it('carta-porte-docs ENTRA: su cron ya late cada 5 min y un documento sin procesar no hace ruido', () => {
    const cp = AGENTES_VIGILADOS.find((a) => a.id === 'carta_porte');
    expect(cp).toMatchObject({ cron: 'carta-porte-docs', corridas: null, pantalla: '/dashboard/carta-porte/documentos', destino: 'jefe_de_trafico' });
  });

  it('todo agente vigilado tiene un destino del dominio cerrado y su pantalla', () => {
    for (const a of AGENTES_VIGILADOS) {
      expect(DESTINOS as readonly string[], a.id).toContain(a.destino);
      expect(a.pantalla, a.id).toMatch(/^\/dashboard\//);
    }
  });

  it('un latido vencido de carta-porte-docs es una falla y se le avisa al jefe de tráfico', () => {
    const e = sana({ latidos: { ...sana().latidos!, 'carta-porte-docs': { estado: 'vencido', haceMin: 40, ultimoEstado: 'ok' } } });
    const plan = planBarrido(e);
    expect(plan.abrir).toHaveLength(1);
    expect(plan.abrir[0]).toMatchObject({ agente: 'carta_porte', destino: 'jefe_de_trafico', dedupe: 'barrido:carta_porte' });
    expect(plan.abrir[0].resumen).toMatch(/dejó de latir/);
    expect(plan.abrir[0].resumen).toContain('/dashboard/carta-porte/documentos');
  });
});

describe('qué es una falla y qué no', () => {
  it('son fallas: latido vencido, último latido en fallo, corrida fallida, 3 corridas fallidas y respuestas del Vigía sin salir', () => {
    const e = sana({
      latidos: { ...sana().latidos!, 'conductor-hitos': { estado: 'vencido', haceMin: 95, ultimoEstado: 'ok' }, peajes: { estado: 'ok', haceMin: 2, ultimoEstado: 'fallo' } },
      corridas: { cobranza: [{ estado: 'fallo', inicio: '2026-10-02T14:00:00Z', fin: '2026-10-02T14:01:00Z', error: 'Meta rechazó la plantilla' }] },
      enviosSinSalir: { vigiaFallidos24h: 4, buzonEntregasConProblema: 0 },
    });
    const ids = planBarrido(e).abrir.map((a) => a.agente).sort();
    expect(ids).toEqual(['cobranza', 'conductor', 'peajes', 'vigia']);
  });

  it('NO son fallas: nunca ha latido, corrida a medias, sin datos, lecturas que no se pudieron hacer ni entregas del buzón', () => {
    const e = sana({
      latidos: { ...sana().latidos!, 'liquidaciones-externas': { estado: 'sin_latido', haceMin: null, ultimoEstado: null } },
      corridas: { facturas: [{ estado: 'parcial', inicio: '2026-10-02T14:00:00Z', fin: null, error: null }], liquidacion: null },
      enviosSinSalir: { vigiaFallidos24h: null, buzonEntregasConProblema: 12 },
    });
    expect(planBarrido(e).abrir).toEqual([]);
    // y los problemas siguen visibles para quien pregunta al asistente
    const r = resumirSalud(e);
    expect(r.agentes.find((a) => a.agente === 'buzon')!.problemas.join(' ')).toMatch(/12 entregas/);
  });
});

describe('el barrido de una flota', () => {
  const caida = (): EntradaSalud => sana({ latidos: { ...sana().latidos!, vigia: { estado: 'vencido', haceMin: 50, ultimoEstado: 'ok' } } });

  it('abre UNA tarea por agente caído para la persona que le toca, y barrer otra vez no la duplica', async () => {
    const { deps, abiertas } = armar([caida()]);
    const r1 = await barrerSaludDeFlota(T, AHORA, deps);
    expect(r1).toMatchObject({ abiertas: 1, yaAbiertas: 0, cerradas: 0 });
    expect([...abiertas.keys()]).toEqual([llaveBarrido('vigia')]);
    expect(abiertas.get('barrido:vigia')!.destino).toBe('mesa_de_control');
    const r2 = await barrerSaludDeFlota(T, AHORA, deps);
    expect(r2).toMatchObject({ abiertas: 0, yaAbiertas: 1 });
    expect(abiertas.size).toBe(1);
  });

  it('cuando el agente se recupera la tarea se cierra sola, diciéndolo', async () => {
    const { deps, abiertas, cerradas } = armar([caida(), sana()]);
    await barrerSaludDeFlota(T, AHORA, deps);
    const r = await barrerSaludDeFlota(T, AHORA, deps);
    expect(r.cerradas).toBe(1);
    expect(abiertas.size).toBe(0);
    expect(cerradas[0]).toMatch(/Se resolvió solo/);
  });

  it('una lectura ciega NO cierra: «no sé» no es «sano»', async () => {
    const ciega = sana({ latidos: null });
    const { deps, abiertas } = armar([caida(), ciega]);
    await barrerSaludDeFlota(T, AHORA, deps);
    const r = await barrerSaludDeFlota(T, AHORA, deps);
    expect(r.cerradas).toBe(0);
    expect(abiertas.has('barrido:vigia')).toBe(true);
  });

  it('solo cierra las tareas del barrido: la del asistente (otra llave) no se toca', async () => {
    const { deps, abiertas } = armar([sana()]);
    abiertas.set('mesa_de_control|posible_emergencia|v1', { destino: 'mesa_de_control', resumen: 'x', dedupe: 'mesa_de_control|posible_emergencia|v1' });
    abiertas.set(`${PREFIJO_BARRIDO}vigia`, { destino: 'mesa_de_control', resumen: 'x', dedupe: 'barrido:vigia' });
    const r = await barrerSaludDeFlota(T, AHORA, deps);
    expect(r.cerradas).toBe(1);
    expect([...abiertas.keys()]).toEqual(['mesa_de_control|posible_emergencia|v1']);
  });

  it('con la tabla sin migrar no insiste y lo dice', async () => {
    const { deps } = armar([caida()]);
    const r = await barrerSaludDeFlota(T, AHORA, { ...deps, abrirTarea: async () => 'no_disponible' });
    expect(r.noDisponible).toBe(true);
  });

  it('el resumen de la tarea no lleva números largos ni ligas aunque el error de la corrida los traiga', () => {
    const e = sana({ corridas: { cobranza: [{ estado: 'fallo', inicio: '2026-10-02T14:00:00Z', fin: null, error: 'falló con 5215551234567 en https://x.test/a?t=1' }] } });
    const t = planBarrido(e).abrir.find((a) => a.agente === 'cobranza')!;
    expect(t.resumen).not.toMatch(/\d{10}/);
    expect(t.resumen).not.toMatch(/https?:/);
    expect(t.resumen.length).toBeLessThanOrEqual(300);
  });
});
