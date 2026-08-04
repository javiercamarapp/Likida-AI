import { Users2 } from 'lucide-react';
import SeccionPendiente from '../pendiente';
import { exigirVerRuta } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export default async function ClientesPage() {
  await exigirVerRuta('/dashboard/clientes');
  return (
    <SeccionPendiente
      Icono={Users2}
      titulo="Clientes"
      subtitulo="Quién te da carga y cuánto pesa cada uno"
      falta={
        <>
          No existe tabla de clientes en el sistema. Un viaje hoy guarda origen, destino, operador y anticipo —
          nunca a quién se le está moviendo la carga.
          <br /><br />
          Sin eso no se puede decir cuánto te deja cada cliente, ni qué tan concentrado estás en uno solo (que es
          el número que de verdad importa: si un cliente es el 60% de tu ingreso, perderlo te quiebra).
        </>
      }
      cuandoExista={[
        'Ingreso por cliente, del que más te deja al que menos',
        'Concentración: qué tanto de tu operación depende de un solo cliente',
        'Cartera vencida por cliente y días promedio de cobro',
        'Ficha por cliente: sus viajes, sus rutas, su margen, su historial de pago',
        'Margen por cliente — no siempre el que más factura es el que más deja',
      ]}
    />
  );
}
