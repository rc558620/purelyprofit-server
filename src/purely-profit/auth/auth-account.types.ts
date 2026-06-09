export type AuthProductScope = 'purely_profit' | 'purely_club';

export type AuthenticatedAccountScope = AuthProductScope | 'developer';

export interface AccountIdentifiers {
  phone: string;
  email: string;
  accountScope: AuthenticatedAccountScope;
}

export interface PhoneUserRecord {
  id: number;
  email: string;
  password: string;
  phone: string;
  accountScope: AuthenticatedAccountScope;
}
