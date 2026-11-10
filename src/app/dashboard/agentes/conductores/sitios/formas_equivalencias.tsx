'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import '../conductores.css';
import { Boton, CampoArchivo, CampoSelect, CampoTextarea, Icono } from '@/app/ui-v2/componentes';
import { Aviso, type AccionSitio } from './formas';
import { MARCAR_IGNORAR, MARCAR_INSTRUCCION } from '@/lib/likida/conductor/sitios';

// ═══════════════════════════════════════════════════════════════════════════
// LAS EQUIVALENCIAS TEXTO→SITIO (0803): el importador CSV y la asignación de un texto sin sitio.
// Herramienta NEUTRAL: no trae ningún diccionario, lo llena la flota. Cada fila del archivo se aprueba o se rechaza sola.
// ═══════════════════════════════════════════════════════════════════════════

function Enviar({ texto, pendiente }: { texto: string; pendiente: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Upload} tam={14} />}>
      {pending ? pendiente : texto}
    </Boton>
  );
}

export function FormaImportarEquivalencias({ accion }: { accion: AccionSitio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__form" aria-label="Importar equivalencias desde CSV" encType="multipart/form-data">
      <CampoArchivo etiqueta="Archivo CSV" name="archivo" accept=".csv,text/csv,text/plain" />
      <CampoTextarea etiqueta="…o pega el contenido" name="csv" rows={4} spellCheck={false} claseControl="rv-cd__mono"
        placeholder={'texto,geocerca_codigo,tipo,lado\nSTOP Planta Demo FINAL ACERO,PL-DEMO,sitio,destino'} />
      <div className="rv-cd__linea"><Enviar texto="Importar equivalencias" pendiente="Importando…" /></div>
      <Aviso r={estado} />
    </form>
  );
}

/** Un texto sin sitio con su selector: un sitio del catálogo, «instrucción» o «ignorar». */
export function FilaTextoSinSitio({ accion, texto, lado, sitios }: {
  accion: AccionSitio; texto: string; lado: string; sitios: Array<{ id: string; nombre: string }>;
}) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__linea" aria-label={`Asignar «${texto}»`}>
      <input type="hidden" name="texto" value={texto} />
      <input type="hidden" name="lado" value={lado} />
      <CampoSelect etiqueta={`Qué es «${texto}»`} etiquetaOculta name="asignar" defaultValue="">
        <option value="">Elegir…</option>
        <optgroup label="Un sitio de mi catálogo">
          {sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </optgroup>
        <optgroup label="No es un lugar">
          <option value={MARCAR_INSTRUCCION}>Es una instrucción</option>
          <option value={MARCAR_IGNORAR}>Ignorar</option>
        </optgroup>
      </CampoSelect>
      <Guardar />
      {estado && <Aviso r={estado} />}
    </form>
  );
}

function Guardar() {
  const { pending } = useFormStatus();
  return <Boton type="submit" tamano="sm" loading={pending}>{pending ? 'Guardando…' : 'Guardar'}</Boton>;
}
