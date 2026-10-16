'use server';

import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { DatoInvalido, mensajeParaPantalla } from '@/lib/likida/errores';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import { guardarConfigSalida, validarConfigSalida } from '@/lib/likida/carta_porte_docs/salida_config';
import { SIN_TMS } from '@/lib/likida/carta_porte_docs/tms_puerto';
import { salidaDeFlota } from '@/lib/likida/carta_porte_docs/worker_envios_deps';
import type { ResultadoAccion } from '@/app/dashboard/carta-porte/documentos/forma_accion';
import { entradaDeTexto, esProbable, type CamposTexto } from './formato';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE LA SALIDA AL SISTEMA DEL CLIENTE (T-A3-32).
//
// Server actions A NIVEL DE MÓDULO: vuelven a resolver sesión, rol y flota desde la cookie. JAMÁS aceptan un tenant_id
// del formulario (los campos tenant/rol/vista son el «ver como» firmado que ya valida `resolverTenantEfectivo`).
// La ruta es del área `administracion`: solo dueño/administrador. Aquí no entra ni sale ninguna credencial del TMS.
// ═══════════════════════════════════════════════════════════════════════════

const RUTA = '/dashboard/agentes/carta-porte/configuracion';
const SIN_PERMISO = 'Tu rol no puede cambiar la configuración de la salida de Carta Porte.';
const CAMPOS: ReadonlyArray<keyof CamposTexto> = [
  'modo', 'plantillaPorDefecto', 'reintentosMax', 'frecuenciaMin', 'ventanaInicio', 'ventanaFin', 'destinatarioAlertaCorreo',
  'destinatarioAlertaUsuario', 'destinatarioRevisionUsuario', 'destinatarioRevisionCorreo', 'siTmsDesconocido', 'distanciaFormato',
];

const verComo = (fd: FormData) => ({
  tenant: typeof fd.get('tenant') === 'string' ? String(fd.get('tenant')) : undefined,
  rol: typeof fd.get('rol') === 'string' ? String(fd.get('rol')) : undefined,
  vista: typeof fd.get('vista') === 'string' ? String(fd.get('vista')) : undefined,
});

/** Guarda la configuración COMPLETA que manda el formulario. Campos: los de `CAMPOS` (texto). */
export async function guardarConfiguracionSalida(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await resolverTenantEfectivo(RUTA, verComo(fd));
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: SIN_PERMISO };
  try {
    if (!(await rateLimit(`cp-salida-config:${s.tenantId}`, 20, 60_000))) return { ok: false, error: 'Demasiados cambios en poco tiempo. Espera un minuto.' };
    const texto = Object.fromEntries(CAMPOS.map((c) => [c, String(fd.get(c) ?? '')])) as CamposTexto;
    const entrada = entradaDeTexto(texto);
    const valida = validarConfigSalida({ ...entrada });
    // El modo API solo se activa con un conector probado: sin él, la salida sigue siendo la descarga.
    if (valida.modo === 'api' && (await salidaDeFlota(s.tenantId)) === SIN_TMS) {
      return { ok: false, error: 'El modo API todavía no se puede activar: no hay una conexión probada con el sistema del cliente. Deja «Descarga» y sube la plantilla a mano.' };
    }
    // Los destinatarios internos tienen que ser personas activas de ESTA flota.
    for (const [campo, rotulo] of [['destinatarioAlertaUsuario', 'de la alerta'], ['destinatarioRevisionUsuario', 'de la revisión']] as const) {
      const id = valida[campo];
      if (id && !(await repo.usuarioRevisor(s.tenantId, id))) return { ok: false, error: `El usuario ${rotulo} no es una persona activa de tu flota.` };
    }
    await guardarConfigSalida(s.tenantId, valida, { id: s.userId });
    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Configuración guardada.' };
  } catch (e) {
    if (e instanceof DatoInvalido) return { ok: false, error: e.message };
    logger.error('carta_porte_docs.salida_config_pantalla', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'guardar la configuración de la salida') };
  }
}

/** «Probar conexión»: llama a `probar()` del conector de PS. Sin conector probable no hace nada. Deja bitácora sin detalle del TMS. */
export async function probarConexionSalida(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await resolverTenantEfectivo(RUTA, verComo(fd));
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: SIN_PERMISO };
  try {
    if (!(await rateLimit(`cp-salida-probar:${s.tenantId}`, 6, 60_000))) return { ok: false, error: 'Demasiadas pruebas en poco tiempo. Espera un minuto.' };
    const puerto = await salidaDeFlota(s.tenantId);
    if (puerto === SIN_TMS || !esProbable(puerto)) return { ok: false, error: 'Esta flota todavía no tiene conectado el sistema del cliente.' };
    const r = await puerto.probar();
    await anotarBitacora(
      { tenantId: s.tenantId, actor: { id: s.userId }, accion: 'ccp.salida_conexion_probada', entidad: 'tenant', entidadId: s.tenantId, detalle: { ok: r.ok } },
      { evento: 'carta_porte_docs.bitacora_no_escribio' },
    );
    return r.ok ? { ok: true, mensaje: 'La conexión con el sistema del cliente respondió bien.' } : { ok: false, error: 'La conexión con el sistema del cliente no respondió. Intenta de nuevo más tarde o avisa a soporte.' };
  } catch (e) {
    logger.error('carta_porte_docs.salida_probar', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'probar la conexión') };
  }
}
