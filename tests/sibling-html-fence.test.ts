import assert from "node:assert/strict";
import test from "node:test";
import { prepareAssistantMessage } from "../src/lib/artifacts.ts";

const reportHtml =
  "<!DOCTYPE html><html><body><h1>Q3</h1><table><tr><td>Sales</td></tr></table></body></html>";

const reportArtifact = JSON.stringify({
  type: "html",
  title: "Q3 report",
  body: reportHtml,
});

const chartArtifact = JSON.stringify({
  type: "vegaLite",
  title: "Chart",
  body: {
    mark: "bar",
    encoding: { x: { field: "year", type: "ordinal" } },
    data: { values: [{ year: "2024" }] },
  },
});

const replyWithButton = [
  "The report is above.",
  "",
  "```html",
  '<button type="button">Save</button>',
  "```",
  "",
  "Paste that into the site template.",
].join("\n");

test("a later HTML sample stays visible after an HTML artifact is stored", () => {
  const prepared = prepareAssistantMessage(replyWithButton, reportArtifact);
  assert.equal(prepared.artifactJson, reportArtifact);
  assert.match(prepared.content, /<button type="button">Save<\/button>/);
  assert.match(prepared.content, /Paste that into the site template/);
  assert.match(prepared.content, /The report is above/);
});

test("a later XML sample stays visible after a chart artifact is stored", () => {
  const reply = [
    "Chart is ready.",
    "",
    "```xml",
    "<dependency>",
    "  <groupId>com.example</groupId>",
    "</dependency>",
    "```",
  ].join("\n");
  const prepared = prepareAssistantMessage(reply, chartArtifact);
  assert.equal(prepared.artifactJson, chartArtifact);
  assert.match(prepared.content, /com\.example/);
  assert.match(prepared.content, /Chart is ready/);
});

test("other code fences stay in the reply", () => {
  const reply = "Run this:\n\n```bash\nnpm test\n```";
  const prepared = prepareAssistantMessage(reply, reportArtifact);
  assert.match(prepared.content, /npm test/);
});

test("a leftover copy of the stored HTML artifact is not shown twice", () => {
  const reply = ["```html", reportHtml, "```"].join("\n");
  const prepared = prepareAssistantMessage(reply, reportArtifact);
  assert.equal(prepared.artifactJson, reportArtifact);
  assert.equal(prepared.content, "Q3 report");
  assert.doesNotMatch(prepared.content, /<table>/);
});
