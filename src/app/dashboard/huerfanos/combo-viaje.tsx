'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { OpcionViaje } from '@/lib/likida/repo_paginado';
import './huerfanos.css';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';

// ═══════════════════════════════════════════════════════════════════════════
// FE-3 (auditoría 24) — el mismo remedio de `ComboCatalogo` (FE-2, 22-ago),
// para el `<select>` de "Adjuntar a…" que ofrecía los viajes vivos entre los
// 100 más recientes: el huérfano típico es de un viaje de 1-3 días atrás, que
// a 500 viajes/día ya no está en esa ventana.
//
// No reutiliza `ComboCatalogo` (vive en `combo-catalogo.tsx`, tipado a
// `TipoCatalogo`/`OpcionCatalogo` de `lib/likida/repo.ts`, que es de otro
// agente de esta auditoría) — mismo patrón, componente propio.
// ═══════════════════════════════════════════════════════════════════════════

export type BuscarViaje = (q: string) => Promise<OpcionViaje[]>;

const FRENO_MS = 200;

export function ComboViaje({
  name, buscar, requerido = false, className, 'aria-label': ariaLabel,
}: {
  name: string;
  buscar: BuscarViaje;
  requerido?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const { t } = useT('operacion', operacionEs);
  const listaId = useId();
  const [texto, setTexto] = useState('');
  const [id, setId] = useState<string | null>(null);
  const [opciones, setOpciones] = useState<OpcionViaje[]>([]);
  const [fallo, setFallo] = useState(false);
  const vuelo = useRef(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pedir = useCallback((q: string) => {
    const mio = ++vuelo.current;
    buscar(q)
      .then((r) => { if (vuelo.current === mio) { setOpciones(r); setFallo(false); } })
      .catch(() => { if (vuelo.current === mio) { setOpciones([]); setFallo(true); } });
  }, [buscar]);

  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);

  const alEscribir = (v: string) => {
    setTexto(v);
    const coincide = opciones.find((o) => o.etiqueta.toLowerCase() === v.trim().toLowerCase());
    setId(coincide ? coincide.id : null);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => pedir(v), FRENO_MS);
  };

  const sinResolver = texto.trim() !== '' && id === null;

  return (
    <div className="rv-hf__combo">
      <input type="hidden" name={name} value={id ?? ''} />
      <input
        type="text"
        role="combobox"
        aria-controls={listaId}
        aria-expanded={opciones.length > 0}
        aria-label={ariaLabel}
        list={listaId}
        value={texto}
        required={requerido}
        autoComplete="off"
        placeholder={t('hf.combo.ph')}
        onFocus={() => { if (opciones.length === 0) pedir(texto); }}
        onChange={(e) => alEscribir(e.target.value)}
        className={className}
      />
      <datalist id={listaId}>
        {opciones.map((o) => <option key={o.id} value={o.etiqueta} />)}
      </datalist>
      {fallo ? (
        <p className="rv-hf__aviso" data-tono="bad" role="status">{t('hf.combo.error')}</p>
      ) : sinResolver ? (
        <p className="rv-hf__aviso" data-tono="warn" role="status">{t('hf.combo.elige')}</p>
      ) : null}
    </div>
  );
}
