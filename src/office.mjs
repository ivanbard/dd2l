import { Unzip, UnzipInflate } from 'fflate';
import { Parser } from 'htmlparser2';

export function officeText(bytes) {
  const entries = new Map();
  let total = 0;
  let count = 0;
  const wanted = /^(?:word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml|ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml|xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml)$/;
  const unzip = new Unzip(file => {
    if (++count > 2000) throw new Error('Office archive entry limit exceeded.');
    if (!wanted.test(file.name)) return;
    if (file.originalSize > 20 * 1024 * 1024) throw new Error('Office document expansion limit exceeded.');
    const parts = [];
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      total += chunk.length;
      if (total > 20 * 1024 * 1024) { file.terminate(); throw new Error('Office document expansion limit exceeded.'); }
      parts.push(chunk);
      if (final) entries.set(file.name, Buffer.concat(parts).toString('utf8'));
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 4096) unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
  if (!entries.size) throw new Error('No supported Word, PowerPoint or Excel content was found.');
  const xmlText = xml => {
    const parts = []; let inText = false;
    const parser = new Parser({ onopentag(name) { if (/(?:^|:)t$/.test(name)) inText = true; },
      ontext(text) { if (inText) parts.push(text); }, onclosetag(name) {
        if (/(?:^|:)t$/.test(name)) inText = false;
        if (/(?:^|:)(?:p|tr)$/.test(name)) parts.push('\n');
      } }, { xmlMode: true, decodeEntities: true });
    parser.end(xml); return parts.join('').trim();
  };
  const shared = [];
  if (entries.has('xl/sharedStrings.xml')) {
    let collecting = false; let value = '';
    const parser = new Parser({ onopentag(name) { if (name === 'si') { collecting = true; value = ''; } },
      ontext(text) { if (collecting) value += text; }, onclosetag(name) { if (name === 'si') { shared.push(value); collecting = false; } } }, { xmlMode: true, decodeEntities: true });
    parser.end(entries.get('xl/sharedStrings.xml'));
  }
  const sections = [];
  for (const [name, xml] of [...entries].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
    if (name === 'xl/sharedStrings.xml') continue;
    if (name.startsWith('xl/worksheets/')) {
      const rows = []; let type, cell = '', value = false;
      const parser = new Parser({ onopentag(tag, attrs) {
        if (tag === 'c') { type = attrs.t; cell = ''; }
        if (tag === 'v' || tag === 't') value = true;
      }, ontext(text) { if (value) cell += text; }, onclosetag(tag) {
        if (tag === 'v' || tag === 't') value = false;
        if (tag === 'c') rows.push(type === 's' ? shared[Number(cell)] ?? '' : cell);
        if (tag === 'row') rows.push('\n');
      } }, { xmlMode: true, decodeEntities: true });
      parser.end(xml); sections.push(rows.join('\t').replace(/\t*\n\t*/g, '\n'));
    } else sections.push(xmlText(xml));
  }
  const text = sections.filter(Boolean).join('\n\n');
  return { text: text.slice(0, 1_000_000), truncated: text.length > 1_000_000,
    format: [...entries.keys()].some(key => key.startsWith('ppt/')) ? 'pptx' : [...entries.keys()].some(key => key.startsWith('word/')) ? 'docx' : 'xlsx' };
}
