// Sustituto de `next/navigation` SOLO para las pruebas de comportamiento en Chromium.
export const useRouter = () => ({ refresh() {}, push() {}, replace() {} });
