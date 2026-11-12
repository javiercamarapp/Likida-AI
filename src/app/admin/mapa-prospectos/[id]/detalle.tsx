'use client';

// ═══════════════════════════════════════════════════════════════════════════
// LA FICHA DE UN PROSPECTO: todo lo que el Cerebro resume en una tarjeta, aquí desglosado: decisor(es) con su fuente y confianza (0138),
// flota/historia (0140, NULL declarado si no se encontró; nunca se infiere), los tres % (urgencia/cierre/completitud del mapa + similitud
// ICP/necesidad de la 0140, que son columnas GENERADAS: se leen, no se recalculan aquí), y los mensajes con sus botones de envío reales.
// Fase 6: misma piel del sistema que el Cerebro (MarcoPagina, Tarjeta, StatusChip, cerebro.css); sin emojis, hex ni `style=`.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Link2, Mail, MessageCircle, Phone, RefreshCw, Sparkles } from 'lucide-react';
import type { DetalleProspecto } from '@/lib/admin/prospectos-mapa-client';
import { COLOR_EMBUDO, esProspectoTerminal } from '@/lib/admin/prospectos-mapa-client';
import { leerRespuestaMensaje } from '../respuesta_mensaje';
import { hrefWa, hrefCorreo, mensajeWa, correoProspecto } from '../mensajes';
import { fechaHoraMx, numero } from '@/lib/formato';
import { Boton, Chip, FilaTarjetas, Icono, StatusChip, Tarjeta, clasesBoton } from '../../../ui-v2/componentes';
import { EsqueletoFicha } from '../../../ui-v2/esqueletos';
import { observadas } from '../../sello-observado';
import { BarraPct } from '../cerebro';
import '../cerebro.css';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';
import { rico } from '@/lib/i18n/rico';
import { nombreEtapaTr, nombreGiroTr } from '@/lib/i18n/rotulos_tr';
import type { TSistema } from '@/lib/i18n/sistema_tr';

const CONFIANZA_TONO = { alta: 'ok', media: 'warn', baja: 'neutral' } as const;
const confianzaLabel = (t: TSistema): Record<string, string> => ({ alta: t('mapa_prospectos_detalle.confianza_alta'), media: t('mapa_prospectos_detalle.confianza_media'), baja: t('mapa_prospectos_detalle.confianza_baja') });
const origenLabel = (t: TSistema): Record<string, string> => ({
  sitio_empresa: t('mapa_prospectos_detalle.origen_sitio_oficial'), linkedin: 'LinkedIn', directorio: t('mapa_prospectos_detalle.origen_directorio'),
  denue: 'DENUE', prensa: t('mapa_prospectos_detalle.origen_prensa'), inferido: t('mapa_prospectos_detalle.origen_inferido'), otro: t('mapa_prospectos_detalle.origen_otra'),
});

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  const { t } = useT('admin_sistema', admin_sistemaEs);
  const vacio = children === null || children === undefined || children === '';
  return (
    <div className="cer-dato">
      <dt>{etiqueta}</dt>
      <dd data-vacio={vacio || undefined}>{vacio ? t('mapa_prospectos_detalle.no_disponible') : children}</dd>
    </div>
  );
}

export function Detalle({ p }: { p: DetalleProspecto }) {
  const { t, idioma } = useT('admin_sistema', admin_sistemaEs);
  const [afinando, setAfinando] = useState(false);
  const [datos, setDatos] = useState(p);
  const [avisoIa, setAvisoIa] = useState<{ texto: string; error: boolean } | null>(null);

  const tocar = (canal: 'whatsapp' | 'correo') => {
    void fetch('/api/admin/mapa-prospectos/toque', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, canal }),
    }).catch(() => undefined);
  };

  const afinar = async () => {
    setAfinando(true);
    setAvisoIa(null);
    try {
      const r = await fetch('/api/admin/mapa-prospectos/mensaje', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      }).then((resp) => leerRespuestaMensaje(resp, t), () => ({ ok: false as const, error: t('mapa_prospectos_detalle.no_se_pudo_contactar_al_servidor') }));
      if (!r.ok) { setAvisoIa({ texto: r.error, error: true }); return; }
      if (r.aviso) setAvisoIa({ texto: r.aviso, error: false });
      setDatos((d) => ({ ...d, ...r.datos }));
    } finally {
      setAfinando(false);
    }
  };

  // La ficha SÍ trae los textos largos, así que se pasan explícitos (FE-16: sin ellos los href caerían a la plantilla determinista).
  const linkWa = hrefWa(datos, datos);
  const linkCorreo = hrefCorreo(datos, datos);
  const textoWa = datos.mensajeWaIa ?? mensajeWa(datos);
  const asuntoCorreo = datos.correoAsuntoIa ?? correoProspecto(datos).asunto;
  const cuerpoCorreo = datos.correoCuerpoIa ?? correoProspecto(datos).cuerpo;
  const etapa = p.estado in COLOR_EMBUDO ? p.estado : 'nuevo';
  const resumen = [nombreGiroTr(p.giro, t), p.ciudad ? `${p.ciudad}${p.entidad ? `, ${p.entidad}` : ''}` : null, p.tamano ? t('mapa_prospectos_detalle.personas_denue', { n: p.tamano }) : null]
    .filter(Boolean).join(' · ');

  return (
    <EsqueletoFicha
      area={t('mapa_prospectos_detalle.eyebrow')} titulo={p.empresa} apoyo={p.vacante ? [t('mapa_prospectos_detalle.vacante_publicada', { vacante: p.vacante }), resumen].filter(Boolean).join(' · ') : resumen}
      volver={{ href: '/admin/mapa-prospectos', etiqueta: t('mapa_prospectos_detalle.volver_al_cerebro_de_ventas') }}
            etiquetaCifras={t('mapa_prospectos_detalle.etiqueta_cifras')}
      cifras={observadas([
        // Los tres % son estimaciones deterministas (el pie de la lista de prospectos enseña el criterio): se sellan «Estimado», no «Observado».
        { etiqueta: t('mapa_prospectos_detalle.urgencia'), valor: `${numero(p.urgencia, idioma)} %`, tipo: 'estimado' },
        { etiqueta: t('mapa_prospectos_detalle.cierre'), valor: `${numero(p.cierre, idioma)} %`, tipo: 'estimado' },
        { etiqueta: t('mapa_prospectos_detalle.datos'), valor: `${numero(p.completitud, idioma)} %`, tipo: 'estimado' },
        { etiqueta: t('mapa_prospectos_detalle.ultimo_toque'), valor: p.ultimoToque ? fechaHoraMx(p.ultimoToque, idioma) : null },
      ], t('a1r4.observado'))}
      variante="12"
      bloques={[
        <Tarjeta key="inv" titulo={t('mapa_prospectos_detalle.de_investigacion_calculadas')}
          acciones={<Chip><i className="cer-punto" data-etapa={etapa} aria-hidden="true" />{nombreEtapaTr(etapa, t)}</Chip>}>
          <BarraPct etiqueta="ICP" pct={p.similitudIcpPct} serie="icp" />
          <p className="cer-prospecto__tenue">{t('mapa_prospectos_detalle.similitud_con_el_icp_giro_correcto')}</p>
          <BarraPct etiqueta={t('mapa_prospectos_detalle.necesid')} pct={p.necesidadPct} serie="necesidad" />
          <p className="cer-prospecto__tenue">{t('mapa_prospectos_detalle.necesidad_vacante_de_liquidacion_cuadre_50')}</p>
        </Tarjeta>,
      ]}
    >
      {/* Decisor(es) y ficha en una fila 6-6 (Rovaq FI: bloques a dos columnas que llenan la fila; antes el decisor quedaba solo en 1/3). */}
      <FilaTarjetas variante="6-6" className="adm-fila-alto-contenido">
      {/* ── Decisores ──────────────────────────────────────────────────── */}
      <Tarjeta titulo={p.personas.length > 0 ? t(p.personas.length > 1 ? 'mapa_prospectos_detalle.decisores_investigados' : 'mapa_prospectos_detalle.decisor_investigado') : t('mapa_prospectos_detalle.decisor')}
        estado={p.personas.length === 0 && !p.contacto ? 'vacio' : 'ok'} contenida mensaje={t('mapa_prospectos_detalle.sin_decisor_confirmado')} detalle={t('mapa_prospectos_detalle.ningun_agente_ha_encontrado_un_decisor')}>
        {p.personas.length === 0 && p.contacto && <p className="cer-prospecto__contacto">{p.contacto}</p>}
        {p.personas.length > 0 && (
          <div className="cer-personas">
            {p.personas.map((per) => (
              <div key={per.id} className="cer-persona">
                <div className="cer-persona__cab">
                  <strong>{per.nombre}</strong>
                  <StatusChip tono={CONFIANZA_TONO[per.confianza]}>{confianzaLabel(t)[per.confianza]}</StatusChip>
                </div>
                {per.puesto && <p>{per.puesto}</p>}
                {per.telefono && <a href={`tel:${per.telefono}`}><Icono icono={Phone} tam={14} />{per.telefono}</a>}
                {per.correo && <a href={`mailto:${per.correo}`}><Icono icono={Mail} tam={14} />{per.correo}</a>}
                {per.linkedin && <a href={per.linkedin} target="_blank" rel="noreferrer"><Icono icono={Link2} tam={14} />{t('mapa_prospectos_detalle.linkedin')}</a>}
                <p className="cer-prospecto__tenue">{origenLabel(t)[per.origen] ?? per.origen}{per.evidencia ? `: ${per.evidencia}` : ''}</p>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      {/* ── La ficha ───────────────────────────────────────────────────── */}
      <Tarjeta titulo={t('mapa_prospectos_detalle.ficha')}>
        <dl className="cer-ficha__datos">
          <Dato etiqueta={t('mapa_prospectos_detalle.telefono')}>{p.telefono ? <a href={`tel:${p.telefono}`}>{p.telefono}</a> : null}</Dato>
          <Dato etiqueta={t('mapa_prospectos_detalle.correo')}>{p.correo ? <a href={`mailto:${p.correo}`}>{p.correo}</a> : null}</Dato>
          <Dato etiqueta={t('mapa_prospectos_detalle.sitio')}>
            {p.sitio ? (
              <span>
                <a href={p.sitio.startsWith('http') ? p.sitio : `https://${p.sitio}`} target="_blank" rel="noreferrer">{p.sitio}</a>{' '}
                <StatusChip tono={p.sitioVerificado ? 'ok' : 'neutral'}>{p.sitioVerificado ? 'verificado' : t('mapa_prospectos_detalle.sin_verificar')}</StatusChip>
              </span>
            ) : null}
          </Dato>
          <Dato etiqueta={t('observabilidad.flota')}>{p.numUnidades !== null ? `${numero(p.numUnidades, idioma)} unidades` : null}</Dato>
          <Dato etiqueta={t('mapa_prospectos_detalle.viajes_mes_estimado')}>{p.viajesMesEstimado !== null ? `≈ ${numero(p.viajesMesEstimado, idioma)}` : null}</Dato>
          <Dato etiqueta={t('trust_safety.fuente')}>{p.fuenteCruda}</Dato>
          <Dato etiqueta={t('mapa_prospectos_detalle.registrado')}>{fechaHoraMx(p.creadoEn, idioma)}</Dato>
          <Dato etiqueta={t('mapa_prospectos_detalle.ultimo_toque')}>{p.ultimoToque ? fechaHoraMx(p.ultimoToque, idioma) : null}</Dato>
        </dl>
        {p.viajesMesEstimado !== null && (
          <p className="cer-prospecto__tenue">{t('mapa_prospectos_detalle.estimado_no_medido_unidades_18_viajes', { numero: numero(p.numUnidades ?? 0, idioma) })}</p>
        )}
      </Tarjeta>
      </FilaTarjetas>

      {p.historia && (
        <Tarjeta titulo={t('mapa_prospectos_detalle.historia')}><p className="cer-mensaje__texto">{p.historia}</p></Tarjeta>
      )}

      {p.notas && (
        <Tarjeta titulo={t('mapa_prospectos_detalle.notas_de_investigacion')}><pre className="cer-notas">{p.notas}</pre></Tarjeta>
      )}

      {/* ── Mensajes ───────────────────────────────────────────────────── */}
      <Tarjeta titulo={t('mapa_prospectos_detalle.mensajes')}
        acciones={!esProspectoTerminal(p.estado) ? (
          <Boton tamano="sm" onClick={() => void afinar()} disabled={afinando} icono={<Icono icono={datos.mensajesGeneradosEn ? RefreshCw : Sparkles} />}>
            {afinando ? t('mapa_prospectos_detalle.redactando') : datos.mensajesGeneradosEn ? t('mapa_prospectos_detalle.redactar_de_nuevo_con_ia') : t('mapa_prospectos_detalle.redactar_con_ia')}
          </Boton>
        ) : undefined}>
        {avisoIa && (
          <p role="alert" className={avisoIa.error ? 'cer-prospecto__error' : 'cer-prospecto__aviso'}>{avisoIa.texto}</p>
        )}
        {datos.mensajesGeneradosEn && (
          <p className="cer-prospecto__tenue">{t('mapa_prospectos_detalle.ultima_redaccion_del_agente_experto')}{' '}{fechaHoraMx(datos.mensajesGeneradosEn, idioma)}</p>
        )}
        <div className="cer-mensajes">
          <div className="cer-mensaje">
            <p className="cer-mensaje__asunto"><strong>WhatsApp</strong>{p.telefono ? ` · ${p.telefono}` : ''}</p>
            <p className="cer-mensaje__texto">{textoWa}</p>
            {linkWa
              ? <a href={linkWa} target="_blank" rel="noreferrer" onClick={() => tocar('whatsapp')} className={clasesBoton('primary')}><Icono icono={MessageCircle} />{t('mapa_prospectos_detalle.enviar_whatsapp')}</a>
              : <p className="cer-prospecto__tenue">{t('mapa_prospectos_detalle.sin_telefono_no_se_puede_mandar')}</p>}
          </div>
          <div className="cer-mensaje">
            <p className="cer-mensaje__asunto">{rico(t('mapa_prospectos_detalle.strong_correo_strong'), { strong: (c) => <strong>{c}</strong> })}{p.correo ? ` · ${p.correo}` : ''}</p>
            <p className="cer-mensaje__asunto">{rico(t('mapa_prospectos_detalle.strong_asunto_strong'), { strong: (c) => <strong>{c}</strong> })}{' '}{asuntoCorreo}</p>
            <p className="cer-mensaje__texto">{cuerpoCorreo}</p>
            {linkCorreo
              ? <a href={linkCorreo} onClick={() => tocar('correo')} className={clasesBoton('primary')}><Icono icono={Mail} />{t('mapa_prospectos_detalle.enviar_correo')}</a>
              : <p className="cer-prospecto__tenue">{t('mapa_prospectos_detalle.sin_correo_no_se_puede_mandar')}</p>}
          </div>
        </div>
        <p className="cer-prospecto__tenue">{t('mapa_prospectos_detalle.nada_se_manda_solo_los_botones')}</p>
      </Tarjeta>
    </EsqueletoFicha>
  );
}
