import React from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, createTheme, Button, Checkbox, Progress, Tabs, Textarea, Table, Radio, Stack, Group, Text, Title, Alert } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import './frame.css';
import { completion, connectRenderer } from './frame.mjs';

const root = createRoot(document.getElementById('root'));
const theme = createTheme({ primaryColor: 'teal', fontFamily: 'system-ui, sans-serif', defaultRadius: 'sm', respectReducedMotion: true });

function Workspace({ plan, state, action, source }) {
  const progress = completion(plan, state);
  const cite = id => <Button variant="subtle" size="xs" onClick={() => source(id)}>Read source</Button>;
  const value = (id, next) => action({ type: 'value', id, value: next });
  return <MantineProvider theme={theme} forceColorScheme="dark">
    <p className="eyebrow">FICTIONAL COURSEWORK</p><Title order={1}>{plan.title}</Title><p className="goal">{plan.goal}</p>
    <Text size="sm" c="dimmed" mb="md">{progress.total ? `${progress.done} of ${progress.total} requirements complete` : 'Try a question, then check your answer.'}</Text>
    <Tabs value={state.active} onChange={id => action({ type: 'tab', id })} keepMounted>
      <Tabs.List aria-label="Workspace sections">{plan.sections.map(section => <Tabs.Tab key={section.id} value={section.id}>{section.title}</Tabs.Tab>)}</Tabs.List>
      {plan.sections.map(section => <Tabs.Panel key={section.id} value={section.id} pt="lg">
        <Title order={2} mb="lg">{section.title}</Title>
        {section.type === 'reading' && <Stack><Text style={{ whiteSpace: 'pre-wrap' }}>{section.text}</Text><Group>{section.sourceIds.map(id => <React.Fragment key={id}>{cite(id)}</React.Fragment>)}</Group></Stack>}
        {section.type === 'checklist' && <Stack gap="lg">
          <Progress value={section.items.filter(item => state.values[item.id]).length / section.items.length * 100} aria-label="Requirement completion" />
          {section.items.map(item => <div key={item.id} className="requirement-row"><Checkbox name={item.id} label={item.text}
            checked={state.values[item.id]} onChange={event => value(item.id, event.currentTarget.checked)} />{cite(item.sourceId)}</div>)}
        </Stack>}
        {section.type === 'schedule' && <Stack><DatePickerInput label="Planned work date" placeholder="Choose a date" name={section.id}
          value={state.values[section.id] || null} onChange={date => value(section.id, date || '')} clearable valueFormat="YYYY-MM-DD" />
          <Text size="sm" c="dimmed">Your plan date is a personal scenario, not a changed assignment deadline.</Text></Stack>}
        {section.type === 'notes' && <Textarea label={section.title} name={section.id} placeholder={section.placeholder} minRows={6} autosize maxLength={4000}
          value={state.values[section.id]} onChange={event => value(section.id, event.currentTarget.value)} />}
        {section.type === 'rubric' && <Table.ScrollContainer minWidth={440}><Table captionSide="top">
          <Table.Caption>Fictional assignment rubric</Table.Caption><Table.Thead><Table.Tr><Table.Th scope="col">Criterion</Table.Th><Table.Th scope="col">Points</Table.Th><Table.Th scope="col">Requirement</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{section.rows.map((row, index) => <Table.Tr key={index}><Table.Th scope="row">{row.criterion}</Table.Th><Table.Td>{row.points}</Table.Td><Table.Td><Text size="sm">{row.description}</Text>{cite(row.sourceId)}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table></Table.ScrollContainer>}
        {section.type === 'practice' && <Stack gap="xl"><Text size="sm" c="dimmed">Generated practice · not an official quiz</Text>
          {section.questions.map(question => <Stack key={question.id} gap="sm"><Radio.Group name={question.id} label={question.prompt}
            value={state.values[question.id] === null ? '' : String(state.values[question.id])} onChange={answer => value(question.id, Number(answer))}>
            <Stack gap="sm" mt="sm">{question.choices.map((choice, index) => <Radio key={index} value={String(index)} label={choice} />)}</Stack>
          </Radio.Group><Group><Button disabled={state.values[question.id] === null} onClick={() => action({ type: 'reveal', id: question.id })}>Check answer</Button>{cite(question.sourceId)}</Group>
            {state.revealed[question.id] && <Alert role="status" color={state.values[question.id] === question.answer ? 'teal' : 'yellow'}>
              {state.values[question.id] === question.answer ? 'Correct.' : 'Try again.'} {question.explanation}</Alert>}
          </Stack>)}
        </Stack>}
      </Tabs.Panel>)}
    </Tabs>
  </MantineProvider>;
}

connectRenderer(data => root.render(<Workspace {...data} />));
