import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { createCanvas } from '@napi-rs/canvas';
import { officeText } from '../src/office.mjs';
import { readDocument, htmlContent } from '../src/documents.mjs';
import { linkedResponse, readLinkedDocument, actionLink } from '../src/links.mjs';
import { reconcileQuizzes, batch, courseNodes } from '../src/discovery.mjs';
import { collectSyllabus } from '../src/syllabus.mjs';
import { youtubeTranscript } from '../src/media.mjs';

const origin = 'https://onq.queensu.ca';

test('modern Office extraction reads Word paragraphs, PowerPoint notes/slides and Excel shared strings/numbers', () => {
  const fixtures = [
    [{ 'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>Course &amp; policies</w:t></w:r></w:p></w:document>') }, 'docx', /Course & policies/],
    [{ 'ppt/slides/slide1.xml': strToU8('<a:p><a:r><a:t>Learning outcomes</a:t></a:r></a:p>'), 'ppt/notesSlides/notesSlide1.xml': strToU8('<a:p><a:r><a:t>Speaker notes</a:t></a:r></a:p>') }, 'pptx', /Speaker notes[\s\S]*Learning outcomes/],
    [{ 'xl/sharedStrings.xml': strToU8('<sst><si><t>Labs</t></si></sst>'), 'xl/worksheets/sheet1.xml': strToU8('<worksheet><row><c t="s"><v>0</v></c><c><v>20</v></c></row></worksheet>') }, 'xlsx', /Labs\s+20/],
  ];
  for (const [entries, format, expected] of fixtures) {
    const parsed = officeText(zipSync(entries));
    assert.equal(parsed.format, format); assert.match(parsed.text, expected);
  }
  assert.throws(() => officeText(zipSync({ 'word/document.xml': new Uint8Array(21 * 1024 * 1024) })), /limit/);
});

test('school cookies accompany approved content paths only, and redirects to private providers are blocked', async () => {
  const seen = [];
  const client = { origin, session: { load: async () => ({ cookies: [{ name: 'session', value: 'secret', domain: 'onq.queensu.ca', path: '/', expires: -1 }] }) },
    fetch: async (url, options) => { seen.push({ host: new URL(url).host, headers: options.headers }); return new Response('Policy'); } };
  await linkedResponse(client, `${origin}/content/static/Policy.html`);
  await linkedResponse(client, 'https://www.queensu.ca/policy');
  assert.equal(seen[0].headers.cookie, 'session=secret');
  assert.equal(seen[1].headers.cookie, undefined);
  assert.equal(seen[1].headers.authorization, undefined);
  await assert.rejects(linkedResponse(client, 'https://127.0.0.1/secret'), { code: 'external_auth_required' });
  client.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
  await assert.rejects(linkedResponse(client, `${origin}/content/static/Policy.html`), { code: 'external_auth_required' });
  assert.equal(actionLink(`${origin}/d2l/common/dialogs/quickLink/quickLink.d2l?type=groupTypeSelfEnrollment`, origin), true);
});

test('linked content cannot bypass a hidden parent module', async () => {
  const client = { origin, get: async () => { throw Error('Hidden source must not be fetched'); } };
  await assert.rejects(readLinkedDocument(client, `${origin}/d2l/le/content/42/viewContent/2/View`, {
    courseId: '42', le: '/d2l/api/le/1.100/42', tree: { Modules: [{ IsHidden: true, Topics: [{ TopicId: 2 }] }] },
  }), { code: 'restricted' });
});

test('inline school documents are followed once; survey actions are never activated', async () => {
  let reads = 0;
  const client = { origin, session: { load: async () => ({ cookies: [] }) }, fetch: async () => { reads++; return new Response('<p>Academic policy</p>', { headers: { 'content-type': 'text/html' } }); } };
  const result = await collectSyllabus(client, { courseId: '42', le: '/d2l/api/le/1.100/42', overview: { outcome: 'not_configured', complete: true },
    content: { complete: true, data: { Modules: [{ ModuleId: 1, Title: 'Syllabus', Description: { Html: '<a href="/content/static/policy.html">Policy</a><a href="/content/static/policy.html">Again</a><a href="/d2l/common/dialogs/quickLink/quickLink.d2l?type=survey">Survey</a>' } }] } } });
  assert.equal(reads, 1);
  assert.equal(result.summary.unreadLinkCount, 0);
  assert.equal(result.summary.textCoverageComplete, true);
});

test('quiz reconciliation joins by real IDs and retains grade-only candidates without inventing quizzes', () => {
  const tree = { Topics: [{ TopicId: 1, ActivityType: 4, ToolItemId: 20, GradeItemId: 30 }, { TopicId: 2, ActivityType: 4, Title: 'Quiz link' }] };
  const result = reconcileQuizzes([{ QuizId: 20, Name: 'Quiz', GradeItemId: 30 }], tree,
    [{ GradeObjectIdentifier: 30, GradeObjectName: 'Quiz 1' }, { GradeObjectIdentifier: 31, GradeObjectName: 'Quiz 2' }], origin);
  assert.equal(result.quizzes.length, 1);
  assert.deepEqual(result.quizzes[0].sources, ['quiz_list', 'content', 'gradebook']);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every(item => !item.quizId));
  assert.equal(courseNodes({ Modules: [{ IsLocked: true, Topics: [{ TopicId: 2 }] }] }).at(-1).restricted, true);
});

test('bounded traversal covers every item across resume windows and recovers changed collections', () => {
  const items = Array.from({ length: 63 }, (_, i) => i);
  const a = batch(items, 0), b = batch(items, a.next), c = batch(items, b.next);
  assert.deepEqual([...a.items, ...b.items, ...c.items], items);
  assert.equal(c.next, 0);
  assert.equal(batch([1, 2], 50).start, 0);
});

test('YouTube captions preserve timestamps without sending school credentials or executing page scripts', async () => {
  const seen = [];
  const client = { origin, fetch: async (url, options) => {
    seen.push(options.headers);
    if (new URL(url).pathname === '/watch') return new Response('<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"languageCode":"en","baseUrl":"https://www.youtube.com/api/timedtext?v=abcdefghijk"}]}}};</script>', { headers: { 'content-type': 'text/html' } });
    return Response.json({ events: [{ tStartMs: 1250, dDurationMs: 2000, segs: [{ utf8: 'Course syllabus' }] }] });
  } };
  const value = await youtubeTranscript(client, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(value.segments[0].startMilliseconds, 1250);
  assert.match(value.text, /Course syllabus/);
  assert.ok(seen.every(headers => !headers.cookie && !headers.authorization));
});

test('Windows OCR recovers a local course-information image without an external OCR service', { skip: process.platform !== 'win32' }, async () => {
  const canvas = createCanvas(4000, 800), context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, 4000, 800); context.fillStyle = 'black'; context.font = '60px Arial';
  context.fillText('Course Syllabus', 40, 90); context.fillText('Assignments due Friday', 40, 170);
  const value = await readDocument({ response: async () => new Response(canvas.toBuffer('image/png'), { headers: { 'content-type': 'image/png' } }) }, '/scan');
  assert.equal(value.textStatus, 'available', value.textError);
  assert.match(value.text, /Friday/i); assert.equal(value.needsReview, true);
});

test('scanned PDF pages flow through bounded rendering and local OCR', { skip: process.platform !== 'win32' }, async () => {
  const canvas = createCanvas(1200, 400), context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, 1200, 400); context.fillStyle = 'black'; context.font = '52px Arial';
  context.fillText('Course Syllabus', 40, 110); context.fillText('Assignments due Friday', 40, 210);
  const image = canvas.toBuffer('image/jpeg');
  const commands = Buffer.from('q 600 0 0 200 0 0 cm /Scan Do Q');
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1200 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Length ${commands.length} >>\nstream\n`), commands, Buffer.from('\nendstream')])];
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.concat(chunks).length); chunks.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')); }
  const xref = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF`));
  const value = await readDocument({ response: async () => new Response(Buffer.concat(chunks), { headers: { 'content-type': 'application/pdf' } }) }, '/scan.pdf');
  assert.equal(value.textStatus, 'available', value.textError);
  assert.match(value.text, /Friday/i); assert.equal(value.ocrPages, 1); assert.equal(value.needsReview, true);
});

test('larger source documents extract text without retaining a large base64 copy', async () => {
  const bytes = Buffer.from('Course policy '.repeat(200_000));
  const value = await readDocument({ response: async () => new Response(bytes, { headers: { 'content-type': 'text/plain' } }) }, '/policy');
  assert.equal(value.bytesRetained, false); assert.equal(value.base64, undefined);
  assert.equal(value.textStatus, 'partial'); assert.equal(value.text.length, 1_000_000);
});

test('HTML extraction focuses on main content and rejects pathological element counts', () => {
  const value = htmlContent('<nav>Navigation</nav><main><h1>Course policy</h1><a href="/policy.pdf">Download</a></main><footer>Footer</footer>');
  assert.match(value.text, /Course policy/); assert.doesNotMatch(value.text, /Navigation|Footer/);
  assert.throws(() => htmlContent('<i></i>'.repeat(100_001)), { code: 'partial' });
});
