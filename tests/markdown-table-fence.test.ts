import assert from "node:assert/strict";
import test from "node:test";
import { extractMarkdownTable } from "../src/lib/markdownTable.ts";

test("a markdown table inside a code fence stays in the sample", () => {
  const input = [
    "Paste this README snippet:",
    "",
    "```markdown",
    "| Method | Path |",
    "| --- | --- |",
    "| GET | /health |",
    "```",
    "",
    "That is the whole example.",
  ].join("\n");
  assert.equal(extractMarkdownTable(input), null);
});

test("a markdown table inside a python string stays in the sample", () => {
  const input = [
    "```python",
    "def render():",
    '    return """',
    "| Name | Qty |",
    "| --- | --- |",
    "| Apples | 3 |",
    '    """',
    "```",
  ].join("\n");
  assert.equal(extractMarkdownTable(input), null);
});

test("a table outside a fence is promoted and a later fenced sample is kept", () => {
  const input = [
    "Schedule",
    "",
    "| Time | Event |",
    "| --- | --- |",
    "| 9:00 | Standup |",
    "",
    "```python",
    'print("""',
    "| Name | Qty |",
    "| --- | --- |",
    "| Apples | 3 |",
    '""")',
    "```",
  ].join("\n");
  const table = extractMarkdownTable(input);
  assert.ok(table);
  assert.deepEqual(table.rows, [
    ["Time", "Event"],
    ["9:00", "Standup"],
  ]);
  assert.match(table.after, /\| Apples \| 3 \|/);
  assert.match(table.after, /print\(/);
  assert.doesNotMatch(table.before, /Standup/);
});

test("an unclosed fence does not promote the sample table", () => {
  const input = [
    "```markdown",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "The fence never closed, so this stays in the reply.",
  ].join("\n");
  assert.equal(extractMarkdownTable(input), null);
});

test("a longer fence is not closed by an inner backtick line", () => {
  const input = ["````md", "```", "| A | B |", "| --- | --- |", "| 1 | 2 |", "````"].join("\n");
  assert.equal(extractMarkdownTable(input), null);
});

test("a tilde fence also keeps the sample table", () => {
  const input = ["~~~markdown", "| A | B |", "| --- | --- |", "| 1 | 2 |", "~~~"].join("\n");
  assert.equal(extractMarkdownTable(input), null);
});
