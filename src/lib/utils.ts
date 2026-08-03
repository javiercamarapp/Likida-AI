import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// El formato vive en `formato.ts`, que NO importa nada — ni clsx ni
// tailwind-merge, que este archivo sí necesita para `cn()`. Se reexporta para
// que el panel siga importando de aquí sin cambios, y para que el motor y el PDF
// puedan traerlo sin arrastrar el sistema de clases de Tailwind.
export { TZ_MX, mxn, usd, litros, fechaMx, numero } from './formato';
