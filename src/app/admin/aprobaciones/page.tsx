import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import {
  bandejaPendiente, aprobadasSinEnviar, ultimasResueltas,
  rebotesRecientes, correosSuprimidos,
  aprobarPieza, rechazarPieza, enviarPiezaPorCorreo, liberarEnvioAmbiguo,
  type PiezaEnCola,
} from '@/lib/likida/agentes/cola';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { fechaHoraMx } from '@/lib/formato';
import {
  contarVencidas, vaciarVencidas, leerResumenBandeja, normalizarParametros,
} from '@/lib/admin/cola-aprobacion';
import { ahoraMs } from '@/lib/saludo';
import { Aviso, StatusChip, Tarjeta } from '../../ui-v2/componentes';
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { FormaPieza, FormaEnvio, FormaLiberarAmbiguo, type ResultadoPieza } from './forma-pieza';
import { RebotesYBajas } from './rebotes';
import { LimpiezaLote, type ResultadoConteo, type ResultadoVaciado } from './lote';
import { BarraVistasAprobaciones, PanelesAprobaciones, ProveedorVistas, type VistaAprobaciones } from './vistas';
import { leerEsperadas, leerParametrosLote } from './lote-parametros';
import '../bandeja.css';

import { getT } from '@/lib/i18n/servidor';
export const dynamic = 'force-dynamic';

const VISTAS: readonly VistaAprobaciones[] = ['aprobar', 'enviar', 'historial'];

export default async function PaginaAprobaciones({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const { t } = await getT('admin_inicio');
  await requireSuperadmin();
  const sp = (await searchParams) ?? {};
  const inicial: VistaAprobaciones = VISTAS.find((v) => v === sp.vista) ?? 'aprobar';

  // Cada lectura cae POR SU LADO: la urgente caída no esconde la normal ni
  // al revés, y "no se pudo leer" jamás se pinta como "no hay nada".
  const [urgente, normal, porEnviar, resueltas, rebotes, suprimidos, estadoBandeja] = await Promise.all([
    bandejaPendiente('urgente').then((p) => ({ ok: p as PiezaEnCola[] | null, error: null as string | null })).catch((e) => ({ ok: null, error: String(e instanceof Error ? e.message : e) })),
    bandejaPendiente('normal').then((p) => ({ ok: p as PiezaEnCola[] | null, error: null as string | null })).catch((e) => ({ ok: null, error: String(e instanceof Error ? e.message : e) })),
    aprobadasSinEnviar().catch(() => null),
    ultimasResueltas(8).catch(() => null),
    // `null` = no se pudo leer, y la sección lo DICE. Aplastarlo a lista
    // vacía diría «no hay rebotes», que es la conclusión tranquilizadora
    // que hace que nadie vuelva a mirar.
    rebotesRecientes(15).catch(() => null),
    correosSuprimidos(25).catch(() => null),
    leerResumenBandeja(ahoraMs()),
  ]);

  async function accionResolver(_previo: ResultadoPieza, fd: FormData): Promise<ResultadoPieza> {
    'use server';
  const { t } = await getT('admin_inicio');
    const s = await requireSuperadmin();
    const id = String(fd.get('pieza') ?? '');
    const operacion = String(fd.get('operacion') ?? '');
    try {
      if (operacion === 'aprobar') {
        const edicion = String(fd.get('cuerpoEditado') ?? '').trim();
        // A37-S05-08: con el modo edición activo el campo SÍ viaja; si llega vacío NO se aprueba el
        // borrador original (el operador pudo borrarlo para neutralizar el correo): se rechaza con error.
        if (fd.has('cuerpoEditado') && !edicion) {
          return { error: t('aprobaciones.el_cuerpo_editado_esta') };
        }
        await aprobarPieza(id, s.userId, edicion || undefined);
        revalidatePath('/admin/aprobaciones');
        return { ok: edicion ? t('aprobaciones.aprobada_con_tu_edicion') : t('aprobaciones.aprobada_tal_cual_el') };
      }
      if (operacion === 'rechazar') {
        await rechazarPieza(id, s.userId, String(fd.get('motivo') ?? ''));
        revalidatePath('/admin/aprobaciones');
        return { ok: t('aprobaciones.rechazada_con_motivo_quedo') };
      }
      return { error: t('aprobaciones.esa_operacion_no_existe') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, operacion === 'rechazar' ? 'rechazar la pieza' : 'aprobar la pieza') };
    }
  }

  async function accionEnviar(_previo: ResultadoPieza, fd: FormData): Promise<ResultadoPieza> {
    'use server';
  const { t } = await getT('admin_inicio');
    const s = await requireSuperadmin();
    try {
      const r = await enviarPiezaPorCorreo(String(fd.get('pieza') ?? ''), s.userId);
      revalidatePath('/admin/aprobaciones');
      return { ok: t('aprobaciones.enviada_a_resend_la', { destinatario: r.destinatario, providerId: r.providerId }) };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'enviar la pieza') };
    }
  }

  // A36-R11-01: salida del callejón del envío ambiguo. Quien aprieta el botón
  // afirma que verificó en Resend que el correo NO salió.
  async function accionLiberar(_previo: ResultadoPieza, fd: FormData): Promise<ResultadoPieza> {
    'use server';
  const { t } = await getT('admin_inicio');
    const s = await requireSuperadmin();
    try {
      const r = await liberarEnvioAmbiguo(String(fd.get('pieza') ?? ''), s.userId);
      revalidatePath('/admin/aprobaciones');
      return r.reservaLiberada
        ? { ok: t('aprobaciones.liberada_vuelve_a_aprobadas') }
        : { ok: t('aprobaciones.liberada_pero_no_se') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'liberar el envío ambiguo') };
    }
  }

  // ── Vaciado por lotes (auditoría admin, P0). Contar NO escribe; ejecutar re-cuenta y se niega si la cifra cambió. ──
  async function accionContarLote(_previo: ResultadoConteo, fd: FormData): Promise<ResultadoConteo> {
    'use server';
    await requireSuperadmin();
    try {
      const params = leerParametrosLote(fd);
      normalizarParametros(params); // rechaza 0 días, límites absurdos y tipos mal formados antes de tocar la base
      const resumen = await contarVencidas(params);
      return {
        resumen,
        entrada: { dias: String(fd.get('dias') ?? ''), limite: String(fd.get('limite') ?? ''), tipos: String(fd.get('tipos') ?? '') },
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'contar las piezas vencidas') };
    }
  }

  async function accionVaciarLote(_previo: ResultadoVaciado, fd: FormData): Promise<ResultadoVaciado> {
    'use server';
  const { t } = await getT('admin_inicio');
    const s = await requireSuperadmin();
    try {
      const params = leerParametrosLote(fd);
      normalizarParametros(params);
      const esperadas = leerEsperadas(fd);
      if (esperadas === null) return { error: t('aprobaciones.falta_la_cifra_contada') };
      // Re-cuenta en el servidor: si la bandeja cambió desde que se contó, NO se ejecuta a ciegas.
      const ahora = await contarVencidas(params);
      if (ahora.enElLote !== esperadas) {
        return { error: t('aprobaciones.la_bandeja_cambio_contaste', { esperadas, enElLote: ahora.enElLote }) };
      }
      const r = await vaciarVencidas(s.userId, { ...params, dryRun: false });
      revalidatePath('/admin/aprobaciones');
      const resto = r.restantes > 0 ? t('aprobaciones.quedan_vencidas_para_otro', { restantes: r.restantes }) : '';
      const bitacora = r.bitacoraEscrita === false ? t('aprobaciones.ojo_el_lote_se') : t('aprobaciones.quedo_firmado_en_la');
      return { ok: t('aprobaciones.archivadas_piezas_vencidas', { resueltas: r.resueltas, resto, bitacora }) };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'archivar las piezas vencidas') };
    }
  }

  const decidir = urgente.ok !== null && normal.ok !== null ? urgente.ok.length + normal.ok.length : null;

  function bandeja(titulo: string, r: { ok: PiezaEnCola[] | null; error: string | null }, urgenteBandeja: boolean) {
    return (
      <Tarjeta
        titulo={r.ok !== null ? `${titulo} (${r.ok.length})` : titulo}
        estado={r.error !== null ? 'error' : r.ok !== null && r.ok.length === 0 ? 'vacio' : 'ok'}
        mensaje={r.error !== null
          ? t('aprobaciones.no_se_pudo_leer')
          : urgenteBandeja ? t('aprobaciones.nada_urgente_esperando') : t('aprobaciones.nada_pendiente')}
        detalle={urgenteBandeja
          ? t('aprobaciones.asi_debe_verse_casi')
          : t('aprobaciones.las_piezas_llegan_aqui')}
        acciones={urgenteBandeja ? <StatusChip tono="warn">{t('aprobaciones.sla_en_minutos')}</StatusChip> : undefined}
      >
        <div className="bj-cola">
          {r.ok?.map((p) => <FormaPieza key={p.id} pieza={p} accion={accionResolver} />)}
        </div>
      </Tarjeta>
    );
  }

  const porAprobar = (
    <>
      {estadoBandeja?.frenaAlRunner && (
        <Aviso tono="error" titulo={t('aprobaciones.la_bandeja_esta_frenando')}>
          Con {estadoBandeja.pendientes}  {t('aprobaciones.piezas_pendientes_el_runner')}
        </Aviso>
      )}
      {bandeja(t('aprobaciones.urgente_respuesta_a_ads'), urgente, true)}
      {bandeja(t('aprobaciones.normal_prospeccion_y_contenido'), normal, false)}
      <LimpiezaLote contar={accionContarLote} vaciar={accionVaciarLote} bandeja={estadoBandeja} />
    </>
  );

  // ── LA COLA DE SALIDA: aprobada ≠ enviada ────────────────────────────────
  // El envío es un click APARTE con claim anti-doble-click, y sale la versión final (la edición humana manda). Resend ACEPTA ≠ el
  // prospecto RECIBIÓ — el id del proveedor es la prueba de salida; delivery/bounce es la capa siguiente, declarada.
  const paraEnviar = (
    <Tarjeta
      titulo={porEnviar !== null ? t('aprobaciones.aprobadas_por_enviar', { length: porEnviar.length }) : t('aprobaciones.aprobadas_por_enviar_2')}
      estado={porEnviar === null ? 'error' : porEnviar.length === 0 ? 'vacio' : 'ok'}
      mensaje={porEnviar === null ? t('aprobaciones.no_se_pudo_leer_2') : t('aprobaciones.nada_aprobado_esperando_envio')}
      detalle={t('aprobaciones.las_piezas_aprobadas_que')}
    >
      <div className="bj-cola">
        {porEnviar?.map((p) => <FormaEnvio key={p.id} pieza={p} accion={accionEnviar} />)}
      </div>
    </Tarjeta>
  );

  const historial = (
    <>
      <Tarjeta
        titulo={t('aprobaciones.ultimas_resueltas')}
        estado={resueltas === null ? 'error' : resueltas.length === 0 ? 'vacio' : 'ok'}
        mensaje={resueltas === null ? t('aprobaciones.no_se_pudo_leer_3') : t('aprobaciones.aun_no_se_resuelve')}
      >
        <div className="bj-cola">
          {resueltas?.map((p) => (
            <div key={p.id} className="bj-item__fila">
              <StatusChip tono={p.estado === 'aprobado' ? 'ok' : 'bad'}>
                {p.estado === 'aprobado' ? (p.cuerpoFinal ? t('aprobaciones.aprobada_con_edicion') : t('aprobaciones.aprobada')) : 'Rechazada'}
              </StatusChip>
              <span>{p.titulo}</span>
              <span className="bj-item__meta">{p.agente}</span>
              {p.resueltoPorEmail && <span className="bj-item__meta">por {p.resueltoPorEmail}</span>}
              {p.enviadoEn && (
                p.providerMessageId
                  ? <span className="bj-sub" data-tono="ok">enviada {fechaHoraMx(p.enviadoEn)}</span>
                  // La inconsistencia VISIBLE: enviada estampada sin prueba del proveedor (el proceso murió entre envío y guardado).
                  : <span className="bj-sub" data-tono="warn">{t('aprobaciones.enviada_sin_prueba_del')}</span>
              )}
              {/* A36-R11-01: el motivo («AMBIGUO… verificar en Resend») se ve también con enviado_en puesto, y hay salida:
                  confirmar que NO salió y reintentar. */}
              {p.enviadoEn && !p.providerMessageId && p.envioError && (
                <span className="bj-sub" data-tono="warn">{p.envioError}</span>
              )}
              {p.enviadoEn && !p.providerMessageId && p.envioError?.startsWith('AMBIGUO') && (
                <FormaLiberarAmbiguo pieza={p} accion={accionLiberar} />
              )}
              {!p.enviadoEn && p.envioError && <span className="bj-sub" data-tono="bad">{t('aprobaciones.envio_fallo_reintentable')}</span>}
            </div>
          ))}
        </div>
      </Tarjeta>
      {/* REBOTES Y QUEJAS: el webhook de Resend (0124) llevaba meses escribiendo `entrega_estado` y llenando `correo_suprimido` (0217)
          y NINGÚN .tsx lo pintaba. Aquí porque es la misma tabla, el mismo operador y la misma sesión: quien aprueba lo que sale es
          quien tiene que ver qué no llegó. Sin botón de «reactivar»: suprimir es para siempre (0217). */}
      <RebotesYBajas rebotes={rebotes} suprimidos={suprimidos} t={t} />
    </>
  );

  const conteos = {
    aprobar: urgente.ok !== null && normal.ok !== null ? urgente.ok.length + normal.ok.length : null,
    enviar: porEnviar !== null ? porEnviar.length : null,
  };

  return (
    <ProveedorVistas inicial={inicial}>
    <EsqueletoTablaMaestra
      filtros={<BarraVistasAprobaciones conteos={conteos} />}
      titulo={t('aprobaciones.aprobaciones')}
      apoyo={t('aprobaciones.lo_que_los_agentes')}
      avisos={<Aviso tono="info">{t('aprobaciones.el_candado_es_de')}</Aviso>}
      etiquetaCifras={t('aprobaciones.kpi_etiqueta')}
      cifras={[
        decidir === null
          ? { etiqueta: t('aprobaciones.kpi_por_decidir'), valor: null, estado: 'error', reintentar: true }
          : {
            etiqueta: t('aprobaciones.kpi_por_decidir'), valor: decidir, formato: 'entero',
            segmentos: [{ etiqueta: t('aprobaciones.kpi_urgentes'), valor: urgente.ok!.length }, { etiqueta: t('aprobaciones.kpi_normales'), valor: normal.ok!.length }],
            tono: urgente.ok!.length > 0 ? 'warn' : undefined,
            nota: urgente.ok!.length > 0 ? t('aprobaciones.kpi_n_urgentes', { n: urgente.ok!.length }) : undefined,
          },
        porEnviar === null
          ? { etiqueta: t('aprobaciones.kpi_por_enviar'), valor: null, estado: 'error', reintentar: true }
          : { etiqueta: t('aprobaciones.kpi_por_enviar'), valor: porEnviar.length, formato: 'entero' },
        estadoBandeja === null || estadoBandeja === undefined || estadoBandeja.diasMasVieja === null
          ? { etiqueta: t('aprobaciones.kpi_mas_vieja'), valor: null, estado: estadoBandeja ? 'vacio' : 'error', reintentar: true, mensaje: estadoBandeja ? t('aprobaciones.kpi_sin_pendientes') : undefined }
          : { etiqueta: t('aprobaciones.kpi_mas_vieja'), valor: t('aprobaciones.kpi_dias', { n: estadoBandeja.diasMasVieja }), tono: estadoBandeja.diasMasVieja >= estadoBandeja.diasVencimiento ? 'warn' : undefined },
        estadoBandeja === null || estadoBandeja === undefined
          ? { etiqueta: t('aprobaciones.kpi_bandeja'), valor: null, estado: 'error', reintentar: true }
          : { etiqueta: t('aprobaciones.kpi_bandeja'), valor: estadoBandeja.frenaAlRunner ? t('aprobaciones.kpi_frena') : t('aprobaciones.kpi_libre'), tono: estadoBandeja.frenaAlRunner ? 'bad' : 'ok' },
      ]}
    >
      <PanelesAprobaciones conteos={conteos} porAprobar={porAprobar} porEnviar={paraEnviar} historial={historial} />
    </EsqueletoTablaMaestra>
    </ProveedorVistas>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_inicio');
  return { title: t('aprobaciones.aprobaciones') };
}
