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
import { mxn, numero as litrosFmt, hoyMx } from '@/lib/formato';

const num = (s: string): number | null => {
  const n = Number(s.replace(/[,$\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function Calculadora() {
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
          cifras: {
            litrosDieselMes: num(litros), gastoDieselMesMxn: num(gastoDiesel),
            gastoCasetasMesMxn: num(casetas), unidades: num(unidades),
          },
        }),
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorEnvio(typeof cuerpo.error === 'string' ? cuerpo.error : 'No pudimos registrar tus datos. Inténtalo de nuevo.');
        setEnvio('error');
        return;
      }
      setEnvio('listo');
    } catch {
      setErrorEnvio('No pudimos registrar tus datos. Inténtalo de nuevo.');
      setEnvio('error');
    }
  };

  const campo = 'mt-1 w-full rounded-md border px-3 py-2 text-sm';
  const estiloCampo = { borderColor: 'var(--line)', color: 'var(--ink)', background: 'var(--bg)' } as const;

  return (
    <div>
      {/* ── Los tres datos ── */}
      <section className="mt-8 grid gap-4">
        <div>
          <label className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Litros de diésel al mes</label>
          <input className={campo} style={estiloCampo} inputMode="decimal" value={litros}
            onChange={(e) => setLitros(e.target.value)} placeholder="p. ej. 40,000" />
          <p className="mt-1 text-xs">¿No lo sabes en litros? Deja esto vacío y captura el gasto:</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs">Gasto de diésel al mes (MXN)</label>
              <input className={campo} style={estiloCampo} inputMode="decimal" value={gastoDiesel}
                onChange={(e) => setGastoDiesel(e.target.value)} placeholder="p. ej. 1,000,000" />
            </div>
            <div>
              <label className="text-xs">Precio por litro que pagas</label>
              <input className={campo} style={estiloCampo} inputMode="decimal" value={precioLitro}
                onChange={(e) => setPrecioLitro(e.target.value)} />
              <p className="mt-1 text-xs">Referencia editable: ajústalo al tuyo.</p>
            </div>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Gasto en casetas al mes (MXN, con IVA)</label>
          <input className={campo} style={estiloCampo} inputMode="decimal" value={casetas}
            onChange={(e) => setCasetas(e.target.value)} placeholder="p. ej. 250,000" />
        </div>
        <div>
          <label className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Unidades de tu flota</label>
          <input className={campo} style={estiloCampo} inputMode="numeric" value={unidades}
            onChange={(e) => setUnidades(e.target.value)} placeholder="p. ej. 35" />
        </div>
        <button
          onClick={calcular}
          className="mt-2 w-fit rounded-md px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--marca)' }}
        >
          Calcular con mis números
        </button>
      </section>

      {/* ── El resultado — antes de pedir nada ── */}
      {r && (
        <section className="mt-10 space-y-6">
          {/* Diésel */}
          <div className="rounded-md px-4 py-4" style={{ border: '1px solid var(--line)' }}>
            <p className="text-xs font-medium uppercase tracking-wider">Diésel elegible para el estímulo IEPS</p>
            {'faltante' in r.diesel ? (
              <p className="mt-2 text-sm">{r.diesel.faltante}</p>
            ) : (
              <>
                <p className="mt-2 text-xl font-semibold" style={{ color: 'var(--ink)' }}>
                  {litrosFmt(r.diesel.litrosMes)} litros al mes
                </p>
                <p className="text-sm">({litrosFmt(r.diesel.litrosAnio)} litros al año — el dato duro que tu contador multiplica por la cuota semanal)</p>
                {r.diesel.estimacionMesMxn !== null ? (
                  <p className="mt-3 text-sm">
                    Cuota disminuida registrada: <strong style={{ color: 'var(--ink)' }}>${r.diesel.cuota.pesosPorLitro}/litro</strong> (al {r.diesel.cuota.registradaEl}) ·{' '}
                    <a href={r.diesel.cuota.fuenteUrl} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">verifícala en el DOF</a>
                    <br />Estimación con ESA cuota: <strong style={{ color: 'var(--ink)' }}>{mxn(r.diesel.estimacionMesMxn)}</strong> al mes
                  </p>
                ) : (
                  <p className="mt-3 text-sm">
                    La cuota que tenemos registrada ya venció, así que no te damos pesos con una cuota vieja: te damos los litros, que es el dato que no cambia.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Peaje */}
          <div className="rounded-md px-4 py-4" style={{ border: '1px solid var(--line)' }}>
            <p className="text-xs font-medium uppercase tracking-wider">El 50% de peaje</p>
            {'faltante' in r.peaje ? (
              <p className="mt-2 text-sm">{r.peaje.faltante}</p>
            ) : (
              <>
                <p className="mt-2 text-xl font-semibold" style={{ color: 'var(--ink)' }}>
                  {mxn(r.peaje.estimuloMesMxn)} al mes · {mxn(r.peaje.estimuloAnioMxn)} al año
                </p>
                <p className="mt-1 text-sm">Sobre un subtotal estimado de {mxn(r.peaje.subtotalEstimadoMes)} (tu gasto ÷ 1.16).</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                  {r.peaje.condiciones.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </>
            )}
          </div>

          {/* Total + advertencias */}
          <div className="rounded-md px-4 py-4" style={{ border: '1px solid var(--marca)' }}>
            <p className="text-xs font-medium uppercase tracking-wider">Estimación de recuperación anual</p>
            <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--ink)' }}>
              {r.totalAnualMxn !== null ? mxn(r.totalAnualMxn) : 'Captura al menos un dato para estimar'}
            </p>
            <p className="mt-1 text-sm">{r.notaDelTotal}</p>
            {r.supuestos.length > 0 && (
              <>
                <p className="mt-4 text-xs font-medium uppercase tracking-wider">Supuestos usados</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {r.supuestos.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </>
            )}
            <p className="mt-4 text-xs font-medium uppercase tracking-wider">Lo que debes saber</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {r.advertencias.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>

          {/* ── El contacto — después del resultado, nunca antes ── */}
          <div className="rounded-md px-4 py-4" style={{ border: '1px solid var(--line)' }}>
            {envio === 'listo' ? (
              <p className="text-sm" style={{ color: 'var(--ink)' }}>
                Listo. Te buscamos hoy mismo con tu estimación y la fecha de la cuota usada. Gracias.
              </p>
            ) : (
              <>
                <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>¿Quieres tu copia y que la revisemos contigo?</p>
                <p className="mt-1 text-xs">
                  Nada de secuencias infinitas: máximo tres toques.{' '}
                  <Link href="/aviso/prospectos" className="underline underline-offset-2">Aviso de privacidad</Link>.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <input className={campo} style={estiloCampo} placeholder="Tu nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                  <input className={campo} style={estiloCampo} placeholder="Empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
                  <input className={campo} style={estiloCampo} placeholder="Correo" inputMode="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
                  <input className={campo} style={estiloCampo} placeholder="WhatsApp (opcional)" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
                </div>
                {/* Honeypot: fuera de la vista; un humano jamás lo llena. */}
                <input
                  className="absolute -left-[9999px] h-0 w-0 opacity-0" tabIndex={-1} autoComplete="off"
                  aria-hidden="true" value={sitioWeb} onChange={(e) => setSitioWeb(e.target.value)} placeholder="Sitio web"
                />
                {errorEnvio && <p className="mt-2 text-sm" style={{ color: 'var(--color-warn)' }}>{errorEnvio}</p>}
                <button
                  onClick={pedirCopia}
                  disabled={envio === 'mandando'}
                  className="mt-3 rounded-md px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--marca)' }}
                >
                  {envio === 'mandando' ? 'Mandando…' : 'Quiero mi copia'}
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
