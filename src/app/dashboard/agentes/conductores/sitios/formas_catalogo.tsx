'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import '../conductores.css';
import { Boton, CampoArchivo, CampoSelect, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import { Aviso, type AccionSitio } from './formas';
import { CUPO_DEFECTO, CUPO_MAX, CUPO_MIN } from '@/lib/likida/conductor/catalogo_sitios_import';

// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DEPURADO DE ORÍGENES Y DESTINOS (T-SYS-25): analizar (no guarda nada) o importar por lotes, y la lista de
// validación por terminal con cupo diario. Nada se fusiona solo ni se corrige una coordenada.
// ═══════════════════════════════════════════════════════════════════════════

function Enviar({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Upload} tam={14} />}>
      {pending ? 'Procesando…' : texto}
    </Boton>
  );
}

export function FormaCatalogo({ accion }: { accion: AccionSitio }) {
  const [estado, enviar] = useActionState(accion, null);
  const cupos = Array.from({ length: CUPO_MAX - CUPO_MIN + 1 }, (_, i) => CUPO_MIN + i);
  return (
    <form action={enviar} className="rv-cd__pila" aria-label="Analizar o importar el catálogo depurado" encType="multipart/form-data">
      <CampoArchivo etiqueta="Archivo CSV o JSON" name="archivo" accept=".csv,.json,text/csv,application/json,text/plain" />
      <div className="rv-cd__cuad">
        <CampoSelect etiqueta="Qué hacer" name="modo" defaultValue="analizar">
          <option value="analizar">Solo analizar (no guarda nada)</option>
          <option value="importar">Analizar e importar las filas listas</option>
        </CampoSelect>
        <CampoSelect etiqueta="Revisiones por terminal al día" name="cupo" defaultValue={String(CUPO_DEFECTO)}>
          {cupos.map((c) => <option key={c} value={c}>{c}</option>)}
        </CampoSelect>
        <CampoTexto etiqueta="Radio por defecto en metros (si falta)" name="radio_defecto" inputMode="numeric" placeholder="150" />
      </div>
      <div className="rv-cd__linea"><Enviar texto="Procesar catálogo" /></div>
      <Aviso r={estado} />
    </form>
  );
}
