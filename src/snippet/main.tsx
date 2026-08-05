import ReactDOM from "react-dom/client";
import { SnippetApp } from "./SnippetApp";

// No globals.css here on purpose: the stylesheet paints an opaque background
// on :root, which would defeat the window's transparency.
ReactDOM.createRoot(
  document.getElementById("snippet-root") as HTMLElement,
).render(<SnippetApp />);
