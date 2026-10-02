import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import ssh2, { type Connection, type ParsedKey, type SFTPWrapper } from 'ssh2';
import { ErrorTablaPropia } from './contrato';
import { crearLectorTablaPropia } from './lector';
import { crearClienteSftp, huellaDeHex, type DestinoSftp } from './sftp';

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRACIÓN CON UN SERVIDOR SFTP REAL EN PROCESO (el `Server` que trae ssh2) en
// 127.0.0.1, con llaves generadas AQUÍ (host y usuario): nada de red externa ni
// de credenciales reales. Prueba el cliente de verdad: handshake, huella del host,
// contraseña, llave privada (con y sin frase), stat, lectura en streaming, tope
// de tamaño, archivo ausente, permiso, timeout.
// ═══════════════════════════════════════════════════════════════════════════

const { Server, utils } = ssh2;
const STATUS = utils.sftp.STATUS_CODE;
const S_IFREG = 0o100000;

const huellaDeLlave = (publica: string): string => {
  const k = utils.parseKey(publica) as ParsedKey;
  return `SHA256:${createHash('sha256').update(k.getPublicSSH()).digest('base64').replace(/=+$/, '')}`;
};

const hostKey = utils.generateKeyPairSync('ed25519');
const otraHostKey = utils.generateKeyPairSync('ed25519');
const llaveUsuario = utils.generateKeyPairSync('ed25519');
const llaveConFrase = utils.generateKeyPairSync('ed25519', { passphrase: 'frase-de-prueba', cipher: 'aes256-ctr' });
const HUELLA = huellaDeLlave(hostKey.public);
const HUELLA_OTRA = huellaDeLlave(otraHostKey.public);

const CSV = 'id_unidad,latitud,longitud,fecha_hora\nIN-001,25.56,-100.94,2026-10-20 07:20:00\n';
let archivos: Record<string, { contenido: string; tamanoDicho?: number; sinPermiso?: boolean }> = {};
let modoAuth: 'normal' | 'colgado' = 'normal';
let servidor: InstanceType<typeof Server>;
let puerto = 0;
const abiertos = new Set<Connection>();

function atender(sftp: SFTPWrapper): void {
  const handles: Array<string | null> = [];
  const attrs = (a: { contenido: string; tamanoDicho?: number }) => ({ mode: S_IFREG | 0o644, size: a.tamanoDicho ?? a.contenido.length, uid: 0, gid: 0, atime: 0, mtime: 0 });
  sftp.on('STAT', (id, ruta) => {
    const a = archivos[ruta];
    if (!a) return sftp.status(id, STATUS.NO_SUCH_FILE);
    sftp.attrs(id, attrs(a));
  });
  sftp.on('LSTAT', (id, ruta) => {
    const a = archivos[ruta];
    if (!a) return sftp.status(id, STATUS.NO_SUCH_FILE);
    sftp.attrs(id, attrs(a));
  });
  sftp.on('OPEN', (id, ruta) => {
    const a = archivos[ruta];
    if (!a) return sftp.status(id, STATUS.NO_SUCH_FILE);
    if (a.sinPermiso) return sftp.status(id, STATUS.PERMISSION_DENIED);
    handles.push(ruta);
    const h = Buffer.alloc(4); h.writeUInt32BE(handles.length - 1, 0);
    sftp.handle(id, h);
  });
  sftp.on('FSTAT', (id, h) => {
    const ruta = handles[h.readUInt32BE(0)];
    if (ruta === null || ruta === undefined || !archivos[ruta]) return sftp.status(id, STATUS.FAILURE);
    sftp.attrs(id, attrs(archivos[ruta]));
  });
  sftp.on('READ', (id, h, offset, largo) => {
    const ruta = handles[h.readUInt32BE(0)];
    if (ruta === null || ruta === undefined) return sftp.status(id, STATUS.FAILURE);
    const buf = Buffer.from(archivos[ruta].contenido);
    if (offset >= buf.length) return sftp.status(id, STATUS.EOF);
    sftp.data(id, buf.subarray(offset, offset + largo));
  });
  sftp.on('CLOSE', (id) => sftp.status(id, STATUS.OK));
}

beforeAll(async () => {
  servidor = new Server({ hostKeys: [hostKey.private] }, (cliente) => {
    abiertos.add(cliente);
    cliente.on('close', () => abiertos.delete(cliente));
    cliente.on('error', () => undefined);
    cliente.on('authentication', (ctx) => {
      if (modoAuth === 'colgado') return; // nunca contesta: para la prueba de tiempo
      if (ctx.method === 'password' && ctx.username === 'likida' && ctx.password === 'clave-de-prueba') return ctx.accept();
      if (ctx.method === 'publickey' && ctx.username === 'likida') {
        for (const par of [llaveUsuario, llaveConFrase]) {
          const permitida = utils.parseKey(par.public) as ParsedKey;
          const ok = ctx.key.algo === permitida.type && permitida.getPublicSSH().equals(ctx.key.data) && (!ctx.signature || permitida.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true);
          if (ok) return ctx.accept();
        }
      }
      return ctx.reject(['password', 'publickey']);
    });
    cliente.on('ready', () => {
      cliente.on('session', (aceptar) => {
        const sesion = aceptar();
        sesion.on('sftp', (aceptarSftp) => atender(aceptarSftp()));
      });
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  puerto = (servidor.address() as AddressInfo).port;
  return () => new Promise<void>((r) => { for (const c of abiertos) c.end(); servidor.close(() => r()); });
});

afterEach(() => { archivos = {}; modoAuth = 'normal'; });

const cliente = () => crearClienteSftp({ resolver: async () => '127.0.0.1' });
const destino = (extra: Partial<DestinoSftp> = {}): DestinoSftp => ({
  host: 'sftp.ejemplo.com', puerto, usuario: 'likida', clave: 'clave-de-prueba', huellas: [HUELLA], ruta: '/entrega/posiciones.csv', ...extra,
});
const leer = (d: DestinoSftp, o: { maxBytes?: number; timeoutMs?: number } = {}) => cliente().leerArchivo(d, { maxBytes: o.maxBytes ?? 1_000_000, timeoutMs: o.timeoutMs ?? 8_000 });
const falla = async (p: Promise<unknown>): Promise<ErrorTablaPropia> => {
  try { await p; } catch (e) { if (e instanceof ErrorTablaPropia) return e; throw e; }
  throw new Error('debía fallar');
};

describe('cliente SFTP contra un servidor ssh2 real en localhost', () => {
  it('huellaDeHex coincide con la huella estilo OpenSSH de la llave del servidor', () => {
    const hex = createHash('sha256').update((utils.parseKey(hostKey.public) as ParsedKey).getPublicSSH()).digest('hex');
    expect(huellaDeHex(hex)).toBe(HUELLA);
  });

  it('feliz con contraseña: lee el archivo completo', async () => {
    archivos['/entrega/posiciones.csv'] = { contenido: CSV };
    expect(await leer(destino())).toBe(CSV);
  });

  it('feliz con llave privada, con y sin frase', async () => {
    archivos['/entrega/posiciones.csv'] = { contenido: CSV };
    expect(await leer(destino({ clave: undefined, llave: llaveUsuario.private }))).toBe(CSV);
    expect(await leer(destino({ clave: undefined, llave: llaveConFrase.private, frase: 'frase-de-prueba' }))).toBe(CSV);
  });

  it('llave con frase equivocada o ausente → credencial, sin repetir la frase ni la llave', async () => {
    archivos['/entrega/posiciones.csv'] = { contenido: CSV };
    for (const frase of ['otra-frase', undefined]) {
      const e = await falla(leer(destino({ clave: undefined, llave: llaveConFrase.private, frase })));
      expect(e.falla).toBe('credencial');
      expect(e.message).not.toContain('otra-frase');
      expect(e.message).not.toContain('PRIVATE KEY');
    }
  });

  it('una llave basura → credencial (no se pudo leer), no un error genérico', async () => {
    const e = await falla(leer(destino({ clave: undefined, llave: '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n' })));
    expect(e.falla).toBe('credencial');
  });

  it('contraseña incorrecta → credencial, y el mensaje no la repite', async () => {
    const e = await falla(leer(destino({ clave: 'incorrecta-xyz' })));
    expect(e.falla).toBe('credencial');
    expect(e.message).not.toContain('incorrecta-xyz');
  });

  it('usuario sin acceso → credencial', async () => {
    expect((await falla(leer(destino({ usuario: 'intruso' })))).falla).toBe('credencial');
  });

  it('HUELLA DISTINTA del host → falla cerrada antes de mandar la credencial; dice cuál presentó el servidor', async () => {
    archivos['/entrega/posiciones.csv'] = { contenido: CSV };
    const e = await falla(leer(destino({ huellas: [HUELLA_OTRA] })));
    expect(e.falla).toBe('credencial');
    expect(e.message).toContain('no coincide');
    expect(e.message).toContain(HUELLA);
    expect(e.message).not.toContain('clave-de-prueba');
  });

  it('varias huellas aceptadas: basta que una coincida (rotación de la llave del servidor)', async () => {
    archivos['/entrega/posiciones.csv'] = { contenido: CSV };
    expect(await leer(destino({ huellas: [HUELLA_OTRA, HUELLA] }))).toBe(CSV);
  });

  it('archivo ausente → formato (corregir la ruta), no red', async () => {
    const e = await falla(leer(destino({ ruta: '/no/esta.csv' })));
    expect(e.falla).toBe('formato');
    expect(e.message).toContain('no existe');
  });

  it('archivo sin permiso de lectura → credencial', async () => {
    archivos['/entrega/posiciones.csv'] = { contenido: CSV, sinPermiso: true };
    expect((await falla(leer(destino()))).falla).toBe('credencial');
  });

  it('archivo enorme: el stat ya lo rechaza (formato) sin leer un solo byte', async () => {
    archivos['/entrega/posiciones.csv'] = { contenido: CSV.repeat(50) };
    const e = await falla(leer(destino(), { maxBytes: 100 }));
    expect(e.falla).toBe('formato');
    expect(e.message).toContain('pesa más de');
  });

  it('archivo que miente en el stat: el tope se vuelve a verificar MIENTRAS se lee', async () => {
    archivos['/entrega/posiciones.csv'] = { contenido: CSV.repeat(50), tamanoDicho: 10 };
    const e = await falla(leer(destino(), { maxBytes: 100 }));
    expect(e.falla).toBe('formato');
    expect(e.message).toContain('pesa más de');
  });

  it('servidor que no contesta la autenticación: TIMEOUT acotado → proveedor', async () => {
    modoAuth = 'colgado';
    const t0 = Date.now();
    const e = await falla(leer(destino(), { timeoutMs: 600 }));
    expect(e.falla).toBe('proveedor');
    expect(Date.now() - t0).toBeLessThan(4_000);
  });

  it('puerto cerrado → red (proveedor)', async () => {
    const libre = await new Promise<number>((r) => { const s = new Server({ hostKeys: [hostKey.private] }, () => undefined); s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => r(p)); }); });
    const e = await falla(leer(destino({ puerto: libre })));
    expect(e.falla).toBe('proveedor');
  });

  it('un host interno se rechaza ANTES de conectar (sin el resolvedor de prueba)', async () => {
    const e = await falla(crearClienteSftp().leerArchivo(destino({ host: '127.0.0.1' }), { maxBytes: 1_000 }));
    expect(e.falla).toBe('formato');
    expect(e.message).toContain('pública');
  });

  it('de punta a punta por el lector: credencial cifrada → CSV de posiciones y de geocercas por el mismo servidor', async () => {
    archivos['/entrega/posiciones.csv'] = { contenido: CSV };
    archivos['/entrega/geocercas.csv'] = { contenido: 'codigo,nombre,lat_centro,lon_centro,radio_m\nP1,Patio Norte,25.5,-100.9,300\n' };
    const c = crearLectorTablaPropia({
      modo: 'csv_sftp', base_url: `sftp://sftp.ejemplo.com:${puerto}/entrega/posiciones.csv`, geocercas_url: `sftp://sftp.ejemplo.com:${puerto}/entrega/geocercas.csv`,
      nombre_campo: 'likida', token: 'clave-de-prueba', huella_host: HUELLA,
    }, { http: async () => { throw new Error('el modo SFTP no debe usar http'); }, sftp: cliente() });
    if (!c.ok) throw new Error(c.motivo);
    const p = await c.lector.leerPosiciones();
    expect(p.filas).toHaveLength(1);
    expect(p.filas[0]).toMatchObject({ unidad: 'IN-001', lat: 25.56, lon: -100.94 });
    const g = await c.lector.leerGeocercas();
    expect(g.filas.map((x) => x.codigo)).toEqual(['P1']);
  });
});
