import { useEffect, useState } from "react";
import {
  decodeHtmlEntities,
  formatRelativeShort,
  parseDaymapDate,
  stripHtml,
} from "../dates";
import { Icon } from "../icons";
import type { Dashboard, DaymapMessage } from "../types";
import { MessageDetail } from "./Messages";

export function Notices({
  dashboard,
  demo,
  obtaining,
}: {
  dashboard: Dashboard;
  demo: boolean;
  obtaining: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (selectedId !== null && dashboard.notices.some((notice) => notice.id === selectedId)) {
      return;
    }
    setSelectedId(dashboard.notices[0]?.id ?? null);
  }, [dashboard.notices, selectedId]);

  const selectedNotice =
    dashboard.notices.find((notice) => notice.id === selectedId) ?? null;

  return (
    <div className="notices-layout">
      <section className="notice-list-panel">
        <div className="notice-list-heading">
          <span>School notices</span>
          <span>{dashboard.notices.length}</span>
        </div>
        <div className="notice-list-scroll">
          {dashboard.notices.length === 0 ? (
            <div className="empty-state small message-empty">
              <Icon name="notices" size={31} />
              <strong>{obtaining ? "Obtaining notices…" : "No notices yet"}</strong>
              <span>
                {obtaining
                  ? "Daymap is still loading school notices."
                  : "Bulletins and announcements from your school will appear here."}
              </span>
            </div>
          ) : (
            dashboard.notices.map((notice) => (
              <NoticeCard
                key={notice.id}
                notice={notice}
                selected={notice.id === selectedId}
                onClick={() => setSelectedId(notice.id)}
              />
            ))
          )}
        </div>
      </section>

      <section className="message-detail-panel">
        {selectedNotice ? (
          <MessageDetail
            message={selectedNotice}
            schoolCode={dashboard.user.schoolCode}
            demo={demo}
            notice
          />
        ) : (
          <div className="empty-state">
            <Icon name="notices" size={38} />
            <strong>School notices</strong>
            <span>Bulletins and announcements from your school appear here.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function NoticeCard({
  notice,
  selected,
  onClick,
}: {
  notice: DaymapMessage;
  selected: boolean;
  onClick: () => void;
}) {
  const subject = decodeHtmlEntities(notice.subject);

  return (
    <button
      type="button"
      className={`notice-card ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <span className="notice-card-top">
        <span>{notice.senderName || "School"}</span>
        <span>{formatRelativeShort(parseDaymapDate(notice.sentOn))}</span>
      </span>
      <strong title={subject}>{subject}</strong>
      <span
        className="notice-preview"
        title={stripHtml(notice.text, 1_000) || undefined}
      >
        {stripHtml(notice.text, 160) || "No preview available."}
      </span>
      {notice.hasAttachments && (
        <span className="notice-attachment">
          <Icon name="paperclip" size={11} />
          Attachments
        </span>
      )}
    </button>
  );
}
