import React from 'react';
import { MantineProvider, createTheme, Button, Checkbox, Progress, Tabs, Textarea, Table, Radio, Stack, Group, Text, Title, Alert, Accordion } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import './workspace.css';

const theme = createTheme({ primaryColor: 'teal', fontFamily: 'system-ui, sans-serif', defaultRadius: 'sm', respectReducedMotion: true });
export function WorkspaceView({ plan, state, action, source, sources = [], demo = false, saveStatus = '', exportDraft }) {
  const value = (id, next) => action({ type: 'value', id, value: next });
  const cite = id => {
    const record = sources.find(item => item.id === id);
    return <Button key={id} variant="subtle" size="xs" onClick={() => source(id)} aria-label={record ? `Read source: ${record.title}` : undefined}>
      Read source{record?.stale ? ' · Stale cache' : ''}</Button>;
  };
  const content = section => <section className="workspace-section" aria-labelledby={`section-${section.id}`} key={section.id}>
    <Title order={2} id={`section-${section.id}`} size="h3" mb="md">{section.title}</Title>
    {section.type === 'reading' && <Stack><Text className="coursework-text" size="sm">{section.text}</Text><Group gap="xs">{section.sourceIds.map(cite)}</Group></Stack>}
    {section.type === 'checklist' && <Stack gap="lg">
      <Text size="sm" c="dimmed" role="status">{section.items.filter(item => state.values[item.id]).length} of {section.items.length} complete</Text>
      <Progress value={section.items.filter(item => state.values[item.id]).length / section.items.length * 100} aria-label={`${section.title} progress`} />
      {section.items.map(item => <div className="requirement-row" key={item.id}><Checkbox name={item.id} label={item.text} checked={state.values[item.id]}
        onChange={event => value(item.id, event.currentTarget.checked)} />{cite(item.sourceId)}</div>)}
    </Stack>}
    {section.type === 'schedule' && <Stack><DatePickerInput label="Planned work date" placeholder="Choose a date" name={section.id}
      value={state.values[section.id] || null} onChange={date => value(section.id, date || '')} clearable valueFormat="YYYY-MM-DD" />
      <Text size="sm" c="dimmed">Personal plan · this does not change your assignment deadline.</Text></Stack>}
    {section.type === 'notes' && <Textarea label={section.title} name={section.id} placeholder={section.placeholder} minRows={4} autosize maxLength={4000}
      value={state.values[section.id]} onChange={event => value(section.id, event.currentTarget.value)} />}
    {section.type === 'rubric' && <Table.ScrollContainer minWidth={440}><Table captionSide="top"><Table.Caption>{section.title}</Table.Caption>
      <Table.Thead><Table.Tr><Table.Th scope="col">Criterion</Table.Th><Table.Th scope="col" style={{ whiteSpace: 'nowrap' }}>Points</Table.Th><Table.Th scope="col">Requirement</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{section.rows.map((row, index) => <Table.Tr key={index}><Table.Th scope="row">{row.criterion}</Table.Th><Table.Td>{row.points}</Table.Td>
        <Table.Td><Text size="sm">{row.description}</Text>{cite(row.sourceId)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
    {section.type === 'practice' && <Stack gap="xl"><Text size="sm" c="dimmed">Generated practice · not an official quiz</Text>
      {section.questions.map(question => <Stack key={question.id} gap="sm"><Radio.Group name={question.id} label={question.prompt}
        value={state.values[question.id] === null ? '' : String(state.values[question.id])} onChange={answer => value(question.id, Number(answer))}>
        <Stack gap="sm" mt="sm">{question.choices.map((choice, index) => <Radio key={index} value={String(index)} label={choice} />)}</Stack></Radio.Group>
        <Group><Button disabled={state.values[question.id] === null} onClick={() => action({ type: 'reveal', id: question.id })}>Check answer</Button>{cite(question.sourceId)}</Group>
        {state.revealed[question.id] && <Alert role="status" color={state.values[question.id] === question.answer ? 'teal' : 'yellow'}>
          {state.values[question.id] === question.answer ? 'Correct.' : 'Try again.'} {question.explanation}</Alert>}
      </Stack>)}
    </Stack>}
  </section>;
  return <MantineProvider theme={theme} forceColorScheme="dark"><Stack gap="lg">
    {demo && <Text size="xs" c="dimmed">FICTIONAL COURSEWORK</Text>}
    <div><Title order={1} size="h2">{plan.title}</Title><Text size="sm" c="dimmed" mt="sm">{plan.goal}</Text>
      {plan.answer && <Text className="coursework-text" size="sm" mt="md">{plan.answer}</Text>}</div>
    <div className="working-layout" data-layout={plan.layout || 'tabs'}><div className="workspace-sections">
      {(!plan.layout || plan.layout === 'tabs') ? <Tabs value={state.active} onChange={id => action({ type: 'tab', id })} keepMounted>
        <Tabs.List aria-label="Workspace sections">{plan.sections.map(section => <Tabs.Tab key={section.id} value={section.id}>{section.title}</Tabs.Tab>)}</Tabs.List>
        {plan.sections.map(section => <Tabs.Panel key={section.id} value={section.id} pt="lg">{content(section)}</Tabs.Panel>)}
      </Tabs> : <Stack gap="xl">{plan.sections.map(content)}</Stack>}
    </div>
    {state.draft !== undefined && <section className="draft-editor" aria-label="Your assignment draft"><Title order={2} size="h3" mb="sm">Your draft</Title>
      <Text size="sm" c="dimmed" mb="md">Write an outline or begin your assignment here. Open Brightspace to submit your finished work.</Text>
      <Textarea label="Assignment draft" description={`${state.draft.length.toLocaleString()} / 16,000 characters`} name="assignment-draft" minRows={12} autosize maxRows={35} maxLength={16000} value={state.draft}
        onChange={event => action({ type: 'draft', value: event.currentTarget.value })} />
      <Group mt="sm" justify="space-between"><Text size="xs" role="status">{saveStatus}</Text><Button variant="subtle" size="xs" onClick={exportDraft}>Export draft</Button></Group>
      {!!state.archivedNotes?.length && <Accordion mt="md"><Accordion.Item value="saved-notes"><Accordion.Control>Notes from earlier layouts</Accordion.Control>
        <Accordion.Panel><Stack>{state.archivedNotes.map((note, index) => <div key={index}><Text fw={600} size="sm">{note.title}</Text><Text className="coursework-text" size="sm">{note.text}</Text></div>)}</Stack></Accordion.Panel>
      </Accordion.Item></Accordion>}
    </section>}
    </div>
  </Stack></MantineProvider>;
}
