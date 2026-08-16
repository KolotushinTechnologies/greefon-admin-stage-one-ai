import styles from "./charts.module.css";

export type BarItem = { id: string; label: string; value: number; tone?: "accent" | "gold" | "ok" | "danger" };
export type ProbItem = { id: string; label: string; p: number; note?: string };

export function BarChart({ items, max }: { items: BarItem[]; max?: number }) {
  const peak = max ?? Math.max(1, ...items.map((item) => item.value));
  return (
    <div className={styles.bars}>
      {items.map((item) => (
        <div key={item.id} className={styles.barRow}>
          <div className={styles.barMeta}>
            <span>{item.label}</span>
            <b>{item.value.toLocaleString("ru-RU")}</b>
          </div>
          <div className={styles.track}>
            <div
              className={`${styles.fill} ${styles[item.tone ?? "accent"]}`}
              style={{ width: `${Math.max(4, (item.value / peak) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Donut({
  segments,
  center,
}: {
  segments: Array<{ id: string; label: string; value: number; color: string }>;
  center?: string;
}) {
  const total = Math.max(1, segments.reduce((sum, item) => sum + item.value, 0));
  let offset = 0;
  const stops = segments
    .map((item) => {
      const start = offset;
      const share = (item.value / total) * 100;
      offset += share;
      return `${item.color} ${start}% ${offset}%`;
    })
    .join(", ");

  return (
    <div className={styles.donutWrap}>
      <div className={styles.donut} style={{ background: `conic-gradient(${stops})` }}>
        <div className={styles.donutHole}>{center ?? `${total}`}</div>
      </div>
      <ul className={styles.legend}>
        {segments.map((item) => (
          <li key={item.id}>
            <i style={{ background: item.color }} />
            <span>{item.label}</span>
            <b>{Math.round((item.value / total) * 100)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProbList({ items }: { items: ProbItem[] }) {
  return (
    <div className={styles.probs}>
      {items.map((item) => (
        <div key={item.id} className={styles.prob}>
          <div className={styles.barMeta}>
            <span>{item.label}</span>
            <b>{Math.round(item.p * 100)}%</b>
          </div>
          <div className={styles.track}>
            <div className={`${styles.fill} ${styles.gold}`} style={{ width: `${Math.max(4, item.p * 100)}%` }} />
          </div>
          {item.note ? <p>{item.note}</p> : null}
        </div>
      ))}
    </div>
  );
}
