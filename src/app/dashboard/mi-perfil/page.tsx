import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { estadoMfa, MSG_MFA_SUPERADMIN, type VeredictoMfaSuperadmin } from '@/lib/auth/mfa';
import { requireSessionTenant } from '@/lib/auth/guard';
import { rateLimit } from '@/lib/ratelimit';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { ROL_LABEL, type RolAppUser } from '@/lib/auth/provisionar';
import {
  listarMisClientesMcp, revocarSesionesMcp, type ClienteMcpConectado,
} from '@/lib/mcp/sesiones';
import AvatarUploader from '../../admin/mi-perfil/avatar-uploader';
import { sufijoTenant } from '../sufijo';
import { TablaClientesMcp } from '../sesiones-mcp/vista';
import type { Metadata } from 'next';
import { Aviso, Boton, BotonEnlace, CampoTexto } from '@/app/ui-v2/componentes';
import { EsqueletoConfiguracion } from '@/app/ui-v2/esqueletos';
import './mi-perfil.css';
import { getT } from '@/lib/i18n/servidor';
import { rico } from '@/lib/i18n/rico';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('resto');
  return { title: t('cfg.mi_perfil') };
}

export const dynamic = 'force-dynamic';

/** Tipos de imagen que el bucket acepta. Un `.svg` puede traer script
 *  adentro y el bucket `avatares` es PÚBLICO — servirlo desde nuestro
 *  dominio sería XSS almacenado, así que no entra. */
const TIPOS = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TOPE_BYTES = 2 * 1024 * 1024;

/**
 * MI PERFIL — el panel del cliente por fin edita su propio perfil.
 *
 * La migración 0046 dejó `app_user.avatar_url` y el bucket público
 * `avatares` desde el 12-ago, y su propio comentario decía que la columna
 * servía "el día que su propio panel tenga edición de perfil". Hasta hoy solo
 * la usaba Javier desde /admin/mi-perfil: el contralor de una flota veía su
 * inicial en un círculo y no tenía dónde cambiarla.
 *
 * Se reusa el `AvatarUploader` de /admin — mismo componente, no una copia
 * (una copia se desincroniza y termina siendo dos productos).
 *
 * SEGURIDAD: las dos server actions vuelven a exigir sesión ADENTRO y
 * escriben SIEMPRE contra el `userId` de esa sesión — nunca contra un id que
 * venga del formulario. El modo de falla #1 del código escrito por agentes es
 * IDOR, y un perfil editable es exactamente donde aparecería.
 */
/**
 * El destino de vuelta, conservando el `?tenant=` del superadmin.
 *
 * A NIVEL DE MÓDULO, no dentro del componente: las acciones inline de esta
 * página la usan, y una función capturada por closure de un `'use server'`
 * tiene que serializarse en `encryptActionBoundArgs` — que no puede con
 * funciones. Es el mismo defecto que rompió /dashboard/despacho (ver la nota
 * de `guardiaDespacho` en su page.tsx): reventaba en CADA render con un
 * rechazo no manejado, y el síntoma visible no se parecía en nada a la causa.
 * Recibiendo `sufijo` por parámetro, lo capturado es un string.
 */
function volverAMiPerfil(sufijo: string, estado: string): string {
  return `/dashboard/mi-perfil${sufijo ? `${sufijo}&` : '?'}${estado}`;
}

/**
 * HALLAZGO ALTO #1 (auditoría adversarial, 21-oct-2026): `verificarMfa` y
 * `quitarMfa` llamaban a `sb2.auth.mfa.verify` con el código de 6 dígitos y
 * CERO límite de tasa — rompía el patrón que YA sigue /login
 * (`dentroDelLimite`/`dentroDelLimitePorCuenta`, `login/page.tsx:78-112`).
 * La cuenta de superadmin cruza TODOS los tenants: una sesión AAL1 robada
 * (cookie robada, XSS, lo que sea) podía quedarse martillando el TOTP sin
 * que nada la frenara — a 10/5min el techo de abajo ni se acerca a los
 * 10^6 códigos posibles, pero vuelve el ataque impráctico sin estorbar un
 * dedazo real.
 *
 * POR QUÉ POR USUARIO Y NO POR IP (a diferencia de /login): aquí el
 * atacante YA TIENE la sesión — la cookie viaja con cualquier IP que use.
 * Limitar por IP no frena a ESE actor; lo que hay que acotar es cuántos
 * códigos puede probar ESTA CUENTA en la ventana, sin importar desde dónde
 * los manda.
 *
 * UN SOLO CONTADOR para las dos acciones (mismo prefijo `mfa:codigo:`): la
 * una y la otra gastan el mismo cupo porque las dos son LO MISMO —adivinar
 * el código de esta cuenta—, así que repartir los intentos entre
 * «Verificar sesión» y «Quitar el factor» no debe duplicar el presupuesto.
 *
 * SIN `fallaCerrado` explícito: el default de `rateLimit` (CERRADO ante un
 * blip de Redis, SEG-4 auditoría 24) es el correcto aquí. A diferencia de
 * /login, esto NO es la única vía de entrada al panel — negar de más un
 * intento de MFA en un blip transitorio de Redis es mucho más barato que
 * dejar sin frenos la única defensa contra fuerza bruta del superadmin.
 */
async function dentroDelLimiteMfa(userId: string): Promise<boolean> {
  return await rateLimit(`mfa:codigo:${userId}`, 10, 5 * 60_000);
}

export default async function MiPerfilFlota({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; tenant?: string; vista?: string; rol?: string; mfa?: string; exige?: string }>;
}) {
  const { t } = await getT('resto');
  const s = await requireSessionTenant('/dashboard/mi-perfil');
  // El gate que faltaba (16-ago-2026): era la ÚNICA página del panel sin
  // puedeVerRuta — el sidebar la escondía y la URL abría. Con RUTAS_TODO_ROL
  // todo rol conocido pasa (es TU perfil); un rol desconocido rebota, igual
  // que en el resto del panel. Esconder sin gatear es el patrón que la 0045
  // ya cerró una vez.
  if (!puedeVerRuta(s.rol, '/dashboard/mi-perfil')) redirect('/dashboard');
  const sp = await searchParams;
  const sufijo = sufijoTenant(sp);

  // H16 (auditoría 24): sin comprobar `error`, una lectura caída de
  // `app_user` se veía IGUAL que una cuenta sin correo — la fila "Correo" de
  // abajo pintaba el mismo "—" para las dos, y "—" en ESTA pantalla lee como
  // "tu cuenta no tiene correo", no como "no se pudo leer ahora mismo".
  const { data: fila, error: errFila } = await supabaseAdmin()
    .from('app_user').select('email').eq('id', s.userId).maybeSingle();
  const correoFalloLectura = Boolean(errFila);

  // ── MIS CLIENTES MCP (H3, auditoría de dashboards 29-ago-2026) ──────────
  // La 0260 dejó que cualquiera del panel autorizara Claude o ChatGPT a leer
  // los datos de su flota desde /mcp/autorizar, y la 0265 escribió la función
  // que corta esos accesos… sin un solo llamador ni una pantalla. Este es el
  // lado de "los MÍOS": todo rol conocido llega a esta página, incluidos el
  // contador y el encargado, que no ven `administracion` y por tanto no
  // podrían cortarlos desde /dashboard/sesiones-mcp (los de OTROS, del dueño).
  //
  // `null` = la consulta FALLÓ, y se dice. Pintar "no tienes nada conectado"
  // sobre una base caída es exactamente la mentira que haría que nadie
  // cortara nada.
  let mcp: ClienteMcpConectado[] | null;
  try {
    mcp = await listarMisClientesMcp(s.tenantId, s.userId);
  } catch {
    mcp = null;
  }

  // ── MFA (fase 7): el estado del factor y, si está inscribiendo, el QR. ──
  // El enroll corre EN EL RENDER cuando ?mfa=inscribir (no en la action: el
  // QR/SVG no cabe en un redirect). Antes se barren los factores a medias —
  // un enroll abandonado bloquea el siguiente.
  const sb = await supabaseServer();
  const mfa = await estadoMfa(sb);
  let qr: { factorId: string; svg: string; secreto: string } | null = null;
  if (sp.mfa === 'inscribir' && !mfa.inscrito) {
    for (const idViejo of mfa.sinVerificar) {
      await sb.auth.mfa.unenroll({ factorId: idViejo }).catch(() => undefined);
    }
    const { data: en, error: eEn } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Likida' });
    if (!eEn && en?.type === 'totp') {
      qr = { factorId: en.id, svg: en.totp.qr_code, secreto: en.totp.secret };
    }
  }


  async function actualizarNombre(formData: FormData) {
    'use server';
    // Re-gateo adentro: el `s` de arriba es del render, no de esta llamada.
    const { userId } = await requireSessionTenant('/dashboard/mi-perfil');
    const nombre = String(formData.get('nombre') ?? '').trim();
    if (!nombre) redirect(volverAMiPerfil(sufijo, 'error=nombre'));
    // Tope de 80: la misma medida que la firma del Agente de Cobranza. Un
    // nombre de 4,000 caracteres rompe el sidebar y el PDF.
    if (nombre.length > 80) redirect(volverAMiPerfil(sufijo, 'error=largo'));
    // H36 (auditoría 24): mismo patrón que subirAvatar (H17) — sin comprobar
    // `error`, un UPDATE que falla (base caída, RLS, lo que sea) redirigía
    // igual a "ok=nombre" y "Nombre guardado.", con el nombre viejo todavía
    // en la fila. Fallar cerrado: se dice, no se finge.
    const { error: errNombre } = await supabaseAdmin().from('app_user').update({ nombre }).eq('id', userId);
    if (errNombre) redirect(volverAMiPerfil(sufijo, 'error=nombre_guardar'));
    redirect(volverAMiPerfil(sufijo, 'ok=nombre'));
  }

  async function subirAvatar(formData: FormData) {
    'use server';
    const { userId } = await requireSessionTenant('/dashboard/mi-perfil');
    const archivo = formData.get('avatar');
    if (!(archivo instanceof File) || archivo.size === 0) redirect(volverAMiPerfil(sufijo, 'error=avatar'));
    if (!TIPOS.has(archivo.type)) redirect(volverAMiPerfil(sufijo, 'error=tipo'));
    if (archivo.size > TOPE_BYTES) redirect(volverAMiPerfil(sufijo, 'error=peso'));

    const admin = supabaseAdmin();
    // La extensión sale del TIPO validado, no del nombre del archivo: un
    // `foto.svg` renombrado a `.png` no debe decidir cómo se sirve.
    const ext = archivo.type === 'image/png' ? 'png' : archivo.type === 'image/webp' ? 'webp' : 'jpg';
    // La ruta la fija el servidor con el userId de la sesión — nada del
    // formulario toca el path, o se podría escribir sobre el avatar de otro.
    const ruta = `${userId}/avatar.${ext}`;
    const { error } = await admin.storage.from('avatares')
      .upload(ruta, archivo, { upsert: true, contentType: archivo.type });
    if (error) redirect(volverAMiPerfil(sufijo, 'error=avatar'));

    const { data: pub } = admin.storage.from('avatares').getPublicUrl(ruta);
    // H17 (auditoría 24): este `.update()` no comprobaba `error` — un fallo
    // aquí (la subida a Storage YA quedó hecha) redirigía igual a
    // `ok=avatar` y "Foto de perfil actualizada", cuando en realidad
    // `app_user.avatar_url` se quedó apuntando a la foto vieja. El archivo
    // nuevo existe en el bucket, pero nadie lo ve — y el usuario cree que sí
    // se guardó.
    // `?t=` revienta el caché: la ruta pública no cambia entre subidas.
    const { error: errUpdate } = await admin.from('app_user')
      .update({ avatar_url: `${pub.publicUrl}?t=${Date.now()}` }).eq('id', userId);
    if (errUpdate) redirect(volverAMiPerfil(sufijo, 'error=avatar'));
    // A37-S19-06: el bucket es PÚBLICO y la ruta lleva la extensión; al cambiar de
    // formato la foto anterior (dato personal) seguía con URL estable. Se borran
    // las otras extensiones DESPUÉS de que `avatar_url` ya apunta a la nueva (si
    // esto falla, la foto vieja queda accesible pero no se pierde la nueva: se avisa al log).
    const otras = ['png', 'webp', 'jpg'].filter((e) => e !== ext).map((e) => `${userId}/avatar.${e}`);
    try {
      const { error: errBorrar } = await admin.storage.from('avatares').remove(otras);
      if (errBorrar) logger.warn('mi_perfil.avatar_anterior_no_borrado', { err: errBorrar.message });
    } catch (e) {
      logger.warn('mi_perfil.avatar_anterior_no_borrado', { err: e instanceof Error ? e.message : String(e) });
    }
    redirect(volverAMiPerfil(sufijo, 'ok=avatar'));
  }

  /**
   * Corta TODOS mis clientes MCP de un tiro (`revocar_mcp_oauth_usuario`,
   * 0265). No recibe un id: el usuario y el tenant salen de la sesión
   * RE-RESUELTA aquí adentro, así que un POST directo a esta acción con el
   * uuid de otra persona no tiene por dónde entrar — es la misma regla que
   * ya gobierna `actualizarNombre` y `subirAvatar` en esta página, y el modo
   * de falla #1 (IDOR) es justo el que aparecería en una revocación.
   *
   * `formData` no se usa, pero la firma la exige el `action` de un <form>.
   */
  async function cortarMisSesionesMcp() {
    'use server';
    const { userId, tenantId } = await requireSessionTenant('/dashboard/mi-perfil');
    try {
      await revocarSesionesMcp(tenantId, userId, userId);
    } catch {
      // El detalle no aporta nada accionable aquí: o no había nada vivo (y la
      // lista recargada ya lo dice) o la base falló. Un solo aviso honesto.
      redirect(volverAMiPerfil(sufijo, 'error=mcp'));
    }
    redirect(volverAMiPerfil(sufijo, 'ok=mcp'));
  }

  /**
   * FASE 1 · SEG-SESIONES (checklist 31 v2 #5): «cerrar todas mis sesiones»,
   * explícito — el lado de SELF-SERVICE (ver `cerrarSesionesUsuario` en
   * `usuarios_escritura.ts` para el lado admin-sobre-otro-usuario, en
   * /dashboard/usuarios).
   *
   * `sb.auth.signOut()` SIN opciones ya tiene `scope:'global'` por default en
   * el SDK (@supabase/auth-js, confirmado contra la pila de auditoría: cerrar
   * UNA sesión con el default revoca TAMBIÉN el refresh de las demás del
   * mismo usuario) — los 7 `signOut()` del repo ya hacían esto, sin saberlo.
   * Aquí se pasa EXPLÍCITO (`{ scope: 'global' }`) a propósito: que lo diga
   * el código, no un default que un cambio de librería podría mover a
   * `'local'` sin que nada lo note. Mismo criterio de "un rótulo tiene que
   * ser verdad" que el resto del repo — el botón promete cerrar TODAS, y el
   * código lo pide por su nombre.
   */
  async function cerrarTodasMisSesiones() {
    'use server';
    await requireSessionTenant('/dashboard/mi-perfil');
    const sb2 = await supabaseServer();
    const { error } = await sb2.auth.signOut({ scope: 'global' });
    if (error) redirect(volverAMiPerfil(sufijo, 'error=sesiones'));
    // La sesión propia también murió: no hay a dónde volver en el panel.
    redirect('/login');
  }

  async function verificarMfa(formData: FormData) {
    'use server';
    const { userId } = await requireSessionTenant('/dashboard/mi-perfil');
    if (!(await dentroDelLimiteMfa(userId))) redirect(volverAMiPerfil(sufijo, 'error=mfa_limite'));
    const sb2 = await supabaseServer();
    const factorId = String(formData.get('factorId') ?? '');
    const codigo = String(formData.get('codigo') ?? '').trim();
    if (!factorId || !/^\d{6}$/.test(codigo)) redirect(volverAMiPerfil(sufijo, 'error=mfa_codigo'));
    const reto = await sb2.auth.mfa.challenge({ factorId });
    if (reto.error || !reto.data) redirect(volverAMiPerfil(sufijo, 'error=mfa'));
    const v = await sb2.auth.mfa.verify({ factorId, challengeId: reto.data.id, code: codigo });
    if (v.error) redirect(volverAMiPerfil(sufijo, 'error=mfa_codigo'));
    redirect(volverAMiPerfil(sufijo, 'ok=mfa'));
  }

  async function quitarMfa(formData: FormData) {
    'use server';
    const { userId } = await requireSessionTenant('/dashboard/mi-perfil');
    if (!(await dentroDelLimiteMfa(userId))) redirect(volverAMiPerfil(sufijo, 'error=mfa_limite'));
    const sb2 = await supabaseServer();
    const factorId = String(formData.get('factorId') ?? '');
    if (!factorId) redirect(volverAMiPerfil(sufijo, 'error=mfa'));
    // Quitar el factor EXIGE el código vigente: sin esto, una sesión robada
    // en AAL1 podría bajarle la protección al dueño de la cuenta.
    const codigo = String(formData.get('codigo') ?? '').trim();
    if (!/^\d{6}$/.test(codigo)) redirect(volverAMiPerfil(sufijo, 'error=mfa_codigo'));
    const reto = await sb2.auth.mfa.challenge({ factorId });
    if (reto.error || !reto.data) redirect(volverAMiPerfil(sufijo, 'error=mfa'));
    const v = await sb2.auth.mfa.verify({ factorId, challengeId: reto.data.id, code: codigo });
    if (v.error) redirect(volverAMiPerfil(sufijo, 'error=mfa_codigo'));
    const r = await sb2.auth.mfa.unenroll({ factorId });
    if (r.error) redirect(volverAMiPerfil(sufijo, 'error=mfa'));
    redirect(volverAMiPerfil(sufijo, 'ok=mfa_fuera'));
  }

  const OK: Record<string, string> = {
    avatar: 'Foto de perfil actualizada.',
    nombre: 'Nombre guardado.',
    mfa: t('cfg.segundo_factor_verificado_tu_sesion_queda'),
    mfa_fuera: 'Segundo factor eliminado.',
    mcp: t('cfg.listo_tus_clientes_mcp_dejaron_de'),
  };
  const ERROR: Record<string, string> = {
    avatar: t('cfg.no_se_pudo_subir_la_foto'),
    nombre: t('cfg.el_nombre_no_puede_quedar_vacio'),
    nombre_guardar: t('cfg.no_se_pudo_guardar_el_nombre'),
    largo: t('cfg.el_nombre_no_puede_pasar_de'),
    tipo: t('cfg.solo_se_aceptan_imagenes_jpg_png'),
    peso: t('cfg.la_imagen_pasa_de_2_mb'),
    mfa: t('cfg.no_se_pudo_completar_la_operacion'),
    mfa_codigo: t('cfg.el_codigo_no_es_valido_revisa'),
    mfa_limite: t('cfg.demasiados_intentos_con_el_codigo_espera'),
    mcp: t('cfg.no_se_pudieron_cortar_los_accesos'),
    sesiones: t('cfg.no_se_pudo_confirmar_el_cierre'),
  };

  // El veredicto con el que `exigirMfaSuperadmin` rebotó hasta aquí, si es que
  // rebotó. Se valida contra el catálogo: un `?exige=` inventado a mano no
  // pinta una alarma que no corresponde a nada.
  const exigencia: Exclude<VeredictoMfaSuperadmin, 'ok'> | null =
    sp.exige === 'inscribir' || sp.exige === 'retar' || sp.exige === 'no_verificable' ? sp.exige : null;

  return (
    <EsqueletoConfiguracion
      titulo={t('cfg.mi_perfil')} apoyo={t('cfg.tu_foto_nombre_y_correo_y')}
      avisos={(
        <>
          {sp.ok && OK[sp.ok] && <Aviso tono="ok">{OK[sp.ok]}</Aviso>}
          {/* SEG-3 (auditoría 24): por qué te rebotaron aquí. Con `LIKIDA_SUPERADMIN_MFA=obligatorio`, la puerta de /admin y la de /dashboard mandan al superadmin sin segundo factor a esta pantalla (guard.ts); sin este aviso el rebote sería un misterio. */}
          {exigencia && <Aviso tono="error">{MSG_MFA_SUPERADMIN[exigencia]}</Aviso>}
          {sp.error && ERROR[sp.error] && <Aviso tono="error">{ERROR[sp.error]}</Aviso>}
        </>
      )}
      secciones={[
        {
          id: 'perfil', titulo: t('cfg.tu_perfil'),
          contenido: (
            <div className="rv-mp__pila">
              <AvatarUploader nombre={s.nombre ?? 'Tú'} avatarUrl={s.avatarUrl} accion={subirAvatar} />

              <form action={actualizarNombre} className="rv-mp__pila rv-mp__separador">
                <CampoTexto etiqueta={t('llaves.nombre')} id="perfil-nombre" name="nombre" defaultValue={s.nombre ?? ''} required maxLength={80}
                  ayuda={t('cfg.es_el_nombre_con_el_que')} />
                <div><Boton type="submit" variante="primary" tamano="sm">{t('cfg.guardar_nombre')}</Boton></div>
              </form>

              <dl className="rv-mp__datos rv-mp__separador">
                <div>
                  <dt>{t('cfg.correo')}</dt>
                  <dd>{correoFalloLectura ? t('cfg.no_se_pudo_leer') : (fila?.email as string) ?? '—'}</dd>
                </div>
                <div>
                  <dt>Rol</dt>
                  <dd>{ROL_LABEL[s.rol as RolAppUser] ?? s.rol}</dd>
                </div>
              </dl>
              <p className="rv-mp__nota">{t('cfg.correo_y_rol_no_se_editan')}</p>
            </div>
          ),
        },
        {
          // SEGURIDAD: segundo factor TOTP (fase 7 enterprise). La política es incremental: inscribirlo es OPTAR por que las acciones sensibles exijan AAL2 (lib/auth/mfa.ts).
          id: 'mfa', titulo: t('cfg.seguridad_segundo_factor'),
          estado: { texto: mfa.inscrito ? t('e26.perfil_mfa_activo') : t('e26.perfil_mfa_inactivo'), tono: mfa.inscrito ? 'ok' : 'neutral' },
          contenido: mfa.inscrito ? (
            <div className="rv-mp__pila">
              <p className="rv-mp__texto">{t('cfg.activo_las_acciones_sensibles_exigen_el')}</p>
              <form action={verificarMfa} className="rv-mp__linea">
                <input type="hidden" name="factorId" value={mfa.factorId ?? ''} />
                <CampoTexto etiqueta={t('cfg.codigo_de_6_digitos')} etiquetaOculta name="codigo" inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="000000" required
                  className="rv-mp__codigo" claseControl="tabular" />
                <Boton type="submit">{t('cfg.verificar_sesion')}</Boton>
              </form>
              <form action={quitarMfa} className="rv-mp__linea">
                <input type="hidden" name="factorId" value={mfa.factorId ?? ''} />
                <CampoTexto etiqueta={t('cfg.codigo_para_quitar_el_factor')} etiquetaOculta name="codigo" inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder={t('cfg.codigo')} required
                  className="rv-mp__codigo-corto" claseControl="tabular" />
                <Boton type="submit" variante="danger" tamano="sm">{t('cfg.quitar_el_factor_exige_el_codigo')}</Boton>
              </form>
            </div>
          ) : qr ? (
            <div className="rv-mp__pila">
              <p className="rv-mp__texto">{t('cfg.escanea_el_codigo_con_tu_app')}</p>
              {/* El SVG lo genera Supabase en el enroll — sin librerías. */}
              <img src={qr.svg} alt={t('cfg.codigo_qr_del_segundo_factor')} width={168} height={168} className="rv-mp__qr" />
              <p className="rv-mp__nota">{t('cfg.si_no_puedes_escanear')}{' '}{qr.secreto}</p>
              <form action={verificarMfa} className="rv-mp__linea">
                <input type="hidden" name="factorId" value={qr.factorId} />
                <CampoTexto etiqueta={t('cfg.codigo_de_6_digitos')} etiquetaOculta name="codigo" inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="000000" required
                  className="rv-mp__codigo" claseControl="tabular" />
                <Boton type="submit" variante="primary">{t('cfg.activar')}</Boton>
              </form>
            </div>
          ) : (
            <div className="rv-mp__pila">
              <p className="rv-mp__texto">{t('cfg.un_codigo_de_tu_telefono_ademas')}</p>
              <div><BotonEnlace href={volverAMiPerfil(sufijo, 'mfa=inscribir')} tamano="sm">{t('cfg.activar_segundo_factor')}</BotonEnlace></div>
            </div>
          ),
        },
        {
          // SEGURIDAD: sesiones activas (FASE 1 · SEG-SESIONES). Cierra TODAS mis sesiones a la vez, en cualquier dispositivo — no solo esta pestaña.
          id: 'sesiones', titulo: t('cfg.seguridad_sesiones_activas'),
          contenido: (
            <div className="rv-mp__pila">
              <p className="rv-mp__texto">{t('cfg.si_crees_que_alguien_mas_entro')}</p>
              <form action={cerrarTodasMisSesiones}>
                <Boton type="submit" variante="danger" tamano="sm">{t('cfg.cerrar_sesion_en_todos_los_dispositivos')}</Boton>
              </form>
            </div>
          ),
        },
        {
          // SEGURIDAD: mis clientes MCP (H3, 29-ago-2026). Lo que Claude o ChatGPT pueden leer de la flota EN MI NOMBRE; vive junto al segundo factor porque es la misma pregunta: ¿qué puede entrar a mi cuenta hoy?
          id: 'mcp', titulo: t('cfg.seguridad_clientes_mcp_conectados'),
          contenido: mcp === null ? (
            <p className="rv-mp__texto" data-tono="bad">{t('cfg.no_pude_leer_tus_conexiones_mcp')}</p>
          ) : mcp.length === 0 ? (
            <p className="rv-mp__texto">{t('cfg.no_tienes_ningun_cliente_mcp_conectado')}</p>
          ) : (
            <div className="rv-mp__pila">
              <p className="rv-mp__texto">{rico(t('cfg.estos_clientes_strong_leen_strong_nunca'), { strong: (c) => <strong>{c}</strong> })}</p>
              <TablaClientesMcp t={t} clientes={mcp} />
              <form action={cortarMisSesionesMcp}>
                {/* Lo que la función de la 0265 hace, dicho tal cual: corta TODOS, no uno. Un rótulo más fino prometería una precisión que la revocación por usuario no tiene. */}
                <Boton type="submit" variante="danger" tamano="sm">{mcp.length === 1 ? t('cfg.cortar_este_acceso_no_hay_deshacer') : t('cfg.cortar_los_n_accesos_no_hay', { n: mcp.length })}</Boton>
              </form>
            </div>
          ),
        },
      ]}
    />
  );
}
