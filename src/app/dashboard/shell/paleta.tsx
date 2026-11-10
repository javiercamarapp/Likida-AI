'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { Modal } from '../../ui-v2/componentes/overlay';
import { useSufijoYRol } from '../sidebar-nav';
import { filtrarPaleta, paletaDelDashboard, type DestinoPaleta } from './paleta-datos';

/**
 * ⌘K (Ctrl+K) del dashboard: salta a cualquier pantalla que el rol y el perfil abren. Solo teclado (la topbar v2 no lleva
 * buscador visible, ESTILO §4); el sufijo `?tenant/?vista/?rol` del superadmin viaja en cada destino, como en el menú.
 */
export default function PaletaDashboard({ rol, perfil }: { rol: string; perfil?: PerfilTenant | null }) {
  const [abierto, setAbierto] = useState(false);
  const { sufijo, rolMenu } = useSufijoYRol(rol);
  const lista = useMemo(() => paletaDelDashboard(rolMenu, perfil), [rolMenu, perfil]);

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAbierto((a) => !a);
      }
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  // El diálogo (y el router) solo existen mientras está abierto: cerrado no cuesta nada en cada pantalla.
  return abierto ? <DialogoPaleta lista={lista} sufijo={sufijo} alCerrar={() => setAbierto(false)} /> : null;
}

function DialogoPaleta({ lista, sufijo, alCerrar }: { lista: readonly DestinoPaleta[]; sufijo: string; alCerrar: () => void }) {
  const [consulta, setConsulta] = useState('');
  const [activo, setActivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const resultados = useMemo(() => filtrarPaleta(lista, consulta), [lista, consulta]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  function ir(href: string) {
    alCerrar();
    router.push(`${href}${sufijo}`);
  }

  return (
    <Modal abierto onCerrar={alCerrar} titulo="Buscar una pantalla" sinCabecera tamano="l" posicion="arriba">
      <div className="rv-paleta__campo">
        <Search width={16} height={16} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={inputRef}
          aria-label="Buscar una pantalla"
          aria-controls="paleta-dashboard-resultados"
          value={consulta}
          onChange={(e) => { setConsulta(e.target.value); setActivo(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(a + 1, resultados.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && resultados[activo]) { e.preventDefault(); ir(resultados[activo].href); }
          }}
          placeholder="Buscar una pantalla… (Viajes, Facturación, ARCO)"
        />
        <kbd>Esc</kbd>
      </div>
      <div id="paleta-dashboard-resultados" role="listbox" aria-label="Resultados" className="rv-paleta__lista">
        {resultados.length === 0 ? (
          <div className="rv-paleta__nota" data-centrada>Sin resultados.</div>
        ) : resultados.map((d, i) => (
          <button key={d.href} type="button" role="option" aria-selected={i === activo} className="rv-paleta__fila"
            onClick={() => ir(d.href)} onMouseEnter={() => setActivo(i)}>
            <d.Icono width={15} height={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="flex-1 min-w-0 truncate">{d.etiqueta}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
