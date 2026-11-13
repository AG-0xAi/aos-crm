import { Logger } from '@nestjs/common';

import { z } from 'zod';
import { isDefined, tipTapDocumentToMarkdown } from 'twenty-shared/utils';

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
const FALLBACK_FIRST_QUESTION =
  ', then ask: "¿A qué te dedicas y cómo consigues tus clientes hoy?" (what do they do for work, and how do they get customers today).';

export const startBettyGuideInputSchema = z.object({
  name: z
    .string()
    .optional()
    .describe(
      'The name the person gave, if any (e.g. "soy Andrés", "I\'m Maria")',
    ),
});

export type StartBettyGuideResult = {
  guide: string;
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
    "It returns Betty's conversation guide (Conóceme) and the person's saved work profile, if any, so your reply can greet them by name and start the guided conversation. " +
    'Úsala primero ante un saludo o una presentación.',
  inputSchema: startBettyGuideInputSchema,
  execute: async ({
    name,
  }: z.infer<
    typeof startBettyGuideInputSchema
  >): Promise<StartBettyGuideResult> => {
    const greetPrefix = isDefined(name)
      ? `Greet ${name} by name`
      : 'Greet the person by name';

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
        guide: MISSING_GUIDE_MESSAGE,
        profileNote: profileNoteText,
        nextStep: `${greetPrefix}${FALLBACK_FIRST_QUESTION}`,
      };
    }

    const guide = tipTapDocumentToMarkdown(guideSkills[0].content);

    return {
      guide,
      profileNote: profileNoteText,
      nextStep: isDefined(profileNoteText)
        ? `${greetPrefix}, summarize in one sentence what you already know from their profile note, and ask if it is still accurate or if anything changed — do not repeat the full discovery.`
        : `${greetPrefix} and ask the first discovery question from the guide.`,
    };
  },
});
