'use client';

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Boton } from './boton';
import { useAbrirPorUrl, PARAM_ABRIR } from './drawer-abrir';
import { Aviso, type AccionDeForma, type ResultadoAccion } from './forma';
import { Drawer, type TamanoDrawer } from './overlay';

// ═══════════════════════════════════════════════════════════════════════════
// FORMA EN CAJÓN (paquete D, molde de OVERLAYS D11). Un Drawer cuyo cuerpo es un <form action={…}>: el alta/edición ocurre sin salir de
// la pantalla, igual que en Rovaq.
//
//  · SERVER ACTION SIN CLOSURES. `accion` es una función de módulo marcada 'use server' que el componente de servidor pasa tal cual (una
//    referencia serializable). Lo que la acción necesita (id de la flota, etc.) viaja en el FormData con `<input type="hidden">` (hijos);
//    una closure creada en el render del servidor no cruza al cliente y su alcance no se puede auditar.
//  · EL RECHAZO ES EL CASO NORMAL (mismo razonamiento que `FormaConAviso`): el cajón no se cierra si la acción responde `{ error }`; los
//    campos conservan lo escrito (inputs no controlados) y el aviso `aria-live` dice por qué. Solo `{ ok }` cierra.
//  · «Guardar» está en el pie (fuera del <form>, atributo `form=`), se deshabilita mientras corre (la acción no es idempotente: el doble
//    clic daría de alta dos veces) y el estado pendiente viene de `useActionState` (misma señal que `useFormStatus`, pero visible desde el
//    pie, que no es descendiente del <form>).
//  · FOCO Y ESC: los da `Drawer` (primer campo al abrir, Tab atrapado, Esc cierra, el foco vuelve al disparador).
//  · APERTURA POR `?abrir=<id>` (ver `drawer-abrir.ts`); `abiertoInicial` deja que el servidor ya lo mande abierto.
// ═══════════════════════════════════════════════════════════════════════════

export interface PropsFormaEnCajon {
  /** Identificador estable del cajón: lo que va en `?abrir=<id>`. */
  id: string;
  titulo: string;
  descripcion?: ReactNode;
  accion: AccionDeForma;
  /** Texto del botón de envío del pie («Crear cliente»). */
  boton: string;
  /** Texto del botón que abre el cajón; sin él no se pinta disparador (se abre solo por URL o por otro control con `?abrir=`). */
  disparador?: string;
  /** Campos del formulario (ReactNode ya armado). */
  children: ReactNode;
  tamano?: TamanoDrawer;
  /** Nombre del parámetro de URL. */
  param?: string;
  /** Nace abierto (el servidor leyó `?abrir=`). */
  abiertoInicial?: boolean;
  /** Cierra el cajón cuando la acción responde `{ ok }` (por omisión sí). El mensaje queda en una región `role=status` junto al disparador. */
  cerrarAlOk?: boolean;
}

export function FormaEnCajon({ id, titulo, descripcion, accion, boton, disparador, children, tamano = 'm', param = PARAM_ABRIR, abiertoInicial = false, cerrarAlOk = true }: PropsFormaEnCajon) {
  const idForma = useId();
  const forma = useRef<HTMLFormElement>(null);
  const { abierto, abrir, cerrar } = useAbrirPorUrl({ id, param, abiertoInicial });
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  // Un aviso viejo (de una apertura anterior) no se muestra al reabrir: se descarta el estado que ya había.
  const [descartado, setDescartado] = useState<ResultadoAccion>(null);
  const [confirmado, setConfirmado] = useState<string | null>(null);
  const visible = estado !== descartado ? estado : null;

  // React 19 REINICIA el <form> al terminar la acción (también cuando rechazó). Se guarda lo escrito al enviar y, si la respuesta es un
  // rechazo, se devuelve a los campos: corregir un dígito no obliga a recapturar todo (la razón de ser de `FormaConAviso`).
  const escrito = useRef<FormData | null>(null);
  useEffect(() => {
    if (!estado?.error || estado === descartado || !escrito.current || !forma.current) return;
    restaurar(forma.current, escrito.current);
  }, [estado, descartado]);

  useEffect(() => {
    if (estado?.ok === undefined || estado === descartado) return;
    setConfirmado(estado.ok);
    if (cerrarAlOk) { setDescartado(estado); forma.current?.reset(); cerrar(); }
  }, [estado, descartado, cerrarAlOk, cerrar]);

  const alAbrir = () => { setDescartado(estado); setConfirmado(null); abrir(); };

  return (
    <>
      {disparador ? <Boton type="button" variante="secondary" tamano="sm" aria-haspopup="dialog" onClick={alAbrir}>{disparador}</Boton> : null}
      {/* Región viva SIEMPRE presente: un aria-live que nace con su texto no se anuncia. */}
      <span className="sr-only" role="status" aria-live="polite">{confirmado ?? ''}</span>
      <Drawer
        abierto={abierto} onCerrar={cerrar} titulo={titulo} descripcion={descripcion} tamano={tamano} cierraConFondo={false}
        pie={(
          <>
            <Boton type="button" variante="ghost" onClick={cerrar}>Cancelar</Boton>
            <Boton type="submit" form={idForma} variante="primary" disabled={pendiente} aria-busy={pendiente || undefined}>{pendiente ? 'Guardando…' : boton}</Boton>
          </>
        )}
      >
        <form id={idForma} ref={forma} action={enviar} onSubmit={(e) => { escrito.current = new FormData(e.currentTarget); }} className="flex flex-col gap-3" data-forma-cajon={id}>
          {children}
          <Aviso estado={visible} />
        </form>
      </Drawer>
    </>
  );
}

/** Devuelve a los campos con nombre lo que la persona había escrito. Los `hidden` no se tocan (los pone el servidor). */
function restaurar(forma: HTMLFormElement, datos: FormData) {
  for (const el of Array.from(forma.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) || !el.name) continue;
    if (el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'file' || el.type === 'password')) continue;
    const valores = datos.getAll(el.name).filter((v): v is string => typeof v === 'string');
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) el.checked = valores.includes(el.value);
    else if (el instanceof HTMLSelectElement && el.multiple) for (const o of Array.from(el.options)) o.selected = valores.includes(o.value);
    else el.value = valores[0] ?? '';
  }
}
