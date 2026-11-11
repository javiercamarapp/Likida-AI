'use client';

// ═══════════════════════════════════════════════════════════════════════════
// LA FICHA DE UN PROSPECTO: todo lo que el Cerebro resume en una tarjeta, aquí desglosado: decisor(es) con su fuente y confianza (0138),
// flota/historia (0140, NULL declarado si no se encontró; nunca se infiere), los tres % (urgencia/cierre/completitud del mapa + similitud
// ICP/necesidad de la 0140, que son columnas GENERADAS: se leen, no se recalculan aquí), y los mensajes con sus botones de envío reales.
// Fase 6: misma piel del sistema que el Cerebro (MarcoPagina, Tarjeta, StatusChip, cerebro.css); sin emojis, hex ni `style=`.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Link2, Mail, MessageCircle, Phone, RefreshCw, Sparkles, Undo2 } from 'lucide-react';
import type { DetalleProspecto } from '@/lib/admin/prospectos-mapa-client';
import { COLOR_EMBUDO, NOMBRE_GIRO, esProspectoTerminal } from '@/lib/admin/prospectos-mapa-client';
import { leerRespuestaMensaje } from '../respuesta_mensaje';
import { hrefWa, hrefCorreo, mensajeWa, correoProspecto } from '../mensajes';
import { fechaHoraMx, numero } from '@/lib/formato';
import { Boton, BotonEnlace, Chip, FilaTarjetas, Icono, MarcoPagina, StatusChip, Tarjeta, clasesBoton } from '../../../ui-v2/componentes';
import { BarraPct } from '../cerebro';
import '../cerebro.css';

const CONFIANZA_TONO = { alta: 'ok', media: 'warn', baja: 'neutral' } as const;
const CONFIANZA_LABEL: Record<string, string> = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja' };
const ORIGEN_LABEL: Record<string, string> = {
  sitio_empresa: 'Sitio oficial', linkedin: 'LinkedIn', directorio: 'Directorio corporativo',
  denue: 'DENUE', prensa: 'Prensa', inferido: 'Inferido (sin verificar)', otro: 'Otra fuente',
};

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  const vacio = children === null || children === undefined || children === '';
  return (
    <div className="cer-dato">
      <dt>{etiqueta}</dt>
      <dd data-vacio={vacio || undefined}>{vacio ? 'no disponible' : children}</dd>
    </div>
  );
}

export function Detalle({ p }: { p: DetalleProspecto }) {
  const c = COLOR_EMBUDO[p.estado] ?? COLOR_EMBUDO.nuevo;
  const [afinando, setAfinando] = useState(false);
  const [datos, setDatos] = useState(p);
  const [avisoIa, setAvisoIa] = useState<{ texto: string; error: boolean } | null>(null);

  const tocar = (canal: 'whatsapp' | 'correo') => {
    void fetch('/api/admin/mapa-prospectos/toque', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, canal }),
    }).catch(() => undefined);
  };

  const afinar = async () => {
    setAfinando(true);
    setAvisoIa(null);
    try {
      const r = await fetch('/api/admin/mapa-prospectos/mensaje', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      }).then(leerRespuestaMensaje, () => ({ ok: false as const, error: 'No se pudo contactar al servidor. Revisa tu conexión.' }));
      if (!r.ok) { setAvisoIa({ texto: r.error, error: true }); return; }
      if (r.aviso) setAvisoIa({ texto: r.aviso, error: false });
      setDatos((d) => ({ ...d, ...r.datos }));
    } finally {
      setAfinando(false);
    }
  };

  // La ficha SÍ trae los textos largos, así que se pasan explícitos (FE-16: sin ellos los href caerían a la plantilla determinista).
  const linkWa = hrefWa(datos, datos);
  const linkCorreo = hrefCorreo(datos, datos);
  const textoWa = datos.mensajeWaIa ?? mensajeWa(datos);
  const asuntoCorreo = datos.correoAsuntoIa ?? correoProspecto(datos).asunto;
  const cuerpoCorreo = datos.correoCuerpoIa ?? correoProspecto(datos).cuerpo;
  const etapa = p.estado in COLOR_EMBUDO ? p.estado : 'nuevo';
  const resumen = [NOMBRE_GIRO[p.giro], p.ciudad ? `${p.ciudad}${p.entidad ? `, ${p.entidad}` : ''}` : null, p.tamano ? `${p.tamano} personas (DENUE)` : null]
    .filter(Boolean).join(' · ');

  return (
    <MarcoPagina area="Ventas" titulo={p.empresa} apoyo={p.vacante ? `Vacante publicada: «${p.vacante}»` : resumen}
      acciones={<BotonEnlace href="/admin/mapa-prospectos" icono={<Icono icono={Undo2} />}>Volver al Cerebro de ventas</BotonEnlace>}>
      <div className="cer-ficha__etapa">
        <i className="cer-punto" data-etapa={etapa} aria-hidden="true" />
        <Chip>{c.nombre}</Chip>
        {p.vacante && resumen ? <span className="cer-prospecto__tenue">{resumen}</span> : null}
      </div>

      {/* ── Los cinco porcentajes ──────────────────────────────────────── */}
      <FilaTarjetas variante="6-6">
        <Tarjeta titulo="Del mapa (Cerebro)">
          <BarraPct etiqueta="Urgencia" pct={p.urgencia} serie="urgencia" />
          <BarraPct etiqueta="Cierre" pct={p.cierre} serie="cierre" />
          <BarraPct etiqueta="Datos" pct={p.completitud} serie="datos" />
        </Tarjeta>
        <Tarjeta titulo="De investigación, calculadas">
          <BarraPct etiqueta="ICP" pct={p.similitudIcpPct} serie="icp" />
          <p className="cer-prospecto__tenue">Similitud con el ICP: giro correcto +40 · vacante publicada +25 · flota ≥10 +20 · sitio verificado +15</p>
          <BarraPct etiqueta="Necesid." pct={p.necesidadPct} serie="necesidad" />
          <p className="cer-prospecto__tenue">Necesidad: vacante de liquidación/cuadre +50 (otra vacante +25) · flota ≥20 +25. Nadie las escribe a mano.</p>
        </Tarjeta>
      </FilaTarjetas>

      {/* ── Decisores ──────────────────────────────────────────────────── */}
      <Tarjeta titulo={p.personas.length > 0 ? `Decisor${p.personas.length > 1 ? 'es' : ''} investigado${p.personas.length > 1 ? 's' : ''}` : 'Decisor'}
        estado={p.personas.length === 0 && !p.contacto ? 'vacio' : 'ok'} mensaje="Sin decisor confirmado" detalle="Ningún agente ha encontrado un decisor público de esta empresa todavía.">
        {p.personas.length === 0 && p.contacto && <p className="cer-prospecto__contacto">{p.contacto}</p>}
        {p.personas.length > 0 && (
          <div className="cer-personas">
            {p.personas.map((per) => (
              <div key={per.id} className="cer-persona">
                <div className="cer-persona__cab">
                  <strong>{per.nombre}</strong>
                  <StatusChip tono={CONFIANZA_TONO[per.confianza]}>{CONFIANZA_LABEL[per.confianza]}</StatusChip>
                </div>
                {per.puesto && <p>{per.puesto}</p>}
                {per.telefono && <a href={`tel:${per.telefono}`}><Icono icono={Phone} tam={14} />{per.telefono}</a>}
                {per.correo && <a href={`mailto:${per.correo}`}><Icono icono={Mail} tam={14} />{per.correo}</a>}
                {per.linkedin && <a href={per.linkedin} target="_blank" rel="noreferrer"><Icono icono={Link2} tam={14} />LinkedIn</a>}
                <p className="cer-prospecto__tenue">{ORIGEN_LABEL[per.origen] ?? per.origen}{per.evidencia ? `: ${per.evidencia}` : ''}</p>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      {/* ── La ficha ───────────────────────────────────────────────────── */}
      <Tarjeta titulo="Ficha">
        <dl className="cer-ficha__datos">
          <Dato etiqueta="Teléfono">{p.telefono ? <a href={`tel:${p.telefono}`}>{p.telefono}</a> : null}</Dato>
          <Dato etiqueta="Correo">{p.correo ? <a href={`mailto:${p.correo}`}>{p.correo}</a> : null}</Dato>
          <Dato etiqueta="Sitio">
            {p.sitio ? (
              <span>
                <a href={p.sitio.startsWith('http') ? p.sitio : `https://${p.sitio}`} target="_blank" rel="noreferrer">{p.sitio}</a>{' '}
                <StatusChip tono={p.sitioVerificado ? 'ok' : 'neutral'}>{p.sitioVerificado ? 'verificado' : 'sin verificar'}</StatusChip>
              </span>
            ) : null}
          </Dato>
          <Dato etiqueta="Flota">{p.numUnidades !== null ? `${numero(p.numUnidades)} unidades` : null}</Dato>
          <Dato etiqueta="Viajes/mes (estimado)">{p.viajesMesEstimado !== null ? `≈ ${numero(p.viajesMesEstimado)}` : null}</Dato>
          <Dato etiqueta="Fuente">{p.fuenteCruda}</Dato>
          <Dato etiqueta="Registrado">{fechaHoraMx(p.creadoEn)}</Dato>
          <Dato etiqueta="Último toque">{p.ultimoToque ? fechaHoraMx(p.ultimoToque) : null}</Dato>
        </dl>
        {p.viajesMesEstimado !== null && (
          <p className="cer-prospecto__tenue">
            Estimado, no medido: {numero(p.numUnidades ?? 0)} unidades × 18 viajes/unidad/mes (supuesto de sector).
          </p>
        )}
      </Tarjeta>

      {p.historia && (
        <Tarjeta titulo="Historia"><p className="cer-mensaje__texto">{p.historia}</p></Tarjeta>
      )}

      {p.notas && (
        <Tarjeta titulo="Notas de investigación"><pre className="cer-notas">{p.notas}</pre></Tarjeta>
      )}

      {/* ── Mensajes ───────────────────────────────────────────────────── */}
      <Tarjeta titulo="Mensajes"
        acciones={!esProspectoTerminal(p.estado) ? (
          <Boton tamano="sm" onClick={() => void afinar()} disabled={afinando} icono={<Icono icono={datos.mensajesGeneradosEn ? RefreshCw : Sparkles} />}>
            {afinando ? 'Redactando…' : datos.mensajesGeneradosEn ? 'Redactar de nuevo con IA' : 'Redactar con IA'}
          </Boton>
        ) : undefined}>
        {avisoIa && (
          <p role="alert" className={avisoIa.error ? 'cer-prospecto__error' : 'cer-prospecto__aviso'}>{avisoIa.texto}</p>
        )}
        {datos.mensajesGeneradosEn && (
          <p className="cer-prospecto__tenue">Última redacción del agente experto: {fechaHoraMx(datos.mensajesGeneradosEn)}</p>
        )}
        <div className="cer-mensajes">
          <div className="cer-mensaje">
            <p className="cer-mensaje__asunto"><strong>WhatsApp</strong>{p.telefono ? ` · ${p.telefono}` : ''}</p>
            <p className="cer-mensaje__texto">{textoWa}</p>
            {linkWa
              ? <a href={linkWa} target="_blank" rel="noreferrer" onClick={() => tocar('whatsapp')} className={clasesBoton('primary')}><Icono icono={MessageCircle} />Enviar WhatsApp</a>
              : <p className="cer-prospecto__tenue">Sin teléfono: no se puede mandar.</p>}
          </div>
          <div className="cer-mensaje">
            <p className="cer-mensaje__asunto"><strong>Correo</strong>{p.correo ? ` · ${p.correo}` : ''}</p>
            <p className="cer-mensaje__asunto"><strong>Asunto:</strong> {asuntoCorreo}</p>
            <p className="cer-mensaje__texto">{cuerpoCorreo}</p>
            {linkCorreo
              ? <a href={linkCorreo} onClick={() => tocar('correo')} className={clasesBoton('primary')}><Icono icono={Mail} />Enviar correo</a>
              : <p className="cer-prospecto__tenue">Sin correo: no se puede mandar.</p>}
          </div>
        </div>
        <p className="cer-prospecto__tenue">Nada se manda solo: los botones abren tu WhatsApp o correo con el texto cargado y tú decides.</p>
      </Tarjeta>
    </MarcoPagina>
  );
}
