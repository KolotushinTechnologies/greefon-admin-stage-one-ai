export class DomainError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class AccessDeniedError extends DomainError {
  constructor(message = "У тебя нет доступа к этому действию.") {
    super(message, "ACCESS_DENIED");
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Не нашёл такую запись.") {
    super(message, "NOT_FOUND");
  }
}

export class AmbiguousTargetError extends DomainError {
  constructor(message: string) {
    super(message, "AMBIGUOUS_TARGET");
  }
}

export class ConfirmationRequiredError extends DomainError {
  readonly confirmationId: string;

  constructor(message: string, confirmationId: string) {
    super(message, "CONFIRMATION_REQUIRED");
    this.confirmationId = confirmationId;
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, "CONFLICT");
  }
}
