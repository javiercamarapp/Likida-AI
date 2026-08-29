import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Lo que más cuesta si falla: que un flota_admin (o cualquiera que no sea
// superadmin) ejecute una acción de plataforma, y que un comando mal formado
// caiga en silencio. Las acciones reales (aprobarPieza/crearOrden/
// resolverPieza) ya tienen sus propias pruebas — aquí se mockean como
// funciones ya probadas y se prueba SOLO el pegamento: gramática,
// autorización, el fallback de las dos colas, y la bitácora.
// ═══════════════════════════════════════════════════════════════════════════

const anotarBitacora = vi.fn(async () => true);
vi.mock('./bitacora_escritura', () => ({
  anotarBitacora: (...a: unknown[]) => anotarBitacora(...(a as [])),
}));

const registrarEventoSeguridad = vi.fn(async () => {});
vi.mock('@/lib/seguridad/eventos', () => ({
  registrarEventoSeguridad: (...a: unknown[]) => registrarEventoSeguridad(...(a as [])),
}));

const aprobarPieza = vi.fn(async (_id: string, _actorId: string) => {});
const bandejaPendiente = vi.fn(async (prioridad: string) => (prioridad === 'urgente' ? [{ id: 'u1' }] : []));
vi.mock('./agentes/cola', () => ({
  aprobarPieza: (...a: unknown[]) => aprobarPieza(...(a as [string, string])),
  bandejaPendiente: (...a: unknown[]) => bandejaPendiente(...(a as [string])),
}));

const getEstadoBus = vi.fn(async () => ({
  rutinas: [
    { nombre: 'auditoria-diaria', horario: '07:00', descripcion: '', encargoMd: '', ultimaCorrida: { inicio: '2026-08-28T07:00:00Z', fin: '2026-08-28T07:10:00Z', veredicto: 'ok', prUrl: null, exitCode: 0 } },
    { nombre: 'cuota-diesel', horario: 'viernes', descripcion: '', encargoMd: '', ultimaCorrida: null },
  ],
  piezasPendientes: [{ id: 'p1' } as unknown],
  ordenesRecientes: [],
  killSwitchPendiente: false,
  errores: [] as string[],
}));
const crearOrden = vi.fn(async (_tipo: string, _rutina: string | null, _actorEmail: string) => {});
const resolverPieza = vi.fn(async (_id: string, _accion: string, _actorEmail: string) => {});
vi.mock('@/lib/admin/bus', () => ({
  getEstadoBus: (...a: unknown[]) => getEstadoBus(...(a as [])),
  crearOrden: (...a: unknown[]) => crearOrden(...(a as [string, string | null, string])),
  resolverPieza: (...a: unknown[]) => resolverPieza(...(a as [string, string, string])),
}));

import { interpretarComandoAdmin, atenderComandoAdmin, type CuentaAdminWa } from './admin_comandos_wa';
import { DatoInvalido } from './errores';

const SUPERADMIN: CuentaAdminWa = { userId: 'u-super', email: 'javier@likida.ai', tenantId: null, rol: 'superadmin' };
const FLOTA_ADMIN_A: CuentaAdminWa = { userId: 'u-flota-a', email: 'duenoA@flota.com', tenantId: 'tenant-a', rol: 'flota_admin' };
const FLOTA_ADMIN_B: CuentaAdminWa = { userId: 'u-flota-b', email: 'duenoB@flota.com', tenantId: 'tenant-b', rol: 'flota_admin' };
const ENCARGADO: CuentaAdminWa = { userId: 'u-enc', email: 'jefe@flota.com', tenantId: 'tenant-a', rol: 'encargado' };

beforeEach(() => {
  vi.clearAllMocks();
  aprobarPieza.mockImplementation(async () => {});
  bandejaPendiente.mockImplementation(async (prioridad: string) => (prioridad === 'urgente' ? [{ id: 'u1' }] : []));
  getEstadoBus.mockImplementation(async () => ({
    rutinas: [
      { nombre: 'auditoria-diaria', horario: '07:00', descripcion: '', encargoMd: '', ultimaCorrida: { inicio: '2026-08-28T07:00:00Z', fin: '2026-08-28T07:10:00Z', veredicto: 'ok', prUrl: null, exitCode: 0 } },
      { nombre: 'cuota-diesel', horario: 'viernes', descripcion: '', encargoMd: '', ultimaCorrida: null },
    ],
    piezasPendientes: [{ id: 'p1' }],
    ordenesRecientes: [],
    killSwitchPendiente: false,
    errores: [],
  }));
  crearOrden.mockImplementation(async () => {});
  resolverPieza.mockImplementation(async () => {});
});

describe('interpretarComandoAdmin — la gramática', () => {
  it('no reconoce un texto que no empieza con uno de los tres verbos', () => {
    expect(interpretarComandoAdmin('¿cómo van?')).toBeNull();
    expect(interpretarComandoAdmin('nuevo viaje para Juan')).toBeNull();
    expect(interpretarComandoAdmin('')).toBeNull();
    expect(interpretarComandoAdmin('   ')).toBeNull();
  });

  it('"estatus" solo, sin argumento', () => {
    expect(interpretarComandoAdmin('estatus')).toEqual({ tipo: 'estatus', rutina: null });
    expect(interpretarComandoAdmin('  ESTATUS  ')).toEqual({ tipo: 'estatus', rutina: null });
  });

  it('"estatus <rutina>" normaliza a minúsculas', () => {
    expect(interpretarComandoAdmin('Estatus Auditoria-Diaria')).toEqual({ tipo: 'estatus', rutina: 'auditoria-diaria' });
  });

  it('"estatus" con un argumento con forma rara es malformado, no null', () => {
    expect(interpretarComandoAdmin('estatus algo con espacios')).toEqual({ tipo: 'malformado', verbo: 'estatus' });
  });

  it('"aprobar <id>" toma el id tal cual', () => {
    expect(interpretarComandoAdmin('aprobar 3f9a-1234')).toEqual({ tipo: 'aprobar', id: '3f9a-1234' });
  });

  it('"aprobar" sin id, o con un id con espacios, es malformado', () => {
    expect(interpretarComandoAdmin('aprobar')).toEqual({ tipo: 'malformado', verbo: 'aprobar' });
    expect(interpretarComandoAdmin('aprobar   ')).toEqual({ tipo: 'malformado', verbo: 'aprobar' });
    expect(interpretarComandoAdmin('aprobar abc def')).toEqual({ tipo: 'malformado', verbo: 'aprobar' });
  });

  it('"correr <rutina>" normaliza a minúsculas', () => {
    expect(interpretarComandoAdmin('Correr Auditoria-Diaria')).toEqual({ tipo: 'correr', rutina: 'auditoria-diaria' });
  });

  it('"correr" sin rutina es malformado', () => {
    expect(interpretarComandoAdmin('correr')).toEqual({ tipo: 'malformado', verbo: 'correr' });
  });
});

describe('atenderComandoAdmin — autorización por rol', () => {
  it('el superadmin SÍ ejecuta un comando reconocido', async () => {
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'estatus');
    expect(r).not.toBeNull();
    expect(r).toMatch(/rutina/i);
    expect(getEstadoBus).toHaveBeenCalled();
  });

  it('un flota_admin NO puede correr una rutina — ni la suya ni la de otra flota', async () => {
    const r = await atenderComandoAdmin(FLOTA_ADMIN_A, '5215550000002', 'correr auditoria-diaria');
    expect(r).toMatch(/no tienes permiso/i);
    expect(crearOrden).not.toHaveBeenCalled();
    expect(getEstadoBus).not.toHaveBeenCalled();
  });

  it('un flota_admin de OTRA flota tampoco puede aprobar una pieza de plataforma', async () => {
    const r = await atenderComandoAdmin(FLOTA_ADMIN_B, '5215550000003', 'aprobar p1');
    expect(r).toMatch(/no tienes permiso/i);
    expect(aprobarPieza).not.toHaveBeenCalled();
  });

  it('un usuario sin rol de admin (encargado) no dispara ningún comando', async () => {
    const r = await atenderComandoAdmin(ENCARGADO, '5215550000004', 'estatus');
    expect(r).toMatch(/no tienes permiso/i);
    expect(getEstadoBus).not.toHaveBeenCalled();
  });

  it('la negación de rol se anota como evento de seguridad, con el rol y el comando', async () => {
    await atenderComandoAdmin(FLOTA_ADMIN_A, '5215550000002', 'correr auditoria-diaria');
    expect(registrarEventoSeguridad).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'acceso_denegado',
      actor: FLOTA_ADMIN_A.userId,
      tenantId: FLOTA_ADMIN_A.tenantId,
      detalle: expect.objectContaining({ comando: 'correr', rol: 'flota_admin' }),
    }));
    // Y no queda además como una entrada de bitácora de acción ejecutada.
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('un texto que no es ninguno de los tres verbos devuelve null incluso para flota_admin', async () => {
    const r = await atenderComandoAdmin(FLOTA_ADMIN_A, '5215550000002', '¿cómo van?');
    expect(r).toBeNull();
    expect(registrarEventoSeguridad).not.toHaveBeenCalled();
  });
});

describe('atenderComandoAdmin — comando mal formado', () => {
  it('responde con ayuda clara y NO llega a ejecutar nada (ni siquiera para superadmin)', async () => {
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'aprobar');
    expect(r).toMatch(/así se usa/i);
    expect(aprobarPieza).not.toHaveBeenCalled();
    expect(anotarBitacora).not.toHaveBeenCalled();
  });
});

describe('atenderComandoAdmin — "estatus"', () => {
  it('estatus general resume rutinas, piezas y la cola de envíos', async () => {
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'estatus');
    expect(r).toContain('2 rutina(s)');
    expect(r).toContain('1 pieza(s)');
    expect(r).toContain('1 envío(s)'); // 1 urgente + 0 normales, del mock
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'admin_wa.estatus', entidadId: 'general', entidad: 'comando_admin_wa' }),
      expect.anything(),
    );
  });

  it('estatus <rutina> conocida da el detalle de esa rutina', async () => {
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'estatus auditoria-diaria');
    expect(r).toContain('auditoria-diaria');
    expect(r).toMatch(/ok/);
  });

  it('estatus <rutina> desconocida dice claramente que no la encontró', async () => {
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'estatus no-existe');
    expect(r).toMatch(/no encontré la rutina/i);
    expect(r).toContain('auditoria-diaria'); // sugiere las que sí existen
  });

  it('si getEstadoBus truena, se dice que no se pudo leer — no se calla', async () => {
    getEstadoBus.mockRejectedValueOnce(new Error('conexión caída'));
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'estatus');
    expect(r).toMatch(/no pude leer el estatus/i);
  });
});

describe('atenderComandoAdmin — "aprobar <id>"', () => {
  it('aprueba desde cola_aprobacion cuando ahí está pendiente', async () => {
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'aprobar abc-123');
    expect(aprobarPieza).toHaveBeenCalledWith('abc-123', SUPERADMIN.userId);
    expect(resolverPieza).not.toHaveBeenCalled();
    expect(r).toMatch(/aprobé el envío/i);
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'admin_wa.aprobar', entidadId: 'abc-123' }),
      expect.anything(),
    );
  });

  it('si no está en cola_aprobacion, prueba bus_pieza antes de rendirse', async () => {
    aprobarPieza.mockRejectedValueOnce(new DatoInvalido('Esa pieza ya no está pendiente — alguien la resolvió antes. Recarga la bandeja.'));
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'aprobar bus-9');
    expect(resolverPieza).toHaveBeenCalledWith('bus-9', 'aprobada', SUPERADMIN.email);
    expect(r).toMatch(/aprobé la pieza de rutina/i);
  });

  it('si NO existe en ninguna de las dos colas, lo dice con honestidad', async () => {
    aprobarPieza.mockRejectedValueOnce(new DatoInvalido('no pendiente'));
    resolverPieza.mockRejectedValueOnce(new Error('Esa pieza ya estaba resuelta.'));
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'aprobar ghost-1');
    expect(r).toMatch(/no encontré una pieza pendiente/i);
  });

  it('un fallo REAL de cola_aprobacion (no "no encontrada") no dispara el segundo intento', async () => {
    aprobarPieza.mockRejectedValueOnce(new Error('conexión caída'));
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'aprobar abc-123');
    expect(resolverPieza).not.toHaveBeenCalled();
    expect(r).toMatch(/no se pudo aprobar la pieza/i);
  });
});

describe('atenderComandoAdmin — "correr <rutina>"', () => {
  it('encola correr_ahora cuando la rutina existe en el catálogo', async () => {
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'correr auditoria-diaria');
    expect(crearOrden).toHaveBeenCalledWith('correr_ahora', 'auditoria-diaria', SUPERADMIN.email);
    expect(r).toMatch(/encolé/i);
  });

  it('rechaza correr una rutina que no está en el catálogo, sin encolar nada', async () => {
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'correr rutina-inventada');
    expect(crearOrden).not.toHaveBeenCalled();
    expect(r).toMatch(/no encontré la rutina/i);
  });

  it('un fallo al encolar se contesta, no se calla', async () => {
    crearOrden.mockRejectedValueOnce(new Error('bus_orden inaccesible'));
    const r = await atenderComandoAdmin(SUPERADMIN, '5215550000001', 'correr auditoria-diaria');
    expect(r).toMatch(/no se pudo encolar la rutina/i);
  });
});
