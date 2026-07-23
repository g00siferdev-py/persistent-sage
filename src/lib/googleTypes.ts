/** Shared types for the Google Workspace integration (mirrors src-tauri/src/google.rs). */

export type GoogleStatus = {
  enabled: boolean;
  connected: boolean;
  accountEmail: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  /** This build ships an app-level OAuth client — users sign in with one click. */
  hasBuiltinClient: boolean;
  /** The built-in client is active (no user override saved in Settings). */
  usingBuiltinClient: boolean;
  gmailEnabled: boolean;
  calendarEnabled: boolean;
  driveEnabled: boolean;
  agentToolsEnabled: boolean;
  agentSendEnabled: boolean;
};

export type GmailSummary = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
};

export type GmailFull = {
  id: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  body: string;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  location: string;
  description: string;
  htmlLink: string;
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  iconLink?: string;
};
