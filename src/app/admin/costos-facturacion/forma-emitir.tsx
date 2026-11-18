'use client';

import { useActionState, useState } from 'react';
import { Aviso, type AccionDeForma, type ResultadoAccion } from '../ui/forma';
import { BotonConfirmar } from '../ui/confirmar';
import { CampoSelect, clasesBoton } from '../../ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { admin_dinero } from '@/lib/i18n/es/admin_dinero';

// ═══════════════════════════════════════════════════════════════════════════
// "EMITIR MENSUALIDAD" — auditoría adversarial, HALLAZGO MEDIO: `accionEmitir`
// dispara `emitirMensualidad` (acción fiscal real: genera el cobro del
// periodo, con constraint de unicidad por periodo en la base, 0057) con un
// solo clic y CERO diálogo de confirmación. Un clic accidental en la flota
// equivocada emite una mensualidad real que luego hay que corregir A MANO —
// no hay botón para deshacerla. Se envuelve con el ÚNICO sistema de
// confirmación del repo (`admin/ui/confirmar`, DESIGN.md §3: nunca un
// `confirm()` nuevo), mismo molde que `FormaRechazarCliente`
// (admin/mcp-clientes, PR #583): `BotonConfirmar`/`DialogoConfirmar`, con
// `tono="peligro"`, y el diálogo DICE qué periodo y a qué flota se le va a
// emitir — no "¿estás seguro?" a secas.
//
// Aquí la flota NO es fija por fila (como en mcp-clientes, un botón por
// cliente): es un `<select>` dentro del MISMO formulario, y el diálogo tiene
// que anunciar la opción elegida EN ESE MOMENTO — por eso el `<select>` es
// CONTROLADO (useState) en vez de no controlado. Mientras no se elija flota,
// el disparador queda deshabilitado: no hay manera de abrir el diálogo con
// "elige una flota" como destinatario.
// ═══════════════════════════════════════════════════════════════════════════

export function FormaEmitirMensualidad({
  accion, flotas, periodoIni, periodoFin,
}: {
  accion: AccionDeForma;
  flotas: Array<{ id: string; nombre: string }>;
  /** El MISMO cálculo que corre `accionEmitir` (periodoMesActualMx): el
   *  diálogo anuncia el periodo REAL que se va a emitir, nunca uno aproximado
   *  calculado aparte que pudiera divergir del que de verdad se cobra. */
  periodoIni: string;
  periodoFin: string;
}) {
  const { t } = useT('admin_dinero', admin_dinero);
  const [estado, despachar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const [tenantId, setTenantId] = useState('');
  const flota = flotas.find((f) => f.id === tenantId);

  return (
    <form action={despachar} className="adm-din-forma">
      <CampoSelect etiqueta={t('costos_facturacion.flota')} id="tenantId" name="tenantId" obligatorio value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
        <option value="">{t('neg5.elige')}</option>
        {flotas.map((f) => (
          <option key={f.id} value={f.id}>{f.nombre}</option>
        ))}
      </CampoSelect>
      <Aviso estado={estado} />
      <div>
        <BotonConfirmar
          etiqueta={t('neg5.cf_emitir')}
          tono="peligro"
          deshabilitado={!tenantId || pendiente}
          etiquetaConfirmar={t('neg5.cf_si_emitir')}
          titulo={t('neg5.cf_emitir_mensualidad')}
          descripcion={flota
            ? t('neg5.cf_desc_emitir', { ini: periodoIni, fin: periodoFin, flota: flota.nombre })
            : t('neg5.cf_elige_primero')}
          className={clasesBoton('primary', 'md')}
        />
      </div>
    </form>
  );
}
