import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CUENTAS_PROPUESTAS } from '@/lib/backoffice/cuentas';
import { candadoDeEntidad } from '@/lib/backoffice/fiscal';
import { NO_DISPONIBLE, OK, type Lectura } from '@/lib/backoffice/lectura';
import { armarLibro, cobro, gastoNube } from '@/lib/backoffice/libro_fixtures';
import { comprobacionesLibro, delPeriodo, type AsientoLibro } from '@/lib/backoffice/libro';
import { armarPaquete } from '@/lib/backoffice/paquete-contable';

// La pantalla Contabilidad: la puerta de superadmin, el candado de entidad (sin RFC nada fiscal se rellena), «No disponible. No es cero.» cuando
// la tabla no existe, y el libro con sus gráficas, comprobaciones y paquete cuando hay datos.
const dobles = vi.hoisted(() => {
  class ErrorLibro extends Error {
    constructor(public readonly codigo: string, public readonly detalle: string) { super(detalle); }
  }
  return {
    ErrorLibro, requireSuperadmin: vi.fn(), leerPaqueteDelMes: vi.fn(), leerObligaciones: vi.fn(), leerCumplimientos: vi.fn(),
    otros: vi.fn(),
  };
});

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/backoffice/contabilidad', () => ({
  ErrorLibro: dobles.ErrorLibro,
  leerPaqueteDelMes: dobles.leerPaqueteDelMes, leerObligaciones: dobles.leerObligaciones, leerCumplimientos: dobles.leerCumplimientos,
  leerEntidad: dobles.otros, leerCuentas: dobles.otros, marcarPresentada: dobles.otros, marcarPaqueteListo: dobles.otros, registrarAsiento: dobles.otros, reversarAsiento: dobles.otros,
}));
vi.mock('@/lib/formato', async (importar) => ({ ...(await importar<typeof import('@/lib/formato')>()), hoyMx: () => '2026-11-16' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import ContabilidadPage from './page';

const CUENTAS = CUENTAS_PROPUESTAS.map((c) => ({ ...c }));
const PERIODO = '2026-11-01';
const OBLIGACIONES = [
  { clave: 'iva_mensual', nombre: 'IVA: declaración mensual', periodicidad: 'mensual', diaLimite: 17, mesLimite: null, mesesDesfase: 1, requiereEntidad: true, estadoCatalogo: 'pendiente_de_contador', nota: null },
  { clave: 'conservacion_5_anios', nombre: 'Conservación de la contabilidad', periodicidad: 'evento', diaLimite: null, mesLimite: null, mesesDesfase: 0, requiereEntidad: false, estadoCatalogo: 'pendiente_de_contador', nota: null },
];

interface Opciones { rfc?: string | null; libro?: AsientoLibro[] | 'ausente' | 'error' }

function datos(o: Opciones = {}) {
  const entidad = OK({ rfc: o.rfc ?? null, razonSocial: null, constituidaEl: '2026-10-01' });
  const candado = candadoDeEntidad(entidad);
  const libro: Lectura<{ asientos: AsientoLibro[]; truncado: boolean }> =
    o.libro === 'ausente' ? NO_DISPONIBLE : o.libro === 'error' ? { estado: 'error', mensaje: 'caída' } : OK({ asientos: o.libro ?? [], truncado: false });
  const todos = libro.estado === 'ok' ? libro.dato.asientos : null;
  const delMes = todos ? delPeriodo(todos, PERIODO) : null;
  const comprobaciones = todos ? comprobacionesLibro(todos, CUENTAS) : null;
  const paquete = delMes && comprobaciones
    ? armarPaquete({ periodo: PERIODO, candado, asientos: delMes, cuentas: CUENTAS, comprobaciones, gastos: null, rfcPorProveedor: {}, cierre: null, ivaTrasladadoCent: null })
    : null;
  return { entidad, candado, cuentas: OK(CUENTAS), libro, comprobaciones, delMes, gastos: NO_DISPONIBLE, cierre: NO_DISPONIBLE, paquete };
}

const html = async (sp: { periodo?: string } = {}) => renderToStaticMarkup(await ContabilidadPage({ searchParams: Promise.resolve(sp) }));

const LIBRO_DEL_MES = armarLibro([
  { fecha: '2026-11-03', lineas: cobro(100000), soporte: 'cfdi', descripcion: 'Mensualidad de prueba' },
  { fecha: '2026-11-09', lineas: gastoNube(30000), soporte: 'ninguno', descripcion: 'Gasto de nube sin factura' },
]);

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'superadmin', nombre: 'Javier' });
  dobles.leerPaqueteDelMes.mockResolvedValue(datos());
  dobles.leerObligaciones.mockResolvedValue(OK(OBLIGACIONES));
  dobles.leerCumplimientos.mockResolvedValue(OK([]));
});

describe('puerta y mes', () => {
  it('llama a requireSuperadmin en el render y lee el mes de México (no el de UTC)', async () => {
    await html();
    expect(dobles.requireSuperadmin).toHaveBeenCalled();
    expect(dobles.leerPaqueteDelMes).toHaveBeenCalledWith('2026-11-01');
  });

  it('el mes se elige por la URL, con enlaces al anterior y al siguiente; una URL inválida cae al mes actual', async () => {
    const h = await html({ periodo: '2026-08' });
    expect(dobles.leerPaqueteDelMes).toHaveBeenCalledWith('2026-08-01');
    expect(h).toContain('periodo=2026-07');
    expect(h).toContain('periodo=2026-09');
    await html({ periodo: 'basura' });
    expect(dobles.leerPaqueteDelMes).toHaveBeenLastCalledWith('2026-11-01');
  });
});

describe('«No disponible. No es cero.»', () => {
  it('con las tablas sin aplicar no pinta ceros ni «sin movimientos»: lo dice', async () => {
    dobles.leerPaqueteDelMes.mockResolvedValue({ ...datos({ libro: 'ausente' }), cuentas: NO_DISPONIBLE });
    dobles.leerObligaciones.mockResolvedValue(NO_DISPONIBLE);
    const h = await html();
    expect(h).toContain('No disponible ahora. No es cero.');
    expect(h).not.toContain('$0.00');
    expect(h).not.toContain('Sin movimientos en el mes');
    expect(h).not.toContain('Sin pólizas');
  });

  it('un fallo de la base se dice «No se pudo leer» (no se disfraza de vacío)', async () => {
    dobles.leerPaqueteDelMes.mockResolvedValue({ ...datos({ libro: 'error' }) });
    const h = await html();
    expect(h).toContain('No se pudo leer');
    expect(h).not.toContain('Sin movimientos en el mes');
  });
});

describe('candado de entidad (sin RFC propio)', () => {
  it('dice que Likida no tiene razón social ni RFC, bloquea el paquete y NO pone fechas a las obligaciones', async () => {
    dobles.leerPaqueteDelMes.mockResolvedValue(datos({ rfc: null, libro: LIBRO_DEL_MES }));
    const h = await html();
    expect(h).toContain('Likida aún no tiene razón social ni RFC propios');
    expect(h).toContain('Bloqueado');
    expect(h).toContain('Sin RFC propio');
    expect(h).toContain('Aún no aplica');
    expect(h).toContain('No evaluable sin RFC');
    expect(h).toContain('Información general; un contador lo revisa antes de la primera declaración');
    expect(h).not.toMatch(/2026-1[0-2]-17|2027-0[1-3]-\d\d/);
    expect(h).not.toContain('Marcar presentada');
    expect(h).not.toContain('Balanza (CSV)');
  });

  it('sin RFC el libro SÍ funciona: resultados del mes y pólizas se ven', async () => {
    dobles.leerPaqueteDelMes.mockResolvedValue(datos({ rfc: null, libro: LIBRO_DEL_MES }));
    const h = await html();
    expect(h).toContain('Pólizas recientes');
    expect(h).toContain('Mensualidad de prueba');
    expect(h).toContain('$700.00'); // resultado del mes: 1,000 − 300
  });

  it('un libro vacío dice «Sin movimientos», no una utilidad de cero', async () => {
    dobles.leerPaqueteDelMes.mockResolvedValue(datos({ rfc: null, libro: [] }));
    const h = await html();
    expect(h).toContain('Sin movimientos en el mes');
    expect(h).toContain('Sin pólizas');
    // el resultado del mes no se pinta como una utilidad de cero: la cifra dice que no hay movimientos
    expect(h).not.toMatch(/Resultado del mes<\/span><\/span><span class="rv-kpi__fila"><span class="rv-kpi__valor"[^>]*>\$0\.00/);
  });
});

describe('con RFC y libro', () => {
  beforeEach(() => { dobles.leerPaqueteDelMes.mockResolvedValue(datos({ rfc: 'ABC010101AB1', libro: LIBRO_DEL_MES })); });

  it('muestra el calendario con fecha nominal, la vigencia y el formulario de «presentada» (con acuse)', async () => {
    const h = await html();
    expect(h).toContain('Calendario fiscal');
    expect(h).toContain('2026-11-17');
    expect(h).toContain('Pendiente de contador');
    expect(h).toContain('Vence en 1 día');
    expect(h).toContain('Marcar presentada');
    expect(h).toContain('name="acuseRef"');
    expect(h).toContain('nunca presenta ante el SAT');
  });

  it('las comprobaciones salen por dos vías y el paquete ofrece CSV genérico, con los movimientos sin CFDI marcados', async () => {
    const h = await html();
    expect(h).toContain('Comprobaciones por dos vías');
    expect(h).toContain('Balanza: debe contra haber');
    expect(h).toContain('4 de 4');
    expect(h).toContain('Balanza (CSV)');
    expect(h).toContain('data:text/csv');
    expect(h).toContain('no es el layout de CONTPAQi');
    expect(h).toContain('SIN CFDI — no incluir sin revisión');
  });

  it('el cruce sin cierre no cuadra ni deja de cuadrar: «sin cierre», y no ajusta', async () => {
    const h = await html();
    expect(h).toContain('Sin cierre para comparar');
    expect(h).toContain('el sistema no ajusta nada');
  });

  it('el asiento manual trae su clave de idempotencia oculta y seis renglones; reversar pide motivo', async () => {
    const h = await html();
    expect(h).toContain('name="claveIdem"');
    expect((h.match(/name="debe_\d"/g) ?? []).length).toBe(6);
    expect((h.match(/name="cuenta_\d"/g) ?? []).length).toBe(6);
    expect(h).toContain('Reversar un asiento manual');
    expect(h).toContain('Plan de cuentas: propuesta; el contador lo define');
  });

  it('cada render trae claves de envío distintas (un reintento reutiliza la de su formulario, no la de otro)', async () => {
    const a = await html();
    const b = await html();
    const clave = (h: string) => /name="claveIdem" value="(asiento-[0-9a-f-]+)"/.exec(h)?.[1];
    expect(clave(a)).toBeTruthy();
    expect(clave(a)).not.toBe(clave(b));
  });

  it('sin textos de jerga interna ni h1 propio (el marco pone el título)', async () => {
    const h = await html();
    expect(h).not.toMatch(/migraci[oó]n\s+0\d{3}/i);
    expect((h.match(/<h1/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});
