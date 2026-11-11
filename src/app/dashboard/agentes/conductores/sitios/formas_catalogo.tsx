'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import '../conductores.css';
import { Boton, CampoArchivo, CampoSelect, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import { Aviso, type AccionSitio } from './formas';
import { CUPO_DEFECTO, CUPO_MAX, CUPO_MIN } from '@/lib/likida/conductor/catalogo_sitios_import';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

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
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, enviar] = useActionState(accion, null);
  const cupos = Array.from({ length: CUPO_MAX - CUPO_MIN + 1 }, (_, i) => CUPO_MIN + i);
  return (
    <form action={enviar} className="rv-cd__pila" aria-label={tx('rest.analizar_o_importar_el_catalogo_depurado')} encType="multipart/form-data">
      <CampoArchivo etiqueta={tx('rest.archivo_csv_o_json')} name="archivo" accept=".csv,.json,text/csv,application/json,text/plain" />
      <div className="rv-cd__cuad">
        <CampoSelect etiqueta={tx('conductores.vista.que_hacer')} name="modo" defaultValue="analizar">
          <option value="analizar">{tx('rest.solo_analizar_no_guarda_nada')}</option>
          <option value="importar">{tx('rest.analizar_e_importar_las_filas_listas')}</option>
        </CampoSelect>
        <CampoSelect etiqueta={tx('rest.revisiones_por_terminal_al_dia')} name="cupo" defaultValue={String(CUPO_DEFECTO)}>
          {cupos.map((c) => <option key={c} value={c}>{c}</option>)}
        </CampoSelect>
        <CampoTexto etiqueta={tx('rest.radio_por_defecto_en_metros_si')} name="radio_defecto" inputMode="numeric" placeholder="150" />
      </div>
      <div className="rv-cd__linea"><Enviar texto={tx('rest.procesar_catalogo')} /></div>
      <Aviso r={estado} />
    </form>
  );
}
