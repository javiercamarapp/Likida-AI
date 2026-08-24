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
import { COLOR_EMBUDO, NOMBRE_GIRO, type ProspectoMapa, type TextosProspecto } from '@/lib/admin/prospectos-mapa';
import { hrefWa, hrefCorreo, esperandoTextos } from './mensajes';

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
          const c = COLOR_EMBUDO[p.estado]?.color ?? '#64748b';
          const marcador = L.circleMarker([p.lat!, p.lng!], {
            radius: 9, color: '#ffffff', weight: 2, fillColor: c, fillOpacity: 0.95,
          });
          // Los href de WhatsApp/correo salen de hrefWa/hrefCorreo (URLs que
          // NOSOTROS construimos y codificamos) — lo único del prospecto que
          // entra crudo al HTML pasa por `escapar`.
          const boton = (href: string, texto: string, fondo: string, tinta: string) =>
            `<a href="${href}" target="_blank" rel="noreferrer" style="display:inline-block;margin:2px 4px 0 0;padding:3px 8px;border-radius:8px;background:${fondo};color:${tinta};text-decoration:none;font-weight:600">${texto}</a>`;
          const apagado = (texto: string, fondo: string, tinta: string) =>
            `<span title="El mensaje del agente experto viene en camino" style="display:inline-block;margin:2px 4px 0 0;padding:3px 8px;border-radius:8px;background:${fondo};color:${tinta};font-weight:600;opacity:.5">${texto}</span>`;
          // El contenido se arma AL ABRIR (FE-16): las notas y el mensaje
          // redactado son textos largos que ya no viajan en el listado, y
          // armar dos mil popups por adelantado los pediría todos.
          const contenido = () => {
            const t = obtenerTextosRef.current(p.id);
            const espera = esperandoTextos(p, t);
            const wa = hrefWa(p, t);
            const correo = hrefCorreo(p, t);
            return `
            <div style="font: 13px/1.45 system-ui; min-width: 220px">
              <strong>${escapar(p.empresa)}</strong><br/>
              <span style="color:${c}">●</span> ${escapar(COLOR_EMBUDO[p.estado]?.nombre ?? p.estado)} · ${escapar(NOMBRE_GIRO[p.giro])}<br/>
              ${p.contacto ? `👤 ${escapar(p.contacto)}<br/>` : ''}
              ${p.telefono ? `📞 <a href="tel:${escapar(p.telefono)}">${escapar(p.telefono)}</a><br/>` : ''}
              ${p.correo ? `✉️ ${escapar(p.correo)}<br/>` : ''}
              Urgencia <strong>${p.urgencia}%</strong> · Cierre <strong>${p.cierre}%</strong>
              <div style="color:#64748b;margin-top:4px">${escapar(p.ciudad ?? '')}</div>
              ${t?.notas ? `<div style="color:#64748b;margin-top:4px;font-size:11px;max-width:260px">${escapar(t.notas)}</div>` : ''}
              <div style="margin-top:6px">
                ${wa && !espera ? boton(wa, 'WhatsApp →', '#14532d', '#86efac') : p.telefono ? apagado('WhatsApp …', '#14532d', '#86efac') : ''}
                ${correo && !espera ? boton(correo, 'Correo →', '#1e3a8a', '#bfdbfe') : p.correo ? apagado('Correo …', '#1e3a8a', '#bfdbfe') : ''}
                ${p.lat !== null ? boton(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`, 'Cómo llegar', '#1e293b', '#e2e8f0') : ''}
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
  }, [prospectos]);

  const conCoords = prospectos.filter((p) => p.lat !== null).length;

  return (
    <div className="absolute inset-0 z-30 flex flex-col rounded-3xl overflow-hidden" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center gap-3 px-4 py-2.5" style={{ background: 'var(--surface)', color: 'var(--ink)', borderBottom: '1px solid var(--line)' }}>
        <span className="text-sm font-medium">{titulo} — nivel calle</span>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {conCoords} de {prospectos.length} con dirección real (DENUE); al resto no se le inventa lugar
        </span>
        <button onClick={onCerrar} className="ml-auto px-3 py-1 rounded-lg text-xs font-medium"
          style={{ background: 'var(--canvas)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          ← Volver al país
        </button>
      </div>
      <div ref={ref} className="flex-1" />
    </div>
  );
}
