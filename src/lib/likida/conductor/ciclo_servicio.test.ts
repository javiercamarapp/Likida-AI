import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PASOS_CICLO, SEMILLA_CICLOS, SERVICIOS, cicloActual, cicloDelServicio, esPasoDeCarga, filasDeSemilla, pideHitosDeCarga,
  siguientePaso, validarSecuencia, type CicloServicioFila, type PasoCiclo, type Servicio,
} from './ciclo_servicio';
import { TIPOS_HITO } from './tipos';

const T1 = 't1';
const T2 = 't2';
const filasDe = (tenantId: string): CicloServicioFila[] =>
  SEMILLA_CICLOS.map((p) => ({ tenantId, servicio: p.servicio, orden: p.orden, hito: p.hito, activo: true }));

describe('el ciclo actual sigue intacto', () => {
  it('son los cinco hitos de siempre, en su orden', () => {
    expect([...TIPOS_HITO]).toEqual(['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso']);
    expect(cicloActual().pasos).toEqual([...TIPOS_HITO]);
    expect(cicloActual().origen).toBe('actual');
  });

  it('cada uno de los cinco hitos cabe en el vocabulario del ciclo por servicio', () => {
    for (const h of TIPOS_HITO) expect(PASOS_CICLO).toContain(h);
  });

  it('el ciclo actual devuelto es una copia: mutarla no cambia TIPOS_HITO', () => {
    const c = cicloActual() as unknown as { pasos: PasoCiclo[] };
    c.pasos.pop();
    expect(TIPOS_HITO).toHaveLength(5);
  });
});

describe('tenant sin ciclo usa el actual', () => {
  it('sin filas, cualquier servicio devuelve el ciclo actual', () => {
    for (const s of SERVICIOS) {
      const c = cicloDelServicio([], s);
      expect(c.origen).toBe('actual');
      expect(c.pasos).toEqual([...TIPOS_HITO]);
      expect(c.servicio).toBe(s);
    }
  });

  it('servicio desconocido (null) con filas sembradas: ciclo actual', () => {
    const c = cicloDelServicio(filasDe(T1), null);
    expect(c.origen).toBe('actual');
    expect(c.pasos).toEqual([...TIPOS_HITO]);
  });

  it('filas solo de otro servicio, o todas apagadas: ciclo actual para este', () => {
    const soloImpo = filasDe(T1).filter((f) => f.servicio === 'importacion');
    expect(cicloDelServicio(soloImpo, 'exportacion').origen).toBe('actual');
    const apagadas = filasDe(T1).map((f) => ({ ...f, activo: false }));
    expect(cicloDelServicio(apagadas, 'importacion').origen).toBe('actual');
  });
});

describe('la semilla por servicio', () => {
  it('un viaje de importación NO pide hitos de carga', () => {
    const c = cicloDelServicio(filasDe(T1), 'importacion');
    expect(c.origen).toBe('flota');
    expect(pideHitosDeCarga(c)).toBe(false);
    expect(c.pasos.filter(esPasoDeCarga)).toEqual([]);
  });

  it('un viaje de exportación SÍ pide inicio y fin de carga y la cita de carga', () => {
    const c = cicloDelServicio(filasDe(T1), 'exportacion');
    expect(pideHitosDeCarga(c)).toBe(true);
    expect(c.pasos).toEqual(expect.arrayContaining(['llegada_cita_carga', 'inicio_carga', 'fin_carga']));
  });

  it('importación: la secuencia de la libreta, con «llegada a cliente» y sin «llegada a destino»', () => {
    expect(cicloDelServicio(filasDe(T1), 'importacion').pasos).toEqual([
      'confirmar', 'inicio_viaje', 'llegada_cliente', 'contacto', 'rampa', 'espera_descarga', 'fin_descarga', 'resultado_descarga',
    ]);
  });

  it('exportación: la secuencia de la libreta, sin rampa (solo existe en importación)', () => {
    const c = cicloDelServicio(filasDe(T1), 'exportacion');
    expect(c.pasos).toEqual([
      'confirmar', 'enlace_origen_destino', 'inicio_viaje_cliente', 'llegada_cita_carga', 'contacto', 'inicio_carga', 'fin_carga',
      'salida_destino', 'patio_entrega',
    ]);
    expect(c.pasos).not.toContain('rampa');
    expect(c.pasos).not.toContain('llegada_descarga');
  });

  it('nacional: según la semilla, los cinco hitos actuales precedidos de confirmar e inicio de viaje', () => {
    const c = cicloDelServicio(filasDe(T1), 'nacional');
    expect(c.pasos).toEqual(['confirmar', 'inicio_viaje', ...TIPOS_HITO]);
    expect(pideHitosDeCarga(c)).toBe(true);
  });

  it('el ciclo actual sí pide carga (llegada y salida de carga)', () => {
    expect(pideHitosDeCarga(cicloActual())).toBe(true);
  });

  it('cada servicio tiene su secuencia en la semilla, con orden 1..n sin huecos ni pasos repetidos', () => {
    for (const s of SERVICIOS) {
      const filas = SEMILLA_CICLOS.filter((p) => p.servicio === s);
      expect(filas.length).toBeGreaterThan(0);
      expect(filas.map((p) => p.orden)).toEqual(filas.map((_, i) => i + 1));
      expect(validarSecuencia(filas.map((p) => p.hito))).toBeNull();
    }
  });

  it('la semilla está marcada como propuesta y es sintética (sin nombres propios)', async () => {
    const mod = await import('./ciclo_servicio');
    expect(mod.ETIQUETA_SEMILLA).toMatch(/propuesta/i);
  });
});

describe('cicloDelServicio con filas de la flota', () => {
  it('ordena por `orden` aunque lleguen desordenadas', () => {
    const filas: CicloServicioFila[] = [
      { tenantId: T1, servicio: 'importacion', orden: 2, hito: 'llegada_cliente', activo: true },
      { tenantId: T1, servicio: 'importacion', orden: 1, hito: 'confirmar', activo: true },
    ];
    expect(cicloDelServicio(filas, 'importacion').pasos).toEqual(['confirmar', 'llegada_cliente']);
  });

  it('un paso apagado no se recorre', () => {
    const filas = filasDe(T1).map((f) => (f.servicio === 'importacion' && f.hito === 'rampa' ? { ...f, activo: false } : f));
    expect(cicloDelServicio(filas, 'importacion').pasos).not.toContain('rampa');
  });

  it('el ciclo de una flota no lo altera la configuración de otra (filas ajenas ya vienen filtradas por la lectura; aquí, una flota con su propia secuencia)', () => {
    const propia: CicloServicioFila[] = [
      { tenantId: T2, servicio: 'importacion', orden: 1, hito: 'confirmar', activo: true },
      { tenantId: T2, servicio: 'importacion', orden: 2, hito: 'fin_descarga', activo: true },
    ];
    expect(cicloDelServicio(propia, 'importacion').pasos).toEqual(['confirmar', 'fin_descarga']);
    expect(cicloDelServicio(filasDe(T1), 'importacion').pasos).toHaveLength(8);
  });
});

describe('siguientePaso', () => {
  it('en importación nunca pide un hito de carga: tras la llegada a cliente sigue el contacto', () => {
    const c = cicloDelServicio(filasDe(T1), 'importacion');
    const cumplidos = new Set<PasoCiclo>(['confirmar', 'inicio_viaje', 'llegada_cliente']);
    expect(siguientePaso(c, cumplidos)).toBe('contacto');
  });

  it('en exportación, tras el contacto sigue el inicio de carga', () => {
    const c = cicloDelServicio(filasDe(T1), 'exportacion');
    const cumplidos = new Set<PasoCiclo>(['confirmar', 'enlace_origen_destino', 'inicio_viaje_cliente', 'llegada_cita_carga', 'contacto']);
    expect(siguientePaso(c, cumplidos)).toBe('inicio_carga');
  });

  it('con todos cumplidos no queda ninguno', () => {
    const c = cicloActual();
    expect(siguientePaso(c, new Set<PasoCiclo>(TIPOS_HITO))).toBeNull();
  });
});

describe('validarSecuencia y filasDeSemilla', () => {
  it('rechaza vacía, desconocida y repetida', () => {
    expect(validarSecuencia([])).toMatch(/vac/);
    expect(validarSecuencia(['confirmar', 'inventado'])).toMatch(/desconocido/);
    expect(validarSecuencia(['confirmar', 'confirmar'])).toMatch(/repetido/);
    expect(validarSecuencia(['confirmar', 'inicio_viaje'])).toBeNull();
  });

  it('las filas de la semilla llevan la flota pedida y todas activas', () => {
    const f = filasDeSemilla('flota-x');
    expect(f).toHaveLength(SEMILLA_CICLOS.length);
    expect(f.every((x) => x.tenant_id === 'flota-x' && x.activo === true)).toBe(true);
    expect(new Set(f.map((x) => x.servicio))).toEqual(new Set<Servicio>(SERVICIOS));
  });
});

describe('la migración 0807 y el vocabulario de código no se desalinean', () => {
  const sql = readFileSync('supabase/migrations/0807_ciclo_por_servicio.sql', 'utf8');
  const lista = (re: RegExp) => [...(re.exec(sql)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  it('el CHECK de hito lista exactamente los pasos del código', () => {
    expect(lista(/ciclo_servicio_hito_dominio check \(hito in \(([\s\S]*?)\)\)/).sort()).toEqual([...PASOS_CICLO].sort());
  });

  it('el CHECK de servicio lista exactamente los tres servicios', () => {
    expect(lista(/ciclo_servicio_servicio_dominio check \(servicio in \(([\s\S]*?)\)\)/).sort()).toEqual([...SERVICIOS].sort());
  });

  it('es aditiva: sin drop de tablas ni columnas, sin alter de tablas ajenas', () => {
    expect(sql).not.toMatch(/drop\s+table|drop\s+column|alter\s+table\s+(?!public\.ciclo_servicio)/i);
  });
});
