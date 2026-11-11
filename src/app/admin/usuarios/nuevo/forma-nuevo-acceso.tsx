import { CampoSelect, CampoTexto } from '../../../ui-v2/componentes/campos';
import { FilaConfig } from '../../../ui-v2/esqueletos';
import type { RolAppUser } from '@/lib/auth/provisionar';
import { ROTULOS_ROL } from '@/lib/auth/roles';
import { FormaConAviso } from '../../ui/forma';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { accionNuevoAcceso } from './acciones';

// H18/ADM-7: los rótulos salen de `lib/auth/roles.ts` (el catálogo único); aquí decían cosas que ninguna otra pantalla decía.
const ROLES: Array<{ valor: RolAppUser; etiqueta: string }> = [
  { valor: 'flota_admin', etiqueta: `${ROTULOS_ROL.flota_admin.nombre} — ${ROTULOS_ROL.flota_admin.detalle}` },
  { valor: 'encargado', etiqueta: `${ROTULOS_ROL.encargado.nombre} — ${ROTULOS_ROL.encargado.detalle}` },
  { valor: 'contador', etiqueta: `${ROTULOS_ROL.contador.nombre} — ${ROTULOS_ROL.contador.detalle}` },
];

/**
 * El alta de una persona de una flota, en filas rótulo-control (Rovaq CF: rótulo 14/600 con su ayuda a la izquierda, el control a la
 * derecha, divisores entre filas, UNA acción en el pie). La usan «Nuevo acceso» y la sección «Invitar integrante» de Equipo: un solo
 * formulario, una sola acción de servidor (`accionNuevoAcceso`, con su puerta y su bitácora).
 */
export function FormaNuevoAcceso({ flotas, preseleccion, t }: { flotas: ReadonlyArray<{ id: string; nombre: string }>; preseleccion?: string; t: TrDe<'admin_flotas'> }) {
  return (
    <div className="adm-forma-fina adm-forma-filas">
      <FormaConAviso accion={accionNuevoAcceso} boton={t('nuevo_acceso.crear')} columnas="md:grid-cols-1">
        <FilaConfig rotulo={t('nuevo_acceso.flota')} ayuda={t('nuevo_acceso.flota_ayuda')}>
          <CampoSelect etiqueta={t('nuevo_acceso.flota')} etiquetaOculta name="tenantId" required defaultValue={preseleccion ?? ''}>
            <option value="" disabled>{t('nuevo_acceso.elige_flota')}</option>
            {flotas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </CampoSelect>
        </FilaConfig>
        <FilaConfig rotulo={t('nuevo_acceso.rol')} ayuda={t('nuevo_acceso.rol_ayuda')}>
          <CampoSelect etiqueta={t('nuevo_acceso.rol')} etiquetaOculta name="rol" required defaultValue="flota_admin">
            {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
          </CampoSelect>
        </FilaConfig>
        <FilaConfig rotulo={t('nuevo_acceso.correo')} ayuda={t('nuevo_acceso.correo_ayuda')}>
          <CampoTexto etiqueta={t('nuevo_acceso.correo')} etiquetaOculta name="email" tipo="email" required placeholder="persona@flota.com" />
        </FilaConfig>
        <FilaConfig rotulo={t('nuevo_acceso.nombre')}>
          <CampoTexto etiqueta={t('nuevo_acceso.nombre')} etiquetaOculta name="nombre" />
        </FilaConfig>
        {/* D5 (auditoría 4): sin WhatsApp la persona no podía escribirle al bot sin un UPDATE a mano. */}
        <FilaConfig rotulo={t('nuevo_acceso.whatsapp')} ayuda={t('nuevo_acceso.whatsapp_ayuda')}>
          <CampoTexto etiqueta={t('nuevo_acceso.whatsapp')} etiquetaOculta name="telefono" placeholder={t('nuevo_acceso.digitos')} />
        </FilaConfig>
      </FormaConAviso>
    </div>
  );
}
