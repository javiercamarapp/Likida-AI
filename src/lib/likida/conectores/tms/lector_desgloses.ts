// ═══════════════════════════════════════════════════════════════════════════
// LECTOR DE DESGLOSES SOBRE EL TMS (hallazgo A35-A1-03): el adaptador que faltaba entre el conector (sesión con usuario,
// contraseña y token) y el puerto `LectorDesglosesPuerto` del pull. Con él, `lectoresPull` deja de devolver `[]`.
//
// SOLO LEE. Toda forma concreta de la API vive en `liquidacion_externa/desglose_tms_supuesto.ts` (SUPUESTO-API).
// Garantías:
//   · Opt-in por flota: solo entra una flota con «Activar el envío» encendido (`activa=true`), canal `correo` y una
//     credencial TMS activa, probada y sin error. Sin eso no se hace ni un login (el cursor no se consume).
//   · El cursor nunca salta lo que no se pudo leer: un fallo del TMS a mitad LANZA (tipado) y el pull deja el cursor
//     intacto; lo que no se pudo mapear se devuelve en `rechazadas` (excepción visible), no se descarta.
//   · Nada de red real: el transporte es inyectable (`Http`); por omisión `httpsPublico` dentro de `SesionTms`.
//   · Primer arranque sin cursor: no se pide historial; solo la ventana inicial configurada.
// ═══════════════════════════════════════════════════════════════════════════
import { logger } from '@/lib/logger';
import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { claveDeBitacora, type DesgloseBitacora } from '../../liquidacion_externa/desglose_contrato';
import { CONFIG_API_DESGLOSE, type ConfigApiDesglose } from '../../liquidacion_externa/desglose_tms_supuesto';
import { leerRuta, mapearBitacoraTms } from '../../liquidacion_externa/desglose_mapeo_tms';
import {
  TmsCredenciales, TmsLimite, TmsNoDisponible,
  type FilaDesgloseRechazada, type LectorDesglosesPuerto, type ListarDesglosesParams, type PaginaDesgloses,
} from '../../liquidacion_externa/desglose_puerto';
import type { CanalEntrega } from '../../liquidacion_externa/repo_correo';
import { aInstanteMx } from '../../peajes/formatos';
import { jsonObjeto } from '../posiciones_comun';
import type { Http, ValoresCredencial } from '../tipos';
import { SesionTms } from './sesion';
import { loginDe, urlBaseHttps, CONECTOR_TMS } from './sincronizar';

const DIA_MS = 86_400_000;

interface Entrada {
  desde: string; id: string; desglose?: DesgloseBitacora; rechazada?: FilaDesgloseRechazada;
  /** La fila no trae instante de cursor utilizable: su `desde` es la época 0 y NO cuenta para la ventana de relectura. */
  sinInstante?: true;
}

/**
 * A37-A1-liquidaciones-16: el instante del campo de cursor. Con zona (`Z`/`±hh:mm`) se respeta; SIN zona es hora de México (la del
 * origen), nunca la del servidor donde corre esto. Solo fecha ⇒ medianoche de México. Ilegible ⇒ null (la fila se rechaza visible).
 */
export function instanteDeCursor(campo: unknown): string | null {
  if (typeof campo !== 'string') return null;
  const t = campo.trim();
  // eslint-disable-next-line security/detect-unsafe-regex -- patrón anclado de formato fijo, sin cuantificadores anidados ni retroceso exponencial; la entrada es un valor corto de un campo
  const sinZona = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(t);
  if (sinZona) {
    const iso = aInstanteMx(sinZona[1], `${sinZona[2] ?? '00:00'}:${sinZona[3] ?? '00'}`);
    return iso;
  }
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const orden = (a: Entrada, b: Entrada): number => {
  const ta = Date.parse(a.desde); const tb = Date.parse(b.desde);
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

export interface OpcionesLectorTms {
  sesion: SesionTms;
  ahora: () => number;
  config?: ConfigApiDesglose;
}

export function crearLectorDesglosesTms(o: OpcionesLectorTms): LectorDesglosesPuerto {
  const cfg = o.config ?? CONFIG_API_DESGLOSE;

  async function leerVentana(desde: string, hasta: string): Promise<Entrada[]> {
    const crudas: unknown[] = [];
    for (let pagina = 1; pagina <= cfg.maxPaginas; pagina++) {
      const r = await o.sesion.peticion({
        ruta: cfg.ruta,
        query: { [cfg.params.desde]: desde, [cfg.params.hasta]: hasta, [cfg.params.pagina]: pagina, [cfg.params.tam]: cfg.tamano },
      });
      if (!r.ok) {
        if (r.falla === 'credencial') throw new TmsCredenciales();
        if (/429|l[ií]mite/i.test(r.motivo)) throw new TmsLimite();
        throw new TmsNoDisponible();
      }
      const cuerpo = jsonObjeto(r.r.cuerpo);
      const items = cuerpo ? leerRuta(cuerpo, cfg.rutaItems) : undefined;
      if (!Array.isArray(items)) throw new TmsNoDisponible('La respuesta del sistema de transporte no trae la lista esperada');
      crudas.push(...items);
      const total = Number(cuerpo ? leerRuta(cuerpo, cfg.rutaTotalPaginas) : undefined);
      if (!Number.isFinite(total) || pagina >= total || items.length === 0) {
        return crudas.map((c) => aEntrada(c, cfg));
      }
    }
    // Más páginas que el tope: no se declara completa una lectura que no lo es (el cursor no avanza).
    throw new TmsNoDisponible('La lectura excedió el tope de páginas');
  }

  // `cfg.marcar` es null (no hay endpoint): sin `marcarEnviadas`, el pull no marca y su verdad sigue siendo Likida.
  return {
    async listar(p: ListarDesglosesParams): Promise<PaginaDesgloses> {
      if (!Number.isInteger(p.limite) || p.limite < 1) throw new RangeError('limite debe ser un entero >= 1');
      const ahora = o.ahora();
      const desde = p.reLeerDesde ?? p.cursor?.desde ?? new Date(ahora - cfg.ventanaInicialDias * DIA_MS).toISOString();
      const todas = (await leerVentana(desde, new Date(ahora).toISOString())).sort(orden);
      let candidatas = todas;
      if (p.reLeerDesde !== undefined) {
        const t = Date.parse(p.reLeerDesde);
        // A37-A1-liquidaciones-18: la fila sin instante utilizable (época 0) no puede caer fuera de la ventana: se sigue reportando
        // (excepción visible) en cada relectura hasta que el origen la corrija, en vez de desaparecer tras la primera corrida.
        candidatas = todas.filter((e) => e.sinInstante === true || Date.parse(e.desde) >= t);
      } else if (p.cursor) {
        const c: Entrada = { desde: p.cursor.desde, id: p.cursor.despuesDe };
        candidatas = todas.filter((e) => orden(e, c) > 0);
      }
      const pagina = candidatas.slice(0, p.limite);
      const ultima = pagina[pagina.length - 1];
      return {
        items: pagina.flatMap((e) => (e.desglose ? [e.desglose] : [])),
        rechazadas: pagina.flatMap((e) => (e.rechazada ? [e.rechazada] : [])),
        siguiente: ultima ? { desde: ultima.desde, despuesDe: ultima.id } : p.cursor,
        hayMas: candidatas.length > pagina.length,
      };
    },
  };
}

function aEntrada(cruda: unknown, cfg: ConfigApiDesglose): Entrada {
  const campo = leerRuta(cruda, cfg.campoCursor);
  const m = cfg.mapeo;
  const bit = leerRuta(cruda, m.bitacora);
  const term = m.terminal ? leerRuta(cruda, m.terminal) : undefined;
  const clave = typeof bit === 'string' && bit !== '' ? claveDeBitacora(typeof term === 'string' ? term : undefined, bit) : 'BIT-DESCONOCIDA';
  // Sin instante utilizable no hay dónde colocarla en el cursor: se rechaza (visible) en vez de inventar una fecha.
  const desde = instanteDeCursor(campo);
  if (desde === null) return { desde: new Date(0).toISOString(), id: clave, sinInstante: true, rechazada: { clave, campo: cfg.campoCursor } };
  try {
    const { desglose } = mapearBitacoraTms(cruda, m);
    return { desde, id: claveDeBitacora(desglose.terminal, desglose.bitacora), desglose };
  } catch (e) {
    if (!(e instanceof CampoInvalido)) throw e;
    return { desde, id: clave, rechazada: { clave, campo: e.campo } };
  }
}

// ── Qué flotas leen ─────────────────────────────────────────────────────────

export interface CredencialTmsFlota { valores: ValoresCredencial; probadaEn: string | null; ultimoError: string | null }

export interface DependenciasLectoresTms {
  ahora: () => number;
  /** Flotas con «Activar el envío» encendido (`activa=true`) y canal de correo/ambos en su configuración. */
  tenantsConEnvioActivo: () => Promise<string[]>;
  /** Canal REAL de la flota (perfil + config), el mismo que usa el servicio. */
  canalDeEntrega: (tenantId: string) => Promise<CanalEntrega>;
  /** La credencial TMS activa de la flota con su estado de prueba, o `null`. */
  credencial: (tenantId: string) => Promise<CredencialTmsFlota | null>;
  /** Transporte por flota (pruebas: el servidor falso); por omisión `httpsPublico`. */
  http?: (tenantId: string) => Http;
  dormir?: (ms: number) => Promise<void>;
  /** Pruebas: otra forma de API (p. ej. páginas más chicas). Por omisión, `CONFIG_API_DESGLOSE`. */
  config?: ConfigApiDesglose;
}

/** Los lectores de las flotas que cumplen TODO el opt-in. Una flota que falla se salta y se dice; no tumba a las demás. */
export async function lectoresDesglosesTms(deps: DependenciasLectoresTms): Promise<Array<{ tenantId: string; lector: LectorDesglosesPuerto }>> {
  const salida: Array<{ tenantId: string; lector: LectorDesglosesPuerto }> = [];
  for (const tenantId of await deps.tenantsConEnvioActivo()) {
    try {
      if ((await deps.canalDeEntrega(tenantId)) !== 'correo') continue;
      const c = await deps.credencial(tenantId);
      if (!c || c.probadaEn === null || c.ultimoError !== null) continue; // sin credencial probada y sana no se lee
      const base = urlBaseHttps(c.valores.base_url);
      if (base === null) { logger.warn('liqcorreo.tms_base_invalida', { tenantId }); continue; }
      const sesion = new SesionTms({
        ...(deps.http ? { http: deps.http(tenantId) } : {}),
        base,
        login: loginDe(c.valores),
        credenciales: { usuario: (c.valores.usuario ?? '').trim(), clave: c.valores.clave ?? '' },
        reloj: { ahora: deps.ahora, ...(deps.dormir ? { dormir: deps.dormir } : {}) },
      });
      salida.push({ tenantId, lector: crearLectorDesglosesTms({ sesion, ahora: deps.ahora, ...(deps.config ? { config: deps.config } : {}) }) });
    } catch (e) {
      logger.warn('liqcorreo.tms_lector_omitido', { tenantId, tipo: e instanceof Error ? e.name : 'desconocido' });
    }
  }
  return salida;
}

/** Cableado real (lo importa el servicio solo cuando la fase de pull corre). */
export async function lectoresDesglosesTmsPorOmision(): Promise<Array<{ tenantId: string; lector: LectorDesglosesPuerto }>> {
  const [{ flotasConEnvioActivo }, { dependenciasPorOmision }, { leerCredencial, listarCredenciales }] = await Promise.all([
    import('../../liquidacion_externa/trabajo'), import('../../liquidacion_externa/servicio'), import('../credenciales'),
  ]);
  return lectoresDesglosesTms({
    ahora: Date.now,
    tenantsConEnvioActivo: flotasConEnvioActivo,
    canalDeEntrega: dependenciasPorOmision.canalDeEntrega,
    credencial: async (tenantId) => {
      const fila = (await listarCredenciales(tenantId)).find((c) => c.conectorId === CONECTOR_TMS && c.activo);
      if (!fila) return null;
      const valores = await leerCredencial(tenantId, CONECTOR_TMS);
      return valores ? { valores, probadaEn: fila.probadaEn, ultimoError: fila.ultimoError } : null;
    },
  });
}
