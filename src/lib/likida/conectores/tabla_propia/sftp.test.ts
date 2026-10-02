import { describe, expect, it } from 'vitest';
import type { Http } from '../tipos';
import { leerConfigTablaPropia } from './config';
import { ErrorTablaPropia } from './contrato';
import { crearLectorTablaPropia, leerPosicionesTablaPropia } from './lector';
import { probarTablaPropia } from './conector';
import { clasificarErrorSsh, leerHuellas, normalizarLlave, partirUrlSftp, type ClienteSftp, type DestinoSftp } from './sftp';

// ═══════════════════════════════════════════════════════════════════════════
// El modo SFTP con un DOBLE del cliente (inyectado por `deps.sftp`, igual que el
// ejecutor SQL): configuración, clasificación de fallas y que ningún secreto
// salga en mensajes. El cliente real se prueba contra un servidor ssh2 en
// localhost en `sftp.integracion.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = Date.parse('2026-10-20T13:30:00.000Z');
const reloj = { ahora: () => AHORA, dormir: async () => undefined };
const HUELLA = 'SHA256:' + 'A'.repeat(43);
const SECRETO = 'clave-super-secreta-77';
const FRASE = 'frase-secreta-88';
const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nQUJDREVGR0hJSktMTU5PUFFSU1RVVldY\nQUJDREVGR0hJSktMTU5PUFFSU1RVVldY\n-----END OPENSSH PRIVATE KEY-----\n';
const CSV = 'id_unidad,latitud,longitud,fecha_hora\nUN-1,25.5,-100.5,2026-10-20 07:20:00\nUN-2,25.6,-100.6,2026-10-20 07:25:00\nUN-3,25.6,-100.6,2026-10-19 01:00:00\n';

const BASE = { modo: 'csv_sftp', base_url: 'sftp://s.ejemplo.com/entrega/posiciones.csv', nombre_campo: 'likida', token: SECRETO, huella_host: HUELLA };
const sinHttp: Http = async () => { throw new Error('el modo SFTP no debe usar http'); };

function doble(r: string | Error) {
  const llamadas: Array<{ destino: DestinoSftp; maxBytes: number }> = [];
  const sftp: ClienteSftp = { leerArchivo: async (destino, o) => { llamadas.push({ destino, maxBytes: o.maxBytes }); if (r instanceof Error) throw r; return r; } };
  return { sftp, llamadas };
}

describe('configuración sftp://', () => {
  it('feliz con contraseña: host, puerto por omisión 22, usuario y huella', () => {
    const c = leerConfigTablaPropia(BASE);
    expect(c).toMatchObject({ ok: true, config: { modo: 'csv_sftp', sftp: { host: 's.ejemplo.com', puerto: 22, usuario: 'likida', clave: SECRETO, huellas: [HUELLA] } } });
  });
  it('feliz con llave privada (sin contraseña) y puerto propio; geocercas en el mismo servidor', () => {
    const c = leerConfigTablaPropia({ ...BASE, token: '', llave_privada: PEM, frase_llave: FRASE, base_url: 'sftp://s.ejemplo.com:2222/p.csv', geocercas_url: 'sftp://S.ejemplo.com:2222/g.csv' });
    expect(c).toMatchObject({ ok: true, config: { sftp: { puerto: 2222, clave: undefined, frase: FRASE }, urlGeocercas: 'sftp://S.ejemplo.com:2222/g.csv' } });
  });
  it('SIN huella del host no se guarda (falla cerrada), y solo se acepta SHA256 bien formada', () => {
    const { huella_host: _h, ...sin } = BASE;
    expect(leerConfigTablaPropia(sin)).toMatchObject({ ok: false, motivo: expect.stringContaining('huella') });
    for (const mala of ['', 'MD5:aa:bb', 'SHA256:corta', HUELLA.replace('SHA256:', ''), 'SHA256:' + 'A'.repeat(44)]) {
      expect(leerConfigTablaPropia({ ...BASE, huella_host: mala }), mala).toMatchObject({ ok: false });
    }
    expect(leerConfigTablaPropia({ ...BASE, huella_host: `${HUELLA}=, SHA256:${'B'.repeat(43)}` })).toMatchObject({ ok: true, config: { sftp: { huellas: [HUELLA, 'SHA256:' + 'B'.repeat(43)] } } });
  });
  it('exige usuario y (contraseña o llave); la frase solo con llave', () => {
    expect(leerConfigTablaPropia({ ...BASE, nombre_campo: '' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...BASE, token: '' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...BASE, frase_llave: FRASE })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...BASE, llave_privada: 'esto no es una llave' })).toMatchObject({ ok: false });
  });
  it('la dirección no lleva usuario/clave ni parámetros; el servidor y el archivo son válidos', () => {
    for (const u of ['sftp://u:p@s.ejemplo.com/p.csv', 'sftp://s.ejemplo.com/', 'sftp://s.ejemplo.com/dir/', 'sftp://s.ejemplo.com/p.csv?x=1', 'sftp://s.ejemplo.com:99999/p.csv', 'sftp://s.ejemplo.com']) {
      expect(leerConfigTablaPropia({ ...BASE, base_url: u }), u).toMatchObject({ ok: false });
    }
  });
  it('no se mezclan https y sftp, ni dos servidores: la credencial SFTP no viaja a un sitio https', () => {
    expect(leerConfigTablaPropia({ ...BASE, geocercas_url: 'https://d.ejemplo.com/g.csv' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...BASE, base_url: 'https://d.ejemplo.com/p.csv', geocercas_url: 'sftp://s.ejemplo.com/g.csv' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...BASE, geocercas_url: 'sftp://otro.ejemplo.com/g.csv' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...BASE, geocercas_url: 'sftp://s.ejemplo.com:2222/g.csv' })).toMatchObject({ ok: false });
  });
  it('otros modos NO aceptan sftp://', () => {
    expect(leerConfigTablaPropia({ modo: 'endpoint', base_url: 'sftp://s.ejemplo.com/p', mapeo_posiciones: '{}' })).toMatchObject({ ok: false });
  });
  it('helpers: llave de una sola línea se reconstruye; la URL se parte; las huellas se leen', () => {
    const una = PEM.replace(/\n/g, ' ');
    const n = normalizarLlave(una);
    expect(n).toMatchObject({ ok: expect.stringMatching(/^-----BEGIN OPENSSH PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+\n-----END OPENSSH PRIVATE KEY-----\n$/) });
    expect(normalizarLlave(PEM.replace(/\n/g, '\\n'))).toMatchObject({ ok: expect.stringContaining('\n') });
    expect(normalizarLlave('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----')).toMatchObject({ error: expect.any(String) });
    expect(partirUrlSftp('sftp://h.ejemplo.com:2200/a%20b/c.csv')).toEqual({ ok: { host: 'h.ejemplo.com', puerto: 2200, ruta: '/a b/c.csv' } });
    expect(leerHuellas(undefined)).toMatchObject({ error: expect.any(String) });
  });
});

describe('lectura por SFTP con un doble del cliente', () => {
  it('feliz: lee por el cliente SFTP (jamás por http), con la ruta, el tope y la huella; aplica la ventana', async () => {
    const d = doble(CSV);
    const r = await leerPosicionesTablaPropia(BASE, sinHttp, { ...reloj, sftp: d.sftp });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.posiciones.map((p) => p.deviceId)).toEqual(['UN-1', 'UN-2']); // UN-3 es de ayer: fuera de la ventana
    expect(d.llamadas).toHaveLength(1);
    expect(d.llamadas[0]).toMatchObject({ maxBytes: 25_000_000, destino: { host: 's.ejemplo.com', puerto: 22, usuario: 'likida', clave: SECRETO, ruta: '/entrega/posiciones.csv', huellas: [HUELLA] } });
  });
  it('geocercas por el mismo servidor, con SU ruta', async () => {
    const d = doble('codigo,nombre,lat_centro,lon_centro,radio_m\nP1,Patio,25.5,-100.9,300\n');
    const c = crearLectorTablaPropia({ ...BASE, geocercas_url: 'sftp://s.ejemplo.com/entrega/geocercas.csv' }, { http: sinHttp, sftp: d.sftp });
    if (!c.ok) throw new Error(c.motivo);
    expect((await c.lector.leerGeocercas()).filas.map((g) => g.codigo)).toEqual(['P1']);
    expect(d.llamadas[0].destino.ruta).toBe('/entrega/geocercas.csv');
  });
  it('cursos por el mismo servidor, con SU ruta (integración P8 + P15); otro servidor o https se rechazan', async () => {
    const d = doble('codigo,nombre,unidad,convenio,casetas\nCUR-1,Ruta,UN-1,,Caseta Ejemplo Sur\n');
    const c = crearLectorTablaPropia({ ...BASE, cursos_url: 'sftp://s.ejemplo.com/entrega/cursos.csv' }, { http: sinHttp, sftp: d.sftp });
    if (!c.ok) throw new Error(c.motivo);
    expect((await c.lector.leerCursos!()).filas.map((x) => x.codigo)).toEqual(['CUR-1']);
    expect(d.llamadas[0].destino.ruta).toBe('/entrega/cursos.csv');
    expect(leerConfigTablaPropia({ ...BASE, cursos_url: 'sftp://otro.ejemplo.com/c.csv' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...BASE, cursos_url: 'https://d.ejemplo.com/c.csv' })).toMatchObject({ ok: false });
  });
  it('sin archivo de geocercas configurado: formato, sin conectar', async () => {
    const d = doble(CSV);
    const c = crearLectorTablaPropia(BASE, { http: sinHttp, sftp: d.sftp });
    if (!c.ok) throw new Error();
    await expect(c.lector.leerGeocercas()).rejects.toMatchObject({ falla: 'formato' });
    expect(d.llamadas).toHaveLength(0);
  });
  it('auth inválida → credencial; red/timeout → proveedor; ausente/enorme → formato (la clase viaja al backoff)', async () => {
    const casos: Array<[ErrorTablaPropia, string]> = [
      [new ErrorTablaPropia('El servidor SFTP rechazó el usuario o la credencial (contraseña o llave).', 'credencial'), 'credencial'],
      [new ErrorTablaPropia('La huella del servidor SFTP no coincide con la configurada.', 'credencial'), 'credencial'],
      [new ErrorTablaPropia('El servidor SFTP no contestó a tiempo.', 'proveedor'), 'proveedor'],
      [new ErrorTablaPropia('No se pudo conectar con el servidor SFTP.', 'proveedor'), 'proveedor'],
      [new ErrorTablaPropia('El archivo no existe en el servidor SFTP (revisa la ruta de la dirección).', 'formato'), 'formato'],
      [new ErrorTablaPropia('El archivo en el servidor SFTP pesa más de 25 MB; acótalo o divídelo.', 'formato'), 'formato'],
    ];
    for (const [e, clase] of casos) {
      const r = await leerPosicionesTablaPropia(BASE, sinHttp, { ...reloj, sftp: doble(e).sftp });
      expect(r, e.message).toMatchObject({ ok: false, falla: clase, motivo: e.message });
    }
  });
  it('un error raro del cliente (no clasificado) sale como proveedor y NO filtra su texto (puede traer secretos)', async () => {
    const r = await leerPosicionesTablaPropia(BASE, sinHttp, { ...reloj, sftp: doble(new Error(`boom con ${SECRETO} y ${FRASE}`)).sftp });
    expect(r).toMatchObject({ ok: false, falla: 'proveedor' });
    expect(JSON.stringify(r)).not.toContain(SECRETO);
    expect(JSON.stringify(r)).not.toContain(FRASE);
  });
  it('CSV mal formado → formato con los encabezados leídos; vacío → formato', async () => {
    const r = await leerPosicionesTablaPropia(BASE, sinHttp, { ...reloj, sftp: doble('a,b,c\n1,2,3\n').sftp });
    expect(r).toMatchObject({ ok: false, falla: 'formato' });
    expect(r.ok ? '' : r.motivo).toContain('Encabezados leídos');
    expect(await leerPosicionesTablaPropia(BASE, sinHttp, { ...reloj, sftp: doble('').sftp })).toMatchObject({ ok: false, falla: 'formato' });
  });
  it('filas sucias cuentan como inválidas (poll parcial), igual que por https', async () => {
    const r = await leerPosicionesTablaPropia(BASE, sinHttp, { ...reloj, sftp: doble('id_unidad,latitud,longitud,fecha_hora\nUN-1,25.5,-100.5,2026-10-20 07:20:00\nUN-2,1,2,2026-10-20 07:21:00\n').sftp });
    expect(r).toMatchObject({ ok: true, invalidas: 1 });
  });
  it('configuración inválida: falla de formato sin intentar conectar y sin eco de secretos', async () => {
    const d = doble(CSV);
    const r = await leerPosicionesTablaPropia({ ...BASE, huella_host: '' }, sinHttp, { ...reloj, sftp: d.sftp });
    expect(r).toMatchObject({ ok: false, falla: 'formato' });
    expect(d.llamadas).toHaveLength(0);
    expect(JSON.stringify(r)).not.toContain(SECRETO);
  });
});

describe('probar la conexión (panel)', () => {
  it('feliz: dice cuántas filas entendió y contra qué se verificó, sin usuario ni clave', async () => {
    const p = await probarTablaPropia({ ...BASE, ventana_minutos: '1440' }, sinHttp, undefined, doble(CSV).sftp);
    expect(p.ok).toBe(true);
    expect(p.verificadoContra).toBe('sftp://s.ejemplo.com/entrega/posiciones.csv');
    expect(JSON.stringify(p)).not.toContain(SECRETO);
    expect(JSON.stringify(p)).not.toContain('likida');
  });
  it('credencial rechazada → no_sirve; red caída → no_se_sabe', async () => {
    expect(await probarTablaPropia(BASE, sinHttp, undefined, doble(new ErrorTablaPropia('x', 'credencial')).sftp)).toMatchObject({ ok: false, sobreLaCredencial: 'no_sirve' });
    expect(await probarTablaPropia(BASE, sinHttp, undefined, doble(new ErrorTablaPropia('x', 'proveedor')).sftp)).toMatchObject({ ok: false, sobreLaCredencial: 'no_se_sabe' });
  });
});

describe('clasificación de errores de ssh2 (frases fijas, nunca el mensaje crudo)', () => {
  const crudo = (o: Record<string, unknown>) => Object.assign(new Error(`crudo con ${SECRETO} /ruta/privada`), o);
  it('cada nivel cae en su clase y el texto crudo no sale', () => {
    const casos: Array<[unknown, string]> = [
      [crudo({ level: 'client-authentication' }), 'credencial'],
      [crudo({ level: 'client-timeout' }), 'proveedor'],
      [crudo({ level: 'client-socket', code: 'ECONNREFUSED' }), 'proveedor'],
      [crudo({ code: 'ENOTFOUND' }), 'proveedor'],
      [crudo({ level: 'handshake' }), 'proveedor'],
      [crudo({}), 'proveedor'],
    ];
    for (const [e, clase] of casos) {
      const r = clasificarErrorSsh(e, null, false);
      expect(r.falla).toBe(clase);
      expect(r.message).not.toContain(SECRETO);
      expect(r.message).not.toContain('/ruta/privada');
    }
    expect(clasificarErrorSsh(crudo({}), HUELLA, true)).toMatchObject({ falla: 'credencial', message: expect.stringContaining(HUELLA) });
  });
});
