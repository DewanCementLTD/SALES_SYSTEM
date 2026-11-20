import { Inter } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = {
  title: { default: 'DCL Sales', template: '%s · DCL Sales' },
  description: 'Dewan Cement Limited — Sales & Dispatch',
  robots: { index: false, follow: false },
};

export const viewport = { themeColor: '#0c2744' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
