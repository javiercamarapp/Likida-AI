import { EsqPagina } from '../ui-v2/componentes';

/** La pantalla de carga de una ruta de HUB (una pantalla con pestañas hermanas): la barra de pestañas persiste al cambiar de pestaña
 *  (la pinta el marco de /admin), así que el esqueleto solo cubre lo que cambia —cifras y tarjetas— y el título no parpadea. Las rutas
 *  de hub la re-exportan desde su propio `loading.tsx`; la guarda `loading_esqueleto.test.tsx` comprueba cuál lleva cuál. */
export default function LoadingHub() {
  return <EsqPagina sinEncabezado />;
}
