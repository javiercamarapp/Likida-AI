'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { KeyRound, Copy, Truck, MapPinned } from 'lucide-react';
import { AvisoResultado, Boton, BotonConfirmar, Icono, TablaBase, Tarjeta, clasesBoton, type ColumnaBase } from '@/app/ui-v2/componentes';
import './conexiones.css';
import { ImportadorMasivo, type AccionImportacion } from '../importador-masivo';
import { fechaHoraMx, numero } from '@/lib/formato';

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
  const [estado, despachar] = useActionState(accion, null);
  return (
    <Tarjeta titulo="Geocercas de tu sistema">
      <p className="rv-cx__apoyo">
        Si conectaste «Mis propias tablas de GPS» con una vista o archivo de geocercas, aquí las traes al catálogo de sitios
        (el que usan el Conductor, los peajes y el mapa). Volver a importar actualiza por código, no duplica, y se repite solo una vez al día. Un polígono
        se guarda con su forma real; el que no se pueda guardar así entra como el círculo que lo contiene y se te dice cuáles.
      </p>
      <form action={despachar}><BotonImportarGeocercas /></form>
      {estado?.ok === true && (
        <p role="status" className="rv-cx__ok-texto">
          {estado.mensaje}{(estado.poligonos ?? 0) > 0 ? ` ${estado.poligonos} polígono(s) se guardaron con su forma real.` : ''}{estado.aproximadas > 0 ? ` ${estado.aproximadas} polígono(s) no se pudieron guardar con su forma y entran como el círculo que los contiene (las reclamaciones con ellos bajan a confianza media).` : ''}
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
  const [estadoSecreto, despachar] = useActionState(generarSecreto, null);
  const [copiado, setCopiado] = useState(false);

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { setCopiado(false); }
  }

  return (
    <div id="gps" className="rv-cx__stack">
      <Tarjeta titulo="GPS: salud de cada integración">
        <p className="rv-cx__apoyo">
          Cada renglón sale de la última sincronización real. «Sana» solo significa que el último poll terminó completo.
        </p>

        {salud.length === 0 ? (
          <p className="rv-cx__texto">
            Ningún proveedor de GPS tiene credencial activa todavía. Captúrala abajo, en «Credenciales de tus sistemas».
          </p>
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
            <span className="rv-cx__icono-linea"><Icono icono={Truck} tam={14} /></span>
            {numero(conteos.conDispositivo)} de {numero(conteos.activas)} unidades activas tienen dispositivo GPS ligado
            {conteos.sinDispositivo > 0 ? `; ${numero(conteos.sinDispositivo)} no tienen (no aparecen en el mapa con GPS)` : ''}
            {conteos.sinSenalNunca > 0 ? `; ${numero(conteos.sinSenalNunca)} lo tienen ligado y nunca han reportado` : ''}.
          </p>
        )}
      </Tarjeta>

      {/* ── PUSH PROPIO ─────────────────────────────────────────────── */}
      <Tarjeta titulo="GPS propio (envío firmado a Likida)">
        <p className="rv-cx__apoyo">
          Si tu GPS puede mandar un POST, envía las posiciones a esta dirección firmadas con HMAC-SHA256
          (cabeceras <code className="cifra-mono">X-Likida-Timestamp</code> y <code className="cifra-mono">X-Likida-Signature: v1=…</code>).
          Hasta 500 lecturas por envío; reenviar es seguro (no duplica).
        </p>
        <p className="rv-cx__endpoint cifra-mono">{endpoint}</p>
        <div className="rv-cx__salud-fila" data-tono={push.fila.tono}>
          <span className="rv-cx__salud-titulo">{push.fila.estado}</span>
          <span className="rv-cx__salud-texto">
            {push.fila.texto}
            {push.configurado ? ` Recepciones: ${numero(push.recepciones)} · rechazos: ${numero(push.rechazos)} · versión del secreto: ${push.version ?? 1}.` : ''}
            {push.previoHasta ? ` El secreto anterior sigue valiendo hasta ${fechaHoraMx(push.previoHasta)}.` : ''}
          </span>
        </div>

        {puedeAdministrarGps ? (
          <form action={despachar} className="rv-cx__fila-botones">
            {push.configurado ? (
              <BotonConfirmar
                tono="peligro" etiqueta="Rotar secreto"
                titulo="Rotar el secreto del GPS propio"
                descripcion="Se genera un secreto nuevo y se muestra una sola vez. El anterior sigue valiendo 24 horas para que tus dispositivos se actualicen sin perder lecturas."
                etiquetaConfirmar="Sí, rotar"
                className={clasesBoton('danger', 'md')}
              />
            ) : (
              <BotonGenerar rotulo="Generar secreto" />
            )}
          </form>
        ) : (
          <p className="rv-cx__texto" data-tono="faint">Solo el dueño de la flota genera o rota el secreto.</p>
        )}

        {estadoSecreto && !estadoSecreto.ok && <div className="rv-cx__ok-texto"><AvisoResultado estado={{ ok: false, error: estadoSecreto.error }} /></div>}
        {estadoSecreto?.ok && (
          <div role="status" className="rv-cx__secreto">
            <strong>Guárdalo ahora: no se vuelve a mostrar.</strong>
            <code className="cifra-mono">{estadoSecreto.secreto}</code>
            <div>
              <Boton tamano="sm" icono={<Icono icono={Copy} />} onClick={() => copiar(estadoSecreto.secreto)}>
                {copiado ? 'Copiado' : 'Copiar secreto'}
              </Boton>
            </div>
          </div>
        )}
      </Tarjeta>

      {/* ── HUÉRFANOS ───────────────────────────────────────────────── */}
      <Tarjeta titulo="Dispositivos sin unidad">
        <p className="rv-cx__apoyo">
          Dispositivos que tu proveedor reporta y ninguna unidad reclama. Likida NO crea unidades desde un feed ajeno:
          no se dibujan en el mapa hasta que los ligues a una unidad que ya existe (archivo de abajo).
        </p>
        {huerfanos.length === 0 ? (
          <p className="rv-cx__texto">Ningún dispositivo huérfano.</p>
        ) : (
          <TablaBase etiqueta="Dispositivos GPS que ninguna unidad reclama" columnas={COLUMNAS_HUERFANOS} filas={huerfanos}
            idFila={(h) => `${h.proveedor}|${h.deviceId}`} densa />
        )}
        {hayMasHuerfanos && <p className="rv-cx__nota">Se muestran los más recientes; liga estos y vuelve a mirar para ver el resto.</p>}
      </Tarjeta>

      {puedeAdministrarGps && importarGeocercas && <ImportadorGeocercas accion={importarGeocercas} />}

      {puedeAdministrarGps && (
        <ImportadorMasivo
          entidad="dispositivos_gps" accion={mapear} plantillaCsv={plantillaCsv}
          archivoPlantilla="plantilla-dispositivos-gps.csv"
          columnas="Tres columnas: numero_economico (de una unidad que ya existe), proveedor (samsara, wialon, geotab, navixy, generico o push) y dispositivo (el id del dispositivo en el sistema del proveedor)."
          hrefPatios={hrefPatios} tope={2_000}
        />
      )}
    </div>
  );
}

const COLUMNAS_HUERFANOS: ColumnaBase<HuerfanoPantalla>[] = [
  { id: 'proveedor', titulo: 'Proveedor', celda: (h) => h.proveedor },
  { id: 'dispositivo', titulo: 'Dispositivo', principal: true, celda: (h) => <span className="cifra-mono">{h.deviceId}</span> },
  { id: 'visto', titulo: 'Visto', celda: (h) => fechaHoraMx(h.ultimoVistoEn) },
];
