'use client';

import { usePathname } from 'next/navigation';
import { TabsLinea } from '../ui-v2/componentes/tabs-linea';
import { entradaDeRuta, pestanaActiva } from './rutas';

/**
 * La barra de pestañas de /admin: aparece SOLA sobre cualquier página que pertenezca a un grupo del menú (`rutas.ts`). Cada pestaña es
 * una ruta hermana con su propia dirección (los enlaces de correos y runbooks siguen sirviendo), y el sidebar marca la entrada del grupo
 * como activa en todas. Es el mecanismo con el que el menú pasó de 43 a 16 entradas sin perder ninguna pantalla. Un grupo de una sola
 * página no pinta barra.
 */
export default function PestanasAdmin() {
  const pathname = usePathname();
  const entrada = entradaDeRuta(pathname);
  if (!entrada || !entrada.pestanas || entrada.pestanas.length < 2) return null;
  const actual = pestanaActiva(entrada, pathname);
  return (
    <TabsLinea
      className="adm-pestanas"
      etiqueta={`Secciones de ${entrada.nombre}`}
      actual={actual?.href ?? entrada.pestanas[0].href}
      pestanas={entrada.pestanas.map((p) => ({ clave: p.href, etiqueta: p.nombre, href: p.href }))}
    />
  );
}
