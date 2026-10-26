import { runStage1 } from './run-stage1';
import { splitBlockFunctions } from './block-splitter';
import { runPatternCheck } from './pattern-check';
import { stage1ToFindings } from './to-findings';

const AZURE_FUNCTION = `using System;
namespace Shop
{
    public static class ApplyDiscount
    {
        // Deliberate issue: open endpoint
        [FunctionName("ApplyDiscount")]
        public static async Task<IActionResult> Run(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequest req, ILogger log)
        {
            int page = int.Parse(req.Query["page"]);
            var sql = "UPDATE Orders SET Discount = " + req.Query["d"] + " WHERE Id = " + page;
            using (var cmd = new SqlCommand(sql, conn)) { cmd.ExecuteNonQuery(); }
            return new OkResult();
        }

        private static string Helper(string a)
        {
            return a.Trim();
        }
    }
}
`;

describe('Stage 1 for languages without an AST', () => {
  it('splits C# methods by brace matching', () => {
    const units = splitBlockFunctions(AZURE_FUNCTION, 'Functions/ApplyDiscount.cs');
    expect(units.map((u) => [u.name, u.startLine, u.endLine])).toEqual([
      ['Run', 8, 15],
      ['Helper', 17, 20],
    ]);
  });

  it('splits Python functions by indentation', () => {
    const code = 'def a(x):\n    return x\n\nasync def b():\n    if True:\n        pass\n';
    expect(splitBlockFunctions(code, 'app/views.py').map((u) => u.name)).toEqual(['a', 'b']);
  });

  it('gives config files no units, and unsplittable code one whole-file unit', () => {
    expect(splitBlockFunctions('{ "ConnectionStrings": {} }', 'appsettings.json')).toEqual([]);
    expect(splitBlockFunctions('Sub Main()\nEnd Sub\n', 'Module1.vb')).toHaveLength(1);
  });

  it('sends a risky C# endpoint to the AI instead of calling the file clean', async () => {
    const r = await runStage1(AZURE_FUNCTION, 'Functions/ShopApi.cs');
    expect(r.clean).toBe(false);
    expect(r.riskyFunctions.map((x) => x.fn.name)).toEqual(['Run']);
    expect(r.riskyFunctions[0].reasons).toEqual(
      expect.arrayContaining(['HTTP endpoint open to anonymous callers', 'SQL built by string concatenation']),
    );
  });

  it('flags the anonymous endpoint, string-built SQL and unchecked parse as findings without AI', () => {
    const ids = runPatternCheck(AZURE_FUNCTION, 'ApplyDiscount.cs').map((p) => p.ruleId);
    expect(ids).toEqual(
      expect.arrayContaining(['dotnet/anonymous-function', 'sql/string-built-query', 'dotnet/unchecked-parse']),
    );
  });

  it('turns pattern hits into findings', async () => {
    const r = await runStage1(AZURE_FUNCTION, 'ApplyDiscount.cs');
    const titles = stage1ToFindings(r).map((f) => f.title);
    expect(titles).toContain('This endpoint can be called by anyone, with no key or login');
  });

  it('reviews every function in a money- or account-sensitive file', async () => {
    const code = 'public class X\n{\n    public void Apply(int a)\n    {\n        Save(a);\n    }\n}\n';
    const plain = await runStage1(code, 'src/Helpers.cs');
    const sensitive = await runStage1(code, 'src/PasswordReset.cs');
    expect(plain.riskyFunctions).toHaveLength(0);
    expect(sensitive.riskyFunctions.map((x) => x.fn.name)).toEqual(['Apply']);
  });
});
