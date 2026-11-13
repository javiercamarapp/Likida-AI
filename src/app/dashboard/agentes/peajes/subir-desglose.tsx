'use client';

import { useEffect } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet } from 'lucide-react';
import { validarArchivoElegido } from '@/lib/http/subidas_formulario';
import { Boton, CampoArchivo, CampoFecha, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import { ZonaSoltar } from '../zona-soltar';
import './peajes.css';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

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
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, accion] = useActionState(importar, null);
  const router = useRouter();

  useEffect(() => {
    if (estado?.resumen || estado?.aviso) router.refresh();
  }, [estado, router]);

  const r = estado?.resumen;

  return (
    <div className="rv-pj-control">
      <form action={accion} className="rv-pj-forma-pila">
        <ZonaSoltar>
          <CampoArchivo etiqueta={tx('rest.desglose_del_proveedor_de_peaje_excel')} name="archivo" accept=".xlsx,.xls,.csv,.tsv,.ods,.pdf" required
            onChange={(e) => validarArchivoElegido(e.currentTarget)} />
        </ZonaSoltar>
        <div className="rv-pj-forma rv-pj-forma--rejilla">
        <CampoTexto etiqueta={tx('rest.proveedor_del_desglose_opcional')} name="proveedor" placeholder={tx('rest.proveedor_iave_pase_televia')} />
        <CampoFecha etiqueta={tx('rest.inicio_del_periodo_del_archivo_opcional')} name="periodo_desde" />
        <CampoFecha etiqueta={tx('rest.fin_del_periodo_del_archivo_opcional')} name="periodo_hasta" />
        <BotonImportar />
        </div>
      </form>
      <p className="rv-pj-nota">{tx('rest.maximo_4_mb_por_archivo_un')}</p>
      {estado?.error && <p className="rv-pj-sub rv-pj-malo" role="alert">{estado.error}</p>}
      {estado?.aviso && <p className="rv-pj-sub" role="status">{estado.aviso}</p>}
      {r && (
        <div className="rv-pj-acuse" role="status">
          <p className="rv-pj-sub">{tx('rest.desglose_importado')}<span className="rv-ag-num">{r.totalLineas}</span>{' '}{tx('rest.lineas_y_cruzado')}{' '}<strong className="rv-ag-num">{r.cuadra}</strong> cuadran
            {r.noCuadra > 0 && <> · <span className="rv-ag-num">{r.noCuadra}</span>{' '}{tx('rest.con_discrepancia_2')}</>}
            {r.sinContraparte > 0 && <> · <span className="rv-ag-num">{r.sinContraparte}</span>{' '}{tx('rest.sin_contraparte')}</>}.
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
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={FileSpreadsheet} tam={14} />}>
      {pending ? 'Cruzando…' : tx('rest.importar_y_cruzar')}
    </Boton>
  );
}
