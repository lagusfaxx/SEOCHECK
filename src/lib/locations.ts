/** Países que se pueden elegir y su código de ubicación (DataForSEO / Google Ads) para volúmenes y búsquedas. */
export const COUNTRIES: { code: string; name: string; location: number }[] = [
  { code: "cl", name: "Chile", location: 2152 },
  { code: "ar", name: "Argentina", location: 2032 },
  { code: "mx", name: "México", location: 2484 },
  { code: "co", name: "Colombia", location: 2170 },
  { code: "pe", name: "Perú", location: 2604 },
  { code: "uy", name: "Uruguay", location: 2858 },
  { code: "es", name: "España", location: 2724 },
  { code: "us", name: "Estados Unidos", location: 2840 },
];
export const LANGUAGES: { code: string; name: string }[] = [
  { code: "es", name: "Español" },
  { code: "en", name: "Inglés" },
  { code: "pt", name: "Portugués" },
];
export const locationOf = (country: string): number | undefined => COUNTRIES.find((c) => c.code === country.toLowerCase())?.location;
