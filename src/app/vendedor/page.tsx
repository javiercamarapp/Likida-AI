import { requireVendedor } from '@/lib/auth/guard';
import { PanelVendedor } from './panel-vendedor';

export const dynamic = 'force-dynamic';

/**
 * /vendedor — SOLO el gate y el traspaso de la sesión. El contenido completo
 * vive en `panel-vendedor.tsx` (exportado) por la razón #2 de
 * `dashboard/inicio-contenido.tsx`: el gate impide montar la página en un
 * preview headless sin sesión, y el componente extraído sí se monta con un
 * userId arbitrario — el REAL, no una copia.
 *
 * El gate está DOBLE a propósito (layout + página): la página no debe
 * depender de que el layout siga gateando. El `userId`/`rol` que se pasan
 * son los de la SESIÓN y solo deciden qué se LEE; toda escritura re-resuelve
 * la sesión adentro del panel.
 */
export default async function VendedorPage({
  searchParams,
}: {
  /** FE-10: `?col=<etapa>&pag=N` expande UNA columna del tablero. El panel
   *  los sanea (etapa del dominio, página entera ≥ 1); un link viejo o
   *  manipulado se lee como "ninguna columna expandida". */
  searchParams: Promise<{ col?: string; pag?: string }>;
}) {
  const [s, sp] = await Promise.all([requireVendedor(), searchParams]);
  return <PanelVendedor userId={s.userId} nombre={s.nombre} rol={s.rol} col={sp.col} pag={sp.pag} />;
}
