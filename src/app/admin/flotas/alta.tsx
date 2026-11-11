import { CampoSelect, CampoTexto, Casilla } from '../../ui-v2/componentes/campos';
import { FormaConAviso, type AccionDeForma } from '../ui/forma';
import { REGIMENES, USOS_CFDI } from '@/lib/saas/fiscal';

/**
 * El formulario de alta de una flota. Presentacional: la acción de servidor (`accionCrearFlota`, con su puerta, su segundo factor y su
 * bitácora) llega por prop. `planes === null` = no se pudieron leer los planes: se dice, no se ofrece un selector vacío como si no hubiera.
 */
export function AltaFlota({ accion, planes }: { accion: AccionDeForma; planes: Array<{ clave: string; nombre: string }> | null }) {
  return (
    <FormaConAviso accion={accion} boton="Dar de alta" columnas="md:grid-cols-2">
      <CamposAltaFlota planes={planes} />
    </FormaConAviso>
  );
}

/** Los campos del alta, sin envoltorio: los comparten el formulario de página (`AltaFlota`) y el cajón de «Nueva flota». */
export function CamposAltaFlota({ planes }: { planes: Array<{ clave: string; nombre: string }> | null }) {
  return (
    <>
      <CampoTexto etiqueta="Nombre de la flota" name="nombre" required placeholder="Flota de ejemplo" />
      {planes === null ? (
        <CampoTexto etiqueta="Plan" name="planNoDisponible" disabled placeholder="No se pudieron leer los planes" ayuda="Asígnalo después desde la ficha." />
      ) : (
        <CampoSelect etiqueta="Plan" name="planClave" defaultValue="" ayuda="Empieza en «prueba»: no cuenta para el MRR hasta activarlo desde la ficha.">
          <option value="">Sin plan por ahora</option>
          {planes.map((p) => <option key={p.clave} value={p.clave}>{p.nombre}</option>)}
        </CampoSelect>
      )}
      <CampoTexto etiqueta="RFC" name="rfc" placeholder="Opcional" ayuda="Se rechaza si no pasa el dígito verificador." />
      <CampoTexto etiqueta="Ciudad" name="ciudad" placeholder="Opcional" />
      <CampoTexto etiqueta="Razón social" name="razonSocial" placeholder="Opcional"
        ayuda="Tal cual su Constancia de Situación Fiscal: el SAT la compara contra lo que tiene para ese RFC." />
      <CampoTexto etiqueta="Código postal fiscal" name="codigoPostalFiscal" placeholder="5 dígitos, opcional"
        ayuda="El del domicilio fiscal ante el SAT, no el del patio." />
      <CampoSelect etiqueta="Uso del CFDI" name="usoCfdi" defaultValue="">
        <option value="">Sin declarar</option>
        {USOS_CFDI.map((u) => <option key={u.clave} value={u.clave}>{u.clave} — {u.nombre}</option>)}
      </CampoSelect>
      <CampoSelect etiqueta="Régimen fiscal" name="regimenFiscal" defaultValue=""
        ayuda="La facilidad del 15 % (RFA 2.9) exige 624 Coordinados o 612 persona física; cualquier otro no califica.">
        <option value="">Sin declarar</option>
        {REGIMENES.map((r) => <option key={r.clave} value={r.clave}>{r.clave} — {r.nombre}</option>)}
      </CampoSelect>
      <CampoTexto etiqueta="Correo del administrador" name="emailAdmin" tipo="email" placeholder="dueño@flota.mx"
        ayuda="Recibe el correo de acceso. Sin él, la flota nace sin quién pueda entrar." />
      <CampoTexto etiqueta="Nombre del administrador" name="nombreAdmin" placeholder="Opcional" />
      <CampoTexto etiqueta="WhatsApp del administrador" name="telefonoAdmin" placeholder="10 dígitos, opcional"
        ayuda="Con él, el bot reconoce al administrador cuando escribe." />
      <Casilla name="dedicacionExclusivaCarga" etiqueta="Exclusivamente autotransporte de carga federal"
        ayuda="Habilita la facilidad del 15 % de diésel en efectivo (RFA 2026, regla 2.9)." />
    </>
  );
}
