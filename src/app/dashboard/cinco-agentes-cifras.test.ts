import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cierreDosMeses, type ArchivoCierre, type LineaCierre } from '@/lib/likida/peajes/cierre_mensual';

// El lector REAL con la capa de datos sustituida por espías: se prueba la puerta (rol + perfil) y que los lectores
// prohibidos (getKpis & co.) jamás se toquen. El cierre se calcula con `cierreDosMeses` real sobre archivos sintéticos.
const cierreDosMesesDeFlota = vi.fn();
vi.mock('@/lib/likida/peajes/revision_cobros', () => ({ cierreDosMesesDeFlota }));
const perfilDeTenant = vi.fn();
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant }));
const getKpis = vi.fn(async () => ({}));
const getGastoPorSemana = vi.fn(async () => ({ categorias: [], series: [] }));
const getDineroObservadoPorTipo = vi.fn(async () => []);
vi.mock('@/lib/likida/analytics', () => ({ getKpis, getGastoPorSemana, getDineroObservadoPorTipo }));

const { leerCifrasPesosCincoAgentes } = await import('./cinco-agentes-cifras');
const {
  puedeVerCifrasPesos, cifraImporteDecena, cifraExtemporaneos, etiquetaPeriodo,
} = await import('./cinco-agentes-cifras-modelo');

const lin = (fecha: string, monto: number, i = 0): LineaCierre => ({ fecha, hora: `10:00:${String(i % 60).padStart(2, '0')}`, caseta: 'Caseta Ejemplo Norte', tag: `TAG${i}`, monto });
const arch = (id: string, desde: string, hasta: string, lineas: LineaCierre[]): ArchivoCierre => ({ id, etiqueta: id, periodoDesde: desde, periodoHasta: hasta, lineas });
const dosMeses = (mes: string, archivos: ArchivoCierre[]) => {
  const r = cierreDosMeses(mes, archivos);
  if ('error' in r) throw new Error(r.error);
  return r;
};

// Septiembre completo (3 decenas) y de octubre solo la primera, con un cruce de septiembre cobrado tarde.
const SEP1 = arch('sep1', '2026-09-01', '2026-09-10', [lin('2026-09-02', 1000, 1), lin('2026-09-05', 500, 2)]);
const SEP2 = arch('sep2', '2026-09-11', '2026-09-20', [lin('2026-09-12', 2000, 3)]);
const SEP3 = arch('sep3', '2026-09-21', '2026-09-30', [lin('2026-09-22', 3000, 4), lin('2026-09-25', 250.5, 5)]);
const OCT1 = arch('oct1', '2026-10-01', '2026-10-10', [lin('2026-10-02', 4000, 6), lin('2026-10-08', 1500.4, 7), lin('2026-09-28', 100, 8), lin('2026-09-29', 40, 9)]);

beforeEach(() => vi.clearAllMocks());

describe('puerta: rol con dinero Y perfil cinco_agentes', () => {
  it('solo dueño y contador con perfil cinco_agentes; el encargado nunca; sin perfil nadie', () => {
    expect(puedeVerCifrasPesos('flota_admin', 'cinco_agentes')).toBe(true);
    expect(puedeVerCifrasPesos('contador', 'cinco_agentes')).toBe(true);
    expect(puedeVerCifrasPesos('encargado', 'cinco_agentes')).toBe(false);
    expect(puedeVerCifrasPesos('vendedor', 'cinco_agentes')).toBe(false);
    expect(puedeVerCifrasPesos('flota_admin', null)).toBe(false);
  });
});

describe('leerCifrasPesosCincoAgentes — la puerta decide qué se CONSULTA', () => {
  it('encargado: null, sin consultar ni el perfil ni ningún dato', async () => {
    perfilDeTenant.mockResolvedValue('cinco_agentes');
    expect(await leerCifrasPesosCincoAgentes('t1', 'encargado', '2026-10-31')).toBeNull();
    expect(perfilDeTenant).not.toHaveBeenCalled();
    expect(cierreDosMesesDeFlota).not.toHaveBeenCalled();
  });

  it('flota sin perfil: null y no lee un solo dato de peajes', async () => {
    perfilDeTenant.mockResolvedValue(null);
    expect(await leerCifrasPesosCincoAgentes('t1', 'flota_admin', '2026-10-31')).toBeNull();
    expect(cierreDosMesesDeFlota).not.toHaveBeenCalled();
  });

  it.each(['flota_admin', 'contador'])('%s con perfil cinco_agentes: lee una vez el mes de hoy y entrega las dos cifras', async (rol) => {
    perfilDeTenant.mockResolvedValue('cinco_agentes');
    cierreDosMesesDeFlota.mockResolvedValue(dosMeses('2026-10', [SEP1, SEP2, SEP3, OCT1]));
    const r = await leerCifrasPesosCincoAgentes('t1', rol, '2026-10-31');
    expect(cierreDosMesesDeFlota).toHaveBeenCalledTimes(1);
    expect(cierreDosMesesDeFlota).toHaveBeenCalledWith('t1', '2026-10');
    expect(r?.importeDecena.sello).toBe('Medido');
    // La puerta pide el perfil en la variante que NO abre si no se pudo leer.
    expect(perfilDeTenant).toHaveBeenCalledWith('t1', expect.any(Number), 'permitir');
    expect(r?.extemporaneos.n).toBe(2);
    // Los lectores del flujo nativo (que darían $0) no se tocan jamás.
    expect(getKpis).not.toHaveBeenCalled();
    expect(getGastoPorSemana).not.toHaveBeenCalled();
    expect(getDineroObservadoPorTipo).not.toHaveBeenCalled();
  });

  it('superadmin (ve dinero) pasa la puerta con perfil cinco_agentes', async () => {
    expect(puedeVerCifrasPesos('superadmin', 'cinco_agentes')).toBe(true);
    perfilDeTenant.mockResolvedValue('cinco_agentes');
    cierreDosMesesDeFlota.mockResolvedValue(dosMeses('2026-10', [OCT1]));
    expect(await leerCifrasPesosCincoAgentes('t1', 'superadmin', '2026-10-31')).not.toBeNull();
  });

  it('perfil ilegible (la variante que no abre devuelve null): la puerta falla cerrada', async () => {
    perfilDeTenant.mockResolvedValue(null);
    expect(await leerCifrasPesosCincoAgentes('t1', 'flota_admin', '2026-10-31')).toBeNull();
    expect(cierreDosMesesDeFlota).not.toHaveBeenCalled();
  });

  it('fallo de lectura: Sin dato con reintentar, nunca $0', async () => {
    perfilDeTenant.mockResolvedValue('cinco_agentes');
    cierreDosMesesDeFlota.mockRejectedValue(new Error('timeout con TAG IMDM123 e importe 99'));
    const r = await leerCifrasPesosCincoAgentes('t1', 'contador', '2026-10-31');
    for (const c of [r!.importeDecena, r!.extemporaneos]) {
      expect(c.sello).toBe('Sin dato');
      expect(c.valor).toBeNull();
      expect(c.valorTexto).toBeNull();
      expect(c.reintentar).toBe(true);
    }
    expect(r!.extemporaneos.n).toBeNull();
  });

  it('cierre que devuelve {error}: también Sin dato con reintentar', async () => {
    perfilDeTenant.mockResolvedValue('cinco_agentes');
    cierreDosMesesDeFlota.mockResolvedValue({ error: 'mes inválido' });
    const r = await leerCifrasPesosCincoAgentes('t1', 'flota_admin', '2026-10-31');
    expect(r!.importeDecena).toMatchObject({ sello: 'Sin dato', valor: null, reintentar: true });
  });
});

describe('importe de la decena (a)', () => {
  const dos = dosMeses('2026-10', [SEP1, SEP2, SEP3, OCT1]);

  it('toma la última decena con archivo y la compara con la anterior rotulando que son periodos distintos', () => {
    const c = cifraImporteDecena(dos, '2026-10-31');
    expect(c.periodo).toBe('1 al 10 de octubre de 2026');
    // 4000 + 1500.40 (los dos cruces de septiembre cobrados tarde no inflan la decena)
    expect(c.valor).toBe(5500.4);
    expect(c.valorTexto).toBe('$5,500');
    expect(c.cruces).toBe(2);
    expect(c.sello).toBe('Medido');
    expect(c.anterior).toMatchObject({ valor: 3250.5, valorTexto: '$3,251', periodo: '21 al 30 de septiembre de 2026' });
    expect(c.anterior?.rotulo).toContain('Periodos distintos');
    expect(c.anterior?.rotulo).toContain('No es el mismo periodo');
  });

  it('declara la decena terminada sin archivo y NO presenta el mes con una sola decena como mes', () => {
    const c = cifraImporteDecena(dos, '2026-10-31');
    expect(c.decenasFaltantes).toEqual(['11 a 20 de octubre de 2026']); // la 21-31 aún corre: no «falta»
    expect(c.rotulo).toContain('Faltan por cargar');
    const e = cifraExtemporaneos(dos, '2026-10-31');
    expect(e.periodo).toBe('decenas cargadas de octubre de 2026: 1 a 10');
    expect(e.periodo).not.toBe('octubre de 2026');
  });

  it('decena en curso: Estimado', () => {
    const c = cifraImporteDecena(dos, '2026-10-08');
    expect(c.sello).toBe('Estimado');
    expect(c.rotulo).toContain('puede crecer');
  });

  it('sin ningún archivo en la ventana: Sin dato (no $0), con motivo', () => {
    const c = cifraImporteDecena(dosMeses('2026-10', []), '2026-10-31');
    expect(c).toMatchObject({ sello: 'Sin dato', valor: null, valorTexto: null, periodo: null, cruces: null, anterior: null, reintentar: false });
    expect(c.motivo).toBeTruthy();
    const e = cifraExtemporaneos(dosMeses('2026-10', []), '2026-10-31');
    expect(e).toMatchObject({ sello: 'Sin dato', valor: null, n: null });
  });

  it('un archivo que cubre la decena pero no trae cruces dentro de ella es Sin dato, no $0', () => {
    const vacio = arch('v', '2026-10-01', '2026-10-10', [lin('2026-09-28', 100, 1)]);
    const c = cifraImporteDecena(dosMeses('2026-10', [vacio]), '2026-10-31');
    expect(c.sello).toBe('Sin dato');
    expect(c.valor).toBeNull();
  });

  it('sin decena inmediata anterior cargada, compara con la más cercana y lo dice', () => {
    const c = cifraImporteDecena(dosMeses('2026-10', [SEP1, OCT1]), '2026-10-31');
    expect(c.anterior?.periodo).toBe('1 al 10 de septiembre de 2026');
    expect(c.anterior?.rotulo).toContain('decenas intermedias sin archivo');
  });

  it('con la decena más reciente en el mes anterior (hoy a inicio de mes) sigue funcionando', () => {
    const o3 = arch('o3', '2026-10-21', '2026-10-31', [lin('2026-10-22', 700, 1)]);
    const c = cifraImporteDecena(dosMeses('2026-11', [OCT1, o3]), '2026-11-02');
    expect(c.periodo).toBe('21 al 31 de octubre de 2026');
    expect(c.anterior?.periodo).toBe('1 al 10 de octubre de 2026');
  });

  it('un cobro repetido entre archivos baja el sello a Estimado y se declara', () => {
    const a = arch('a', '2026-10-01', '2026-10-10', [lin('2026-10-02', 100, 1)]);
    const b = arch('b', '2026-10-01', '2026-10-10', [lin('2026-10-02', 100, 1)]);
    const c = cifraImporteDecena(dosMeses('2026-10', [a, b]), '2026-10-31');
    expect(c.sello).toBe('Estimado');
    expect(c.rotulo).toContain('más de un archivo');
  });
});

describe('decena más reciente con archivo pero sin cruces', () => {
  it('se declara en vez de cifrar la anterior en silencio', () => {
    const vacia = arch('o2', '2026-10-11', '2026-10-20', [lin('2026-10-05', 30, 1)]); // solo un tardío: sin cruces dentro de 11-20
    const dos = dosMeses('2026-10', [OCT1, vacia]);
    const c = cifraImporteDecena(dos, '2026-10-31');
    expect(c.periodo).toBe('1 al 10 de octubre de 2026');
    expect(c.decenasSinCruces).toEqual(['11 a 20 de octubre de 2026']);
    expect(c.sello).toBe('Estimado');
    expect(c.rotulo).toContain('sin cruces');
    expect(cifraExtemporaneos(dos, '2026-10-31').decenasSinCruces).toEqual(['11 a 20 de octubre de 2026']);
  });
});

describe('extemporáneos (b)', () => {
  it('cantidad y monto de candidatos, sin acusar', () => {
    const e = cifraExtemporaneos(dosMeses('2026-10', [SEP1, SEP2, SEP3, OCT1]), '2026-10-31');
    expect(e.n).toBe(2);
    expect(e.valor).toBe(140);
    expect(e.valorTexto).toBe('$140');
    expect(e.rotulo).toContain('candidatos');
    expect(e.rotulo).toContain('Definición provisional');
    expect(JSON.stringify(e).toLowerCase()).not.toContain('indebido');
    // Con decenas faltantes la cifra es parcial: Estimado.
    expect(e.sello).toBe('Estimado');
    expect(e.decenasFaltantes).toEqual(['11 a 20 de octubre de 2026']);
  });

  it('mes completo: se nombra el mes; el sello sigue Estimado mientras la definición sea provisional', () => {
    const o2 = arch('o2', '2026-10-11', '2026-10-20', [lin('2026-10-12', 10, 1)]);
    const o3 = arch('o3', '2026-10-21', '2026-10-31', [lin('2026-10-22', 10, 2)]);
    const e = cifraExtemporaneos(dosMeses('2026-10', [OCT1, o2, o3]), '2026-11-05');
    expect(e.periodo).toBe('octubre de 2026');
    expect(e.sello).toBe('Estimado');
    expect(e.rotulo).toContain('provisional');
    expect(e.decenasFaltantes).toEqual([]);
  });

  it('cero candidatos medidos es un cero real; sin archivo es Sin dato', () => {
    const limpio = arch('l', '2026-10-01', '2026-10-10', [lin('2026-10-02', 50, 1)]);
    const e = cifraExtemporaneos(dosMeses('2026-10', [limpio]), '2026-10-31');
    expect(e.n).toBe(0);
    expect(e.valor).toBe(0);
    expect(e.sello).toBe('Estimado'); // faltan decenas
  });
});

describe('formato', () => {
  it('etiquetaPeriodo', () => {
    expect(etiquetaPeriodo('2026-10-21', '2026-10-31')).toBe('21 al 31 de octubre de 2026');
  });
});

describe('fronteras del código', () => {
  const dir = __dirname;
  const modelo = readFileSync(join(dir, 'cinco-agentes-cifras-modelo.ts'), 'utf8');
  const lector = readFileSync(join(dir, 'cinco-agentes-cifras.ts'), 'utf8');
  const importaciones = (s: string) => [...s.matchAll(/^import[^;]*from '([^']+)'/gm)].map((m) => m[1]);

  it('el modelo no importa nada del servidor (ni base, ni perfil, ni reader)', () => {
    for (const ruta of importaciones(modelo)) {
      expect(ruta).toMatch(/^@\/lib\/(likida\/peajes\/cierre_mensual|auth\/visibilidad|formato)$/);
    }
  });

  it('ninguno de los dos reusa los lectores del flujo nativo', () => {
    for (const fuente of [modelo, lector]) {
      expect(fuente).not.toMatch(/import[^;]*(peajesDeGasto|getKpis|getDineroObservadoPorTipo|getGastoPorSemana)/);
      expect(fuente).not.toMatch(/@\/lib\/likida\/analytics/);
    }
  });
});
