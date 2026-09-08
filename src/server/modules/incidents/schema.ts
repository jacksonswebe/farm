import { z } from 'zod';

/**
 * One Zod schema per operation, shared by the client form and the route
 * handler. There is no second definition of "valid" to drift out of sync.
 */

export const reportTypeEnum = z.enum(['INCIDENT', 'NEAR_MISS', 'HAZARD', 'OBSERVATION']);
export const severityEnum = z.enum([
  'NEGLIGIBLE',
  'MINOR',
  'MODERATE',
  'MAJOR',
  'CATASTROPHIC',
]);
export const likelihoodEnum = z.enum([
  'RARE',
  'UNLIKELY',
  'POSSIBLE',
  'LIKELY',
  'ALMOST_CERTAIN',
]);

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const createIncidentSchema = z.object({
  reportType: reportTypeEnum,
  // 20 chars is the floor for a description an investigator can act on.
  description: z.string().trim().min(20, 'Describe what happened in at least 20 characters.'),
  siteId: z.string().uuid(),
  occurredAt: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + 60 * 60 * 1000, 'The event cannot be in the future.')
    .refine(
      (d) => d.getTime() >= Date.now() - NINETY_DAYS_MS,
      'Events older than 90 days must be entered by an HSE manager.',
    ),
  title: z.string().trim().max(200).optional(),
  departmentId: z.string().uuid().optional(),
  workArea: z.string().trim().max(200).optional(),
  severity: severityEnum.optional(),
  immediateAction: z.string().trim().max(2000).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  asDraft: z.boolean().default(false),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const classifyIncidentSchema = z.object({
  severity: severityEnum,
  likelihood: likelihoodEnum,
  categoryTermId: z.string().uuid().optional(),
  investigationRequired: z.boolean().optional(),
  reportableToAuthority: z.boolean().optional(),
});
export type ClassifyIncidentInput = z.infer<typeof classifyIncidentSchema>;

export const listIncidentsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  type: z.string().optional(),
  status: z.string().optional(),
  severity: z.string().optional(),
  site: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(200).optional(),
});
export type ListIncidentsInput = z.infer<typeof listIncidentsSchema>;

export const closeIncidentSchema = z.object({
  closureStatement: z.string().trim().min(10),
  lessonsLearned: z.string().trim().max(4000).optional(),
});
