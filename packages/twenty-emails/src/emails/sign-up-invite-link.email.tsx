import { Trans } from '@lingui/react';
import { BaseEmail } from 'src/components/BaseEmail';
import { CallToAction } from 'src/components/CallToAction';
import { Link } from 'src/components/Link';
import { MainText } from 'src/components/MainText';
import { Title } from 'src/components/Title';
import { createI18nInstance } from 'src/utils/i18n.utils';
import { BRAND_DOMAIN } from 'twenty-shared/constants';
import { doNotTranslate } from 'twenty-shared/i18n';
import { type APP_LOCALES } from 'twenty-shared/translations';

type SignUpInviteLinkEmailProps = {
  duration: string;
  link: string;
  locale: keyof typeof APP_LOCALES;
};

export const SignUpInviteLinkEmail = ({
  duration,
  link,
  locale,
}: SignUpInviteLinkEmailProps) => {
  const i18n = createI18nInstance(locale);

  return (
    <BaseEmail locale={locale}>
      <Title value={i18n._('You have been invited to Betty')} />
      <MainText>
        <Trans
          id="Open this link to create your account and your own workspace. It only works for this address and only once, and it expires in {duration}."
          values={{ duration }}
        />
        <br />
        <Link href={link} value={link} />
      </MainText>
      <br />
      <CallToAction href={link} value={i18n._('Create my workspace')} />
      <br />
      <br />
    </BaseEmail>
  );
};

SignUpInviteLinkEmail.PreviewProps = {
  duration: doNotTranslate('7 days'),
  link: `https://app.${BRAND_DOMAIN}/welcome?signUpInvitationToken=123&email=ana%40example.com`,
  locale: 'en',
} as SignUpInviteLinkEmailProps;

export default SignUpInviteLinkEmail;
