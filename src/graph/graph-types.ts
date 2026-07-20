export interface OutlookMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  from?: {
    emailAddress?: {
      name?: string;
      address?: string;
    };
  };
  receivedDateTime: string;
  importance: "low" | "normal" | "high";
  isRead: boolean;
  flag?: {
    flagStatus?: "notFlagged" | "complete" | "flagged";
  };
  categories?: string[];
  parentFolderId?: string;
}

export interface MailFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount?: number;
  totalItemCount?: number;
}

export interface GraphListResponse<T> {
  value: T[];
  "@odata.nextLink"?: string;
  "@odata.count"?: number;
}

export interface BatchRequest {
  id: string;
  method: string;
  url: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface BatchResponse {
  id: string;
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface BatchResult {
  responses: BatchResponse[];
}

export type GraphErrorCode =
  | "ErrorItemNotFound"
  | "ErrorInvalidRequest"
  | "ErrorAccessDenied"
  | "TooManyRequests"
  | "ServiceNotAvailable"
  | "Throttled";
