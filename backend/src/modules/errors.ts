/** Domain failures that the HTTP layer maps to fixed status codes. */

/** The resource does not exist, or a task does not belong to the board in the URL. */
export class NotFoundError extends Error {
  constructor(message = 'resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** The referenced member does not exist; mapped to 422 with an assigneeId field. */
export class AssigneeNotFoundError extends Error {
  constructor(message = 'assignee not found') {
    super(message);
    this.name = 'AssigneeNotFoundError';
  }
}