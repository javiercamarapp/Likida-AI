'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';
import { Modal } from '../../ui-v2/componentes/overlay';
import { useSufijoYRol } from '../sidebar-nav';
import { EVENTO_ABRIR_BUSCADOR } from './boton-buscar';
import { filtrarPaleta, paletaDelDashboard, type DestinoPaleta } from './paleta-datos';

const LLAVE_RECIENTES = 'likida-paleta-recientes';
const MAX_RECIENTES = 5;

function leerRecientes(): string[] {
  try {
    const crudo = window.localStorage.getItem(LLAVE_RECIENTES);
    const lista: unknown = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECIENTES) : [];
  } catch { return []; }
}

function guardarReciente(href: string): void {
  try {
    const nueva = [href, ...leerRecientes().filter((h) => h !== href)].slice(0, MAX_RECIENTES);
    window.localStorage.setItem(LLAVE_RECIENTES, JSON.stringify(nueva));
  } catch { /* sin almacenamiento: no se recuerda */ }
}

/**
 * ⌘K (Ctrl+K) del dashboard: salta a cualquier pantalla que el rol y el perfil abren. Se abre con el teclado, con el botón visible de
 * la cabecera (`BotonBuscar`, que avisa por evento) o con el mismo evento desde cualquier otro lugar; el sufijo
 * `?tenant/?vista/?rol` del superadmin viaja en cada destino, como en el menú.
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
    const alAbrir = () => setAbierto(true);
    window.addEventListener('keydown', alTeclear);
    window.addEventListener(EVENTO_ABRIR_BUSCADOR, alAbrir);
    return () => {
      window.removeEventListener('keydown', alTeclear);
      window.removeEventListener(EVENTO_ABRIR_BUSCADOR, alAbrir);
    };
  }, []);

  // El diálogo (y el router) solo existen mientras está abierto: cerrado no cuesta nada en cada pantalla.
  return abierto ? <DialogoPaleta lista={lista} sufijo={sufijo} alCerrar={() => setAbierto(false)} /> : null;
}

function DialogoPaleta({ lista, sufijo, alCerrar }: { lista: readonly DestinoPaleta[]; sufijo: string; alCerrar: () => void }) {
  const { t } = useT('shell', shellEs);
  const [consulta, setConsulta] = useState('');
  const [activo, setActivo] = useState(0);
  const [recientes] = useState<string[]>(leerRecientes);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const base = useId();
  const idLista = `${base}-resultados`;
  const idSub = `${base}-sub`;
  const resultados = useMemo(() => filtrarPaleta(lista, consulta), [lista, consulta]);
  // Sin consulta, lo último que se abrió va primero (solo pantallas que este rol abre HOY: una reciente que ya no existe se descarta).
  const dePrimeras = useMemo(
    () => (consulta.trim() ? [] : recientes.map((h) => resultados.find((d) => d.href === h)).filter((d): d is DestinoPaleta => Boolean(d))),
    [consulta, recientes, resultados],
  );
  const filas = useMemo(
    () => (dePrimeras.length > 0 ? [...dePrimeras, ...resultados.filter((d) => !dePrimeras.includes(d))] : resultados),
    [dePrimeras, resultados],
  );
  const idOpcion = (i: number) => `${base}-op-${i}`;

  useEffect(() => {
    const tmr = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(tmr);
  }, []);

  // La fila activa se mantiene a la vista cuando la lista scrollea con las flechas.
  useEffect(() => {
    document.getElementById(`${base}-op-${activo}`)?.scrollIntoView({ block: 'nearest' });
  }, [activo, base]);

  function ir(href: string) {
    guardarReciente(href);
    alCerrar();
    router.push(`${href}${sufijo}`);
  }

  return (
    <Modal abierto onCerrar={alCerrar} titulo={t('paleta.titulo')} sinCabecera tamano="l" posicion="arriba">
      <div className="rv-paleta__cab">
        <p className="rv-paleta__titulo">{t('paleta.titulo')}</p>
        <p id={idSub} className="rv-paleta__sub">{t('paleta.subtitulo')}</p>
      </div>
      <div className="rv-paleta__campo">
        <Search width={16} height={16} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-label={t('paleta.titulo')}
          aria-describedby={idSub}
          aria-controls={idLista}
          aria-activedescendant={filas[activo] ? idOpcion(activo) : undefined}
          value={consulta}
          onChange={(e) => { setConsulta(e.target.value); setActivo(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(a + 1, filas.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && filas[activo]) { e.preventDefault(); ir(filas[activo].href); }
          }}
          placeholder={t('paleta.placeholder')}
        />
        <kbd>Esc</kbd>
      </div>
      <div id={idLista} role="listbox" aria-label={t('paleta.resultados')} className="rv-paleta__lista">
        {filas.length === 0 ? (
          <div className="rv-paleta__nota" data-centrada>{t('paleta.sinResultados')}</div>
        ) : filas.map((d, i) => (
          <div key={d.href} role="presentation">
            {dePrimeras.length > 0 && (i === 0 || i === dePrimeras.length) && (
              <p className="rv-paleta__grupo" aria-hidden>{i === 0 ? t('paleta.recientes') : t('paleta.todas')}</p>
            )}
            <button id={idOpcion(i)} type="button" role="option" aria-selected={i === activo} tabIndex={-1} className="rv-paleta__fila"
              onClick={() => ir(d.href)} onMouseEnter={() => setActivo(i)}>
              <d.Icono width={15} height={15} strokeWidth={1.75} aria-hidden="true" />
              <span className="flex-1 min-w-0 truncate">{d.etiqueta}</span>
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
