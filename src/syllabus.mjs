import { AccessError, apiUrl } from './client.mjs';
import { descriptionContent, readDocument } from './documents.mjs';

const syllabusTitle = /syllab|course\s+(?:outline|overview|information|polic|guide)|\boutline\b|plan de cours/i;
const explicitTitle = /syllab|course\s+outline|plan de cours/i;

export function findSyllabusSources(tree, now = Date.now()) {
  const sources = [];
  function visit(node, parents = [], inSyllabusModule = false, ancestorUnavailable = false) {
    if (!node || typeof node !== 'object') return;
    const title = String(node.Title || '');
    const description = descriptionContent(node.Description);
    const directMatch = syllabusTitle.test(title);
    const matched = directMatch || inSyllabusModule || explicitTitle.test(description.text);
    const unavailable = ancestorUnavailable || node.IsHidden === true || node.IsLocked === true ||
      Date.parse(node.StartDateTime) > now || Date.parse(node.EndDateTime) < now;
    const common = { title, parents, topicId: node.TopicId, moduleId: node.ModuleId, activityType: node.ActivityType, lastModifiedDate: node.LastModifiedDate,
      url: node.Url, unavailable, role: explicitTitle.test(title) ? 'explicit_syllabus' : 'course_information',
      matchedBy: directMatch ? 'title' : inSyllabusModule ? 'parent_module' : 'description' };
    if (matched && description.text) sources.push({ ...common, kind: node.TopicId != null ? 'topic_description' : 'module_description', description: description.text, links: description.links });
    if (matched && node.TopicId != null) sources.push({ ...common, kind: node.ActivityType === 1 ? 'content_file' : 'linked_topic', description: '' });
    for (const child of node.Modules || []) visit(child, [...parents, title].filter(Boolean), inSyllabusModule || directMatch, unavailable);
    for (const child of node.Topics || []) visit(child, [...parents, title].filter(Boolean), inSyllabusModule || directMatch, unavailable);
  }
  visit(tree);
  return sources;
}

export function classifyOverview(observation) {
  if (observation.status === 404) {
    observation.outcome = 'not_configured';
    observation.complete = true;
    observation.message = 'Course content overview is not configured; other syllabus locations still need checking.';
    delete observation.error;
  }
  return observation;
}

export async function collectSyllabus(client, { le, courseId, content, overview }) {
  const descriptors = content.data ? findSyllabusSources(content.data) : [];
  const observations = [];
  const catalog = [];
  let documentReads = 0;
  let limited = false;
  const source = async (descriptor, action) => {
    const identity = descriptor.kind === 'overview' ? 'overview' : descriptor.kind === 'overview_attachment' ? 'overview_attachment' :
      `${descriptor.kind}:${descriptor.topicId ?? descriptor.moduleId ?? JSON.stringify([...(descriptor.parents || []), descriptor.title])}`;
    const key = `syllabus:${courseId}:${identity}`;
    const record = { key, category: 'syllabus_source', course: courseId, source: descriptor.source || `${le}/content/toc`,
      retrievedAt: new Date().toISOString(), outcome: 'available', complete: true };
    let entry = { ...descriptor, key, retrievedAt: record.retrievedAt };
    delete entry.description;
    try {
      if (descriptor.unavailable) throw new AccessError('restricted', 'Source is hidden, locked, or outside its release window.');
      const data = await action();
      const role = descriptor.kind === 'overview_attachment' && explicitTitle.test(data.text?.slice(0, 2000) || '') ? 'explicit_syllabus' : descriptor.role;
      record.data = { ...descriptor, ...data, role };
      entry = { ...entry, outcome: 'available', textStatus: data.textStatus, textCharacters: data.text?.trim().length || 0, format: data.format,
        pages: data.pages, links: data.links || [], source: record.source, role };
      if (data.textStatus === 'failed' || data.textStatus === 'partial') {
        record.complete = false;
        record.outcome = 'partial';
        entry.outcome = 'partial';
      }
    } catch (error) {
      if (!(error instanceof AccessError) || error.code === 'needs_login') throw error;
      record.outcome = ['denied', 'restricted'].includes(error.code) ? 'denied' : error.code === 'partial' ? 'partial' : 'failed';
      Object.assign(record, { complete: false, error: error.code, message: error.message, status: error.status, retryAfter: error.retryAfter });
      entry = { ...entry, outcome: record.outcome, error: error.code, message: error.message, textCharacters: 0 };
    }
    observations.push(record);
    catalog.push(entry);
  };

  if (overview.outcome === 'not_configured') {
    for (const kind of ['overview', 'overview_attachment']) {
      observations.push({ key: `syllabus:${courseId}:${kind}`, category: 'syllabus_source', course: courseId,
        source: kind === 'overview' ? `${le}/overview` : `${le}/overview/attachment`, outcome: 'not_configured', complete: true,
        retrievedAt: new Date().toISOString(), status: 404 });
    }
  } else if (overview.outcome === 'available') {
    await source({ kind: 'overview', title: 'Course overview', role: 'course_information', source: `${le}/overview` }, async () => {
      const value = descriptionContent(overview.data?.Description);
      return { ...value, format: 'inline', textStatus: value.text ? 'available' : 'empty' };
    });
    if (overview.data?.HasAttachment === true) {
      documentReads++;
      await source({ kind: 'overview_attachment', title: 'Course overview attachment', role: 'course_information', source: `${le}/overview/attachment` }, () => readDocument(client, `${le}/overview/attachment`));
    }
  }

  for (const descriptor of descriptors.slice(0, 100)) {
    if (descriptor.unavailable) {
      await source(descriptor, async () => ({}));
      continue;
    }
    if (descriptor.kind.endsWith('_description')) {
      await source(descriptor, async () => ({ text: descriptor.description, links: descriptor.links || [], format: 'inline', textStatus: descriptor.description ? 'available' : 'empty' }));
      continue;
    }
    if (!/^\d+$/.test(String(descriptor.topicId))) {
      catalog.push({ ...descriptor, outcome: 'unresolved', textCharacters: 0 });
      continue;
    }
    const topicPath = `${le}/content/topics/${descriptor.topicId}`;
    if (descriptor.kind === 'content_file') {
      if (documentReads >= 20) { limited = true; catalog.push({ ...descriptor, outcome: 'not_read_limit', textCharacters: 0 }); continue; }
      documentReads++;
      await source({ ...descriptor, source: `${topicPath}/file` }, () => readDocument(client, `${topicPath}/file`));
    } else {
      await source({ ...descriptor, source: topicPath }, async () => {
        const metadata = await client.get(topicPath);
        const value = descriptionContent(metadata.Description);
        const target = metadata.Url || descriptor.url;
        // Resolve link metadata only. School credentials never accompany arbitrary links.
        let linkStatus = 'unresolved';
        if (target) {
          try { apiUrl(client.origin, target); linkStatus = 'api_link_not_followed'; }
          catch {
            try { linkStatus = new URL(target, client.origin).origin === client.origin ? 'school_link_not_followed' : 'external'; }
            catch { linkStatus = 'invalid'; }
          }
        }
        return { ...value, format: 'link', metadata, links: target ? [...value.links, { url: target, label: descriptor.title, status: linkStatus }] : value.links,
          textStatus: value.text ? 'available' : 'unresolved' };
      });
    }
  }
  limited ||= descriptors.length > 100;
  const readable = catalog.filter(item => item.textStatus === 'available' && item.textCharacters > 0);
  const explicit = readable.filter(item => item.role === 'explicit_syllabus');
  const discoveryComplete = content.complete === true && overview.complete === true && !limited;
  const unreadLinkCount = catalog.reduce((sum, item) => sum + (item.links?.length || 0), 0);
  const textCoverageComplete = discoveryComplete && !unreadLinkCount && catalog.every(item => item.outcome === 'available' && ['available', 'empty'].includes(item.textStatus));
  const summary = {
    result: explicit.length ? 'explicit_sources' : readable.length ? 'course_information' : 'unresolved',
    overview: overview.outcome === 'available' ? descriptionContent(overview.data?.Description).text ? 'readable' : 'empty' : overview.outcome,
    candidateCount: descriptors.length, readableSourceCount: readable.length, explicitSourceCount: explicit.length,
    textCharacters: readable.reduce((sum, item) => sum + item.textCharacters, 0),
    discoveryComplete, textCoverageComplete, limited, unreadLinkCount,
    unresolvedSourceCount: catalog.filter(item => item.outcome !== 'available' || !['available', 'empty'].includes(item.textStatus)).length,
    formats: [...new Set(readable.map(item => item.format))].sort(),
    retryAfter: Math.max(0, ...observations.filter(item => item.error === 'retry_wait').map(item => item.retryAfter || 60_000)),
  };
  observations.push({ key: `${le}/syllabus`, category: 'syllabus', course: courseId, source: `${le}/content/toc`,
    retrievedAt: new Date().toISOString(), outcome: 'available', complete: discoveryComplete, data: { ...summary, sources: catalog } });
  return { observations, summary };
}
