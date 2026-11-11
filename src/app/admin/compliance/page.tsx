import { uniformes } from '@/app/admin/cifras-uniformes';
import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { resolverSolicitudArco } from '@/lib/likida/repo';
import { fechaMx, hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { traerTodo, conteo } from '@/lib/likida/pg';
import { logger } from '@/lib/logger';
import { getSolicitudesArcoPendientes } from '@/lib/admin/escalaciones';
import { agregarDiasHabiles } from '@/lib/admin/dias-habiles';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { BotonEnlace, CampoTextarea, Disclosure, EstadoError, StatusChip, Tarjeta, type TonoEstado } from '../../ui-v2/componentes';
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import { BarraVistas, PanelesVistas, ProveedorVistas, type OpcionVista } from '../aprobaciones/vistas';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import '../sistema.css';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { rico } from '@/lib/i18n/rico';

export const dynamic = 'force-dynamic';

const etiquetaTipo = (t: TSistema = T_SISTEMA_ES): Record<string, string> => ({
  acceso: t('compliance.acceso'), rectificacion: t('compliance.rectificacion'), cancelacion: t('compliance.cancelacion'), oposicion: t('compliance.oposicion'),
});
/** El estado de la solicitud como chip: resuelta en verde, pendiente en ámbar, improcedente en neutro. Un estado fuera del catálogo se
 *  pinta crudo en neutro: visible, no roto. */
const chipArco = (t: TSistema = T_SISTEMA_ES): Record<string, { tono: TonoEstado; etiqueta: string }> => ({
  recibida: { tono: 'warn', etiqueta: t('compliance.recibida') },
  en_proceso: { tono: 'warn', etiqueta: t('compliance.en_proceso') },
  resuelta: { tono: 'ok', etiqueta: t('compliance.resuelta') },
  improcedente: { tono: 'neutral', etiqueta: t('compliance.improcedente') },
});

/**
 * Compliance y datos — la flota ve sus solicitudes ARCO (registradas cuando un operador escribe PRIVACIDAD por WhatsApp) y responde la
 * que le toca. AUDITORÍA 14: las solicitudes se registraban pero nadie podía verlas; la responsable obligada a contestar en 20 días
 * hábiles (LFPDPPP art. 31) estaba ciega.
 *
 * F7: la pantalla se rehízo con ui-v2 SIN tocar la lógica de ARCO. Lo pendiente va en tarjetas con su formulario DENTRO (cada
 * respuesta se envía tal cual al titular), lo ya resuelto en una tabla paginada. Una lectura caída se dice; no se pinta como «sin
 * solicitudes».
 */
export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const { t, idioma } = await getT('admin_sistema');
  // A39-S05-01/S06-01: puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  async function accionResolver(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    await requireSuperadmin();
    const solicitudId = String(fd.get('solicitudId') ?? '');
    const resolucion = String(fd.get('resolucion') ?? '').trim();
    if (!solicitudId) return { error: t('compliance.falta_la_solicitud') };
    if (resolucion.length < 5) return { error: t('compliance.escribe_la_respuesta_que_se_entrega') };
    // El tenant: la solicitud se resuelve bajo la flota responsable. Se busca
    // el tenant de la solicitud para no depender del orden del listado.
    //
    // ADM-10 (auditoría 24, MEDIO): el `error` de esta lectura se descartaba
    // — una base caída y una solicitud inexistente se pintaban con el MISMO
    // mensaje ("La solicitud no existe."), que es "fallar cerrado" pero
    // mintiendo sobre el porqué: quien lo lee busca la solicitud a mano y no
    // la encuentra porque la lectura ni siquiera corrió.
    const { data: sol, error: errSol } = await supabaseAdmin().from('solicitud_arco').select('tenant_id').eq('id', solicitudId).maybeSingle();
    if (errSol) return { error: t('compliance.no_se_pudo_leer_la_solicitud', { message: errSol.message }) };
    if (!sol?.tenant_id) return { error: t('compliance.la_solicitud_no_existe') };
    let r: { enviada: boolean; error?: string };
    try {
      r = await resolverSolicitudArco(sol.tenant_id as string, solicitudId, resolucion);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'resolver la solicitud', idioma) };
    }
    revalidatePath('/admin/compliance');
    // A37-S05-04: el resultado del envío NO se descarta — la pantalla no
    // afirma un WhatsApp que no salió (mismo texto que /dashboard/arco).
    return r.enviada
      ? { ok: t('compliance.solicitud_resuelta_y_la_respuesta_se') }
      : { ok: t('compliance.solicitud_resuelta_la_respuesta_no_se', { v: r.error ? ` (${r.error})` : '' }) };
  }

  let lectura: { solicitudes: SolicitudArcoPanel[]; pendientesVencen: number } | null;
  try {
    lectura = await datosDeCompliance();
  } catch (e) {
    logger.error('admin.compliance', { err: e instanceof Error ? e.message : String(e) });
    lectura = null;
  }
  const solicitudes = lectura?.solicitudes ?? [];
  // Lo más próximo a vencer primero (el plazo legal es lo que ordena el trabajo).
  const pendientes = solicitudes.filter((s) => s.estado === 'recibida' || s.estado === 'en_proceso').sort((a, b) => a.venceEn.localeCompare(b.venceEn));
  const resueltas = solicitudes.filter((s) => s.estado !== 'recibida' && s.estado !== 'en_proceso');
  // AUDITORÍA 15, CRÍTICO: la pantalla vive en /admin (superadmin), cuyo tenant de sesión es null — filtrar por tenant dejaba la
  // pantalla SIEMPRE vacía. El superadmin ve TODAS las flotas, con la flota en cada solicitud.
  const hoy = hoyMx(new Date(ahoraMs()));
  const pagina = Math.max(1, Number.parseInt((await searchParams)?.pagina ?? '1', 10) || 1);

  const columnas: ColumnaTabla<SolicitudArcoPanel>[] = [
    { id: 'recibida', titulo: t('compliance.recibida'), corta: true, celda: (s) => fechaMx(s.recibidaEn, idioma) },
    { id: 'flota', titulo: t('observabilidad.flota'), principal: true, celda: (s) => s.flotaNombre },
    { id: 'derecho', titulo: t('compliance.derecho'), celda: (s) => etiquetaTipo(t)[s.tipo] ?? s.tipo },
    { id: 'estado', titulo: t('salud_sistema.estado'), celda: (s) => { const c = chipArco(t)[s.estado] ?? { tono: 'neutral' as TonoEstado, etiqueta: s.estado }; return <StatusChip tono={c.tono}>{c.etiqueta}</StatusChip>; } },
    { id: 'resolucion', titulo: t('compliance.resolucion'), celda: (s) => s.resolucion ?? '—' },
  ];

  // Las obligaciones salen de lo que la pantalla PUEDE medir con las solicitudes leídas; lo que no tiene flujo construido dice «Sin medición».
  const vencidasN = pendientes.filter((s) => s.venceEn < hoy).length;
  const ejecutables = pendientes.filter((s) => s.tipo === 'cancelacion' || s.tipo === 'oposicion').length;
  const obligaciones: FilaObligacion[] = [
    { id: 'plazo', obligacion: t('compliance.ob_plazo'), base: t('compliance.ob_plazo_base'), medida: lectura !== null, tono: lectura === null ? 'neutral' : vencidasN > 0 ? 'bad' : 'ok', estado: lectura === null ? t('compliance.ob_sin_lectura') : vencidasN > 0 ? t('compliance.ob_vencidas', { n: vencidasN }) : t('compliance.ob_al_dia'), detalle: t('compliance.ob_plazo_detalle') },
    { id: 'ejecucion', obligacion: t('compliance.ob_ejecucion'), base: t('compliance.ob_ejecucion_base'), medida: lectura !== null, tono: lectura === null ? 'neutral' : ejecutables > 0 ? 'warn' : 'ok', estado: lectura === null ? t('compliance.ob_sin_lectura') : ejecutables > 0 ? t('compliance.ob_por_ejecutar', { n: ejecutables }) : t('compliance.ob_al_dia'), detalle: t('compliance.ob_ejecucion_detalle') },
    { id: 'retencion', obligacion: t('compliance.ob_retencion'), base: 'CFF art. 30', medida: false, tono: 'neutral', estado: t('compliance.ob_sin_medicion'), detalle: t('compliance.ob_retencion_detalle') },
    { id: 'avisos', obligacion: t('compliance.ob_avisos'), base: 'LFPDPPP', medida: false, tono: 'neutral', estado: t('compliance.ob_sin_medicion'), detalle: t('compliance.ob_avisos_detalle') },
  ];
  const columnasObligaciones: ColumnaTabla<FilaObligacion>[] = [
    { id: 'obligacion', titulo: t('compliance.ob_col_obligacion'), principal: true, celda: (o) => o.obligacion },
    { id: 'base', titulo: t('compliance.ob_col_base'), corta: true, celda: (o) => o.base },
    { id: 'estado', titulo: t('salud_sistema.estado'), celda: (o) => <StatusChip tono={o.tono}>{o.estado}</StatusChip> },
    { id: 'detalle', titulo: t('compliance.detalle'), celda: (o) => o.detalle },
  ];
  const panelObligaciones = (
    <>
      <TablaLista<FilaObligacion> etiqueta={t('compliance.ob_etiqueta')} columnas={columnasObligaciones} filas={obligaciones} idFila={(o) => o.id} base="/admin/compliance" params={{}} />
      <Disclosure titulo={t('compliance.lo_que_aun_no_existe_aqui')} resumen={t('compliance.retencion_de_comprobantes_y_avisos_por')}>
        <p className="adm-sis-nota">{t('compliance.la_retencion_de_comprobantes_cff_art')}</p>
      </Disclosure>
    </>
  );

  const opcionesVistas: readonly OpcionVista<VistaCompliance>[] = [
    { valor: 'pendientes', etiqueta: t('compliance.por_responder'), conteo: pendientes.length },
    { valor: 'resueltas', etiqueta: t('compliance.ya_resueltas'), conteo: resueltas.length },
    { valor: 'obligaciones', etiqueta: t('compliance.ob_pestana'), conteo: obligaciones.length },
  ];

  return (
    <ProveedorVistas inicial="pendientes">
    <EsqueletoTablaMaestra
      filtros={lectura === null ? undefined : <BarraVistas<VistaCompliance> etiqueta={t('compliance.vistas')} opciones={opcionesVistas} />}
      titulo={t('compliance.seguridad_y_datos')}
      apoyo={t('compliance.las_solicitudes_de_derechos_de_los')}
      etiquetaCifras={t('compliance.solicitudes_arco')}
      cifras={uniformes(lectura === null ? [
        { etiqueta: t('compliance.por_responder'), valor: null, estado: 'error', mensaje: t('compliance.no_se_pudieron_leer_las_solicitudes'), reintentar: true },
        { etiqueta: t('compliance.vencen_pronto'), valor: null, estado: 'error', mensaje: t('compliance.no_se_pudieron_leer_las_solicitudes'), reintentar: true },
        { etiqueta: t('compliance.kpi_resueltas'), valor: null, estado: 'error', mensaje: t('compliance.no_se_pudieron_leer_las_solicitudes'), reintentar: true },
        { etiqueta: t('compliance.kpi_obligaciones'), valor: null, estado: 'error', mensaje: t('compliance.no_se_pudieron_leer_las_solicitudes'), reintentar: true },
      ] : solicitudes.length === 0 ? [
        /* Sin una sola solicitud no hay qué medir: la pista punteada lo dice, no un cero que parezca medición. */
        { etiqueta: t('compliance.por_responder'), valor: null, estado: 'vacio', mensaje: t('compliance.kpi_sin_solicitudes') },
        { etiqueta: t('compliance.vencen_pronto'), valor: null, estado: 'vacio', mensaje: t('compliance.kpi_sin_solicitudes') },
        { etiqueta: t('compliance.kpi_resueltas'), valor: null, estado: 'vacio', mensaje: t('compliance.kpi_sin_solicitudes') },
        { etiqueta: t('compliance.kpi_obligaciones'), valor: `${obligaciones.filter((o) => o.medida).length} / ${obligaciones.length}`, nota: t('compliance.kpi_obligaciones_nota') },
      ] : [
        { etiqueta: t('compliance.por_responder'), valor: pendientes.length, formato: 'entero', tono: pendientes.length > 0 ? 'warn' : undefined, nota: t('compliance.recibidas_o_en_proceso_de_todas') },
        { etiqueta: t('compliance.vencen_pronto'), valor: lectura.pendientesVencen, formato: 'entero', tono: lectura.pendientesVencen > 0 ? 'bad' : undefined, nota: t('compliance.plazo_en_5_dias_habiles_o') },
        { etiqueta: t('compliance.kpi_resueltas'), valor: resueltas.length, formato: 'entero' },
        { etiqueta: t('compliance.kpi_obligaciones'), valor: `${obligaciones.filter((o) => o.medida).length} / ${obligaciones.length}`, nota: t('compliance.kpi_obligaciones_nota') },
      ])}
    >

      {lectura === null ? (
        <EstadoError reintentar>{t('compliance.no_se_pudieron_leer_las_solicitudes_2')}</EstadoError>
      ) : (
        <PanelesVistas<VistaCompliance>
          opciones={opcionesVistas}
          paneles={{
            pendientes: solicitudes.length === 0 ? (
              <Tarjeta titulo={t('compliance.solicitudes_arco')} estado="vacio" mensaje={t('compliance.ninguna_solicitud_arco_registrada')}
                detalle={t('compliance.cuando_un_operador_escribe_privacidad_por')} />
            ) : (
          <section className="adm-sis-bloque" aria-label={t('compliance.por_responder')}>
            {pendientes.length === 0 ? (
              <Tarjeta titulo={t('compliance.solicitudes_arco')} estado="vacio" mensaje={t('compliance.nada_por_responder')} detalle={t('compliance.todas_las_solicitudes_registradas_ya_tienen')} />
            ) : pendientes.map((s) => {
              const chip = chipArco(t)[s.estado] ?? { tono: 'neutral' as TonoEstado, etiqueta: s.estado };
              const vencida = s.venceEn < hoy;
              return (
                <Tarjeta key={s.id} titulo={`${etiquetaTipo(t)[s.tipo] ?? s.tipo} · ${s.flotaNombre}`}
                  acciones={<><StatusChip tono={chip.tono}>{chip.etiqueta}</StatusChip>{vencida ? <StatusChip tono="bad">{t('compliance.vencida')}</StatusChip> : null}</>}>
                  <ul className="adm-sis-lista">
                    <li>{rico(t('compliance.e0_recibida_e0'), { e0: (c) => <span>{c}</span> })}<span>{fechaMx(s.recibidaEn, idioma)}</span></li>
                    <li>{rico(t('compliance.e0_vence_e0'), { e0: (c) => <span>{c}</span> })}<span>{fechaMx(s.venceEn, idioma)}</span></li>
                    <li>{rico(t('compliance.e0_titular_e0'), { e0: (c) => <span>{c}</span> })}<span>{s.operadorNombre ?? '—'}<span className="adm-sis-sub">{s.titularRef}</span></span></li>
                  </ul>
                  {s.tipo === 'cancelacion' || s.tipo === 'oposicion' ? (
                    // A37-S05-04: una cancelación se EJECUTA (anonimiza al titular) y una oposición lleva su propio trámite; ninguna se
                    // cierra con texto. La ejecución real vive en /dashboard/arco.
                    <div className="adm-sis-acciones">
                      <BotonEnlace href={`/dashboard/arco?tenant=${encodeURIComponent(s.tenantId)}`} variante="secondary" tamano="sm">
                        {s.tipo === 'cancelacion' ? t('compliance.ejecutar_cancelacion_en_la_bandeja_arco') : t('compliance.atender_la_oposicion_en_la_bandeja')}
                      </BotonEnlace>
                    </div>
                  ) : (
                    <FormaConAviso accion={accionResolver} boton={t('compliance.responder')} columnas="md:grid-cols-1">
                      <input type="hidden" name="solicitudId" value={s.id} />
                      <CampoTextarea etiqueta={t('compliance.respuesta_al_titular')} name="resolucion" obligatorio rows={3}
                        placeholder={t('compliance.que_se_resolvio_y_como')}
                        ayuda={t('compliance.se_envia_tal_cual_por_whatsapp')} />
                    </FormaConAviso>
                  )}
                </Tarjeta>
              );
            })}
          </section>
            ),
            resueltas: solicitudes.length === 0 ? (
              <Tarjeta titulo={t('compliance.solicitudes_arco')} estado="vacio" mensaje={t('compliance.aun_no_hay_resueltas')} detalle={t('compliance.aparecen_aqui_en_cuanto_se_contesta')} />
            ) : (
          <section className="adm-sis-bloque" aria-label={t('compliance.ya_resueltas')}>
            {resueltas.length === 0 ? (
              <Tarjeta titulo={t('compliance.solicitudes_arco')} estado="vacio" mensaje={t('compliance.aun_no_hay_resueltas')} detalle={t('compliance.aparecen_aqui_en_cuanto_se_contesta')} />
            ) : (
              <TablaLista<SolicitudArcoPanel>
                etiqueta={t('compliance.solicitudes_de_derechos_de_los_titulares')} columnas={columnas} filas={resueltas} idFila={(s) => s.id}
                base="/admin/compliance" params={{ pagina: pagina > 1 ? String(pagina) : undefined }} paginacion={{ tamano: 25 }}
              />
            )}
          </section>
            ),
            obligaciones: panelObligaciones,
          }}
        />
      )}
    </EsqueletoTablaMaestra>
    </ProveedorVistas>
  );
}

type VistaCompliance = 'pendientes' | 'resueltas' | 'obligaciones';
interface FilaObligacion { id: string; obligacion: string; base: string; medida: boolean; tono: TonoEstado; estado: string; detalle: string }

// ── Datos del server component (sin hooks de cliente) ───────────────────────
interface SolicitudArcoPanel {
  id: string; tipo: string; estado: string; titularRef: string; recibidaEn: string;
  venceEn: string; resueltaEn: string | null; resolucion: string | null;
  operadorNombre: string | null; flotaNombre: string; tenantId: string;
}

async function datosDeCompliance(): Promise<{ solicitudes: SolicitudArcoPanel[]; pendientesVencen: number }> {
  const { getSessionTenant } = await import('@/lib/auth/session');
  const s = await getSessionTenant();
  if (!s) return { solicitudes: [], pendientesVencen: 0 };
  // El superadmin ve TODAS las flotas (su tenant es null por diseño). La
  // columna de flota viene del join con tenant.
  const [solicitudes, pendientes] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => supabaseAdmin().from('solicitud_arco').select(
        'id, tipo, canal, estado, titular_ref, recibida_en, vence_en, resuelta_en, resolucion, tenant_id, operador:operador_id(nombre), flota:tenant_id(nombre)', conteo(d),
      ).order('recibida_en', { ascending: false }).order('id', { ascending: false }).range(d, h),
      'compliance.todas',
    ),
    // La MISMA lectura de pendientes que la bandeja de escalaciones —
    // extraída a lib/admin/escalaciones.ts para no contarlas dos veces con
    // dos consultas que puedan divergir.
    getSolicitudesArcoPendientes(),
  ]);
  const mapeadas = solicitudes.map((f) => ({
    id: f.id as string,
    tipo: f.tipo as string,
    canal: (f.canal as string | null) ?? 'whatsapp',
    estado: f.estado as string,
    titularRef: (f.titular_ref as string | null) ?? '',
    recibidaEn: f.recibida_en as string,
    venceEn: f.vence_en as string,
    resueltaEn: (f.resuelta_en as string | null) ?? null,
    resolucion: (f.resolucion as string | null) ?? null,
    operadorNombre: ((f.operador as { nombre?: string } | null)?.nombre) ?? null,
    flotaNombre: ((f.flota as { nombre?: string } | null)?.nombre) ?? '—',
    tenantId: (f.tenant_id as string | null) ?? '',
  }));
  // DAT-08 (auditoría prod): el corte era el día UTC. De 18:00 a 24:00 hora de
  // México el "dentro de 5 días" era en realidad dentro de 6, y el plazo del
  // art. 31 de la LFPDPPP se cuenta en días de México.
  const corte = agregarDiasHabiles(hoyMx(new Date(ahoraMs())), 5);
  const vence = pendientes.filter((p) => p.venceEn <= corte).length;
  return { solicitudes: mapeadas as SolicitudArcoPanel[], pendientesVencen: vence };
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('compliance.seguridad_y_datos') };
}
