'use client';

import { useState } from 'react';
import { mxn } from '@/lib/formato';
import { Boton } from '../../ui-v2/componentes/boton';
// SOLO EL TIPO de `portal_pago.ts`: ese módulo importa `node:crypto` para
// generar y hashear tokens, y un import de VALOR lo arrastraría al bundle del
// navegador — el build de webpack lo rechaza de plano, que es la forma dura de
// recordar que el catálogo viaja como PROP desde la página (mismo contrato que
// `dashboard/facturacion/forma.tsx` con los clientes y los viajes).
import type { MetodoPortal } from '@/lib/likida/portal_pago';

// ═══════════════════════════════════════════════════════════════════════════
// EL FORMULARIO DEL CLIENTE. Cuatro campos y una carnada.
//
// NO VALIDA NADA QUE IMPORTE. Todo lo que decide —fecha posible, monto contra
// el saldo real, referencia obligatoria— se decide en el servidor
// (`validarPropuesta`), porque este archivo lo controla el navegador de un
// tercero. Lo de aquí es comodidad: un `max` en el calendario, un `step` en el
// monto, el botón deshabilitado mientras se manda. Duplicar la regla real la
// haría divergir en el primer cambio.
//
// El honeypot es la copia literal del de la calculadora (#124): fuera de la
// vista, `tabIndex={-1}`, `aria-hidden` — un lector de pantalla tampoco lo
// anuncia, así que ninguna persona lo llena por accidente.
// ═══════════════════════════════════════════════════════════════════════════

type Envio = 'nada' | 'mandando' | 'listo' | 'error';

export function FormaDePago({ token, saldo, metodos }: {
  token: string;
  saldo: number;
  /** El catálogo cerrado, desde el servidor. La validación de verdad la hace
   *  `validarPropuesta`: esta lista es lo que se puede ELEGIR, no lo que se
   *  acepta — el navegador de un tercero puede mandar cualquier cosa. */
  metodos: ReadonlyArray<{ id: MetodoPortal; rotulo: string }>;
}) {
  const [fecha, setFecha] = useState('');
  const [monto, setMonto] = useState('');
  const [referencia, setReferencia] = useState('');
  const [metodo, setMetodo] = useState<string>(metodos[0].id);
  const [sitioWeb, setSitioWeb] = useState(''); // honeypot: un humano no lo ve
  const [envio, setEnvio] = useState<Envio>('nada');
  const [mensaje, setMensaje] = useState<string | null>(null);

  const mandar = async () => {
    setEnvio('mandando');
    setMensaje(null);
    try {
      const res = await fetch('/api/pago/registrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, fecha, monto, referencia, metodo, sitioWeb }),
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMensaje(typeof cuerpo.error === 'string'
          ? cuerpo.error
          : 'No pudimos registrar tu pago. Vuelve a intentarlo.');
        setEnvio('error');
        return;
      }
      setMensaje(typeof cuerpo.mensaje === 'string' ? cuerpo.mensaje : 'Listo, ya quedó registrado.');
      setEnvio('listo');
    } catch {
      // Un fallo de red aquí es AMBIGUO: pudo haber llegado. Se dice tal cual
      // en vez de afirmar que no quedó — recargar la página muestra la verdad,
      // y el índice único de la base absorbe un segundo intento idéntico.
      setMensaje('No pudimos confirmar el envío. Recarga esta página: si tu pago aparece en la lista, ya quedó.');
      setEnvio('error');
    }
  };

  if (envio === 'listo') {
    return (
      <p className="mt-4 rounded-md p-3 text-[14px]" style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}>
        {mensaje}
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <Campo etiqueta="¿Qué día pagaste?">
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rv-pub__campo"
        />
      </Campo>

      <Campo etiqueta={`¿Cuánto? (el saldo pendiente es ${mxn(saldo)})`}>
        <input
          type="text"
          inputMode="decimal"
          placeholder="12345.67"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          className="rv-pub__campo"
        />
      </Campo>

      <Campo etiqueta="Referencia bancaria">
        <input
          type="text"
          maxLength={80}
          placeholder="Clave de rastreo, número de operación o folio del depósito"
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          className="rv-pub__campo"
        />
        <p className="mt-1 text-[12px]">
          Es el dato con el que quien te facturó va a encontrar tu depósito en su
          estado de cuenta. Sin él, no hay cómo cruzarlo.
        </p>
      </Campo>

      <Campo etiqueta="¿Cómo pagaste?">
        <select
          value={metodo}
          onChange={(e) => setMetodo(e.target.value)}
          className="rv-pub__campo"
        >
          {metodos.map((m) => (
            <option key={m.id} value={m.id}>{m.rotulo}</option>
          ))}
        </select>
      </Campo>

      {/* Honeypot: fuera de la vista; un humano jamás lo llena. */}
      <input
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={sitioWeb}
        onChange={(e) => setSitioWeb(e.target.value)}
        placeholder="Sitio web"
      />

      {mensaje && envio === 'error' && (
        <p className="text-[14px]" style={{ color: 'var(--warn, var(--ink))' }}>{mensaje}</p>
      )}

      <Boton variante="primary" onClick={mandar} disabled={envio === 'mandando'} loading={envio === 'mandando'}>
        {envio === 'mandando' ? 'Registrando…' : 'Registrar mi pago'}
      </Boton>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium" style={{ color: 'var(--ink)' }}>{etiqueta}</span>
      {children}
    </label>
  );
}
