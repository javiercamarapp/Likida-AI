'use client';

import { useEffect } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { FileUp } from 'lucide-react';

export interface ResultadoImportarUI {
  error?: string;
  resumen?: {
    creados: number;
    saltados: number;
    descartadas: Array<{ fila: number; motivo: string }>;
    operadoresSinAmarrar: string[];
  };
}

export type AccionImportar = (prev: ResultadoImportarUI | null, fd: FormData) => Promise<ResultadoImportarUI | null>;

/**
 * El export del TMS (CSV/Excel) entra al Registro — el kit del PoC: sin
 * esto, el conciliador de peajes no tiene contra qué cruzar. La lectura y
 * la inserción viven en el servidor; NADIE recibe WhatsApp por un import.
 */
export function ImportarViajes({ importar }: { importar: AccionImportar }) {
  const [estado, accion] = useActionState(importar, null);
  const router = useRouter();

  useEffect(() => {
    if (estado?.resumen) router.refresh();
  }, [estado, router]);

  const r = estado?.resumen;

  return (
    <div className="min-w-0">
      <form action={accion} className="flex items-center gap-2 flex-wrap">
        <input type="file" name="archivo" accept=".csv,.xlsx,.xls" required
          aria-label="CSV o Excel con los viajes"
          className="text-[12.5px] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[12.5px] file:font-medium file:cursor-pointer"
          style={{ color: 'var(--muted)' }} />
        <BotonImportar />
      </form>
      <p className="text-[11px] mt-1.5" style={{ color: 'var(--faint)' }}>
        Columnas: folio (obligatoria), origen, destino, fecha, anticipo, operador.
        Sin avisos de WhatsApp; los folios que ya existen se saltan solos.
      </p>
      {estado?.error && <p className="text-[12px] mt-1.5" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
      {r && (
        <div className="text-[12px] mt-1.5 space-y-0.5" style={{ color: 'var(--muted)' }}>
          <p>
            <span className="cifra-mono font-medium" style={{ color: 'var(--ink)' }}>{r.creados}</span> viajes creados
            {r.saltados > 0 && <> · {r.saltados} saltados (el folio ya existía)</>}
            {r.descartadas.length > 0 && <span style={{ color: 'var(--warn)' }}> · {r.descartadas.length} filas descartadas</span>}
          </p>
          {r.descartadas.slice(0, 5).map((d) => (
            <p key={d.fila} style={{ color: 'var(--warn)' }}>fila {d.fila}: {d.motivo}</p>
          ))}
          {r.descartadas.length > 5 && <p style={{ color: 'var(--faint)' }}>y {r.descartadas.length - 5} más.</p>}
          {r.operadoresSinAmarrar.length > 0 && (
            <p>Sin amarrar a un operador (quedaron sin asignar): {r.operadoresSinAmarrar.join(', ')}.</p>
          )}
        </div>
      )}
    </div>
  );
}

function BotonImportar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <FileUp width={13} height={13} strokeWidth={2} className={pending ? 'animate-pulse' : ''} />
      {pending ? 'Importando…' : 'Importar viajes'}
    </button>
  );
}
