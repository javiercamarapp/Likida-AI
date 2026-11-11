import type { Metadata } from 'next';
import { MarcoPublico } from './ui-v2/componentes/marco-publico';
import { BotonEnlace } from './ui-v2/componentes/boton';
import './legal/publico-r2.css';
import './legal/flujo-publico.css';

// El 404 es una pantalla de marca, no de panel: la única superficie que ve alguien que no ha entrado nunca (un enlace viejo
// reenviado por WhatsApp, un resultado de buscador, un correo de hace meses). Se pinta con el MISMO marco público que el resto de las
// pantallas de acceso (`/sin-acceso`, `/cuenta`): cabecera con el logo, rótulo mono, título, UNA línea de apoyo y la salida. Como el de
// Rovaq, sin figura ni adorno: un 404 no es una acción que el producto quiera que hagas, es un callejón con la salida a la vista.
// Todo sale de los tokens del marco (pivotan solos con el tema guardado): no hay un solo color literal.

export const metadata: Metadata = {
  title: 'Página no encontrada — Likida',
};

export default function NoEncontrado() {
  return (
    <MarcoPublico
      rotulo="Error 404"
      titulo="Esta ruta no está en el mapa."
      apoyo="El enlace pudo cambiar de lugar o venir mal escrito. Vuelve al inicio: te deja en tu panel si ya iniciaste sesión, y en el acceso si no."
      ancho="estrecho"
      acciones={
        <>
          {/* `/` NO es una landing: es la puerta que reparte por sesión y por rol (`page.tsx` → `puertaDeEntrada`). */}
          <BotonEnlace href="/" variante="primary">Volver al inicio</BotonEnlace>
          <BotonEnlace href="/dashboard/soporte">Ir a soporte</BotonEnlace>
        </>
      }
    >
      <div className="rv-flujo" aria-hidden="true" />
    </MarcoPublico>
  );
}
