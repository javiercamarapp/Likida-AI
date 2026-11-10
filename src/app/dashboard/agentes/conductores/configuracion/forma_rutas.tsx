'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import '../conductores.css';
import { Boton, CampoArchivo, CampoTextarea, Icono } from '@/app/ui-v2/componentes';
import { Aviso, type AccionSitio } from '../sitios/formas';
import { PLANTILLA_CSV_RUTAS } from '@/lib/likida/conductor/rutas';

// ═══════════════════════════════════════════════════════════════════════════
// LAS RUTAS AUTORIZADAS DE GOOGLE MAPS (T-A5-48, 0808): el importador CSV de la pantalla de configuración.
// Herramienta NEUTRAL: no trae ninguna ruta, la llena la flota. Cada fila se aprueba o se rechaza sola y se dice por qué;
// reimportar el mismo archivo = 0 cambios.
// ═══════════════════════════════════════════════════════════════════════════

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Upload} tam={14} />}>
      {pending ? 'Importando…' : 'Importar rutas'}
    </Boton>
  );
}

export function FormaImportarRutas({ accion }: { accion: AccionSitio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__form" aria-label="Importar rutas desde CSV" encType="multipart/form-data">
      <CampoArchivo etiqueta="Archivo CSV" name="archivo" accept=".csv,text/csv,text/plain" />
      <CampoTextarea etiqueta="…o pega el contenido" name="csv" rows={4} spellCheck={false} claseControl="rv-cd__mono" placeholder={PLANTILLA_CSV_RUTAS} />
      <div className="rv-cd__linea"><Enviar /></div>
      <Aviso r={estado} />
    </form>
  );
}
