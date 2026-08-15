import { App } from '@modelcontextprotocol/ext-apps';

const style = document.createElement('style');
style.textContent = `
  :root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0; color: #171717; background: transparent; }
  .metric { padding: 22px; }
  p, small { margin: 0; color: #67675f; }
  strong { font-size: 3rem; letter-spacing: -.05em; }
  div { margin: 12px 0 8px; }
`;
document.head.append(style);

const app = new App({ name: 'gadget-demo-card', version: '0.1.0' });
const title = document.querySelector<HTMLElement>('#title')!;
const value = document.querySelector<HTMLElement>('#value')!;
const unit = document.querySelector<HTMLElement>('#unit')!;

function displayValue(input: unknown, fallback: string): string {
  if (typeof input === 'string' || typeof input === 'number') {
    return String(input);
  }
  return fallback;
}

function render(input: Record<string, unknown> | undefined) {
  if (!input) return;
  title.textContent = displayValue(input.title, 'Metric');
  value.textContent = displayValue(input.value, '—');
  unit.textContent = displayValue(input.unit, '');
}

app.ontoolinput = ({ arguments: args }) => render(args);
app.ontoolresult = (result) => {
  if (result.structuredContent) render(result.structuredContent);
};
app.onhostcontextchanged = () => undefined;
app.onteardown = () => Promise.resolve({});
await app.connect();
