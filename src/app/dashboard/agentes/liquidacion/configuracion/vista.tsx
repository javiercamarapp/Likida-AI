import { ArrowLeft, Save } from 'lucide-react';
import '../liquidacion.css';

// SOLO tipos y constantes: el repo importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { ConfigCorreo, CanalEntrega, Revisor } from '@/lib/likida/liquidacion_externa/repo_correo';
import { hoyMx } from '@/lib/formato';
import {
  AvisoCompacto, Boton, BotonEnlace, Casilla, CampoFecha, CampoSelect, CampoTexto, CampoTextarea, Fieldset, Icono, MarcoPagina, Tarjeta,
} from '@/app/ui-v2/componentes';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

type Accion = (fd: FormData) => Promise<void>;
export interface AccionesConfiguracion { guardar: Accion }

// ── Lectura y validación del formulario (pura; la usa la acción del servidor) ──────────────────────────────────────

export const canales = (tx: TAgentes = TR_ES.t): ReadonlyArray<{ valor: CanalEntrega; etiqueta: string }> => ([
  { valor: 'correo', etiqueta: tx('vigia.vista.correo') },
  { valor: 'ambos', etiqueta: tx('rest.correo_y_whatsapp') },
  { valor: 'whatsapp', etiqueta: 'WhatsApp' },
]);
export const CANALES = canales();
export const tiposOperador = (tx: TAgentes = TR_ES.t): ReadonlyArray<{ valor: string; etiqueta: string }> => ([
  { valor: 'foraneo', etiqueta: tx('rest.foraneos') },
  { valor: 'local', etiqueta: tx('rest.locales') },
  { valor: 'permisionario', etiqueta: tx('rest.permisionarios') },
]);
export const TIPOS_OPERADOR = tiposOperador();

/** Misma regla que las CHECK de la migración 0785. */
const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_CORREO = 254;
export const MAX_RH = 3;
export const MAX_REVISORES = 5;
const MAX_ETIQUETA = 80;
const MAX_CONCEPTOS_VIAJE = 20;
const MAX_RENOMBRES = 50;
const MAX_PROHIBIDOS = 50;

/** Una regla del contralor tal como se guarda en `renombres` (jsonb): texto literal ⇒ etiqueta. Sin regex libre del usuario. */
export interface RenombreGuardado { texto: string; patron: string; flags: 'i'; a: string; fusionar: false }

const escaparRegex = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineas = (v: FormDataEntryValue | null, separadores: RegExp): string[] =>
  String(v ?? '').split(separadores).map((x) => x.trim()).filter((x) => x !== '');
const unicos = (xs: string[]): string[] => {
  const vistos = new Set<string>();
  return xs.filter((x) => { const k = x.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; });
};

function esRenombre(x: unknown): x is RenombreGuardado {
  return !!x && typeof x === 'object' && typeof (x as RenombreGuardado).texto === 'string' && typeof (x as RenombreGuardado).a === 'string';
}

/** AAAA-MM-DD + n días (calendario UTC: la fecha ya es el día de México). */
export function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** «departamento: correo» por renglón (también «=», «,» o «;»), p. ej. «nomina: nomina@empresa.mx». */
export function leerRevisores(texto: string, tx: TAgentes = TR_ES.t): Revisor[] | string {
  const salida: Revisor[] = [];
  for (const [i, l] of lineas(texto, /\n+/).entries()) {
    const m = /^\s*([^\s:=,;]+)\s*[:=,;]\s*(\S+)\s*$/.exec(l);
    if (!m) return tx('rest.revisor_escribelo_como_departamento_correo_por', { v: i + 1 });
    const departamento = m[1].trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const correo = m[2].trim().toLowerCase();
    if (!/^[a-z_]{2,30}$/.test(departamento)) return tx('rest.revisor_el_departamento_va_en_letras', { v: i + 1 });
    if (correo.length > MAX_CORREO || !FORMA_CORREO.test(correo)) return tx('rest.revisor_el_correo_no_tiene_forma', { v: i + 1 });
    salida.push({ departamento, correo });
  }
  return salida;
}

export type ResultadoFormulario = { ok: true; config: ConfigCorreo } | { ok: false; error: string };

/**
 * Convierte lo que llega del formulario en una `ConfigCorreo` válida, o dice en lenguaje llano qué corregir.
 * Nada se activa por omisión: «activa» solo es true si la casilla viene marcada.
 */
export function leerFormularioConfig(fd: FormData, tx: TAgentes = TR_ES.t): ResultadoFormulario {
  const canal = String(fd.get('canal') ?? '');
  if (!canales(tx).some((c) => c.valor === canal)) return { ok: false, error: tx('rest.elige_como_se_entrega_el_desglose') };

  const correo = (campo: string, v: string): string | null => {
    const t = v.trim().toLowerCase();
    if (t === '') return null;
    if (t.length > MAX_CORREO || !FORMA_CORREO.test(t)) throw new Error(`${campo}: el correo no tiene forma de correo (revisa que lleve @ y dominio).`);
    return t;
  };

  try {
    const remitente = String(fd.get('remitenteNombre') ?? '').trim();
    if (remitente.length > MAX_ETIQUETA) return { ok: false, error: tx('rest.el_nombre_del_remitente_es_demasiado', { maxEtiqueta: MAX_ETIQUETA }) };

    const rhBruto = unicos(lineas(fd.get('rhCorreos'), /[\n,;]+/));
    if (rhBruto.length > MAX_RH) return { ok: false, error: `Puedes poner hasta ${MAX_RH} correos de RH; pusiste ${rhBruto.length}.` };
    const rhCorreos = rhBruto.map((c) => correo('Correo de RH', c)).filter((c): c is string => c !== null);

    const revisoresLeidos = leerRevisores(String(fd.get('revisores') ?? ''), tx);
    if (typeof revisoresLeidos === 'string') return { ok: false, error: revisoresLeidos };
    if (revisoresLeidos.length > MAX_REVISORES) return { ok: false, error: `Puedes poner hasta ${MAX_REVISORES} revisores; pusiste ${revisoresLeidos.length}.` };
    if (new Set(revisoresLeidos.map((r) => r.departamento)).size !== revisoresLeidos.length) return { ok: false, error: tx('rest.un_solo_revisor_por_departamento') };
    const primerMes = fd.get('primerMes') === 'on';
    const hastaTxt = String(fd.get('primerMesHasta') ?? '').trim();
    if (primerMes && revisoresLeidos.length === 0) return { ok: false, error: tx('rest.activaste_el_modo_primer_mes_pon') };
    if (primerMes && !/^\d{4}-\d{2}-\d{2}$/.test(hastaTxt)) return { ok: false, error: tx('rest.activaste_el_modo_primer_mes_indica') };
    const primerMesHasta = primerMes ? hastaTxt : null;

    // A1-01: fecha de corte. Vacía = sin corte (se envía todo lo que llegue); con fecha, lo anterior se guarda pero no se envía.
    const corteTxt = String(fd.get('noEnviarAntes') ?? '').trim();
    if (corteTxt !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(corteTxt) || Number.isNaN(Date.parse(`${corteTxt}T00:00:00Z`)))) {
      return { ok: false, error: tx('rest.la_fecha_de_corte_debe_ser') };
    }
    const noEnviarAntes = corteTxt === '' ? null : corteTxt;

    const agruparViaje = fd.get('agruparViaje') === 'on';
    const etiquetaViaje = String(fd.get('etiquetaViaje') ?? '').trim();
    if (agruparViaje && etiquetaViaje === '') return { ok: false, error: tx('rest.activaste_el_renglon_de_viaje_ponle') };
    if (etiquetaViaje.length > MAX_ETIQUETA) return { ok: false, error: tx('rest.la_etiqueta_del_viaje_es_demasiado', { maxEtiqueta: MAX_ETIQUETA }) };
    const conceptosViaje = unicos(lineas(fd.get('conceptosViaje'), /[\n;]+/));
    if (conceptosViaje.length > MAX_CONCEPTOS_VIAJE) return { ok: false, error: tx('rest.son_demasiados_conceptos_para_el_renglon', { maxConceptosViaje: MAX_CONCEPTOS_VIAJE }) };
    if (agruparViaje && conceptosViaje.length === 0) return { ok: false, error: tx('rest.activaste_el_renglon_de_viaje_indica') };

    const renombres: RenombreGuardado[] = [];
    for (const [i, l] of lineas(fd.get('renombres'), /\n+/).entries()) {
      const partes = l.split(/\s*(?:=>|->|→)\s*/);
      const texto = (partes[0] ?? '').trim();
      const a = (partes[1] ?? '').trim();
      if (partes.length !== 2 || texto === '' || a === '') return { ok: false, error: tx('rest.renombre_escribelo_como_concepto_etiqueta', { v: i + 1 }) };
      if (texto.length > MAX_ETIQUETA || a.length > MAX_ETIQUETA) return { ok: false, error: tx('rest.renombre_el_texto_es_demasiado_largo', { v: i + 1, maxEtiqueta: MAX_ETIQUETA }) };
      renombres.push({ texto, patron: escaparRegex(texto), flags: 'i', a, fusionar: false });
    }
    if (renombres.length > MAX_RENOMBRES) return { ok: false, error: tx('rest.son_demasiados_renombres_maximo', { maxRenombres: MAX_RENOMBRES }) };

    const conceptosProhibidos = unicos(lineas(fd.get('conceptosProhibidos'), /[\n;]+/));
    if (conceptosProhibidos.length > MAX_PROHIBIDOS) return { ok: false, error: tx('rest.son_demasiados_conceptos_que_retienen_el', { maxProhibidos: MAX_PROHIBIDOS }) };

    const tiposQueReciben = fd.getAll('tiposQueReciben').map(String).filter((t) => tiposOperador(tx).some((x) => x.valor === t));

    const netoNegativo = fd.get('netoNegativo') === 'enviar' ? 'enviar' : 'retener';

    const horaTxt = String(fd.get('enviarDesdeHora') ?? '').trim();
    let enviarDesdeHora: number | null = null;
    if (horaTxt !== '') {
      const h = Number(horaTxt);
      if (!Number.isInteger(h) || h < 0 || h > 23) return { ok: false, error: tx('rest.la_hora_minima_de_envio_debe') };
      enviarDesdeHora = h;
    }

    return {
      ok: true,
      config: {
        canal: canal as CanalEntrega,
        activa: fd.get('activa') === 'on',
        remitenteNombre: remitente || null,
        responderA: correo('Responder a', String(fd.get('responderA') ?? '')),
        remitenteCorreo: correo('Correo emisor', String(fd.get('remitenteCorreo') ?? '')),
        revisores: revisoresLeidos,
        primerMesHasta,
        noEnviarAntes,
        rhCorreos,
        archivoCorreo: correo(tx('rest.buzon_de_archivo'), String(fd.get('archivoCorreo') ?? '')),
        enviaCoordinador: fd.get('enviaCoordinador') === 'on',
        enviaRh: rhCorreos.length > 0,
        etiquetaViaje: etiquetaViaje || 'Pago de viaje',
        agruparViaje,
        conceptosViaje,
        renombres,
        conceptosProhibidos,
        tiposQueReciben,
        netoNegativo,
        enviarDesdeHora,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : tx('rest.revisa_los_datos_del_formulario') };
  }
}

// ── Vista ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function VistaConfiguracionLiquidacion({ sufijo, aviso, error, config, hayFila, disponible, puedeAdministrar, acciones, tr = TR_ES }: {
  sufijo: string; aviso: string | null; error: string | null;
  /** Lo guardado, o el defecto (WhatsApp, inactiva) cuando la flota no tiene fila. */
  config: ConfigCorreo;
  hayFila: boolean;
  /** false si la base no tiene las migraciones 0785-0787: la pantalla lo dice en vez de fingir un formulario que no guarda. */
  disponible: boolean;
  puedeAdministrar: boolean; acciones: AccionesConfiguracion; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const off = !puedeAdministrar || !disponible;
  const renombres = (Array.isArray(config.renombres) ? config.renombres : []).filter(esRenombre);
  return (
    <MarcoPagina titulo={tx('rest.configuracion_del_desglose')} apoyo={tx('rest.como_se_entrega_el_desglose_de')} acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/liquidacion${sufijo}`} icono={<Icono icono={ArrowLeft} />}>{tx('rest.volver_al_agente')}</BotonEnlace>}>
      {aviso && <AvisoCompacto tono="info" resumen={aviso} />}
      {error && <AvisoCompacto tono="error" resumen={error} />}

      {!disponible && (
        <AvisoCompacto tono="error" resumen={tx('rest.la_configuracion_de_la_entrega_por')} />
      )}
      {disponible && !hayFila && (
        <AvisoCompacto tono="info" resumen={tx('rest.todavia_no_hay_configuracion_guardada_el')} />
      )}
      {!puedeAdministrar && (
        <p className="rv-liq-sub">{tx('conductores.forma.solo_el_dueno_de_la')}</p>
      )}

      <form action={acciones.guardar} className="rv-liq-config">
        <Tarjeta titulo={tx('rest.1_entrega')} info="liquidacion_config.entrega">
          <div className="rv-liq-dos">
            <CampoSelect etiqueta={tx('rest.canal')} name="canal" defaultValue={config.canal} disabled={off}>
              {canales(tx).map((c) => <option key={c.valor} value={c.valor}>{c.etiqueta}</option>)}
            </CampoSelect>
            <Casilla etiqueta={tx('rest.activar_el_envio_por_correo')} name="activa" defaultChecked={config.activa} disabled={off}
              ayuda={tx('rest.apagado_no_sale_ningun_correo_aunque')} />
            <CampoTexto etiqueta={tx('rest.nombre_del_remitente')} name="remitenteNombre" defaultValue={config.remitenteNombre ?? ''} maxLength={MAX_ETIQUETA} placeholder={tx('rest.sin_definir')} disabled={off} />
            <CampoTexto tipo="email" etiqueta={tx('rest.responder_a')} name="responderA" defaultValue={config.responderA ?? ''} maxLength={MAX_CORREO} placeholder={tx('rest.sin_definir')} disabled={off}
              ayuda={tx('rest.a_este_correo_llegan_las_respuestas')} />
            <CampoTexto tipo="email" etiqueta={tx('rest.correo_emisor_de_la_empresa')} name="remitenteCorreo" defaultValue={config.remitenteCorreo ?? ''} maxLength={MAX_CORREO} placeholder={tx('rest.sin_definir')} disabled={off}
              ayuda={tx('rest.el_correo_desde_el_que_la')} />
            <CampoTexto tipo="number" etiqueta={tx('rest.hora_minima_de_envio_0_a')} name="enviarDesdeHora" min={0} max={23} step={1} defaultValue={config.enviarDesdeHora ?? ''} placeholder={tx('rest.sin_restriccion')} disabled={off} />
          </div>
        </Tarjeta>

        <Tarjeta titulo={tx('rest.2_quien_lo_recibe')} info="liquidacion_config.destinatarios">
          <div className="rv-liq-dos">
            <CampoTextarea etiqueta={tx('rest.correos_de_rh_hasta_uno_por', { maxRh: MAX_RH })} name="rhCorreos" rows={3} defaultValue={config.rhCorreos.join('\n')} placeholder={tx('rest.vacio_rh_no_recibe_copia')} disabled={off} />
            <CampoTexto tipo="email" etiqueta={tx('rest.buzon_de_archivo')} name="archivoCorreo" defaultValue={config.archivoCorreo ?? ''} maxLength={MAX_CORREO} placeholder={tx('rest.sin_definir')} disabled={off}
              ayuda={tx('rest.recibe_una_copia_de_cada_desglose')} />
            <Casilla etiqueta={tx('rest.enviar_tambien_al_coordinador_del_operador')} name="enviaCoordinador" defaultChecked={config.enviaCoordinador} disabled={off} />
            <Fieldset leyenda={tx('rest.tipos_de_operador_que_reciben_su')} ayuda={tx('rest.un_tipo_que_no_marques_o')}>
              {tiposOperador(tx).map((t) => (
                <Casilla key={t.valor} etiqueta={t.etiqueta} name="tiposQueReciben" value={t.valor} defaultChecked={config.tiposQueReciben.includes(t.valor)} disabled={off} />
              ))}
            </Fieldset>
          </div>
        </Tarjeta>

        <Tarjeta titulo={tx('rest.fecha_de_corte_del_arranque')} info="liquidacion_config.fecha_corte">
          <p className="rv-liq-sub">{tx('rest.los_desgloses_cuyo_periodo_termina_antes')}</p>
          <div className="rv-liq-dos">
            <CampoFecha etiqueta={tx('rest.no_enviar_desgloses_anteriores_a_aaaa')} name="noEnviarAntes" defaultValue={config.noEnviarAntes ?? ''} disabled={off} />
          </div>
        </Tarjeta>

        <Tarjeta titulo={tx('rest.primer_mes_revision_por_departamento')} info="liquidacion_config.primer_mes">
          <p className="rv-liq-sub">{tx('rest.durante_el_primer_mes_cada_desglose')}</p>
          <div className="rv-liq-dos">
            <Casilla etiqueta={tx('rest.activar_la_revision_por_departamento')} name="primerMes" defaultChecked={config.primerMesHasta !== null} disabled={off} />
            <CampoFecha etiqueta={tx('rest.dura_hasta_aaaa_mm_dd_inclusive')} name="primerMesHasta" defaultValue={config.primerMesHasta ?? sumarDias(hoyMx(), 30)} disabled={off} />
            <CampoTextarea etiqueta={tx('rest.revisores_hasta_departamento_correo_por_renglon', { maxRevisores: MAX_REVISORES })} name="revisores" rows={3}
              defaultValue={config.revisores.map((r) => `${r.departamento}: ${r.correo}`).join('\n')} placeholder={tx('rest.nomina_rh')} disabled={off} />
          </div>
        </Tarjeta>

        <Tarjeta titulo={tx('rest.3_como_se_ve_el_desglose')} info="liquidacion_config.formato">
          <div className="rv-liq-dos">
            <Casilla etiqueta={tx('rest.juntar_los_conceptos_de_viaje_en')} name="agruparViaje" defaultChecked={config.agruparViaje} disabled={off} />
            <CampoTexto etiqueta={tx('rest.etiqueta_del_renglon_de_viaje')} name="etiquetaViaje" defaultValue={config.etiquetaViaje} maxLength={MAX_ETIQUETA} disabled={off} />
            <CampoTextarea etiqueta={tx('rest.conceptos_que_se_funden_en_el')} name="conceptosViaje" rows={3} defaultValue={config.conceptosViaje.join('\n')} disabled={off} />
            <CampoTextarea etiqueta={tx('rest.renombres_uno_por_renglon_concepto_etiqueta')} name="renombres" rows={3} defaultValue={renombres.map((r) => `${r.texto} → ${r.a}`).join('\n')} placeholder={tx('rest.sin_renombres')} disabled={off}
              ayuda={tx('rest.cambia_el_nombre_con_que_un')} />
          </div>
        </Tarjeta>

        <Tarjeta titulo={tx('rest.4_que_retiene_el_envio')} info="liquidacion_config.retencion">
          <div className="rv-liq-dos">
            <CampoTextarea etiqueta={tx('rest.conceptos_que_retienen_el_envio_uno')} name="conceptosProhibidos" rows={3} defaultValue={config.conceptosProhibidos.join('\n')} placeholder="(ninguno)" disabled={off}
              ayuda={tx('rest.si_un_desglose_trae_alguno_no')} />
            <CampoSelect etiqueta={tx('rest.neto_negativo')} name="netoNegativo" defaultValue={config.netoNegativo} disabled={off}>
              <option value="retener">{tx('rest.retener_el_envio')}</option>
              <option value="enviar">{tx('rest.enviar_de_todos_modos')}</option>
            </CampoSelect>
          </div>
        </Tarjeta>

        {puedeAdministrar && disponible && (
          <div className="rv-liq-acciones">
            <Boton type="submit" variante="primary" icono={<Icono icono={Save} />}>{tx('conductores.forma.guardar_configuracion')}</Boton>
          </div>
        )}
      </form>
    </MarcoPagina>
  );
}
