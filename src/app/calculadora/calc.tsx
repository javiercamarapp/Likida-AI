'use client';

// ═══════════════════════════════════════════════════════════════════════════
// LA CALCULADORA — el formulario y el resultado, en el navegador.
//
// El motor (`marketing/calculadora.ts`) es puro y corre aquí: el visitante ve
// su resultado SIN mandar nada a ningún servidor. Solo si pide su copia se
// captura el contacto (POST /api/marketing/prospecto, con honeypot).
//
// Los seis candados de honestidad del blueprint viven en el motor; esta capa
// solo pinta lo que el motor entrega — cifra y supuesto SIEMPRE juntos.
// ═══════════════════════════════════════════════════════════════════════════
import { useState } from 'react';
import Link from 'next/link';
import {
  calcularEstimacion, PRECIO_DIESEL_REFERENCIA, type ResultadoCalculadora,
} from '@/lib/likida/marketing/calculadora';
import { mxn as mxnFmt, numero as numeroFmt, hoyMx } from '@/lib/formato';
import { Boton } from '../ui-v2/componentes/boton';
import { Aviso } from '../ui-v2/componentes/aviso';
import { CampoTexto } from '../ui-v2/componentes/campos';
import { Tarjeta } from '../ui-v2/componentes/tarjeta';
import { KindBadge } from '../ui-v2/graficas/kind-badge';
// El marco público no carga las piezas del panel: sin esto `.rv-campo` (rótulo sobre campo, ayuda debajo) y el sello de dato no tienen estilo.
import '../ui-v2/piezas.css';
import '../ui-v2/graficas.css';
import './calculadora.css';
import { atribucionDeUrl } from '@/lib/marketing/atribucion';
import { useIdioma, useT } from '@/lib/i18n/proveedor';
import { rico } from '@/lib/i18n/rico';
import { publico } from '@/lib/i18n/es/publico';

const num = (s: string): number | null => {
  const n = Number(s.replace(/[,$\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function Calculadora() {
  const { t } = useT('publico', publico);
  const idioma = useIdioma();
  const mxn = (n: number) => mxnFmt(n, idioma);
  const litrosFmt = (n: number) => numeroFmt(n, idioma);
  const [litros, setLitros] = useState('');
  const [gastoDiesel, setGastoDiesel] = useState('');
  const [precioLitro, setPrecioLitro] = useState(String(PRECIO_DIESEL_REFERENCIA.toFixed(2)));
  const [casetas, setCasetas] = useState('');
  const [unidades, setUnidades] = useState('');
  const [r, setR] = useState<ResultadoCalculadora | null>(null);

  // El contacto — solo después del resultado.
  const [nombre, setNombre] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [correo, setCorreo] = useState('');
  const [telefono, setTelefono] = useState('');
  const [sitioWeb, setSitioWeb] = useState('');   // honeypot: un humano no lo ve
  const [envio, setEnvio] = useState<'nada' | 'mandando' | 'listo' | 'error'>('nada');
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const calcular = () => {
    setR(calcularEstimacion({
      litrosDieselMes: num(litros),
      gastoDieselMesMxn: num(gastoDiesel),
      precioLitro: num(precioLitro),
      gastoCasetasMesMxn: num(casetas),
      unidades: num(unidades),
      hoy: hoyMx(),
    }));
  };

  const pedirCopia = async () => {
    setEnvio('mandando');
    setErrorEnvio(null);
    try {
      const res = await fetch('/api/marketing/prospecto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre, empresa, correo, telefono, sitioWeb,
          atribucion: atribucionDeUrl(window.location.search, document.referrer, window.location.pathname),
          cifras: {
            litrosDieselMes: num(litros), gastoDieselMesMxn: num(gastoDiesel),
            gastoCasetasMesMxn: num(casetas), unidades: num(unidades),
          },
        }),
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorEnvio(typeof cuerpo.error === 'string' ? cuerpo.error : t('cal.contacto.error'));
        setEnvio('error');
        return;
      }
      setEnvio('listo');
    } catch {
      setErrorEnvio(t('cal.contacto.error'));
      setEnvio('error');
    }
  };

  return (
    <div className="rv-calc">
      {/* ── Los tres datos ── */}
      <Tarjeta titulo={t('cal.datos.titulo')} className="rv-calc__datos-tarjeta">
      <section className="rv-calc__datos">
        <CampoTexto etiqueta={t('cal.litros')} inputMode="decimal" value={litros}
          onChange={(e) => setLitros(e.target.value)} placeholder={t('cal.litros.ph')} ayuda={t('cal.litros.alt')} />
        <div className="rv-calc__dos">
          <CampoTexto etiqueta={t('cal.gasto')} inputMode="decimal" value={gastoDiesel}
            onChange={(e) => setGastoDiesel(e.target.value)} placeholder={t('cal.gasto.ph')} />
          <CampoTexto etiqueta={t('cal.precio')} inputMode="decimal" value={precioLitro}
            onChange={(e) => setPrecioLitro(e.target.value)} ayuda={t('cal.precio.nota')} />
        </div>
        <CampoTexto etiqueta={t('cal.casetas')} inputMode="decimal" value={casetas}
          onChange={(e) => setCasetas(e.target.value)} placeholder={t('cal.casetas.ph')} />
        <CampoTexto etiqueta={t('cal.unidades')} inputMode="numeric" value={unidades}
          onChange={(e) => setUnidades(e.target.value)} placeholder={t('cal.unidades.ph')} />
        <div>
          <Boton variante="primary" onClick={calcular}>{t('cal.calcular')}</Boton>
        </div>
      </section>
      </Tarjeta>

      {/* ── El resultado — antes de pedir nada ── */}
      {r && (
        <section className="rv-calc__resultado">
          {/* Diésel */}
          <Tarjeta titulo={t('cal.dsl.titulo')} acciones={'faltante' in r.diesel ? undefined : <KindBadge tipo="estimado" />}>
            {'faltante' in r.diesel ? (
              <p className="rv-calc__texto">{r.diesel.faltante}</p>
            ) : (
              <div className="rv-calc__pila">
                <p className="rv-calc__cifra">{t('cal.dsl.mes', { litros: litrosFmt(r.diesel.litrosMes) })}</p>
                <p className="rv-calc__texto">{t('cal.dsl.anio', { litros: litrosFmt(r.diesel.litrosAnio) })}</p>
                {r.diesel.estimacionMesMxn !== null ? (
                  <p className="rv-calc__texto">
                    {rico(t('cal.dsl.cuota', { pesos: r.diesel.cuota.pesosPorLitro, fecha: r.diesel.cuota.registradaEl }), {
                      strong: (c) => <strong>{c}</strong>,
                      enlace: (c) => <a href={(r.diesel as Extract<typeof r.diesel, { cuota: unknown }>).cuota.fuenteUrl} target="_blank" rel="noopener noreferrer">{c}</a>,
                    })}
                    <br />{rico(t('cal.dsl.estimacion', { monto: mxn(r.diesel.estimacionMesMxn) }), { strong: (c) => <strong>{c}</strong> })}
                  </p>
                ) : (
                  <p className="rv-calc__texto">{t('cal.dsl.vencida')}</p>
                )}
              </div>
            )}
          </Tarjeta>

          {/* Peaje */}
          <Tarjeta titulo={t('cal.peaje.titulo')} acciones={'faltante' in r.peaje ? undefined : <KindBadge tipo="estimado" />}>
            {'faltante' in r.peaje ? (
              <p className="rv-calc__texto">{r.peaje.faltante}</p>
            ) : (
              <div className="rv-calc__pila">
                <p className="rv-calc__cifra">{t('cal.peaje.cifra', { mes: mxn(r.peaje.estimuloMesMxn), anio: mxn(r.peaje.estimuloAnioMxn) })}</p>
                <p className="rv-calc__texto">{t('cal.peaje.subtotal', { subtotal: mxn(r.peaje.subtotalEstimadoMes) })}</p>
                <ul className="rv-calc__lista">
                  {r.peaje.condiciones.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
          </Tarjeta>

          {/* Total + advertencias */}
          <Tarjeta titulo={t('cal.total.titulo')} acciones={r.totalAnualMxn !== null ? <KindBadge tipo="estimado" /> : <KindBadge tipo="sin_dato" />}>
            <div className="rv-calc__pila">
              <p className="rv-calc__cifra rv-calc__cifra--total">
                {r.totalAnualMxn !== null ? mxn(r.totalAnualMxn) : t('cal.total.sin_datos')}
              </p>
              <p className="rv-calc__texto">{r.notaDelTotal}</p>
              {r.supuestos.length > 0 && (
                <>
                  <p className="rv-calc__rotulo">{t('cal.supuestos')}</p>
                  <ul className="rv-calc__lista">
                    {r.supuestos.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </>
              )}
              <p className="rv-calc__rotulo">{t('cal.advertencias')}</p>
              <ul className="rv-calc__lista">
                {r.advertencias.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          </Tarjeta>

          {/* ── El contacto — después del resultado, nunca antes ── */}
          {envio === 'listo' ? (
            <Aviso tono="ok">{t('cal.contacto.listo')}</Aviso>
          ) : (
            <Tarjeta titulo={t('cal.contacto.pregunta')}>
              <div className="rv-calc__pila">
                <p className="rv-calc__texto">
                  {rico(t('cal.contacto.nota'), { enlace: (c) => <Link href="/aviso/prospectos">{c}</Link> })}
                </p>
                <div className="rv-calc__dos">
                  <CampoTexto etiqueta={t('cal.contacto.nombre')} etiquetaOculta placeholder={t('cal.contacto.nombre')} value={nombre} onChange={(e) => setNombre(e.target.value)} />
                  <CampoTexto etiqueta={t('cal.contacto.empresa')} etiquetaOculta placeholder={t('cal.contacto.empresa')} value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
                  <CampoTexto etiqueta={t('cal.contacto.correo')} etiquetaOculta placeholder={t('cal.contacto.correo')} inputMode="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
                  <CampoTexto etiqueta={t('cal.contacto.whatsapp')} etiquetaOculta placeholder={t('cal.contacto.whatsapp')} inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
                </div>
                {/* Honeypot: fuera de la vista; un humano jamás lo llena. */}
                <input
                  className="rv-calc__trampa" tabIndex={-1} autoComplete="off"
                  aria-hidden="true" value={sitioWeb} onChange={(e) => setSitioWeb(e.target.value)} placeholder={t('cal.contacto.honeypot')}
                />
                {errorEnvio && <Aviso tono="warn">{errorEnvio}</Aviso>}
                <div>
                  <Boton variante="primary" onClick={pedirCopia} loading={envio === 'mandando'}>
                    {envio === 'mandando' ? t('cal.contacto.mandando') : t('cal.contacto.boton')}
                  </Boton>
                </div>
              </div>
            </Tarjeta>
          )}
        </section>
      )}
    </div>
  );
}
