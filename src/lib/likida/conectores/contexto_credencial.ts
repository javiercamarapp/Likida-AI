// A37-TRANSVERSAL-09: el contexto con el que el cofre ata una credencial de conector a su flota y su conector (AAD de GCM, `v2`).
// Vive aparte de `cofre.ts` a propósito: es puro y no necesita la llave del entorno.
export const contextoCredencial = (tenantId: string, conectorId: string): string => `${tenantId}:${conectorId}`;
