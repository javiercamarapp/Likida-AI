// El formato vive en `formato.ts`, que NO importa nada. Se reexporta para que
// el panel siga importando de aquí sin cambios, y para que el motor y el PDF
// puedan traerlo sin arrastrar dependencias de más.
export { TZ_MX, mxn, usd, litros, fechaMx, numero } from './formato';
