import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createStageWebApplication } from "./composition/application";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Application root was not found");

const root = createRoot(rootElement);
root.render(
  <main className="boot-state" aria-label="起動中">
    <span className="boot-mark" />
    <strong>Stack-chan Stage</strong>
  </main>,
);

try {
  const application = await createStageWebApplication();
  root.render(<App application={application} />);
  window.addEventListener("beforeunload", () => void application.dispose(), {
    once: true,
  });
} catch (error) {
  console.error("[web] startup failed", error);
  root.render(
    <main className="fatal-state" role="alert">
      <strong>Stack-chan Stageを起動できません</strong>
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </main>,
  );
}
