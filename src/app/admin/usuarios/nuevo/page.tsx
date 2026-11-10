import type { Metadata } from 'next';
import { CampoSelect, CampoTexto } from '../../../ui-v2/componentes/campos';
import { MarcoPagina, Tarjeta } from '../../../ui-v2/componentes';
import { requireSuperadmin } from '@/lib/auth/guard';
import type { RolAppUser } from '@/lib/auth/provisionar';
import { ROTULOS_ROL } from '@/lib/auth/roles';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { FormaConAviso } from '../../ui/forma';
import { accionNuevoAcceso } from './acciones';

export const dynamic = 'force-dynamic';

// H18/ADM-7: los rótulos salen de `lib/auth/roles.ts` (el catálogo único); aquí decían cosas que ninguna otra pantalla decía.
const ROLES: Array<{ valor: RolAppUser; etiqueta: string }> = [
  { valor: 'flota_admin', etiqueta: `${ROTULOS_ROL.flota_admin.nombre} — ${ROTULOS_ROL.flota_admin.detalle}` },
  { valor: 'encargado', etiqueta: `${ROTULOS_ROL.encargado.nombre} — ${ROTULOS_ROL.encargado.detalle}` },
  { valor: 'contador', etiqueta: `${ROTULOS_ROL.contador.nombre} — ${ROTULOS_ROL.contador.detalle}` },
];

/**
 * Equipo › Nuevo acceso — da de alta a una persona de una flota: cuenta de acceso, asiento en la bitácora y correo de acceso. Reemplaza
 * el script que había que escribir y correr a mano. La URL no cambia (enlaces entrantes y correos ya enviados). `?flota=` deja la flota
 * preseleccionada (botón «Agregar usuario» de la ficha). El resultado se ve en la misma pantalla (`useActionState`).
 */
export default async function NuevoUsuario({ searchParams }: { searchParams?: Promise<{ flota?: string }> }) {
  await requireSuperadmin();
  const [{ flotas }, sp] = await Promise.all([getResumenNegocio(), searchParams]);
  const preseleccion = flotas.some((f) => f.id === sp?.flota) ? sp?.flota : '';

  return (
    <MarcoPagina
      area="Control" titulo="Equipo" ancho="lectura"
      apoyo="Da de alta a una persona de una flota y le mandamos el correo de acceso."
    >
      <Tarjeta titulo="Nuevo acceso">
        <FormaConAviso accion={accionNuevoAcceso} boton="Crear usuario" columnas="md:grid-cols-2">
          <CampoSelect etiqueta="Flota" name="tenantId" required defaultValue={preseleccion}>
            <option value="" disabled>Elige una flota</option>
            {flotas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </CampoSelect>
          <CampoSelect etiqueta="Rol" name="rol" required defaultValue="flota_admin">
            {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
          </CampoSelect>
          <CampoTexto etiqueta="Correo" name="email" tipo="email" required placeholder="persona@flota.com" />
          <CampoTexto etiqueta="Nombre (opcional)" name="nombre" />
          {/* D5 (auditoría 4): sin WhatsApp la persona no podía escribirle al bot sin un UPDATE a mano. */}
          <CampoTexto etiqueta="WhatsApp (opcional)" name="telefono" placeholder="10 dígitos"
            ayuda="Con él, el bot reconoce a esta persona cuando escribe (avisos contestables, despacho por chat)." />
        </FormaConAviso>
        <p>
          Crea la cuenta de acceso y la persona en el panel, deja el asiento en la bitácora y le manda el correo de acceso. El primer ingreso
          (enlace por correo) confirma la cuenta. Si el canal de correo no está configurado, la pantalla lo dice y la cuenta queda creada:
          usa «Reenviar acceso» desde Personas. Los vendedores se dan de alta en Ventas.
        </p>
      </Tarjeta>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Nuevo acceso' };
