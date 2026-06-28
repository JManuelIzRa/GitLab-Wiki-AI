import { useEffect, useMemo, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export function CommandPalette({ open, pages, actions, onSelectPage, onClose }) {
  const [query, setQuery] = useState("");
  const trapRef = useFocusTrap(open);

  const close = () => { setQuery(""); onClose(); };

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => { if (event.key === "Escape") { setQuery(""); onClose(); } };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const entries = useMemo(() => {
    const pageEntries = pages.map((page) => ({
      id: `page-${page.slug}`,
      label: page.title,
      hint: "página",
      run: () => onSelectPage(page.slug),
    }));
    return [...actions, ...pageEntries].filter((entry) =>
      `${entry.label} ${entry.hint || ""}`.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 12);
  }, [actions, onSelectPage, pages, query]);

  if (!open) return null;
  return (
    <div className="modal-overlay command-palette-overlay" onClick={close}>
      <div ref={trapRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Comandos" onClick={(e) => e.stopPropagation()}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar páginas y acciones…" />
        <div className="command-results">
          {entries.map((entry) => (
            <button key={entry.id} onClick={() => { entry.run(); close(); }}>
              <span>{entry.label}</span><small>{entry.hint}</small>
            </button>
          ))}
          {!entries.length && <p>Sin resultados</p>}
        </div>
      </div>
    </div>
  );
}
