import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getCostoPorFaseModelo, contarConversacionesActivas } from '@/lib/admin/negocio';
import { MarcoPagina, FilaTarjetas, Tarjeta, Aviso, BotonEnlace } from '@/app/ui-v2/componentes';
import { TiraCifras } from '@/app/ui-v2/graficas';
import { TarjetaFase } from '../tarjeta-fase';

export const dynamic = 'force-dynamic';

/**
 * Agente de WhatsApp: la conversación con el operador de principio a fin. Real: `llm_costo` filtrado por la fase `whatsapp` y
 * `wa_conversacion.estado` para CUÁNTAS conversaciones hay activas. La lista de conversaciones vive solo en Agentes › Conversaciones
 * (con el teléfono enmascarado); aquí NO se repite: una cifra y un enlace. Un cero de costo es MEDIDO, no un relleno.
 */
export default async function AgenteWhatsappPage() {
  await requireSuperadmin();
  const [r, porFaseModelo, activas] = await Promise.all([
    getResumenNegocio(), getCostoPorFaseModelo().catch(() => []), contarConversacionesActivas(),
  ]);
  const whatsapp = r.porFase.find((f) => f.fase === 'whatsapp');
  const modelos = porFaseModelo.filter((m) => m.fase === 'whatsapp');

  return (
    <MarcoPagina
      area="Agentes"
      titulo="Agentes"
      apoyo="WhatsApp: la conversación completa con el operador. Costo real, histórico."
      acciones={<BotonEnlace href="/admin/conversaciones" variante="secondary" tamano="sm">Ver conversaciones</BotonEnlace>}
    >
      <Aviso tono="info">
        El WhatsApp del producto sigue en el número de prueba de Meta: las cifras de aquí son de esa operación, no de un número de producción.
      </Aviso>

      <TiraCifras
        etiqueta="WhatsApp"
        items={[
          { etiqueta: 'Gastado en WhatsApp', valor: whatsapp ? whatsapp.costoUsd : 0, formato: 'usd', nota: 'Costo medido en llm_costo' },
          { etiqueta: 'Llamadas de WhatsApp', valor: whatsapp ? whatsapp.n : 0, formato: 'entero' },
          { etiqueta: 'Conversaciones activas', valor: activas, estado: activas === null ? 'error' : 'ok', formato: 'entero', href: '/admin/conversaciones' },
        ]}
      />

      <FilaTarjetas variante="6-6">
        <TarjetaFase
          titulo="Costo por modelo, WhatsApp"
          queHace="Lleva la conversación con el operador de principio a fin: recibe fotos, confirma y cierra la liquidación."
          datos={whatsapp}
          modelos={modelos}
        />
        <Tarjeta
          titulo="Lo que falta medir"
          estado="vacio"
          mensaje="Entrega y ventana de 24 horas"
          detalle="Enviados, entregados y leídos, la ventana de 24 horas y los opt-ins requiere integrar la Meta WhatsApp Business API más a fondo de lo que Likida usa hoy."
        />
      </FilaTarjetas>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'WhatsApp' };
