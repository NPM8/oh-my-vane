export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';
import Sidebar from '@/components/Sidebar';
import { Toaster } from 'sonner';
import ThemeProvider from '@/components/theme/Provider';
import configManager from '@/lib/config';
import SetupWizard from '@/components/Setup/SetupWizard';
import { ChatProvider } from '@/lib/hooks/useChat';
import { cookies, headers } from 'next/headers';
import { countUsers } from '@/lib/auth/users';
import { verifyJwt } from '@/lib/auth/jwt';
import { getAuthConfig } from '@/lib/auth/authConfig';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import Login from '@/components/Auth/Login';
import BootstrapAdmin from '@/components/Auth/BootstrapAdmin';

const montserrat = Montserrat({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  fallback: ['Arial', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'Vane - Direct your curiosity',
  description: 'Vane is an AI powered answering engine.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const setupComplete = configManager.isSetupComplete();
  const configSections = configManager.getUIConfigSections();

  const userCount = await countUsers();
  let authed = false;
  if (userCount > 0) {
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (token) {
      try {
        await verifyJwt(token, getAuthConfig().secret, 'access');
        authed = true;
      } catch {
        authed = false;
      }
    }
  }

  const pathname = (await headers()).get('x-vane-pathname') || '';
  const isPublicPage =
    pathname.startsWith('/invite') || pathname === '/login';

  const renderGate = () => {
    if (!setupComplete) return <SetupWizard configSections={configSections} />;
    if (userCount === 0) return <BootstrapAdmin />;
    if (!authed && !isPublicPage) return <Login />;
    if (!authed && isPublicPage) return children;
    return (
      <ChatProvider>
        <Sidebar>{children}</Sidebar>
        <Toaster
          toastOptions={{
            unstyled: true,
            classNames: {
              toast:
                'bg-light-secondary dark:bg-dark-secondary dark:text-white/70 text-black-70 rounded-lg p-4 flex flex-row items-center space-x-2',
            },
          }}
        />
      </ChatProvider>
    );
  };

  return (
    <html className="h-full" lang="en" suppressHydrationWarning>
      <body className={cn('h-full antialiased', montserrat.className)}>
        <ThemeProvider>{renderGate()}</ThemeProvider>
      </body>
    </html>
  );
}
