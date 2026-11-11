'use client';

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import {
  AlertTriangle, Ban, Check, ChevronDown, CircleDashed, Clock3, Copy, FileUp, HelpCircle, Hourglass, Lock, Mail, User,
} from 'lucide-react';
import {
  Aviso, Boton, BotonEnlace, Chip, Drawer, EncabezadoPagina, type TonoChip,
} from '@/app/ui-v2/componentes';
import { ProgresoAnillo } from '@/app/ui-v2/graficas';
import { anclaTour, TourLanzador } from '@/app/ui-v2/movimiento/tour';
import {
  armarPasosCincoAgentes, etiquetaGlobal, MOTIVO_MINIMO, ROTULO_ESTADO, RESPONSABLES_POR_OMISION,
  type Declaraciones, type EstadoAsistente, type IdPaso, type PasoAsistente, type Responsables, type SenalesAsistente,
} from '@/lib/likida/asistente/pasos_cinco_agentes';
import { cartaAutorizacion, solicitudParaTi } from '@/lib/likida/asistente/textos_solicitud';
import { nombreCookieAvance, valorCookieAvance } from './progreso';
import { useDeclaraciones } from './usar-declaraciones';
import { enviarPruebaCorreo, type ResultadoPruebaCorreo } from './acciones';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { rico } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// PUESTA EN MARCHA — la pantalla del asistente (PLAN-MAESTRO §2.5).
//
// Las señales MEDIDAS llegan del servidor; las declaraciones de la persona viven en su navegador. La pantalla vuelve a
// armar los pasos con la MISMA función pura, así que lo medido nunca se guarda y lo declarado siempre se ve etiquetado.
// Sin estado guardado (servidor, Safari privado) todo se renderiza igual, solo sin las declaraciones.
// ═══════════════════════════════════════════════════════════════════════════

const ESTADO_VISUAL: Record<EstadoAsistente, { tono: TonoChip; Icono: typeof Check }> = {
  listo: { tono: 'ok', Icono: Check },
  pendiente: { tono: 'neutral', Icono: CircleDashed },
  en_curso: { tono: 'info', Icono: Clock3 },
  atencion: { tono: 'warn', Icono: AlertTriangle },
  en_espera: { tono: 'info', Icono: Hourglass },
  bloqueado: { tono: 'neutral', Icono: Lock },
  omitido: { tono: 'neutral', Icono: Ban },
  sin_dato: { tono: 'warn', Icono: HelpCircle },
};

function EstadoChip({ estado }: { estado: EstadoAsistente }) {
  const { tono, Icono } = ESTADO_VISUAL[estado];
  return (
    <Chip tono={tono}>
      <Icono width={12} height={12} strokeWidth={2.2} aria-hidden="true" />
      {ROTULO_ESTADO[estado]}
    </Chip>
  );
}

function SoloV2({ children }: { children: React.ReactNode }) {
  // El recorrido solo existe bajo la interfaz nueva: se confirma en el cliente, sin desajuste de hidratación.
  const v2 = useSyncExternalStore(() => () => {}, () => document.querySelector('[data-ui="v2"]') !== null, () => false);
  return v2 ? <>{children}</> : null;
}

export function VistaPuestaEnMarcha({ senales, ambito, tenantId, sufijo, soloLectura, pasoInicial, responsables = RESPONSABLES_POR_OMISION }: {
  senales: SenalesAsistente;
  /** tenant + usuario: aísla el progreso entre cuentas del mismo navegador. */
  ambito: string;
  tenantId: string;
  sufijo: string;
  /** Superadmin «viendo como»: mira, pero no escribe progreso. */
  soloLectura: boolean;
  /** `?paso=tms`: abre el detalle de ese paso (lo usa el recorrido guiado y los enlaces de otras pantallas). */
  pasoInicial?: IdPaso;
  responsables?: Responsables;
}) {
  const { t } = useT('resto', restoEs);
  const { declaraciones, cambiar } = useDeclaraciones(ambito, soloLectura);

  const r = useMemo(() => armarPasosCincoAgentes(senales, declaraciones, responsables), [senales, declaraciones, responsables]);
  const [elegido, setElegido] = useState<IdPaso | null>(pasoInicial ?? null);
  const idActual: IdPaso = elegido ?? r.siguiente ?? r.rutaCritica[0].id;
  const actual = [...r.rutaCritica, ...r.despues].find((p) => p.id === idActual)!;

  // La insignia del menú sale de una cookie con solo «listos/total» (el layout la lee en el servidor). Nada de negocio.
  useEffect(() => {
    if (soloLectura) return;
    try {
      document.cookie = `${nombreCookieAvance(tenantId)}=${encodeURIComponent(valorCookieAvance(r.listos, r.total))}; path=/dashboard; max-age=31536000; samesite=lax`;
    } catch { /* sin cookies: el menú simplemente no muestra insignia */ }
  }, [r.listos, r.total, tenantId, soloLectura]);

  return (
    <div className="rv-pem">
      <EncabezadoPagina
        titulo={t('cfg.puesta_en_marcha')}
        idTitulo="puesta-titulo"
        apoyo={t('op.deja_lista_tu_operacion_seis_pasos')}
        acciones={<SoloV2><TourLanzador recorridoId="dueno.completo" etiqueta={t('op.ver_recorrido')} /></SoloV2>}
      />

      {soloLectura && (
        <Aviso tono="info" className="rv-pem__aviso">{t('op.estas_viendo_esta_cuenta_como_superadmin')}</Aviso>
      )}

      <div className="rv-pem__cuerpo">
        <aside className="rv-pem__lateral" aria-label={t('op.tus_pasos')}>
          <section className="rv-pem__avance" {...anclaTour('asistente.avance')}>
            <ProgresoAnillo valor={r.avance} tamano={76} grosor={7} etiqueta={t('cfg.avance_de_la_puesta_en_marcha')} />
            <div>
              <p className="rv-pem__avance-num">{r.listos} de {r.total}</p>
              <p className="rv-pem__avance-txt">
                {etiquetaGlobal(r) ?? (r.listos === 0 ? t('op.aun_no_hay_pasos_terminados') : 'pasos terminados')}
              </p>
            </div>
          </section>

          <ol className="rv-pem__lista" {...anclaTour('asistente.lista')}>
            {r.rutaCritica.map((p) => (
              <li key={p.id}>
                <button
                  type="button" className="rv-pem__item" data-activo={p.id === idActual || undefined}
                  aria-current={p.id === idActual ? 'step' : undefined}
                  onClick={() => setElegido(p.id)}
                  {...anclaTour(`asistente.paso-${p.id.replace('_', '-')}`)}
                >
                  <span className="rv-pem__num" data-estado={p.estado}>
                    {p.estado === 'listo' ? <Check width={13} height={13} strokeWidth={2.6} aria-hidden="true" /> : p.numero}
                  </span>
                  <span className="rv-pem__item-texto">
                    <span className="rv-pem__item-titulo">{p.titulo}</span>
                    <span className="rv-pem__item-sub">{p.faltaDe ?? ROTULO_ESTADO[p.estado]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <details className="rv-pem__despues">
            <summary>
              <ChevronDown width={14} height={14} aria-hidden="true" />{rico(t('op.despues_e0_e0', { length: r.despues.length }), { e0: (c) => <span>{c}</span> })}</summary>
            <p className="rv-pem__despues-nota">{t('op.no_hacen_falta_para_empezar_y')}</p>
            <ul className="rv-pem__lista">
              {r.despues.map((p) => (
                <li key={p.id}>
                  <button type="button" className="rv-pem__item" data-activo={p.id === idActual || undefined} aria-current={p.id === idActual ? 'step' : undefined} onClick={() => setElegido(p.id)}>
                    <span className="rv-pem__num" data-estado={p.estado}><span aria-hidden="true">·</span></span>
                    <span className="rv-pem__item-texto">
                      <span className="rv-pem__item-titulo">{p.titulo}</span>
                      <span className="rv-pem__item-sub">{p.faltaDe ?? ROTULO_ESTADO[p.estado]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </aside>

        <section className="rv-pem__detalle" aria-live="polite" {...anclaTour('asistente.detalle')}>
          <DetallePaso
            key={actual.id} paso={actual} sufijo={sufijo} soloLectura={soloLectura}
            declaraciones={declaraciones} onCambiar={cambiar} responsables={responsables}
          />
        </section>
      </div>
    </div>
  );
}

function DetallePaso({ paso, sufijo, soloLectura, declaraciones, onCambiar, responsables }: {
  paso: PasoAsistente; sufijo: string; soloLectura: boolean; declaraciones: Declaraciones;
  onCambiar: (d: Declaraciones) => void; responsables: Responsables;
}) {
  const { t } = useT('resto', restoEs);
  const [drawer, setDrawer] = useState(false);
  const [omitiendo, setOmitiendo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [prueba, setPrueba] = useState<ResultadoPruebaCorreo | null>(null);
  const [enviando, iniciar] = useTransition();

  const quitarOmitido = () => {
    const resto = { ...declaraciones.omitidos };
    delete resto[paso.id];
    onCambiar({ ...declaraciones, omitidos: resto });
  };

  return (
    <article className="rv-pem__paso">
      <header className="rv-pem__paso-cab">
        <p className="rv-pem__paso-rotulo etiqueta-mono">{paso.numero ? `Paso ${paso.numero}` : t('op.despues')}</p>
        <h2 className="rv-pem__paso-titulo font-display">{paso.titulo}</h2>
        <p className="rv-pem__paso-resumen">{paso.resumen}</p>
        <div className="rv-pem__paso-estado">
          <EstadoChip estado={paso.estado} />
          {paso.faltaDe && <span className="rv-pem__falta"><User width={13} height={13} aria-hidden="true" /> {paso.faltaDe}</span>}
        </div>
      </header>

      {paso.causa && <Aviso tono="warn" titulo={t('op.que_paso')}>{paso.causa}</Aviso>}

      <p className="rv-pem__evidencia" data-tipo={paso.evidencia.tipo}>
        <span className="rv-pem__evidencia-sello">{paso.evidencia.tipo === 'medido' ? 'Lo vimos nosotros' : paso.evidencia.tipo === 'declarado' ? t('op.lo_dijiste_tu') : 'Sin comprobar'}</span>
        {paso.evidencia.texto}
      </p>

      {paso.subpasos.length > 0 && (
        <ul className="rv-pem__sub">
          {paso.subpasos.map((s, i) => (
            <li key={s.id} className="rv-pem__sub-item" {...(paso.id === 'tms' && i === 0 ? anclaTour('asistente.archivo') : {})}>
              <EstadoChip estado={s.estado} />
              <div>
                <p className="rv-pem__sub-titulo">{s.titulo}</p>
                <p className="rv-pem__sub-detalle">{s.detalle}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {prueba && (prueba.ok
        ? <Aviso tono="ok" titulo={t('op.prueba_enviada')}>{t('op.te_mandamos_un_correo_a_revisa', { destino: prueba.destino })}</Aviso>
        : <Aviso tono="error" titulo={t('op.no_salio_la_prueba')}>{prueba.error}</Aviso>)}

      <div className="rv-pem__acciones">
        {paso.accion && !declaraciones.omitidos?.[paso.id] && (
          <BotonEnlace variante="primary" href={`${paso.accion.href}${sufijo}`} icono={paso.id === 'tms' ? <FileUp /> : undefined}>
            {paso.accion.texto}
          </BotonEnlace>
        )}
        {paso.id === 'tms' && (
          <Boton variante="secondary" onClick={() => setDrawer(true)} {...anclaTour('asistente.como-conseguirlo')}>{t('op.como_conseguirlo')}</Boton>
        )}
        {paso.id === 'correo' && paso.estado !== 'en_espera' && (
          <Boton
            variante="secondary" icono={<Mail />} loading={enviando}
            onClick={() => iniciar(async () => { setPrueba(await enviarPruebaCorreo()); })}
          >{t('op.mandarme_una_prueba')}</Boton>
        )}
        {paso.declara && !soloLectura && (
          <Boton variante="secondary" onClick={() => onCambiar({ ...declaraciones, [paso.declara!]: true })}>
            {paso.declara === 'correoRecibido' ? t('op.si_me_llego') : paso.declara === 'simulacroVisto' ? t('op.ya_lo_hice_y_funciono') : t('op.ya_invite_a_mi_equipo')}
          </Boton>
        )}
      </div>

      {!soloLectura && paso.numero !== null && paso.estado !== 'listo' && (
        declaraciones.omitidos?.[paso.id] ? (
          <p className="rv-pem__omitir">{t('op.omitido_por_ti', { v: declaraciones.omitidos[paso.id] ?? '' })}{' '}<button type="button" className="rv-pem__enlace" onClick={quitarOmitido}>{t('op.quitar')}</button></p>
        ) : omitiendo ? (
          <form className="rv-pem__omitir-form" onSubmit={(e) => {
            e.preventDefault();
            const m = motivo.trim();
            if (m.length < MOTIVO_MINIMO) return;
            onCambiar({ ...declaraciones, omitidos: { ...declaraciones.omitidos, [paso.id]: m } });
            setOmitiendo(false); setMotivo('');
          }}>
            <label htmlFor="pem-motivo">{t('op.por_que_lo_omites')}</label>
            <input id="pem-motivo" value={motivo} maxLength={140} onChange={(e) => setMotivo(e.target.value)} placeholder={t('op.ej_lo_resuelve_otra_area')} aria-describedby="pem-motivo-ayuda" />
            <p id="pem-motivo-ayuda" className="rv-pem__omitir-ayuda">{t('op.cuentalo_en_al_menos_letras_un', { motivoMinimo: MOTIVO_MINIMO })}</p>
            <Boton type="submit" tamano="sm" variante="secondary" disabled={motivo.trim().length < MOTIVO_MINIMO}>{t('op.omitir')}</Boton>
            <Boton tamano="sm" variante="ghost" onClick={() => setOmitiendo(false)}>{t('op.cancelar')}</Boton>
          </form>
        ) : (
          <button type="button" className="rv-pem__enlace" onClick={() => setOmitiendo(true)}>{t('op.omitir_este_paso')}</button>
        )
      )}

      {paso.id === 'tms' && (
        <DrawerSolicitud abierto={drawer} onCerrar={() => setDrawer(false)} responsables={responsables} />
      )}
    </article>
  );
}

function DrawerSolicitud({ abierto, onCerrar, responsables }: { abierto: boolean; onCerrar: () => void; responsables: Responsables }) {
  const { t } = useT('resto', restoEs);
  const nombres = { paraTi: responsables.ti_tms, gerencia: responsables.gerencia, flota: 'nuestra flota' };
  const solicitud = solicitudParaTi(nombres);
  const carta = cartaAutorizacion(nombres);
  const [copiado, setCopiado] = useState<'solicitud' | 'carta' | null>(null);

  const copiar = async (cual: 'solicitud' | 'carta', texto: string) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(cual); window.setTimeout(() => setCopiado(null), 2500); }
    catch { setCopiado(null); /* el texto sigue visible abajo para copiarlo a mano */ }
  };

  return (
    <Drawer abierto={abierto} onCerrar={onCerrar} titulo={t('op.como_conseguirlo')} tamano="l"
      descripcion={t('op.dos_textos_listos_para_mandar_la')}>
      <div className="rv-pem__texto-bloque">
        <h3>{t('op.para_el_area_de_sistemas')}</h3>
        <textarea readOnly rows={11} value={solicitud} aria-label={t('op.solicitud_para_el_area_de_sistemas')} />
        <Boton variante="primary" icono={<Copy />} onClick={() => copiar('solicitud', solicitud)}>
          {copiado === 'solicitud' ? 'Copiado' : `Copiar solicitud para ${responsables.ti_tms}`}
        </Boton>
      </div>
      <div className="rv-pem__texto-bloque">
        <h3>{t('op.para_gerencia')}</h3>
        <textarea readOnly rows={10} value={carta} aria-label={t('op.carta_de_autorizacion_para_gerencia')} />
        <Boton variante="secondary" icono={<Copy />} onClick={() => copiar('carta', carta)}>
          {copiado === 'carta' ? 'Copiado' : t('op.copiar_carta_de_autorizacion')}
        </Boton>
      </div>
    </Drawer>
  );
}
