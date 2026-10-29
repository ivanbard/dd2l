import { AccessError } from './client.mjs';
import { linkedResponse } from './links.mjs';
import { readDocument, htmlContent } from './documents.mjs';

export function youtubeId(target) {
  try {
    const url = new URL(target);
    if (!['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtu.be'].includes(url.hostname)) return null;
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

function playerData(html) {
  const marker = /(?:ytInitialPlayerResponse\s*=|["']ytInitialPlayerResponse["']\s*:)\s*\{/g;
  for (const match of html.matchAll(marker)) {
    const start = match.index + match[0].lastIndexOf('{');
    let depth = 0, quoted = false, escape = false;
    for (let i = start; i < html.length; i++) {
      const char = html[i];
      if (quoted) { if (escape) escape = false; else if (char === '\\') escape = true; else if (char === '"') quoted = false; }
      else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { break; } }
    }
  }
  return null;
}

export async function youtubeTranscript(client, target) {
  const id = youtubeId(target);
  if (!id) throw new AccessError('unsupported_link', 'Unsupported video URL.');
  const document = await readDocument({ response: path => linkedResponse(client, path) }, `https://www.youtube.com/watch?v=${id}`);
  if (!document.base64) throw new AccessError('partial', 'Video metadata exceeds the 2 MiB transcript-parser limit.');
  const data = playerData(Buffer.from(document.base64, 'base64').toString('utf8'));
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new AccessError('transcript_unavailable', 'No public caption track was returned; the video may need provider sign-in or may have no captions.');
  const track = tracks.find(item => item.languageCode === 'en' && item.kind !== 'asr') || tracks.find(item => item.languageCode === 'en') || tracks[0];
  const url = new URL(track.baseUrl);
  if (!['www.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname) || url.pathname !== '/api/timedtext') throw new AccessError('invalid_link', 'Caption track target is not an approved YouTube transcript endpoint.');
  url.searchParams.set('fmt', 'json3');
  const response = await readDocument({ response: path => linkedResponse(client, path) }, url.href);
  if (!response.base64) throw new AccessError('partial', 'Caption metadata exceeds the 2 MiB transcript-parser limit.');
  let captions;
  try { captions = JSON.parse(Buffer.from(response.base64, 'base64').toString('utf8')); }
  catch { throw new AccessError('transcript_unavailable', 'Caption service did not return readable transcript data.'); }
  const segments = (captions.events || []).filter(event => event.segs).map(event => ({
    startMilliseconds: event.tStartMs, durationMilliseconds: event.dDurationMs,
    text: htmlContent(event.segs.map(segment => segment.utf8 || '').join('')).text,
  }));
  if (!segments.some(segment => segment.text)) throw new AccessError('transcript_unavailable', 'Caption track was empty.');
  return { videoId: id, language: track.languageCode, automatic: track.kind === 'asr', segments,
    text: segments.map(segment => segment.text).join('\n'), needsReview: track.kind === 'asr' };
}
