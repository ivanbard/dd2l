const text = (maxLength = 1000) => ({ type: 'string', maxLength });
const list = (items, maxItems, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const kind = value => ({ type: 'string', enum: [value] });
const citations = list({ type: 'integer', minimum: 1, maximum: 8 }, 8, 1);

export const answerSchema = object({
  title: text(160),
  answer: text(6000),
  sections: list({ anyOf: [
    object({ type: kind('checklist'), title: text(160), items: list(object({ text: text(), citations }), 20, 1) }),
    object({ type: kind('comparison'), title: text(160), columns: list(text(120), 5, 2),
      rows: list(object({ cells: list(text(), 5, 2), citations }), 20, 1) }),
    object({ type: kind('cards'), title: text(160), cards: list(object({ title: text(160), text: text(2000), citations }), 12, 1) }),
  ] }, 6),
});

// Validate the same bounded schema we send to the provider, including unexpected keys.
function matches(value, schema) {
  if (schema.anyOf) return schema.anyOf.some(choice => matches(value, choice));
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === schema.required.length && schema.required.every(key => Object.hasOwn(value, key) && matches(value[key], schema.properties[key]));
  if (schema.type === 'array') return Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems && value.every(item => matches(item, schema.items));
  if (schema.type === 'string') return typeof value === 'string' && value.length <= (schema.maxLength ?? Infinity) && (!schema.enum || schema.enum.includes(value));
  return schema.type === 'integer' && Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum;
}

export function validAnswerView(value, sourceCount) {
  if (!matches(value, answerSchema)) return false;
  return value.sections.every(section => {
    const items = section.items || section.rows || section.cards;
    return items.every(item => item.citations.every(id => id <= sourceCount) &&
      (section.type !== 'comparison' || item.cells.length === section.columns.length));
  });
}

export function parseAnswerView(raw, sourceCount) {
  let value;
  try { value = JSON.parse(raw); }
  catch {
    if (!/^\s*(?:[\[{]|```)/.test(raw)) return { answer: raw, view: null };
  }
  if (validAnswerView(value, sourceCount)) return { answer: value.answer, view: value };
  const answer = typeof value?.answer === 'string' && value.answer.trim() && value.answer.length <= 6000 ? value.answer
    : 'The model returned an unreadable answer. Please try again.';
  return { answer, view: null, viewWarning: 'The generated layout could not be verified. Showing text and available sources instead.' };
}
