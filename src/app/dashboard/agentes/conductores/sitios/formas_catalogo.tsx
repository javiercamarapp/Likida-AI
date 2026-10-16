'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import { Aviso, type AccionSitio } from './formas';
import { CUPO_DEFECTO, CUPO_MAX, CUPO_MIN } from '@/lib/likida/conductor/catalogo_sitios_import';

// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DEPURADO DE ORÍGENES Y DESTINOS (T-SYS-25): analizar (no guarda nada) o importar por lotes, y la lista de
// validación por terminal con cupo diario. Nada se fusiona solo ni se corrige una coordenada.
// ═══════════════════════════════════════════════════════════════════════════

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)]';
const ETIQUETA = 'block text-[11px] font-medium mb-1';

function Boton({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Upload width={14} height={14} strokeWidth={1.75} />{pending ? 'Procesando…' : texto}
    </button>
  );
}

export function FormaCatalogo({ accion }: { accion: AccionSitio }) {
  const [estado, enviar] = useActionState(accion, null);
  const cupos = Array.from({ length: CUPO_MAX - CUPO_MIN + 1 }, (_, i) => CUPO_MIN + i);
  return (
    <form action={enviar} className="space-y-3" aria-label="Analizar o importar el catálogo depurado" encType="multipart/form-data">
      <label className="block"><span className={ETIQUETA}>Archivo CSV o JSON</span>
        <input type="file" name="archivo" accept=".csv,.json,text/csv,application/json,text/plain" className="text-[12.5px]" />
      </label>
      <div className="flex gap-3 flex-wrap">
        <label className="block"><span className={ETIQUETA}>Qué hacer</span>
          <select name="modo" defaultValue="analizar" className={CAMPO}>
            <option value="analizar">Solo analizar (no guarda nada)</option>
            <option value="importar">Analizar e importar las filas listas</option>
          </select>
        </label>
        <label className="block"><span className={ETIQUETA}>Revisiones por terminal al día</span>
          <select name="cupo" defaultValue={String(CUPO_DEFECTO)} className={CAMPO}>
            {cupos.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block max-w-[28ch]"><span className={ETIQUETA}>Radio por defecto en metros (si falta)</span>
          <input name="radio_defecto" inputMode="numeric" placeholder="150" className={CAMPO} />
        </label>
      </div>
      <div className="flex items-center gap-3 flex-wrap"><Boton texto="Procesar catálogo" /></div>
      <Aviso r={estado} />
    </form>
  );
}
