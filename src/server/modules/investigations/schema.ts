import { z } from 'zod';

export const rootCauseCategoryEnum = z.enum([
  'PEOPLE',
  'PROCESS',
  'EQUIPMENT',
  'ENVIRONMENT',
  'MANAGEMENT_SYSTEM',
  'EXTERNAL',
]);

export const findingTypeEnum = z.enum([
  'IMMEDIATE_CAUSE',
  'UNDERLYING_CAUSE',
  'ROOT_CAUSE',
  'OBSERVATION',
]);

export const assignInvestigationSchema = z.object({
  leadInvestigatorId: z.string().uuid(),
  teamUserIds: z.array(z.string().uuid()).max(10).default([]),
  // Optional: the service derives a default from the severity band when absent.
  dueAt: z.coerce.date().optional(),
});

export const updateInvestigationSchema = z.object({
  summary: z.string().trim().max(8000).optional(),
});

export const timelineEntrySchema = z.object({
  occurredAt: z.coerce.date(),
  description: z.string().trim().min(3).max(2000),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const interviewSchema = z.object({
  intervieweeUserId: z.string().uuid().optional(),
  intervieweeName: z.string().trim().max(200).optional(),
  interviewedAt: z.coerce.date(),
  notes: z.string().trim().min(3).max(8000),
  isSensitive: z.boolean().default(false),
}).refine((v) => v.intervieweeUserId || v.intervieweeName, {
  message: 'Name the person interviewed.',
  path: ['intervieweeName'],
});

export const findingSchema = z.object({
  findingType: findingTypeEnum,
  statement: z.string().trim().min(10).max(2000),
  evidenceNote: z.string().trim().max(2000).optional(),
});

export const rootCauseSchema = z.object({
  problemStatement: z.string().trim().min(10).max(1000),
  statement: z.string().trim().min(10).max(1000),
  category: rootCauseCategoryEnum,
});

/**
 * A 5 Whys chain. Three is the floor: stopping at one or two "why"s reliably
 * lands on the person nearest the event rather than the condition that let it
 * happen. Seven is the ceiling because past that the chain stops being
 * evidence and starts being speculation.
 */
export const whysSchema = z.object({
  steps: z
    .array(
      z.object({
        step: z.number().int().min(1).max(7),
        question: z.string().trim().min(3).max(500),
        answer: z.string().trim().min(3).max(1000),
        aiSuggested: z.boolean().default(false),
      }),
    )
    .min(3, 'Ask at least three "why"s — fewer usually stops at who, not what.')
    .max(7)
    .refine(
      (steps) => steps.every((s, i) => s.step === i + 1),
      'Steps must be numbered consecutively from 1.',
    ),
});

export const returnInvestigationSchema = z.object({
  comments: z.string().trim().min(10, 'Say what needs to change before resubmission.'),
});

export type AssignInvestigationInput = z.infer<typeof assignInvestigationSchema>;
export type TimelineEntryInput = z.infer<typeof timelineEntrySchema>;
export type InterviewInput = z.infer<typeof interviewSchema>;
export type FindingInput = z.infer<typeof findingSchema>;
export type RootCauseInput = z.infer<typeof rootCauseSchema>;
export type WhysInput = z.infer<typeof whysSchema>;
