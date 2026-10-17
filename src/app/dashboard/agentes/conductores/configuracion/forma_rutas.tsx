'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import { Aviso, type AccionSitio } from '../sitios/formas';
import { PLANTILLA_CSV_RUTAS } from '@/lib/likida/conductor/rutas';

// ═══════════════════════════════════════════════════════════════════════════
// LAS RUTAS AUTORIZADAS DE GOOGLE MAPS (T-A5-48, 0808): el importador CSV de la pantalla de configuración.
// Herramienta NEUTRAL: no trae ninguna ruta, la llena la flota. Cada fila se aprueba o se rechaza sola y se dice por qué;
// reimportar el mismo archivo = 0 cambios.
// ═══════════════════════════════════════════════════════════════════════════

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)] w-full';
const ETIQUETA = 'block text-[11px] font-medium mb-1';

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Upload width={14} height={14} strokeWidth={1.75} />{pending ? 'Importando…' : 'Importar rutas'}
    </button>
  );
}

export function FormaImportarRutas({ accion }: { accion: AccionSitio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="space-y-3" aria-label="Importar rutas desde CSV" encType="multipart/form-data">
      <label className="block"><span className={ETIQUETA}>Archivo CSV</span>
        <input type="file" name="archivo" accept=".csv,text/csv,text/plain" className="text-[12.5px]" />
      </label>
      <label className="block"><span className={ETIQUETA}>…o pega el contenido</span>
        <textarea name="csv" rows={4} spellCheck={false} className={`${CAMPO} h-auto py-2 font-mono text-[12px]`} placeholder={PLANTILLA_CSV_RUTAS} />
      </label>
      <div className="flex items-center gap-3 flex-wrap"><Boton /></div>
      <Aviso r={estado} />
    </form>
  );
}
