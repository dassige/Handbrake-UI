export class HttpError extends Error {
  /** code: optional machine-readable reason, sent to the client next to the message. */
  constructor(statusCode, message, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = code;
  }
}

export const badRequest = (msg, code) => new HttpError(400, msg, code);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);
export const unauthorized = (msg, code) => new HttpError(401, msg, code);
export const forbidden = (msg, code) => new HttpError(403, msg, code);
