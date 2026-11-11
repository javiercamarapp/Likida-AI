import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { vigilar } from '../../bloque';
import { ahoraMs } from '@/lib/saludo';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { crearDepsVigia } from '@/lib/likida/vigia/deps';
import { crearRepoBandeja } from '@/lib/likida/vigia/aviso/bandeja';
import {
  cargarTablero, validarConfig, guardarConfigVigia, altaContactoVigia, bajaManualContacto, suprimirContactoVigia, guardarDirectorVigia, quitarDirectorVigia,
  validarServicio, guardarServicioVigia, quitarServicioVigia,
} from '@/lib/likida/vigia/repo';
import { validarDirector } from '@/lib/likida/vigia/respaldo_correo';
import {
  aprobarMensaje, rechazarMensaje, tomarConversacion, devolverConversacion, responderComoHumano, cerrarConversacion,
  type ResultadoDecision,
} from '@/lib/likida/vigia/servicio';
import { sufijoTenant } from '../../sufijo';
import { VistaAgenteVigia } from './vista';
import type { ResultadoVigia } from './controles';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT('agentes')).t('vigia.page.titulo') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/vigia';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quien decide por los clientes: el dueño y el encargado. El resto de los roles de la flota solo mira. */
const DECIDE = ['flota_admin', 'encargado'];

const texto = (fd: FormData, k: string): string => String(fd.get(k) ?? '');

/**
 * Vuelve a resolver la sesión (cookie) y devuelve el actor si su rol puede lo que se pide.
 * A NIVEL DE MÓDULO a propósito: una `'use server'` inline que cierra sobre una función
 * local no es serializable (`server_actions_sin_closures.test.ts`); aquí `sp` entra por
 * parámetro y lo único que las acciones capturan son strings.
 */
async function actor(sp: { vista?: string; tenant?: string; rol?: string }, tenantId: string, permiso: 'decide' | 'administra') {
  const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  const rolOk = permiso === 'administra' ? s.rol === 'flota_admin' : DECIDE.includes(s.rol);
  if (!puedeVerRuta(s.rol, RUTA) || !rolOk) return null;
  return { tenantId: s.tenantId, userId: s.userId };
}

const aResultado = (r: ResultadoDecision): ResultadoVigia => (r.ok ? { ok: true, mensaje: r.mensaje } : { ok: false, error: r.mensaje });

/**
 * El tablero del Vigía de servicio al cliente (Agente 4, 0400): cola de aprobación,
 * excepciones (molestos, sin respuesta, escalados, envíos fallidos), SLA, conversaciones
 * activas con toma de control humana, configuración y los clientes autorizados.
 *
 * Área `operacion` (su usuario diario es el gerente de servicio). Cero pesos en pantalla.
 * Las acciones son server actions: cada una vuelve a resolver sesión, rol y tenant desde
 * la cookie —nunca de un campo del formulario— y nunca acepta un `tenant_id` del cliente.
 */
export default async function PaginaAgenteVigia({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const { t: tx } = await getT('agentes');
  const sp = await searchParams;
  const tr = await getT('agentes');
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  // T-A4-32: bajo el perfil cinco_agentes el autoenvío y el POD adjunto son stand-by (ocultos e inoperantes; el código sigue).
  const standby = (await perfilDeTenant(tenantId)) === 'cinco_agentes';

  // FE-14: se lanza UNA vez y se pasa la PROMESA; cada tarjeta espera la suya.
  const datos = vigilar(cargarTablero(tenantId));
  // T-A4-22: cuántos avisos de viaje esperan a una persona; si no se puede contar (p. ej. 0797 sin aplicar) el enlace va sin número.
  const avisosPendientes = vigilar(crearRepoBandeja().contarPendientes(tenantId).catch((): number | null => null));

  async function decidir(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const { t: tx } = await getT('agentes');
    const a = await actor(sp, tenantId, 'decide');
    if (!a) return { ok: false, error: tx('rest.solo_el_dueno_o_el_encargado_5') };
    const id = texto(fd, 'id');
    if (!UUID.test(id)) return { ok: false, error: tx('rest.mensaje_no_valido') };
    const que = texto(fd, 'accion');
    try {
      const deps = crearDepsVigia();
      let r: ResultadoDecision;
      if (que === 'aprobar') {
        const editado = texto(fd, 'texto');
        r = await aprobarMensaje(a, id, deps, editado ? { textoEditado: editado } : {});
      } else if (que === 'rechazar') r = await rechazarMensaje(a, id, deps);
      else if (que === 'tomar') {
        // El id es de un mensaje de la cola; resuelve a su hilo DENTRO de la flota de la sesión.
        const m = await deps.repo.mensaje(a.tenantId, id);
        r = m ? await tomarConversacion(a, m.conversacionId, deps) : { ok: false, motivo: 'no_encontrado', mensaje: tx('rest.no_encuentro_ese_mensaje_en_tu') };
      } else return { ok: false, error: tx('rest.accion_no_valida') };
      revalidatePath(RUTA);
      return aResultado(r);
    } catch (e) {
      logger.error('vigia.accion_decidir_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: mensajeParaPantalla(e, 'atender al cliente') };
    }
  }

  async function conversacion(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const { t: tx } = await getT('agentes');
    const a = await actor(sp, tenantId, 'decide');
    if (!a) return { ok: false, error: tx('rest.solo_el_dueno_o_el_encargado_5') };
    const id = texto(fd, 'id');
    if (!UUID.test(id)) return { ok: false, error: tx('rest.conversacion_no_valida') };
    const que = texto(fd, 'accion');
    try {
      const deps = crearDepsVigia();
      let r: ResultadoDecision;
      if (que === 'tomar') r = await tomarConversacion(a, id, deps);
      else if (que === 'devolver') r = await devolverConversacion(a, id, deps);
      else if (que === 'cerrar') r = await cerrarConversacion(a, id, deps);
      else if (que === 'responder') r = await responderComoHumano(a, id, texto(fd, 'texto'), deps);
      else return { ok: false, error: tx('rest.accion_no_valida') };
      revalidatePath(RUTA);
      return aResultado(r);
    } catch (e) {
      logger.error('vigia.accion_conversacion_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: mensajeParaPantalla(e, 'atender al cliente') };
    }
  }

  async function config(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const { t: tx } = await getT('agentes');
    const a = await actor(sp, tenantId, 'administra');
    if (!a) return { ok: false, error: tx('rest.solo_el_dueno_de_la_flota_15') };
    const v = validarConfig({
      habilitado: fd.get('habilitado') === 'on', modoAprobacion: texto(fd, 'modoAprobacion'),
      autoenviarMinAprobaciones: texto(fd, 'autoenviarMinAprobaciones'), slaRespuestaMin: texto(fd, 'slaRespuestaMin'),
      escalarNivel2Min: texto(fd, 'escalarNivel2Min'), slaCriticoMin: texto(fd, 'slaCriticoMin'), molestiaAvisoNivel: texto(fd, 'molestiaAvisoNivel'), retencionDias: texto(fd, 'retencionDias'), avisoPrivacidadUrl: texto(fd, 'avisoPrivacidadUrl'),
      respaldoCorreo: fd.get('respaldoCorreo') === 'on',
    });
    if (!v.ok) return { ok: false, error: v.error };
    // El perfil se relee en el servidor: un formulario armado a mano no puede encender el autoenvío (stand-by).
    if (v.valor.modoAprobacion !== 'siempre' && (await perfilDeTenant(a.tenantId)) === 'cinco_agentes') return { ok: false, error: tx('rest.el_autoenvio_no_esta_disponible_en') };
    try {
      await guardarConfigVigia(a.tenantId, a.userId, v.valor);
      revalidatePath(RUTA);
      return { ok: true, mensaje: v.valor.habilitado ? tx('rest.guardado_el_vigia_esta_encendido') : tx('rest.guardado_el_vigia_esta_apagado_ningun') };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, tx('rest.guardar_la_configuracion')) };
    }
  }

  async function director(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const { t: tx } = await getT('agentes');
    const a = await actor(sp, tenantId, 'administra');
    if (!a) return { ok: false, error: tx('rest.solo_el_dueno_de_la_flota_16') };
    const id = texto(fd, 'id');
    if (id && !UUID.test(id)) return { ok: false, error: tx('rest.persona_no_valida') };
    const que = texto(fd, 'accion');
    try {
      if (que === 'quitar') {
        if (!id) return { ok: false, error: tx('rest.elige_a_quien_quitar') };
        const ok = await quitarDirectorVigia(a.tenantId, id);
        revalidatePath(RUTA);
        return ok ? { ok: true, mensaje: tx('rest.quitado_de_la_lista') } : { ok: false, error: tx('rest.no_encontre_a_esa_persona_en') };
      }
      if (que !== 'guardar') return { ok: false, error: tx('rest.accion_no_valida') };
      const v = validarDirector({ nivel: texto(fd, 'nivel'), nombre: texto(fd, 'nombre'), telefono: texto(fd, 'telefono'), correo: texto(fd, 'correo') });
      if (!v.ok) return { ok: false, error: v.error };
      const r = await guardarDirectorVigia(a.tenantId, a.userId, id || null, v.valor);
      if (!r.ok) return { ok: false, error: r.error };
      revalidatePath(RUTA);
      return { ok: true, mensaje: id ? 'Cambios guardados.' : 'Agregado a la lista.' };
    } catch (e) {
      logger.error('vigia.accion_director_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: mensajeParaPantalla(e, tx('rest.guardar_la_lista_de_avisos')) };
    }
  }

  async function servicio(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const { t: tx } = await getT('agentes');
    const a = await actor(sp, tenantId, 'administra');
    if (!a) return { ok: false, error: tx('rest.solo_el_dueno_de_la_flota_16') };
    const id = texto(fd, 'id');
    if (id && !UUID.test(id)) return { ok: false, error: tx('rest.persona_no_valida') };
    const que = texto(fd, 'accion');
    try {
      if (que === 'quitar') {
        if (!id) return { ok: false, error: tx('rest.elige_a_quien_quitar') };
        const ok = await quitarServicioVigia(a.tenantId, id);
        revalidatePath(RUTA);
        return ok ? { ok: true, mensaje: tx('rest.quitado_de_servicio_al_cliente') } : { ok: false, error: tx('rest.no_encontre_a_esa_persona_en') };
      }
      if (que !== 'guardar') return { ok: false, error: tx('rest.accion_no_valida') };
      const v = validarServicio({
        clienteId: texto(fd, 'clienteId'), nombre: texto(fd, 'nombre'), telefono: texto(fd, 'telefono'), correo: texto(fd, 'correo'), activo: fd.get('activo') === 'on',
      });
      if (!v.ok) return { ok: false, error: v.error };
      const r = await guardarServicioVigia(a.tenantId, a.userId, id || null, v.valor);
      if (!r.ok) return { ok: false, error: r.error };
      revalidatePath(RUTA);
      return { ok: true, mensaje: id ? 'Cambios guardados.' : 'Agregado a servicio al cliente.' };
    } catch (e) {
      logger.error('vigia.accion_servicio_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: mensajeParaPantalla(e, tx('rest.guardar_la_lista_de_servicio_al')) };
    }
  }

  async function alta(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const { t: tx } = await getT('agentes');
    const a = await actor(sp, tenantId, 'administra');
    if (!a) return { ok: false, error: tx('rest.solo_el_dueno_de_la_flota_17') };
    const clienteId = texto(fd, 'clienteId');
    const gerente = texto(fd, 'gerenteUserId');
    if (!UUID.test(clienteId) || (gerente && !UUID.test(gerente))) return { ok: false, error: tx('rest.elige_un_cliente_de_la_lista') };
    try {
      const r = await altaContactoVigia(a.tenantId, a.userId, {
        clienteId, telefono: texto(fd, 'telefono'), nombre: texto(fd, 'nombre') || null,
        gerenteUserId: gerente || null, consentimiento: fd.get('consentimiento') === 'on',
      });
      if (!r.ok) return { ok: false, error: r.error };
      revalidatePath(RUTA);
      return { ok: true, mensaje: tx('rest.contacto_autorizado_a_partir_de_ahora') };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'autorizar al contacto') };
    }
  }

  async function contacto(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const { t: tx } = await getT('agentes');
    const a = await actor(sp, tenantId, 'administra');
    if (!a) return { ok: false, error: tx('rest.solo_el_dueno_de_la_flota_18') };
    const id = texto(fd, 'id');
    if (!UUID.test(id)) return { ok: false, error: tx('rest.contacto_no_valido') };
    const que = texto(fd, 'accion');
    try {
      if (que === 'baja') {
        const ok = await bajaManualContacto(a.tenantId, a.userId, id);
        revalidatePath(RUTA);
        return ok ? { ok: true, mensaje: tx('rest.contacto_dado_de_baja_ya_no') } : { ok: false, error: tx('rest.no_encontre_a_ese_contacto_activo') };
      }
      if (que === 'suprimir') {
        if (fd.get('confirmo') !== 'on') return { ok: false, error: tx('rest.marca_la_casilla_para_confirmar_que') };
        const r = await suprimirContactoVigia(a.tenantId, id);
        revalidatePath(RUTA);
        return r
          ? { ok: true, mensaje: tx('rest.suprimido_se_borraron_mensaje_s_y', { mensajes: r.mensajes, conversaciones: r.conversaciones }) }
          : { ok: false, error: tx('rest.no_encontre_a_ese_contacto_en') };
      }
      return { ok: false, error: tx('rest.accion_no_valida') };
    } catch (e) {
      logger.error('vigia.accion_contacto_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: mensajeParaPantalla(e, 'actualizar al contacto') };
    }
  }

  return (
    <VistaAgenteVigia
      tr={tr}
      datos={datos}
      ahoraMs={ahoraMs()}
      puedeDecidir={DECIDE.includes(rol)}
      puedeAdministrar={rol === 'flota_admin'}
      acciones={{ decidir, conversacion, config, alta, contacto, director, servicio }}
      sufijo={sufijoTenant(sp)}
      avisosPendientes={avisosPendientes}
      standby={standby}
    />
  );
}
