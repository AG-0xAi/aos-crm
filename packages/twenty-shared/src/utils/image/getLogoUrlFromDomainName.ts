export const sanitizeURL = (link: string | null | undefined) => {
  return link
    ? link
        .replace(/(^https?:\/\/)/i, '')
        .replace(/(^www\.)/i, '')
        .replace(/\/$/, '')
    : '';
};

// CRM-019 (R2): this deployment has NO company-icon provider. Upstream built
// `https://twenty-icons.com/<domain>` here, which sent every company domain a
// user typed -- and, through uploadInferredWorkspaceLogo, the sign-up e-mail
// domain -- to a third party.
//
// It stays a function rather than being deleted because it is the single
// chokepoint every icon consumer already goes through (front avatars, LINKS
// favicons, the server's record image identifier and search): returning
// undefined here is what makes each of them fall back to its own initials
// placeholder. Give it a provider base URL again and the leak returns
// everywhere at once, which is exactly why there is one place to look.
// oxlint-disable-next-line unused-imports/no-unused-vars
export const getLogoUrlFromDomainName = (
  _domainName?: string,
): string | undefined => undefined;
