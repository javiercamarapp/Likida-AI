'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Radio, KeyRound, Copy, Truck } from 'lucide-react';
import { AvisoResultado } from '../../admin/ui/aviso-resultado';
import { BotonConfirmar } from '../../admin/ui/confirmar';
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

const TONO: Record<FilaSaludGps['tono'], string> = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', neutral: 'var(--muted)' };
const FONDO: Record<FilaSaludGps['tono'], string> = { ok: 'var(--okbg)', warn: 'var(--warnbg)', bad: 'var(--badbg)', neutral: 'var(--canvas)' };

function BotonGenerar({ rotulo }: { rotulo: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <KeyRound aria-hidden width={14} height={14} strokeWidth={1.75} />
      {pending ? 'Generando…' : rotulo}
    </button>
  );
}

export function SeccionGps({ salud, push, endpoint, huerfanos, hayMasHuerfanos, conteos, puedeAdministrarGps, generarSecreto, mapear, plantillaCsv, hrefPatios }: {
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
}) {
  const [estadoSecreto, despachar] = useActionState(generarSecreto, null);
  const [copiado, setCopiado] = useState(false);

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { setCopiado(false); }
  }

  return (
    <section id="gps" aria-labelledby="titulo-gps" className="card p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
          <Radio aria-hidden width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="titulo-gps" className="font-display text-[15px] font-semibold">GPS: salud de cada integración</h2>
          <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--muted)' }}>
            Cada renglón sale de la última sincronización real. «Sana» solo significa que el último poll terminó completo.
          </p>
        </div>
      </div>

      {salud.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Ningún proveedor de GPS tiene credencial activa todavía. Captúrala abajo, en «Credenciales de tus sistemas».
        </p>
      ) : (
        <ul className="space-y-2">
          {salud.map((f) => (
            <li key={f.clave} className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: FONDO[f.tono] }}>
              <span className="font-medium" style={{ color: TONO[f.tono] }}>{f.nombre} · {f.estado}</span>
              <span className="block" style={{ color: 'var(--muted)' }}>{f.texto}</span>
            </li>
          ))}
        </ul>
      )}

      {conteos && (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          <Truck aria-hidden width={13} height={13} strokeWidth={1.75} className="inline mr-1 -mt-0.5" />
          {numero(conteos.conDispositivo)} de {numero(conteos.activas)} unidades activas tienen dispositivo GPS ligado
          {conteos.sinDispositivo > 0 ? `; ${numero(conteos.sinDispositivo)} no tienen (no aparecen en el mapa con GPS)` : ''}
          {conteos.sinSenalNunca > 0 ? `; ${numero(conteos.sinSenalNunca)} lo tienen ligado y nunca han reportado` : ''}.
        </p>
      )}

      {/* ── PUSH PROPIO ─────────────────────────────────────────────── */}
      <div className="border-t pt-4" style={{ borderColor: 'var(--line)' }}>
        <h3 className="font-display text-[14px] font-semibold">GPS propio (envío firmado a Likida)</h3>
        <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Si tu GPS puede mandar un POST, envía las posiciones a esta dirección firmadas con HMAC-SHA256
          (cabeceras <code className="cifra-mono">X-Likida-Timestamp</code> y <code className="cifra-mono">X-Likida-Signature: v1=…</code>).
          Hasta 500 lecturas por envío; reenviar es seguro (no duplica).
        </p>
        <p className="mt-2 text-[12px] cifra-mono break-all rounded-lg px-3 py-2" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>{endpoint}</p>
        <div className="mt-2 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: FONDO[push.fila.tono] }}>
          <span className="font-medium" style={{ color: TONO[push.fila.tono] }}>{push.fila.estado}</span>
          <span className="block" style={{ color: 'var(--muted)' }}>
            {push.fila.texto}
            {push.configurado ? ` Recepciones: ${numero(push.recepciones)} · rechazos: ${numero(push.rechazos)} · versión del secreto: ${push.version ?? 1}.` : ''}
            {push.previoHasta ? ` El secreto anterior sigue valiendo hasta ${fechaHoraMx(push.previoHasta)}.` : ''}
          </span>
        </div>

        {puedeAdministrarGps ? (
          <form action={despachar} className="mt-3 flex flex-wrap items-center gap-2">
            {push.configurado ? (
              <BotonConfirmar
                tono="peligro" etiqueta="Rotar secreto"
                titulo="Rotar el secreto del GPS propio"
                descripcion="Se genera un secreto nuevo y se muestra una sola vez. El anterior sigue valiendo 24 horas para que tus dispositivos se actualicen sin perder lecturas."
                etiquetaConfirmar="Sí, rotar"
              />
            ) : (
              <BotonGenerar rotulo="Generar secreto" />
            )}
          </form>
        ) : (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota genera o rota el secreto.</p>
        )}

        {estadoSecreto && !estadoSecreto.ok && <div className="mt-2"><AvisoResultado estado={{ ok: false, error: estadoSecreto.error }} /></div>}
        {estadoSecreto?.ok && (
          <div role="status" className="mt-3 rounded-lg px-3 py-3 text-[12.5px]" style={{ background: 'var(--warnbg)', border: '1px solid var(--line)' }}>
            <p className="font-medium" style={{ color: 'var(--warn)' }}>Guárdalo ahora: no se vuelve a mostrar.</p>
            <p className="mt-1 cifra-mono break-all select-all">{estadoSecreto.secreto}</p>
            <button type="button" onClick={() => copiar(estadoSecreto.secreto)}
              className="hairline mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors hover:bg-[var(--canvas)]">
              <Copy aria-hidden width={13} height={13} strokeWidth={2} />
              {copiado ? 'Copiado' : 'Copiar secreto'}
            </button>
          </div>
        )}
      </div>

      {/* ── HUÉRFANOS ───────────────────────────────────────────────── */}
      <div className="border-t pt-4" style={{ borderColor: 'var(--line)' }}>
        <h3 className="font-display text-[14px] font-semibold">Dispositivos sin unidad</h3>
        <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Dispositivos que tu proveedor reporta y ninguna unidad reclama. Likida NO crea unidades desde un feed ajeno:
          no se dibujan en el mapa hasta que los ligues a una unidad que ya existe (archivo de abajo).
        </p>
        {huerfanos.length === 0 ? (
          <p className="mt-2 text-[12.5px]" style={{ color: 'var(--ok)' }}>Ningún dispositivo huérfano.</p>
        ) : (
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg hairline">
            <table className="w-full text-[12.5px]">
              <caption className="sr-only">Dispositivos GPS que ninguna unidad reclama</caption>
              <thead><tr className="text-left" style={{ color: 'var(--faint)' }}>
                <th scope="col" className="px-3 py-1.5 text-[10px] font-normal uppercase">Proveedor</th>
                <th scope="col" className="px-3 py-1.5 text-[10px] font-normal uppercase">Dispositivo</th>
                <th scope="col" className="px-3 py-1.5 text-[10px] font-normal uppercase">Visto</th>
              </tr></thead>
              <tbody>
                {huerfanos.map((h) => (
                  <tr key={`${h.proveedor}|${h.deviceId}`}>
                    <td className="px-3 py-1">{h.proveedor}</td>
                    <td className="px-3 py-1 cifra-mono">{h.deviceId}</td>
                    <td className="px-3 py-1" style={{ color: 'var(--muted)' }}>{fechaHoraMx(h.ultimoVistoEn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hayMasHuerfanos && <p className="mt-1 text-[11.5px]" style={{ color: 'var(--faint)' }}>Se muestran los más recientes; liga estos y vuelve a mirar para ver el resto.</p>}
      </div>

      {puedeAdministrarGps && (
        <ImportadorMasivo
          entidad="dispositivos_gps" accion={mapear} plantillaCsv={plantillaCsv}
          archivoPlantilla="plantilla-dispositivos-gps.csv"
          columnas="Tres columnas: numero_economico (de una unidad que ya existe), proveedor (samsara, wialon, geotab, navixy, generico o push) y dispositivo (el id del dispositivo en el sistema del proveedor)."
          hrefPatios={hrefPatios} tope={2_000}
        />
      )}
    </section>
  );
}
