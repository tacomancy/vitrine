// Fonts are bundled; nothing loads from Google Fonts. Josefin Sans is the
// wordmark's face only (BRAND.md), bundled here so the wordmark can be drawn.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/400-italic.css";
import "@fontsource/josefin-sans/300.css";
// The palette has one source; the frozen file is imported, never copied.
import "../../../docs/reference/branding/tokens.css";
import "./global.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createClient, TRPCProvider } from "./trpc";

const session = window.vitrine;
const queryClient = new QueryClient();
const trpcClient = createClient(session);

const root = document.getElementById("root");
if (!root) throw new Error("renderer: #root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <App port={session.port} />
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>
);
