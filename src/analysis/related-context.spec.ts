import { changedSymbols, relatedContextFor } from './related-context';

const ts = [
  'import { db } from "./db";', // 1
  '', // 2
  'export async function chargeCustomer(id: string, cents: number) {', // 3
  '  const customer = await db.find(id);', // 4
  '  return customer.charge(cents);', // 5
  '}', // 6
  '', // 7
  'export const refundOrder = async (orderId: string) => {', // 8
  '  return db.refund(orderId);', // 9
  '};', // 10
].join('\n');

describe('changedSymbols', () => {
  it('finds functions defined on changed lines and the one a hunk sits inside', () => {
    expect(changedSymbols(ts, [{ start: 5, end: 5 }], 'src/billing.ts')).toEqual(['chargeCustomer']);
    expect(changedSymbols(ts, [{ start: 8, end: 9 }], 'src/billing.ts')).toEqual(['refundOrder', 'chargeCustomer']);
  });

  it('ignores comments, and takes nothing from test files', () => {
    const py = '# this helper would (in theory) run\ndef load(x):\n    return x';
    expect(changedSymbols(py, [{ start: 1, end: 1 }], 'app/load.py')).toEqual([]);
    expect(changedSymbols(ts, [{ start: 5, end: 5 }], 'src/billing.test.ts')).toEqual([]);
    expect(changedSymbols('def _convert(df):\n    pass', [{ start: 2, end: 2 }], 'test/unit/test_convert.py')).toEqual(
      [],
    );
  });

  it.each([
    ['pricing.py', 'def apply_discount(order, pct):\n    return order.total * pct', 'apply_discount'],
    ['store.go', 'func (s *Store) SaveOrder(o Order) error {\n\treturn nil', 'SaveOrder'],
    ['config.rs', 'pub async fn load_config(path: &str) -> Config {\n    todo!()', 'load_config'],
    ['Billing.java', '    public Invoice createInvoice(Order order) {\n        return null;', 'createInvoice'],
    ['UserRepo.kt', '    suspend fun fetchUser(id: String): User {\n        return api.get(id)', 'fetchUser'],
  ])('reads a definition in %s', (path, code, name) => {
    expect(changedSymbols(code, [{ start: 2, end: 2 }], path)).toEqual([name]);
  });
});

describe('relatedContextFor', () => {
  const changed = { path: 'src/billing.ts', content: ts, changedRanges: [{ start: 4, end: 5 }] };
  const repo = [
    changed,
    {
      path: 'src/checkout.ts',
      content:
        'import { chargeCustomer } from "./billing";\n\nawait chargeCustomer(user.id, total);\nconst chargeCustomerLabel = 1;',
    },
    { path: 'src/other.ts', content: 'function chargeCustomer() {}\n// chargeCustomer in a comment' },
    { path: 'docs/billing.md', content: 'Call chargeCustomer to bill.' },
  ];

  it('lists call sites in other files, with paths and line numbers', () => {
    const ctx = relatedContextFor(changed, repo);
    expect(ctx).toContain('`chargeCustomer` is used in:');
    expect(ctx).toContain('src/checkout.ts:3 | await chargeCustomer(user.id, total);');
    expect(ctx).toContain('src/checkout.ts:1 | import { chargeCustomer } from "./billing";');
    // Whole-word only, never the changed file itself, and not other definitions.
    expect(ctx).not.toContain('chargeCustomerLabel');
    expect(ctx).not.toContain('src/billing.ts');
    expect(ctx).not.toContain('src/other.ts');
    expect(ctx).not.toContain('docs/billing.md');
  });

  it('is empty when nothing else uses the change', () => {
    expect(relatedContextFor({ ...changed, changedRanges: [{ start: 9, end: 9 }] }, [changed])).toBe('');
  });
});
