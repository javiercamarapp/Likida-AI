'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import '../conductores.css';
import { Boton, CampoArchivo, CampoSelect, CampoTextarea, Icono } from '@/app/ui-v2/componentes';
import { Aviso, type AccionSitio } from './formas';
import { MARCAR_IGNORAR, MARCAR_INSTRUCCION } from '@/lib/likida/conductor/sitios';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

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
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__form" aria-label={tx('rest.importar_equivalencias_desde_csv')} encType="multipart/form-data">
      <CampoArchivo etiqueta={tx('rest.archivo_csv')} name="archivo" accept=".csv,text/csv,text/plain" />
      <CampoTextarea etiqueta={tx('rest.o_pega_el_contenido')} name="csv" rows={4} spellCheck={false} claseControl="rv-cd__mono"
        placeholder={tx('rest.texto_geocerca_codigo_tipo_lado_stop')} />
      <div className="rv-cd__linea"><Enviar texto={tx('rest.importar_equivalencias')} pendiente={tx('rest.importando')} /></div>
      <Aviso r={estado} />
    </form>
  );
}

/** Un texto sin sitio con su selector: un sitio del catálogo, «instrucción» o «ignorar». */
export function FilaTextoSinSitio({ accion, texto, lado, sitios }: {
  accion: AccionSitio; texto: string; lado: string; sitios: Array<{ id: string; nombre: string }>;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__linea" aria-label={`Asignar «${texto}»`}>
      <input type="hidden" name="texto" value={texto} />
      <input type="hidden" name="lado" value={lado} />
      <CampoSelect etiqueta={tx('rest.que_es', { texto })} etiquetaOculta name="asignar" defaultValue="">
        <option value="">{tx('rest.elegir')}</option>
        <optgroup label={tx('rest.un_sitio_de_mi_catalogo')}>
          {sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </optgroup>
        <optgroup label={tx('rest.no_es_un_lugar')}>
          <option value={MARCAR_INSTRUCCION}>{tx('rest.es_una_instruccion')}</option>
          <option value={MARCAR_IGNORAR}>{tx('rest.ignorar')}</option>
        </optgroup>
      </CampoSelect>
      <Guardar />
      {estado && <Aviso r={estado} />}
    </form>
  );
}

function Guardar() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return <Boton type="submit" tamano="sm" loading={pending}>{pending ? 'Guardando…' : tx('rest.guardar')}</Boton>;
}
