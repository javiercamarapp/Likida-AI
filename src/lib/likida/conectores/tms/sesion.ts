// ═══════════════════════════════════════════════════════════════════════════
// SESIÓN HTTP del conector TMS: usuario + contraseña → token → peticiones.
//
// Requisito del cliente: «la API trabaja con usuario y contraseña, se genera un token y ese
// token se adjunta a las peticiones». La forma exacta del login (ruta, campos, vigencia, qué
// contesta con el token vencido) NO está documentada todavía (BLOQUEO EXTERNO): por eso todo
// se parametriza en `login` y se prueba con el servidor falso.
//
// Reglas que esta clase hace cumplir:
//  · El token vive SOLO en memoria de esta instancia (campo privado `#`): no se serializa, no se
//    registra y no se guarda en `conector_credencial`.
//  · Ante 401: UN solo re-login (single-flight entre peticiones concurrentes) y UN reintento.
//    Si el segundo intento también da 401 → falla 'credencial' y no se sigue (no bloquear la cuenta).
//  · 429/5xx: política común de `llamar` (backoff, Retry-After, sin dormir más allá de `venceEn`).
//  · Los errores se resumen con frase propia; jamás se copia el cuerpo del proveedor ni se deja
//    pasar el token/contraseña en un mensaje de excepción.
//  · Transporte por defecto: `httpsPublico` (rechaza hosts privados y no sigue redirects).
// ═══════════════════════════════════════════════════════════════════════════
import { httpsPublico } from '@/lib/http/https_publico';
import type { Http, PeticionHttp, RespuestaHttp } from '../tipos';
import {
  jsonObjeto, llamar, relojDe,
  type FallaLectura, type OpcionesLecturaPaginada, type Reloj,
} from '../posiciones_comun';

const TIMEOUT_SESION_MS = 15_000;

export interface ConfigLoginTms {
  /** Ruta del login, p. ej. `/api/login`. */
  ruta: string;
  /** Cuerpo JSON del login; los valores `{usuario}` y `{clave}` se sustituyen por la credencial. */
  cuerpo: Record<string, string>;
  /** Dónde viene el token en la respuesta JSON; admite ruta con puntos (`data.token`). */
  campo_token: string;
  /** Encabezado en que se manda el token (por omisión `Authorization`). */
  encabezado?: string;
  /** Prefijo del valor; por omisión `Bearer ` si el encabezado es Authorization, vacío en otro caso. */
  prefijo?: string;
}

export interface CredencialTms { usuario: string; clave: string }

export interface OpcionesSesionTms {
  /** Transporte; por omisión `httpsPublico`. Los tests inyectan el servidor falso. */
  http?: Http;
  /** URL base del TMS (https), sin barra final obligatoria. */
  base: string;
  login: ConfigLoginTms;
  credenciales: CredencialTms;
  /** Reloj inyectable (`ahora`, `dormir`, `venceEn`). */
  reloj?: OpcionesLecturaPaginada;
  /** Para APIs que con token vencido NO contestan 401 sino 200 con error/HTML: dice si la respuesta es de sesión caída. */
  detectaVencido?: (r: RespuestaHttp) => boolean;
}

export interface PeticionSesion {
  ruta: string;
  metodo?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  /** Objeto a serializar como JSON. */
  cuerpo?: unknown;
}

export type ResultadoSesion =
  | { ok: true; r: RespuestaHttp }
  /** `falla` ausente = se agotó el presupuesto de la corrida (no es culpa del TMS). */
  | { ok: false; motivo: string; falla?: FallaLectura; backlog?: boolean };

type ResultadoLogin = { ok: true; token: string } | { ok: false; motivo: string; falla?: FallaLectura; backlog?: boolean };

export class SesionTms {
  readonly #http: Http;
  readonly #base: string;
  readonly #login: ConfigLoginTms;
  readonly #cred: CredencialTms;
  readonly #reloj: Reloj;
  readonly #detectaVencido?: (r: RespuestaHttp) => boolean;
  #token: string | undefined;
  #loginEnCurso: Promise<ResultadoLogin> | undefined;

  constructor(o: OpcionesSesionTms) {
    this.#http = o.http ?? ((p) => httpsPublico(p, TIMEOUT_SESION_MS));
    this.#base = o.base.replace(/\/+$/, '');
    this.#login = o.login;
    this.#cred = o.credenciales;
    this.#reloj = relojDe(o.reloj ?? {});
    this.#detectaVencido = o.detectaVencido;
  }

  /** Nunca expone el token ni la clave si alguien serializa o imprime la sesión. */
  toJSON(): Record<string, never> { return {}; }

  async peticion(p: PeticionSesion): Promise<ResultadoSesion> {
    const { res: primera, tokenUsado } = await this.#intento(p);
    if (!primera.ok || !this.#esSesionCaida(primera.r)) return primera;
    // Sesión caída: UN re-login (compartido) y UN reintento.
    this.#invalidar(tokenUsado);
    const { res: segunda } = await this.#intento(p);
    if (!segunda.ok) return segunda;
    if (this.#esSesionCaida(segunda.r)) {
      return { ok: false, motivo: 'El sistema rechazó la sesión recién renovada; hay que revisar usuario y contraseña. No se reintenta.', falla: 'credencial' };
    }
    return segunda;
  }

  #esSesionCaida(r: RespuestaHttp): boolean {
    return r.estado === 401 || (this.#detectaVencido?.(r) ?? false);
  }

  /** Solo borra el token si sigue siendo el que falló: si otra petición ya lo renovó, se aprovecha el nuevo. */
  #invalidar(tokenUsado: string): void {
    if (this.#token === tokenUsado) this.#token = undefined;
  }

  async #intento(p: PeticionSesion): Promise<{ res: ResultadoSesion; tokenUsado: string }> {
    const sesion = await this.#asegurarToken();
    if (!sesion.ok) return { res: this.#limpiarResultado(sesion), tokenUsado: '' };
    const token = sesion.token;
    const pet: PeticionHttp = {
      url: this.#url(p.ruta, p.query),
      metodo: p.metodo ?? 'GET',
      encabezados: { [this.#nombreEncabezado()]: this.#prefijo() + token, accept: 'application/json' },
    };
    if (p.cuerpo !== undefined) {
      pet.cuerpo = JSON.stringify(p.cuerpo);
      pet.encabezados = { ...pet.encabezados, 'content-type': 'application/json' };
    }
    const ll = await llamar(this.#http, pet, 'el sistema de transporte', this.#reloj);
    if (!ll.ok) return { res: this.#limpiarResultado(ll, token), tokenUsado: token };
    return { res: { ok: true, r: ll.r }, tokenUsado: token };
  }

  #asegurarToken(): Promise<ResultadoLogin> {
    if (this.#token !== undefined) return Promise.resolve({ ok: true, token: this.#token });
    if (!this.#loginEnCurso) {
      this.#loginEnCurso = this.#hacerLogin().finally(() => { this.#loginEnCurso = undefined; });
    }
    return this.#loginEnCurso;
  }

  async #hacerLogin(): Promise<ResultadoLogin> {
    const cuerpo: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.#login.cuerpo)) {
      cuerpo[k] = v.split('{usuario}').join(this.#cred.usuario).split('{clave}').join(this.#cred.clave);
    }
    const ll = await llamar(this.#http, {
      url: this.#url(this.#login.ruta),
      metodo: 'POST',
      encabezados: { 'content-type': 'application/json', accept: 'application/json' },
      cuerpo: JSON.stringify(cuerpo),
    }, 'el inicio de sesión del sistema de transporte', this.#reloj);
    if (!ll.ok) return this.#limpiarResultado(ll);
    const { estado } = ll.r;
    if (estado === 401 || estado === 403) {
      return { ok: false, motivo: 'El sistema rechazó el usuario o la contraseña.', falla: 'credencial' };
    }
    if (estado < 200 || estado >= 300) {
      return { ok: false, motivo: `El inicio de sesión contestó ${estado}, que no es lo esperado.`, falla: 'formato' };
    }
    const token = extraer(jsonObjeto(ll.r.cuerpo), this.#login.campo_token);
    if (typeof token !== 'string' || token === '') {
      return { ok: false, motivo: 'El inicio de sesión contestó, pero sin el token en el campo esperado.', falla: 'formato' };
    }
    this.#token = token;
    return { ok: true, token };
  }

  #nombreEncabezado(): string { return this.#login.encabezado ?? 'Authorization'; }
  #prefijo(): string {
    return this.#login.prefijo ?? (this.#nombreEncabezado().toLowerCase() === 'authorization' ? 'Bearer ' : '');
  }

  #url(ruta: string, query?: Record<string, string | number | undefined>): string {
    const lim = ruta.startsWith('/') ? ruta : `/${ruta}`;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v));
    const s = qs.toString();
    return `${this.#base}${lim}${s ? `?${s}` : ''}`;
  }

  /** Quita del texto de un error cualquier cosa que sea secreto (token, clave, usuario). */
  #limpiarResultado<T extends { motivo: string }>(r: T, tokenUsado?: string): T {
    return { ...r, motivo: this.#limpiar(r.motivo, tokenUsado) };
  }
  #limpiar(texto: string, tokenUsado?: string): string {
    let t = texto;
    for (const s of [tokenUsado, this.#token, this.#cred.clave, this.#cred.usuario]) {
      if (s) t = t.split(s).join('[oculto]');
    }
    return t;
  }
}

function extraer(obj: Record<string, unknown> | null, ruta: string): unknown {
  let v: unknown = obj;
  for (const parte of ruta.split('.')) {
    if (typeof v !== 'object' || v === null) return undefined;
    v = (v as Record<string, unknown>)[parte];
  }
  return v;
}
