import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { vigilar } from '../../bloque';
import { ahoraMs } from '@/lib/saludo';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { crearDepsVigia } from '@/lib/likida/vigia/deps';
import {
  cargarTablero, validarConfig, guardarConfigVigia, altaContactoVigia, bajaManualContacto, suprimirContactoVigia,
} from '@/lib/likida/vigia/repo';
import {
  aprobarMensaje, rechazarMensaje, tomarConversacion, devolverConversacion, responderComoHumano, cerrarConversacion,
  type ResultadoDecision,
} from '@/lib/likida/vigia/servicio';
import { sufijoTenant } from '../../sufijo';
import { VistaAgenteVigia } from './vista';
import type { ResultadoVigia } from './controles';

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
async function actor(sp: { vista?: string; tenant?: string; rol?: string }, permiso: 'decide' | 'administra') {
  const s = await resolverTenantEfectivo(RUTA, sp);
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
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // FE-14: se lanza UNA vez y se pasa la PROMESA; cada tarjeta espera la suya.
  const datos = vigilar(cargarTablero(tenantId));

  async function decidir(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const a = await actor(sp, 'decide');
    if (!a) return { ok: false, error: 'Solo el dueño o el encargado de la flota decide por los clientes.' };
    const id = texto(fd, 'id');
    if (!UUID.test(id)) return { ok: false, error: 'Mensaje no válido.' };
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
        r = m ? await tomarConversacion(a, m.conversacionId, deps) : { ok: false, motivo: 'no_encontrado', mensaje: 'No encuentro ese mensaje en tu flota.' };
      } else return { ok: false, error: 'Acción no válida.' };
      revalidatePath(RUTA);
      return aResultado(r);
    } catch (e) {
      logger.error('vigia.accion_decidir_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: mensajeParaPantalla(e, 'atender al cliente') };
    }
  }

  async function conversacion(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const a = await actor(sp, 'decide');
    if (!a) return { ok: false, error: 'Solo el dueño o el encargado de la flota decide por los clientes.' };
    const id = texto(fd, 'id');
    if (!UUID.test(id)) return { ok: false, error: 'Conversación no válida.' };
    const que = texto(fd, 'accion');
    try {
      const deps = crearDepsVigia();
      let r: ResultadoDecision;
      if (que === 'tomar') r = await tomarConversacion(a, id, deps);
      else if (que === 'devolver') r = await devolverConversacion(a, id, deps);
      else if (que === 'cerrar') r = await cerrarConversacion(a, id, deps);
      else if (que === 'responder') r = await responderComoHumano(a, id, texto(fd, 'texto'), deps);
      else return { ok: false, error: 'Acción no válida.' };
      revalidatePath(RUTA);
      return aResultado(r);
    } catch (e) {
      logger.error('vigia.accion_conversacion_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: mensajeParaPantalla(e, 'atender al cliente') };
    }
  }

  async function config(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const a = await actor(sp, 'administra');
    if (!a) return { ok: false, error: 'Solo el dueño de la flota cambia la configuración del Vigía.' };
    const v = validarConfig({
      habilitado: fd.get('habilitado') === 'on', modoAprobacion: texto(fd, 'modoAprobacion'),
      autoenviarMinAprobaciones: texto(fd, 'autoenviarMinAprobaciones'), slaRespuestaMin: texto(fd, 'slaRespuestaMin'),
      escalarNivel2Min: texto(fd, 'escalarNivel2Min'), slaCriticoMin: texto(fd, 'slaCriticoMin'), molestiaAvisoNivel: texto(fd, 'molestiaAvisoNivel'), retencionDias: texto(fd, 'retencionDias'), avisoPrivacidadUrl: texto(fd, 'avisoPrivacidadUrl'),
    });
    if (!v.ok) return { ok: false, error: v.error };
    try {
      await guardarConfigVigia(a.tenantId, a.userId, v.valor);
      revalidatePath(RUTA);
      return { ok: true, mensaje: v.valor.habilitado ? 'Guardado. El Vigía está encendido.' : 'Guardado. El Vigía está apagado: ningún cliente recibe respuesta.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar la configuración') };
    }
  }

  async function alta(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const a = await actor(sp, 'administra');
    if (!a) return { ok: false, error: 'Solo el dueño de la flota autoriza clientes.' };
    const clienteId = texto(fd, 'clienteId');
    const gerente = texto(fd, 'gerenteUserId');
    if (!UUID.test(clienteId) || (gerente && !UUID.test(gerente))) return { ok: false, error: 'Elige un cliente de la lista.' };
    try {
      const r = await altaContactoVigia(a.tenantId, a.userId, {
        clienteId, telefono: texto(fd, 'telefono'), nombre: texto(fd, 'nombre') || null,
        gerenteUserId: gerente || null, consentimiento: fd.get('consentimiento') === 'on',
      });
      if (!r.ok) return { ok: false, error: r.error };
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Contacto autorizado. A partir de ahora el Vigía atiende sus mensajes (si está encendido).' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'autorizar al contacto') };
    }
  }

  async function contacto(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const a = await actor(sp, 'administra');
    if (!a) return { ok: false, error: 'Solo el dueño de la flota administra a los contactos.' };
    const id = texto(fd, 'id');
    if (!UUID.test(id)) return { ok: false, error: 'Contacto no válido.' };
    const que = texto(fd, 'accion');
    try {
      if (que === 'baja') {
        const ok = await bajaManualContacto(a.tenantId, a.userId, id);
        revalidatePath(RUTA);
        return ok ? { ok: true, mensaje: 'Contacto dado de baja: ya no recibe mensajes.' } : { ok: false, error: 'No encontré a ese contacto activo en tu flota.' };
      }
      if (que === 'suprimir') {
        if (fd.get('confirmo') !== 'on') return { ok: false, error: 'Marca la casilla para confirmar que se borrarán sus chats.' };
        const r = await suprimirContactoVigia(a.tenantId, id);
        revalidatePath(RUTA);
        return r
          ? { ok: true, mensaje: `Suprimido: se borraron ${r.mensajes} mensaje(s) y ${r.conversaciones} conversación(es). Su teléfono ya no se conserva.` }
          : { ok: false, error: 'No encontré a ese contacto en tu flota.' };
      }
      return { ok: false, error: 'Acción no válida.' };
    } catch (e) {
      logger.error('vigia.accion_contacto_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: mensajeParaPantalla(e, 'actualizar al contacto') };
    }
  }

  return (
    <VistaAgenteVigia
      datos={datos}
      ahoraMs={ahoraMs()}
      puedeDecidir={DECIDE.includes(rol)}
      puedeAdministrar={rol === 'flota_admin'}
      acciones={{ decidir, conversacion, config, alta, contacto }}
      sufijo={sufijoTenant(sp)}
    />
  );
}
