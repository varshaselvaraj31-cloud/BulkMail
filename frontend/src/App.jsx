import React, { useCallback, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "/api" : "http://localhost:5001/api");

function getRecipientCount(value) {
  return new Set(value.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean)).size;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function request(path, options) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch {
    throw new Error(
      `Cannot reach the API at ${API_URL}. Make sure the backend is running and that its CLIENT_ORIGIN setting includes ${window.location.origin}.`,
    );
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || "The request could not be completed.");
  }
  return result;
}

function App() {
  const [credentials, setCredentials] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState("");
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const recipientCount = useMemo(() => getRecipientCount(recipients), [recipients]);

  const loadHistory = useCallback(async (authorization = credentials) => {
    if (!authorization) return;

    try {
      const result = await request("/emails", { headers: { Authorization: authorization } });
      setHistory(result.emails);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setLoadingHistory(false);
    }
  }, [credentials]);

  async function handleLogin(event) {
    event.preventDefault();
    setNotice(null);
    setLoggingIn(true);

    try {
      const authorization = `Basic ${window.btoa(`${loginUsername}:${loginPassword}`)}`;
      const result = await request("/emails", { headers: { Authorization: authorization } });
      setHistory(result.emails);
      setLoadingHistory(false);
      setCredentials(authorization);
      setLoginPassword("");
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setNotice(null);
    setSending(true);

    try {
      const result = await request("/emails", {
        method: "POST",
        headers: { Authorization: credentials },
        body: JSON.stringify({ subject, body, recipients }),
      });
      await loadHistory();
      setNotice({ type: "success", text: result.message });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
      await loadHistory();
    } finally {
      setSending(false);
    }
  }

  if (!credentials) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <a className="brand login-brand" href="/" aria-label="Bulk Mail home">
            <span className="brand-mark" aria-hidden="true">B</span>
            <span>bulk<span className="brand-accent">mail</span></span>
          </a>
          <p className="eyebrow">ADMIN WORKSPACE</p>
          <h1>Welcome back</h1>
          <p className="page-description">Sign in to compose campaigns and view email activity.</p>
          {notice && <div className={`notice ${notice.type}`} role="alert">{notice.text}</div>}
          <form className="login-form" onSubmit={handleLogin}>
            <label className="field-label" htmlFor="admin-username">Username</label>
            <input id="admin-username" autoComplete="username" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} required />
            <label className="field-label login-password-label" htmlFor="admin-password">Password</label>
            <input id="admin-password" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required />
            <button className="send-button login-button" type="submit" disabled={loggingIn}>
              {loggingIn ? <><span className="spinner" /> Signing in…</> : <>Sign in <span aria-hidden="true">↗</span></>}
            </button>
          </form>
          <p className="login-footnote">Admin credentials are configured on the backend.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bulk Mail home">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span>bulk<span className="brand-accent">mail</span></span>
        </a>
        <div className="topbar-actions">
          <span className="topbar-label"><span className="online-dot" /> Email workspace</span>
          <button type="button" className="logout-button" onClick={() => { setCredentials(""); setHistory([]); setNotice(null); }}>Sign out</button>
        </div>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">CAMPAIGN CENTER</p>
          <h1>Send a campaign</h1>
          <p className="page-description">Write your message, add your audience, and send it in a few clicks.</p>
        </div>
        <div className="heading-badge"><span aria-hidden="true">✦</span> Simple, thoughtful outreach</div>
      </section>

      {notice && (
        <div className={`notice ${notice.type}`} role="status">
          <span aria-hidden="true">{notice.type === "success" ? "✓" : "!"}</span>
          {notice.text}
          <button type="button" className="notice-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
        </div>
      )}

      <div className="content-grid">
        <section className="panel compose-panel" aria-labelledby="compose-title">
          <div className="panel-heading">
            <div className="panel-icon compose-icon" aria-hidden="true">✎</div>
            <div>
              <h2 id="compose-title">Compose email</h2>
              <p>Your recipients are kept private with BCC.</p>
            </div>
            <span className="step-pill">01 / COMPOSE</span>
          </div>

          <form onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="subject">Subject <span className="required">*</span></label>
            <input
              id="subject"
              name="subject"
              type="text"
              maxLength={200}
              placeholder="A clear subject your audience will love"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              required
            />
            <div className="input-hint">{subject.length}/200 characters</div>

            <label className="field-label recipients-label" htmlFor="recipients">Recipient emails <span className="required">*</span></label>
            <textarea
              id="recipients"
              name="recipients"
              className="recipients-input"
              placeholder={"hello@example.com, team@example.com\nOr paste addresses on separate lines"}
              value={recipients}
              onChange={(event) => setRecipients(event.target.value)}
              required
            />
            <div className="input-hint recipients-hint">
              <span>Separate addresses with commas, spaces, or new lines.</span>
              <span className={recipientCount > 100 ? "count-over" : ""}>{recipientCount} / 100 recipients</span>
            </div>

            <label className="field-label body-label" htmlFor="body">Email body <span className="required">*</span></label>
            <textarea
              id="body"
              name="body"
              className="body-input"
              maxLength={20000}
              placeholder={"Hi there,\n\nWrite your message here..."}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
            />
            <div className="input-hint body-hint">{body.length}/20,000 characters</div>

            <div className="form-footer">
              <p><span aria-hidden="true">ⓘ</span> Messages are sent using your configured mail account.</p>
              <button className="send-button" type="submit" disabled={sending || recipientCount > 100}>
                {sending ? <><span className="spinner" /> Sending…</> : <>Send campaign <span aria-hidden="true">↗</span></>}
              </button>
            </div>
          </form>
        </section>

        <aside className="panel history-panel" aria-labelledby="history-title">
          <div className="panel-heading history-heading">
            <div className="panel-icon history-icon" aria-hidden="true">↻</div>
            <div>
              <h2 id="history-title">Recent activity</h2>
              <p>Your latest campaign attempts</p>
            </div>
            <button type="button" className="refresh-button" onClick={() => { setLoadingHistory(true); loadHistory(); }} aria-label="Refresh history">↻</button>
          </div>

          <div className="history-list">
            {loadingHistory ? (
              <div className="empty-state"><span className="spinner dark-spinner" /> Loading activity…</div>
            ) : history.length === 0 ? (
              <div className="empty-state">
                <span className="empty-illustration" aria-hidden="true">✉</span>
                <strong>No campaigns yet</strong>
                <span>Your sent emails will show up here.</span>
              </div>
            ) : (
              history.map((email) => (
                <article className="history-item" key={email._id}>
                  <div className={`status-mark ${email.status}`} aria-label={email.status}>
                    {email.status === "sent" ? "✓" : email.status === "failed" ? "!" : "…"}
                  </div>
                  <div className="history-details">
                    <h3 title={email.subject}>{email.subject}</h3>
                    <p>{email.recipientCount} recipient{email.recipientCount === 1 ? "" : "s"} <span>·</span> {formatDate(email.createdAt)}</p>
                    {email.status === "failed" && <p className="history-error">{email.error || "Delivery failed"}</p>}
                  </div>
                  <span className={`status-label ${email.status}`}>{email.status}</span>
                </article>
              ))
            )}
          </div>

          <div className="privacy-note">
            <span aria-hidden="true">◈</span>
            <p><strong>Privacy first</strong><br />Recipients are added as BCC so each person’s email address stays private.</p>
          </div>
        </aside>
      </div>

      <footer className="page-footer">Made for meaningful messages <span aria-hidden="true">♥</span></footer>
    </main>
  );
}

export default App;
