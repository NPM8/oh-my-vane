/* Live integration checks, run inside the Vane container. No stored credentials. */
const assert = require('node:assert/strict');
const OpenAI = require('openai');
const { z } = require('zod');
const { zodResponseFormat } = require('openai/helpers/zod');

(async () => {
  const client = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60000,
    maxRetries: 0,
  });
  const report = { endpoint: process.env.OPENAI_BASE_URL, tests: {} };
  const models = await client.models.list();
  assert(models.data.some((m) => m.id === 'bonsai-2-27b'));
  report.tests.discovery = models.data.map((m) => m.id);

  const chat = await client.chat.completions.create({
    model: 'bonsai-2-27b',
    messages: [{ role: 'user', content: 'Reply with exactly VANE_BONSAI_OK.' }],
    temperature: 1,
    max_completion_tokens: 512,
  });
  assert.equal(chat.choices[0].message.content.trim(), 'VANE_BONSAI_OK');
  report.tests.chat = chat.choices[0].message.content;

  const stream = await client.chat.completions.create({
    model: 'bonsai-2-27b',
    messages: [{ role: 'user', content: 'Reply with exactly VANE_STREAM_OK.' }],
    temperature: 1,
    max_completion_tokens: 512,
    stream: true,
  });
  let text = '';
  for await (const chunk of stream) text += chunk.choices?.[0]?.delta?.content || '';
  assert.equal(text.trim(), 'VANE_STREAM_OK');
  report.tests.streaming = text;

  const schema = z.object({ status: z.literal('ok'), model: z.literal('bonsai-2-27b') });
  const structured = await client.chat.completions.parse({
    model: 'bonsai-2-27b',
    messages: [{ role: 'user', content: 'Return the JSON object with status ok and model bonsai-2-27b.' }],
    response_format: zodResponseFormat(schema, 'object'),
    temperature: 1,
    max_completion_tokens: 1024,
  });
  assert.equal(structured.choices[0].message.parsed.status, 'ok');
  report.tests.structured = structured.choices[0].message.parsed;

  const tool = await client.chat.completions.create({
    model: 'bonsai-2-27b',
    messages: [{ role: 'user', content: 'Use the echo_marker tool with marker VANE_TOOL_OK.' }],
    tools: [{ type: 'function', function: {
      name: 'echo_marker',
      description: 'Echo a marker for an integration test.',
      parameters: { type: 'object', properties: { marker: { type: 'string' } }, required: ['marker'], additionalProperties: false },
    } }],
    temperature: 1,
    max_completion_tokens: 1024,
  });
  const call = tool.choices[0].message.tool_calls?.[0];
  assert.equal(call?.function.name, 'echo_marker');
  assert.equal(JSON.parse(call.function.arguments).marker, 'VANE_TOOL_OK');
  report.tests.tool_call = { name: call.function.name, arguments: JSON.parse(call.function.arguments) };

  const response = await fetch('http://searxng-core:8091/search?q=Bonsai%20PrismML&format=json', {
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok);
  const search = await response.json();
  assert(search.results.length > 0);
  report.tests.searxng = { http_status: response.status, result_count: search.results.length };
  report.passed = true;
  report.authenticated_ui_tested = false;
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
