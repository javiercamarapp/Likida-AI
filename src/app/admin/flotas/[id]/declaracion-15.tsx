import { CampoSelect } from '../../../ui-v2/componentes/campos';
import { FormaConAviso, type AccionDeForma } from '../../ui/forma';

/** La declaración del 15 % (RFA 2.9) de UNA flota: se ve y se corrige. Presentacional; la acción (`accionFacilidad`) llega por prop. */
export function Declaracion15({ flotaId, ded, reg, accion }: {
  flotaId: string;
  ded: boolean | undefined;
  reg: boolean | undefined;
  accion: AccionDeForma;
}) {
  const valor = (b: boolean | undefined) => (b === true ? 'si' : b === false ? 'no' : '');
  return (
    <FormaConAviso accion={accion} boton="Guardar declaración" columnas="md:grid-cols-2">
      <input type="hidden" name="flotaId" value={flotaId} />
      <CampoSelect etiqueta="Dedicación exclusiva a carga" name="ded" defaultValue={valor(ded)}>
        <option value="">Sin declarar</option>
        <option value="si">Sí</option>
        <option value="no">No</option>
      </CampoSelect>
      <CampoSelect etiqueta="Régimen elegible" name="reg" defaultValue={valor(reg)}>
        <option value="">Sin declarar</option>
        <option value="si">Sí</option>
        <option value="no">No</option>
      </CampoSelect>
    </FormaConAviso>
  );
}
