import { useEffect, useMemo, useState } from "react";
import { errorText, invoke, listen, openExternal } from "../api";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  decodeHtmlEntities,
  formatFullStamp,
  formatRelativeShort,
  parseDaymapDate,
  stripHtml,
} from "../dates";
import { Icon, type IconName } from "../icons";
import type {
  Dashboard,
  DaymapMessage,
  MessageFolder,
  MessagePerson,
} from "../types";

const DEFAULT_FOLDERS: MessageFolder[] = [
  { id: "1", title: "Inbox", folderType: 1, itemCount: 0 },
  { id: "2", title: "Sent", folderType: 2, itemCount: 0 },
  { id: "3", title: "Archived", folderType: 1, itemCount: 0 },
  { id: "10", title: "Email and SMS", folderType: 10, itemCount: 0 },
];

interface Attachment {
  id: number;
  name: string;
}

interface MessagesProps {
  dashboard: Dashboard;
  demo: boolean;
  obtaining: boolean;
  onMarkRead: (messageId: number) => void;
  onRefresh: () => void;
}

export function Messages({
  dashboard,
  demo,
  obtaining,
  onMarkRead,
  onRefresh,
}: MessagesProps) {
  const [folders, setFolders] = useState<MessageFolder[]>(DEFAULT_FOLDERS);
  const [folderId, setFolderId] = useState("1");
  const [folderMessages, setFolderMessages] = useState<DaymapMessage[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [loadingFolder, setLoadingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeRecipients, setComposeRecipients] = useState<MessagePerson[]>([]);
  const [peopleFor, setPeopleFor] = useState<DaymapMessage | null>(null);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    void invoke<MessageFolder[]>("load_message_folders")
      .then((loaded) => {
        if (!cancelled && loaded.length > 0) setFolders(loaded);
      })
      .catch(() => {
        // The built-in folders still make the inbox usable if this request fails.
      });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  useEffect(() => {
    setFolderError(null);
    setReadError(null);
    if (folderId === "1") {
      setLoadingFolder(false);
      setFolderMessages([]);
      return;
    }
    if (demo) {
      setFolderMessages([]);
      setSelectedId(null);
      setLoadingFolder(false);
      return;
    }

    let cancelled = false;
    setLoadingFolder(true);
    setFolderMessages([]);
    setSelectedId(null);
    void (async () => {
      try {
        const loaded = await invoke<DaymapMessage[]>("load_folder_messages", {
          folderId,
        });
        if (cancelled) return;
        const sorted = sortMessages(loaded);
        setFolderMessages(sorted);
        setSelectedId(sorted[0]?.id ?? null);
      } catch (cause) {
        if (!cancelled) setFolderError(errorText(cause));
      } finally {
        if (!cancelled) setLoadingFolder(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, demo]);

  const availableFolders = folders.length > 0 ? folders : DEFAULT_FOLDERS;
  const displayed = useMemo(
    () => sortMessages(folderId === "1" ? dashboard.messages : folderMessages),
    [dashboard.messages, folderId, folderMessages],
  );
  const selectedMessage = displayed.find((message) => message.id === selectedId) ?? null;
  const currentFolder =
    availableFolders.find((folder) => folder.id === folderId) ?? availableFolders[0];

  useEffect(() => {
    if (folderId !== "1") return;
    if (selectedId !== null && dashboard.messages.some((message) => message.id === selectedId)) {
      return;
    }
    setSelectedId(dashboard.messages[0]?.id ?? null);
  }, [dashboard.messages, folderId, selectedId]);

  useEffect(() => {
    if (demo || !selectedMessage || selectedMessage.read) return;
    let cancelled = false;
    void (async () => {
      try {
        await invoke<MessagePerson[]>("load_message_recipients", {
          messageId: selectedMessage.id,
        });
        if (cancelled) return;
        if (folderId === "1") {
          onMarkRead(selectedMessage.id);
        } else {
          setFolderMessages((current) =>
            current.map((message) =>
              message.id === selectedMessage.id ? { ...message, read: true } : message,
            ),
          );
        }
      } catch (cause) {
        if (!cancelled) setReadError(errorText(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, folderId, onMarkRead, selectedMessage]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return displayed;
    return displayed.filter(
      (message) =>
        decodeHtmlEntities(message.subject).toLowerCase().includes(term) ||
        (message.senderName ?? "").toLowerCase().includes(term) ||
        stripHtml(message.text, 500).toLowerCase().includes(term),
    );
  }, [displayed, query]);

  const selectFolder = (next: string) => {
    if (next === folderId) return;
    setFolderId(next);
    setSelectedId(null);
    setReadError(null);
    setFolderError(null);
  };

  const openCompose = (recipients: MessagePerson[] = []) => {
    setComposeRecipients(recipients);
    setComposing(true);
    if (!demo) {
      // Ensure older cache files get their message-thread participant index rebuilt.
      void invoke("sync_mailbox").catch(() => {});
    }
  };

  const closeCompose = () => {
    setComposing(false);
    setComposeRecipients([]);
  };

  let emptyIcon: IconName = "inbox";
  if (folderId === "2") emptyIcon = "sent";
  if (folderId === "3") emptyIcon = "archive";
  if (folderId === "10") emptyIcon = "mail";

  return (
    <div className="messages-layout">
      <section className="message-list-panel">
        <div className="message-controls">
          <div className="message-search-row">
            <div className="search-field">
              <Icon name="search" size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search messages"
                aria-label="Search messages"
              />
              {query && (
                <button
                  type="button"
                  className="clear-search"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>
            <button
              type="button"
              className="compose-button"
              onClick={() => openCompose()}
              disabled={demo}
              title={demo ? "Sending is disabled in sample mode" : "New message"}
              aria-label="New message"
            >
              <Icon name="compose" size={17} />
            </button>
          </div>

          <div className="folder-strip" role="tablist" aria-label="Message folders">
            {availableFolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                role="tab"
                aria-selected={folder.id === folderId}
                className={`folder-chip ${folder.id === folderId ? "active" : ""}`}
                onClick={() => selectFolder(folder.id)}
              >
                <Icon name={folderIcon(folder)} size={13} />
                <span>{folder.title}</span>
              </button>
            ))}
          </div>

          {(folderError || readError) && (
            <div className="inline-error" role="alert">
              <Icon name="warning" size={13} />
              <span>{folderError ?? readError}</span>
            </div>
          )}
        </div>

        <div className="message-list-scroll">
          {loadingFolder ? (
            <div className="message-list-loading">
              <span className="spinner" />
              <span>Obtaining {currentFolder?.title ?? "messages"}…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state small message-empty">
              <Icon name={emptyIcon} size={31} />
              <strong>
                {query
                  ? "No matching messages"
                  : obtaining && folderId === "1"
                    ? "Obtaining messages…"
                    : folderId === "1"
                      ? "Inbox is empty"
                      : `${currentFolder?.title ?? "Folder"} is empty`}
              </strong>
              <span>
                {query
                  ? "Try a different subject, sender or phrase."
                  : obtaining && folderId === "1"
                    ? "Daymap is still loading your inbox."
                    : folderId === "2"
                      ? "Messages you send will appear here."
                      : folderId === "3"
                        ? "Archived messages will appear here."
                        : folderId === "10"
                          ? "Messages sent by email and SMS will appear here."
                          : "Messages in this folder will appear here."}
              </span>
            </div>
          ) : (
            filtered.map((message) => (
              <button
                key={message.id}
                type="button"
                className={`message-list-row ${message.id === selectedId ? "selected" : ""} ${
                  message.read ? "" : "unread"
                }`}
                onClick={() => setSelectedId(message.id)}
              >
                <span className={`unread-dot ${message.read ? "read" : ""}`} />
                <span className="message-list-copy">
                  <span className="message-list-meta">
                    <strong>{message.senderName || "Daymap"}</strong>
                    <span>{formatRelativeShort(parseDaymapDate(message.sentOn))}</span>
                  </span>
                  <span
                    className="message-list-subject"
                    title={decodeHtmlEntities(message.subject)}
                  >
                    {decodeHtmlEntities(message.subject)}
                  </span>
                  <span
                    className="message-list-preview"
                    title={stripHtml(message.text, 1_000) || undefined}
                  >
                    {stripHtml(message.text, 140) || "No preview available."}
                  </span>
                </span>
                <span className="message-row-flags">
                  {message.hasAttachments && <Icon name="paperclip" size={11} />}
                  {message.threadCount > 1 && (
                    <span className="thread-count">{message.threadCount}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="message-detail-panel">
        {selectedMessage ? (
          <MessageDetail
            message={selectedMessage}
            schoolCode={dashboard.user.schoolCode}
            demo={demo}
            onPeople={() => setPeopleFor(selectedMessage)}
            onRefresh={onRefresh}
          />
        ) : (
          <div className="empty-state">
            <Icon name="mail" size={38} />
            <strong>Select a message</strong>
            <span>Choose a message to read it here. Attachments open in Daymap.</span>
          </div>
        )}
      </section>

      {composing && (
        <ComposeModal
          demo={demo}
          initialRecipients={composeRecipients}
          onClose={closeCompose}
          onSent={() => {
            closeCompose();
            onRefresh();
          }}
        />
      )}

      {peopleFor && (
        <PeopleModal
          message={peopleFor}
          demo={demo}
          onClose={() => setPeopleFor(null)}
          onCompose={(recipients) => {
            setPeopleFor(null);
            openCompose(recipients);
          }}
        />
      )}
    </div>
  );
}

interface MessageDetailProps {
  message: DaymapMessage;
  schoolCode?: string | null;
  demo: boolean;
  notice?: boolean;
  onPeople?: () => void;
  onRefresh?: () => void;
}

export function MessageDetail({
  message,
  schoolCode,
  demo,
  notice = false,
  onPeople,
  onRefresh,
}: MessageDetailProps) {
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    setReplyText("");
    setSendError(null);
  }, [message.id]);

  const sender = message.senderName || "Daymap";
  const subject = decodeHtmlEntities(message.subject);
  const body = stripHtml(message.text, 200_000) || "This message has no text.";
  const allowReply = !notice && Boolean(onRefresh);
  const meta = [message.sentTo, formatFullStamp(parseDaymapDate(message.sentOn))]
    .filter(Boolean)
    .join(" · ");

  const openInDaymap = () => {
    const code = (schoolCode ?? "").toLowerCase();
    if (!code) return;
    void openExternal(
      `https://${code}.daymap.net/daymap/coms/message.aspx?id=${message.id}`,
    );
  };

  const attach = async () => {
    if (demo || attaching) return;
    setSendError(null);
    try {
      const picked = await openDialog({
        multiple: true,
        directory: false,
        title: "Attach files",
      });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) return;
      setAttaching(true);
      const next = [...attachments];
      for (const path of paths) {
        const id = await invoke<number>("upload_message_attachment", { path });
        next.push({ id, name: path.split(/[\\/]/).pop() ?? "Attachment" });
        setAttachments([...next]);
      }
    } catch (cause) {
      setSendError(errorText(cause));
    } finally {
      setAttaching(false);
    }
  };

  const sendReply = async () => {
    const clean = replyText.trim();
    if ((!clean && attachments.length === 0) || !onRefresh || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await invoke("send_reply", {
        text: clean,
        messageId: message.id,
        attachmentIds: attachments.map((file) => file.id),
      });
      setReplyText("");
      setAttachments([]);
      onRefresh();
    } catch (cause) {
      setSendError(errorText(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="message-detail">
      <div className="message-detail-scroll">
        <div className="message-detail-inner">
          <div className="message-detail-head">
            <div className="avatar detail-avatar">{initialsFromName(sender)}</div>
            <div className="message-detail-meta">
              <strong>{sender}</strong>
              <span>{meta || "Daymap"}</span>
            </div>
            <div className="message-detail-actions">
              {!notice && !message.read && <span className="pill unread-pill">UNREAD</span>}
              {!notice && message.sentTo && onPeople && (
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={onPeople}
                  disabled={demo}
                  title="See everyone this message was sent to"
                >
                  <Icon name="people" size={13} />
                  <span>People</span>
                </button>
              )}
            </div>
          </div>

          <h2 className="message-detail-subject" title={subject}>
            {subject}
          </h2>

          <div className="message-detail-divider" />

          <div className="message-body">{body}</div>

          {message.hasAttachments && (
            <div className="attachment-note">
              <Icon name="paperclip" size={15} />
              <span>This message has attachments. Open it in Daymap to view them.</span>
            </div>
          )}

          <div className="message-detail-footer">
            <button
              type="button"
              className="secondary-button"
              onClick={openInDaymap}
              disabled={!schoolCode}
            >
              <Icon name="external" size={14} />
              <span>Open in Daymap</span>
            </button>
          </div>
        </div>
      </div>

      {allowReply && (
        <div className="reply-composer">
          <div className="reply-heading">
            <span>
              <Icon name="reply" size={14} />
              Reply
            </span>
            {sending && <span className="spinner" />}
          </div>
          <textarea
            className="reply-textarea"
            value={replyText}
            onChange={(event) => setReplyText(event.target.value)}
            placeholder="Write a reply…"
            aria-label="Reply text"
          />
          <div className="attach-row">
            <button
              type="button"
              className="link-button attach-button"
              onClick={() => void attach()}
              disabled={demo || attaching}
            >
              <Icon name="paperclip" size={13} />
              <span>{attaching ? "Uploading…" : "Attach files"}</span>
            </button>
            {attachments.map((file) => (
              <span key={file.id} className="attachment-chip">
                {file.name}
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== file.id),
                    )
                  }
                >
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
          </div>
          {sendError && (
            <div className="inline-error">
              <Icon name="warning" size={13} />
              <span>{sendError}</span>
            </div>
          )}
          <div className="reply-actions">
            <span>Replying to {sender}</span>
            <button
              type="button"
              className="small-primary"
              onClick={() => void sendReply()}
              disabled={demo || sending || (!replyText.trim() && attachments.length === 0)}
            >
              {sending ? "Sending…" : "Send Reply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ComposeModal({
  demo,
  initialRecipients,
  onClose,
  onSent,
}: {
  demo: boolean;
  initialRecipients: MessagePerson[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessagePerson[]>([]);
  const [recipients, setRecipients] = useState<MessagePerson[]>(initialRecipients);
  const [text, setText] = useState("");
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peopleVersion, setPeopleVersion] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (demo) return;
    let active = true;
    let stop = () => {};
    void listen<boolean>("people-updated", () => {
      if (active) setPeopleVersion((value) => value + 1);
    }).then((unlisten) => {
      if (active) stop = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      stop();
    };
  }, [demo]);

  useEffect(() => {
    const term = query.trim();
    setResults([]);
    if (demo || term.length < 3) {
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const found = await invoke<MessagePerson[]>("search_contacts", { term });
          if (!cancelled) setResults(found);
        } catch (cause) {
          if (!cancelled) setError(errorText(cause));
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [demo, peopleVersion, query]);

  const add = (person: MessagePerson) => {
    if (recipients.some((recipient) => recipient.id === person.id)) return;
    setRecipients((current) => [...current, person]);
    setQuery("");
    setResults([]);
  };

  const attach = async () => {
    if (demo || attaching) return;
    setError(null);
    try {
      const picked = await openDialog({
        multiple: true,
        directory: false,
        title: "Attach files",
      });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) return;
      setAttaching(true);
      const next = [...attachments];
      for (const path of paths) {
        const id = await invoke<number>("upload_message_attachment", { path });
        next.push({ id, name: path.split(/[\\/]/).pop() ?? "Attachment" });
        setAttachments([...next]);
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setAttaching(false);
    }
  };

  const canSend =
    !sending &&
    !demo &&
    recipients.length > 0 &&
    (text.trim().length > 0 || attachments.length > 0);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await invoke("send_new_message", {
        text: text.trim(),
        contactIds: recipients.map((recipient) => recipient.id),
        attachmentIds: attachments.map((file) => file.id),
      });
      onSent();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card compose-modal" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <div className="modal-head">
          <div>
            <h2 id="compose-title">New Message</h2>
            <p>Send a message through Daymap.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={17} />
          </button>
        </div>

        <div className="modal-body compose-body">
          {demo && (
            <div className="inline-note">
              <Icon name="info" size={14} />
              <span>Sending is disabled in sample mode.</span>
            </div>
          )}

          <label className="compose-label">To</label>
          {recipients.length > 0 && (
            <div className="contact-chips">
              {recipients.map((recipient) => (
                <span key={recipient.id} className="contact-chip">
                  {recipient.title}
                  <button
                    type="button"
                    onClick={() =>
                      setRecipients((current) =>
                        current.filter((person) => person.id !== recipient.id),
                      )
                    }
                    aria-label={`Remove ${recipient.title}`}
                  >
                    <Icon name="close" size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="search-field contact-search">
            <Icon name="search" size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Add contacts by name (minimum 3 characters)"
              aria-label="Search contacts"
              disabled={demo}
            />
            {searching && <span className="spinner" />}
          </div>

          {results.length > 0 && (
            <div className="contact-results">
              {results
                .filter(
                  (person) =>
                    !recipients.some((recipient) => recipient.id === person.id),
                )
                .slice(0, 8)
                .map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    className="contact-result"
                    onClick={() => add(person)}
                  >
                    <span className="avatar person-avatar">{initialsFromName(person.title)}</span>
                    <span>
                      <strong>{person.title}</strong>
                      <small>{person.typeLabel} · ID {person.id}</small>
                    </span>
                    <Icon name="plus" size={15} />
                  </button>
                ))}
            </div>
          )}
          {!searching &&
            query.trim().length >= 3 &&
            !demo &&
            results.every((person) =>
              recipients.some((recipient) => recipient.id === person.id),
            ) && <span className="compose-hint">No matching contacts.</span>}

          <label className="compose-label" htmlFor="compose-message">
            Message
          </label>
          <textarea
            id="compose-message"
            className="compose-textarea"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Write your message…"
          />

          <div className="attach-row">
            <button
              type="button"
              className="link-button attach-button"
              onClick={() => void attach()}
              disabled={demo || attaching}
            >
              <Icon name="paperclip" size={13} />
              <span>{attaching ? "Uploading…" : "Attach files"}</span>
            </button>
            {attachments.map((file) => (
              <span key={file.id} className="attachment-chip">
                {file.name}
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== file.id),
                    )
                  }
                >
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
          </div>

          {error && (
            <div className="inline-error">
              <Icon name="warning" size={13} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span>{text.length} characters</span>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="small-primary"
              onClick={() => void send()}
              disabled={!canSend}
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PeopleModal({
  message,
  demo,
  onClose,
  onCompose,
}: {
  message: DaymapMessage;
  demo: boolean;
  onClose: () => void;
  onCompose: (recipients: MessagePerson[]) => void;
}) {
  const [people, setPeople] = useState<MessagePerson[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demo) {
      setError("Recipient details are unavailable in sample mode.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await invoke<MessagePerson[]>("load_message_recipients", {
          messageId: message.id,
        });
        if (!cancelled) setPeople(loaded);
      } catch (cause) {
        if (!cancelled) setError(errorText(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, message.id]);

  const sorted = useMemo(
    () =>
      [...people].sort((left, right) =>
        left.title.localeCompare(right.title),
      ),
    [people],
  );
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter(
      (person) =>
        person.title.toLowerCase().includes(term) ||
        person.typeLabel.toLowerCase().includes(term) ||
        String(person.id).includes(term),
    );
  }, [query, sorted]);
  const allSelected = people.length > 0 && selectedIds.size === people.length;
  const selected = sorted.filter((person) => selectedIds.has(person.id));

  const toggle = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card people-modal" role="dialog" aria-modal="true" aria-labelledby="people-title">
        <div className="modal-head">
          <div>
            <h2 id="people-title">People</h2>
            <p>{message.sentTo || "Everyone on this message"}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={17} />
          </button>
        </div>

        <div className="modal-body people-body">
          {loading ? (
            <div className="message-list-loading">
              <span className="spinner" />
              <span>Loading people…</span>
            </div>
          ) : error ? (
            <div className="inline-error">
              <Icon name="warning" size={14} />
              <span>{error}</span>
            </div>
          ) : people.length === 0 ? (
            <div className="empty-state small">
              <Icon name="people" size={30} />
              <strong>No people returned</strong>
              <span>Daymap didn't provide the recipient list for this message.</span>
            </div>
          ) : (
            <>
              <div className="search-field">
                <Icon name="search" size={14} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search people"
                  aria-label="Search people"
                />
              </div>
              <div className="people-summary">
                <span>
                  {people.length} recipients
                  {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
                </span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    setSelectedIds(
                      allSelected ? new Set() : new Set(people.map((person) => person.id)),
                    )
                  }
                >
                  {allSelected ? "Clear All" : "Select All"}
                </button>
              </div>
              <div className="people-list">
                {filtered.map((person) => {
                  const checked = selectedIds.has(person.id);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      className={`people-row ${checked ? "selected" : ""}`}
                      onClick={() => toggle(person.id)}
                    >
                      <span className={`check-circle ${checked ? "checked" : ""}`}>
                        {checked && <Icon name="check" size={11} />}
                      </span>
                      <span className="avatar person-avatar">
                        {initialsFromName(person.title)}
                      </span>
                      <span className="people-copy">
                        <strong>{person.title}</strong>
                        <small>{person.typeLabel} · ID {person.id}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {!loading && !error && people.length > 0 && (
          <div className="modal-footer">
            <span>{selectedIds.size} selected</span>
            <button
              type="button"
              className="small-primary"
              onClick={() => onCompose(selected)}
              disabled={selected.length === 0 || demo}
            >
              <Icon name="compose" size={13} />
              Message Selected
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function sortMessages(messages: DaymapMessage[]): DaymapMessage[] {
  return [...messages].sort(
    (left, right) =>
      (parseDaymapDate(right.sentOn)?.getTime() ?? 0) -
      (parseDaymapDate(left.sentOn)?.getTime() ?? 0),
  );
}

function folderIcon(folder: MessageFolder): IconName {
  const title = folder.title.toLowerCase();
  if (title.includes("sent")) return "sent";
  if (title.includes("archiv")) return "archive";
  if (title.includes("email") || title.includes("sms")) return "mail";
  return "inbox";
}

function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase() ?? "").join("") || "DM";
}
