import React, { ReactNode, createContext, useContext, useMemo } from "react";

type SiteConfigContextValue = {
  baseUrl: string;
};

const SiteConfigContext = createContext<SiteConfigContextValue>({
  baseUrl: "",
});

export function SiteConfigProvider({
  baseUrl = "",
  children,
}: {
  baseUrl?: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ baseUrl }), [baseUrl]);
  return (
    <SiteConfigContext.Provider value={value}>
      {children}
    </SiteConfigContext.Provider>
  );
}

export function useSiteConfig(): SiteConfigContextValue {
  return useContext(SiteConfigContext);
}
