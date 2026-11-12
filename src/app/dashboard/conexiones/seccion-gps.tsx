'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { KeyRound, Copy, Truck, MapPinned } from 'lucide-react';
import { AvisoResultado, Boton, BotonConfirmar, Icono, TablaBase, Tarjeta, clasesBoton, type ColumnaBase } from '@/app/ui-v2/componentes';
import './conexiones.css';
import { ImportadorMasivo, type AccionImportacion } from '../importador-masivo';
import { fechaHoraMx, numero } from '@/lib/formato';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// GPS: SALUD POR INTEGRACIÓN, PUSH PROPIO, DISPOSITIVOS HUÉRFANOS Y MAPEO.
//
// Todo se calcula en el servidor (`gps_salud.ts` + `gps_push/datos.ts`) y llega
// ya como texto y tono: este componente no decide qué es «sana» ni inventa un
// estado. Cada botón hace algo real: generar/rotar el secreto del push (se
// muestra UNA vez), copiar, y ligar dispositivos por archivo (revisar → confirmar).
// ═══════════════════════════════════════════════════════════════════════════

export interface FilaSaludGps { clave: string; nombre: string; tono: 'ok' | 'warn' | 'bad' | 'neutral'; estado: string; texto: string }
export interface HuerfanoPantalla { proveedor: string; deviceId: string; ultimoVistoEn: string }
export type ResultadoSecreto = { ok: true; secreto: string; endpoint: string } | { ok: false; error: string } | null;
export type AccionSecreto = (previo: ResultadoSecreto, fd: FormData) => Promise<ResultadoSecreto>;
/** Importar las geocercas de «mis propias tablas» al catálogo de sitios. */
export type ResultadoImportGeocercas = { ok: true; mensaje: string; aproximadas: number; poligonos?: number } | { ok: false; error: string; detalles?: string[] } | null;
export type AccionImportGeocercas = (previo: ResultadoImportGeocercas, fd: FormData) => Promise<ResultadoImportGeocercas>;

function BotonImportarGeocercas() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={MapPinned} />}>
      {pending ? 'Leyendo tus geocercas…' : 'Importar mis geocercas'}
    </Boton>
  );
}

/** Lee las geocercas de su tabla/CSV y las deja como sitios (todo-o-nada; un polígono se aproxima y se avisa). */
function ImportadorGeocercas({ accion }: { accion: AccionImportGeocercas }) {
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <Tarjeta titulo={t('cfg.geocercas_de_tu_sistema')}>
      <p className="rv-cx__apoyo">{t('cfg.si_conectaste_mis_propias_tablas_de')}</p>
      <form action={despachar}><BotonImportarGeocercas /></form>
      {estado?.ok === true && (
        <p role="status" className="rv-cx__ok-texto">
          {estado.mensaje}{(estado.poligonos ?? 0) > 0 ? t('cfg.poligono_s_se_guardaron_con_su', { poligonos: estado.poligonos ?? 0 }) : ''}{estado.aproximadas > 0 ? t('cfg.poligono_s_no_se_pudieron_guardar', { aproximadas: estado.aproximadas }) : ''}
        </p>
      )}
      {estado?.ok === false && (
        <div role="alert" className="rv-cx__alerta">
          <p>{estado.error}</p>
          {estado.detalles && estado.detalles.length > 0 && <ul>{estado.detalles.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}
    </Tarjeta>
  );
}

function BotonGenerar({ rotulo }: { rotulo: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={KeyRound} />}>
      {pending ? 'Generando…' : rotulo}
    </Boton>
  );
}

export function SeccionGps({ salud, push, endpoint, huerfanos, hayMasHuerfanos, conteos, puedeAdministrarGps, generarSecreto, mapear, plantillaCsv, hrefPatios, importarGeocercas }: {
  salud: FilaSaludGps[];
  push: { fila: FilaSaludGps; configurado: boolean; version: number | null; recepciones: number; rechazos: number; previoHasta: string | null };
  endpoint: string;
  huerfanos: HuerfanoPantalla[];
  hayMasHuerfanos: boolean;
  conteos: { activas: number; conDispositivo: number; sinDispositivo: number; sinSenalNunca: number } | null;
  puedeAdministrarGps: boolean;
  generarSecreto: AccionSecreto;
  mapear: AccionImportacion;
  plantillaCsv: string;
  hrefPatios: string;
  /** Solo si la flota tiene conectada su tabla propia. */
  importarGeocercas?: AccionImportGeocercas;
}) {
  const { t, idioma } = useT('resto', restoEs);
  const [estadoSecreto, despachar] = useActionState(generarSecreto, null);
  const [copiado, setCopiado] = useState(false);

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { setCopiado(false); }
  }

  return (
    <div id="gps" className="rv-cx__stack">
      <Tarjeta titulo={t('cfg.gps_salud_de_cada_integracion')}>
        <p className="rv-cx__apoyo">{t('cfg.cada_renglon_sale_de_la_ultima')}</p>

        {salud.length === 0 ? (
          <p className="rv-cx__texto">{t('cfg.ningun_proveedor_de_gps_tiene_credencial')}</p>
        ) : (
          <ul className="rv-cx__salud">
            {salud.map((f) => (
              <li key={f.clave} className="rv-cx__salud-fila" data-tono={f.tono}>
                <span className="rv-cx__salud-titulo">{f.nombre} · {f.estado}</span>
                <span className="rv-cx__salud-texto">{f.texto}</span>
              </li>
            ))}
          </ul>
        )}

        {conteos && (
          <p className="rv-cx__texto">
            <span className="rv-cx__icono-linea"><Icono icono={Truck} tam={14} /></span>{t('cfg.de_unidades_activas_tienen_dispositivo_gps', { numero: numero(conteos.conDispositivo, idioma), numero2: numero(conteos.activas, idioma) })}{conteos.sinDispositivo > 0 ? t('cfg.no_tienen_no_aparecen_en_el', { numero: numero(conteos.sinDispositivo, idioma) }) : ''}
            {conteos.sinSenalNunca > 0 ? t('cfg.lo_tienen_ligado_y_nunca_han', { numero: numero(conteos.sinSenalNunca, idioma) }) : ''}.
          </p>
        )}
      </Tarjeta>

      {/* ── PUSH PROPIO ─────────────────────────────────────────────── */}
      <Tarjeta titulo={t('cfg.gps_propio_envio_firmado_a_likida')}>
        <p className="rv-cx__apoyo">{t('cfg.si_tu_sistema_de_gps_puede')}</p>
        <p className="rv-cx__endpoint cifra-mono">{endpoint}</p>
        <div className="rv-cx__salud-fila" data-tono={push.fila.tono}>
          <span className="rv-cx__salud-titulo">{push.fila.estado}</span>
          <span className="rv-cx__salud-texto">
            {push.fila.texto}
            {push.configurado ? t('cfg.recepciones_rechazos_version_del_secreto', { numero: numero(push.recepciones, idioma), numero2: numero(push.rechazos, idioma), v: push.version ?? 1 }) : ''}
            {push.previoHasta ? ` El secreto anterior sigue valiendo hasta ${fechaHoraMx(push.previoHasta, idioma)}.` : ''}
          </span>
        </div>

        {puedeAdministrarGps ? (
          <form action={despachar} className="rv-cx__fila-botones">
            {push.configurado ? (
              <BotonConfirmar
                tono="peligro" etiqueta={t('cfg.rotar_secreto')}
                titulo={t('cfg.rotar_el_secreto_del_gps_propio')}
                descripcion={t('cfg.se_genera_un_secreto_nuevo_y')}
                etiquetaConfirmar={t('cfg.si_rotar')}
                className={clasesBoton('danger', 'md')}
              />
            ) : (
              <BotonGenerar rotulo={t('cfg.generar_secreto')} />
            )}
          </form>
        ) : (
          <p className="rv-cx__texto" data-tono="faint">{t('cfg.solo_el_dueno_de_la_flota_7')}</p>
        )}

        {estadoSecreto && !estadoSecreto.ok && <div className="rv-cx__ok-texto"><AvisoResultado estado={{ ok: false, error: estadoSecreto.error }} /></div>}
        {estadoSecreto?.ok && (
          <div role="status" className="rv-cx__secreto">{rico(t('cfg.strong_guardalo_ahora_no_se_vuelve'), { strong: (c) => <strong>{c}</strong> })}<code className="cifra-mono">{estadoSecreto.secreto}</code>
            <div>
              <Boton tamano="sm" icono={<Icono icono={Copy} />} onClick={() => copiar(estadoSecreto.secreto)}>
                {copiado ? 'Copiado' : 'Copiar secreto'}
              </Boton>
            </div>
          </div>
        )}
      </Tarjeta>

      {/* ── HUÉRFANOS ───────────────────────────────────────────────── */}
      <Tarjeta titulo={t('cfg.dispositivos_sin_unidad')}>
        <p className="rv-cx__apoyo">{t('cfg.dispositivos_que_tu_proveedor_reporta_y')}</p>
        {huerfanos.length === 0 ? (
          <p className="rv-cx__texto">{t('cfg.ningun_dispositivo_sin_unidad')}</p>
        ) : (
          <TablaBase etiqueta={t('cfg.dispositivos_gps_que_ninguna_unidad_reclama')} columnas={columnasHuerfanos(t)} filas={huerfanos}
            idFila={(h) => `${h.proveedor}|${h.deviceId}`} densa />
        )}
        {hayMasHuerfanos && <p className="rv-cx__nota">{t('cfg.se_muestran_los_mas_recientes_liga')}</p>}
      </Tarjeta>

      {puedeAdministrarGps && importarGeocercas && <ImportadorGeocercas accion={importarGeocercas} />}

      {puedeAdministrarGps && (
        <ImportadorMasivo
          entidad="dispositivos_gps" accion={mapear} plantillaCsv={plantillaCsv}
          archivoPlantilla="plantilla-dispositivos-gps.csv"
          columnas={t('cfg.tres_columnas_numero_economico_de_una')}
          hrefPatios={hrefPatios} tope={2_000}
        />
      )}
    </div>
  );
}

const columnasHuerfanos = (t: TResto = T_RESTO_ES): ColumnaBase<HuerfanoPantalla>[] => ([
  { id: 'proveedor', titulo: t('cfg.proveedor'), celda: (h) => h.proveedor },
  { id: 'dispositivo', titulo: t('cfg.dispositivo'), principal: true, celda: (h) => <span className="cifra-mono">{h.deviceId}</span> },
  { id: 'visto', titulo: t('cfg.visto'), celda: (h) => fechaHoraMx(h.ultimoVistoEn) },
]);
