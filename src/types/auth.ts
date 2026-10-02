export type PermissionKey = 
  | 'Emitir_OAB' 
  | 'Revisar_OAB' 
  | 'Recepcion_Rampa' 
  | 'Auditoria_Kardex' 
  | 'Superadmin';

export interface UserProfile {
  id: number | string;
  name: string;
  username?: string | null;
  puestos: string[];
  permissions: PermissionKey[];
  authMethod: 'telegram' | 'pin' | '2fa_temp';
  telegramId?: number;
  telegramUsername?: string | null;
  expiresIn?: number;
  isTemporary?: boolean;
}

export interface ActiveEmployee {
  id: string;
  name: string;
  hasPin: boolean;
  areas?: string[];
}

export interface AuthErrorState {
  code: string;
  message: string;
  employeeName?: string;
  puestos?: string[];
  telegramId?: number;
  telegramUsername?: string | null;
}
