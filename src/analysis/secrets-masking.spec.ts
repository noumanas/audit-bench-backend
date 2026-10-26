import { maskSecret, scanSecrets, uniqueSecretCount } from './secrets-scanner';

describe('secret masking', () => {
  it('keeps only the start and end of a found secret', () => {
    const [f] = scanSecrets([{ path: 'config.ts', content: 'const key = "AKIAABCDEFGHIJKLMN7Q";' }]);
    expect(f.rule).toBe('AWS Access Key');
    expect(f.snippet).toBe('const key = "AKIA…7Q";');
    expect(f.snippet).not.toContain('AKIAABCDEFGHIJKLMN7Q');
  });

  it('hides short secrets entirely', () => {
    expect(maskSecret('pw = "abc123"', 'abc123')).toBe('pw = "…"');
  });
});

describe('secret grouping and config files', () => {
  it('gives the same key in two files the same fingerprint', () => {
    // Built at runtime so the test file never contains a token-shaped string (GitHub push protection blocks those).
    const fakeShopifyToken = (hex: string) => ['shp', 'at_', hex].join('');
    const key = fakeShopifyToken('0123456789abcdef0123456789abcdef');
    const found = scanSecrets([
      { path: 'a.cs', content: `var token = "${key}";` },
      { path: 'b.cs', content: `client.Token = "${key}";` },
      { path: 'c.cs', content: `var token = "${fakeShopifyToken('f'.repeat(32))}";` },
    ]);
    expect(found.map((f) => f.rule)).toEqual(['Shopify Access Token', 'Shopify Access Token', 'Shopify Access Token']);
    expect(found[0].fingerprint).toBe(found[1].fingerprint);
    expect(found[2].fingerprint).not.toBe(found[0].fingerprint);
    expect(uniqueSecretCount(found)).toBe(2);
  });

  it('finds passwords in appsettings.json connection strings, but not placeholders', () => {
    const found = scanSecrets([
      {
        path: 'appsettings.json',
        content: [
          '"Default": "Server=tcp:db.example.net;Database=shop;User Id=app;Password=S3cr3t!Pass;"',
          '"Local": "Server=.;Database=shop;Password=${DB_PASSWORD};"',
          '"ClientSecret": "<set in Key Vault>"',
        ].join('\n'),
      },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe('Database Connection String Password');
    expect(found[0].snippet).not.toContain('S3cr3t!Pass');
  });
});
