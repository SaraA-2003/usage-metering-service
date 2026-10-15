//404
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
  }
}

//400
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
  }
}
//401
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
  }
}

//403
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
  }
}