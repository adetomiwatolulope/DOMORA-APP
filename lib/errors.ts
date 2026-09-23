export type ErrorKind =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "config";

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }

  static badRequest(message: string): ApiError {
    return new ApiError("bad_request", 400, message);
  }

  static unauthorized(message = "Authentication required"): ApiError {
    return new ApiError("unauthorized", 401, message);
  }

  static forbidden(message = "Not permitted"): ApiError {
    return new ApiError("forbidden", 403, message);
  }

  static notFound(message = "Not found"): ApiError {
    return new ApiError("not_found", 404, message);
  }

  static conflict(message = "Conflict"): ApiError {
    return new ApiError("conflict", 409, message);
  }

  static config(message: string): ApiError {
    return new ApiError("config", 500, message);
  }
}