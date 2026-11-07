import { EmailLinkService } from './email-link.service';

describe('EmailLinkService', () => {
  it('builds tenant-prefixed path links by default', () => {
    const links = new EmailLinkService(
      'https://app.claspworkspace.com/',
      'path',
    );

    expect(links.build('acme', 'reset-password', { token: 'abc123' })).toBe(
      'https://app.claspworkspace.com/acme/reset-password?token=abc123',
    );
  });

  it('builds subdomain links when the deployment uses subdomains', () => {
    const links = new EmailLinkService(
      'https://app.claspworkspace.com',
      'subdomain',
    );

    expect(links.build('acme', 'login')).toBe(
      'https://acme.app.claspworkspace.com/login',
    );
  });

  it('preserves a non-default port in path mode', () => {
    const links = new EmailLinkService('http://localhost:3000', 'path');

    expect(links.build('beta', 'verify-email', { token: 't' })).toBe(
      'http://localhost:3000/beta/verify-email?token=t',
    );
  });

  it('rejects an invalid workspace slug', () => {
    const links = new EmailLinkService('https://app.example.com', 'path');

    expect(() => links.build('Acme', 'login')).toThrow(
      /Invalid workspace slug/,
    );
    expect(() => links.build('a', 'login')).toThrow(/Invalid workspace slug/);
    expect(() => links.build('../etc', 'login')).toThrow(
      /Invalid workspace slug/,
    );
  });

  it('encodes path tokens exactly once', () => {
    const links = new EmailLinkService('https://app.example.com', 'path');

    const url = links.build('acme', 'invite/a+b=c');

    expect(url).toBe('https://app.example.com/acme/invite/a%2Bb%3Dc');
    expect(url).not.toContain('%252B');
  });

  it('encodes query tokens exactly once', () => {
    const links = new EmailLinkService('https://app.example.com', 'path');

    const url = links.build('acme', 'reset-password', { token: 'a+b/c=d' });

    expect(url).toBe(
      'https://app.example.com/acme/reset-password?token=a%2Bb%2Fc%3Dd',
    );
    expect(url).not.toContain('%252B');
  });
});
