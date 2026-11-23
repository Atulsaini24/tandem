import type { ShapeView } from "@canvas/doc";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { listBoards, newBoardId, removeBoard, subscribeBoards, timeAgo, upsertBoard, DOC_ID_PATTERN, type BoardEntry } from "../boards";
import { toSvg } from "../canvas/export";
import { TEMPLATES, type Template } from "../canvas/templates";
import { CANVAS_THEMES, hex } from "../canvas/theme";
import { linkProps, navigate } from "../router";
import { useUiStore } from "../state/ui-store";
import { Icon, Logo, softSpring, spring } from "../ui/kit";
import { ThemeToggle } from "../ui/ThemeToggle";

const svgUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function templatePreview(template: Template, dark: boolean): string {
  const shapes: ShapeView[] = template.build().map((s) => ({ id: s.key, ...s.props }));
  const byId = new Map(shapes.map((s) => [s.id, s]));
  return svgUrl(toSvg(shapes, (id) => byId.get(id), { theme: dark ? CANVAS_THEMES.dark : CANVAS_THEMES.light, padding: 60, background: false }).svg);
}

function openNew(template?: string): void {
  const id = newBoardId();
  upsertBoard(id, { title: template ? (TEMPLATES.find((t) => t.id === template)?.name ?? "Untitled board") : "Untitled board" });
  navigate(`/b/${id}${template ? `?template=${template}` : ""}`);
}

function useBoards(): BoardEntry[] {
  const raw = useSyncExternalStore(subscribeBoards, () => {
    try {
      return localStorage.getItem("canvas:boards") ?? "[]";
    } catch {
      return "[]";
    }
  });
  return useMemo(() => listBoards(), [raw]);
}

function BoardCard({ board, index }: { board: BoardEntry; index: number }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ ...softSpring, delay: Math.min(index, 12) * 0.035 }}
      className="group relative overflow-hidden rounded-3xl border border-edge bg-paper shadow-[0_1px_0_rgba(17,19,24,0.04)] transition-shadow hover:shadow-[0_18px_40px_rgba(25,29,37,0.12)]"
    >
      <a {...linkProps(`/b/${board.id}`)} className="block">
        <div className="relative aspect-[16/10] overflow-hidden bg-canvas">
          <div className="absolute inset-0 bg-[radial-gradient(circle,var(--color-line)_1px,transparent_1px)] [background-size:16px_16px] opacity-70" />
          {board.thumb ? (
            <img src={svgUrl(board.thumb)} alt="" className="absolute inset-0 h-full w-full object-contain p-5 transition-transform duration-500 group-hover:scale-[1.04]" />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-[12px] font-semibold text-muted">Empty board</div>
          )}
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[14px] font-bold text-ink">{board.title}</h3>
            <p className="text-[12px] text-muted">
              {timeAgo(board.updatedAt)} · {board.shapes.toLocaleString()} {board.shapes === 1 ? "shape" : "shapes"}
            </p>
          </div>
        </div>
      </a>
      <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          title={board.starred ? "Unstar" : "Star"}
          onClick={() => upsertBoard(board.id, { starred: !board.starred })}
          className={`grid h-8 w-8 place-items-center rounded-xl bg-paper/90 backdrop-blur ${board.starred ? "text-warn" : "text-muted"} hover:text-warn`}
        >
          <Icon name="star" filled={board.starred === true} className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Remove from this list (the board itself is kept)"
          onClick={() => (confirming ? removeBoard(board.id) : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          className={`flex h-8 items-center gap-1 rounded-xl px-2 text-[11px] font-bold backdrop-blur ${confirming ? "bg-bad text-white" : "bg-paper/90 text-muted hover:text-bad"}`}
        >
          <Icon name="trash" className="h-4 w-4" />
          {confirming && "Remove?"}
        </button>
      </div>
      {board.starred && <span className="absolute left-3 top-3 grid h-7 w-7 place-items-center rounded-xl bg-paper/90 text-warn"><Icon name="star" filled className="h-3.5 w-3.5" /></span>}
    </motion.article>
  );
}

export default function Boards() {
  const boards = useBoards();
  const dark = useUiStore((s) => s.theme === "dark");
  const [query, setQuery] = useState("");
  const [join, setJoin] = useState("");
  const previews = useMemo(() => new Map(TEMPLATES.map((t) => [t.id, templatePreview(t, dark)])), [dark]);
  useEffect(() => {
    document.title = "Your boards · Tandem";
  }, []);
  const shown = boards
    .filter((b) => b.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.starred ?? false) - Number(a.starred ?? false) || b.updatedAt - a.updatedAt);

  const joinBoard = (): void => {
    const value = join.trim();
    const fromLink = /\/b\/([A-Za-z0-9_-]{1,64})/.exec(value)?.[1];
    const id = fromLink ?? value;
    if (!DOC_ID_PATTERN.test(id)) {
      useUiStore.getState().setNotice("Paste a board link or id");
      return;
    }
    navigate(fromLink ? new URL(value, location.origin).pathname + new URL(value, location.origin).search : `/b/${id}`);
  };

  return (
    <div className="min-h-full bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line/60 bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <a {...linkProps("/")} className="flex items-center gap-2">
            <Logo />
            <span className="text-[17px] font-extrabold tracking-tight text-ink">Tandem</span>
          </a>
          <div className="relative ml-auto hidden max-w-xs flex-1 sm:block">
            <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search boards" className="h-10 w-full rounded-xl border border-line bg-field pl-9 pr-3 text-[13px] text-ink outline-none focus:border-accent" />
          </div>
          <ThemeToggle />
          <motion.button
            type="button"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => openNew()}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-ink px-4 text-[13px] font-bold text-paper"
          >
            <Icon name="plus" className="h-4 w-4" />
            New board
          </motion.button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6">
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={softSpring} className="font-display text-[44px] leading-none text-ink sm:text-[56px]">
          Start something <em className="text-accent">together.</em>
        </motion.h1>
        <p className="mt-3 max-w-xl text-[15px] text-muted">Every board works offline, syncs live with your team, and keeps its full history.</p>

        <section className="mt-8">
          <div className="scroll-quiet -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={softSpring}
              whileHover={{ y: -4 }}
              onClick={() => openNew()}
              className="group flex w-44 shrink-0 snap-start flex-col overflow-hidden rounded-3xl border-2 border-dashed border-line bg-paper/50 text-left hover:border-ink/40 sm:w-auto"
            >
              <div className="grid aspect-[4/3] place-items-center">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ink text-paper transition-transform group-hover:rotate-90">
                  <Icon name="plus" />
                </span>
              </div>
              <div className="px-3.5 pb-3.5">
                <p className="text-[13px] font-bold text-ink">Blank board</p>
                <p className="text-[11px] text-muted">An infinite canvas</p>
              </div>
            </motion.button>
            {TEMPLATES.map((t, i) => (
              <motion.button
                key={t.id}
                type="button"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...softSpring, delay: 0.04 * (i + 1) }}
                whileHover={{ y: -4 }}
                onClick={() => openNew(t.id)}
                className="group flex w-44 shrink-0 snap-start flex-col overflow-hidden rounded-3xl border border-edge bg-paper text-left shadow-[0_1px_0_rgba(17,19,24,0.04)] hover:shadow-[0_16px_36px_rgba(25,29,37,0.12)] sm:w-auto"
              >
                <div className="relative aspect-[4/3] overflow-hidden" style={{ backgroundColor: `${hex(t.color)}14` }}>
                  <img src={previews.get(t.id)} alt="" className="absolute inset-0 h-full w-full object-contain p-3 transition-transform duration-500 group-hover:scale-110" />
                  {t.tag && <span className="absolute left-2.5 top-2.5 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-sm" style={{ backgroundColor: hex(t.color) }}>{t.tag}</span>}
                </div>
                <div className="px-3.5 py-3">
                  <p className="text-[13px] font-bold text-ink">{t.name}</p>
                  <p className="line-clamp-2 text-[11px] leading-snug text-muted">{t.blurb}</p>
                </div>
              </motion.button>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-[20px] font-extrabold tracking-tight text-ink">
              Recent boards <span className="ml-1 text-[14px] font-semibold text-muted">{boards.length}</span>
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                joinBoard();
              }}
              className="flex gap-2"
            >
              <input value={join} onChange={(e) => setJoin(e.target.value)} placeholder="Paste a board link to join" className="h-10 w-64 rounded-xl border border-line bg-field px-3 text-[13px] text-ink outline-none focus:border-accent" />
              <button type="submit" className="h-10 rounded-xl border border-line bg-paper px-4 text-[13px] font-bold text-ink hover:bg-hover">
                Join
              </button>
            </form>
          </div>
          {shown.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid place-items-center rounded-3xl border border-dashed border-line px-6 py-16 text-center">
              <p className="font-display text-[28px] text-ink">{query ? "Nothing matches that." : "No boards yet."}</p>
              <p className="mt-1 text-[14px] text-muted">{query ? "Try another name." : "Pick a template above, or start from a blank canvas."}</p>
            </motion.div>
          ) : (
            <motion.div layout className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence>
                {shown.map((board, i) => (
                  <BoardCard key={board.id} board={board} index={i} />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </section>
      </main>
      <Toast />
    </div>
  );
}

function Toast() {
  const notice = useUiStore((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useUiStore.getState().setNotice(undefined), 3_500);
    return () => clearTimeout(t);
  }, [notice]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center">
      <AnimatePresence>
        {notice && (
          <motion.div key={notice} initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={spring} className="rounded-full bg-ink px-5 py-3 text-[13px] font-semibold text-paper">
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
