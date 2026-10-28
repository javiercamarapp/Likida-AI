'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import {
  AlertTriangle, Ban, Check, ChevronDown, CircleDashed, Clock3, Copy, FileUp, HelpCircle, Hourglass, Lock, Mail, User,
} from 'lucide-react';
import {
  Aviso, Boton, BotonEnlace, Chip, Drawer, EncabezadoPagina, type TonoChip,
} from '@/app/ui-v2/componentes';
import { ProgresoAnillo } from '@/app/ui-v2/graficas';
import { anclaTour, TourLanzador } from '@/app/ui-v2/movimiento/tour';
import {
  armarPasosCincoAgentes, ROTULO_ESTADO, RESPONSABLES_POR_OMISION,
  type Declaraciones, type EstadoAsistente, type IdPaso, type PasoAsistente, type Responsables, type SenalesAsistente,
} from '@/lib/likida/asistente/pasos_cinco_agentes';
import { cartaAutorizacion, solicitudParaTi } from '@/lib/likida/asistente/textos_solicitud';
import {
  guardarDeclaraciones, leerDeclaraciones, nombreCookieAvance, valorCookieAvance, claveProgreso,
} from './progreso';
import { enviarPruebaCorreo, type ResultadoPruebaCorreo } from './acciones';

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

const EVENTO = 'likida-asistente-cambio';

/** Snapshot crudo del almacenamiento (string primitivo = estable para useSyncExternalStore). */
function suscribir(fn: () => void): () => void {
  window.addEventListener('storage', fn);
  window.addEventListener(EVENTO, fn);
  return () => { window.removeEventListener('storage', fn); window.removeEventListener(EVENTO, fn); };
}
function almacen(): Storage | null {
  try { return window.localStorage; } catch { return null; }
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
  const crudo = useSyncExternalStore(
    suscribir,
    () => { try { return almacen()?.getItem(claveProgreso(ambito)) ?? ''; } catch { return ''; } },
    () => '',
  );
  const declaraciones = useMemo<Declaraciones>(() => {
    if (!crudo) return {};
    return leerDeclaraciones({ getItem: () => crudo, setItem: () => {}, removeItem: () => {} }, ambito);
  }, [crudo, ambito]);

  const r = useMemo(() => armarPasosCincoAgentes(senales, declaraciones, responsables), [senales, declaraciones, responsables]);
  const [elegido, setElegido] = useState<IdPaso | null>(pasoInicial ?? null);
  const idActual: IdPaso = elegido ?? r.siguiente ?? r.rutaCritica[0].id;
  const actual = [...r.rutaCritica, ...r.despues].find((p) => p.id === idActual)!;

  const cambiar = useCallback((siguiente: Declaraciones) => {
    if (soloLectura) return;
    guardarDeclaraciones(almacen(), ambito, siguiente);
    window.dispatchEvent(new Event(EVENTO));
  }, [ambito, soloLectura]);

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
        rotulo="Puesta en marcha"
        titulo="Deja lista tu operación"
        descripcion="Seis pasos para que tus agentes trabajen con tus datos reales. Aquí ves qué falta y de quién es."
        acciones={<SoloV2><TourLanzador recorridoId="dueno" etiqueta="Ver recorrido" /></SoloV2>}
      />

      {soloLectura && (
        <Aviso tono="info" className="rv-pem__aviso">Estás viendo esta cuenta como superadmin: puedes revisar todo, pero tus confirmaciones no se guardan.</Aviso>
      )}

      <div className="rv-pem__cuerpo">
        <aside className="rv-pem__lateral" aria-label="Tus pasos">
          <section className="rv-pem__avance" {...anclaTour('asistente.avance')}>
            <ProgresoAnillo valor={r.avance} tamano={76} grosor={7} etiqueta="Avance de la puesta en marcha" />
            <div>
              <p className="rv-pem__avance-num">{r.listos} de {r.total}</p>
              <p className="rv-pem__avance-txt">
                {r.listoParaOperar ? 'Todo listo para operar.' : r.listos === 0 ? 'Aún no hay pasos terminados.' : 'pasos terminados'}
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
              <ChevronDown width={14} height={14} aria-hidden="true" />
              Después <span>({r.despues.length})</span>
            </summary>
            <p className="rv-pem__despues-nota">No hacen falta para empezar y no cuentan en el avance.</p>
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
        <p className="rv-pem__paso-rotulo etiqueta-mono">{paso.numero ? `Paso ${paso.numero}` : 'Después'}</p>
        <h2 className="rv-pem__paso-titulo font-display">{paso.titulo}</h2>
        <p className="rv-pem__paso-resumen">{paso.resumen}</p>
        <div className="rv-pem__paso-estado">
          <EstadoChip estado={paso.estado} />
          {paso.faltaDe && <span className="rv-pem__falta"><User width={13} height={13} aria-hidden="true" /> {paso.faltaDe}</span>}
        </div>
      </header>

      {paso.causa && <Aviso tono="warn" titulo="Qué pasó">{paso.causa}</Aviso>}

      <p className="rv-pem__evidencia" data-tipo={paso.evidencia.tipo}>
        <span className="rv-pem__evidencia-sello">{paso.evidencia.tipo === 'medido' ? 'Lo vimos nosotros' : paso.evidencia.tipo === 'declarado' ? 'Lo dijiste tú' : 'Sin comprobar'}</span>
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
        ? <Aviso tono="ok" titulo="Prueba enviada">Te mandamos un correo a {prueba.destino}. Revisa tu bandeja y, si no, la carpeta de spam.</Aviso>
        : <Aviso tono="error" titulo="No salió la prueba">{prueba.error}</Aviso>)}

      <div className="rv-pem__acciones">
        {paso.accion && !declaraciones.omitidos?.[paso.id] && (
          <BotonEnlace variante="primary" href={`${paso.accion.href}${sufijo}`} icono={paso.id === 'tms' ? <FileUp /> : undefined}>
            {paso.accion.texto}
          </BotonEnlace>
        )}
        {paso.id === 'tms' && (
          <Boton variante="secondary" onClick={() => setDrawer(true)} {...anclaTour('asistente.como-conseguirlo')}>Cómo conseguirlo</Boton>
        )}
        {paso.id === 'correo' && paso.estado !== 'en_espera' && (
          <Boton
            variante="secondary" icono={<Mail />} loading={enviando}
            onClick={() => iniciar(async () => { setPrueba(await enviarPruebaCorreo()); })}
          >Mandarme una prueba</Boton>
        )}
        {paso.declara && !soloLectura && (
          <Boton variante="secondary" onClick={() => onCambiar({ ...declaraciones, [paso.declara!]: true })}>
            {paso.declara === 'correoRecibido' ? 'Sí, me llegó' : paso.declara === 'simulacroVisto' ? 'Ya lo hice y funcionó' : 'Ya invité a mi equipo'}
          </Boton>
        )}
      </div>

      {!soloLectura && paso.numero !== null && paso.estado !== 'listo' && (
        declaraciones.omitidos?.[paso.id] ? (
          <p className="rv-pem__omitir">Omitido por ti: «{declaraciones.omitidos[paso.id]}». <button type="button" className="rv-pem__enlace" onClick={quitarOmitido}>Quitar</button></p>
        ) : omitiendo ? (
          <form className="rv-pem__omitir-form" onSubmit={(e) => {
            e.preventDefault();
            const m = motivo.trim();
            if (!m) return;
            onCambiar({ ...declaraciones, omitidos: { ...declaraciones.omitidos, [paso.id]: m } });
            setOmitiendo(false); setMotivo('');
          }}>
            <label htmlFor="pem-motivo">¿Por qué lo omites?</label>
            <input id="pem-motivo" value={motivo} maxLength={140} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. lo resuelve otra área" />
            <Boton type="submit" tamano="sm" variante="secondary" disabled={!motivo.trim()}>Omitir</Boton>
            <Boton tamano="sm" variante="ghost" onClick={() => setOmitiendo(false)}>Cancelar</Boton>
          </form>
        ) : (
          <button type="button" className="rv-pem__enlace" onClick={() => setOmitiendo(true)}>Omitir este paso</button>
        )
      )}

      {paso.id === 'tms' && (
        <DrawerSolicitud abierto={drawer} onCerrar={() => setDrawer(false)} responsables={responsables} />
      )}
    </article>
  );
}

function DrawerSolicitud({ abierto, onCerrar, responsables }: { abierto: boolean; onCerrar: () => void; responsables: Responsables }) {
  const nombres = { paraTi: responsables.ti_tms, gerencia: responsables.gerencia, flota: 'nuestra flota' };
  const solicitud = solicitudParaTi(nombres);
  const carta = cartaAutorizacion(nombres);
  const [copiado, setCopiado] = useState<'solicitud' | 'carta' | null>(null);

  const copiar = async (cual: 'solicitud' | 'carta', texto: string) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(cual); window.setTimeout(() => setCopiado(null), 2500); }
    catch { setCopiado(null); /* el texto sigue visible abajo para copiarlo a mano */ }
  };

  return (
    <Drawer abierto={abierto} onCerrar={onCerrar} titulo="Cómo conseguirlo" tamano="l"
      descripcion="Dos textos listos para mandar. La contraseña nunca va por correo ni por chat.">
      <div className="rv-pem__texto-bloque">
        <h3>Para el área de sistemas</h3>
        <textarea readOnly rows={11} value={solicitud} aria-label="Solicitud para el área de sistemas" />
        <Boton variante="primary" icono={<Copy />} onClick={() => copiar('solicitud', solicitud)}>
          {copiado === 'solicitud' ? 'Copiado' : `Copiar solicitud para ${responsables.ti_tms}`}
        </Boton>
      </div>
      <div className="rv-pem__texto-bloque">
        <h3>Para gerencia</h3>
        <textarea readOnly rows={10} value={carta} aria-label="Carta de autorización para gerencia" />
        <Boton variante="secondary" icono={<Copy />} onClick={() => copiar('carta', carta)}>
          {copiado === 'carta' ? 'Copiado' : 'Copiar carta de autorización'}
        </Boton>
      </div>
    </Drawer>
  );
}
