/**
 * Makes an existing account a super_admin. Run by someone with database
 * access (it uses DATABASE_URL), never reachable from the web:
 *
 *   npm run admin:promote -- you@company.com
 *
 * The account must already exist (sign up first), so the person has a
 * working login before they get admin rights.
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Usage: npm run admin:promote -- <email>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, email: true, role: true },
    });
    if (!user) {
      console.error(`No account for ${email}. Sign up first, then run this again.`);
      process.exit(1);
    }
    if (user.role === 'super_admin') {
      console.log(`${user.email} is already a super_admin.`);
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { role: 'super_admin' } });
    console.log(`${user.email} is now a super_admin (was ${user.role}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
