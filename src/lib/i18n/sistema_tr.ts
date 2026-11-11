import type { TrDe } from './tr_tipos';
import { trAdminSistemaEs } from './tr_admin';

/** La función `t` del namespace «admin_sistema», para helpers y componentes de servidor síncronos: sin ella hablan español. */
export type TSistema = TrDe<'admin_sistema'>;
export const T_SISTEMA_ES: TSistema = trAdminSistemaEs;
