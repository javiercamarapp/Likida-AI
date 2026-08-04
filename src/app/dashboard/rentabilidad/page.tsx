import { DollarSign } from 'lucide-react';
import SeccionPendiente from '../pendiente';
import { exigirVerRuta } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export default async function RentabilidadPage() {
  await exigirVerRuta('/dashboard/rentabilidad');
  return (
    <SeccionPendiente
      Icono={DollarSign}
      titulo="Rentabilidad / Finanzas"
      subtitulo="Ingresos, costos, utilidad y margen"
      falta={
        <>
          Likida ve todo lo que tu flota <strong>gasta</strong> (diésel, casetas, viáticos: eso está en Cuadre y en
          Combustible &amp; Casetas), pero no ve lo que <strong>cobra</strong>. El sistema no registra el ingreso del
          flete en ningún lado — `viaje.anticipo` es el dinero que le adelantas al operador, no lo que te paga tu
          cliente.
          <br /><br />
          Sin ingreso no hay utilidad, ni margen, ni punto de equilibrio: son restas que necesitan las dos
          cantidades. Calcularlas con el anticipo haciendo de ingreso daría números que se ven bien y están mal.
        </>
      }
      cuandoExista={[
        'Ingresos vs. costos en el tiempo, con el área de utilidad entre las dos líneas',
        'Utilidad neta y margen % del periodo, contra el periodo anterior',
        'Punto de equilibrio: cuántos viajes necesitas al mes para cubrir el costo fijo',
        'Estructura de costos: en qué se va cada peso',
        'Rentabilidad por ruta — cuáles te dejan y cuáles te cuestan',
        'Flujo de caja: por cobrar contra por pagar',
      ]}
    />
  );
}
