// An empty username field means "log in with the email address": `??` alone
// would keep the empty string and send a LOGIN with no user.
export const resolveMailServerUsername = (
  username: string | null | undefined,
  handle: string,
): string => username?.trim() || handle;
