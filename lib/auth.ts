import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { prisma } from "./db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
      authorization: {
        params: {
          scope: "read:user user:email repo",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || !profile) return false;

      const githubId = String(profile.id ?? account.providerAccountId);
      const username = (profile as { login?: string }).login ?? user.name ?? "unknown";

      await prisma.user.upsert({
        where: { githubId },
        update: {
          accessToken: account.access_token!,
          email: user.email,
          avatarUrl: user.image,
          username,
        },
        create: {
          githubId,
          username,
          email: user.email,
          avatarUrl: user.image,
          accessToken: account.access_token!,
        },
      });

      return true;
    },
    async session({ session, token }) {
      if (token.sub) {
        const dbUser = await prisma.user.findFirst({
          where: { githubId: token.sub },
        });
        if (dbUser) {
          const s = session as unknown as Record<string, unknown>;
          s.dbUserId = dbUser.id;
          s.accessToken = dbUser.accessToken;
          s.githubUsername = dbUser.username;
        }
      }
      return session;
    },
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.sub = String(profile.id ?? account.providerAccountId);
      }
      return token;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
});
