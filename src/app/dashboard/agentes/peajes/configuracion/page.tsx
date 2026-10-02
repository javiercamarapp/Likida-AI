import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { sufijoTenant } from '../../../sufijo';
import { avisoAgentePeajesApagado } from '../apagado';
import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { MAX_CATALOGO_BYTES } from '@/lib/likida/peajes/archivo';
import {
  listarTags, listarUnidades, altaTag, bajaTag, importarTagsArchivo,
  listarCasetas, importarCasetasArchivo, cambiarEstadoCaseta,
  listarGeocercas, guardarGeocerca, cambiarEstadoGeocerca, TIPOS_GEOCERCA,
  listarMapeos, guardarMapeo, borrarMapeo,
  leerConfigBuzon, activarBuzon, desactivarBuzon, rotarLlaveBuzon, listarArchivosIngesta,
  leerConfigEntradas, activarCorreoPeajes, desactivarCorreoPeajes, rotarCorreoPeajes, guardarRemitentesPeajes,
  guardarPullPeajes, apagarPullPeajes, borrarCredencialPull,
  type ResultadoImportacionCatalogo,
} from '@/lib/likida/peajes/datos';
import { secretoMaestro, claveDeFlota, reintentarArchivoPeaje } from '@/lib/likida/peajes/ingesta';
import { cofreConfigurado } from '@/lib/likida/conectores/cofre';
import { direccionPj } from '@/lib/likida/peajes/correo_entrante';
import { dominioBuzon } from '@/lib/correo/buzon';
import { VistaConfiguracionPeajes } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/peajes/configuracion';

function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch((e) => {
    logger.error('peajes.configuracion.lectura', { err: e instanceof Error ? e.message : String(e) });
    return null;
  });
}


/** La puerta común de TODA action de esta página (nivel de módulo: una acción no puede capturar ayudantes del componente). */
async function puertaConfig(tenantId: string, area: 'dinero' | 'administracion' = 'dinero'): Promise<string | null> {
  const sesion = await requireSessionTenant(RUTA);
  if (!puedeVerArea(sesion.rol, area)) return 'Tu rol no puede hacer esto.';
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return 'Esta configuración no es de tu flota.';
  return null;
}

function volverConfig(sufijo: string, msg: string): never {
  const param = msg.startsWith('error:') ? `error=${encodeURIComponent(msg.slice(6))}` : `aviso=${encodeURIComponent(msg)}`;
  redirect(`${RUTA}${sufijo}${sufijo ? '&' : '?'}${param}`);
}

async function archivoDeForm(fd: FormData): Promise<{ nombre: string; buffer: Uint8Array } | string> {
  const a = fd.get('archivo');
  if (!(a instanceof File) || a.size === 0) return 'Elige un archivo CSV o Excel.';
  if (a.size > MAX_CATALOGO_BYTES) return 'Ese archivo pesa demasiado para ser un catálogo (máximo 4 MB).';
  return { nombre: a.name, buffer: new Uint8Array(await a.arrayBuffer()) };
}

/** Resume una importación de catálogo en una frase corta (las primeras filas rechazadas, con su número). */
function resumenImportacion(r: ResultadoImportacionCatalogo, singular: string): string {
  if (r.error) return `error:${r.error}`;
  const partes = [`${r.guardadas} ${singular} guardados`];
  if (r.actualizadas > 0) partes.push(`${r.actualizadas} cambiaron algo ya existente`);
  if (r.rechazadas.length > 0) {
    const ej = r.rechazadas.slice(0, 5).map((x) => `fila ${x.fila}: ${x.motivo}`).join('; ');
    partes.push(`${r.rechazadas.length} filas rechazadas (${ej}${r.rechazadas.length > 5 ? '…' : ''})`);
  }
  return partes.join(' · ');
}

/**
 * La configuración del conciliador de peajes (Agente 2): lo que el cruce
 * necesita saber de la flota y que no se puede adivinar — qué TAG es de qué
 * unidad, dónde queda cada caseta, cómo escribe cada proveedor sus columnas —
 * y el buzón firmado por donde el proveedor puede mandar su archivo solo.
 *
 * Cada server action repite su puerta adentro (sesión, área, flota): una action
 * es un endpoint alcanzable por POST directo, no un botón.
 */
export default async function PaginaConfiguracionPeajes({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; aviso?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);
  const puedeAdministrar = puedeVerArea(rol, 'administracion');

  const secreto = secretoMaestro();
  const [tags, unidades, casetas, geocercas, mapeos, buzon, archivos, entradas] = await Promise.all([
    safe(() => listarTags(tenantId)),
    safe(() => listarUnidades(tenantId)),
    safe(() => listarCasetas(tenantId)),
    safe(() => listarGeocercas(tenantId)),
    safe(() => listarMapeos(tenantId)),
    safe(() => leerConfigBuzon(tenantId)),
    safe(() => listarArchivosIngesta(tenantId, 20)),
    safe(() => leerConfigEntradas(tenantId)),
  ]);

  // La llave SOLO se calcula para quien administra y SOLO si el buzón está activo.
  const llave = puedeAdministrar && secreto && buzon?.activa ? claveDeFlota(secreto, tenantId, buzon.rotacion) : null;
  const baseUrl = appUrl();

  // ── Buzón ──
  async function accionActivarBuzon() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await activarBuzon(tenantId)) ? 'Buzón activado. Copia la llave y configúrala en el sistema que manda el archivo.' : 'error:No se pudo activar el buzón. Inténtalo de nuevo.');
  }
  async function accionDesactivarBuzon() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await desactivarBuzon(tenantId)) ? 'Buzón desactivado: el endpoint rechaza todo envío de esta flota.' : 'error:No se pudo desactivar. Inténtalo de nuevo.');
  }
  async function accionRotarLlave() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await rotarLlaveBuzon(tenantId)) ? 'Llave rotada: la anterior dejó de servir. Configura la nueva donde se firma el envío.' : 'error:No se pudo rotar la llave (¿el buzón está activado?).');
  }
  async function accionReintentarArchivo(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const id = String(fd.get('archivo') ?? '');
    volverConfig(sufijo, (await reintentarArchivoPeaje(tenantId, id)) ? 'El archivo volvió a la cola: el siguiente ciclo (≤ 15 min) lo procesa.' : 'error:Ese archivo no se puede reintentar (solo los fallidos que conservan su contenido).');
  }

  // ── Recepción por correo y pull (0563) ──
  async function accionActivarCorreo() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await activarCorreoPeajes(tenantId)) ? 'Correo activado. Comparte la dirección solo con quien manda los cortes.' : 'error:No se pudo activar el correo. Inténtalo de nuevo.');
  }
  async function accionDesactivarCorreo() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await desactivarCorreoPeajes(tenantId)) ? 'Correo apagado: lo que llegue a la dirección se ignora.' : 'error:No se pudo apagar el correo.');
  }
  async function accionRotarCorreo() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await rotarCorreoPeajes(tenantId)) ? 'Dirección cambiada: la anterior dejó de servir. Avísale a quien manda los cortes.' : 'error:No se pudo cambiar la dirección (¿el correo está activado?).');
  }
  async function accionGuardarRemitentes(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    const r = await guardarRemitentesPeajes(tenantId, String(fd.get('remitentes') ?? '').split(/[\n,;]+/));
    volverConfig(sufijo, r.ok ? (r.guardados === 0 ? 'Sin lista: entra el correo de cualquiera que tenga la dirección.' : `${r.guardados} remitente(s) permitidos.`) : `error:${r.motivo}`);
  }
  async function accionGuardarPull(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    const r = await guardarPullPeajes(tenantId, {
      url: String(fd.get('url') ?? ''), token: String(fd.get('token') ?? ''), intervaloMin: Number(String(fd.get('intervalo') ?? '').trim()),
    });
    volverConfig(sufijo, r.ok ? 'Consulta automática encendida: la primera corre en el siguiente ciclo (≤ 15 min).' : `error:${r.motivo}`);
  }
  async function accionApagarPull() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await apagarPullPeajes(tenantId)) ? 'Consulta automática apagada.' : 'error:No se pudo apagar.');
  }
  async function accionBorrarCredencialPull() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await borrarCredencialPull(tenantId)) ? 'Token borrado.' : 'error:No se pudo borrar el token.');
  }

  // ── TAGs ──
  async function accionAltaTag(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const r = await altaTag(tenantId, {
      tag: String(fd.get('tag') ?? ''), unidadId: String(fd.get('unidad') ?? ''), proveedor: String(fd.get('proveedor') ?? ''),
    });
    volverConfig(sufijo, r.ok ? 'TAG guardado.' : `error:${r.motivo}`);
  }
  async function accionBajaTag(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await bajaTag(tenantId, String(fd.get('tag') ?? ''))) ? 'TAG eliminado.' : 'error:No se pudo eliminar el TAG.');
  }
  async function accionImportarTags(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') volverConfig(sufijo, `error:${a}`);
    const r = await importarTagsArchivo(tenantId, (a as { nombre: string }).nombre, (a as { buffer: Uint8Array }).buffer);
    volverConfig(sufijo, resumenImportacion(r, 'TAGs'));
  }

  // ── Casetas ──
  async function accionImportarCasetas(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') volverConfig(sufijo, `error:${a}`);
    const fuente = String(fd.get('fuente') ?? '').trim().slice(0, 200) || 'CSV cargado desde el panel';
    const r = await importarCasetasArchivo(tenantId, (a as { nombre: string }).nombre, (a as { buffer: Uint8Array }).buffer, fuente);
    volverConfig(sufijo, resumenImportacion(r, 'casetas'));
  }
  async function accionEstadoCaseta(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const activa = String(fd.get('activa')) === 'true';
    volverConfig(sufijo, (await cambiarEstadoCaseta(tenantId, String(fd.get('caseta') ?? ''), activa)) ? (activa ? 'Caseta activada.' : 'Caseta desactivada: ya no se usa en el cruce.') : 'error:No se pudo cambiar la caseta.');
  }

  // ── Geocercas ──
  async function accionGuardarGeocerca(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const num = (k: string) => Number(String(fd.get(k) ?? '').trim().replace(',', '.'));
    const r = await guardarGeocerca(tenantId, {
      nombre: String(fd.get('nombre') ?? ''), tipo: String(fd.get('tipo') ?? ''),
      lat: num('lat'), lng: num('lng'), radioM: num('radio_m'),
    });
    volverConfig(sufijo, r.ok ? 'Geocerca guardada.' : `error:${r.motivo}`);
  }
  async function accionEstadoGeocerca(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const activa = String(fd.get('activa')) === 'true';
    volverConfig(sufijo, (await cambiarEstadoGeocerca(tenantId, String(fd.get('geocerca') ?? ''), activa)) ? (activa ? 'Geocerca activada.' : 'Geocerca desactivada.') : 'error:No se pudo cambiar la geocerca.');
  }

  // ── Mapeo de columnas ──
  async function accionGuardarMapeo(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const campo = (k: string) => String(fd.get(k) ?? '').trim();
    const r = await guardarMapeo(tenantId, campo('proveedor'), {
      fecha: campo('fecha'), hora: campo('hora'), caseta: campo('caseta'), monto: campo('monto'), tag: campo('tag'),
    });
    volverConfig(sufijo, r.ok ? 'Mapeo guardado. Se usa en los próximos archivos de ese proveedor; los fallidos se reintentan desde «Archivos recibidos».' : `error:${r.motivo}`);
  }
  async function accionBorrarMapeo(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await borrarMapeo(tenantId, String(fd.get('mapeo') ?? ''))) ? 'Mapeo eliminado.' : 'error:No se pudo eliminar el mapeo.');
  }

  // El kill switch solo se MUESTRA aquí (el cruce lo respeta); configurar no es operar.
  const aviso = await avisoAgentePeajesApagado().catch(() => null);

  return (
    <VistaConfiguracionPeajes
      sufijo={sufijo}
      aviso={sp.aviso ?? null}
      error={sp.error ?? null}
      agenteApagado={aviso}
      tags={tags} unidades={unidades} casetas={casetas} geocercas={geocercas} mapeos={mapeos} archivos={archivos}
      tiposGeocerca={[...TIPOS_GEOCERCA]}
      buzon={{
        estado: buzon === null ? 'ilegible' : (buzon?.activa ? 'activo' : 'inactivo'),
        rotacion: buzon?.rotacion ?? null,
        secretoConfigurado: secreto !== null,
        puedeAdministrar,
        llave,
        url: `${baseUrl}/api/peajes/ingesta`,
        flotaId: tenantId,
      }}
      entradas={{
        config: entradas,
        puedeAdministrar,
        direccionCorreo: entradas?.correoToken ? direccionPj(entradas.correoToken, dominioBuzon()) : null,
        cofreConfigurado: cofreConfigurado(),
      }}
      acciones={{
        activarCorreo: accionActivarCorreo, desactivarCorreo: accionDesactivarCorreo, rotarCorreo: accionRotarCorreo, guardarRemitentes: accionGuardarRemitentes,
        guardarPull: accionGuardarPull, apagarPull: accionApagarPull, borrarCredencialPull: accionBorrarCredencialPull,
        activarBuzon: accionActivarBuzon, desactivarBuzon: accionDesactivarBuzon, rotarLlave: accionRotarLlave, reintentarArchivo: accionReintentarArchivo,
        altaTag: accionAltaTag, bajaTag: accionBajaTag, importarTags: accionImportarTags,
        importarCasetas: accionImportarCasetas, estadoCaseta: accionEstadoCaseta,
        guardarGeocerca: accionGuardarGeocerca, estadoGeocerca: accionEstadoGeocerca,
        guardarMapeo: accionGuardarMapeo, borrarMapeo: accionBorrarMapeo,
      }}
    />
  );
}
