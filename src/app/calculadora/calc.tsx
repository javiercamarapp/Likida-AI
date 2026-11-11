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

  const campo = 'rv-pub__campo mt-1';

  return (
    <div>
      {/* ── Los tres datos ── */}
      <section className="mt-8 grid gap-4">
        <div>
          <label className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{t('cal.litros')}</label>
          <input className={campo} inputMode="decimal" value={litros}
            onChange={(e) => setLitros(e.target.value)} placeholder={t('cal.litros.ph')} />
          <p className="mt-1 text-xs">{t('cal.litros.alt')}</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs">{t('cal.gasto')}</label>
              <input className={campo} inputMode="decimal" value={gastoDiesel}
                onChange={(e) => setGastoDiesel(e.target.value)} placeholder={t('cal.gasto.ph')} />
            </div>
            <div>
              <label className="text-xs">{t('cal.precio')}</label>
              <input className={campo} inputMode="decimal" value={precioLitro}
                onChange={(e) => setPrecioLitro(e.target.value)} />
              <p className="mt-1 text-xs">{t('cal.precio.nota')}</p>
            </div>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{t('cal.casetas')}</label>
          <input className={campo} inputMode="decimal" value={casetas}
            onChange={(e) => setCasetas(e.target.value)} placeholder={t('cal.casetas.ph')} />
        </div>
        <div>
          <label className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{t('cal.unidades')}</label>
          <input className={campo} inputMode="numeric" value={unidades}
            onChange={(e) => setUnidades(e.target.value)} placeholder={t('cal.unidades.ph')} />
        </div>
        <Boton variante="primary" onClick={calcular} className="mt-2 w-fit">
          {t('cal.calcular')}
        </Boton>
      </section>

      {/* ── El resultado — antes de pedir nada ── */}
      {r && (
        <section className="mt-10 space-y-6">
          {/* Diésel */}
          <div className="rounded-md px-4 py-4" style={{ border: '1px solid var(--line)' }}>
            <p className="text-xs font-medium uppercase tracking-wider">{t('cal.dsl.titulo')}</p>
            {'faltante' in r.diesel ? (
              <p className="mt-2 text-sm">{r.diesel.faltante}</p>
            ) : (
              <>
                <p className="mt-2 text-xl font-semibold" style={{ color: 'var(--ink)' }}>
                  {t('cal.dsl.mes', { litros: litrosFmt(r.diesel.litrosMes) })}
                </p>
                <p className="text-sm">{t('cal.dsl.anio', { litros: litrosFmt(r.diesel.litrosAnio) })}</p>
                {r.diesel.estimacionMesMxn !== null ? (
                  <p className="mt-3 text-sm">
                    {rico(t('cal.dsl.cuota', { pesos: r.diesel.cuota.pesosPorLitro, fecha: r.diesel.cuota.registradaEl }), {
                      strong: (c) => <strong style={{ color: 'var(--ink)' }}>{c}</strong>,
                      enlace: (c) => <a href={r.diesel.cuota.fuenteUrl} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">{c}</a>,
                    })}
                    <br />{rico(t('cal.dsl.estimacion', { monto: mxn(r.diesel.estimacionMesMxn) }), { strong: (c) => <strong style={{ color: 'var(--ink)' }}>{c}</strong> })}
                  </p>
                ) : (
                  <p className="mt-3 text-sm">
                    {t('cal.dsl.vencida')}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Peaje */}
          <div className="rounded-md px-4 py-4" style={{ border: '1px solid var(--line)' }}>
            <p className="text-xs font-medium uppercase tracking-wider">{t('cal.peaje.titulo')}</p>
            {'faltante' in r.peaje ? (
              <p className="mt-2 text-sm">{r.peaje.faltante}</p>
            ) : (
              <>
                <p className="mt-2 text-xl font-semibold" style={{ color: 'var(--ink)' }}>
                  {t('cal.peaje.cifra', { mes: mxn(r.peaje.estimuloMesMxn), anio: mxn(r.peaje.estimuloAnioMxn) })}
                </p>
                <p className="mt-1 text-sm">{t('cal.peaje.subtotal', { subtotal: mxn(r.peaje.subtotalEstimadoMes) })}</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                  {r.peaje.condiciones.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </>
            )}
          </div>

          {/* Total + advertencias */}
          <div className="rounded-md px-4 py-4" style={{ border: '1px solid var(--marca)' }}>
            <p className="text-xs font-medium uppercase tracking-wider">{t('cal.total.titulo')}</p>
            <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--ink)' }}>
              {r.totalAnualMxn !== null ? mxn(r.totalAnualMxn) : t('cal.total.sin_datos')}
            </p>
            <p className="mt-1 text-sm">{r.notaDelTotal}</p>
            {r.supuestos.length > 0 && (
              <>
                <p className="mt-4 text-xs font-medium uppercase tracking-wider">{t('cal.supuestos')}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {r.supuestos.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </>
            )}
            <p className="mt-4 text-xs font-medium uppercase tracking-wider">{t('cal.advertencias')}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {r.advertencias.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>

          {/* ── El contacto — después del resultado, nunca antes ── */}
          <div className="rounded-md px-4 py-4" style={{ border: '1px solid var(--line)' }}>
            {envio === 'listo' ? (
              <p className="text-sm" style={{ color: 'var(--ink)' }}>
                {t('cal.contacto.listo')}
              </p>
            ) : (
              <>
                <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{t('cal.contacto.pregunta')}</p>
                <p className="mt-1 text-xs">
                  {rico(t('cal.contacto.nota'), { enlace: (c) => <Link href="/aviso/prospectos" className="underline underline-offset-2">{c}</Link> })}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <input className={campo} placeholder={t('cal.contacto.nombre')} value={nombre} onChange={(e) => setNombre(e.target.value)} />
                  <input className={campo} placeholder={t('cal.contacto.empresa')} value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
                  <input className={campo} placeholder={t('cal.contacto.correo')} inputMode="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
                  <input className={campo} placeholder={t('cal.contacto.whatsapp')} inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
                </div>
                {/* Honeypot: fuera de la vista; un humano jamás lo llena. */}
                <input
                  className="absolute -left-[9999px] h-0 w-0 opacity-0" tabIndex={-1} autoComplete="off"
                  aria-hidden="true" value={sitioWeb} onChange={(e) => setSitioWeb(e.target.value)} placeholder={t('cal.contacto.honeypot')}
                />
                {errorEnvio && <p className="mt-2 text-sm" style={{ color: 'var(--warn)' }}>{errorEnvio}</p>}
                <Boton variante="primary" onClick={pedirCopia} disabled={envio === 'mandando'} className="mt-3">
                  {envio === 'mandando' ? t('cal.contacto.mandando') : t('cal.contacto.boton')}
                </Boton>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
