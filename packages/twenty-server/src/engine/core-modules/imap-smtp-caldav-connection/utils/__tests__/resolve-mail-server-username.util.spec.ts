import { resolveMailServerUsername } from 'src/engine/core-modules/imap-smtp-caldav-connection/utils/resolve-mail-server-username.util';

describe('resolveMailServerUsername', () => {
  const handle = 'betty@example.com';

  it('uses the email address when the username is missing', () => {
    expect(resolveMailServerUsername(undefined, handle)).toBe(handle);
    expect(resolveMailServerUsername(null, handle)).toBe(handle);
  });

  it('uses the email address when the username is empty or blank', () => {
    expect(resolveMailServerUsername('', handle)).toBe(handle);
    expect(resolveMailServerUsername('   ', handle)).toBe(handle);
  });

  it('keeps an explicit username, trimmed', () => {
    expect(resolveMailServerUsername(' mailbox-user ', handle)).toBe(
      'mailbox-user',
    );
  });
});
