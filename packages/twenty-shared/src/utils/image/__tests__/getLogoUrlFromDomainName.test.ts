import {
  getLogoUrlFromDomainName,
  sanitizeURL,
} from '@/utils/image/getLogoUrlFromDomainName';

describe('sanitizeURL', () => {
  test('should sanitize the URL correctly', () => {
    expect(sanitizeURL('http://example.com/')).toBe('example.com');
    expect(sanitizeURL('https://www.example.com/')).toBe('example.com');
    expect(sanitizeURL('www.example.com')).toBe('example.com');
    expect(sanitizeURL('example.com')).toBe('example.com');
    expect(sanitizeURL('example.com/')).toBe('example.com');
  });

  test('should handle undefined input', () => {
    expect(sanitizeURL(undefined)).toBe('');
  });
});

// AOS-CRM CRM-019 (R2): no company-icon provider. Every caller must get
// undefined, whatever shape the domain arrives in, so none of them can send a
// user's domain to a third party.
describe('getLogoUrlFromDomainName', () => {
  test.each([
    'example.com',
    'http://example.com/',
    'https://www.example.com/',
    'www.example.com',
    'example.com/',
    'apple.com',
    'https://www.snowww.io',
    '',
  ])('returns no provider URL for %p', (domain) => {
    expect(getLogoUrlFromDomainName(domain)).toBeUndefined();
  });

  test('should handle undefined input', () => {
    expect(getLogoUrlFromDomainName(undefined)).toBe(undefined);
  });
});
