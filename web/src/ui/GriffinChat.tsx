import { ArrowUp, History, Plus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useBrand } from "../lib/brand";
import {
  appendGriffinMessage,
  createGriffinChat,
  deleteGriffinChat,
  ensureGriffinChat,
  getActiveGriffinChat,
  listGriffinChats,
  setActiveGriffinChat,
  type GriffinBlock,
  type GriffinChat,
  type GriffinMessage,
} from "../lib/griffin-chats";
import { BarChart, ProbList } from "./charts";
import styles from "./griffin-chat.module.css";

type SuggestItem = { label: string; ask?: string; to?: string };

type Props = {
  userId: string;
  path: string;
  branchCrmId: string;
};

function MessageBlocks({ blocks }: { blocks: GriffinBlock[] }) {
  return (
    <div className={styles.blocks}>
      {blocks.map((block) => (
        <div key={`${block.type}-${block.title}`} className={styles.block}>
          <span className={styles.blockTitle}>{block.title}</span>
          {block.type === "bars" ? <BarChart items={block.items} /> : null}
          {block.type === "probs" ? <ProbList items={block.items} /> : null}
          {block.type === "actions" ? (
            <div className={styles.actions}>
              {block.items.map((item) => (
                <article key={item.id}>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Bubble({ message }: { message: GriffinMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? styles.userBubble : styles.botBubble}>
      {isUser ? (
        <p>{message.text}</p>
      ) : (
        <div className={styles.md}>
          <Markdown
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {message.text}
          </Markdown>
        </div>
      )}
      {message.blocks && message.blocks.length > 0 ? <MessageBlocks blocks={message.blocks} /> : null}
    </div>
  );
}

export function GriffinChatPanel({ userId, path, branchCrmId }: Props) {
  const navigate = useNavigate();
  const brand = useBrand();
  const [chat, setChat] = useState<GriffinChat>(() => ensureGriffinChat(userId));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useQuery({
    queryKey: ["griffin-suggest", path],
    queryFn: () => api<{ items: SuggestItem[] }>(`/v1/griffin/suggest?path=${encodeURIComponent(path)}`),
  });

  const chats = listGriffinChats(userId);
  const canSend = draft.trim().length > 0 && !busy;

  useEffect(() => {
    setChat(ensureGriffinChat(userId));
  }, [userId]);

  useLayoutEffect(() => {
    const node = areaRef.current;
    if (!node) {
      return;
    }
    node.style.height = "0px";
    node.style.height = `${Math.min(160, Math.max(44, node.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    const node = listRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [chat.messages.length, busy]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) {
      return;
    }
    setBusy(true);
    setDraft("");
    const history = chat.messages.slice(-16).map((message) => ({ role: message.role, text: message.text }));
    const withUser = appendGriffinMessage(userId, chat.id, { role: "user", text: trimmed });
    if (withUser) {
      setChat(withUser);
    }
    try {
      const result = await api<{ text: string; blocks?: GriffinBlock[] }>("/v1/griffin/ask", {
        method: "POST",
        body: JSON.stringify({ text: trimmed, path, branchCrmId, history }),
      });
      const withBot = appendGriffinMessage(userId, chat.id, {
        role: "assistant",
        text: result.text,
        ...(result.blocks ? { blocks: result.blocks } : {}),
      });
      if (withBot) {
        setChat(withBot);
      }
    } catch (error) {
      const withErr = appendGriffinMessage(userId, chat.id, {
        role: "assistant",
        text: error instanceof Error ? error.message : "Не смог ответить.",
      });
      if (withErr) {
        setChat(withErr);
      }
    } finally {
      setBusy(false);
      areaRef.current?.focus();
    }
  };

  const empty = chat.messages.length === 0;

  return (
    <aside className={styles.panel}>
      <header className={styles.head}>
        <div>
          <h2>{brand.assistantName}</h2>
          <p className={styles.sub}>{chat.title === "Новый чат" ? "Новый разговор" : chat.title}</p>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className={styles.icon}
            title="История"
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <History size={18} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className={styles.icon}
            title="Новый чат"
            onClick={() => {
              setChat(createGriffinChat(userId));
              setHistoryOpen(false);
              setDraft("");
            }}
          >
            <Plus size={18} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {historyOpen ? (
        <div className={styles.history}>
          <div className={styles.historyHead}>
            <span>Чаты</span>
            <button type="button" className={styles.icon} onClick={() => setHistoryOpen(false)} aria-label="Закрыть">
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
          <div className={styles.historyList}>
            {chats.map((item) => (
              <div key={item.id} className={`${styles.historyRow} ${item.id === chat.id ? styles.on : ""}`}>
                <button
                  type="button"
                  className={styles.historyOpen}
                  onClick={() => {
                    const next = setActiveGriffinChat(userId, item.id) ?? getActiveGriffinChat(userId);
                    if (next) {
                      setChat(next);
                    }
                    setHistoryOpen(false);
                  }}
                >
                  <strong>{item.title}</strong>
                  <small>
                    {new Date(item.updatedAt).toLocaleString("ru-RU", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </button>
                <button
                  type="button"
                  className={styles.icon}
                  title="Удалить"
                  onClick={() => {
                    const next = deleteGriffinChat(userId, item.id);
                    if (next) {
                      setChat(next);
                    }
                  }}
                >
                  <X size={14} strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.thread} ref={listRef}>
        {empty ? (
          <div className={styles.welcome}>
            <p>Спроси про заявки, оплаты, зал или «что делать сегодня».</p>
            <div className={styles.starters}>
              {(suggestions.data?.items ?? []).map((item) => (
                <button
                  key={`${item.label}-${item.ask ?? item.to ?? ""}`}
                  type="button"
                  className={styles.starter}
                  onClick={() => {
                    if (item.ask) {
                      void send(item.ask);
                      return;
                    }
                    if (item.to) {
                      navigate(item.to);
                    }
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.messages.map((message) => <Bubble key={message.id} message={message} />)
        )}
        {busy ? <div className={styles.typing}>{brand.assistantThinkingLabel}</div> : null}
      </div>

      <div className={styles.composerWrap}>
        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            ref={areaRef}
            className={styles.area}
            value={draft}
            rows={1}
            placeholder={brand.assistantChatPlaceholder}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
          />
          {canSend ? (
            <button type="submit" className={styles.send} title="Отправить" aria-label="Отправить">
              <ArrowUp size={18} strokeWidth={2} />
            </button>
          ) : null}
        </form>
      </div>
    </aside>
  );
}
