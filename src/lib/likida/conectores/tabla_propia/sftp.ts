import dns from 'node:dns';
import { isIP } from 'node:net';
import { esIpPublica } from '@/lib/http/destino_publico';
import { ErrorTablaPropia } from './contrato';

// ═══════════════════════════════════════════════════════════════════════════
// EL CLIENTE SFTP del modo csv_sftp: lee UN archivo (el CSV de posiciones o el
// de geocercas) del servidor SFTP de la flota. Solo lectura de un archivo: no
// lista, no escribe, no borra, no renombra.
//
// DECISIONES (todas aquí, en un solo lugar):
//  · HUELLA DEL HOST OBLIGATORIA. Sin `huella_host` la configuración ni se
//    guarda (config.ts). No hay «confiar en el primer contacto»: un SFTP sin
//    verificar el host entrega usuario y clave a quien se interponga. La huella
//    es la que muestra `ssh-keygen -lf` / WinSCP («SHA256:…»); se admiten varias
//    para rotar la llave del servidor sin cortar la lectura.
//  · DESTINO PÚBLICO. El host se resuelve y se descarta si cualquier dirección
//    es interna (igual que el SQL): el servidor no es un puente a la red del
//    despliegue. Se conecta a la IP ya validada (sin segunda resolución).
//  · TIEMPO Y TAMAÑO ACOTADOS. Un plazo total para conectar + leer, y un tope de
//    bytes que se verifica ANTES (stat) y MIENTRAS se lee (el stat puede mentir).
//  · NUNCA SE FILTRA UN SECRETO. Los mensajes son frases fijas por clase de falla:
//    jamás se copia el `message` de ssh2 (puede traer rutas o usuario), ni la
//    clave, ni la llave, ni la frase. La huella que presentó el servidor SÍ se
//    dice (es pública) para que el operador pueda copiarla al configurar.
//  · CLASES DE FALLA como los demás lectores: credencial (usuario/clave/llave,
//    permiso del archivo, huella distinta: requieren que alguien corrija algo),
//    proveedor (red, DNS, tiempo: transitorio, con backoff), formato (archivo
//    ausente o demasiado grande: hay que corregir la ruta o acotar el archivo).
// ═══════════════════════════════════════════════════════════════════════════

export const TIMEOUT_SFTP_MS = 25_000;
export const CONEXION_SFTP_MS = 10_000;

export interface DestinoSftp {
  host: string;
  puerto: number;
  usuario: string;
  clave?: string;
  /** Llave privada en PEM/OpenSSH, ya normalizada (con saltos de línea). */
  llave?: string;
  frase?: string;
  /** Huellas aceptadas, «SHA256:<base64 sin relleno>». */
  huellas: readonly string[];
  /** Ruta absoluta del archivo en el servidor. */
  ruta: string;
}

export interface OpcionesSftp { timeoutMs?: number; maxBytes: number }

/** El punto de inyección: las pruebas unitarias ponen un doble aquí; producción usa `crearClienteSftp()`. */
export interface ClienteSftp {
  leerArchivo(destino: DestinoSftp, opciones: OpcionesSftp): Promise<string>;
}

// ── helpers puros ───────────────────────────────────────────────────────────
export const HUELLA_SHA256 = /^SHA256:[A-Za-z0-9+/]{43}$/;

/** Lista de huellas separadas por coma, espacio o salto de línea. Devuelve las válidas o el error. */
export function leerHuellas(texto: string | undefined): { ok: string[] } | { error: string } {
  const partes = (texto ?? '').split(/[\s,;]+/).map((p) => p.trim().replace(/=+$/, '')).filter((p) => p !== '');
  if (partes.length === 0) return { error: 'falta la huella del servidor SFTP (huella_host): sin ella no se verifica con quién nos conectamos' };
  if (partes.length > 5) return { error: 'huella_host admite hasta 5 huellas' };
  for (const p of partes) {
    if (!HUELLA_SHA256.test(p)) return { error: 'huella_host debe tener la forma SHA256:… (la que muestra «ssh-keygen -lf» o WinSCP; no se admite MD5)' };
  }
  return { ok: [...new Set(partes)] };
}

/** Hex (lo que entrega ssh2 con `hostHash`) → «SHA256:<base64 sin relleno>», el formato de OpenSSH. */
export function huellaDeHex(hex: string): string {
  let binario = '';
  for (let i = 0; i + 1 < hex.length; i += 2) binario += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return `SHA256:${btoa(binario).replace(/=+$/, '')}`;
}

/**
 * Una llave pegada en un campo de una sola línea llega sin saltos (o con «\n» literales). Se reconstruye el PEM:
 * encabezado, cuerpo en base64 a 64 columnas y pie. No valida la llave: eso lo hace ssh2 al conectar.
 */
export function normalizarLlave(texto: string): { ok: string } | { error: string } {
  const t = texto.trim().replace(/\\n/g, '\n').replace(/\r/g, '');
  const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(t);
  if (!m || !/PRIVATE KEY/.test(m[1])) return { error: 'llave_privada debe ser una llave privada en formato PEM u OpenSSH («-----BEGIN … PRIVATE KEY-----»)' };
  const cuerpo = m[2].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cuerpo) || cuerpo.length > 12_000) return { error: 'llave_privada no tiene un cuerpo válido' };
  const lineas = cuerpo.match(/.{1,64}/g) ?? [];
  return { ok: `-----BEGIN ${m[1]}-----\n${lineas.join('\n')}\n-----END ${m[1]}-----\n` };
}

/** `sftp://host[:puerto]/ruta/archivo.csv` → destino sin credenciales. Sin usuario ni clave dentro de la dirección. */
export function partirUrlSftp(url: string): { ok: { host: string; puerto: number; ruta: string } } | { error: string } {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return { error: 'no es una dirección sftp:// válida' }; }
  if (u.protocol !== 'sftp:') return { error: 'no es una dirección sftp://' };
  if (u.username || u.password) return { error: 'no debe llevar usuario ni contraseña dentro de la dirección (van en campos aparte, cifrados)' };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!/^[A-Za-z0-9.:_-]{1,253}$/.test(host)) return { error: 'el servidor tiene caracteres no permitidos' };
  const puerto = u.port === '' ? 22 : Number(u.port);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65_535) return { error: 'el puerto no es válido' };
  let ruta: string;
  try { ruta = decodeURIComponent(u.pathname); } catch { return { error: 'la ruta del archivo no es válida' }; }
  if (ruta === '' || ruta === '/' || ruta.endsWith('/') || /[\u0000-\u001f]/.test(ruta) || ruta.length > 1_024) return { error: 'falta la ruta de un archivo (termina en el nombre del CSV)' };
  if (u.search !== '' || u.hash !== '') return { error: 'la dirección sftp:// no admite parámetros ni fragmento' };
  return { ok: { host, puerto, ruta } };
}

// ── resolución de destino público ───────────────────────────────────────────
export async function resolverHostSftp(host: string, resolver: typeof dns.promises.lookup = dns.promises.lookup): Promise<string> {
  if (isIP(host)) {
    if (!esIpPublica(host)) throw new ErrorTablaPropia('El servidor SFTP debe tener una dirección pública (no se admiten direcciones internas).', 'formato');
    return host;
  }
  let direcciones: Array<{ address: string }>;
  try {
    direcciones = (await resolver(host, { all: true, verbatim: true })) as unknown as Array<{ address: string }>;
  } catch {
    throw new ErrorTablaPropia('No se pudo resolver el servidor SFTP.', 'proveedor');
  }
  if (direcciones.length === 0 || !direcciones.every((d) => esIpPublica(d.address))) {
    throw new ErrorTablaPropia('El servidor SFTP resuelve a una dirección interna: no se admite.', 'formato');
  }
  return direcciones[0].address;
}

// ── el cliente real (ssh2) ──────────────────────────────────────────────────
// Códigos de estado SFTP (draft-ietf-secsh-filexfer): 2 = NO_SUCH_FILE, 3 = PERMISSION_DENIED.
const NO_EXISTE = 2;
const SIN_PERMISO = 3;

const CODIGOS_RED = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'];

interface ErrorSsh2 { level?: string; code?: unknown }
const nivelDe = (e: unknown): string => (typeof e === 'object' && e !== null && typeof (e as ErrorSsh2).level === 'string' ? String((e as ErrorSsh2).level) : '');
const codigoDe = (e: unknown): unknown => (typeof e === 'object' && e !== null ? (e as ErrorSsh2).code : undefined);

/** Clasifica un error de la conexión. Frases fijas: jamás el `message` de ssh2. */
export function clasificarErrorSsh(e: unknown, huellaPresentada: string | null, huellaRechazada: boolean): ErrorTablaPropia {
  if (e instanceof ErrorTablaPropia) return e;
  if (huellaRechazada) {
    return new ErrorTablaPropia(`La huella del servidor SFTP no coincide con la configurada (el servidor presentó ${huellaPresentada ?? 'otra'}). Si la llave del servidor cambió a propósito, actualiza huella_host; si no, no se lee: puede haber alguien interpuesto.`, 'credencial');
  }
  const nivel = nivelDe(e); const codigo = codigoDe(e);
  if (nivel === 'client-authentication') return new ErrorTablaPropia('El servidor SFTP rechazó el usuario o la credencial (contraseña o llave).', 'credencial');
  if (nivel === 'client-timeout') return new ErrorTablaPropia('El servidor SFTP no contestó a tiempo.', 'proveedor');
  if (typeof codigo === 'string' && CODIGOS_RED.includes(codigo)) return new ErrorTablaPropia('No se pudo conectar con el servidor SFTP.', 'proveedor');
  if (nivel === 'client-socket') return new ErrorTablaPropia('Se perdió la conexión con el servidor SFTP.', 'proveedor');
  return new ErrorTablaPropia('No se pudo negociar la conexión SSH con el servidor SFTP.', 'proveedor');
}

function clasificarErrorSftp(e: unknown): ErrorTablaPropia {
  const codigo = codigoDe(e);
  if (codigo === NO_EXISTE) return new ErrorTablaPropia('El archivo no existe en el servidor SFTP (revisa la ruta de la dirección).', 'formato');
  if (codigo === SIN_PERMISO) return new ErrorTablaPropia('El usuario SFTP no tiene permiso para leer ese archivo.', 'credencial');
  if (typeof codigo === 'string' && CODIGOS_RED.includes(codigo)) return new ErrorTablaPropia('Se perdió la conexión con el servidor SFTP al leer el archivo.', 'proveedor');
  return new ErrorTablaPropia('No se pudo leer el archivo del servidor SFTP.', 'proveedor');
}

interface Ssh2Cliente {
  on(ev: string, f: (...a: any[]) => void): Ssh2Cliente; // eslint-disable-line @typescript-eslint/no-explicit-any -- superficie mínima de ssh2, tipada por uso
  connect(c: Record<string, unknown>): void;
  sftp(cb: (e: Error | undefined, s: Ssh2Sftp) => void): void;
  end(): void;
  destroy(): void;
}
interface Ssh2Sftp {
  stat(ruta: string, cb: (e: unknown, st: { size: number; isFile(): boolean }) => void): void;
  createReadStream(ruta: string, o?: Record<string, unknown>): Ssh2Stream;
}
interface Ssh2Stream { on(ev: string, f: (...a: any[]) => void): Ssh2Stream; destroy(): void } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Ssh2Modulo { Client: new () => Ssh2Cliente }

export interface DepsClienteSftp {
  cargar?: () => Promise<unknown>;
  resolver?: (host: string) => Promise<string>;
}

export function crearClienteSftp(deps: DepsClienteSftp = {}): ClienteSftp {
  return {
    async leerArchivo(d, o) {
      const ip = await (deps.resolver ?? resolverHostSftp)(d.host);
      let Cliente: Ssh2Modulo['Client'];
      try {
        // Import con literal (no por variable) a propósito: así el trazador de Next incluye `ssh2` en la función; va en
        // `serverExternalPackages` (next.config.ts) para que sus binarios opcionales no pasen por el empaquetador.
        const m = (await (deps.cargar ? deps.cargar() : import('ssh2'))) as unknown as { Client?: unknown; default?: { Client?: unknown } };
        const c = m.Client ?? m.default?.Client;
        if (typeof c !== 'function') throw new Error('sin Client');
        Cliente = c as Ssh2Modulo['Client'];
      } catch {
        throw new ErrorTablaPropia('El lector SFTP no está habilitado en este despliegue (falta el cliente SSH); deja el archivo en una dirección https o usa el endpoint.', 'formato');
      }
      const timeoutMs = o.timeoutMs ?? TIMEOUT_SFTP_MS;
      return new Promise<string>((resolver, rechazar) => {
        const cliente = new Cliente();
        let terminado = false;
        let huellaPresentada: string | null = null;
        let huellaRechazada = false;
        const temporizador = setTimeout(() => fin(new ErrorTablaPropia('El servidor SFTP no contestó a tiempo.', 'proveedor')), timeoutMs);
        function fin(r: ErrorTablaPropia | string): void {
          if (terminado) return;
          terminado = true;
          clearTimeout(temporizador);
          try { cliente.destroy(); } catch { /* ya cerrado */ }
          if (typeof r === 'string') resolver(r); else rechazar(r);
        }
        cliente.on('error', (e: unknown) => fin(clasificarErrorSsh(e, huellaPresentada, huellaRechazada)));
        cliente.on('close', () => fin(clasificarErrorSsh({ level: 'client-socket' }, huellaPresentada, huellaRechazada)));
        cliente.on('ready', () => {
          cliente.sftp((errSftp, sftp) => {
            if (errSftp) return fin(new ErrorTablaPropia('El servidor SFTP no ofreció el subsistema de archivos.', 'proveedor'));
            sftp.stat(d.ruta, (errStat, st) => {
              if (errStat) return fin(clasificarErrorSftp(errStat));
              if (!st.isFile()) return fin(new ErrorTablaPropia('La ruta configurada no es un archivo en el servidor SFTP.', 'formato'));
              if (st.size > o.maxBytes) return fin(new ErrorTablaPropia(`El archivo en el servidor SFTP pesa más de ${Math.round(o.maxBytes / 1_000_000)} MB; acótalo o divídelo.`, 'formato'));
              const trozos: Uint8Array[] = []; let total = 0;
              const flujo = sftp.createReadStream(d.ruta);
              flujo.on('data', (t: Uint8Array) => {
                total += t.length;
                if (total > o.maxBytes) { flujo.destroy(); return fin(new ErrorTablaPropia(`El archivo en el servidor SFTP pesa más de ${Math.round(o.maxBytes / 1_000_000)} MB; acótalo o divídelo.`, 'formato')); }
                trozos.push(t);
              });
              flujo.on('error', (e: unknown) => fin(clasificarErrorSftp(e)));
              flujo.on('end', () => {
                const todo = new Uint8Array(total); let a = 0;
                for (const t of trozos) { todo.set(t, a); a += t.length; }
                fin(new TextDecoder('utf-8').decode(todo));
              });
            });
          });
        });
        try {
          cliente.connect({
            host: ip, port: d.puerto, username: d.usuario,
            ...(d.clave !== undefined ? { password: d.clave } : {}),
            ...(d.llave !== undefined ? { privateKey: d.llave } : {}),
            ...(d.frase !== undefined ? { passphrase: d.frase } : {}),
            readyTimeout: Math.min(timeoutMs, CONEXION_SFTP_MS),
            hostHash: 'sha256',
            hostVerifier: (hex: string) => {
              huellaPresentada = huellaDeHex(hex);
              const ok = d.huellas.includes(huellaPresentada);
              if (!ok) huellaRechazada = true;
              return ok;
            },
            tryKeyboard: false, agent: undefined,
          });
        } catch {
          // ssh2 lanza aquí si la llave no se puede leer (formato, frase ausente o incorrecta).
          fin(new ErrorTablaPropia('La llave privada no se pudo leer (formato no reconocido o frase incorrecta).', 'credencial'));
        }
      });
    },
  };
}
