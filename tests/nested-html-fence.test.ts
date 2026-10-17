import assert from "node:assert/strict";
import test from "node:test";
import { prepareAssistantMessage } from "../src/lib/artifacts.ts";

const nestedPython = `\
\`\`\`python
page = """
\`\`\`html
<table>
<tr><td>Ada</td></tr>
</table>
\`\`\`
"""
print(page)
\`\`\`
`;

test("nested html fence inside a python sample stays in the reply", () => {
  const prepared = prepareAssistantMessage(nestedPython);
  assert.equal(prepared.artifactJson, undefined);
  assert.match(prepared.content, /<td>Ada<\/td>/);
  assert.match(prepared.content, /print\(page\)/);
});

test("html fence after a closed python fence still becomes an artifact", () => {
  const input = `\
\`\`\`python
print("hi")
\`\`\`

\`\`\`html
<table><tr><td>Ada</td></tr></table>
\`\`\`
`;
  const prepared = prepareAssistantMessage(input);
  assert.ok(prepared.artifactJson);
  assert.match(prepared.content, /print\("hi"\)/);
  assert.doesNotMatch(prepared.content, /<td>Ada<\/td>/);
});

test("tilde fence protects an inner html fence", () => {
  const input = `\
~~~markdown
\`\`\`html
<table><tr><td>Ada</td></tr></table>
\`\`\`
~~~
`;
  const prepared = prepareAssistantMessage(input);
  assert.equal(prepared.artifactJson, undefined);
  assert.match(prepared.content, /<td>Ada<\/td>/);
});

test("a longer fence is not closed by an inner backtick line", () => {
  const input = `\
\`\`\`\`
\`\`\`html
<table><tr><td>Ada</td></tr></table>
\`\`\`
\`\`\`\`
`;
  const prepared = prepareAssistantMessage(input);
  assert.equal(prepared.artifactJson, undefined);
  assert.match(prepared.content, /<td>Ada<\/td>/);
});
