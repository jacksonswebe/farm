import { z } from 'zod';

export const actionTypeEnum = z.enum(['CORRECTIVE', 'PREVENTIVE']);
export const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const effectivenessEnum = z.enum(['EFFECTIVE', 'PARTIALLY_EFFECTIVE', 'NOT_EFFECTIVE']);

/**
 * The hierarchy of control, strongest first. This field is mandatory because
 * it is the one thing that distinguishes a safety system from a task list:
 * an organisation whose actions are all PPE and ADMINISTRATIVE is not
 * controlling risk, and the dashboard is meant to make that visible.
 */
export const hierarchyEnum = z.enum([
  'ELIMINATION',
  'SUBSTITUTION',
  'ENGINEERING',
  'ADMINISTRATIVE',
  'PPE',
]);

const futureDate = z.coerce
  .date()
  .refine((d) => d.getTime() > Date.now() - 24 * 60 * 60 * 1000, 'The due date must be in the future.');

export const createActionSchema = z.object({
  title: z.string().trim().min(5).max(300),
  description: z.string().trim().max(4000).optional(),
  actionType: actionTypeEnum,
  hierarchyLevel: hierarchyEnum,
  priority: priorityEnum.default('MEDIUM'),
  ownerUserId: z.string().uuid(),
  verifierUserId: z.string().uuid().optional(),
  dueDate: futureDate,
  incidentId: z.string().uuid().optional(),
  investigationId: z.string().uuid().optional(),
  findingId: z.string().uuid().optional(),
  rootCauseId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
});

export const listActionsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  owner: z.string().optional(), // a uuid, or 'me'
  status: z.string().optional(),
  overdue: z.coerce.boolean().optional(),
  site: z.string().uuid().optional(),
  incidentId: z.string().uuid().optional(),
  dueBefore: z.coerce.date().optional(),
});

export const progressUpdateSchema = z.object({
  note: z.string().trim().min(3).max(2000),
  progressPercent: z.number().int().min(0).max(100).optional(),
});

export const submitActionSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  evidenceAttachmentIds: z.array(z.string().uuid()).max(10).default([]),
});

export const verifyActionSchema = z.object({
  effectiveness: effectivenessEnum,
  comments: z.string().trim().max(2000).optional(),
});

export const rejectActionSchema = z.object({
  comments: z.string().trim().min(10, 'Tell the owner what is still outstanding.'),
});

export const requestExtensionSchema = z.object({
  requestedDueDate: futureDate,
  reason: z.string().trim().min(10, 'Give a reason a verifier can assess.'),
});

export const decideExtensionSchema = z.object({
  approved: z.boolean(),
  comments: z.string().trim().max(2000).optional(),
});

export const cancelActionSchema = z.object({
  reason: z.string().trim().min(10, 'Record why this action is no longer required.'),
});

export type CreateActionInput = z.infer<typeof createActionSchema>;
export type ListActionsInput = z.infer<typeof listActionsSchema>;
export type VerifyActionInput = z.infer<typeof verifyActionSchema>;
export type RequestExtensionInput = z.infer<typeof requestExtensionSchema>;
