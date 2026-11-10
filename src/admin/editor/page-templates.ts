/** Starting points for a new page: a list of sections built from the same defaults the section picker uses. */
import type { LooseBlock, LooseSection } from '../../components/render/types';
import { newBlock, newSection, text, type NewContext } from './defaults';

export interface PageTemplate {
  id: string;
  label: string;
  description: string;
  /** Page title suggested when the editor has not typed one. */
  title: string;
  build(ctx: NewContext): LooseSection[];
}

const para = (column: number, s: string): LooseBlock => {
  const b = newBlock('paragraph', column);
  b.content = { text: { type: 'doc', content: [{ type: 'paragraph', content: text(s) }] } };
  return b;
};
const heading = (column: number, s: string, level = 3): LooseBlock => {
  const b = newBlock('heading', column);
  b.content = { text: text(s), level };
  return b;
};

function intro(ctx: NewContext, title: string, lead: string): LooseSection {
  const s = newSection('hero', ctx);
  s.variant = 'text-only';
  s.content = { heading: text(title), subheading: text(lead) };
  return s;
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  { id: 'blank', label: 'Blank', description: 'An empty page. Add sections yourself.', title: 'New page', build: () => [] },
  {
    id: 'about',
    label: 'About',
    description: 'An opening line, then your story and a portrait.',
    title: 'About',
    build: (ctx) => [intro(ctx, 'About', 'A short line about who you are.'), newSection('about', ctx)],
  },
  {
    id: 'commissions',
    label: 'Commissions',
    description: 'What you offer, how it works and a button to get in touch.',
    title: 'Commissions',
    build: (ctx) => {
      const details = newSection('text', ctx);
      details.blocks = [heading(0, 'What I offer', 2), para(0, 'Describe the kinds of work you take on, such as illustration, character design or short animations.'), heading(0, 'Pricing and timing', 2), para(0, 'Say how pricing works and how long a project usually takes.')];
      return [intro(ctx, 'Commissions', 'Have an idea? Let us make it real.'), details, newSection('cta', ctx)];
    },
  },
  {
    id: 'process',
    label: 'Process',
    description: 'Three steps side by side, then a call to action.',
    title: 'Process',
    build: (ctx) => {
      const steps = newSection('columns', ctx);
      steps.settings = { columns: 3 };
      steps.blocks = [heading(0, '1. Brief'), para(0, 'We talk about what you need.'), heading(1, '2. Sketch'), para(1, 'You see early ideas and give feedback.'), heading(2, '3. Final'), para(2, 'I polish the work and deliver it.')];
      return [intro(ctx, 'Process', 'How a project goes from idea to finished piece.'), steps, newSection('cta', ctx)];
    },
  },
  {
    id: 'contact',
    label: 'Contact',
    description: 'A heading with your email and social links.',
    title: 'Contact',
    build: (ctx) => [intro(ctx, 'Contact', 'The best way to reach me.'), newSection('contact', ctx)],
  },
];
