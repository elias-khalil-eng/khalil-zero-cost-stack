// Mirrors the C# AppExceptionMiddleware contract: every error becomes a JSON
// body of { status, detail } with the matching HTTP status code.

export class HttpError extends Error {
  status: number
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
  }
}

export class ValidationError extends HttpError {
  constructor(errors: string[]) {
    super(400, errors.join(' '))
  }
}

export class NotFoundError extends HttpError {
  constructor(detail: string) {
    super(404, detail)
  }
}

export class ConfigurationError extends HttpError {
  constructor(detail: string) {
    super(503, detail)
  }
}
