import { type MailProviderServer } from '@/settings/accounts/types/MailProviderServer';

export const buildMailProviderServer = (
  host: string,
  port: number,
  connectionSecurity: MailProviderServer['connectionSecurity'],
): MailProviderServer => ({ host, port, connectionSecurity });
