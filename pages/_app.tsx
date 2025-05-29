import type { AppProps } from 'next/app';
import '../styles/fonts.css'; // 导入全局CSS

function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}

export default MyApp;