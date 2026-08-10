import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';

type ThemeContextType = {
  theme: Theme;
  setTheme: (t: Theme) => void;
};

type GlassContextType = {
  glass: boolean;
  toggleGlass: () => void;
};

const ThemeContext = createContext<ThemeContextType>({ theme: 'dark', setTheme: () => {} });
const GlassContext = createContext<GlassContextType>({ glass: false, toggleGlass: () => {} });

export const useTheme = () => useContext(ThemeContext);
export const useGlass = () => useContext(GlassContext);

export function Providers({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [glass, setGlass] = useState(false);

  useEffect(() => {
    const storedTheme = localStorage.getItem('theme') as Theme | null;
    const initialTheme = storedTheme || 'dark';
    setThemeState(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);

    const storedGlass = localStorage.getItem('glass-mode') === 'true';
    setGlass(storedGlass);
    document.documentElement.setAttribute('data-glass', String(storedGlass));
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
  }, []);

  const toggleGlass = useCallback(() => {
    setGlass((prev) => {
      const next = !prev;
      document.documentElement.setAttribute('data-glass', String(next));
      localStorage.setItem('glass-mode', String(next));
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <GlassContext.Provider value={{ glass, toggleGlass }}>
        {children}
      </GlassContext.Provider>
    </ThemeContext.Provider>
  );
}
