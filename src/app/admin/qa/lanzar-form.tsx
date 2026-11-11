'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EL FORMULARIO DE LANZAR — /admin/qa.
//
// Sube N fotos DE GOLPE (input multiple + arrastrar y soltar: el pedido
// literal es "cantidad obscena de tickets"), elige escenario (feliz / guion
// del demo), edita anticipo/RFC/ruta/política precargados, y lanza el carril
// rápido. El botón deshabilitado SIEMPRE dice su motivo (diseño §2.a) — la
// misma validación del servidor (`validarLanzar`, qa-tipos.ts) corre aquí
// para que el motivo sea idéntico al candado real.
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Play, Trash2, Plus } from 'lucide-react';
import { Aviso, Boton, Casilla, CampoTexto, Fieldset, Icono, Radio, Tarjeta, Tooltip } from '@/app/ui-v2/componentes';
import '../qa/qa.css';
import { escenarioPorId, ESCENARIOS_QA } from '@/lib/admin/qa-escenarios';
import { usd, usd4 } from '@/lib/formato';
import {
  validarLanzar, carrilPara, MAX_FOTOS_CARRIL_RAPIDO, TECHO_PASADA_MS,
  type EscenarioId, type FotoBanco,
} from '@/lib/admin/qa-tipos';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';
import { rico } from '@/lib/i18n/rico';

export type FotoConUrl = FotoBanco & { url: string | null };

interface FilaPolitica { concepto: string; topeMonto: string; requiereCfdi: boolean }

function politicaAFilas(politica: Array<{ concepto: string; topeMonto?: number; requiereCfdi?: boolean }>): FilaPolitica[] {
  return politica.map((p) => ({
    concepto: p.concepto,
    topeMonto: p.topeMonto !== undefined ? String(p.topeMonto) : '',
    requiereCfdi: Boolean(p.requiereCfdi),
  }));
}

export function LanzarForm({ fotosIniciales, bancoError, gastoHoyUsd, gastoError, topeDiaUsd, topeCorridaUsd }: {
  fotosIniciales: FotoConUrl[];
  bancoError: string | null;
  gastoHoyUsd: number | null;
  gastoError: string | null;
  topeDiaUsd: number;
  /** El tope POR corrida (config.qa.ts del ejército). Llega como prop y no
   *  por import: este archivo es 'use client' y aquel módulo trae `node:path`
   *  y `process.cwd()` — importarlo aquí metería node al bundle del navegador. */
  topeCorridaUsd: number;
}) {
  const { t, tp } = useT('admin_sistema', admin_sistemaEs);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const escenarioInicial = escenarioPorId('demo_guion')!;

  const [fotos, setFotos] = useState<FotoConUrl[]>(fotosIniciales);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [escenario, setEscenario] = useState<EscenarioId>('demo_guion');
  const [anticipo, setAnticipo] = useState(escenarioInicial.anticipoDefault !== null ? String(escenarioInicial.anticipoDefault) : '');
  const [rfc, setRfc] = useState(escenarioInicial.rfcEmpresaDefault ?? '');
  const [origen, setOrigen] = useState(escenarioInicial.rutaDefault.origen);
  const [destino, setDestino] = useState(escenarioInicial.rutaDefault.destino);
  const [politica, setPolitica] = useState<FilaPolitica[]>(politicaAFilas(escenarioInicial.politicaDefault));
  const [conservar, setConservar] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [lanzando, setLanzando] = useState(false);
  const [avisosSubida, setAvisosSubida] = useState<string[]>([]);
  const [errorLanzar, setErrorLanzar] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  const elegirEscenario = (id: EscenarioId) => {
    const def = escenarioPorId(id);
    if (!def) return;
    setEscenario(id);
    setAnticipo(def.anticipoDefault !== null ? String(def.anticipoDefault) : '');
    setRfc(def.rfcEmpresaDefault ?? '');
    setOrigen(def.rutaDefault.origen);
    setDestino(def.rutaDefault.destino);
    setPolitica(politicaAFilas(def.politicaDefault));
  };

  const alternarFoto = (id: string) => {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const subirArchivos = async (archivos: FileList | File[]) => {
    const lista = Array.from(archivos);
    if (lista.length === 0) return;
    setSubiendo(true);
    setAvisosSubida([]);
    try {
      const form = new FormData();
      for (const f of lista) form.append('fotos', f, f.name);
      const res = await fetch('/api/admin/qa/fotos', { method: 'POST', body: form });
      const cuerpo = await res.json().catch(() => null) as { error?: string; resultados?: Array<{ nombre: string; id: string | null; duplicadoDe: string | null; error: string | null }>; fotos?: FotoConUrl[] } | null;
      if (!res.ok || !cuerpo?.fotos) {
        setAvisosSubida([t('qa_lanzar_form.la_subida_fallo', { v: cuerpo?.error ?? `HTTP ${res.status}` })]);
        return;
      }
      setFotos(cuerpo.fotos);
      const avisos: string[] = [];
      const nuevas: string[] = [];
      for (const r of cuerpo.resultados ?? []) {
        if (r.error) avisos.push(`${r.nombre}: ${r.error}`);
        else if (r.duplicadoDe) avisos.push(t('qa_lanzar_form.ya_estaba_en_el_banco_se', { nombre: r.nombre }));
        if (r.id) nuevas.push(r.id);
      }
      // Lo recién subido queda seleccionado solo: subir → lanzar sin dar 40 clics.
      if (nuevas.length) setSeleccion((prev) => new Set([...prev, ...nuevas]));
      setAvisosSubida(avisos);
    } catch (e) {
      setAvisosSubida([t('qa_lanzar_form.la_subida_fallo', { v: e instanceof Error ? e.message : String(e) })]);
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // EL CARRIL, con la MISMA función que usa el servidor: más de
  // MAX_FOTOS_CARRIL_RAPIDO fotos se van solas al carril completo. No es un
  // rechazo con otro nombre — es el otro carril, que existe desde la Fase C.
  const carril = carrilPara(seleccion.size);

  // El body EXACTO que validará el servidor — el motivo del botón sale de la
  // misma función, así que nunca cuentan historias distintas.
  const cuerpoLanzar = {
    escenario,
    carril,
    fotoIds: [...seleccion],
    anticipo: anticipo.trim() === '' ? NaN : Number(anticipo),
    rfcEmpresa: rfc.trim() === '' ? null : rfc.trim(),
    ruta: { origen, destino },
    politica: politica.map((p) => ({
      concepto: p.concepto,
      topeMonto: p.topeMonto.trim() === '' ? undefined : Number(p.topeMonto),
      requiereCfdi: p.requiereCfdi || undefined,
    })),
    retencion: conservar ? 'conservar' : 'borrar_al_terminar',
  };
  const validacion = validarLanzar(cuerpoLanzar);
  const motivoBloqueo =
    gastoError !== null ? t('qa_lanzar_form.no_se_pudo_leer_el_gasto')
    : gastoHoyUsd !== null && gastoHoyUsd >= topeDiaUsd ? t('qa_lanzar_form.el_gasto_de_hoy_ya_toco', { usd4: usd4(gastoHoyUsd), usd: usd(topeDiaUsd) })
    : bancoError !== null ? t('qa_banco_verdad.el_banco_de_fotos_no_se')
    : !validacion.ok ? validacion.error
    : null;

  const lanzar = async () => {
    if (motivoBloqueo || lanzando) return;
    setLanzando(true);
    setErrorLanzar(null);
    try {
      const res = await fetch('/api/admin/qa/lanzar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoLanzar),
      });
      const cuerpo = await res.json().catch(() => null) as { id?: string; error?: string } | null;
      if (!res.ok || !cuerpo?.id) {
        setErrorLanzar(cuerpo?.error ?? t('qa_lanzar_form.el_lanzamiento_fallo_http', { status: res.status }));
        setLanzando(false);
        return;
      }
      router.push(`/admin/qa/${cuerpo.id}`);
    } catch (e) {
      setErrorLanzar(e instanceof Error ? e.message : String(e));
      setLanzando(false);
    }
  };

  return (
    <Tarjeta titulo={t('qa_lanzar_form.lanzar_una_corrida_de_prueba')}>
      <div className="rv-qa-pila">
        {/* ── Escenario ──────────────────────────────────────────────────────── */}
        <Fieldset leyenda={t('qa_lanzar_form.escenario')} className="rv-qa-escenarios">
          {ESCENARIOS_QA.map((e) => (
            <Radio key={e.id} name="escenario" form="sin-formulario" checked={escenario === e.id} onChange={() => elegirEscenario(e.id)}
              etiqueta={<Tooltip texto={t('qa_lanzar_form.reglas_que_verifica', { v: e.invariantes.join(', ') })}>{e.nombre}</Tooltip>}
              ayuda={e.minFotos > 1 ? `${e.descripcion} ${t('qa_lanzar_form.minimo_fotos', { minFotos: e.minFotos })}` : e.descripcion} />
          ))}
        </Fieldset>
        {/* Lo que falta se dice, con número: el catálogo del diseño tiene 11 y
            el selector no los ofrece todos. Callarlo haría creer que esto es
            toda la cobertura que existe. */}
        <p className="rv-qa-nota">{t('qa_lanzar_form.de_los_11_escenarios_del_catalogo', { length: ESCENARIOS_QA.length, v: 11 - ESCENARIOS_QA.length })}</p>

        {/* ── Fotos: arrastrar N de golpe + el banco ─────────────────────────── */}
        <div>
          {/* EL RÓTULO QUE DEJÓ DE MENTIR. Decía «máx. 10 por corrida en el
              carril rápido» y con 91 fotos eso ya no es lo que pasa: la corrida
              se va al carril completo, que no tiene tope de fotos. Lo que se
              dice aquí es lo que de verdad ocurre al darle a Lanzar — incluido
              lo que SÍ la puede parar, que es el reloj y el dinero. */}
          <div className="rv-qa-rotulo">{tp('qa_lanzar_form.fotos_del_viaje_seleccionadas', seleccion.size)}
            {carril === 'completo' ? t('qa_lanzar_form.carril_completo') : t('qa_lanzar_form.carril_rapido')}
          </div>
          <p className="rv-qa-nota">
            {carril === 'completo' ? (
              <>{rico(t('qa_lanzar_form.sin_tope_de_fotos_la_corrida', { Math: Math.round(TECHO_PASADA_MS / 1000), usd: usd(topeCorridaUsd), usd2: usd(topeDiaUsd) }), { strong: (c) => <strong>{c}</strong> })}</>
            ) : (
              <>{t('qa_lanzar_form.corre_completa_en_un_solo_proceso', { maxFotosCarrilRapido: MAX_FOTOS_CARRIL_RAPIDO })}</>
            )}
          </p>
          <label
            onDragOver={(ev) => { ev.preventDefault(); setArrastrando(true); }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(ev) => { ev.preventDefault(); setArrastrando(false); void subirArchivos(ev.dataTransfer.files); }}
            className="rv-qa-zona" data-arrastrando={arrastrando}
          >
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="rv-sr"
              onChange={(ev) => { if (ev.target.files) void subirArchivos(ev.target.files); }} />
            <Icono icono={Upload} tam={14} className={subiendo ? 'rv-qa-gira' : undefined} />
            {subiendo ? t('qa_lanzar_form.subiendo_al_banco') : t('qa_lanzar_form.suelta_aqui_todas_las_fotos_que')}
          </label>
          {avisosSubida.length > 0 && (
            <Aviso tono="warn" className="rv-qa-sep">
              <ul className="rv-qa-lista">{avisosSubida.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </Aviso>
          )}

          {bancoError !== null ? null : fotos.length === 0 ? (
            <p className="rv-qa-nota rv-qa-sep">{t('qa_lanzar_form.el_banco_esta_vacio_de_verdad')}</p>
          ) : (
            <div className="rv-qa-fotos rv-qa-sep">
              {fotos.map((f) => {
                const activa = seleccion.has(f.id);
                return (
                  <label key={f.id} className="rv-qa-foto" data-activa={activa} title={f.etiqueta}>
                    <input type="checkbox" className="rv-sr" checked={activa} onChange={() => alternarFoto(f.id)} aria-label={f.etiqueta} />
                    {f.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- URL firmada de 60 s de un bucket privado: next/image no puede optimizarla (expira) y cachearla la rompería
                      <img src={f.url} alt="" className="rv-qa-foto__img" />
                    ) : (
                      <span className="rv-qa-foto__img rv-qa-foto__sin">{t('qa_corrida_viva.sin_firma')}</span>
                    )}
                    <span className="rv-qa-foto__pie">{activa ? t('qa_lanzar_form.elegida') : ''}{f.etiqueta}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Parámetros del viaje ───────────────────────────────────────────── */}
        <div className="rv-qa-params">
          <CampoTexto etiqueta={t('qa_lanzar_form.anticipo_mxn')} inputMode="decimal" value={anticipo} onChange={(e) => setAnticipo(e.target.value)}
            placeholder={escenario === 'feliz' ? t('qa_lanzar_form.lo_que_sumen_tus_fotos') : ''} />
          <CampoTexto etiqueta={t('qa_lanzar_form.rfc_de_la_empresa_opcional')} value={rfc} onChange={(e) => setRfc(e.target.value.toUpperCase())} />
          <CampoTexto etiqueta={t('qa_lanzar_form.origen')} value={origen} onChange={(e) => setOrigen(e.target.value)} />
          <CampoTexto etiqueta={t('qa_lanzar_form.destino')} value={destino} onChange={(e) => setDestino(e.target.value)} />
        </div>

        {/* ── Política de gasto ──────────────────────────────────────────────── */}
        <Fieldset leyenda={t('qa_lanzar_form.politica_de_gasto_de_la_flota')}>
          <div className="rv-qa-pila rv-qa-pila--corta">
            {politica.map((p, i) => (
              <div key={i} className="rv-qa-politica">
                <CampoTexto etiqueta={t('qa_lanzar_form.concepto')} etiquetaOculta value={p.concepto} placeholder={t('qa_lanzar_form.concepto')}
                  onChange={(e) => setPolitica((prev) => prev.map((x, j) => j === i ? { ...x, concepto: e.target.value } : x))} />
                <CampoTexto etiqueta={t('qa_lanzar_form.sin_tope')} etiquetaOculta inputMode="decimal" value={p.topeMonto} placeholder={t('qa_lanzar_form.sin_tope')}
                  onChange={(e) => setPolitica((prev) => prev.map((x, j) => j === i ? { ...x, topeMonto: e.target.value } : x))} />
                <Casilla etiqueta="CFDI" form="sin-formulario" checked={p.requiereCfdi}
                  onChange={(e) => setPolitica((prev) => prev.map((x, j) => j === i ? { ...x, requiereCfdi: e.target.checked } : x))} />
                <Tooltip texto={t('qa_lanzar_form.quitar', { v: p.concepto || t('qa_lanzar_form.concepto') })}>
                  <Boton variante="ghost" tamano="sm" aria-label={t('qa_lanzar_form.quitar', { v: p.concepto || t('qa_lanzar_form.concepto') })}
                    onClick={() => setPolitica((prev) => prev.filter((_, j) => j !== i))}>
                    <Icono icono={Trash2} tam={14} />
                  </Boton>
                </Tooltip>
              </div>
            ))}
            <div>
              <Boton variante="ghost" tamano="sm" icono={<Icono icono={Plus} tam={14} />}
                onClick={() => setPolitica((prev) => [...prev, { concepto: '', topeMonto: '', requiereCfdi: false }])}>
                {t('qa_lanzar_form.agregar_concepto')}
              </Boton>
            </div>
          </div>
        </Fieldset>

        {/* ── Lanzar ─────────────────────────────────────────────────────────── */}
        <div className="rv-qa-acciones">
          <Boton variante="primary" onClick={() => void lanzar()} disabled={Boolean(motivoBloqueo)} loading={lanzando}
            icono={lanzando ? undefined : <Icono icono={Play} tam={14} />}>
            {lanzando ? t('qa_lanzar_form.lanzando') : t('qa_lanzar_form.lanzar_corrida')}
          </Boton>
          <Casilla etiqueta={t('qa_lanzar_form.conservar_la_flota_de_prueba_al')} form="sin-formulario" checked={conservar} onChange={(e) => setConservar(e.target.checked)} />
          {motivoBloqueo && (
            <span className="rv-qa-nota">{t('qa_banco_verdad.bloqueado')}{' '}{motivoBloqueo}</span>
          )}
        </div>
        {errorLanzar && <Aviso tono="error">{errorLanzar}</Aviso>}
      </div>
    </Tarjeta>
  );
}
