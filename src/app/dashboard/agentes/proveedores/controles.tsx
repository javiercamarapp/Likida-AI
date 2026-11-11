'use client';

import { useEffect, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Upload, Check, X, Copy, Mail } from 'lucide-react';
import './proveedores.css';
import { validarArchivoElegido } from '@/lib/http/subidas_formulario';
import { Boton, CampoArchivo, Disclosure, Icono } from '@/app/ui-v2/componentes';

export type AccionProveedores = (
  prev: { error?: string; aviso?: string; confirmar?: boolean } | null,
  fd: FormData,
) => Promise<{ error?: string; aviso?: string; confirmar?: boolean } | null>;

/** Subida del XML. Tras guardar, la página se refresca para que la bandeja
 *  y los KPIs cuenten la factura nueva. */
export function SubirFactura({ subirFactura }: { subirFactura: AccionProveedores }) {
  const [estado, accion] = useActionState(subirFactura, null);
  const router = useRouter();

  useEffect(() => {
    if (estado?.aviso) router.refresh();
  }, [estado, router]);

  return (
    <div>
      <form action={accion} className="rv-prov__linea">
        <CampoArchivo etiqueta="XML de la factura de proveedor" name="archivo" accept=".xml,text/xml,application/xml" required />
        <BotonSubir />
      </form>
      <ResultadoSubida estado={estado} />
    </div>
  );
}

function ResultadoSubida({ estado }: { estado: { error?: string; aviso?: string } | null }) {
  return (
    <>
      {estado?.error && <p role="alert" className="rv-prov__nota" data-tono="bad">{estado.error}</p>}
      {estado?.aviso && <p role="status" className="rv-prov__nota" data-tono={estado.aviso.includes('OJO') ? 'warn' : undefined}>{estado.aviso}</p>}
    </>
  );
}

function BotonSubir({ rotulo = 'Subir a la bandeja', pendienteRotulo = 'Leyendo…' }: {
  rotulo?: string; pendienteRotulo?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Upload} tam={14} />}>
      {pending ? pendienteRotulo : rotulo}
    </Boton>
  );
}

/**
 * La vía de FOTO (F6): cuando solo hay papel. El botón dice "leer con IA" a
 * propósito — las cifras van a salir de visión, no del XML, y el aviso de la
 * action manda a revisarlas contra el papel antes de aprobar.
 */
export function SubirFotoFactura({ subirFoto }: { subirFoto: AccionProveedores }) {
  const [estado, accion] = useActionState(subirFoto, null);
  const router = useRouter();

  useEffect(() => {
    if (estado?.aviso) router.refresh();
  }, [estado, router]);

  return (
    <div>
      <form action={accion} className="rv-prov__linea">
        <CampoArchivo etiqueta="Foto de la factura de proveedor" name="archivo" accept="image/jpeg,image/png,image/webp" required
          onChange={(e) => validarArchivoElegido(e.currentTarget)} />
        <BotonSubir rotulo="Leer foto con IA" pendienteRotulo="Leyendo la foto…" />
      </form>
      <p className="rv-prov__nota" data-tono="faint">Máximo 4 MB por foto.</p>
      <ResultadoSubida estado={estado} />
    </div>
  );
}

/** Aprobar / rechazar, con confirmación de dos pasos en el rechazo (aprobar
 *  es reversible en el ERP; rechazar la saca del export sin vuelta aquí). */
export function BotonesDecision({ facturaId, decidir }: { facturaId: string; decidir: AccionProveedores }) {
  const [estado, accion] = useActionState(decidir, null);
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div className="rv-prov__decision">
      {confirmando ? (
        <form action={accion} onSubmit={() => setConfirmando(false)} className="rv-prov__linea">
          <input type="hidden" name="facturaId" value={facturaId} />
          <input type="hidden" name="decision" value="rechazada" />
          <span className="rv-prov__nota">¿Rechazarla?</span>
          <BotonMini texto="Sí" pendienteTexto="…" destructivo />
          <Boton tamano="sm" onClick={() => setConfirmando(false)}>No</Boton>
        </form>
      ) : (
        <div className="rv-prov__linea">
          <form action={accion}>
            <input type="hidden" name="facturaId" value={facturaId} />
            <input type="hidden" name="decision" value="aprobada" />
            {/* A37-S55-03: tras la advertencia del servidor, el siguiente clic ya es una confirmación. */}
            {estado?.confirmar && <input type="hidden" name="confirmar" value="1" />}
            <BotonMini texto={estado?.confirmar ? 'Aprobar de todos modos' : 'Aprobar'} pendienteTexto="Guardando…" IconoOk />
          </form>
          <Boton tamano="sm" onClick={() => setConfirmando(true)} title="Rechazar la factura" icono={<Icono icono={X} tam={14} />}>Rechazar</Boton>
        </div>
      )}
      {estado?.error && <p role="alert" className="rv-prov__nota" data-tono="bad">{estado.error}</p>}
    </div>
  );
}

/** La dirección del buzón en mono con su botón de copiar — el mismo patrón
 *  `copiar()` de la cola del jefe: confirmación de 1.5 s, sin alertas. */
export function DireccionBuzon({ direccion }: { direccion: string }) {
  const [copiado, setCopiado] = useState(false);

  function copiar() {
    void navigator.clipboard.writeText(direccion).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    });
  }

  return (
    <div className="rv-prov__linea">
      <code className="cifra-mono rv-prov__direccion">{direccion}</code>
      <Boton variante="ghost" tamano="sm" aria-label="Copiar la dirección del buzón" onClick={copiar} data-copiado={copiado || undefined}>
        <Icono icono={copiado ? Check : Copy} tam={14} />
      </Boton>
    </div>
  );
}

/** Generar la dirección por primera vez. La action redirige al terminar, así
 *  que aquí solo se enseña el error si lo hubo. */
export function GenerarBuzon({ generar }: { generar: AccionProveedores }) {
  const [estado, accion] = useActionState(generar, null);
  return (
    <div>
      <form action={accion}>
        <BotonBuzon texto="Generar dirección" pendienteTexto="Generando…" />
      </form>
      {estado?.error && <p role="alert" className="rv-prov__nota" data-tono="bad">{estado.error}</p>}
    </div>
  );
}

/**
 * Rotar, escondido en un `<details>` A PROPÓSITO: no es una acción de todos
 * los días y su consecuencia es irreversible en el acto — el correo que
 * llegue al buzón viejo cae en `buzon_desconocido` y se ignora. La
 * advertencia va ANTES del botón, no en un tooltip.
 */
export function RotarBuzon({ rotar }: { rotar: AccionProveedores }) {
  const [estado, accion] = useActionState(rotar, null);
  return (
    <Disclosure titulo="¿Necesitas rotar la dirección?" variante="linea">
      <div className="rv-prov__pila">
        <p className="rv-prov__nota" data-tono="warn">
          Rotar genera una dirección nueva e <strong>invalida la actual en el acto</strong>: los
          correos que lleguen al buzón viejo se ignoran sin avisarle a quien los mandó. Hazlo solo
          si la dirección se filtró a donde no debía, y pásales la nueva a tus proveedores.
        </p>
        <form action={accion}>
          <BotonBuzon texto="Rotar e invalidar la anterior" pendienteTexto="Rotando…" destructivo />
        </form>
        {estado?.error && <p role="alert" className="rv-prov__nota" data-tono="bad">{estado.error}</p>}
      </div>
    </Disclosure>
  );
}

function BotonBuzon({ texto, pendienteTexto, destructivo }: {
  texto: string; pendienteTexto: string; destructivo?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante={destructivo ? 'danger' : 'primary'} loading={pending} icono={<Icono icono={Mail} tam={14} />}>
      {pending ? pendienteTexto : texto}
    </Boton>
  );
}

function BotonMini({ texto, pendienteTexto, IconoOk, destructivo }: {
  texto: string; pendienteTexto: string; IconoOk?: boolean; destructivo?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" tamano="sm" variante={destructivo ? 'danger' : 'primary'} loading={pending} icono={IconoOk ? <Icono icono={Check} tam={14} /> : undefined}>
      {pending ? pendienteTexto : texto}
    </Boton>
  );
}
