export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "test" || process.env.ADGUARD_DISABLE_BG_REFRESH === "1") return;

  const { getAdGuardStore } = await import("@/lib/adguard/store");
  getAdGuardStore().startBackgroundRefresh();
}
