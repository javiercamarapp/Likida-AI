import { Map } from 'lucide-react';
import SeccionPendiente from '../pendiente';

export const dynamic = 'force-dynamic';

export default function MapaPage() {
  return (
    <SeccionPendiente
      Icono={Map}
      titulo="Mapa en vivo"
      subtitulo="Dónde va cada unidad ahora mismo"
      falta={
        <>
          Likida no está conectado a ningún GPS ni plataforma de rastreo. El sistema no guarda una sola coordenada:
          lo que sabe de un viaje es su origen y su destino escritos como texto, no dónde va.
          <br /><br />
          Esto no se resuelve con código de este lado — necesita integrar el proveedor de rastreo que ya traiga tu
          flota (o instalar uno).
        </>
      }
      cuandoExista={[
        'Posición de cada unidad en el mapa, en vivo',
        'La ruta real recorrida contra la planeada',
        'Geocercas: aviso automático al entrar o salir de un punto',
        'Alertas de seguridad — desvío, parada no autorizada, zona de riesgo',
      ]}
    />
  );
}
