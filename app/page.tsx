import { redirect } from 'next/navigation';
import { readSession } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await readSession();
  redirect(session ? '/dashboard' : '/sign-in');
}
