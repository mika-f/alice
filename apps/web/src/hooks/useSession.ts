import { useQuery } from "@tanstack/react-query";
import { getSession } from "../api/auth.js";

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: getSession,
    retry: false,
  });
}
