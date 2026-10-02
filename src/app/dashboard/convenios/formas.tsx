'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import { Aviso, type ResultadoSitio } from '../agentes/conductores/sitios/formas';

// ═══════════════════════════════════════════════════════════════════════════
// EL IMPORTADOR DE CONVENIOS (CSV o Excel) — todo o nada, con la fila de cada problema.
// Reusa el `Aviso` del catálogo de sitios: un solo sistema de avisos.
// ═══════════════════════════════════════════════════════════════════════════

export type AccionConvenio = (previo: ResultadoSitio, fd: FormData) => Promise<ResultadoSitio>;

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)] w-full';
const ETIQUETA = 'block text-[11px] font-medium mb-1';

function BotonImportar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Upload width={14} height={14} strokeWidth={1.75} />{pending ? 'Importando…' : 'Importar'}
    </button>
  );
}

export function FormaImportarConvenios({ accion }: { accion: AccionConvenio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="space-y-3" aria-label="Importar convenios desde CSV o Excel" encType="multipart/form-data">
      <label className="block"><span className={ETIQUETA}>Archivo CSV o Excel (.xlsx)</span>
        <input type="file" name="archivo" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="text-[12.5px]" />
      </label>
      <label className="block"><span className={ETIQUETA}>…o pega el contenido</span>
        <textarea name="csv" rows={5} spellCheck={false} className={`${CAMPO} h-auto py-2 font-mono text-[12px]`}
          placeholder={'cliente,convenio,categoria,instruccion,momento,lugar\nCliente Uno,Ruta norte,puerta,Puerta 3 lado poniente,ambos,destino'} />
      </label>
      <div className="flex items-center gap-3 flex-wrap"><BotonImportar /></div>
      <Aviso r={estado} />
    </form>
  );
}
