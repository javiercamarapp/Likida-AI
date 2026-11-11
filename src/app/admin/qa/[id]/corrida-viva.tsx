'use client';

// ═══════════════════════════════════════════════════════════════════════════
// LA CORRIDA EN VIVO + EL VEREDICTO — /admin/qa/<id> (Fase A).
//
// Polling corto (2.5 s, diseño §2.b) contra /api/admin/qa/<id>/estado
// mientras la corrida sigue viva; para al llegar a un estado terminal. El
// veredicto usa el formato de tabla del diseño del ejército
// (INVARIANTE / ESTADO / SEVERIDAD) con cada fila expandible: esperado vs
// real —el mismo patrón esperado/real de sobre_politica—, la conversación
// como burbujas de solo lectura, las fotos y el PDF con URL firmada.
//
// Fallar cerrado en la lectura: si el polling no puede leer, se dice; si el
// motor lleva >90 s sin latido y sigue "corriendo", se dice que pudo haber
// muerto sin escribir su aborto — nunca un spinner eterno con cara de avance.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, FileText, MessageCircle } from 'lucide-react';
import { fechaHoraMx, usd4 } from '@/lib/formato';
import { Aviso, BotonEnlace, Disclosure, EstadoError, Icono, StatusChip, Tarjeta, TablaBase, type ColumnaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { EsqueletoFicha } from '@/app/ui-v2/esqueletos';
import { TiraCifras } from '@/app/ui-v2/graficas';
import '../qa.css';
import { pillCorrida } from '../pantalla';
import { escenarioPorId } from '@/lib/admin/qa-escenarios';
import type { CorridaQA, EstadoPaso, PasoQA, FilaVeredicto } from '@/lib/admin/qa-tipos';
import type { ResumenPrecisionCorrida } from '@/lib/admin/qa-verdad';
import { MedicionCorrida } from './medicion-corrida';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { rico } from '@/lib/i18n/rico';

export interface FotoFirmada { id: string; etiqueta: string; url: string | null }
export interface PdfFirmado { path: string; url: string | null }

const pillPaso = (tx: TSistema = T_SISTEMA_ES): Record<EstadoPaso, { estado: TonoEstado; etiqueta: string }> => ({
  pendiente: { estado: 'neutral', etiqueta: tx('qa_corrida_viva.pendiente') },
  corriendo: { estado: 'neutral', etiqueta: tx('qa_corrida_viva.corriendo') },
  ok: { estado: 'ok', etiqueta: 'ok' },
  warn: { estado: 'warn', etiqueta: 'warn' },
  bad: { estado: 'bad', etiqueta: 'bad' },
});

const pillOraculo = (tx: TSistema = T_SISTEMA_ES): Record<'ok' | 'fallo' | 'no_verificado', { estado: TonoEstado; etiqueta: string }> => ({
  ok: { estado: 'ok', etiqueta: 'ok' },
  fallo: { estado: 'bad', etiqueta: tx('qa_corrida_viva.fallo') },
  no_verificado: { estado: 'warn', etiqueta: tx('qa_corrida_viva.no_verificado') },
});

const TERMINALES = new Set(['ok', 'parcial', 'fallo', 'abortada']);

function json(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 1);
}

function CuerpoCorrida({ corridaInicial, fotosIniciales, pdfsIniciales, medicionInicial = null, medicionErrorInicial = null }: {
  corridaInicial: CorridaQA;
  fotosIniciales: FotoFirmada[];
  pdfsIniciales: PdfFirmado[];
  medicionInicial?: ResumenPrecisionCorrida | null;
  medicionErrorInicial?: string | null;
}) {
  const { t: tx, idioma } = useT('admin_sistema', admin_sistemaEs);
  const [corrida, setCorrida] = useState(corridaInicial);
  const [fotos, setFotos] = useState(fotosIniciales);
  const [pdfs, setPdfs] = useState(pdfsIniciales);
  const [medicion, setMedicion] = useState<ResumenPrecisionCorrida | null>(medicionInicial);
  const [medicionError, setMedicionError] = useState<string | null>(medicionErrorInicial);
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  // FE-20: `useState(() => Date.now())` se evalúa en el SERVIDOR al pintar el
  // HTML y otra vez en el NAVEGADOR al hidratar, con dos relojes distintos —
  // React reporta mismatch y "lleva Ns sin dar señales" salta a otro número
  // delante de quien lo está leyendo. `null` hasta que el efecto lo llene: en
  // el primer render los dos lados coinciden porque ninguno tiene reloj, y el
  // aviso de "pudo haber muerto" simplemente no se pinta todavía (no afirma
  // nada en falso, que es la regla).
  const [ahora, setAhora] = useState<number | null>(null);

  const viva = !TERMINALES.has(corrida.estado);

  // El primer reloj, ya en el cliente. Va aparte del polling para que también
  // lo tenga una corrida TERMINADA (donde el intervalo no arranca).
  //
  // Dentro de un `setTimeout` y no en el cuerpo del efecto: `setAhora(...)`
  // síncrono ahí dispara un render en cascada y lo prohíbe
  // `react-hooks/set-state-in-effect` — la regla pide que el estado se mueva
  // desde el CALLBACK de la fuente externa, y aquí la fuente externa es el
  // reloj. Cero de retraso: aterriza en el tick inmediatamente posterior a la
  // hidratación, con el HTML ya idéntico al del servidor, que es todo lo que
  // este arreglo necesita.
  useEffect(() => {
    const t = setTimeout(() => setAhora(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!viva) return;
    const timer = setInterval(async () => {
      setAhora(Date.now());
      try {
        const res = await fetch(`/api/admin/qa/${corrida.id}/estado`, { cache: 'no-store' });
        const cuerpo = await res.json().catch(() => null) as {
          corrida?: CorridaQA; fotos?: FotoFirmada[]; pdfs?: PdfFirmado[];
          medicion?: ResumenPrecisionCorrida | null; medicionError?: string | null; error?: string;
        } | null;
        if (!res.ok || !cuerpo?.corrida) {
          setErrorLectura(cuerpo?.error ?? tx('qa_corrida_viva.no_se_pudo_leer_el_estado', { status: res.status }));
          return;
        }
        setErrorLectura(null);
        setCorrida(cuerpo.corrida);
        if (cuerpo.fotos) setFotos(cuerpo.fotos);
        if (cuerpo.pdfs) setPdfs(cuerpo.pdfs);
        // Una medición ya pintada NO se borra por un poll que venga sin ella:
        // sería cambiar una medición por la ausencia de una.
        if (cuerpo.medicion) setMedicion(cuerpo.medicion);
        setMedicionError(cuerpo.medicionError ?? null);
      } catch (e) {
        setErrorLectura(e instanceof Error ? e.message : String(e));
      }
    }, 2_500);
    return () => clearInterval(timer);
  }, [viva, corrida.id, tx]);

  // ═════════════════════════════════════════════════════════════════════════
  // EL CARRIL COMPLETO — esta pantalla es la que EMPUJA las pasadas.
  //
  // Una corrida de 91 fotos no cabe en una invocación, así que avanza en
  // pasadas y alguien tiene que pedir la siguiente. Lo hace aquí y no un cron
  // a propósito: la corrida es una herramienta de QA que se mira mientras
  // corre, y un cron cada N minutos convertiría siete pasadas en media hora de
  // espera. El precio está DICHO en pantalla (si cierras esto, la corrida se
  // queda pausada donde iba, sin perder nada).
  //
  // El candado contra dos empujones a la vez no vive aquí: la ruta toma la
  // corrida con un UPDATE condicional y la segunda llamada responde sin
  // gastar. El `ref` sólo evita el ruido de pedirlo mil veces.
  // ═════════════════════════════════════════════════════════════════════════
  const empujando = useRef(false);
  const [avisoPasada, setAvisoPasada] = useState<string | null>(null);
  const [errorPasada, setErrorPasada] = useState<string | null>(null);

  useEffect(() => {
    if (!viva || corrida.carril !== 'completo') return;
    let montado = true;
    const empujar = async () => {
      if (empujando.current || !montado) return;
      empujando.current = true;
      try {
        const res = await fetch(`/api/admin/qa/${corrida.id}/continuar`, { method: 'POST', cache: 'no-store' });
        const cuerpo = await res.json().catch(() => null) as { motivo?: string; error?: string } | null;
        if (!montado) return;
        if (!res.ok) {
          setErrorPasada(cuerpo?.error ?? tx('qa_corrida_viva.la_pasada_no_pudo_correr_http', { status: res.status }));
          return;
        }
        setErrorPasada(null);
        setAvisoPasada(cuerpo?.motivo ?? null);
      } catch (e) {
        if (montado) setErrorPasada(e instanceof Error ? e.message : String(e));
      } finally {
        empujando.current = false;
      }
    };
    // El primer empujón sale del `setTimeout` y no del cuerpo del efecto, por
    // la misma razón que el reloj de arriba: la regla `set-state-in-effect`
    // pide que el estado se mueva desde el callback de la fuente externa.
    const t = setTimeout(() => { void empujar(); }, 0);
    const timer = setInterval(() => { void empujar(); }, 5_000);
    return () => { montado = false; clearTimeout(t); clearInterval(timer); };
  }, [viva, corrida.carril, corrida.id, tx]);

  const pill = pillCorrida(tx)[corrida.estado] ?? { estado: 'neutral' as TonoEstado, etiqueta: corrida.estado };
  const sinLatidoS = useMemo(() => {
    if (ahora === null) return null;   // todavía sin reloj del cliente
    const t = new Date(corrida.latidoEn).getTime();
    return Number.isFinite(t) ? Math.round((ahora - t) / 1000) : null;
  }, [corrida.latidoEn, ahora]);
  const enPasada = corrida.pasadaEnVuelo !== null;
  // «Sin señales» sólo alarma cuando de verdad DEBERÍA haberlas: en el carril
  // rápido siempre, y en el completo únicamente mientras una pasada tiene la
  // corrida tomada. Una corrida completa PAUSADA entre pasadas no da señales y
  // eso no es que se haya muerto — pintarlo en rojo enseñaría a ignorar el
  // aviso, que es la peor manera de perder una alarma que sí importa.
  const posiblementeMuerta = viva && sinLatidoS !== null && sinLatidoS > 90
    && (corrida.carril === 'rapido' || enPasada);
  const av = corrida.avance;

  const columnasPasos: ColumnaBase<PasoQA>[] = [
    { id: 'n', titulo: '#', principal: true, celda: (p) => <span className="rv-qa-mono">{p.n}</span> },
    {
      id: 'paso', titulo: tx('qa_corrida_viva.la_corrida_paso_a_paso'),
      celda: (p) => (<>{p.nombre}{p.detalle && <span className="rv-qa-detalle">{p.detalle}</span>}</>),
    },
    { id: 'costo', titulo: tx('qa_pantalla.costo_real'), alinear: 'der', celda: (p) => (p.costoUsd > 0 ? usd4(p.costoUsd) : '—') },
    {
      id: 'estado', titulo: tx('salud_sistema.estado'),
      celda: (p) => { const pp = pillPaso(tx)[p.estado] ?? pillPaso(tx).pendiente; return <StatusChip tono={pp.estado}>{pp.etiqueta}</StatusChip>; },
    },
  ];
  const columnasVeredicto: ColumnaBase<FilaVeredicto>[] = [
    {
      id: 'invariante', titulo: tx('qa_corrida_viva.invariante'), principal: true,
      celda: (v) => (
        <Disclosure variante="linea" titulo={v.invariante}>
          <div className="rv-qa-pila rv-qa-pila--corta">
            <div>
              <strong>{tx('qa_corrida_viva.esperado')}</strong>{' '}
              <code className="rv-qa-mono">{json(v.esperado)}</code>
            </div>
            <div>
              <strong>{tx('qa_corrida_viva.real')}</strong>{' '}
              <code className="rv-qa-mono">{json(v.real)}</code>
            </div>
            {v.detalle && <div className="rv-qa-mut">{v.detalle}</div>}
            <div className="rv-qa-mono rv-qa-tenue">{v.oraculo}</div>
          </div>
        </Disclosure>
      ),
    },
    { id: 'estado', titulo: tx('salud_sistema.estado'), celda: (v) => { const pv = pillOraculo(tx)[v.estado]; return <StatusChip tono={pv.estado}>{pv.etiqueta}</StatusChip>; } },
    { id: 'severidad', titulo: tx('trust_safety.severidad'), celda: (v) => (v.estado === 'ok' ? '—' : v.severidad) },
  ];

  return (
    <div className="rv-qa-pila">
      {/* ── Avisos de lectura (fallar cerrado, dicho) ─────────────────── */}
      {errorLectura && <Aviso tono="error">{tx('qa_corrida_viva.no_se_pudo_leer_el_estado_2', { errorLectura })}</Aviso>}
      {posiblementeMuerta && <Aviso tono="error">{tx('qa_corrida_viva.el_motor_lleva_s_sin_dar', { sinLatidoS, tenantNombre: corrida.tenantNombre })}</Aviso>}

      {/* ── El renglón resumen ────────────────────────────────────────── */}
      <TiraCifras
        etiqueta={tx('qa_corrida_viva.calidad')}
        items={[
          {
            etiqueta: tx('salud_sistema.estado'), valor: pill.etiqueta, nota: corrida.motivo ?? undefined,
            tono: pill.estado === 'ok' || pill.estado === 'warn' || pill.estado === 'bad' ? pill.estado : undefined,
          },
          {
            etiqueta: tx('qa_corrida_viva.carril'),
            valor: corrida.carril === 'completo' ? tx('qa_corrida_viva.completo_en_varias_pasadas') : tx('qa_corrida_viva.rapido_en_un_solo_proceso'),
            nota: corrida.carril === 'completo'
              ? `${tx('qa_corrida_viva.pasada', { pasadas: corrida.pasadas })} ${enPasada ? tx('qa_corrida_viva.trabajando_ahora') : viva ? tx('qa_corrida_viva.pausada_entre_pasadas') : 'terminada'}`
              : undefined,
          },
          { etiqueta: tx('qa_corrida_viva.costo_hasta_ahora_real'), valor: usd4(corrida.costoUsdTotal ?? 0), nota: tx('qa_corrida_viva.costo_registrado_nunca_estimado') },
          {
            etiqueta: tx('qa_corrida_viva.flota_de_prueba'), valor: corrida.tenantNombre,
            nota: `${corrida.inicio ? tx('qa_corrida_viva.inicio', { v: fechaHoraMx(corrida.inicio, idioma) }) : tx('qa_corrida_viva.sin_arrancar')}${corrida.fin ? ` · ${tx('qa_corrida_viva.fin', { v: fechaHoraMx(corrida.fin, idioma) })}` : ''}`,
          },
        ]}
      />

      {/* ── EL AVANCE DEL CARRIL COMPLETO ─────────────────────────────
          Cuántas van, cuántas faltan, y —si se cortó— POR QUÉ y CUÁLES
          quedaron sin turno. Todo medido: cada número sale de una fila de
          `qa_corrida_foto`, ninguno de una resta a ojo. */}
      {corrida.carril === 'completo' && av !== null && (
        <Tarjeta titulo={tx('qa_corrida_viva.el_avance_foto_por_foto')}>
          <div className="rv-qa-pila rv-qa-pila--corta">
            <div className="rv-qa-avance">
              <div className="rv-qa-gran tabular">{rico(tx('qa_corrida_viva.e0_de_fotos_procesadas_e0', { ok: av.ok, total: av.total }), { e0: (c) => <span className="rv-qa-gran__sub">{c}</span> })}</div>
              {av.sinTurno > 0 && <span className="rv-qa-mut">{tx('qa_corrida_viva.sin_turno_todavia', { sinTurno: av.sinTurno })}</span>}
              {av.enVuelo > 0 && <span className="rv-qa-mut">{tx('qa_corrida_viva.en_vuelo', { enVuelo: av.enVuelo })}</span>}
              {av.bad > 0 && <span className="rv-qa-bad">{tx('qa_corrida_viva.con_fallo', { bad: av.bad })}</span>}
              {av.interrumpidas > 0 && (
                <span className="rv-qa-warn">{tx(av.interrumpidas === 1 ? 'qa_corrida_viva.interrumpida_una' : 'qa_corrida_viva.interrumpida_varias', { interrumpidas: av.interrumpidas })}{' '}{tx('qa_corrida_viva.una_pasada_murio_con_ellas_en')}</span>
              )}
            </div>
            <progress className="rv-qa-barra" value={av.ok + av.bad} max={Math.max(av.total, 1)} aria-label={tx('qa_corrida_viva.avance_de_la_corrida')} />

            {corrida.corte !== null && (
              <Aviso tono={corrida.corte === 'dinero' ? 'error' : 'warn'}>
                {corrida.corte === 'dinero'
                  ? tx('qa_corrida_viva.la_ultima_pasada_paro_por_dinero')
                  : tx('qa_corrida_viva.la_ultima_pasada_paro_por_reloj')}
              </Aviso>
            )}

            {av.sinTurnoIds.length > 0 && (
              <Disclosure variante="linea" titulo={tx('qa_corrida_viva.las_que_no_han_tenido_turno', { length: av.sinTurnoIds.length })}>
                <ul className="rv-qa-lista rv-qa-lista--alta">
                  {av.sinTurnoIds.map((fid) => (
                    <li key={fid} className="rv-qa-trunca">{fotos.find((f) => f.id === fid)?.etiqueta ?? fid}</li>
                  ))}
                </ul>
              </Disclosure>
            )}

            {viva && <p className="rv-qa-nota">{tx('qa_corrida_viva.esta_pantalla_es_la_que_empuja')}</p>}
            {avisoPasada && <p className="rv-qa-nota rv-qa-mono">{avisoPasada}</p>}
            {errorPasada && <Aviso tono="error">{tx('qa_corrida_viva.la_pasada_no_pudo_correr', { errorPasada })}</Aviso>}
          </div>
        </Tarjeta>
      )}

      {/* ── Los pasos (el ledger en vivo) ─────────────────────────────── */}
      <Tarjeta
        titulo={tx('qa_corrida_viva.la_corrida_paso_a_paso')}
        estado={corrida.pasos.length === 0 ? 'vacio' : 'ok'}
        mensaje={tx('qa_corrida_viva.todavia_no_arranca_el_primer_paso')}
        detalle={viva ? tx('qa_corrida_viva.esta_pantalla_se_actualiza_sola_cada') : undefined}
      >
        <TablaBase etiqueta={tx('qa_corrida_viva.la_corrida_paso_a_paso')} columnas={columnasPasos} filas={corrida.pasos} idFila={(p) => String(p.n)} densa altoMaximo={false} />
      </Tarjeta>

      {/* ── El veredicto ──────────────────────────────────────────────── */}
      <Tarjeta
        titulo={tx('qa_corrida_viva.el_veredicto_el_llm_explora_el')}
        estado={corrida.veredicto === null ? 'vacio' : 'ok'}
        mensaje={viva ? tx('qa_corrida_viva.los_oraculos_corren_al_final_de') : tx('qa_corrida_viva.esta_corrida_termino_sin_veredicto_los')}
      >
        {corrida.veredicto !== null && (
          <TablaBase etiqueta={tx('qa_corrida_viva.veredicto_por_invariante')} columnas={columnasVeredicto} filas={corrida.veredicto} idFila={(v) => v.invariante} altoMaximo={false} />
        )}
      </Tarjeta>

      {/* ── La precisión del OCR, medida ──────────────────────────────── */}
      <MedicionCorrida medicion={medicion} error={medicionError} fotos={fotos} viva={viva} />

      {/* ── Evidencia clicable ────────────────────────────────────────── */}
      <div className="rv-qa-dos">
        <Tarjeta
          titulo={tx('qa_corrida_viva.la_conversacion_evidencia_solo_lectura')}
          estado={corrida.turnos.length === 0 ? 'vacio' : 'ok'}
          mensaje={viva ? tx('qa_corrida_viva.los_turnos_aparecen_al_cierre_de') : tx('qa_corrida_viva.no_quedo_conversacion_registrada')}
        >
          <div className="rv-qa-chat">
            {corrida.turnos.map((t, i) => (
              <div key={i} className={t.rol === 'user' ? 'rv-qa-fila-chat rv-qa-fila-chat--user' : 'rv-qa-fila-chat'}>
                <div className={t.rol === 'user' ? 'rv-qa-burbuja rv-qa-burbuja-user' : 'rv-qa-burbuja rv-qa-burbuja-bot'}>
                  <span className="rv-qa-burbuja__quien">
                    <Icono icono={MessageCircle} tam={14} /> {t.rol === 'user' ? tx('qa_corrida_viva.chofer_sintetico') : 'Likida'}
                  </span>
                  <div>{t.texto}</div>
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>

        <Tarjeta titulo={tx('qa_corrida_viva.fotos_y_pdf_de_esta_corrida')}>
          <ul className="rv-qa-evidencia">
            {fotos.map((f) => (
              <li key={f.id}>
                <span className="rv-qa-evidencia__nombre"><Icono icono={Camera} tam={14} /><span className="rv-qa-trunca">{f.etiqueta}</span></span>
                {f.url ? (
                  <BotonEnlace href={f.url} variante="secondary" tamano="sm" target="_blank" rel="noreferrer">{tx('qa_corrida_viva.abrir_firma_60_s')}</BotonEnlace>
                ) : (
                  <span className="rv-qa-tenue">{tx('qa_corrida_viva.sin_firma')}</span>
                )}
              </li>
            ))}
            {(corrida.pdfs ?? []).length === 0 ? (
              <li className="rv-qa-nota">
                {viva ? tx('qa_corrida_viva.el_pdf_aparece_si_el_cierre') : tx('qa_corrida_viva.no_quedo_pdf_registrado_en_esta')}
              </li>
            ) : (
              pdfs.map((p) => (
                <li key={p.path}>
                  <span className="rv-qa-evidencia__nombre"><Icono icono={FileText} tam={14} /><span className="rv-qa-trunca rv-qa-mono">{p.path.split('/').pop()}</span></span>
                  {p.url ? (
                    <BotonEnlace href={p.url} variante="secondary" tamano="sm" target="_blank" rel="noreferrer">{tx('qa_corrida_viva.abrir_pdf_firma_60_s')}</BotonEnlace>
                  ) : (
                    <span className="rv-qa-tenue">{tx('qa_corrida_viva.borrado_con_el_tenant_retencion_conservar')}</span>
                  )}
                </li>
              ))
            )}
          </ul>
        </Tarjeta>
      </div>

      {/* ── La limpieza, dicha ────────────────────────────────────────── */}
      {corrida.limpieza && (
        <Aviso tono="info">{rico(tx('qa_corrida_viva.e0_limpieza_e0', { limpieza: corrida.limpieza }), { e0: (c) => <strong>{c}</strong> })}</Aviso>
      )}
    </div>
  );
}

/** La pantalla de una corrida: UN solo marco (esqueleto de ficha). Si la lectura de la corrida falló (`errorLectura`), lo dice en lugar del cuerpo: no es que no exista, es que no se pudo mirar. */
export function CorridaViva({ corridaInicial = null, errorLectura = null, ...resto }: {
  corridaInicial?: CorridaQA | null;
  errorLectura?: string | null;
  fotosIniciales?: FotoFirmada[];
  pdfsIniciales?: PdfFirmado[];
  medicionInicial?: ResumenPrecisionCorrida | null;
  medicionErrorInicial?: string | null;
}) {
  const { t: tx } = useT('admin_sistema', admin_sistemaEs);
  return (
    <EsqueletoFicha
      area={tx('qa_corrida_viva.calidad')}
      volver={{ href: '/admin/qa', etiqueta: tx('qa_corrida_viva.volver_a_pruebas_reales') }}
      titulo={corridaInicial ? tx('qa_corrida_viva.corrida', { v: corridaInicial.id.slice(0, 8) }) : tx('qa_corrida_viva.calidad')}
      apoyo={corridaInicial
        ? tx('qa_corrida_viva.escenario_el_avance_el_veredicto_y', { v: escenarioPorId(corridaInicial.escenario)?.nombre ?? corridaInicial.escenario })
        : tx('qa_corrida_viva.la_corrida_de_pruebas_reales_no')}
    >
      {corridaInicial ? (
        <CuerpoCorrida corridaInicial={corridaInicial} fotosIniciales={resto.fotosIniciales ?? []} pdfsIniciales={resto.pdfsIniciales ?? []} medicionInicial={resto.medicionInicial} medicionErrorInicial={resto.medicionErrorInicial} />
      ) : (
        <EstadoError reintentar>{tx('qa_corrida_viva.no_se_pudo_leer_la_corrida', { v: errorLectura ?? '' })}</EstadoError>
      )}
    </EsqueletoFicha>
  );
}
