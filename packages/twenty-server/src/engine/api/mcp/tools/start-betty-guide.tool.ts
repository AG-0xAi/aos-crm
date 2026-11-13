import { Logger } from '@nestjs/common';

import { z } from 'zod';
import { isDefined } from 'twenty-shared/utils';

import { type SkillService } from 'src/engine/metadata-modules/skill/skill.service';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config.type';
import { type WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { type NoteWorkspaceEntity } from 'src/modules/note/standard-objects/note.workspace-entity';

const logger = new Logger('StartBettyGuideTool');

export const START_BETTY_GUIDE_TOOL_NAME = 'start_betty_guide';

export const BETTY_GUIDE_SKILL_NAME = 'betty-guia';
export const BETTY_GUIDE_PROFILE_NOTE_TITLE = 'Mi perfil de trabajo con Betty';

const MISSING_GUIDE_MESSAGE =
  'The betty-guia skill is not available in this workspace, so there is no conversation guide to load.';

const FIRST_QUESTION_BODY =
  'Soy Betty. Quiero entender cómo trabajas para proponerte las formas de usarme que más te ayuden. Para empezar: ¿a qué te dedicas y cómo es tu día a día?';

const GUIDE_SUMMARY =
  'Ask one question at a time, each built on the previous answer. Cover: what they do, how they get clients, contacts and pending tasks, email and meetings, sales funnel, content, team, and the tools they already use. ' +
  'After 3 to 5 answers, call search_use_cases and propose 2 or 3 paths, each with the exact prompt to paste and the external connectors to add in the chat. ' +
  'Build nothing without the person asking for it. ' +
  'Offer to save a profile note summarising what you learned, and update that note in place next time instead of creating another.';

const FULL_GUIDE_HINT = `If you need more detail when you start proposing paths, call load_skills with ${BETTY_GUIDE_SKILL_NAME}.`;

const NEXT_STEP =
  'Reply with firstMessage as your entire answer, translated if the person wrote in another language. Do not list options, menus or features. Then wait for their answer and follow guideSummary.';

const PROFILE_SUMMARY_MAX_LENGTH = 160;
const NAME_MAX_LENGTH = 40;
const NAME_INPUT_MAX_LENGTH = 100;
const FINAL_PUNCTUATION = /[.!?…:;]$/;

// LEAN-DEBT: first content line, trimmed; a real one-sentence summary
// would need a model call inside the tool.
const summarizeProfileNote = (profileNoteText: string): string | null => {
  const contentLine = profileNoteText
    .split('\n')
    .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
    .find((line) => line.length > 0 && line !== BETTY_GUIDE_PROFILE_NOTE_TITLE);

  if (!isDefined(contentLine)) {
    return null;
  }

  const trimmed =
    contentLine.length > PROFILE_SUMMARY_MAX_LENGTH
      ? contentLine.slice(0, PROFILE_SUMMARY_MAX_LENGTH).trimEnd()
      : contentLine;

  return FINAL_PUNCTUATION.test(trimmed) ? trimmed : `${trimmed}.`;
};

const sanitizeName = (name: string | undefined): string | undefined => {
  const clean = name
    ?.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
    .slice(0, NAME_MAX_LENGTH)
    .trim();

  return clean === undefined || clean.length === 0 ? undefined : clean;
};

const buildFirstMessage = (
  rawName: string | undefined,
  profileNoteText: string | null,
): string => {
  const name = sanitizeName(rawName);
  const greeting = isDefined(name) ? `¡Hola, ${name}!` : '¡Hola!';
  const summary = isDefined(profileNoteText)
    ? summarizeProfileNote(profileNoteText)
    : null;

  if (isDefined(summary)) {
    return `${greeting} Soy Betty. Por lo que tengo guardado de tu trabajo: ${summary} ¿Sigue siendo así o ha cambiado algo?`;
  }

  return `${greeting} ${FIRST_QUESTION_BODY}`;
};

export const startBettyGuideInputSchema = z.object({
  name: z
    .string()
    .max(NAME_INPUT_MAX_LENGTH)
    .optional()
    .describe(
      'The name the person gave, if any (e.g. "soy Andrés", "I\'m Maria")',
    ),
});

export type StartBettyGuideResult = {
  firstMessage: string;
  guideSummary: string;
  fullGuide: string;
  profileNote: string | null;
  nextStep: string;
};

export const createStartBettyGuideTool = (
  skillService: SkillService,
  workspaceOrmManager: WorkspaceOrmManager,
  workspaceId: string,
  rolePermissionConfig: RolePermissionConfig,
) => ({
  description:
    'Call this FIRST, before replying, whenever the person greets Betty (hola, hello, hi, buenos días), mentions @Betty with a greeting, introduces themselves ("soy Andrés", "I\'m …"), asks what Betty can do, or describes a work problem without naming a Betty feature. ' +
    "It returns firstMessage, a ready-to-send greeting with Betty's first question, plus a short guide and the person's saved work profile, if any. " +
    'Reply with firstMessage as your entire answer, translated if the person wrote in another language. Do not list options, menus or features. Then wait for their answer and follow guideSummary. ' +
    'Úsala primero ante un saludo o una presentación.',
  inputSchema: startBettyGuideInputSchema,
  execute: async ({
    name,
  }: z.infer<
    typeof startBettyGuideInputSchema
  >): Promise<StartBettyGuideResult> => {
    const [guideSkills, profileNote] = await Promise.all([
      skillService.findFlatSkillsByNames([BETTY_GUIDE_SKILL_NAME], workspaceId),
      workspaceOrmManager
        .executeInWorkspaceContext(async () => {
          const noteRepository =
            workspaceOrmManager.getRepository<NoteWorkspaceEntity>(
              'note',
              rolePermissionConfig,
            );

          return noteRepository.findOne({
            where: { title: BETTY_GUIDE_PROFILE_NOTE_TITLE },
          });
        }, buildSystemAuthContext(workspaceId))
        .catch(() => {
          logger.warn(
            `Could not read the Betty profile note for workspace ${workspaceId}; continuing without it`,
          );

          return null;
        }),
    ]);

    const profileNoteText = isDefined(profileNote?.bodyV2?.markdown)
      ? profileNote.bodyV2.markdown
      : null;

    if (guideSkills.length === 0) {
      return {
        firstMessage: buildFirstMessage(name, profileNoteText),
        guideSummary: MISSING_GUIDE_MESSAGE,
        fullGuide: MISSING_GUIDE_MESSAGE,
        profileNote: profileNoteText,
        nextStep: NEXT_STEP,
      };
    }

    return {
      firstMessage: buildFirstMessage(name, profileNoteText),
      guideSummary: GUIDE_SUMMARY,
      fullGuide: FULL_GUIDE_HINT,
      profileNote: profileNoteText,
      nextStep: NEXT_STEP,
    };
  },
});
