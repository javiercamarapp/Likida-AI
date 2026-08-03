import { Wrench } from 'lucide-react';
import SeccionPendiente from '../pendiente';

export const dynamic = 'force-dynamic';

export default function UnidadesPage() {
  return (
    <SeccionPendiente
      Icono={Wrench}
      titulo="Unidades"
      subtitulo="Tus tractocamiones: papeles, mantenimiento y disponibilidad"
      falta={
        <>
          No existe registro de vehículos en el sistema. Ni siquiera `viaje` guarda qué unidad hizo el viaje.
          <br /><br />
          Lo único que hay hoy con forma de unidad es el catálogo de <strong>calibración por placa</strong> (en
          Configuración): cuántos km/L y qué tanque esperar de esa placa, para detectar consumo raro. Eso es un
          parámetro del motor de cuadre, no un expediente del vehículo — no tiene póliza, ni permiso SICT, ni
          historial de servicio.
        </>
      }
      cuandoExista={[
        'Una ficha por unidad: placa, configuración (T3S3, C2, C3), póliza y permiso SICT con sus vencimientos',
        'Alertas de papel por vencer antes de que te detengan en carretera',
        'Mantenimiento preventivo contra correctivo, y costo por unidad',
        'Disponibilidad y días fuera de servicio',
        'DVIR con foto: la revisión que el operador hace antes de salir',
      ]}
    />
  );
}
