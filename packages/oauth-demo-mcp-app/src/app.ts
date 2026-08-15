import { App } from '@modelcontextprotocol/ext-apps';

const style = document.createElement('style');
style.textContent = `
  :root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0; color: #171717; background: transparent; }
  section { padding: 22px; }
  p, small { display: block; margin: 0 0 8px; color: #67675f; }
  strong { display: block; margin: 10px 0; font-size: 3rem; letter-spacing: -.05em; }
`;
document.head.append(style);

const app = new App({ name: 'oauth-gadget-demo-card', version: '0.1.0' });
const title = document.querySelector<HTMLElement>('#title')!;
const value = document.querySelector<HTMLElement>('#value')!;

function render(input: Record<string, unknown> | undefined) {
  if (!input) return;
  if (typeof input.title === 'string') title.textContent = input.title;
  if (typeof input.value === 'string' || typeof input.value === 'number') {
    value.textContent = String(input.value);
  }
}

app.ontoolinput = ({ arguments: args }) => render(args);
app.ontoolresult = (result) => {
  if (result.structuredContent) render(result.structuredContent);
};
app.onhostcontextchanged = () => undefined;
app.onteardown = () => Promise.resolve({});
await app.connect();
