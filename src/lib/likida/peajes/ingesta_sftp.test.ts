import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClienteSftpBinario, DestinoSftp } from '../conectores/tabla_propia/sftp';
import { ErrorTablaPropia } from '../conectores/tabla_propia/contrato';
import type { SftpReclamado } from './datos';

// ═══════════════════════════════════════════════════════════════════════════
// El canal SFTP de peajes (0843), con un DOBLE del cliente (igual que
// `tabla_propia/sftp.test.ts`): nunca toca un servidor real ni la base. El
// cliente real (huella de host, SSRF) ya se prueba en `conectores/tabla_propia/
// sftp.integracion.test.ts`; aquí se prueba el CANAL — qué hace con lo que el
// cliente entrega o rechaza, y que una flota nunca tumba a las demás.
// ═══════════════════════════════════════════════════════════════════════════

const reclamar = vi.fn(async (..._a: unknown[]): Promise<SftpReclamado[]> => []);
const cerrar = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./datos', () => ({ reclamarSftpsPeajes: (...a: unknown[]) => reclamar(...a), cerrarSftpPeajes: (...a: unknown[]) => cerrar(...a) }));

const recibir = vi.fn();
vi.mock('./ingesta', async () => {
  const real = await vi.importActual<typeof import('./ingesta')>('./ingesta');
  return { ...real, recibirArchivoPeaje: (...a: unknown[]) => recibir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { consultarUnSftp, ejecutarSftpPeajes, nombreDeRuta } = await import('./ingesta_sftp');

const HUELLA = 'SHA256:' + 'A'.repeat(43);
const AHORA = new Date('2026-10-20T12:00:00Z');
const descifrarOk = (_: string) => ({ clave: 'clave-secreta', llave: undefined, frase: undefined });

function flota(tenantId: string, over: Partial<SftpReclamado> = {}): SftpReclamado {
  return {
    tenantId,
    destino: { host: `s-${tenantId}.ejemplo.com`, puerto: 22, usuario: 'likida', ruta: `/entrega/${tenantId}/corte-pase.xlsx`, huellas: [HUELLA] },
    credencialCifrada: 'v1.a.b.c',
    ultimoEn: null, intervaloMin: 60,
    ...over,
  };
}

function clienteQueDevuelve(bytes: Uint8Array | Error) {
  const llamadas: Array<{ destino: DestinoSftp; maxBytes: number }> = [];
  const cliente: ClienteSftpBinario = {
    leerArchivoBinario: async (destino, o) => {
      llamadas.push({ destino, maxBytes: o.maxBytes });
      if (bytes instanceof Error) throw bytes;
      return bytes;
    },
  };
  return { cliente, llamadas };
}

const XLSX_FALSO = new TextEncoder().encode('contenido-del-corte-no-real');

beforeEach(() => {
  reclamar.mockClear(); cerrar.mockClear(); recibir.mockClear();
  reclamar.mockResolvedValue([]);
  recibir.mockResolvedValue({ ok: true, id: 'arch-1', duplicado: false, estado: 'pendiente' });
});

describe('nombreDeRuta', () => {
  it('toma el último segmento; una ruta sin segmentos cae a un nombre por omisión', () => {
    expect(nombreDeRuta('/entrega/flota/corte-pase.xlsx')).toBe('corte-pase.xlsx');
    expect(nombreDeRuta('/')).toBe('corte');
  });
});

describe('consultarUnSftp — conexión exitosa entrega el archivo al importador', () => {
  it('descarga por el cliente SFTP (bytes crudos, sin decodificar) y lo entrega a recibirArchivoPeaje con el nombre y el origen correctos', async () => {
    const { cliente, llamadas } = clienteQueDevuelve(XLSX_FALSO);
    const r = await consultarUnSftp(flota('t-1'), { cliente, ahora: () => AHORA, descifrar: descifrarOk });

    expect(r).toMatchObject({ ok: true, recibido: true, duplicado: false, rechazado: false });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].destino).toMatchObject({ host: 's-t-1.ejemplo.com', ruta: '/entrega/t-1/corte-pase.xlsx', huellas: [HUELLA], clave: 'clave-secreta' });
    expect(recibir).toHaveBeenCalledTimes(1);
    const [tenantId, cuerpo, origen] = recibir.mock.calls[0] as [string, { nombre: string; contenido: Buffer }, string];
    expect(tenantId).toBe('t-1');
    expect(origen).toBe('sftp');
    expect(cuerpo.nombre).toBe('corte-pase.xlsx');
    expect(Buffer.compare(cuerpo.contenido, Buffer.from(XLSX_FALSO))).toBe(0);
  });

  it('duplicado por huella del CONTENIDO (el proveedor no cambió el archivo): se cuenta aparte, nunca como fallo', async () => {
    recibir.mockResolvedValue({ ok: true, id: 'arch-1', duplicado: true, estado: 'procesada' });
    const r = await consultarUnSftp(flota('t-1'), { ...clienteQueDevuelve(XLSX_FALSO), ahora: () => AHORA, descifrar: descifrarOk } as never);
    expect(r).toMatchObject({ ok: true, recibido: false, duplicado: true });
  });
});

describe('huella de host incorrecta → se rechaza, nunca entrega nada al importador', () => {
  it('ErrorTablaPropia clase credencial (huella no coincide) cierra con su mensaje fijo, sin tocar recibirArchivoPeaje', async () => {
    const e = new ErrorTablaPropia('La huella del servidor SFTP no coincide con la configurada (el servidor presentó SHA256:otra). Si la llave del servidor cambió a propósito, actualiza huella_host; si no, no se lee: puede haber alguien interpuesto.', 'credencial');
    const { cliente } = clienteQueDevuelve(e);
    const r = await consultarUnSftp(flota('t-1'), { cliente, ahora: () => AHORA, descifrar: descifrarOk });
    expect(r).toMatchObject({ ok: false, error: e.message });
    expect(recibir).not.toHaveBeenCalled();
  });

  it('el mensaje NUNCA repite la contraseña ni la llave (clasificación por clase, no el texto crudo de ssh2)', async () => {
    const e = new Error('boom con clave-secreta y la-frase-de-la-llave');
    const { cliente } = clienteQueDevuelve(e);
    const r = await consultarUnSftp(flota('t-1'), { cliente, ahora: () => AHORA, descifrar: descifrarOk });
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain('clave-secreta');
    expect(JSON.stringify(r)).not.toContain('la-frase-de-la-llave');
  });
});

describe('ejecutarSftpPeajes — un fallo de red de UNA flota no tumba el cron', () => {
  it('dos flotas: la primera falla de red (proveedor), la segunda se procesa igual; el resumen cuenta ambas', async () => {
    const falloRed = new ErrorTablaPropia('No se pudo conectar con el servidor SFTP.', 'proveedor');
    let llamada = 0;
    const clienteMixto: ClienteSftpBinario = {
      leerArchivoBinario: async () => { llamada++; if (llamada === 1) throw falloRed; return XLSX_FALSO; },
    };
    reclamar.mockResolvedValue([flota('t-1'), flota('t-2')]);

    const r = await ejecutarSftpPeajes({}, { cliente: clienteMixto, ahora: () => AHORA, descifrar: descifrarOk });

    expect(r).toMatchObject({ reclamadas: 2, exitosas: 1, fallidas: 1, recibidos: 1 });
    // Las DOS flotas se cerraron (ninguna se quedó colgada con su lease): la que falló con error, la que
    // sirvió con éxito — y el proceso entero no lanzó.
    expect(cerrar).toHaveBeenCalledTimes(2);
    expect(cerrar).toHaveBeenCalledWith('t-1', expect.objectContaining({ ok: false, error: falloRed.message }));
    expect(cerrar).toHaveBeenCalledWith('t-2', expect.objectContaining({ ok: true }));
  });

  it('si el cliente lanza algo que no es un ErrorTablaPropia (excepción cruda), el canal lo atrapa igual y sigue con la siguiente flota', async () => {
    const clienteQueExplota: ClienteSftpBinario = { leerArchivoBinario: async () => { throw new TypeError('algo truena'); } };
    reclamar.mockResolvedValue([flota('t-1')]);
    const r = await ejecutarSftpPeajes({}, { cliente: clienteQueExplota, ahora: () => AHORA, descifrar: descifrarOk });
    expect(r).toMatchObject({ reclamadas: 1, fallidas: 1, exitosas: 0 });
    expect(cerrar).toHaveBeenCalledWith('t-1', expect.objectContaining({ ok: false }));
  });

  it('reclamarSftpsPeajes rechaza (RPC caída): ejecutarSftpPeajes LANZA — el cron ya lo envuelve en su propio try/catch (ver route.ts)', async () => {
    reclamar.mockRejectedValueOnce(new Error('rpc caída'));
    await expect(ejecutarSftpPeajes({}, { ...clienteQueDevuelve(XLSX_FALSO), ahora: () => AHORA, descifrar: descifrarOk } as never)).rejects.toThrow('rpc caída');
  });
});

describe('aislamiento por tenant — cada flota usa SU destino y SU credencial, nunca la de otra', () => {
  it('dos flotas reclamadas a la vez: el cliente recibe el host/ruta/huella de CADA una, y recibirArchivoPeaje el tenantId correcto', async () => {
    const vistos: DestinoSftp[] = [];
    const cliente: ClienteSftpBinario = { leerArchivoBinario: async (d) => { vistos.push(d); return XLSX_FALSO; } };
    reclamar.mockResolvedValue([flota('tenant-a'), flota('tenant-b')]);

    await ejecutarSftpPeajes({}, { cliente, ahora: () => AHORA, descifrar: descifrarOk });

    expect(vistos).toHaveLength(2);
    expect(vistos[0]).toMatchObject({ host: 's-tenant-a.ejemplo.com', ruta: '/entrega/tenant-a/corte-pase.xlsx' });
    expect(vistos[1]).toMatchObject({ host: 's-tenant-b.ejemplo.com', ruta: '/entrega/tenant-b/corte-pase.xlsx' });
    expect(recibir).toHaveBeenNthCalledWith(1, 'tenant-a', expect.anything(), 'sftp');
    expect(recibir).toHaveBeenNthCalledWith(2, 'tenant-b', expect.anything(), 'sftp');
  });

  it('la credencial descifrada de una flota nunca se usa para la huella de otra (cada destino trae SUS huellas)', async () => {
    const vistos: DestinoSftp[] = [];
    const cliente: ClienteSftpBinario = { leerArchivoBinario: async (d) => { vistos.push(d); return XLSX_FALSO; } };
    const huellaB = 'SHA256:' + 'B'.repeat(43);
    reclamar.mockResolvedValue([
      flota('tenant-a', { destino: { host: 's-a.ejemplo.com', puerto: 22, usuario: 'u-a', ruta: '/a/corte.xlsx', huellas: [HUELLA] } }),
      flota('tenant-b', { destino: { host: 's-b.ejemplo.com', puerto: 2222, usuario: 'u-b', ruta: '/b/corte.xlsx', huellas: [huellaB] } }),
    ]);

    await ejecutarSftpPeajes({}, { cliente, ahora: () => AHORA, descifrar: descifrarOk });

    expect(vistos[0].huellas).toEqual([HUELLA]);
    expect(vistos[1].huellas).toEqual([huellaB]);
    expect(vistos[0].usuario).toBe('u-a');
    expect(vistos[1].usuario).toBe('u-b');
  });
});

describe('sin credencial guardada (ni clave ni llave) → error claro, sin intentar conectar', () => {
  it('se cierra con el motivo y jamás llama al cliente', async () => {
    const { cliente, llamadas } = clienteQueDevuelve(XLSX_FALSO);
    const r = await consultarUnSftp(flota('t-1', { credencialCifrada: null }), { cliente, ahora: () => AHORA, descifrar: () => ({}) });
    expect(r).toMatchObject({ ok: false });
    expect(llamadas).toHaveLength(0);
  });
});
