import { auth } from "./auth";

export interface ApexSession {
  dbUserId: string;
  accessToken: string;
  githubUsername: string;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export async function getApexSession(): Promise<ApexSession | null> {
  const session = await auth();
  if (!session) return null;

  const s = session as unknown as Record<string, unknown>;
  if (!s.dbUserId || !s.accessToken) return null;

  return {
    dbUserId: s.dbUserId as string,
    accessToken: s.accessToken as string,
    githubUsername: s.githubUsername as string,
    user: session.user ?? {},
  };
}
