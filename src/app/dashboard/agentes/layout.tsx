import type { ReactNode } from 'react';
import { IdiomaProvider } from '@/lib/i18n/proveedor';
import { datosParaProveedor } from '@/lib/i18n/servidor';

/**
 * Trae al navegador el diccionario `agentes` (solo del idioma activo) para los componentes de cliente de los paneles de los
 * agentes. En español no manda nada: cada componente trae su diccionario es como respaldo. Se repite `shell` porque el
 * proveedor anidado reemplaza al del layout de /dashboard.
 */
export default async function LayoutAgentes({ children }: { children: ReactNode }) {
  const datos = await datosParaProveedor(['shell', 'agentes']);
  return <IdiomaProvider idioma={datos.idioma} diccionarios={datos.diccionarios}>{children}</IdiomaProvider>;
}
