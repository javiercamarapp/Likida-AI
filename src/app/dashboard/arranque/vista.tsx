import Link from 'next/link';
import { numero } from '@/lib/formato';
import type { PasoMarcha, GrupoPaso, ResumenMarcha } from '@/lib/likida/puesta_en_marcha';
import { AUTOMATIZACIONES } from '../rutas';
import { BotonEnlace, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { EsqueletoConfiguracion, type SeccionConfig } from '@/app/ui-v2/esqueletos';
import './arranque.css';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

const grupos = (t: TResto = T_RESTO_ES): Array<{ id: GrupoPaso; titulo: string; nota: string; info: InfoClave }> => ([
  { id: 'flota', titulo: t('cfg.tu_flota_y_su_cuenta'), nota: t('cfg.lo_que_likida_necesita_saber_de'), info: 'arranque.grupo_flota' },
  { id: 'gente', titulo: t('cfg.tu_gente_y_tus_camiones'), nota: t('cfg.operadores_unidades_patios_y_quien_los'), info: 'arranque.grupo_gente' },
  { id: 'operacion', titulo: t('cfg.tu_primera_operacion'), nota: t('cfg.el_ciclo_completo_viaje_ticket_por'), info: 'arranque.grupo_operacion' },
]);

/**
 * LA PUESTA EN MARCHA (W2 «producto»): el checklist guiado de punta a punta. Cada
 * paso sale de una señal REAL del tenant (`puesta_en_marcha.ts`); uno cuya señal no
 * se pudo leer dice «no pude comprobarlo» — nunca un palomeo ni un pendiente
 * inventados.
 */
export function VistaPuestaEnMarcha({ pasos, resumen, puedeAdministrar, hrefAutomatizacion, t = T_RESTO_ES }: {
  pasos: PasoMarcha[];
  resumen: ResumenMarcha;
  /** El dueño hace los pasos de configuración; al jefe se le muestran sin botón. */
  puedeAdministrar: boolean;
  /** Por cada automatización: su href (con sufijo) o null si el rol no la ve. */
  hrefAutomatizacion: Record<string, string | null>; t?: TResto;
}) {
  // El paso que toca ahora (borde en tinta): el primer grupo con algo por hacer. Un grupo cuyos pasos no se pudieron comprobar NO se da
  // por hecho: «hecho» exige que todos digan hecho.
  const porGrupo = grupos(t).map((g) => {
    const delGrupo = pasos.filter((p) => p.grupo === g.id);
    const hechos = delGrupo.filter((p) => p.estado === 'hecho').length;
    return { g, delGrupo, hechos, completo: delGrupo.length > 0 && hechos === delGrupo.length };
  });
  const iActual = porGrupo.findIndex((x) => !x.completo);
  const secciones: SeccionConfig[] = [
    ...porGrupo.map(({ g, delGrupo, hechos, completo }, idx) => ({
      id: g.id, titulo: g.titulo, descripcion: g.nota,
      estado: { texto: `${numero(hechos)}/${numero(delGrupo.length)}`, tono: completo ? 'ok' as const : 'neutral' as const },
      actual: idx === iActual,
      contenido: (
        <ol className="rv-ar__pasos">
          {delGrupo.map((p) => <Paso t={t} key={p.id} p={p} puedeAdministrar={puedeAdministrar} />)}
        </ol>
      ),
    })),
    {
      id: 'automatizaciones', titulo: t('cfg.las_automatizaciones_que_trabajan_con_lo'), descripcion: t('cfg.cada_una_se_activa_en_tu'),
      contenido: (
        <ul className="rv-ar__lista">
          {AUTOMATIZACIONES.map((a) => {
            const href = hrefAutomatizacion[a.href];
            return (
              <li key={a.href}>
                {href ? <Link href={href} className="rv-ar__enlace">{a.nombre}</Link> : <span>{a.nombre}</span>}
              </li>
            );
          })}
        </ul>
      ),
    },
  ];

  return (
    <EsqueletoConfiguracion
      titulo={t('cfg.puesta_en_marcha')}
      apoyo={t('cfg.lo_que_falta_para_que_tu')}
      variante="pasos"
      contexto={(
        <Tarjeta titulo={resumen.completo ? t('cfg.tu_flota_esta_lista_para_operar') : t('cfg.lo_que_falta_para_operar_sin')} info="arranque.avance"
          acciones={<span className="rv-ar__nota">{numero(resumen.hechos)}{' '}{t('cfg.de_pasos', { numero: numero(resumen.total) })}</span>}>
          <div className="rv-ar__avance">
            <progress role="progressbar" className="rv-ar__barra" max={resumen.total || 1} value={resumen.hechos} aria-valuemin={0} aria-valuemax={resumen.total || 1} aria-valuenow={resumen.hechos} aria-label={t('cfg.avance_de_la_puesta_en_marcha')} />
            <div className="rv-ar__resumen">
              {resumen.hayDatoFaltante && (
                <p className="rv-ar__aviso">{t('cfg.algunos_pasos_no_se_pudieron_comprobar')}</p>
              )}
              {resumen.siguiente && (
                <p className="rv-ar__nota">{t('cfg.siguiente')}{' '}<strong>{resumen.siguiente.titulo}</strong>
                  {(puedeAdministrar || !resumen.siguiente.soloDueno) && (
                    <> — <Link href={resumen.siguiente.href} className="rv-ar__enlace">{resumen.siguiente.cta}</Link></>
                  )}
                </p>
              )}
            </div>
          </div>
        </Tarjeta>
      )}
      secciones={secciones}
    />
  );
}

function Paso({ p, puedeAdministrar, t = T_RESTO_ES }: { p: PasoMarcha; puedeAdministrar: boolean; t?: TResto }) {
  const hecho = p.estado === 'hecho';
  const sinDato = p.estado === 'sin_dato';
  const puedeActuar = puedeAdministrar || !p.soloDueno;
  return (
    <li className="rv-ar__paso">
      <span className="rv-ar__estado">
        <StatusChip tono={hecho ? 'ok' : sinDato ? 'warn' : 'muted'}>{hecho ? t('cfg.paso.hecho') : sinDato ? t('cfg.paso.sin_dato') : t('cfg.paso.para_revisar')}</StatusChip>
      </span>
      <div className="rv-ar__texto">
        <p className="rv-ar__titulo" data-hecho={hecho || undefined}>
          {p.titulo}
          {p.opcional && <span className="rv-ar__opcional">(opcional)</span>}
        </p>
        <p className="rv-ar__detalle">
          {sinDato ? t('cfg.no_pude_comprobarlo_en_este_momento') : ''}{p.detalle}
        </p>
      </div>
      {!hecho && (
        puedeActuar ? (
          <span className="rv-ar__accion"><BotonEnlace href={p.href} variante="secondary" tamano="sm">{p.cta}</BotonEnlace></span>
        ) : (
          <span className="rv-ar__accion rv-ar__quien">{t('cfg.lo_hace_quien_administra')}</span>
        )
      )}
    </li>
  );
}
