import { useQuery } from "@tanstack/react-query";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Conference Room Chat experimental flag (PAP-136 / PAP-137).
 *
 * Wraps the shared experimental-settings query so gated call sites don't
 * repeat the boilerplate. `enabled` stays false while the query is in
 * flight (no flash of gated UI, same as the sidebar's `showWorkspacesLink`
 * pattern); `loaded` lets route gates avoid redirecting away before the
 * flag value is actually known.
 */
export function useConferenceRoomChatEnabled(): { enabled: boolean; loaded: boolean } {
  const { data, isFetched } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  return { enabled: data?.enableConferenceRoomChat === true, loaded: isFetched };
}
