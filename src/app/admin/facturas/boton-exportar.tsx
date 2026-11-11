'use client';

import { useState, useTransition } from 'react';
import { Download } from 'lucide-react';
import { AvisoCompacto, Boton, Icono } from '../../ui-v2/componentes';
import { accionExportarFacturas } from './acciones';

// El botón «Exportar CSV»: pide el archivo a la acción de servidor (que valida, arma, asienta la bitácora y devuelve el texto) y lo
// entrega como descarga desde el navegador. Los filtros viajan como campos ocultos de la propia forma: la acción los vuelve a validar.
export function BotonExportarFacturas({ estado, desde, hasta, deshabilitado }: { estado?: string; desde?: string; hasta?: string; deshabilitado?: boolean }) {
  const [pendiente, empezar] = useTransition();
  const [mensaje, setMensaje] = useState<{ tono: 'error' | 'warn' | 'ok'; texto: string } | null>(null);

  function exportar(fd: FormData) {
    setMensaje(null);
    empezar(async () => {
      const r = await accionExportarFacturas(fd);
      if (!r.ok) { setMensaje({ tono: 'error', texto: r.error }); return; }
      const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = r.nombre;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setMensaje({ tono: r.aviso ? 'warn' : 'ok', texto: `${r.filas} ${r.filas === 1 ? 'factura exportada' : 'facturas exportadas'}.${r.aviso ? ` ${r.aviso}` : ''}` });
    });
  }

  return (
    <form action={exportar} className="adm-din-acciones">
      <input type="hidden" name="estado" value={estado ?? ''} />
      <input type="hidden" name="desde" value={desde ?? ''} />
      <input type="hidden" name="hasta" value={hasta ?? ''} />
      <Boton type="submit" variante="secondary" tamano="sm" loading={pendiente} disabled={deshabilitado} icono={<Icono icono={Download} />}>Exportar CSV</Boton>
      {mensaje ? <AvisoCompacto tono={mensaje.tono === 'error' ? 'error' : mensaje.tono === 'warn' ? 'warn' : 'ok'} resumen={mensaje.texto} /> : null}
    </form>
  );
}
