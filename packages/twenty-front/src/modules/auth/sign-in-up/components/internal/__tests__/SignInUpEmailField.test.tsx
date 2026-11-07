import { SignInUpEmailField } from '@/auth/sign-in-up/components/internal/SignInUpEmailField';
import {
  useSignInUpForm,
  type Form,
} from '@/auth/sign-in-up/hooks/useSignInUpForm';
import { useSignUpInvitationToken } from '@/auth/sign-in-up/hooks/useSignUpInvitationToken';
import {
  jotaiStore,
  resetJotaiStore,
} from '@/ui/utilities/state/jotai/jotaiStore';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider as JotaiProvider } from 'jotai';
import { type ReactNode } from 'react';
import { FormProvider, type UseFormReturn } from 'react-hook-form';
import { MemoryRouter } from 'react-router-dom';

const TOKEN = 'a'.repeat(64);

// The real form hook and the real field, so what is measured is the screen the
// invited person sees: the address comes from the link's `email` and the
// invitation is what locks it.
const FieldUnderTest = () => {
  const { form } = useSignInUpForm();
  const { isSignUpInvitation } = useSignUpInvitationToken();

  return (
    <FormProvider
      // oxlint-disable-next-line react/jsx-props-no-spreading
      {...(form as UseFormReturn<Form>)}
    >
      <SignInUpEmailField showErrors={false} isLocked={isSignUpInvitation} />
    </FormProvider>
  );
};

const renderAt = (search: string) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider i18n={i18n}>
      <MemoryRouter initialEntries={[search]}>
        <JotaiProvider store={jotaiStore}>{children}</JotaiProvider>
      </MemoryRouter>
    </I18nProvider>
  );

  return render(<FieldUnderTest />, { wrapper: Wrapper });
};

describe('SignInUpEmailField on a sign-up invitation link', () => {
  beforeEach(() => {
    resetJotaiStore();
  });

  it('prefills the invited address and refuses to let it be changed', async () => {
    renderAt(
      `/welcome?signUpInvitationToken=${TOKEN}&email=ana%40example.test`,
    );

    const input = screen.getByPlaceholderText('Email') as HTMLInputElement;

    expect(input.value).toBe('ana@example.test');
    expect(input).toBeDisabled();
    expect(
      screen.getByText('This invitation is for this address only.'),
    ).toBeInTheDocument();

    await userEvent.type(input, 'otra@example.test');

    expect(input.value).toBe('ana@example.test');
  });

  it('leaves the address editable when there is no invitation in the link', async () => {
    renderAt('/welcome?email=ana%40example.test');

    const input = screen.getByPlaceholderText('Email') as HTMLInputElement;

    expect(input).not.toBeDisabled();
    expect(
      screen.queryByText('This invitation is for this address only.'),
    ).not.toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, 'otra@example.test');

    expect(input.value).toBe('otra@example.test');
  });

  it('does not lock on an empty invitation parameter', () => {
    renderAt('/welcome?signUpInvitationToken=&email=ana%40example.test');

    expect(screen.getByPlaceholderText('Email')).not.toBeDisabled();
  });
});
