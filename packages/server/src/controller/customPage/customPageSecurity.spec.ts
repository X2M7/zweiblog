import { getCustomPageCsp, setCustomPageSecurityHeaders } from './customPageSecurity';

function parseCsp(value: string): Record<string, string[]> {
  return Object.fromEntries(
    value.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources];
    }),
  );
}

describe('custom page security policy', () => {
  it('keeps isolated pages opaque and blocks every plugin object', () => {
    const directives = parseCsp(getCustomPageCsp('isolated'));

    expect(directives.sandbox).toEqual([
      'allow-scripts',
      'allow-forms',
      'allow-modals',
      'allow-popups',
      'allow-popups-to-escape-sandbox',
      'allow-downloads',
    ]);
    expect(directives.sandbox).not.toContain('allow-same-origin');
    expect(directives.sandbox).not.toContain('allow-top-navigation-by-user-activation');
    expect(directives['object-src']).toEqual(["'none'"]);
  });

  it('gives trusted static apps user-activated navigation and common resource types', () => {
    const directives = parseCsp(getCustomPageCsp('trusted'));

    expect(directives.sandbox).toContain('allow-same-origin');
    expect(directives.sandbox).toContain('allow-top-navigation-by-user-activation');
    expect(directives.sandbox).not.toContain('allow-top-navigation');
    expect(directives['worker-src']).toEqual([
      "'self'",
      'https:',
      'http:',
      'blob:',
      'data:',
    ]);
    expect(directives['frame-src']).toEqual(["'self'", 'https:', 'http:', 'data:', 'blob:']);
    expect(directives['media-src']).toEqual(["'self'", 'https:', 'http:', 'data:', 'blob:']);
  });

  it('allows trusted pages to embed only same-origin PDF objects', () => {
    const directives = parseCsp(getCustomPageCsp('trusted'));

    expect(directives['object-src']).toEqual(["'self'"]);
    expect(directives['object-src']).not.toEqual(
      expect.arrayContaining(['https:', 'http:', 'data:', 'blob:', '*']),
    );
  });

  it('treats a missing or unknown mode as isolated', () => {
    expect(getCustomPageCsp(undefined)).toBe(getCustomPageCsp('isolated'));
    expect(getCustomPageCsp('unrestricted')).toBe(getCustomPageCsp('isolated'));
  });

  it('sets the CSP together with the existing response hardening headers', () => {
    const setHeader = jest.fn();

    setCustomPageSecurityHeaders({ setHeader }, 'trusted');

    expect(setHeader).toHaveBeenCalledWith('Content-Security-Policy', getCustomPageCsp('trusted'));
    expect(setHeader).toHaveBeenCalledWith('Referrer-Policy', 'same-origin');
    expect(setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
  });
});
