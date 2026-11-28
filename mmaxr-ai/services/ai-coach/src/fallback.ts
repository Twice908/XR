import type { EventKind } from './protocol';

type Kind = EventKind | 'ask' | 'reveal';
type Lines = Partial<Record<Kind, string>>;

/**
 * Deterministic Socratic prompts used when the model is unavailable (no key, no credit, offline), worded for the lab
 * the student is in. Like the coach itself, they never give an answer: they only point back to the student's own
 * predictions and evidence. Lines a family leaves out come from `general`.
 */
const general: Required<Lines> = {
  prediction_mismatch: 'That was not what you expected. What does it tell you about your idea?',
  revision: 'You changed your mind there. What new evidence made you switch?',
  ph_unlocked: 'You have reached a new step. Before you go on, what are you least sure about so far, and why?',
  ready_to_submit: 'Before you finish, look over your answers once more. Does anything disagree with something else?',
  idle: 'Stuck? Say out loud what you are trying to do next, and what you expect to happen.',
  reveal: 'You have finished. Which result surprised you most, and what would you do differently next time?',
  ask: 'Tell me what you predicted and what you actually saw. What is different about the two?',
};

const families: { types: string[]; lines: Lines }[] = [
  {
    types: ['chemistry_indicators'],
    lines: {
      prediction_mismatch: 'That was not what you expected. What does it tell you about your idea for this tube?',
      ph_unlocked: 'Every tube has a conclusion. Before you use the pH paper, which one are you least sure about, and why?',
      ready_to_submit: 'Before you submit, look over your table once more. Does anything in it disagree with something else?',
      idle: 'Stuck? Pick one tube and say out loud what you expect before you test it.',
    },
  },
  {
    types: ['chemistry_metals'],
    lines: {
      prediction_mismatch: 'That was not what you expected. What does it tell you about your idea for this sample?',
      // The metals lab sends this event when only a few test runs are left.
      ph_unlocked: 'Only a few test runs are left. Which sample are you least sure about, and which test would settle it?',
      ready_to_submit: 'Before you submit, look at each sample once more. Do all of its results point the same way?',
      idle: 'Stuck? Pick one sample and one test, and say what you expect before you run it.',
    },
  },
  {
    types: ['biology_digestive_system', 'biology_respiratory_system'],
    lines: {
      prediction_mismatch: 'Not quite what you expected. What did you see at that stop that could help you think again?',
      ready_to_submit: 'Before the final explanation, think back over the journey. How does each stop lead to the next?',
      idle: 'Take a look around this stop. What do you think happens here, and why?',
      ask: 'Tell me what you think happens at this stop, and why. What have you noticed so far?',
    },
  },
  {
    types: ['physics_waves_sound'],
    lines: {
      prediction_mismatch: 'That was not what you predicted. What did the instruments show that you did not expect?',
      ready_to_submit: 'Before you finish, check each task once more. Does any measurement disagree with what you explained?',
      idle: 'Stuck? Pick a task, try the controls, and say what you expect before you run it.',
      ask: 'Tell me what you predicted and what the instruments showed. What is different about the two?',
    },
  },
  {
    types: ['physics_optics'],
    lines: {
      prediction_mismatch: 'That was not what you predicted. Look at the rays on the bench: where did they go that you did not expect?',
      ready_to_submit: 'Before you lock in, look over your table once more. Does any row disagree with what you saw?',
      idle: 'Stuck? Pick the next experiment and say what you expect the light to do before you fire.',
      ask: 'Tell me what you predicted and what the rays actually did. What is different about the two?',
    },
  },
  {
    types: ['chemistry_atom_builder', 'chemistry_ionic_bonding'],
    lines: {
      prediction_mismatch: 'Not quite there yet. Look at your build again: which part does not match the mission goal?',
      ready_to_submit: 'Every mission is done. Which build taught you the most, and why?',
      idle: 'Stuck? Read the mission goal again and say what your build still needs.',
      ask: 'Tell me what the mission asks for and what your build has now. What is different between the two?',
    },
  },
  {
    types: ['biology_cell_explorer'],
    lines: {
      prediction_mismatch: 'Not quite. What did you see in the two cells that could help you think again?',
      ready_to_submit: 'You have explored both cells. Which difference between them surprised you most?',
      idle: 'Stuck? Fly closer to one part of the cell and say what you think it does.',
      ask: 'Tell me what you have noticed in each cell. How are the plant cell and the animal cell different?',
    },
  },
  {
    types: ['physics_mechanics_sandbox', 'physics_electromagnetism', 'physics_circuits', 'physics_simple_machines', 'physics_fundamentals_sandbox', 'science_matter_properties'],
    lines: {
      prediction_mismatch: 'That was not what you predicted. What happened in the experiment that you did not expect?',
      ready_to_submit: 'You have finished every question. Which result surprised you most, and why?',
      idle: 'Stuck? Read the question again and say what you expect before you watch it run.',
    },
  },
];

export function fallbackReply(kind: Kind, labType?: string): string {
  const family = families.find((f) => labType && f.types.includes(labType));
  return family?.lines[kind] ?? general[kind] ?? general.ask;
}
