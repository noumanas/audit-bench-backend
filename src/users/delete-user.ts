import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface DeletableUser {
  id: string;
  organizationId: string | null;
  orgRole: string | null;
}

/**
 * A team owner can only be removed once they're alone in the team, so
 * deleting them never leaves other members in a team nobody owns.
 */
export async function assertNotOwnerOfOthers(
  prisma: PrismaService,
  user: DeletableUser,
  message: string,
): Promise<void> {
  if (!user.organizationId || user.orgRole !== 'owner') return;
  const others = await prisma.user.count({ where: { organizationId: user.organizationId, id: { not: user.id } } });
  if (others > 0) throw new ForbiddenException(message);
}

/**
 * Deletes a user and everything that's theirs. Reports, audits, rules,
 * tokens and the rest cascade in the database; payments and GitHub App
 * installations keep their history with the user cleared. A sole team
 * owner's team goes with them.
 */
export async function deleteUserRecords(prisma: PrismaService, user: DeletableUser): Promise<void> {
  await prisma.$transaction(async (db) => {
    // References that would otherwise block the delete.
    await db.organizationInvite.deleteMany({ where: { invitedById: user.id } });
    await db.planRequest.updateMany({ where: { reviewedById: user.id }, data: { reviewedById: null } });
    if (user.organizationId && user.orgRole === 'owner') {
      await db.organizationInvite.deleteMany({ where: { organizationId: user.organizationId } });
      await db.user.update({ where: { id: user.id }, data: { organizationId: null, orgRole: null } });
      await db.organization.delete({ where: { id: user.organizationId } });
    }
    await db.user.delete({ where: { id: user.id } });
  });
}
