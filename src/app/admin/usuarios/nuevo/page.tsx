import type { Metadata } from 'next';
import { EsqueletoConfiguracion } from '../../../ui-v2/esqueletos';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { FormaNuevoAcceso } from './forma-nuevo-acceso';
import '../../resumen.css';

export const dynamic = 'force-dynamic';

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
    <EsqueletoConfiguracion
      area="Control" titulo="Equipo"
      apoyo="Da de alta a una persona de una flota y le mandamos el correo de acceso."
      secciones={[{
        id: 'nuevo-acceso', titulo: 'Nuevo acceso',
        // La ayuda va como descripción de la tarjeta, no pegada al botón: el pie queda con una sola acción.
        descripcion: 'Crea la cuenta de acceso y la persona en el panel, deja el asiento en la bitácora y le manda el correo de acceso. El primer ingreso (enlace por correo) confirma la cuenta. Si el canal de correo no está configurado, la pantalla lo dice y la cuenta queda creada: usa «Reenviar acceso» desde Personas. Los vendedores se dan de alta en Ventas.',
        contenido: <FormaNuevoAcceso flotas={flotas} preseleccion={preseleccion} />,
      }]}
    />
  );
}

export const metadata: Metadata = { title: 'Nuevo acceso' };
