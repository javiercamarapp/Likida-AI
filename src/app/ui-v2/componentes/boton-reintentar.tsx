'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Boton } from './boton';

/** Reintentar para tarjetas pintadas en el servidor: vuelve a pedir los datos de la página. */
export function BotonReintentar() {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  return <Boton tamano="sm" loading={pendiente} onClick={() => empezar(() => router.refresh())}>Reintentar</Boton>;
}
