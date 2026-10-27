/**
 * Fixed short field messages. They are the same text the server returns in
 * `error.fields` and the text the frontend shows before submitting, so both
 * ends stay consistent within one version (D-25).
 */
export const FIELD_MESSAGES = {
  NAME_TYPE: '看板名称必须是字符串',
  NAME_REQUIRED: '看板名称不能为空',
  NAME_TOO_LONG: '看板名称不能超过 50 个字符',
  NAME_INVALID_CHARS: '看板名称包含不支持的字符',

  TITLE_TYPE: '标题必须是字符串',
  TITLE_REQUIRED: '标题不能为空',
  TITLE_TOO_LONG: '标题不能超过 100 个字符',
  TITLE_INVALID_CHARS: '标题包含不支持的字符',

  DESCRIPTION_TYPE: '描述必须是字符串',
  DESCRIPTION_TOO_LONG: '描述不能超过 2000 个字符',
  DESCRIPTION_INVALID_CHARS: '描述包含不支持的字符',

  DUE_DATE_TYPE: '截止日期必须是字符串或 null',
  DUE_DATE_INVALID: '截止日期必须是 YYYY-MM-DD 格式的有效日期',

  ASSIGNEE_TYPE: '负责人必须是字符串或 null',
  ASSIGNEE_FORMAT: '负责人格式不正确',
  ASSIGNEE_NOT_FOUND: '负责人不存在',

  STATUS_TYPE: '状态必须是字符串',
  STATUS_INVALID: '状态只能是 todo、doing 或 done',

  MISSING_TITLE: '必须提供标题',
  MISSING_DESCRIPTION: '必须提供描述',
  MISSING_DUE_DATE: '必须提供截止日期（可为 null）',
  MISSING_ASSIGNEE: '必须提供负责人（可为 null）',
  MISSING_STATUS: '必须提供状态',
} as const;

export type FieldMessage = (typeof FIELD_MESSAGES)[keyof typeof FIELD_MESSAGES];