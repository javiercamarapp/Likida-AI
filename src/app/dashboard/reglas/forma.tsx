'use client';

import { useT } from '@/lib/i18n/proveedor';
import { dinero } from '@/lib/i18n/es/dinero';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sparkles, ShieldQuestion } from 'lucide-react';
import {
  AvisoResultado, Boton, BotonConfirmar, CampoSelect, CampoTexto, CampoTextarea, Icono, clasesBoton,
} from '@/app/ui-v2/componentes';
import './reglas.css';

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

function AvisoError({ estado }: { estado: { error: string; puedoVigilar?: string[] } }) {
  const { t: tr } = useT('dinero', dinero);
  return (
    <div className="rv-reglas__avisos">
      <AvisoResultado estado={{ ok: false, error: estado.error }} />
      {/* La mitad honesta de la negativa. Un "no puedo" a secas deja a la persona adivinando qué sí; esta lista es lo que evita que se rinda. */}
      {estado.puedoVigilar && estado.puedoVigilar.length > 0 && (
        <div className="rv-reglas__puedo">
          <p className="rv-reglas__rotulo">{tr('reglas.forma.estoEsLoQue')}</p>
          <ul className="rv-reglas__lista">
            {estado.puedoVigilar.map((linea) => (
              <li key={linea}>{linea}</li>
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

function BotonEnvio({ etiqueta, ocupado, tono = 'marca', icono }: {
  etiqueta: string; ocupado: string; tono?: 'marca' | 'suave' | 'malo';
  icono?: typeof Sparkles;
}) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante={tono === 'marca' ? 'primary' : tono === 'malo' ? 'danger' : 'secondary'} tamano="sm"
      loading={pending} icono={icono ? <Icono icono={icono} /> : undefined}>
      {pending ? ocupado : etiqueta}
    </Boton>
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
  const { t: tr } = useT('dinero', dinero);
  const [estado, despachar] = useActionState(accion, null);
  const [texto, setTexto] = useState('');

  return (
    <form action={despachar} className="rv-reglas__forma">
      <CampoTextarea id="regla-texto" name="texto" required maxLength={400} rows={3}
        etiqueta={tr('reglas.forma.deQueQuieresQue')}
        value={texto} onChange={(e) => setTexto(e.target.value)}
        placeholder={tr('reglas.forma.avisameSiUnGasto')}
        ayuda={tr('reglas.forma.escribeloComoSeLo')} />

      <div className="rv-reglas__ejemplos">
        {ejemplos.map((e) => (
          <button key={e} type="button" onClick={() => setTexto(e)} className="rv-chip">
            {e}
          </button>
        ))}
      </div>

      {estado && !estado.ok && <AvisoError estado={estado} />}
      {estado?.ok && <AvisoOk mensaje={estado.mensaje} />}
      <BotonEnvio etiqueta={tr('reglas.forma.interpretar')} ocupado="Interpretando…" icono={Sparkles} />
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
  const { t: tr } = useT('dinero', dinero);
  const [estado, despachar] = useActionState(accion, null);
  const [elegida, setElegida] = useState(plantillas[0]?.id ?? '');
  const plantilla = plantillas.find((p) => p.id === elegida) ?? plantillas[0];

  if (!plantilla) return null;

  return (
    <form action={despachar} className="rv-reglas__forma">
      <CampoSelect id="regla-plantilla" name="plantilla" etiqueta={tr('reglas.forma.vigilancia')} value={elegida}
        onChange={(e) => setElegida(e.target.value)} ayuda={plantilla.queVigila}>
        {plantillas.map((p) => (
          <option key={p.id} value={p.id}>{p.titulo}</option>
        ))}
      </CampoSelect>

      <div className="rv-forma__rejilla">
        {plantilla.campos.map((c) => (
          c.tipo === 'opcion' ? (
            <CampoSelect key={c.nombre} id={`p-${c.nombre}`} name={`p_${c.nombre}`}
              etiqueta={`${c.etiqueta}${c.sufijo ? ` (${c.sufijo})` : ''}`}>
              {(c.opciones ?? []).map((o) => (
                <option key={o.valor} value={o.valor}>{o.rotulo}</option>
              ))}
            </CampoSelect>
          ) : (
            <CampoTexto key={c.nombre} id={`p-${c.nombre}`} name={`p_${c.nombre}`} tipo="number" step="any" min="0" required
              etiqueta={`${c.etiqueta}${c.sufijo ? ` (${c.sufijo})` : ''}`} />
          )
        ))}
      </div>

      {estado && !estado.ok && <AvisoError estado={estado} />}
      {estado?.ok && <AvisoOk mensaje={estado.mensaje} />}
      <BotonEnvio etiqueta={tr('reglas.forma.prepararLaRegla')} ocupado="Preparando…" tono="suave" icono={ShieldQuestion} />
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
    <div className="rv-reglas__avisos">
      <form action={despachar}>
        <input type="hidden" name="id" value={id} />
        <BotonEnvio etiqueta={etiqueta} ocupado={ocupado} tono={tono} />
      </form>
      {estado && !estado.ok && (
        <p className="rv-reglas__error" role="alert">{estado.error}</p>
      )}
    </div>
  );
}

/**
 * Borrar una regla, con el diálogo de confirmación ÚNICO del panel (W2): dice lo
 * que se pierde —la regla y la memoria de lo que ya avisó— antes de confirmar.
 */
export function BorrarRegla({ accion, id }: { accion: AccionForma; id: string }) {
  const { t: tr } = useT('dinero', dinero);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-reglas__avisos">
      <input type="hidden" name="id" value={id} />
      <BotonConfirmar
        etiqueta={tr('reglas.forma.borrar')} tono="peligro" etiquetaConfirmar={tr('reglas.forma.siBorrarla')}
        titulo={tr('reglas.forma.borrarEstaRegla')}
        descripcion={tr('reglas.forma.seVaLaRegla')}
        className={clasesBoton('danger-soft', 'sm')}
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
  const { t: tr } = useT('dinero', dinero);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-reglas__avisos">
      <input type="hidden" name="id" value={id} />
      <div className="rv-reglas__frecuencia">
        <CampoTexto tipo="number" name="maxAvisosDia" min={1} max={24} step={1} required
          etiqueta={tr('reglas.forma.maximoDeAvisosEn')} defaultValue={maxAvisosDia} />
        <CampoTexto tipo="number" name="minHorasEntreAvisos" min={0} max={168} step={1} required
          etiqueta={tr('reglas.forma.horasEntreUnAviso')} defaultValue={minHorasEntreAvisos} />
        <BotonEnvio etiqueta={tr('reglas.forma.guardarLimite')} ocupado="Guardando…" tono="suave" />
      </div>
      {estado && <AvisoResultado estado={estado.ok ? { ok: true, mensaje: estado.mensaje } : { ok: false, error: estado.error }} />}
    </form>
  );
}
