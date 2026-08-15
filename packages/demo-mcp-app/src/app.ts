import { App } from "@modelcontextprotocol/ext-apps";

const style = document.createElement("style");
style.textContent = `
  :root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0; color: #171717; background: transparent; }
  .metric { padding: 22px; }
  p, small { margin: 0; color: #67675f; }
  strong { font-size: 3rem; letter-spacing: -.05em; }
  div { margin: 12px 0 8px; }
`;
document.head.append(style);

const app = new App({ name: "gadget-demo-card", version: "0.1.0" });
const title = document.querySelector<HTMLElement>("#title")!;
const value = document.querySelector<HTMLElement>("#value")!;
const unit = document.querySelector<HTMLElement>("#unit")!;

function render(input: Record<string, unknown> | undefined) {
  if (!input) return;
  title.textContent = String(input.title ?? "Metric");
  value.textContent = String(input.value ?? "—");
  unit.textContent = String(input.unit ?? "");
}

app.ontoolinput = ({ arguments: args }) => render(args as Record<string, unknown>);
app.ontoolresult = (result) => {
  if (result.structuredContent) render(result.structuredContent as Record<string, unknown>);
};
app.onhostcontextchanged = () => undefined;
app.onteardown = async () => ({});
await app.connect();
