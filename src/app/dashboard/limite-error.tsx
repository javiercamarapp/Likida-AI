'use client';

import { Component, type ReactNode } from 'react';
import { EstadoError } from '../admin/ui/kit';

/**
 * FE-14 — EL LÍMITE DE ERROR DE UN BLOQUE.
 *
 * Con la pantalla partida en `<Suspense>` (uno por tarjeta), el error deja de
 * ser un evento de PÁGINA: la consulta de una tarjeta puede reventar mientras
 * sus hermanas ya se pintaron. `Suspense` NO atrapa errores —solo espera—, así
 * que sin esto una consulta que lanza dentro de un boundary sube hasta el
 * `error.tsx` de la ruta y se lleva la pantalla entera por delante: justo lo
 * contrario de lo que el streaming vino a hacer.
 *
 * El grueso de las secciones ya degrada sola con `safe()` (promesa que resuelve
 * a `null` y la tarjeta pinta su leyenda honesta). Esto cubre a las que NO van
 * envueltas en `safe` a propósito —las primarias de un agente, por ejemplo— y a
 * cualquier fallo de render: la tarjeta muestra `EstadoError` con su botón de
 * reintento, y las de al lado ni se enteran.
 *
 * Es un Client Component porque un límite de error de React exige clase con
 * estado, y `EstadoError` ya es cliente (usa `router.refresh()` para reintentar).
 */
export class LimiteError extends Component<
  { mensaje: string; children: ReactNode },
  { rompio: boolean }
> {
  state = { rompio: false };

  static getDerivedStateFromError() {
    return { rompio: true };
  }

  render() {
    if (this.state.rompio) return <EstadoError mensaje={this.props.mensaje} />;
    return this.props.children;
  }
}
