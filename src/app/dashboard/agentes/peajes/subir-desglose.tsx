'use client';

import { useEffect } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet } from 'lucide-react';
import { validarArchivoElegido } from '@/lib/http/subidas_formulario';
import { Boton, CampoArchivo, CampoFecha, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import './peajes.css';

export type ResumenImportado = {
  totalLineas: number;
  cuadra: number;
  noCuadra: number;
  sinContraparte: number;
  avisos: string[];
};
/** `aviso`: el archivo se recibió pero todavía no se procesa (queda en cola para el siguiente ciclo). */
export type EstadoImportar = { error?: string; aviso?: string; resumen?: ResumenImportado } | null;
export type AccionImportar = (prev: EstadoImportar, fd: FormData) => Promise<EstadoImportar>;

/**
 * El desglose del proveedor (Excel/CSV/PDF), por pantalla. El servidor lo
 * importa Y corre el cruce en el mismo paso (el momento del PoC: sube el
 * archivo, ve sus tres cubetas); el acuse dice los tres números y los avisos
 * del parseo — lo que se saltó se DICE, no desaparece. Tras importar, la
 * página completa se refresca para que la lista y el detalle cuenten lo nuevo.
 */
export function SubirDesgloseProveedor({ importar }: { importar: AccionImportar }) {
  const [estado, accion] = useActionState(importar, null);
  const router = useRouter();

  useEffect(() => {
    if (estado?.resumen || estado?.aviso) router.refresh();
  }, [estado, router]);

  const r = estado?.resumen;

  return (
    <div className="rv-pj-control">
      <form action={accion} className="rv-pj-forma">
        <CampoArchivo etiqueta="Desglose del proveedor de peaje (Excel, CSV o PDF)" name="archivo" accept=".xlsx,.xls,.csv,.tsv,.ods,.pdf" required
          onChange={(e) => validarArchivoElegido(e.currentTarget)} />
        <CampoTexto etiqueta="Proveedor del desglose (opcional)" name="proveedor" placeholder="Proveedor (IAVE, PASE, TeleVía…)" />
        <CampoFecha etiqueta="Inicio del periodo del archivo (opcional)" name="periodo_desde" />
        <CampoFecha etiqueta="Fin del periodo del archivo (opcional)" name="periodo_hasta" />
        <BotonImportar />
      </form>
      <p className="rv-pj-nota">
        Máximo 4 MB por archivo (un corte decenal real pesa ~1 MB). Sube el Excel del proveedor tal cual: se lee solo su hoja principal.
        El periodo decide qué cobro es extemporáneo: si no lo declaras, se toma del nombre del archivo («01 A 10 DE SEPT»); si tampoco lo dice, esa revisión no se aplica y se avisa.
      </p>
      {estado?.error && <p className="rv-pj-sub rv-pj-malo" role="alert">{estado.error}</p>}
      {estado?.aviso && <p className="rv-pj-sub" role="status">{estado.aviso}</p>}
      {r && (
        <div className="rv-pj-acuse" role="status">
          <p className="rv-pj-sub">
            Desglose importado (<span className="cifra-mono">{r.totalLineas}</span> líneas) y cruzado:{' '}
            <strong className="cifra-mono">{r.cuadra}</strong> cuadran
            {r.noCuadra > 0 && <> · <span className="cifra-mono">{r.noCuadra}</span> con discrepancia</>}
            {r.sinContraparte > 0 && <> · <span className="cifra-mono">{r.sinContraparte}</span> sin contraparte</>}.
          </p>
          {r.avisos.map((a) => (
            <p key={a} className="rv-pj-nota">{a}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function BotonImportar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={FileSpreadsheet} />}>
      {pending ? 'Cruzando…' : 'Importar y cruzar'}
    </Boton>
  );
}
