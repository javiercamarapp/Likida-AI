import type { Metadata } from 'next';
import { MarcoPublico } from './ui-v2/componentes/marco-publico';
import { BotonEnlace } from './ui-v2/componentes/boton';
import './legal/publico-r2.css';
import './legal/flujo-publico.css';
import { getT } from '@/lib/i18n/servidor';

// El 404 es una pantalla de marca, no de panel: la única superficie que ve alguien que no ha entrado nunca (un enlace viejo
// reenviado por WhatsApp, un resultado de buscador, un correo de hace meses). Se pinta con el MISMO marco público que el resto de las
// pantallas de acceso (`/sin-acceso`, `/cuenta`): cabecera con el logo, rótulo mono, título, UNA línea de apoyo y la salida. Como el de
// Rovaq, sin figura ni adorno: un 404 no es una acción que el producto quiera que hagas, es un callejón con la salida a la vista.
// Todo sale de los tokens del marco (pivotan solos con el tema guardado): no hay un solo color literal.

export const metadata: Metadata = {
  title: 'Página no encontrada — Likida',
};

export default async function NoEncontrado() {
  const { t } = await getT('ui_comun');
  return (
    <MarcoPublico
      rotulo={t('nf.rotulo')}
      titulo={t('nf.titulo')}
      apoyo={t('nf.apoyo')}
      ancho="estrecho"
      acciones={
        <>
          {/* `/` NO es una landing: es la puerta que reparte por sesión y por rol (`page.tsx` → `puertaDeEntrada`). */}
          <BotonEnlace href="/" variante="primary">{t('nf.inicio')}</BotonEnlace>
          <BotonEnlace href="/dashboard/soporte">{t('nf.soporte')}</BotonEnlace>
        </>
      }
    >
      <div className="rv-flujo" aria-hidden="true" />
    </MarcoPublico>
  );
}
