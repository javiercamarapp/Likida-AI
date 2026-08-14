'use client';

import { useMemo, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { MessageCircle } from 'lucide-react';
import {
  validarConfigCobranza, armarMensajeCobranza, type ConfigCobranza,
} from '@/lib/likida/agentes/cobranza_pura';
import type { AccionSimple } from './controles';

const DIAS = [
  { iso: 1, rotulo: 'L' }, { iso: 2, rotulo: 'M' }, { iso: 3, rotulo: 'X' },
  { iso: 4, rotulo: 'J' }, { iso: 5, rotulo: 'V' }, { iso: 6, rotulo: 'S' },
  { iso: 7, rotulo: 'D' },
];

/**
 * La estrategia del agente, editable, con su vista previa EN VIVO: el texto
 * de la derecha es literalmente `armarMensajeCobranza` — el mismo motor puro
 * que corre el servidor — sobre lo que el formulario trae tecleado. Lo que
 * se ve es lo que sale, sin un segundo armado que pueda divergir.
 *
 * El guardado vive en el servidor y re-valida TODO (`validarConfigCobranza`
 * corre allá también): aquí la validación solo alimenta la vista previa y
 * los avisos tempranos.
 */
export function FormaEstrategia({ config, ejemplo, guardar }: {
  config: ConfigCobranza;
  /** El siguiente REAL de la cola (folio + días juntos, para no enseñar un
   *  folio verdadero con días que no son los suyos). null = cola vacía: la
   *  vista previa se arma como plantilla con el primer tier. */
  ejemplo: { folio: string | null; dias: number } | null;
  guardar: AccionSimple;
}) {
  const [estado, accion] = useActionState(guardar, null);
  const [tiersTexto, setTiersTexto] = useState(config.tiers.join(', '));
  const [horaInicio, setHoraInicio] = useState(String(config.horaInicio));
  const [horaFin, setHoraFin] = useState(String(config.horaFin));
  const [dias, setDias] = useState<number[]>(config.diasSemana);
  const [instrucciones, setInstrucciones] = useState(config.instrucciones);
  const [firma, setFirma] = useState(config.firma);

  const borrador = useMemo(() => validarConfigCobranza({
    activo: config.activo,
    tiers: tiersTexto.split(/[,\s]+/).filter(Boolean).map(Number),
    horaInicio: Number(horaInicio),
    horaFin: Number(horaFin),
    diasSemana: dias,
    instrucciones,
    firma,
  }), [config.activo, tiersTexto, horaInicio, horaFin, dias, instrucciones, firma]);

  function alternarDia(iso: number) {
    setDias((v) => (v.includes(iso) ? v.filter((d) => d !== iso) : [...v, iso].sort((a, b) => a - b)));
  }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <form action={accion} className="space-y-3.5">
        <div>
          <label htmlFor="cob-tiers" className="etiqueta-mono text-[10px] uppercase block mb-1" style={{ color: 'var(--faint)' }}>
            Tiers de insistencia (días sin comprobar)
          </label>
          <input id="cob-tiers" name="tiers" value={tiersTexto} onChange={(e) => setTiersTexto(e.target.value)}
            placeholder="3, 7, 14"
            className="w-full text-[13px] px-3 py-1.5 rounded-lg hairline cifra-mono"
            style={{ background: 'var(--surface)' }} />
          <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
            Hasta 5 valores de 1 a 60, separados por coma. A cada tier se insiste UNA vez.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="cob-inicio" className="etiqueta-mono text-[10px] uppercase block mb-1" style={{ color: 'var(--faint)' }}>
              Desde
            </label>
            <select id="cob-inicio" name="horaInicio" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)}
              className="w-full text-[13px] px-2.5 py-1.5 rounded-lg hairline" style={{ background: 'var(--surface)' }}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cob-fin" className="etiqueta-mono text-[10px] uppercase block mb-1" style={{ color: 'var(--faint)' }}>
              Hasta
            </label>
            <select id="cob-fin" name="horaFin" value={horaFin} onChange={(e) => setHoraFin(e.target.value)}
              className="w-full text-[13px] px-2.5 py-1.5 rounded-lg hairline" style={{ background: 'var(--surface)' }}>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h}:00</option>)}
            </select>
          </div>
        </div>

        <div>
          <span className="etiqueta-mono text-[10px] uppercase block mb-1" style={{ color: 'var(--faint)' }}>
            Días permitidos (hora de México)
          </span>
          <div className="flex gap-1.5">
            {DIAS.map((d) => {
              const puesto = dias.includes(d.iso);
              return (
                <label key={d.iso}
                  className="w-8 h-8 rounded-lg hairline flex items-center justify-center text-[12px] font-medium cursor-pointer transition-colors"
                  style={puesto
                    ? { background: 'var(--marca)', color: 'var(--marca-fg)', borderColor: 'var(--marca)' }
                    : { background: 'var(--surface)', color: 'var(--muted)' }}>
                  <input type="checkbox" name="dias" value={d.iso} checked={puesto}
                    onChange={() => alternarDia(d.iso)} className="sr-only" />
                  {d.rotulo}
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="cob-instrucciones" className="etiqueta-mono text-[10px] uppercase block mb-1" style={{ color: 'var(--faint)' }}>
            Instrucciones del mensaje <span className="normal-case">({instrucciones.length}/300)</span>
          </label>
          <textarea id="cob-instrucciones" name="instrucciones" value={instrucciones} maxLength={300} rows={3}
            onChange={(e) => setInstrucciones(e.target.value)}
            placeholder="Una línea tuya que viaja en cada mensaje — p. ej. «Si ya entregaste, mándame también la carta porte.»"
            className="w-full text-[13px] px-3 py-2 rounded-lg hairline resize-none"
            style={{ background: 'var(--surface)' }} />
        </div>

        <div>
          <label htmlFor="cob-firma" className="etiqueta-mono text-[10px] uppercase block mb-1" style={{ color: 'var(--faint)' }}>
            Firma <span className="normal-case">({firma.length}/80)</span>
          </label>
          <input id="cob-firma" name="firma" value={firma} maxLength={80} onChange={(e) => setFirma(e.target.value)}
            placeholder="Nombre del despacho o del ejecutivo — p. ej. «Transportes Rivera»"
            className="w-full text-[13px] px-3 py-1.5 rounded-lg hairline"
            style={{ background: 'var(--surface)' }} />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <BotonGuardar />
          {estado?.error && <p className="text-[12px]" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
        </div>
      </form>

      {/* La vista previa: el payload literal, no una maqueta */}
      <div>
        <div className="etiqueta-mono text-[10px] uppercase mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--faint)' }}>
          <MessageCircle width={11} height={11} strokeWidth={2} />
          {ejemplo
            ? `Así se lee en WhatsApp — el siguiente de la cola (${ejemplo.dias} días)`
            : 'Así se lee en WhatsApp — plantilla con el primer tier'}
        </div>
        {'error' in borrador ? (
          <div className="rounded-xl hairline p-4 text-[12.5px]" style={{ background: 'var(--surface)', color: 'var(--warn)' }}>
            {borrador.error}
          </div>
        ) : (
          <div className="rounded-xl hairline p-4 text-[13px] leading-relaxed whitespace-pre-line"
            style={{ background: 'var(--surface)' }}>
            {armarMensajeCobranza(ejemplo?.folio ?? null, ejemplo?.dias ?? borrador.ok.tiers[0], borrador.ok)}
          </div>
        )}
        <p className="text-[11px] mt-2" style={{ color: 'var(--faint)' }}>
          Los días y el folio son los de cada viaje real al momento de mandar.
          Los asteriscos son las negritas de WhatsApp.
        </p>
      </div>
    </div>
  );
}

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="text-[12.5px] font-medium px-3.5 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      {pending ? 'Guardando…' : 'Guardar estrategia'}
    </button>
  );
}
