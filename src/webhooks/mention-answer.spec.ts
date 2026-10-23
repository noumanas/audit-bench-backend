import {
  ANSWER_MARKER,
  buildMentionPrompt,
  excerpt,
  formatConversationReply,
  formatThreadAnswer,
  placeAnswer,
} from './mention-answer';

const files = [
  {
    path: 'src/orders.ts',
    content: [
      'import { db } from "./db";',
      '',
      'export async function getOrder(id: string) {',
      '  return db.query(`SELECT * FROM orders WHERE id = ${id}`);',
      '}',
    ].join('\n'),
    changedRanges: [{ start: 3, end: 5 }],
  },
];

describe('answering @auditbench in a pull request conversation', () => {
  it('shows the AI the changed code with real line numbers', () => {
    const prompt = buildMentionPrompt('@auditbench is getOrder safe?', files, '@auditbench');
    expect(prompt).toContain('--- src/orders.ts ---');
    expect(prompt).toContain('4+|   return db.query(`SELECT * FROM orders WHERE id = ${id}`);');
    expect(prompt).toContain('1 | import { db } from "./db";');
    expect(prompt).toContain('is getOrder safe?');
    expect(prompt).not.toContain('@auditbench is');
  });

  it('anchors the answer only on changed lines GitHub can comment on', () => {
    expect(placeAnswer({ path: 'src/orders.ts', line: 4, endLine: 9 }, files)).toEqual({
      path: 'src/orders.ts',
      start: 4,
      end: 5,
    });
    expect(placeAnswer({ path: 'src/orders.ts', line: 1 }, files)).toBeNull();
    expect(placeAnswer({ path: 'src/other.ts', line: 4 }, files)).toBeNull();
    expect(placeAnswer(null, files)).toBeNull();
  });

  it('opens a thread on the code and points the conversation at it, with the code shown', () => {
    const spot = { path: 'src/orders.ts', start: 4, end: 4 };
    const thread = formatThreadAnswer('Use a parameter.', {
      author: 'dev1',
      question: '@auditbench is getOrder safe?',
    });
    expect(thread.startsWith(ANSWER_MARKER)).toBe(true);
    expect(thread).toContain('@dev1 asked in the conversation:\n> @auditbench is getOrder safe?');

    const reply = formatConversationReply('Use a parameter.', {
      author: 'dev1',
      question: '@auditbench is getOrder safe?',
      spot,
      code: excerpt(files[0].content, spot),
      threadUrl: 'https://github.com/acme/api/pull/7#discussion_r1',
    });
    expect(reply).toContain(
      '@dev1 I answered on the code itself: [`src/orders.ts:4`](https://github.com/acme/api/pull/7#discussion_r1)',
    );
    expect(reply).toContain('```ts\n  return db.query(`SELECT * FROM orders WHERE id = ${id}`);\n```');
  });

  it('answers in the conversation alone when the question is about the whole PR', () => {
    const reply = formatConversationReply('Looks fine overall.', { author: 'dev1', question: 'summary?' });
    expect(reply).toContain('> summary?');
    expect(reply).toContain('@dev1 Looks fine overall.');
    expect(reply).not.toContain('answered on the code');
  });
});
