import { classifyLicense, looksProprietary } from './license-audit';

describe('classifyLicense', () => {
  it('flags AGPL and plain GPL as high risk', () => {
    expect(classifyLicense('AGPL-3.0')?.riskLevel).toBe('high');
    expect(classifyLicense('GPL-3.0-only')?.riskLevel).toBe('high');
    expect(classifyLicense('GPL-2.0')?.riskLevel).toBe('high');
  });

  it('does not mistake LGPL for GPL', () => {
    expect(classifyLicense('LGPL-3.0-only')?.riskLevel).toBe('medium');
  });

  it('flags SSPL as high risk and weak-copyleft licenses as medium', () => {
    expect(classifyLicense('SSPL-1.0')?.riskLevel).toBe('high');
    expect(classifyLicense('MPL-2.0')?.riskLevel).toBe('medium');
    expect(classifyLicense('EPL-2.0')?.riskLevel).toBe('medium');
  });

  it('flags a missing or non-standard license as low risk', () => {
    expect(classifyLicense(undefined)?.riskLevel).toBe('low');
    expect(classifyLicense('UNKNOWN')?.riskLevel).toBe('low');
    expect(classifyLicense('SEE LICENSE IN LICENSE.md')?.riskLevel).toBe('low');
  });

  it('raises no finding for permissive or unrecognized licenses', () => {
    expect(classifyLicense('MIT')).toBeNull();
    expect(classifyLicense('Apache-2.0')).toBeNull();
    expect(classifyLicense('BSD-3-Clause')).toBeNull();
    expect(classifyLicense('ISC')).toBeNull();
  });
});

describe('looksProprietary', () => {
  it('treats a private package as proprietary regardless of license field', () => {
    expect(looksProprietary(JSON.stringify({ private: true, license: 'MIT' }))).toBe(true);
  });

  it('treats a missing license field as proprietary', () => {
    expect(looksProprietary(JSON.stringify({ name: 'app' }))).toBe(true);
  });

  it('treats UNLICENSED as proprietary', () => {
    expect(looksProprietary(JSON.stringify({ license: 'UNLICENSED' }))).toBe(true);
  });

  it('does not treat a declared OSS license as proprietary', () => {
    expect(looksProprietary(JSON.stringify({ license: 'MIT' }))).toBe(false);
    expect(looksProprietary(JSON.stringify({ license: 'GPL-3.0' }))).toBe(false);
  });

  it('does not guess on unparseable package.json content', () => {
    expect(looksProprietary('{not valid json')).toBe(false);
  });
});
