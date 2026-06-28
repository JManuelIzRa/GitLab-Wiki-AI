import { useEffect } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";

const SHORTCUTS = [
  { keys: ["?"], description: "Mostrar / ocultar este panel de atajos" },
  { keys: ["/"], description: "Enfocar la búsqueda del sidebar" },
  { keys: ["Alt", "←"], description: "Página anterior del wiki" },
  { keys: ["Alt", "→"], description: "Página siguiente del wiki" },
  { keys: ["Esc"], description: "Cerrar modales / quitar foco del buscador" },
];

export function KeyboardShortcutsModal({ onClose }) {
  const trapRef = useFocusTrap();
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div ref={trapRef} style={styles.modal} role="dialog" aria-modal="true" aria-label="Atajos de teclado" onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>atajos de teclado</span>
          <button onClick={onClose} style={styles.closeBtn} title="Cerrar (Esc)">
            <X size={14} />
          </button>
        </div>
        <table style={styles.table}>
          <tbody>
            {SHORTCUTS.map(({ keys, description }) => (
              <tr key={keys.join("+")} style={styles.row}>
                <td style={styles.keysCell}>
                  {keys.map((k, i) => (
                    <span key={k}>
                      <kbd style={styles.kbd}>{k}</kbd>
                      {i < keys.length - 1 && <span style={styles.plus}>+</span>}
                    </span>
                  ))}
                </td>
                <td style={styles.descCell}>{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={styles.footer}>Presiona <kbd style={styles.kbd}>?</kbd> para cerrar</div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    zIndex: 500,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modal: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 12,
    boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
    minWidth: 340,
    maxWidth: "90vw",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 16px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  title: {
    fontSize: 12,
    letterSpacing: "0.05em",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono)",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    padding: 2,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    padding: "8px 0",
  },
  row: {
    borderBottom: "1px solid var(--border-subtle)",
  },
  keysCell: {
    padding: "9px 16px",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
  },
  kbd: {
    display: "inline-block",
    background: "var(--bg-elevated-2)",
    border: "1px solid var(--border-strong)",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    color: "var(--text-primary)",
    lineHeight: 1.5,
  },
  plus: {
    fontSize: 10,
    color: "var(--text-tertiary)",
    margin: "0 3px",
  },
  descCell: {
    padding: "9px 16px 9px 4px",
    fontSize: 12.5,
    fontFamily: "var(--font-serif)",
    color: "var(--text-secondary)",
  },
  footer: {
    padding: "10px 16px",
    fontSize: 11,
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-mono)",
    borderTop: "1px solid var(--border-subtle)",
  },
};
