'use client';

import { useState } from 'react';
import { SegmentedControl } from '../ui-v2/componentes/segmented';
import { OPCIONES_TEMA, useTema, type Tema } from '../selector-tema';
import { solicitarCambioIdioma } from '@/lib/i18n/cambiar';
import { idiomaElegible, type Idioma } from '@/lib/i18n/idioma';

interface Textos {
  idioma: string; tema: string; temaClaro: string; temaSistema: string; temaOscuro: string; es: string; en: string; enProximamente: string; fallo: string;
}

/** Las dos filas rótulo-control de la cuenta (Rovaq CF): idioma y tema. Hacen lo mismo que el pie del panel: el tema se guarda en el
 *  navegador; el idioma pide la cookie al servidor y solo cuando confirma recarga (si no confirma lo dice y deja el vigente). */
export function PreferenciasCuenta({ idiomaActivo, textos }: { idiomaActivo: Idioma; textos: Textos }) {
  const { tema, elegir } = useTema();
  const [fallo, setFallo] = useState(false);
  const [pendiente, setPendiente] = useState(false);
  const rotuloTema: Record<Tema, string> = { claro: textos.temaClaro, sistema: textos.temaSistema, oscuro: textos.temaOscuro };
  async function cambiarIdioma(nuevo: Idioma) {
    if (nuevo === idiomaActivo || pendiente || !idiomaElegible(nuevo)) return;
    setPendiente(true);
    setFallo(false);
    if (await solicitarCambioIdioma(nuevo)) { window.location.reload(); return; }
    setPendiente(false);
    setFallo(true);
  }
  return (
    <div className="rv-cuenta__prefs">
      <div className="rv-cuenta__fila">
        <p>{textos.idioma}</p>
        <SegmentedControl<Idioma> etiqueta={textos.idioma} valor={idiomaActivo} onChange={(v) => { void cambiarIdioma(v); }}
          opciones={[
            { valor: 'es', etiqueta: textos.es },
            { valor: 'en', etiqueta: idiomaElegible('en') ? textos.en : textos.enProximamente, deshabilitada: !idiomaElegible('en') },
          ]} />
      </div>
      <div className="rv-cuenta__fila">
        <p>{textos.tema}</p>
        <SegmentedControl<Tema> etiqueta={textos.tema} valor={tema} onChange={elegir}
          opciones={OPCIONES_TEMA.map((o) => ({ valor: o.valor, etiqueta: rotuloTema[o.valor] }))} />
      </div>
      <p className="rv-sr" role="status">{fallo ? textos.fallo : ''}</p>
    </div>
  );
}
