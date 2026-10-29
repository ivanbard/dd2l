export function courseNodes(tree, now = Date.now()) {
  const result = [];
  function visit(node, unavailable = false) {
    if (!node || typeof node !== 'object') return;
    const restricted = unavailable || node.IsHidden === true || node.IsLocked === true ||
      Date.parse(node.StartDateTime) > now || Date.parse(node.EndDateTime) < now;
    result.push({ ...node, restricted });
    for (const child of [...(node.Modules || []), ...(node.Topics || [])]) visit(child, restricted);
  }
  visit(tree);
  return result;
}

export function reconcileQuizzes(list, tree, grades, origin) {
  const known = new Map();
  const candidates = [];
  for (const quiz of list || []) if (/^\d+$/.test(String(quiz.QuizId))) known.set(String(quiz.QuizId), { quizId: String(quiz.QuizId), name: quiz.Name, sources: ['quiz_list'], gradeItemId: quiz.GradeItemId, restricted: false });
  for (const topic of courseNodes(tree).filter(node => node.TopicId != null)) {
    let url;
    try { url = new URL(topic.Url, origin); } catch {}
    const quizTopic = topic.ActivityType === 4 || /quiz/i.test(topic.TypeIdentifier || '') ||
      (url?.origin === origin && url.pathname.includes('/quizzing/'));
    if (!quizTopic) continue;
    const identifier = topic.ToolItemId ?? (url?.origin === origin ? url.searchParams.get('qi') : null);
    if (/^\d+$/.test(String(identifier))) {
      const key = String(identifier);
      const existing = known.get(key);
      if (existing) { existing.sources.push('content'); existing.restricted &&= topic.restricted; }
      else known.set(key, { quizId: key, name: topic.Title, sources: ['content'], topicId: topic.TopicId, restricted: topic.restricted, gradeItemId: topic.GradeItemId });
    } else candidates.push({ name: topic.Title, topicId: topic.TopicId, source: 'content', restricted: topic.restricted, detailsStatus: 'unresolved' });
  }
  for (const grade of grades || []) {
    const quiz = [...known.values()].find(item => item.gradeItemId != null && String(item.gradeItemId) === String(grade.GradeObjectIdentifier));
    if (quiz) quiz.sources.push('gradebook');
    else if (/\bquiz/i.test(grade.GradeObjectName || '')) candidates.push({ name: grade.GradeObjectName, gradeItemId: grade.GradeObjectIdentifier, source: 'gradebook', detailsStatus: 'unresolved' });
  }
  return { quizzes: [...known.values()], candidates };
}

export function batch(items, offset = 0, size = 25) {
  const start = Number.isSafeInteger(offset) && offset >= 0 && offset < items.length ? offset : 0;
  const selected = items.slice(start, start + size);
  return { items: selected, total: items.length, start, next: start + selected.length >= items.length ? 0 : start + selected.length,
    limited: items.length > selected.length };
}
