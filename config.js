// Aleks's AI mindmap – nastavitve
// Vpiši podatke iz Supabase: Project Settings → API (Data API) in API Keys.
// Ključ "anon" / "publishable" je javen po namenu – podatke ščitijo pravila v bazi (RLS).
// NIKOLI ne vpiši sem ključa "service_role" / "secret".

window.MINDMAP_CONFIG = {
    SUPABASE_URL: "https://xpwhpzfmlklspjmmvbaq.supabase.co/rest/v1/",
    SUPABASE_ANON_KEY: "sb_publishable_uPDbKeXE8h8TBZjmZK4Fhg_ADooiCC7",

  // Uporabniška imena se v ozadju pretvorijo v e-naslov ime@USER_DOMAIN.
  // Nanj se nikoli ne pošilja pošta. Mora se ujemati z imeni, ki jih ustvariš v Supabase.
  USER_DOMAIN: "mindmap.local"
};
