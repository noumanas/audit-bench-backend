import { detectFramework } from './framework-detector';

const f = (path: string, content = '') => ({ path, content });
const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

describe('detectFramework', () => {
  it('reads the root package.json', () => {
    expect(detectFramework([f('package.json', pkg({ next: '15' }))])).toBe('Next.js');
  });

  it('finds a package.json in a subfolder or monorepo, shallowest first', () => {
    expect(detectFramework([f('web/package.json', pkg({ react: '19' }))])).toBe('React');
    expect(
      detectFramework([
        f('packages/api/tools/package.json', pkg({ express: '4' })),
        f('packages/api/package.json', pkg({ '@nestjs/core': '11' })),
      ]),
    ).toBe('NestJS');
  });

  it('prefers the root package.json, but looks further when it names no framework', () => {
    expect(detectFramework([f('package.json', pkg({ vue: '3' })), f('app/package.json', pkg({ next: '15' }))])).toBe(
      'Vue',
    );
    expect(detectFramework([f('package.json', pkg({ lodash: '4' })), f('app/package.json', pkg({ next: '15' }))])).toBe(
      'Next.js',
    );
  });

  it('accepts Windows paths for every check', () => {
    expect(detectFramework([f('web\\package.json', pkg({ next: '15' }))])).toBe('Next.js');
    expect(detectFramework([f('svc\\go.mod', 'module x')])).toBe('Go');
  });

  it('recognises FastAPI declared in pyproject.toml', () => {
    expect(detectFramework([f('pyproject.toml', '[project]\ndependencies = ["fastapi>=0.110"]')])).toBe('FastAPI');
    expect(detectFramework([f('pyproject.toml', '[project]\nname = "x"')])).toBe('Python');
  });

  it('ignores a package.json that is not valid JSON', () => {
    expect(detectFramework([f('package.json', '{ nope'), f('go.mod', 'module x')])).toBe('Go');
  });
});
