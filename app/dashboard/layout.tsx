import { redirect } from "next/navigation";
import { getApexSession } from "@/lib/session";
import { Navbar } from "@/components/navbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getApexSession();
  if (!session) redirect("/auth/signin");

  return (
    <div className="min-h-screen bg-[#050505]">
      <Navbar
        username={session.githubUsername}
        avatarUrl={session.user.image ?? undefined}
      />
      <main id="main-content" tabIndex={-1} className="max-w-7xl mx-auto px-6 md:px-16 py-8">
        {children}
      </main>
    </div>
  );
}
