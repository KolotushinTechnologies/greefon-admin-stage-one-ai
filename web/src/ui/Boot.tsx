import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { markBootShown } from "../lib/activity";
import { useBrand } from "../lib/brand";
import styles from "./boot.module.css";

type Props = {
  branchCrmId: string;
  onDone: () => void;
};

export function BootSplash({ branchCrmId, onDone }: Props) {
  const brand = useBrand();
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);

  const steps = useMemo(
    () => [
      "Поднимаем штаб",
      "Сверяем филиалы",
      "Тянем людей и оплаты",
      "Считаем вероятности дня",
      `${brand.assistantName} на связи`,
    ],
    [brand.assistantName],
  );

  useEffect(() => {
    let alive = true;
    const timers = steps.map((_, index) =>
      window.setTimeout(() => {
        if (alive) {
          setStep(index);
        }
      }, 380 + index * 520),
    );

    const branchQ = branchCrmId ? `?branchCrmId=${encodeURIComponent(branchCrmId)}` : "";
    const payQ = branchCrmId ? `&branchCrmId=${encodeURIComponent(branchCrmId)}` : "";

    void Promise.allSettled([
      client.prefetchQuery({ queryKey: ["me"], queryFn: () => api("/v1/me") }),
      client.prefetchQuery({
        queryKey: ["today", branchCrmId],
        queryFn: () => api(`/v1/today${branchQ}`),
      }),
      client.prefetchQuery({
        queryKey: ["insights", branchCrmId],
        queryFn: () => api(`/v1/insights${branchQ}`),
      }),
      client.prefetchQuery({ queryKey: ["halls"], queryFn: () => api("/v1/branches") }),
      client.prefetchQuery({ queryKey: ["groups"], queryFn: () => api("/v1/groups") }),
      client.prefetchQuery({
        queryKey: ["payments", "all", "", branchCrmId],
        queryFn: () => api(`/v1/payments?purpose=all&limit=40${payQ}`),
      }),
    ]).then(() => {
      if (alive) {
        setReady(true);
        setStep(steps.length - 1);
      }
    });

    return () => {
      alive = false;
      for (const id of timers) {
        window.clearTimeout(id);
      }
    };
  }, [branchCrmId, client, steps]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const id = window.setTimeout(() => {
      markBootShown();
      onDone();
    }, 700);
    return () => window.clearTimeout(id);
  }, [ready, onDone]);

  return (
    <div className={styles.boot}>
      <div className={styles.glow} />
      <img className={styles.wing} src="/greefon-wing.svg" alt="" />
      <div className={styles.brand}>{brand.productName}</div>
      <p className={styles.line}>{steps[step]}</p>
      <div className={styles.bar}>
        <i style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
      </div>
    </div>
  );
}
