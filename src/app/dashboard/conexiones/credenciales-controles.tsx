'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Vault, PlugZap } from 'lucide-react';
import { Aviso, AvisoResultado, Boton, BotonConfirmar, CampoSelect, CampoTexto, Icono, clasesBoton } from '@/app/ui-v2/componentes';
import './conexiones.css';

// ═══════════════════════════════════════════════════════════════════════════
// LA CAPTURA DE CREDENCIALES (C2, auditoría 4) — la mitad CLIENTE.
//
// El catálogo llega como PROP serializable (id, nombre y la FORMA de cada
// campo), nunca importando `registro.ts` con valor: aunque el catálogo es
// puro, sus fichas (`probar()`, fuentes, ayuda de venta) no tienen nada que
// hacer en el bundle del navegador — al cliente solo viaja lo que la forma
// pinta. Misma decisión que `AREAS_DE_LLAVE` en llaves-api.
//
// El secreto hace UN viaje: de este input a la server action, y de ahí al
// cofre. No se refleja en estado de React ni vuelve en la respuesta.
// ═══════════════════════════════════════════════════════════════════════════

/** La FORMA de un campo, sin el valor — espejo serializable de
 *  `CampoCredencial` (tipos.ts). */
export interface CampoCaptura {
  clave: string;
  rotulo: string;
  forma: 'texto' | 'url' | 'secreto' | 'correo';
  requerida: boolean;
  ayuda: string;
  ejemplo?: string;
}

export interface ConectorCaptura {
  id: string;
  nombre: string;
  campos: CampoCaptura[];
}

/** Un grupo del select: una `CategoriaConector` con los conectores que piden
 *  credenciales. Desde el arreglo de agosto-2026 los GPS SÍ vienen: se
 *  capturan aquí, en `conector_credencial`, que es la tabla que lee el poller
 *  de posiciones. Antes se excluían apuntando a `rastreo_credencial`, una
 *  tabla que ningún escritor de `src/` llenaba nunca. */
export interface GrupoCaptura {
  categoria: string;
  conectores: ConectorCaptura[];
}

export type ResultadoCredencial =
  | { ok: true; mensaje: string }
  | { ok: false; error: string }
  | null;
export type AccionCredencial = (previo: ResultadoCredencial, fd: FormData) => Promise<ResultadoCredencial>;

/** input type por forma: el `password` es lo que evita que el secreto quede a
 *  la vista (y en el autocompletado) mientras se teclea. */
const TIPO_INPUT: Record<CampoCaptura['forma'], 'text' | 'url' | 'password' | 'email'> = {
  texto: 'text', url: 'url', secreto: 'password', correo: 'email',
};

/** El error del servidor, VERBATIM, con el aviso único del panel. */
function AvisoError({ error }: { error: string }) {
  return <AvisoResultado estado={{ ok: false, error }} />;
}

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Vault} />}>
      {pending ? 'Guardando…' : 'Guardar en el cofre'}
    </Boton>
  );
}

/**
 * El select de sistema y sus campos dinámicos. Los campos cambian con el
 * conector elegido — por eso esto es cliente y no un form estático.
 */
export function FormaCredenciales({ grupos, guardar }: {
  grupos: GrupoCaptura[];
  guardar: AccionCredencial;
}) {
  const [estado, despachar] = useActionState(guardar, null);
  const [elegido, setElegido] = useState('');
  const conector = grupos.flatMap((g) => g.conectores).find((c) => c.id === elegido) ?? null;

  // Tras guardar, la forma se VACÍA (el `key` de abajo remonta los inputs):
  // el secreto no se queda tecleado en el DOM después de viajar al cofre.
  // Ajuste DURANTE el render y no en un efecto (patrón "adjusting state when
  // props change" de react.dev) — el lint del compilador prohíbe el setState
  // síncrono dentro de un useEffect.
  const [ultimoEstado, setUltimoEstado] = useState<ResultadoCredencial>(null);
  if (estado !== ultimoEstado) {
    setUltimoEstado(estado);
    if (estado?.ok) setElegido('');
  }

  return (
    <div className="rv-cx__form">
      {/* `key={elegido}`: cambiar de sistema TIRA los valores tecleados. Sin
          esto, el password de SAP sobreviviría en el input al cambiar a Odoo
          y viajaría al conector equivocado. */}
      <form action={despachar} className="rv-cx__form" key={elegido}>
        <CampoSelect etiqueta="Sistema" id="cred-conector" name="conector" value={elegido} required
          onChange={(e) => setElegido(e.target.value)} className="rv-cx__selector">
          <option value="">Elige el sistema…</option>
          {grupos.map((g) => (
            <optgroup key={g.categoria} label={g.categoria}>
              {g.conectores.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </optgroup>
          ))}
        </CampoSelect>

        {conector && (
          <div className="rv-cx__rejilla">
            {conector.campos.map((campo) => (
              <CampoTexto key={campo.clave} etiqueta={`${campo.rotulo}${campo.requerida ? '' : ' (opcional)'}`}
                id={`cred-${campo.clave}`} name={`campo_${campo.clave}`}
                tipo={TIPO_INPUT[campo.forma]} required={campo.requerida}
                placeholder={campo.ejemplo} autoComplete="off" ayuda={campo.ayuda} />
            ))}
          </div>
        )}

        {estado && !estado.ok && <AvisoError error={estado.error} />}
        {estado?.ok && <p className="rv-cx__ok">{estado.mensaje}</p>}
        {conector && <div><BotonGuardar /></div>}
      </form>
    </div>
  );
}

/**
 * PROBAR LA CONEXIÓN — el botón que faltaba para que `probar()` deje de ser
 * código muerto.
 *
 * Lo que aprieta esta forma NO es un ping: la server action lee la credencial
 * del cofre, llama al sistema del cliente con ella y sella lo que contestó en
 * `probada_en`/`ultimo_error`. Por eso el resultado se enseña TAL CUAL lo
 * devolvió el adaptador —incluido el mensaje del proveedor— en vez de un
 * «listo» genérico: un 403 de Samsara y un 500 de Samsara mandan a hacer
 * cosas distintas, y fundirlos en «falló» manda a regenerar un token que
 * estaba bien.
 *
 * La respuesta se pinta aquí y ADEMÁS queda sellada en la fila: al recargar,
 * el renglón de arriba ya dice «probada el …» o enseña el error. Enseñarla
 * solo aquí la perdería en el siguiente refresh.
 */
export function FormaProbar({ conectorId, probar }: {
  conectorId: string;
  probar: AccionCredencial;
}) {
  const [estado, despachar] = useActionState(probar, null);
  return (
    <div className="rv-cx__form-linea">
      <form action={despachar}>
        <input type="hidden" name="conector" value={conectorId} />
        <BotonProbar />
      </form>
      {estado && !estado.ok && <AvisoError error={estado.error} />}
      {estado?.ok && <Aviso tono="ok">{estado.mensaje}</Aviso>}
    </div>
  );
}

function BotonProbar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" loading={pending} icono={<Icono icono={PlugZap} />}>
      {/* «Probando…» y no «Conectando…»: probar no deja nada conectado, y la
          espera puede ser de hasta 15 s (TIMEOUT_PRUEBA_MS). */}
      {pending ? 'Probando contra el proveedor…' : 'Probar conexión'}
    </Boton>
  );
}

/**
 * Desactivar un acceso, con el diálogo de confirmación ÚNICO del panel (W2): dice
 * que lo guardado no se borra y que para volver a usarlo se captura de nuevo.
 */
/** A37-S17-06: lo que la confirmación promete debe ser lo que hace `desactivarCredencial` (destruye el secreto). */
export function descripcionDesactivar(nombre: string): string {
  return `El acceso a ${nombre} deja de estar disponible para conectar. El secreto se destruye al desactivar; queda solo el registro (fecha y últimos 4). Para volver a usarlo, captúralo de nuevo.`;
}

export function FormaDesactivar({ conectorId, nombre, desactivar }: {
  conectorId: string;
  nombre: string;
  desactivar: AccionCredencial;
}) {
  const [estado, despachar] = useActionState(desactivar, null);
  return (
    <form action={despachar} className="rv-cx__form-linea">
      <input type="hidden" name="conector" value={conectorId} />
      <BotonConfirmar
        etiqueta="Desactivar" tono="peligro" etiquetaConfirmar="Sí, desactivar este acceso"
        titulo={`Desactivar el acceso a ${nombre}`}
        descripcion={descripcionDesactivar(nombre)}
        className={clasesBoton('danger', 'sm')}
      />
      {estado && !estado.ok && <AvisoError error={estado.error} />}
    </form>
  );
}
