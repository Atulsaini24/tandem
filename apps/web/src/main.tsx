import { StrictMode, Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { watchSystemTheme } from "./canvas/theme";
import { useRoute } from "./router";
import { registerPwa } from "./pwa";
import { useUiStore } from "./state/ui-store";
import "./styles.css";

// Each page is its own chunk: the homepage doesn't download the canvas engine.
const Home = lazy(() => import("./pages/Home"));
const Boards = lazy(() => import("./pages/Boards"));
const Board = lazy(() => import("./pages/Board"));

function Root() {
  const route = useRoute();
  useEffect(
    () =>
      watchSystemTheme(() => {
        const { themePreference, setTheme } = useUiStore.getState();
        if (themePreference === "system") setTheme("system");
      }),
    [],
  );
  useEffect(() => {
    document.documentElement.dataset.page = route.page;
  }, [route.page]);
  return (
    <Suspense fallback={<div className="h-full w-full bg-canvas" />}>
      {route.page === "home" && <Home />}
      {route.page === "boards" && <Boards />}
      {route.page === "board" && <Board key={route.docId} route={route} />}
    </Suspense>
  );
}

registerPwa();

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
