'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Boton, CampoArchivo, Icono } from '@/app/ui-v2/componentes';
import '../../agentes.css';
import '../liquidacion.css';

/** La subida del Excel de muestra. El botón primario espera a que haya un archivo elegido: sin la precondición se ve como lo que es (punteado,
 *  Rovaq «acción punteada cuando falta la precondición») y no como una acción lista que rebota con «elige un archivo». */
export function FormaSubirMuestra({ accion, etiqueta, boton }: { accion: (fd: FormData) => Promise<void>; etiqueta: string; boton: string }) {
  const [hayArchivo, setHayArchivo] = useState(false);
  return (
    <form action={accion} encType="multipart/form-data" className="rv-liq-acciones rv-liq-acciones--forma">
      <CampoArchivo etiqueta={etiqueta} name="archivo" accept=".xlsx,.xls,.ods,.csv" required
        onChange={(e) => setHayArchivo((e.currentTarget.files?.length ?? 0) > 0)} />
      <Boton type="submit" tamano="md" variante={hayArchivo ? 'primary' : 'secondary'} disabled={!hayArchivo}
        className={hayArchivo ? undefined : 'rv-ag-no-disponible'} icono={<Icono icono={Upload} tam={14} />}>{boton}</Boton>
    </form>
  );
}
