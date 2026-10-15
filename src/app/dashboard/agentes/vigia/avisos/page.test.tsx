import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// LA BANDEJA DE AVISOS (página + server actions):
//   · sesión, rol y tenant se resuelven desde la cookie; NINGUNA acción lee un tenant_id del formulario;
//   · solo el dueño y el encargado deciden; otro rol que ve la pantalla recibe la lista sin botones y sin teléfonos completos;
//   · cada botón comprueba el estado del aviso DE SU FLOTA: confirmar aprueba (no manda), copiar entrega por la ruta 'copiar',
//     editar deja constancia, descartar cierra, capturar valida y guarda;
//   · un fallo de la base se dice en llano y no filtra el contenido del aviso al log.
// Se llama la página, se toma la acción de las props de la vista y se invoca.
// ═══════════════════════════════════════════════════════════════════════════

let sesion: { tenantId: string; rol: string; userId: string } = { tenantId: 't-sesion', rol: 'encargado', userId: 'u-sesion' };
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: vi.fn(async () => sesion) }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: (rol: string) => ['superadmin', 'flota_admin', 'encargado', 'contador_ve'].includes(rol) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw new Error(`REDIRECT ${u}`); }) }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/likida/errores', () => ({ mensajeParaPantalla: (_e: unknown, que: string) => `No se pudo ${que}` }));

const bandeja = vi.hoisted(() => ({
  listar: vi.fn(), obtener: vi.fn(), contarPendientes: vi.fn(), aprobar: vi.fn(), reabrir: vi.fn(), editarTexto: vi.fn(), guardarDatoManual: vi.fn(),
}));
vi.mock('@/lib/likida/vigia/aviso/bandeja', async () => {
  const real = await vi.importActual<typeof import('@/lib/likida/vigia/aviso/bandeja')>('@/lib/likida/vigia/aviso/bandeja');
  return { ...real, crearRepoBandeja: () => bandeja, crearDepsCopia: vi.fn((t: string, h: boolean, z: string) => ({ marca: 'deps-copia', t, h, z })) };
});
const leerConfig = vi.hoisted(() => vi.fn());
vi.mock('@/lib/likida/vigia/aviso/repo', async () => {
  const real = await vi.importActual<typeof import('@/lib/likida/vigia/aviso/repo')>('@/lib/likida/vigia/aviso/repo');
  return { ...real, crearRepoAviso: () => ({ leerConfig }) };
});
const cambios = vi.hoisted(() => ({ filasPorIds: vi.fn(), cambiarEstado: vi.fn() }));
vi.mock('@/lib/likida/vigia/aviso/cambios', async () => {
  const real = await vi.importActual<typeof import('@/lib/likida/vigia/aviso/cambios')>('@/lib/likida/vigia/aviso/cambios');
  return { ...real, crearRepoCambios: () => cambios };
});
const entregarAviso = vi.hoisted(() => vi.fn());
vi.mock('@/lib/likida/vigia/aviso/entrega', async () => {
  const real = await vi.importActual<typeof import('@/lib/likida/vigia/aviso/entrega')>('@/lib/likida/vigia/aviso/entrega');
  return { ...real, entregarAviso };
});

const Pagina = (await import('./page')).default;
const { AvisoSinMigrar } = await import('@/lib/likida/vigia/aviso/repo');
import type { AvisoBandeja } from '@/lib/likida/vigia/aviso/bandeja';

const ID = '44444444-4444-4444-8444-444444444444';
const FILA = '22222222-2222-4222-8222-222222222222';

type Resultado = null | { ok: true; mensaje: string } | { ok: false; error: string };
type Props = {
  accion: (p: null, f: FormData) => Promise<Resultado>; puedeDecidir: boolean; avisoEncendido: boolean | null; soloPendientes: boolean;
  errorLectura: string | null; sinMigrar: boolean; total: number; sufijo: string;
  grupos: Array<{ fecha: string; clientes: Array<{ cliente: string; tarjetas: Array<{ id: string; texto: string; puede: Record<string, boolean> }> }> }>;
};

async function props(sp: Record<string, string> = {}): Promise<Props> {
  const el = (await Pagina({ searchParams: Promise.resolve(sp) })) as ReactElement<Props>;
  return el.props;
}
const forma = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.append(k, v); return f; };

const aviso = (p: Partial<AvisoBandeja> = {}): AvisoBandeja => ({
  id: ID, filaId: FILA, clienteId: 'c1', version: 1, estado: 'pendiente_confirmacion', canal: 'cliente_1a1',
  texto: 'Datos de la unidad asignada a tu viaje:\nCaja: CJ-100\nTeléfono del operador: 5212899900001',
  datos: { tipo: 'inicial', pendientes: ['placas_caja'], valores: { caja: 'CJ-100' } }, motivo: null, error: null,
  creadoEn: '2026-10-20T14:00:00.000Z', aprobadoEn: null, enviadoEn: null, ...p,
});
const FILA_PROG = { id: FILA, fecha: '2026-10-21', tipo: 'IMPORTACION', cliente: 'CLIENTE SINT 01', consignatario: null, caja: 'CJ-100', unidad: 'U-7', citaEn: null, citaTexto: '08:00', transito: 'patio', ccp: 'listo', visible: true };
const CFG = { habilitado: true, zona: 'America/Mexico_City' };

beforeEach(() => {
  sesion = { tenantId: 't-sesion', rol: 'encargado', userId: 'u-sesion' };
  vi.clearAllMocks();
  leerConfig.mockResolvedValue(CFG);
  bandeja.listar.mockResolvedValue([aviso()]);
  bandeja.obtener.mockResolvedValue(aviso());
  bandeja.aprobar.mockResolvedValue(true);
  bandeja.reabrir.mockResolvedValue(true);
  bandeja.editarTexto.mockResolvedValue(true);
  bandeja.guardarDatoManual.mockResolvedValue('guardado');
  cambios.filasPorIds.mockResolvedValue([FILA_PROG]);
  cambios.cambiarEstado.mockResolvedValue(true);
  entregarAviso.mockResolvedValue({ estado: 'enviado', via: 'copia_manual' });
});

describe('la página', () => {
  it('lista los avisos DE LA FLOTA de la sesión con la fila del programa de cada uno', async () => {
    const p = await props();
    expect(bandeja.listar).toHaveBeenCalledWith('t-sesion', expect.any(String), false);
    expect(leerConfig).toHaveBeenCalledWith('t-sesion');
    expect(cambios.filasPorIds).toHaveBeenCalledWith('t-sesion', [FILA]);
    expect(p.total).toBe(1);
    expect(p.grupos[0].fecha).toBe('2026-10-21');
    expect(p.grupos[0].clientes[0].cliente).toBe('CLIENTE SINT 01');
    expect(p.avisoEncendido).toBe(true);
    expect(p.errorLectura).toBeNull();
  });
  it('?pendientes=1 pide solo los pendientes', async () => {
    const p = await props({ pendientes: '1' });
    expect(bandeja.listar).toHaveBeenCalledWith('t-sesion', expect.any(String), true);
    expect(p.soloPendientes).toBe(true);
  });
  it('el sufijo de tenant viaja a la vista', async () => {
    expect((await props({ tenant: 'abc' })).sufijo).toBe('?tenant=abc');
  });
  it('el dueño y el encargado deciden; quien solo mira recibe la lista sin botones y sin teléfonos completos', async () => {
    expect((await props()).puedeDecidir).toBe(true);
    sesion = { ...sesion, rol: 'flota_admin' };
    expect((await props()).puedeDecidir).toBe(true);
    sesion = { ...sesion, rol: 'contador_ve' };
    const p = await props();
    expect(p.puedeDecidir).toBe(false);
    const t = p.grupos[0].clientes[0].tarjetas[0];
    expect(Object.values(t.puede).some(Boolean)).toBe(false);
    expect(t.texto).not.toContain('5212899900001');
  });
  it('un rol sin la pantalla rebota (el contador no entra)', async () => {
    sesion = { ...sesion, rol: 'contador' };
    await expect(props()).rejects.toThrow(/REDIRECT \/dashboard/);
    expect(bandeja.listar).not.toHaveBeenCalled();
  });
  it('sin fila de configuración el aviso está apagado', async () => {
    leerConfig.mockResolvedValue(null);
    expect((await props()).avisoEncendido).toBe(false);
  });
  it('0797 sin aplicar: lo dice, no inventa una lista vacía', async () => {
    bandeja.listar.mockRejectedValue(new AvisoSinMigrar());
    const p = await props();
    expect(p.sinMigrar).toBe(true);
    expect(p.errorLectura).toBeNull();
    expect(p.total).toBe(0);
  });
  it('falla la base: mensaje llano, sin el error crudo en pantalla', async () => {
    bandeja.listar.mockRejectedValue(new Error('base caída password=hunter2'));
    const p = await props();
    expect(p.errorLectura).toMatch(/No pude leer los avisos/);
    expect(JSON.stringify(p.errorLectura)).not.toContain('hunter2');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('quién puede actuar', () => {
  it('quien solo mira no actúa aunque forje la acción; no toca la base', async () => {
    sesion = { ...sesion, rol: 'contador_ve' };
    const { accion } = await props();
    for (const a of ['confirmar', 'copiar', 'editar', 'descartar', 'capturar']) {
      const r = await accion(null, forma({ id: ID, accion: a, texto: 'x', placasCaja: 'ABC-123' }));
      expect(r && !r.ok && r.error).toMatch(/Solo el dueño o el encargado/);
    }
    expect(bandeja.obtener).not.toHaveBeenCalled();
    expect(bandeja.aprobar).not.toHaveBeenCalled();
    expect(cambios.cambiarEstado).not.toHaveBeenCalled();
  });
  it('un id que no es UUID se rechaza antes de tocar la base', async () => {
    const { accion } = await props();
    const r = await accion(null, forma({ id: "1'; drop table vigia_aviso; --", accion: 'descartar' }));
    expect(r && !r.ok && r.error).toBe('Aviso no válido.');
    expect(bandeja.obtener).not.toHaveBeenCalled();
  });
  it('el tenant sale de la SESIÓN: un tenant_id forjado en el formulario no cambia nada', async () => {
    const { accion } = await props();
    await accion(null, forma({ id: ID, accion: 'descartar', tenant_id: 'otra-flota', tenantId: 'otra-flota' }));
    expect(bandeja.obtener).toHaveBeenCalledWith('t-sesion', ID);
    expect(cambios.cambiarEstado).toHaveBeenCalledWith('t-sesion', ID, 'pendiente_confirmacion', 'descartado', expect.any(String));
    const todo = JSON.stringify([bandeja.obtener.mock.calls, cambios.cambiarEstado.mock.calls]);
    expect(todo).not.toContain('otra-flota');
  });
  it('un aviso que no es de esta flota (la base no lo devuelve) → no lo encuentra', async () => {
    bandeja.obtener.mockResolvedValue(null);
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'descartar' }));
    expect(r && !r.ok && r.error).toMatch(/No encuentro ese aviso en tu flota/);
    expect(cambios.cambiarEstado).not.toHaveBeenCalled();
  });
  it('una acción desconocida se rechaza', async () => {
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'autoenviar_texto_libre' }));
    expect(r && !r.ok && r.error).toBe('Acción no válida.');
  });
});

describe('Confirmar y enviar', () => {
  it('aprueba con quién y cuándo; NO envía desde aquí (lo hace la pasada del cron con sus puertas)', async () => {
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'confirmar' }));
    expect(r?.ok).toBe(true);
    expect(bandeja.aprobar).toHaveBeenCalledWith('t-sesion', ID, 'pendiente_confirmacion', 'u-sesion', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(entregarAviso).not.toHaveBeenCalled();
    expect(r && r.ok && r.mensaje).toMatch(/siguiente revisión automática/);
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/agentes/vigia/avisos');
  });
  it('solo aplica a un aviso de WhatsApp directo que espera confirmación', async () => {
    const { accion } = await props();
    for (const a of [aviso({ canal: 'ejecutivo_copia' }), aviso({ estado: 'enviado' }), aviso({ estado: 'fallido' }), aviso({ estado: 'aprobado' }), aviso({ datos: { interno: true } })]) {
      bandeja.obtener.mockResolvedValue(a);
      const r = await accion(null, forma({ id: ID, accion: 'confirmar' }));
      expect(r && !r.ok && r.error).toBe('Este aviso ya no espera tu confirmación.');
    }
    expect(bandeja.aprobar).not.toHaveBeenCalled();
  });
  it('con el aviso apagado no aprueba', async () => {
    leerConfig.mockResolvedValue({ habilitado: false, zona: 'America/Mexico_City' });
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'confirmar' }));
    expect(r && !r.ok && r.error).toMatch(/apagado/);
    expect(bandeja.aprobar).not.toHaveBeenCalled();
    leerConfig.mockResolvedValue(null);
    expect((await accion(null, forma({ id: ID, accion: 'confirmar' })))?.ok).toBe(false);
  });
  it('si otra persona lo cambió antes, no pisa: lo dice', async () => {
    bandeja.aprobar.mockResolvedValue(false);
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'confirmar' }));
    expect(r && !r.ok && r.error).toMatch(/Otra persona ya cambió este aviso/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('Copiar y marcar enviado', () => {
  const pendienteCopia = () => bandeja.obtener.mockResolvedValueOnce(aviso({ canal: 'ejecutivo_copia' }))
    .mockResolvedValueOnce(aviso({ canal: 'ejecutivo_copia', estado: 'aprobado', aprobadoEn: '2026-10-20T15:00:00.000Z' }));

  it('aprueba (canal de copia) y entrega por la ruta «copiar», que no toca a Meta', async () => {
    pendienteCopia();
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'copiar' }));
    expect(bandeja.aprobar).toHaveBeenCalledWith('t-sesion', ID, 'pendiente_confirmacion', 'u-sesion', expect.any(String), 'ejecutivo_copia');
    expect(entregarAviso).toHaveBeenCalledTimes(1);
    const [av, deps, modo] = entregarAviso.mock.calls[0];
    expect(av).toMatchObject({ id: ID, tenantId: 't-sesion', estado: 'aprobado', canal: 'ejecutivo_copia' });
    expect(deps).toMatchObject({ marca: 'deps-copia', t: 't-sesion', h: true });
    expect(modo).toBe('copiar');
    expect(r).toEqual({ ok: true, mensaje: 'Listo: quedó marcado como enviado.' });
  });
  it('un aviso ya aprobado en canal de copia no se aprueba otra vez', async () => {
    bandeja.obtener.mockResolvedValue(aviso({ canal: 'ejecutivo_copia', estado: 'aprobado' }));
    const { accion } = await props();
    await accion(null, forma({ id: ID, accion: 'copiar' }));
    expect(bandeja.aprobar).not.toHaveBeenCalled();
    expect(entregarAviso).toHaveBeenCalledTimes(1);
  });
  it('un fallido por WhatsApp directo pasa a copia manual (la salida que el mensaje de error ofrece)', async () => {
    bandeja.obtener.mockResolvedValueOnce(aviso({ estado: 'fallido', canal: 'cliente_1a1' }))
      .mockResolvedValueOnce(aviso({ estado: 'aprobado', canal: 'ejecutivo_copia' }));
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'copiar' }));
    expect(bandeja.aprobar).toHaveBeenCalledWith('t-sesion', ID, 'fallido', 'u-sesion', expect.any(String), 'ejecutivo_copia');
    expect(r?.ok).toBe(true);
  });
  it('sin destinatario se reabre primero y luego se aprueba', async () => {
    bandeja.obtener.mockResolvedValueOnce(aviso({ estado: 'sin_destinatario', canal: 'ejecutivo_copia' }))
      .mockResolvedValueOnce(aviso({ estado: 'aprobado', canal: 'ejecutivo_copia' }));
    const { accion } = await props();
    await accion(null, forma({ id: ID, accion: 'copiar' }));
    expect(bandeja.reabrir).toHaveBeenCalledWith('t-sesion', ID);
    expect(bandeja.aprobar).toHaveBeenCalledWith('t-sesion', ID, 'pendiente_confirmacion', 'u-sesion', expect.any(String), 'ejecutivo_copia');
    expect(bandeja.reabrir.mock.invocationCallOrder[0]).toBeLessThan(bandeja.aprobar.mock.invocationCallOrder[0]);
  });
  it('un aviso aprobado para salir por WhatsApp directo no se puede copiar (saldría dos veces)', async () => {
    bandeja.obtener.mockResolvedValue(aviso({ estado: 'aprobado', canal: 'cliente_1a1' }));
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'copiar' }));
    expect(r && !r.ok && r.error).toMatch(/ya está aprobado para salir por WhatsApp/);
    expect(entregarAviso).not.toHaveBeenCalled();
  });
  it('enviado, descartado o alerta interna no se marcan', async () => {
    const { accion } = await props();
    for (const a of [aviso({ estado: 'enviado' }), aviso({ estado: 'descartado' }), aviso({ datos: { interno: true }, canal: 'ejecutivo_copia' })]) {
      bandeja.obtener.mockResolvedValue(a);
      expect((await accion(null, forma({ id: ID, accion: 'copiar' })))?.ok).toBe(false);
    }
    expect(entregarAviso).not.toHaveBeenCalled();
  });
  it('con el aviso apagado no hace nada', async () => {
    leerConfig.mockResolvedValue({ habilitado: false, zona: 'America/Mexico_City' });
    bandeja.obtener.mockResolvedValue(aviso({ canal: 'ejecutivo_copia' }));
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'copiar' }));
    expect(r && !r.ok && r.error).toMatch(/apagado/);
    expect(bandeja.aprobar).not.toHaveBeenCalled();
  });
  it('si otra llamada lo reclamó, no se marca dos veces', async () => {
    pendienteCopia();
    entregarAviso.mockResolvedValue({ estado: 'perdido' });
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'copiar' }));
    expect(r && !r.ok && r.error).toMatch(/Otra persona está procesando/);
  });
  it('si el estado cambió entre leer y aprobar, no entrega', async () => {
    bandeja.obtener.mockResolvedValue(aviso({ canal: 'ejecutivo_copia' }));
    bandeja.aprobar.mockResolvedValue(false);
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'copiar' }));
    expect(r && !r.ok && r.error).toMatch(/Otra persona ya cambió/);
    expect(entregarAviso).not.toHaveBeenCalled();
  });
});

describe('Editar', () => {
  it('guarda el texto nuevo y deja constancia (quién y cuándo)', async () => {
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'editar', texto: '  Texto corregido\r\nCaja: CJ-101  ' }));
    expect(r?.ok).toBe(true);
    expect(bandeja.editarTexto).toHaveBeenCalledWith('t-sesion', expect.objectContaining({ id: ID, estado: 'pendiente_confirmacion' }), 'Texto corregido\nCaja: CJ-101', 'u-sesion', expect.any(String));
  });
  it('vacío, igual al actual o demasiado largo se rechaza sin tocar la base', async () => {
    const { accion } = await props();
    expect((await accion(null, forma({ id: ID, accion: 'editar', texto: '   ' })))).toEqual({ ok: false, error: 'El texto no puede quedar vacío.' });
    const igual = (await accion(null, forma({ id: ID, accion: 'editar', texto: aviso().texto })));
    expect(igual && !igual.ok && igual.error).toBe('No cambiaste nada del texto.');
    const largo = (await accion(null, forma({ id: ID, accion: 'editar', texto: 'x'.repeat(1001) })));
    expect(largo && !largo.ok && largo.error).toMatch(/pasa de 1000/);
    expect(bandeja.editarTexto).not.toHaveBeenCalled();
  });
  it('un aviso aprobado, enviado o interno ya no se edita', async () => {
    const { accion } = await props();
    for (const a of [aviso({ estado: 'aprobado' }), aviso({ estado: 'enviado' }), aviso({ datos: { interno: true } })]) {
      bandeja.obtener.mockResolvedValue(a);
      const r = await accion(null, forma({ id: ID, accion: 'editar', texto: 'otro' }));
      expect(r && !r.ok && r.error).toBe('Este aviso ya no se puede editar.');
    }
    expect(bandeja.editarTexto).not.toHaveBeenCalled();
  });
  it('si cambió el estado mientras tanto, lo dice', async () => {
    bandeja.editarTexto.mockResolvedValue(false);
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'editar', texto: 'otro' }));
    expect(r && !r.ok && r.error).toMatch(/Otra persona ya cambió/);
  });
});

describe('Descartar', () => {
  it('cierra el aviso con el estado que se leyó (condicional) y un motivo fijo', async () => {
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'descartar' }));
    expect(r).toEqual({ ok: true, mensaje: 'Descartado: no se enviará.' });
    expect(cambios.cambiarEstado).toHaveBeenCalledWith('t-sesion', ID, 'pendiente_confirmacion', 'descartado', 'descartado por una persona');
  });
  it('un aprobado por enviar también se puede descartar; un enviado no', async () => {
    const { accion } = await props();
    bandeja.obtener.mockResolvedValue(aviso({ estado: 'aprobado' }));
    expect((await accion(null, forma({ id: ID, accion: 'descartar' })))?.ok).toBe(true);
    bandeja.obtener.mockResolvedValue(aviso({ estado: 'enviado' }));
    const r = await accion(null, forma({ id: ID, accion: 'descartar' }));
    expect(r && !r.ok && r.error).toBe('Este aviso ya no se puede descartar.');
  });
  it('si ya cambió, no pisa', async () => {
    cambios.cambiarEstado.mockResolvedValue(false);
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'descartar' }));
    expect(r && !r.ok && r.error).toMatch(/Otra persona ya cambió/);
  });
});

describe('Capturar lo que falta', () => {
  it('valida y guarda para la FILA del aviso (no la que diga el formulario)', async () => {
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'capturar', placasCaja: ' abc 123 ', telefono: '2899900001', filaId: 'otra-fila' }));
    expect(r?.ok).toBe(true);
    expect(bandeja.guardarDatoManual).toHaveBeenCalledWith('t-sesion', FILA, 'u-sesion', { placasCaja: 'ABC123', telefono: '522899900001' });
    expect(JSON.stringify(bandeja.guardarDatoManual.mock.calls)).not.toContain('otra-fila');
  });
  it('un dato inválido se explica y no guarda', async () => {
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'capturar', placasCaja: '!!' }));
    expect(r && !r.ok && r.error).toMatch(/Placas de la caja/);
    const vacio = await accion(null, forma({ id: ID, accion: 'capturar' }));
    expect(vacio && !vacio.ok && vacio.error).toMatch(/al menos un dato/);
    expect(bandeja.guardarDatoManual).not.toHaveBeenCalled();
  });
  it('un aviso aprobado o enviado ya no admite datos', async () => {
    bandeja.obtener.mockResolvedValue(aviso({ estado: 'enviado' }));
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'capturar', placasCaja: 'ABC-123' }));
    expect(r && !r.ok && r.error).toMatch(/ya no admite datos/);
    expect(bandeja.guardarDatoManual).not.toHaveBeenCalled();
  });
  it('una fila ajena no se guarda', async () => {
    bandeja.guardarDatoManual.mockResolvedValue('fila_ajena');
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'capturar', placasCaja: 'ABC-123' }));
    expect(r && !r.ok && r.error).toMatch(/No encuentro ese servicio/);
  });
});

describe('fallas', () => {
  it('falla la base: mensaje llano y el log lleva el error técnico pero NUNCA el texto del aviso ni datos del operador', async () => {
    bandeja.aprobar.mockRejectedValue(new Error('base caída'));
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'confirmar' }));
    expect(r && !r.ok && r.error).toBe('No se pudo actualizar el aviso');
    const log = JSON.stringify(logger.error.mock.calls);
    expect(log).toContain('base caída');
    expect(log).not.toContain('5212899900001');
    expect(log).not.toContain('Datos de la unidad');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it('0797 sin aplicar en una acción: lo dice en llano', async () => {
    bandeja.obtener.mockRejectedValue(new AvisoSinMigrar());
    const { accion } = await props();
    const r = await accion(null, forma({ id: ID, accion: 'confirmar' }));
    expect(r && !r.ok && r.error).toMatch(/todavía no está lista/);
  });
});
