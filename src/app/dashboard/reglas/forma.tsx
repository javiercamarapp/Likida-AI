'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sparkles, ShieldQuestion } from 'lucide-react';
import { AvisoResultado } from '../../admin/ui/aviso-resultado';
import { BotonConfirmar } from '../../admin/ui/confirmar';

// ═══════════════════════════════════════════════════════════════════════════
// LA PANTALLA DE "MIS REGLAS" — lado del navegador.
//
// El catálogo viaja como PROP y no por import: `catalogo.ts` es puro, pero el
// resto de la cadena (`traductor`, `repo`) arrastra `supabaseAdmin`, y la
// costumbre de la casa —`MODOS_TARIFA` en clientes, `AREAS_DE_LLAVE` en
// llaves-api— es que el dato del servidor baje como prop.
//
// DOS PASOS SIEMPRE, y es la pieza que sostiene el diseño: escribir la frase
// NO enciende nada. Lo que se guarda es la interpretación, y hasta que la
// persona lee "voy a avisarte cuando…" y aprieta el botón, la regla no vigila.
// La base lo exige además (`regla_vigilancia_activa_confirmada`, 0229), así
// que este flujo no es la única defensa — es la que se ve.
// ═══════════════════════════════════════════════════════════════════════════

export interface CampoPlantilla {
  nombre: string;
  etiqueta: string;
  tipo: 'numero' | 'opcion';
  opciones?: ReadonlyArray<{ valor: string; rotulo: string }>;
  sufijo?: string;
}

export interface PlantillaEnPantalla {
  id: string;
  titulo: string;
  queVigila: string;
  ejemplos: readonly string[];
  campos: readonly CampoPlantilla[];
}

export type ResultadoForma =
  | { ok: true; mensaje: string }
  | { ok: false; error: string; puedoVigilar?: string[] }
  | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';

function AvisoError({ estado }: { estado: { error: string; puedoVigilar?: string[] } }) {
  return (
    <div className="space-y-2">
      <AvisoResultado estado={{ ok: false, error: estado.error }} />
      {/* La mitad honesta de la negativa. Un "no puedo" a secas deja a la
          persona adivinando qué sí; esta lista es lo que evita que se rinda. */}
      {estado.puedoVigilar && estado.puedoVigilar.length > 0 && (
        <div className="rounded-lg hairline p-3.5" style={{ background: 'var(--surface)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
            Esto es lo que sí sé vigilar hoy
          </p>
          <ul className="space-y-1.5">
            {estado.puedoVigilar.map((linea) => (
              <li key={linea} className="text-[12px] flex gap-2" style={{ color: 'var(--ink2)' }}>
                <span style={{ color: 'var(--faint)' }}>·</span>
                <span>{linea}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AvisoOk({ mensaje }: { mensaje: string }) {
  return <AvisoResultado estado={{ ok: true, mensaje }} />;
}

function BotonEnvio({ etiqueta, ocupado, tono = 'marca', Icono }: {
  etiqueta: string; ocupado: string; tono?: 'marca' | 'suave' | 'malo';
  Icono?: typeof Sparkles;
}) {
  const { pending } = useFormStatus();
  const estilo = tono === 'marca'
    ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
    : tono === 'malo'
      ? { background: 'var(--badbg)', color: 'var(--bad)' }
      : { background: 'var(--surface)', color: 'var(--ink2)' };
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 hairline transition-opacity hover:opacity-85 disabled:opacity-50"
      style={estilo}>
      {Icono && <Icono width={14} height={14} strokeWidth={1.75} />}
      {pending ? ocupado : etiqueta}
    </button>
  );
}

/**
 * El campo de texto libre. Lo único que hace es MANDAR LA FRASE a interpretar:
 * el botón dice "Interpretar" y no "Crear regla" a propósito — prometer que
 * ya quedó creada sería mentir sobre el paso que falta.
 */
export function FormaEscribirRegla({ accion, ejemplos }: {
  accion: AccionForma;
  ejemplos: readonly string[];
}) {
  const [estado, despachar] = useActionState(accion, null);
  const [texto, setTexto] = useState('');

  return (
    <form action={despachar} className="space-y-3">
      <div>
        <label htmlFor="regla-texto" className={ETIQUETA}>
          ¿De qué quieres que te avise?
        </label>
        <textarea id="regla-texto" name="texto" required maxLength={400} rows={3}
          value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="avísame si un gasto de caseta pasa de $3,000"
          className="w-full hairline rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[var(--muted)] transition-colors resize-y"
          style={{ background: 'var(--surface)' }} />
        <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
          Escríbelo como se lo dirías a tu jefe de tráfico. Lo voy a traducir a una
          vigilancia concreta y te la voy a enseñar ANTES de encenderla.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ejemplos.map((e) => (
          <button key={e} type="button" onClick={() => setTexto(e)}
            className="text-[11.5px] px-2.5 h-7 rounded-full hairline transition-colors hover:bg-[var(--surface)]"
            style={{ color: 'var(--muted)' }}>
            {e}
          </button>
        ))}
      </div>

      {estado && !estado.ok && <AvisoError estado={estado} />}
      {estado?.ok && <AvisoOk mensaje={estado.mensaje} />}
      <BotonEnvio etiqueta="Interpretar" ocupado="Interpretando…" Icono={Sparkles} />
    </form>
  );
}

/**
 * El camino SIN modelo: elegir la vigilancia de la lista y teclear sus
 * números. Existe para que el producto no dependa del proveedor —y para que
 * una flota que agotó su techo de IA del día siga pudiendo declarar reglas.
 */
export function FormaElegirAMano({ accion, plantillas }: {
  accion: AccionForma;
  plantillas: readonly PlantillaEnPantalla[];
}) {
  const [estado, despachar] = useActionState(accion, null);
  const [elegida, setElegida] = useState(plantillas[0]?.id ?? '');
  const plantilla = plantillas.find((p) => p.id === elegida) ?? plantillas[0];

  if (!plantilla) return null;

  return (
    <form action={despachar} className="space-y-3">
      <div>
        <label htmlFor="regla-plantilla" className={ETIQUETA}>Vigilancia</label>
        <select id="regla-plantilla" name="plantilla" value={elegida}
          onChange={(e) => setElegida(e.target.value)}
          className={CAMPO} style={{ background: 'var(--surface)' }}>
          {plantillas.map((p) => (
            <option key={p.id} value={p.id}>{p.titulo}</option>
          ))}
        </select>
        <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>{plantilla.queVigila}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {plantilla.campos.map((c) => (
          <div key={c.nombre}>
            <label htmlFor={`p-${c.nombre}`} className={ETIQUETA}>
              {c.etiqueta}{c.sufijo ? ` (${c.sufijo})` : ''}
            </label>
            {c.tipo === 'opcion' ? (
              <select id={`p-${c.nombre}`} name={`p_${c.nombre}`} className={CAMPO} style={{ background: 'var(--surface)' }}>
                {(c.opciones ?? []).map((o) => (
                  <option key={o.valor} value={o.valor}>{o.rotulo}</option>
                ))}
              </select>
            ) : (
              <input id={`p-${c.nombre}`} name={`p_${c.nombre}`} type="number" step="any" min="0" required
                className={CAMPO} style={{ background: 'var(--surface)' }} />
            )}
          </div>
        ))}
      </div>

      {estado && !estado.ok && <AvisoError estado={estado} />}
      {estado?.ok && <AvisoOk mensaje={estado.mensaje} />}
      <BotonEnvio etiqueta="Preparar la regla" ocupado="Preparando…" tono="suave" Icono={ShieldQuestion} />
    </form>
  );
}

/** Un botón que manda un id. La confirmación, la pausa, el descarte y el
 *  borrado son todos esta forma con otra etiqueta. */
export function BotonDeRegla({ accion, id, etiqueta, ocupado, tono = 'suave' }: {
  accion: AccionForma; id: string; etiqueta: string; ocupado: string;
  tono?: 'marca' | 'suave' | 'malo';
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <div className="space-y-1.5">
      <form action={despachar}>
        <input type="hidden" name="id" value={id} />
        <BotonEnvio etiqueta={etiqueta} ocupado={ocupado} tono={tono} />
      </form>
      {estado && !estado.ok && (
        <p className="text-[11.5px]" style={{ color: 'var(--bad)' }}>{estado.error}</p>
      )}
    </div>
  );
}

/**
 * Borrar una regla, con el diálogo de confirmación ÚNICO del panel (W2): dice lo
 * que se pierde —la regla y la memoria de lo que ya avisó— antes de confirmar.
 */
export function BorrarRegla({ accion, id }: { accion: AccionForma; id: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <BotonConfirmar
        etiqueta="Borrar" tono="peligro" etiquetaConfirmar="Sí, borrarla"
        titulo="Borrar esta regla"
        descripcion="Se va la regla y también la memoria de lo que ya te avisó. Si la vuelves a declarar, los mismos casos te van a sonar otra vez."
        className="text-[12px] font-medium select-none hover:opacity-70 transition-opacity"
        style={{ color: 'var(--bad)' }}
      />
      {estado && !estado.ok && <AvisoError estado={estado} />}
    </form>
  );
}


/**
 * El límite de frecuencia de UNA regla (0520): cuántos avisos como máximo en 24 h
 * y cuántas horas de separación entre dos avisos. Lo que se pospone no se pierde:
 * sale agrupado en el siguiente aviso permitido.
 */
export function FormaFrecuencia({ accion, id, maxAvisosDia, minHorasEntreAvisos }: {
  accion: AccionForma; id: string; maxAvisosDia: number; minHorasEntreAvisos: number;
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className={ETIQUETA} style={{ color: 'var(--muted)' }}>Máximo de avisos en 24 h</span>
          <input type="number" name="maxAvisosDia" min={1} max={24} step={1} required
            defaultValue={maxAvisosDia} className={`${CAMPO} w-28`} />
        </label>
        <label className="block">
          <span className={ETIQUETA} style={{ color: 'var(--muted)' }}>Horas entre un aviso y otro</span>
          <input type="number" name="minHorasEntreAvisos" min={0} max={168} step={1} required
            defaultValue={minHorasEntreAvisos} className={`${CAMPO} w-28`} />
        </label>
        <BotonEnvio etiqueta="Guardar límite" ocupado="Guardando…" tono="suave" />
      </div>
      {estado && <AvisoResultado estado={estado.ok ? { ok: true, mensaje: estado.mensaje } : { ok: false, error: estado.error }} />}
    </form>
  );
}
