'use client';

import { useMemo, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Boton, Campo, CampoSelect, CampoTextarea, CampoTexto, Casilla, AvisoCompacto, Fieldset } from '@/app/ui-v2/componentes';
import '../agentes.css';
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
    <div className="rv-ag-notif__rejilla">
      <form action={accion} className="rv-ag-forma">
        <CampoTexto id="cob-tiers" etiqueta="Tiers de insistencia (días sin comprobar)" name="tiers" value={tiersTexto}
          onChange={(e) => setTiersTexto(e.target.value)} placeholder="3, 7, 14"
          ayuda="Hasta 5 valores de 1 a 60, separados por coma. A cada tier se insiste UNA vez." />

        <div className="rv-ag-par">
          <CampoSelect id="cob-inicio" etiqueta="Desde" name="horaInicio" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
          </CampoSelect>
          <CampoSelect id="cob-fin" etiqueta="Hasta" name="horaFin" value={horaFin} onChange={(e) => setHoraFin(e.target.value)}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h}:00</option>)}
          </CampoSelect>
        </div>

        <Fieldset leyenda="Días permitidos (hora de México)">
          <div className="rv-ag-dias">
            {DIAS.map((d) => (
              <Casilla key={d.iso} name="dias" value={d.iso} checked={dias.includes(d.iso)} onChange={() => alternarDia(d.iso)} etiqueta={d.rotulo} />
            ))}
          </div>
        </Fieldset>

        <CampoTextarea id="cob-instrucciones" etiqueta={`Instrucciones del mensaje (${instrucciones.length}/300)`} name="instrucciones"
          value={instrucciones} maxLength={300} rows={3} onChange={(e) => setInstrucciones(e.target.value)}
          placeholder="Una línea tuya que viaja en cada mensaje — p. ej. «Si ya entregaste, mándame también la carta porte.»" />

        <CampoTexto id="cob-firma" etiqueta={`Firma (${firma.length}/80)`} name="firma" value={firma} maxLength={80} onChange={(e) => setFirma(e.target.value)}
          placeholder="Nombre del despacho o del ejecutivo — p. ej. «Transportes Rivera»" />

        <div className="rv-ag-notif__acciones">
          <BotonGuardar />
          {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
        </div>
      </form>

      {/* La vista previa: el payload literal, no una maqueta */}
      <Campo etiqueta={ejemplo
        ? `Así se lee en WhatsApp — el siguiente de la cola (${ejemplo.dias} días)`
        : 'Así se lee en WhatsApp — plantilla con el primer tier'}
        ayuda="Los días y el folio son los de cada viaje real al momento de mandar. Los asteriscos son las negritas de WhatsApp.">
        <output className="rv-ag-previa" data-tono={'error' in borrador ? 'warn' : undefined}>
          {'error' in borrador
            ? borrador.error
            : armarMensajeCobranza(ejemplo?.folio ?? null, ejemplo?.dias ?? borrador.ok.tiers[0], borrador.ok)}
        </output>
      </Campo>
    </div>
  );
}

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} disabled={pending}>
      {pending ? 'Guardando…' : 'Guardar estrategia'}
    </Boton>
  );
}
