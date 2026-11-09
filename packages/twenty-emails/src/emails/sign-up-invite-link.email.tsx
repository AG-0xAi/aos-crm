import { Trans } from '@lingui/react';
import { BaseEmail } from 'src/components/BaseEmail';
import { CallToAction } from 'src/components/CallToAction';
import { Link } from 'src/components/Link';
import { MainText } from 'src/components/MainText';
import { ShadowText } from 'src/components/ShadowText';
import { Title } from 'src/components/Title';
import { WhatIsTwenty } from 'src/components/WhatIsTwenty';
import { createI18nInstance } from 'src/utils/i18n.utils';
import { BRAND_DOMAIN } from 'twenty-shared/constants';
import { type APP_LOCALES } from 'twenty-shared/translations';

type SignUpInviteLinkEmailProps = {
  expiresInDays: number;
  // Kept for callers that still build an already-formatted (English-only)
  // duration string; overrides the translated plural when set.
  duration?: string;
  link: string;
  serverUrl?: string;
  locale: keyof typeof APP_LOCALES;
};

export const SignUpInviteLinkEmail = ({
  expiresInDays,
  duration,
  link,
  serverUrl,
  locale,
}: SignUpInviteLinkEmailProps) => {
  const i18n = createI18nInstance(locale);
  const resolvedDuration =
    duration ??
    i18n._('{expiresInDays, plural, one {1 day} other {# days}}', {
      expiresInDays,
    });

  return (
    <BaseEmail
      locale={locale}
      serverUrl={serverUrl}
      footerNote={i18n._(
        "You're receiving this email because someone invited you to create your own workspace on Betty.",
      )}
    >
      <Title value={i18n._('You have been invited to Betty')} />
      <MainText>{i18n._('Welcome to Betty!')}</MainText>
      <MainText>
        <Trans
          id="Open this link to create your account and your own workspace. It only works for this address and only once, and it expires in {duration}."
          values={{ duration: resolvedDuration }}
        />
      </MainText>
      <CallToAction href={link} value={i18n._('Create my workspace')} />
      <ShadowText>
        <Link href={link} value={link} />
      </ShadowText>
      <WhatIsTwenty i18n={i18n} />
    </BaseEmail>
  );
};

SignUpInviteLinkEmail.PreviewProps = {
  expiresInDays: 7,
  link: `https://app.${BRAND_DOMAIN}/welcome?signUpInvitationToken=123&email=ana%40example.com`,
  serverUrl: `https://app.${BRAND_DOMAIN}`,
  locale: 'en',
} as SignUpInviteLinkEmailProps;

export default SignUpInviteLinkEmail;
