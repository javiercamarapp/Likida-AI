'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EL NIVEL CALLES del Cerebro — "un Google Maps de leads" (orden 17-ago).
//
// Leaflet + teselas de OpenStreetMap: calles reales HOY, sin llave y sin
// costo. Decisión declarada: el mapa del /dashboard se horneó sin tiles a
// propósito (funciona sin red); ESTA pantalla es la excepción consciente —
// el nivel calle no existe sin un proveedor de teselas. Si un día se quiere
// el look exacto de Google, se cambia el proveedor aquí (con su llave), no
// el resto del Cerebro. Solo pinta prospectos CON coordenadas reales de la
// DENUE (0128) — a los demás no se les inventa lugar.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { COLOR_EMBUDO, type ProspectoMapa, type TextosProspecto } from '@/lib/admin/prospectos-mapa-client';
import { Undo2 } from 'lucide-react';
import { Boton, Icono } from '../../ui-v2/componentes';
import { hrefWa, hrefCorreo, esperandoTextos } from './mensajes';
import './cerebro.css';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';
import { rico } from '@/lib/i18n/rico';
import { nombreEtapaTr, nombreGiroTr } from '@/lib/i18n/rotulos_tr';

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default function Calles({ prospectos, titulo, obtenerTextos, pedirTextos, onCerrar }: {
  prospectos: ProspectoMapa[];
  titulo: string;
  /** Los textos largos que ya están en el cache del Cerebro (FE-16). */
  obtenerTextos: (id: string) => TextosProspecto | undefined;
  /** Pide los que falten. Se llama al ABRIR un popup, no al pintar el mapa:
   *  un estado grande son dos mil marcadores y ninguno se está mirando. */
  pedirTextos: (ids: string[]) => Promise<void>;
  onCerrar: () => void;
}) {
  const { t: tx } = useT('admin_sistema', admin_sistemaEs);
  const ref = useRef<HTMLDivElement>(null);
  const obtenerTextosRef = useRef(obtenerTextos);
  const pedirTextosRef = useRef(pedirTextos);
  useEffect(() => { obtenerTextosRef.current = obtenerTextos; }, [obtenerTextos]);
  useEffect(() => { pedirTextosRef.current = pedirTextos; }, [pedirTextos]);

  useEffect(() => {
    let vivo = true;
    let mapa: import('leaflet').Map | null = null;
    (async () => {
      const L = (await import('leaflet')).default;
      // El plugin se cuelga de L al importarse — el orden importa.
      await import('leaflet.markercluster');
      if (!vivo || !ref.current) return;
      const conCoords = prospectos.filter((p) => p.lat !== null && p.lng !== null);
      mapa = L.map(ref.current, { zoomControl: true, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(mapa);
      if (conCoords.length) {
        // CLUSTERING (del análisis del 17-ago — Prospect Hub): a nivel ciudad
        // cien pines encimados mienten; el racimo dice cuántos hay y se abre
        // al acercarse. spiderfy separa los que comparten dirección exacta.
        const racimos = L.markerClusterGroup({
          maxClusterRadius: 44,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
        });
        const grupo = L.featureGroup(conCoords.map((p) => {
          // El color de la etapa lo pone cerebro.css por clase (`cer-e-<etapa>` → --etapa): aquí no hay un solo hex.
          const etapa = p.estado in COLOR_EMBUDO ? p.estado : 'nuevo';
          const marcador = L.circleMarker([p.lat!, p.lng!], { radius: 9, className: `cer-pin-calle cer-e-${etapa}` });
          // Los href de WhatsApp/correo salen de hrefWa/hrefCorreo (URLs que NOSOTROS construimos y codificamos): lo único del prospecto
          // que entra crudo al HTML pasa por `escapar`. Los popups son texto plano: sin emojis ni estilos en línea.
          const boton = (href: string, texto: string) =>
            `<a href="${escapar(href)}" target="_blank" rel="noreferrer">${texto}</a>`;
          const apagado = (texto: string) =>
            tx('mapa_prospectos_calles.span_title_el_mensaje_del_agente', { texto });
          // El contenido se arma AL ABRIR (FE-16): las notas y el mensaje redactado son textos largos que ya no viajan en el listado, y
          // armar dos mil popups por adelantado los pediría todos.
          const contenido = () => {
            const t = obtenerTextosRef.current(p.id);
            const espera = esperandoTextos(p, t);
            const wa = hrefWa(p, t);
            const correo = hrefCorreo(p, t);
            return `
            <div class="cer-pop cer-e-${etapa}">
              <strong>${escapar(p.empresa)}</strong>
              <span class="cer-pop__linea"><i class="cer-punto" aria-hidden="true"></i> ${escapar(COLOR_EMBUDO[p.estado] ? nombreEtapaTr(p.estado, tx) : p.estado)} · ${escapar(nombreGiroTr(p.giro, tx))}</span>
              ${p.contacto ? `<span class="cer-pop__linea">${escapar(tx('mapa_prospectos_calles.contacto', { v: p.contacto }))}</span>` : ''}
              ${p.telefono ? tx('mapa_prospectos_calles.span_class_cer_pop_linea_telefono', { escapar: escapar(p.telefono), escapar2: escapar(p.telefono) }) : ''}
              ${p.correo ? `<span class="cer-pop__linea">${escapar(tx('mapa_prospectos_calles.correo', { v: p.correo }))}</span>` : ''}
              <span class="cer-pop__linea">${tx('mapa_prospectos_calles.urgencia_cierre', { urgencia: p.urgencia, cierre: p.cierre })}</span>
              <span class="cer-pop__tenue">${escapar(p.ciudad ?? '')}</span>
              ${t?.notas ? `<span class="cer-pop__tenue">${escapar(t.notas)}</span>` : ''}
              <div class="cer-pop__acciones">
                ${wa && !espera ? boton(wa, tx('mapa_prospectos_calles.whatsapp_flecha')) : p.telefono ? apagado(tx('mapa_prospectos_calles.whatsapp_espera')) : ''}
                ${correo && !espera ? boton(correo, tx('mapa_prospectos_calles.correo_flecha')) : p.correo ? apagado(tx('mapa_prospectos_calles.correo_espera')) : ''}
                ${p.lat !== null ? boton(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`, tx('mapa_prospectos_calles.como_llegar')) : ''}
              </div>
            </div>`;
          };
          marcador.bindPopup(contenido);
          marcador.on('popupopen', () => {
            if (obtenerTextosRef.current(p.id)) return;
            void pedirTextosRef.current([p.id]).then(() => {
              if (vivo && marcador.isPopupOpen()) marcador.setPopupContent(contenido());
            });
          });
          return marcador;
        }));
        racimos.addLayer(grupo);
        mapa.addLayer(racimos);
        mapa.fitBounds(grupo.getBounds().pad(0.25), { maxZoom: 14 });
      } else {
        mapa.setView([23.6, -102.5], 5);
      }
    })();
    return () => { vivo = false; mapa?.remove(); };
  }, [prospectos, tx]);

  const conCoords = prospectos.filter((p) => p.lat !== null).length;

  return (
    <div className="cer-calles">
      <div className="cer-calles__cab">{rico(tx('mapa_prospectos_calles.strong_nivel_calle_strong_e1_de', { titulo, conCoords, length: prospectos.length }), { strong: (c) => <strong>{c}</strong>, e1: (c) => <span>{c}</span> })}<Boton tamano="sm" onClick={onCerrar} icono={<Icono icono={Undo2} tam={14} />}>
          {tx('mapa_prospectos_calles.volver_al_pais')}</Boton>
      </div>
      <div ref={ref} className="cer-calles__mapa" />
    </div>
  );
}
