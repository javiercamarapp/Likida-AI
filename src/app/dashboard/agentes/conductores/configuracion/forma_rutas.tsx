'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import '../conductores.css';
import { Boton, CampoArchivo, CampoTextarea, Icono } from '@/app/ui-v2/componentes';
import { Aviso, type AccionSitio } from '../sitios/formas';
import { PLANTILLA_CSV_RUTAS } from '@/lib/likida/conductor/rutas';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

// ═══════════════════════════════════════════════════════════════════════════
// LAS RUTAS AUTORIZADAS DE GOOGLE MAPS (T-A5-48, 0808): el importador CSV de la pantalla de configuración.
// Herramienta NEUTRAL: no trae ninguna ruta, la llena la flota. Cada fila se aprueba o se rechaza sola y se dice por qué;
// reimportar el mismo archivo = 0 cambios.
// ═══════════════════════════════════════════════════════════════════════════

function Enviar() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Upload} tam={14} />}>
      {pending ? 'Importando…' : tx('rest.importar_rutas')}
    </Boton>
  );
}

export function FormaImportarRutas({ accion }: { accion: AccionSitio }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__form" aria-label={tx('rest.importar_rutas_desde_csv')} encType="multipart/form-data">
      <CampoArchivo etiqueta={tx('rest.archivo_csv')} name="archivo" accept=".csv,text/csv,text/plain" />
      <CampoTextarea etiqueta={tx('rest.o_pega_el_contenido')} name="csv" rows={4} spellCheck={false} claseControl="rv-cd__mono" placeholder={PLANTILLA_CSV_RUTAS} />
      <div className="rv-cd__linea"><Enviar /></div>
      <Aviso r={estado} />
    </form>
  );
}
