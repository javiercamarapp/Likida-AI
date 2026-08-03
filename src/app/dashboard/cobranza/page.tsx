import { Landmark } from 'lucide-react';
import SeccionPendiente from '../pendiente';

export const dynamic = 'force-dynamic';

export default function CobranzaPage() {
  return (
    <SeccionPendiente
      Icono={Landmark}
      titulo="Cobranza"
      subtitulo="Lo que te deben y qué tanto tardan en pagarte"
      falta={
        <>
          No hay facturación emitida en el sistema, así que no hay nada que cobrar que Likida conozca. No existe
          tabla de facturas propias, ni de pagos recibidos, ni de recordatorios enviados.
          <br /><br />
          Los CFDI que Likida sí maneja son los que tú <strong>recibes</strong> de tus proveedores (diésel,
          casetas) — están en Facturación. Es lo contrario de la cobranza.
        </>
      }
      cuandoExista={[
        'Total por cobrar, y cuánto de eso ya está vencido',
        'DSO: cuántos días tardas en cobrar, y si esa cifra mejora o empeora',
        'Facturas por estatus — emitida, por vencer, vencida, pagada',
        'Recordatorios por WhatsApp y qué tantos pagos gatillaron',
        'Link de rastreo para tu cliente: ve dónde va su carga y su evidencia de entrega',
      ]}
    />
  );
}
