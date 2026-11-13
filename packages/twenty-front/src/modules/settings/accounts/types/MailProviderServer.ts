import { type EmailConnectionSecurity } from '~/generated-metadata/graphql';

export type MailProviderServer = {
  host: string;
  port: number;
  connectionSecurity: EmailConnectionSecurity;
};
