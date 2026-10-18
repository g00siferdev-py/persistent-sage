import assert from "node:assert/strict";
import test from "node:test";
import { prepareAssistantMessage } from "../src/lib/artifacts.ts";

const csvConfig = `\
Use this config.

\`\`\`json
{
  "path": "data/sales.csv",
  "encoding": "utf-8",
  "delimiter": ","
}
\`\`\`
`;

test("a JSON encoding config stays in the reply", () => {
  const prepared = prepareAssistantMessage(csvConfig);
  assert.equal(prepared.artifactJson, undefined);
  assert.match(prepared.content, /utf-8/);
  assert.match(prepared.content, /sales\.csv/);
  assert.match(prepared.content, /delimiter/);
});

test("a layer name and a grade stay in the reply", () => {
  const layer = prepareAssistantMessage('```json\n{"layer": "conv1", "units": 32}\n```');
  assert.equal(layer.artifactJson, undefined);
  assert.match(layer.content, /conv1/);

  const grade = prepareAssistantMessage('```json\n{"student": "Ada", "mark": "A"}\n```');
  assert.equal(grade.artifactJson, undefined);
  assert.match(grade.content, /Ada/);
});

test("a Vega-Lite bar spec in a json fence still becomes a chart", () => {
  const input = `\
Chart:

\`\`\`json
{
  "title": "Sales",
  "data": {"values": [{"day": "Mon", "amount": 3}]},
  "mark": "bar",
  "encoding": {
    "x": {"field": "day", "type": "ordinal"},
    "y": {"field": "amount", "type": "quantitative"}
  }
}
\`\`\`
`;
  const prepared = prepareAssistantMessage(input);
  assert.ok(prepared.artifactJson);
  const artifact = JSON.parse(prepared.artifactJson!) as { type: string; title: string };
  assert.equal(artifact.type, "vegaLite");
  assert.equal(artifact.title, "Sales");
  assert.match(prepared.content, /Chart:/);
  assert.doesNotMatch(prepared.content, /amount/);
});

test("a layered Vega-Lite spec still becomes a chart", () => {
  const input = `\
\`\`\`json
{
  "data": {"values": [{"a": "x", "b": 1}]},
  "layer": [
    {"mark": "bar", "encoding": {"x": {"field": "a"}, "y": {"field": "b"}}}
  ]
}
\`\`\`
`;
  const prepared = prepareAssistantMessage(input);
  assert.ok(prepared.artifactJson);
  const artifact = JSON.parse(prepared.artifactJson!) as { type: string };
  assert.equal(artifact.type, "vegaLite");
});
