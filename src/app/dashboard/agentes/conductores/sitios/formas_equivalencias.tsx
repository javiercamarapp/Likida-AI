'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import { Aviso, type AccionSitio } from './formas';
import { MARCAR_IGNORAR, MARCAR_INSTRUCCION } from '@/lib/likida/conductor/sitios';

// ═══════════════════════════════════════════════════════════════════════════
// LAS EQUIVALENCIAS TEXTO→SITIO (0803): el importador CSV y la asignación de un texto sin sitio.
// Herramienta NEUTRAL: no trae ningún diccionario, lo llena la flota. Cada fila del archivo se aprueba o se rechaza sola.
// ═══════════════════════════════════════════════════════════════════════════

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)]';
const ETIQUETA = 'block text-[11px] font-medium mb-1';

function Boton({ texto, pendiente }: { texto: string; pendiente: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Upload width={14} height={14} strokeWidth={1.75} />{pending ? pendiente : texto}
    </button>
  );
}

export function FormaImportarEquivalencias({ accion }: { accion: AccionSitio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="space-y-3" aria-label="Importar equivalencias desde CSV" encType="multipart/form-data">
      <label className="block"><span className={ETIQUETA}>Archivo CSV</span>
        <input type="file" name="archivo" accept=".csv,text/csv,text/plain" className="text-[12.5px]" />
      </label>
      <label className="block"><span className={ETIQUETA}>…o pega el contenido</span>
        <textarea name="csv" rows={4} spellCheck={false} className={`${CAMPO} h-auto py-2 w-full font-mono text-[12px]`}
          placeholder={'texto,geocerca_codigo,tipo,lado\nSTOP Planta Demo FINAL ACERO,PL-DEMO,sitio,destino'} />
      </label>
      <div className="flex items-center gap-3 flex-wrap"><Boton texto="Importar equivalencias" pendiente="Importando…" /></div>
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
    <form action={enviar} className="flex items-center gap-2 flex-wrap" aria-label={`Asignar «${texto}»`}>
      <input type="hidden" name="texto" value={texto} />
      <input type="hidden" name="lado" value={lado} />
      <select name="asignar" defaultValue="" className={`${CAMPO} h-8 text-[12.5px] max-w-[26ch]`} aria-label={`Qué es «${texto}»`}>
        <option value="">Elegir…</option>
        <optgroup label="Un sitio de mi catálogo">
          {sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </optgroup>
        <optgroup label="No es un lugar">
          <option value={MARCAR_INSTRUCCION}>Es una instrucción</option>
          <option value={MARCAR_IGNORAR}>Ignorar</option>
        </optgroup>
      </select>
      <Boton2 />
      {estado && <span className="basis-full"><Aviso r={estado} /></span>}
    </form>
  );
}

function Boton2() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="h-8 px-3 rounded-lg text-[12.5px] hairline disabled:opacity-50">{pending ? 'Guardando…' : 'Guardar'}</button>;
}
